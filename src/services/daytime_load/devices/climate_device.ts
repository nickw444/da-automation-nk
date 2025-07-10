import {
    ConsumptionTransitionState,
    ConsumptionTransitionStateMachine,
} from "./consumption_transition_state_machine";
import { unwrapNumericState } from "../states_helpers";
import { DeviceHelper, IBaseDevice } from "./base_device";
import { IClimateEntityWrapper } from "../../../entities/climate_entity_wrapper";
import { ISensorEntityWrapper } from "../../../entities/sensor_entity_wrapper";

// Helper functions for power calculations
function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function blend(scaledValue: number, linearValue: number, scaledWeight: number = 0.7): number {
    // Combines scaled consumption with linear estimate (e.g., 70% scaled + 30% linear)
    // Purpose: Balance real-world performance with theoretical model
    return scaledValue * scaledWeight + linearValue * (1 - scaledWeight);
}

function calculateTemperatureDifferential(roomTemp: number, setpoint: number): number {
    return Math.abs(roomTemp - setpoint);
}

function calculateInitialSetpoint(
    roomTemp: number,
    desiredSetpoint: number,
    desiredMode: "heat" | "cool",
    config: ClimateDeviceConfig,
    hassControls: IClimateHassControls
): number {
    const offset = config.powerOnSetpointOffset;
    let initialSetpoint: number;

    if (desiredMode === "heat") {
        initialSetpoint = roomTemp + offset; // Move toward warmer
    } else {
        initialSetpoint = roomTemp - offset; // Move toward cooler
    }

    // Clamp between desired and comfort setpoints if comfort setpoint is specified
    if (hassControls.comfortSetpoint !== undefined) {
        if (desiredMode === "heat") {
            // For heating: comfort setpoint is minimum allowed (cooler than desired)
            initialSetpoint = clamp(initialSetpoint, hassControls.comfortSetpoint, desiredSetpoint);
        } else {
            // For cooling: comfort setpoint is maximum allowed (warmer than desired)
            initialSetpoint = clamp(initialSetpoint, desiredSetpoint, hassControls.comfortSetpoint);
        }
    } else {
        // Clamp between absolute limits
        initialSetpoint = clamp(initialSetpoint, config.minSetpoint, config.maxSetpoint);
    }

    return initialSetpoint;
}

function calculateStartupPower(
    roomTemp: number,
    desiredSetpoint: number,
    desiredMode: "heat" | "cool",
    config: ClimateDeviceConfig,
    hassControls: IClimateHassControls
): number {
    const initialSetpoint = calculateInitialSetpoint(roomTemp, desiredSetpoint, desiredMode, config, hassControls);

    // Calculate power-on consumption: max(|roomTemp - clampedSetpoint| * consumptionPerDegree, powerOnMinConsumption)
    const temperatureDelta = calculateTemperatureDifferential(roomTemp, initialSetpoint);
    const calculatedConsumption = temperatureDelta * config.consumptionPerDegree;

    return Math.max(calculatedConsumption, config.powerOnMinConsumption);
}

