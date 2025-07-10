import {
    ConsumptionTransitionState,
    ConsumptionTransitionStateMachine,
} from "./consumption_transition_state_machine";
import { unwrapNumericState } from "../states_helpers";
import { DeviceHelper, IBaseDevice } from "./base_device";
import { IClimateEntityWrapper } from "../../../entities/climate_entity_wrapper";
import { ISensorEntityWrapper } from "../../../entities/sensor_entity_wrapper";



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
    compressorStartupMinConsumption: number;  // 300 (minimum startup consumption with configured offset)
    powerOnSetpointOffset: number;  // 2.0 (degrees offset from room temp toward desired mode, clamped between desired and comfort setpoints)
    consumptionPerDegree: number;   // 150 (watts per degree of setpoint delta from room temperature)
    maxCompressorConsumption: number; // 800 (maximum compressor consumption at full capacity)
    fanOnlyMinConsumption: number;  // 100 (minimum consumption in fan-only mode)
    heatCoolMinConsumption: number;

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
    comfortSetpoint?: number;       // Optional comfort boundary temperature (limits decrease operations only)
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
        const desiredSetpoint = this.hassControls.desiredSetpoint;
        const desiredMode = this.hassControls.desiredMode;
        const increments: ClimateIncrement[] = [];

        // Handle device-off case (startup power calculation)
        if (this.climateEntityRef.state === "off") {
            // Calculate initial setpoint with offset in the direction of desired mode
            let initialSetpoint: number;
            if (desiredMode === "heat") {
                initialSetpoint = Math.min(roomTemp + this.config.powerOnSetpointOffset, desiredSetpoint);
            } else {
                initialSetpoint = Math.max(roomTemp - this.config.powerOnSetpointOffset, desiredSetpoint);
            }
            
            // Apply absolute limits
            initialSetpoint = Math.max(this.config.minSetpoint, Math.min(this.config.maxSetpoint, initialSetpoint));
            
            // Note: Comfort setpoint should NOT limit startup operations - always move toward desired setpoint
            
            // Calculate startup power: base startup consumption + temperature differential consumption
            const tempDiff = Math.abs(roomTemp - initialSetpoint);
            const temperaturePower = tempDiff * this.config.consumptionPerDegree;
            const startupPower = this.config.compressorStartupMinConsumption + temperaturePower;
            
            increments.push({
                delta: startupPower,
                modeChange: desiredMode,
                targetSetpoint: initialSetpoint,
            });
            return increments;
        }

        // Device is on - calculate setpoint adjustments toward desired setpoint
        const currentSetpoint = this.climateEntityRef.targetTemperature;
        const currentMode = this.climateEntityRef.state;

        // Handle mode changes (fan-only to heat/cool)
        if (currentMode === "fan_only" && (desiredMode === "heat" || desiredMode === "cool")) {
            // Generate increments for each setpoint step toward desired
            const step = this.config.setpointStep;
            let lastDelta: number | undefined;
            
            if (desiredMode === "heat") {
                for (let targetSetpoint = currentSetpoint + step; 
                     targetSetpoint <= desiredSetpoint && targetSetpoint <= this.config.maxSetpoint; 
                     targetSetpoint += step) {
                    
                    // Note: Comfort setpoint should NOT limit increase operations - always move toward desired setpoint
                    
                    // For mode change from fan_only, calculate full consumption at target setpoint
                    const tempDiff = Math.abs(roomTemp - targetSetpoint);
                    const temperaturePower = tempDiff * this.config.consumptionPerDegree;
                    const targetConsumption = Math.min(this.config.compressorStartupMinConsumption + temperaturePower, this.config.maxCompressorConsumption);
                    const delta = targetConsumption - this.currentConsumption;
                    
                    if (delta > 0 && delta !== lastDelta) { // Only include if it actually increases consumption and is not duplicate
                        increments.push({
                            delta,
                            modeChange: desiredMode,
                            targetSetpoint,
                            setpointChange: targetSetpoint - currentSetpoint,
                        });
                        lastDelta = delta;
                    }
                }
            } else {
                for (let targetSetpoint = currentSetpoint - step; 
                     targetSetpoint >= desiredSetpoint && targetSetpoint >= this.config.minSetpoint; 
                     targetSetpoint -= step) {
                    
                    // Note: Comfort setpoint should NOT limit increase operations - always move toward desired setpoint
                    
                    // For mode change from fan_only, calculate full consumption at target setpoint
                    const tempDiff = Math.abs(roomTemp - targetSetpoint);
                    const temperaturePower = tempDiff * this.config.consumptionPerDegree;
                    const targetConsumption = Math.min(this.config.compressorStartupMinConsumption + temperaturePower, this.config.maxCompressorConsumption);
                    const delta = targetConsumption - this.currentConsumption;
                    
                    if (delta > 0 && delta !== lastDelta) { // Only include if it actually increases consumption and is not duplicate
                        increments.push({
                            delta,
                            modeChange: desiredMode,
                            targetSetpoint,
                            setpointChange: targetSetpoint - currentSetpoint,
                        });
                        lastDelta = delta;
                    }
                }
            }
        } else if (currentMode === desiredMode) {
            // Same mode - generate setpoint increments toward desired setpoint
            const step = this.config.setpointStep;
            let lastDelta: number | undefined;
            
            if (desiredMode === "heat") {
                for (let targetSetpoint = currentSetpoint + step; 
                     targetSetpoint <= desiredSetpoint && targetSetpoint <= this.config.maxSetpoint; 
                     targetSetpoint += step) {
                    
                    // Note: Comfort setpoint should NOT limit increase operations - always move toward desired setpoint
                    
                    // For running devices, calculate consumption delta based on setpoint change
                    const setpointDelta = Math.abs(targetSetpoint - currentSetpoint);
                    const deltaConsumption = setpointDelta * this.config.consumptionPerDegree;
                    const projectedConsumption = this.currentConsumption + deltaConsumption;
                    
                    // Clamp to maximum consumption and recalculate delta
                    const clampedConsumption = Math.min(projectedConsumption, this.config.maxCompressorConsumption);
                    const delta = clampedConsumption - this.currentConsumption;
                    
                    if (delta > 0 && delta !== lastDelta) { // Only include if it actually increases consumption and is not duplicate
                        increments.push({
                            delta,
                            targetSetpoint,
                            setpointChange: targetSetpoint - currentSetpoint,
                        });
                        lastDelta = delta;
                    }
                }
            } else {
                for (let targetSetpoint = currentSetpoint - step; 
                     targetSetpoint >= desiredSetpoint && targetSetpoint >= this.config.minSetpoint; 
                     targetSetpoint -= step) {
                    
                    // Note: Comfort setpoint should NOT limit increase operations - always move toward desired setpoint
                    
                    // For running devices, calculate consumption delta based on setpoint change
                    const setpointDelta = Math.abs(targetSetpoint - currentSetpoint);
                    const deltaConsumption = setpointDelta * this.config.consumptionPerDegree;
                    const projectedConsumption = this.currentConsumption + deltaConsumption;
                    
                    // Clamp to maximum consumption and recalculate delta
                    const clampedConsumption = Math.min(projectedConsumption, this.config.maxCompressorConsumption);
                    const delta = clampedConsumption - this.currentConsumption;
                    
                    if (delta > 0 && delta !== lastDelta) { // Only include if it actually increases consumption and is not duplicate
                        increments.push({
                            delta,
                            targetSetpoint,
                            setpointChange: targetSetpoint - currentSetpoint,
                        });
                        lastDelta = delta;
                    }
                }
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

        // Generate setpoint decreases (away from desired setpoint)
        const step = this.config.setpointStep;
        
        if (desiredMode === "heat") {
            // For heating, move setpoint lower (less aggressive heating)
            const lowerBound = this.hassControls.comfortSetpoint !== undefined 
                ? this.hassControls.comfortSetpoint 
                : this.config.minSetpoint;
            
            for (let targetSetpoint = currentSetpoint - step; 
                 targetSetpoint >= lowerBound && targetSetpoint >= this.config.minSetpoint; 
                 targetSetpoint -= step) {
                
                // For running devices, calculate consumption delta based on setpoint change
                const setpointDelta = Math.abs(targetSetpoint - currentSetpoint);
                const delta = setpointDelta * this.config.consumptionPerDegree;
                
                if (delta > 0) { // Only include if it actually decreases consumption
                    increments.push({
                        delta, // Already positive for decrease increments
                        targetSetpoint,
                        setpointChange: targetSetpoint - currentSetpoint,
                    });
                }
            }
        } else if (desiredMode === "cool") {
            // For cooling, move setpoint higher (less aggressive cooling)
            const upperBound = this.hassControls.comfortSetpoint !== undefined
                ? this.hassControls.comfortSetpoint
                : this.config.maxSetpoint;
            
            for (let targetSetpoint = currentSetpoint + step; 
                 targetSetpoint <= upperBound && targetSetpoint <= this.config.maxSetpoint; 
                 targetSetpoint += step) {
                
                // For running devices, calculate consumption delta based on setpoint change
                const setpointDelta = Math.abs(targetSetpoint - currentSetpoint);
                const delta = setpointDelta * this.config.consumptionPerDegree;
                
                if (delta > 0) { // Only include if it actually decreases consumption
                    increments.push({
                        delta, // Already positive for decrease increments
                        targetSetpoint,
                        setpointChange: targetSetpoint - currentSetpoint,
                    });
                }
            }
        }

        // Handle mode transitions to fan-only (only when no comfort setpoint specified)
        if ((currentMode === "heat" || currentMode === "cool") && this.hassControls.comfortSetpoint === undefined) {
            const fanOnlyDelta = currentConsumption - this.config.fanOnlyMinConsumption;
            if (fanOnlyDelta > 0) {
                increments.push({
                    delta: fanOnlyDelta,
                    modeChange: "fan_only",
                });
            }
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