function calculateIncrementDelta(
    currentConsumption: number,
    roomTemp: number,
    currentSetpoint: number,
    targetSetpoint: number,
    targetMode: "heat" | "cool" | "fan_only",
    config: ClimateDeviceConfig
): number {
    const currentDifferential = calculateTemperatureDifferential(roomTemp, currentSetpoint);
    const targetDifferential = calculateTemperatureDifferential(roomTemp, targetSetpoint);

    // Scale actual consumption based on temperature differential ratio
    let scaledConsumption: number;
    if (currentDifferential > 0) {
        scaledConsumption = currentConsumption * (targetDifferential / currentDifferential);
    } else {
        // If current differential is 0, use linear estimate
        scaledConsumption = targetDifferential * config.consumptionPerDegree;
    }

    // Linear model estimate with bounds
    let linearEstimate: number;
    if (targetDifferential > currentDifferential) {
        // Increase: cap at maximum
        linearEstimate = Math.min(targetDifferential * config.consumptionPerDegree, config.maxCompressorConsumption);
    } else {
        // Decrease: floor at minimum
        let modeMinConsumption: number;
        switch (targetMode) {
            case "fan_only":
                modeMinConsumption = config.fanOnlyMinConsumption;
                break;
            case "heat":
                modeMinConsumption = config.heatModeMinConsumption;
                break;
            case "cool":
                modeMinConsumption = config.coolModeMinConsumption;
                break;
        }
        linearEstimate = Math.max(targetDifferential * config.consumptionPerDegree, modeMinConsumption);
    }

    // Blend the two approaches and apply final bounds
    const blendedConsumption = blend(scaledConsumption, linearEstimate);

    // Apply final consumption bounds
    let modeMinConsumption: number;
    switch (targetMode) {
        case "fan_only":
            modeMinConsumption = config.fanOnlyMinConsumption;
            break;
        case "heat":
            modeMinConsumption = config.heatModeMinConsumption;
            break;
        case "cool":
            modeMinConsumption = config.coolModeMinConsumption;
            break;
    }

    const finalTargetConsumption = clamp(blendedConsumption, modeMinConsumption, config.maxCompressorConsumption);

    // Calculate delta (positive indicates direction of change)
    return finalTargetConsumption - currentConsumption;
}

function calculateSetpointIncreases(
    roomTemp: number,
    currentSetpoint: number,
    desiredSetpoint: number,
    desiredMode: "heat" | "cool",
    currentConsumption: number,
    config: ClimateDeviceConfig
): ClimateIncrement[] {
    const increments: ClimateIncrement[] = [];

    // Determine direction of setpoint adjustment
    const step = config.setpointStep;

    if (desiredMode === "heat") {
        // For heating, move setpoint higher toward desired (more aggressive heating)
        let targetSetpoint = currentSetpoint;
        while (targetSetpoint + step <= desiredSetpoint && targetSetpoint + step <= config.maxSetpoint) {
            targetSetpoint += step;
            const delta = calculateIncrementDelta(currentConsumption, roomTemp, currentSetpoint, targetSetpoint, desiredMode, config);

            if (delta > 0) { // Only include if it actually increases consumption
                increments.push({
                    delta,
                    targetSetpoint,
                    setpointChange: targetSetpoint - currentSetpoint,
                });
            }
        }
    } else {
        // For cooling, move setpoint lower toward desired (more aggressive cooling)
        let targetSetpoint = currentSetpoint;
        while (targetSetpoint - step >= desiredSetpoint && targetSetpoint - step >= config.minSetpoint) {
            targetSetpoint -= step;
            const delta = calculateIncrementDelta(currentConsumption, roomTemp, currentSetpoint, targetSetpoint, desiredMode, config);

            if (delta > 0) { // Only include if it actually increases consumption
                increments.push({
                    delta,
                    targetSetpoint,
                    setpointChange: targetSetpoint - currentSetpoint,
                });
            }
        }
    }

    return increments;
}

function calculateModeChangeIncrement(
    roomTemp: number,
    currentSetpoint: number,
    desiredMode: "heat" | "cool",
    currentConsumption: number,
    config: ClimateDeviceConfig
): ClimateIncrement | null {
    const delta = calculateIncrementDelta(currentConsumption, roomTemp, currentSetpoint, currentSetpoint, desiredMode, config);

    if (delta > 0) {
        return {
            delta,
            modeChange: desiredMode,
        };
    }

    return null;
}

function calculateSetpointDecreases(
    roomTemp: number,
    currentSetpoint: number,
    desiredSetpoint: number,
    desiredMode: "heat" | "cool",
    currentConsumption: number,
    config: ClimateDeviceConfig,
    hassControls: IClimateHassControls
): ClimateIncrement[] {
    const increments: ClimateIncrement[] = [];
    const step = config.setpointStep;

    if (desiredMode === "heat") {
        // For heating, move setpoint lower away from desired (less aggressive heating)
        let targetSetpoint = currentSetpoint;
        
        // Determine the lower bound - either comfort setpoint or absolute minimum
        const lowerBound = hassControls.comfortSetpoint !== undefined 
            ? hassControls.comfortSetpoint 
            : config.minSetpoint;
        
        while (targetSetpoint - step >= lowerBound && targetSetpoint - step >= config.minSetpoint) {
            targetSetpoint -= step;
            const delta = calculateIncrementDelta(currentConsumption, roomTemp, currentSetpoint, targetSetpoint, desiredMode, config);
            
            if (delta < 0) { // Only include if it actually decreases consumption
                increments.push({
                    delta: Math.abs(delta), // Make delta positive for decrease increments
                    targetSetpoint,
                    setpointChange: targetSetpoint - currentSetpoint,
                });
            }
        }
    } else {
        // For cooling, move setpoint higher away from desired (less aggressive cooling)
        let targetSetpoint = currentSetpoint;
        
        // Determine the upper bound - either comfort setpoint or absolute maximum  
        const upperBound = hassControls.comfortSetpoint !== undefined
            ? hassControls.comfortSetpoint
            : config.maxSetpoint;
            
        while (targetSetpoint + step <= upperBound && targetSetpoint + step <= config.maxSetpoint) {
            targetSetpoint += step;
            const delta = calculateIncrementDelta(currentConsumption, roomTemp, currentSetpoint, targetSetpoint, desiredMode, config);
            
            if (delta < 0) { // Only include if it actually decreases consumption
                increments.push({
                    delta: Math.abs(delta), // Make delta positive for decrease increments
                    targetSetpoint,
                    setpointChange: targetSetpoint - currentSetpoint,
                });
            }
        }
    }

    return increments;
}

function calculateFanOnlyModeIncrement(
    roomTemp: number,
    currentSetpoint: number,
    currentConsumption: number,
    config: ClimateDeviceConfig
): ClimateIncrement | null {
    const delta = calculateIncrementDelta(currentConsumption, roomTemp, currentSetpoint, currentSetpoint, "fan_only", config);
    
    if (delta < 0) { // Only include if it actually decreases consumption
        return {
            delta: Math.abs(delta), // Make delta positive for decrease increments
            modeChange: "fan_only",
        };
    }
    
    return null;
}

// Configuration interface for ClimateDevice
export interface ClimateDeviceConfig {
    // Device Identity
    name: string;                   // Device identifier (e.g., "living_room_ac")
    priority: number;               // Device priority for load management (lower = higher priority)

    // Home Assistant Entities
    climateEntity: string;          // climate.living_room_hvac
    consumptionEntity: string;      // sensor.hvac_power_consumption (required)

    // Temperature Constraints
    minSetpoint: number;            // 16 (absolute climate entity limits)
    maxSetpoint: number;            // 30 (absolute climate entity limits)
    setpointStep: number;           // 1.0 (temperature increment)

    // Power Configuration
    powerOnMinConsumption: number;  // 300 (minimum startup consumption with configured offset)
    powerOnSetpointOffset: number;  // 2.0 (degrees offset from room temp toward desired mode, clamped between desired and comfort setpoints)
    consumptionPerDegree: number;   // 150 (watts per degree of setpoint delta from room temperature)
    maxCompressorConsumption: number; // 800 (maximum compressor consumption at full capacity)
    fanOnlyMinConsumption: number;  // 100 (minimum consumption in fan-only mode)
    heatModeMinConsumption: number; // 200 (minimum consumption when in heating mode)
    coolModeMinConsumption: number; // 200 (minimum consumption when in cooling mode)

    // Timing Configuration
    setpointDebounceMs: number;     // 2-5 minutes (120000-300000ms) between setpoint changes
    modeDebounceMs: number;         // 5-10 minutes (300000-600000ms) between mode changes
    startupDebounceMs: number;      // 5-10 minutes (300000-600000ms) for startup from off
    fanOnlyTimeoutMs: number;       // 30-60 minutes (1800000-3600000ms) before auto-off from fan-only
}

// User control interface for ClimateDevice
export interface IClimateHassControls {
    desiredSetpoint: number;        // User's target temperature
    desiredMode: "heat" | "cool";   // User's desired operating mode
    comfortSetpoint?: number;       // Optional comfort boundary temperature
}

// ClimateIncrement interface for increase/decrease operations
export interface ClimateIncrement {
    delta: number;                  // Power consumption change (in Watts)
    targetSetpoint?: number;        // Absolute target setpoint
    setpointChange?: number;        // Relative change from current setpoint
    modeChange?: string;            // Mode switch operation
}

export class ClimateDevice implements IBaseDevice<ClimateIncrement, ClimateIncrement> {
    private readonly consumptionTransitionStateMachine: ConsumptionTransitionStateMachine =
        new ConsumptionTransitionStateMachine();
    private unlockedTime: number = 0;
    private lastOperationType: "setpoint" | "mode" | "startup" | null = null;

    constructor(
        private readonly climateEntityRef: IClimateEntityWrapper,
        private readonly consumptionEntityRef: ISensorEntityWrapper,
        private readonly config: ClimateDeviceConfig,
        private readonly hassControls: IClimateHassControls,
    ) {
    }

    get name(): string {
        return this.config.name;
    }

    get priority(): number {
        return this.config.priority;
    }

    get increaseIncrements(): ClimateIncrement[] {
        const roomTemp = this.climateEntityRef.roomTemperature;
        const currentConsumption = this.currentConsumption;
        const desiredSetpoint = this.hassControls.desiredSetpoint;
        const desiredMode = this.hassControls.desiredMode;
        const increments: ClimateIncrement[] = [];

        // Handle device-off case (startup power calculation)
        if (this.climateEntityRef.state === "off") {
            const startupPower = calculateStartupPower(roomTemp, desiredSetpoint, desiredMode, this.config, this.hassControls);
            increments.push({
                delta: startupPower,
                modeChange: desiredMode,
                targetSetpoint: calculateInitialSetpoint(roomTemp, desiredSetpoint, desiredMode, this.config, this.hassControls),
            });
            return increments;
        }

        // Device is on - calculate setpoint adjustments toward user desired setpoint
        const currentSetpoint = this.climateEntityRef.targetTemperature;
        const currentMode = this.climateEntityRef.state;

        // Skip if already at maximum capacity (temperature differential > 3°C)
        const currentDifferential = calculateTemperatureDifferential(roomTemp, currentSetpoint);
        if (currentDifferential > 3) {
            return []; // Already at full compressor capacity
        }

        // Calculate possible setpoint adjustments toward desired setpoint
        const setpointIncrements = calculateSetpointIncreases(roomTemp, currentSetpoint, desiredSetpoint, desiredMode, currentConsumption, this.config);
        increments.push(...setpointIncrements);

        // Handle mode changes (fan-only to heat/cool)
        if (currentMode === "fan_only" && (desiredMode === "heat" || desiredMode === "cool")) {
            const modeChangeIncrement = calculateModeChangeIncrement(roomTemp, currentSetpoint, desiredMode, currentConsumption, this.config);
            if (modeChangeIncrement) {
                increments.push(modeChangeIncrement);
            }
        }

        return increments;
    }



    get decreaseIncrements(): ClimateIncrement[] {
        const roomTemp = this.climateEntityRef.roomTemperature;
        const currentConsumption = this.currentConsumption;
        const desiredSetpoint = this.hassControls.desiredSetpoint;
        const desiredMode = this.hassControls.desiredMode;
        const increments: ClimateIncrement[] = [];

        // Handle device-off case - no decreases possible
        if (this.climateEntityRef.state === "off") {
            return [];
        }

        // Device is on - calculate ways to reduce consumption
        const currentSetpoint = this.climateEntityRef.targetTemperature;
        const currentMode = this.climateEntityRef.state;

        // 1. Calculate setpoint adjustments away from desired setpoint (less aggressive)
        const setpointDecreases = calculateSetpointDecreases(
            roomTemp, 
            currentSetpoint, 
            desiredSetpoint, 
            desiredMode, 
            currentConsumption, 
            this.config, 
            this.hassControls
        );
        increments.push(...setpointDecreases);

        // 2. Handle mode transitions to fan-only (only when no comfort setpoint specified)
        if ((currentMode === "heat" || currentMode === "cool") && this.hassControls.comfortSetpoint === undefined) {
            const fanOnlyIncrement = calculateFanOnlyModeIncrement(roomTemp, currentSetpoint, currentConsumption, this.config);
            if (fanOnlyIncrement) {
                increments.push(fanOnlyIncrement);
            }
        }

        // 3. Handle transition to off state (turn off completely)
        if (currentConsumption > 0) {
            increments.push({
                delta: currentConsumption, // All current consumption
                modeChange: "off",
            });
        }

        return increments;
    }

    get currentConsumption(): number {
        return unwrapNumericState(this.consumptionEntityRef.state) || 0;
    }

    get changeState():
        | { type: "increase" | "decrease", expectedFutureConsumption: number }
        | { type: "debounce" }
        | undefined {

        // First check for pending state transitions (these take priority)
        if (
            this.consumptionTransitionStateMachine.state ===
            ConsumptionTransitionState.INCREASE_PENDING
        ) {
            return { type: "increase", expectedFutureConsumption: 0 }; // Will be calculated properly in Phase 3
        } else if (
            this.consumptionTransitionStateMachine.state ===
            ConsumptionTransitionState.DECREASE_PENDING
        ) {
            return { type: "decrease", expectedFutureConsumption: 0 }; // Will be calculated properly in Phase 4
        }

        // Then check if we're in debounce period (only when no pending change)
        if (Date.now() < this.unlockedTime) {
            return { type: "debounce" };
        }

        return undefined;
    }

    private recordStateChange(operationType: "setpoint" | "mode" | "startup"): void {
        const now = Date.now();
        this.lastOperationType = operationType;

        // Set appropriate debounce period based on operation type
        switch (operationType) {
            case "setpoint":
                this.unlockedTime = now + this.config.setpointDebounceMs;
                break;
            case "mode":
                this.unlockedTime = now + this.config.modeDebounceMs;
                break;
            case "startup":
                this.unlockedTime = now + this.config.startupDebounceMs;
                break;
        }
    }





    increaseConsumptionBy(increment: ClimateIncrement): void {
        // Check for debounce - return silently if in debounce period
        if (this.changeState?.type === "debounce") {
            return;
        }

        DeviceHelper.validateIncreaseConsumptionBy(this, increment);

        // Placeholder implementation - will be implemented in Phase 5
    }

    decreaseConsumptionBy(increment: ClimateIncrement): void {
        // Check for debounce - return silently if in debounce period
        if (this.changeState?.type === "debounce") {
            return;
        }

        DeviceHelper.validateDecreaseConsumptionBy(this, increment);

        // Placeholder implementation - will be implemented in Phase 5
    }

    stop(): void {
        // Turn off device immediately
        this.climateEntityRef.turnOff();

        // Reset state machine to idle
        this.consumptionTransitionStateMachine.transitionTo(
            ConsumptionTransitionState.IDLE,
        );

        // Reset debounce state
        this.unlockedTime = 0;
        this.lastOperationType = null;
    }
}
