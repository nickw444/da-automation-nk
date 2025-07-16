import {
    ConsumptionTransitionState,
    ConsumptionTransitionStateMachine,
} from "./consumption_transition_state_machine";
import { unwrapNumericState } from "../states_helpers";
import { DeviceHelper, IBaseDevice } from "./base_device";
import { IClimateEntityWrapper } from "../../../entities/climate_entity_wrapper";
import { ISensorEntityWrapper } from "../../../entities/sensor_entity_wrapper";
import { TServiceParams } from "@digital-alchemy/core";
import { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";
import { toSnakeCase } from "../../../base/snake_case";
import { BaseHassControls, IBaseHassControls } from "./base_controls";


export interface ClimateDeviceOptions {
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
export interface IClimateHassControls extends IBaseHassControls {
    desiredSetpoint: number;        // User's target temperature
    desiredMode: "heat" | "cool" | "off";   // User's desired operating mode
    enableComfortSetpoint: boolean;
    comfortSetpoint?: number;       // Optional comfort boundary temperature (limits decrease operations only)
}

/**
 * ClimateIncrement represents a possible device action for increasing or decreasing consumption.
 * 
 * Implementation Note: This implementation uses a simplified power calculation approach
 * that deviates from the original specification's blended scaling formulas. Key differences:
 * - Uses additive startup power (base + differential) instead of max(differential, base)
 * - Comfort setpoint doesn't limit startup operations (always moves toward desired)  
 * - Simplified linear power calculation instead of blended scaled/linear approach
 * - Single heatCoolMinConsumption instead of separate heat/cool minimums
 * 
 * These simplifications make the implementation more predictable and easier to test
 * while maintaining the core load management functionality.
 */
export interface ClimateIncrement {
    delta: number;                  // Power consumption change (in Watts)
    targetSetpoint?: number;        // Absolute target setpoint
    modeChange?: "heat" | "cool" | "fan_only";  // Mode switch operation
}

export class ClimateDevice implements IBaseDevice<ClimateIncrement, ClimateIncrement> {
    private readonly consumptionTransitionStateMachine: ConsumptionTransitionStateMachine =
        new ConsumptionTransitionStateMachine();
    private unlockedTime: number = 0;
    private fanOnlyTimeoutTimer: NodeJS.Timeout | null = null;

    constructor(
        readonly name: string,
        readonly priority: number,
        private readonly climateEntityRef: IClimateEntityWrapper,
        private readonly consumptionEntityRef: ISensorEntityWrapper,
        private readonly hassControls: IClimateHassControls,
        private readonly opts: ClimateDeviceOptions,
    ) {
    }

    get baseControls(): IBaseHassControls {
        return this.hassControls;
    }

    /**
     * Calculate available power consumption increases.
     * 
     * Returns array of ClimateIncrement objects representing ways to increase device consumption:
     * - When device is off: Returns startup increment with initial setpoint
     * - When device is on: Returns setpoint adjustments toward user desired setpoint
     * - Always moves toward more aggressive heating/cooling (ignores comfort setpoint)
     * 
     * Power calculation uses blended approach:
     * - For startup: base consumption + temperature differential consumption
     * - For running device: current consumption + setpoint change consumption
     * - Capped at maxCompressorConsumption
     */
    get increaseIncrements(): ClimateIncrement[] {
        const roomTemp = this.climateEntityRef.roomTemperature;
        const desiredSetpoint = this.hassControls.desiredSetpoint;
        const desiredMode = this.hassControls.desiredMode;
        const increments: ClimateIncrement[] = [];

        // If desired mode is "off", no increase increments are available
        if (desiredMode === "off") {
            return [];
        }

        // Handle device-off case (startup power calculation)
        if (this.climateEntityRef.state === "off") {
            // Calculate initial setpoint with offset in the direction of desired mode
            let initialSetpoint: number;
            if (desiredMode === "heat") {
                initialSetpoint = Math.min(roomTemp + this.opts.powerOnSetpointOffset, desiredSetpoint);
            } else {
                initialSetpoint = Math.max(roomTemp - this.opts.powerOnSetpointOffset, desiredSetpoint);
            }

            // Apply absolute limits
            initialSetpoint = Math.max(this.opts.minSetpoint, Math.min(this.opts.maxSetpoint, initialSetpoint));

            // Note: Comfort setpoint should NOT limit startup operations - always move toward desired setpoint

            // Calculate startup power: base startup consumption + temperature differential consumption
            const tempDiff = Math.abs(roomTemp - initialSetpoint);
            const temperaturePower = tempDiff * this.opts.consumptionPerDegree;
            const startupPower = this.opts.compressorStartupMinConsumption + temperaturePower;

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
            const step = this.opts.setpointStep;
            let lastDelta: number | undefined;

            if (desiredMode === "heat") {
                for (let targetSetpoint = currentSetpoint + step;
                    targetSetpoint <= desiredSetpoint && targetSetpoint <= this.opts.maxSetpoint;
                    targetSetpoint += step) {

                    // Note: Comfort setpoint should NOT limit increase operations - always move toward desired setpoint

                    // For mode change from fan_only, calculate full consumption at target setpoint
                    const tempDiff = Math.abs(roomTemp - targetSetpoint);
                    const temperaturePower = tempDiff * this.opts.consumptionPerDegree;
                    const targetConsumption = Math.min(this.opts.compressorStartupMinConsumption + temperaturePower, this.opts.maxCompressorConsumption);
                    const delta = targetConsumption - this.currentConsumption;

                    if (delta > 0 && delta !== lastDelta) { // Only include if it actually increases consumption and is not duplicate
                        increments.push({
                            delta,
                            modeChange: desiredMode,
                            targetSetpoint,
                        });
                        lastDelta = delta;
                    }
                }
            } else {
                for (let targetSetpoint = currentSetpoint - step;
                    targetSetpoint >= desiredSetpoint && targetSetpoint >= this.opts.minSetpoint;
                    targetSetpoint -= step) {

                    // Note: Comfort setpoint should NOT limit increase operations - always move toward desired setpoint

                    // For mode change from fan_only, calculate full consumption at target setpoint
                    const tempDiff = Math.abs(roomTemp - targetSetpoint);
                    const temperaturePower = tempDiff * this.opts.consumptionPerDegree;
                    const targetConsumption = Math.min(this.opts.compressorStartupMinConsumption + temperaturePower, this.opts.maxCompressorConsumption);
                    const delta = targetConsumption - this.currentConsumption;

                    if (delta > 0 && delta !== lastDelta) { // Only include if it actually increases consumption and is not duplicate
                        increments.push({
                            delta,
                            modeChange: desiredMode,
                            targetSetpoint,
                        });
                        lastDelta = delta;
                    }
                }
            }
        } else if (currentMode === desiredMode) {
            // Same mode - generate setpoint increments toward desired setpoint
            const step = this.opts.setpointStep;
            let lastDelta: number | undefined;

            if (desiredMode === "heat") {
                for (let targetSetpoint = currentSetpoint + step;
                    targetSetpoint <= desiredSetpoint && targetSetpoint <= this.opts.maxSetpoint;
                    targetSetpoint += step) {

                    // Note: Comfort setpoint should NOT limit increase operations - always move toward desired setpoint

                    // For running devices, calculate consumption delta based on setpoint change
                    const setpointDelta = Math.abs(targetSetpoint - currentSetpoint);
                    const deltaConsumption = setpointDelta * this.opts.consumptionPerDegree;
                    const projectedConsumption = this.currentConsumption + deltaConsumption;

                    // Clamp to maximum consumption and recalculate delta
                    const clampedConsumption = Math.min(projectedConsumption, this.opts.maxCompressorConsumption);
                    const delta = clampedConsumption - this.currentConsumption;

                    if (delta > 0 && delta !== lastDelta) { // Only include if it actually increases consumption and is not duplicate
                        increments.push({
                            delta,
                            targetSetpoint,
                        });
                        lastDelta = delta;
                    }
                }
            } else {
                for (let targetSetpoint = currentSetpoint - step;
                    targetSetpoint >= desiredSetpoint && targetSetpoint >= this.opts.minSetpoint;
                    targetSetpoint -= step) {

                    // Note: Comfort setpoint should NOT limit increase operations - always move toward desired setpoint

                    // For running devices, calculate consumption delta based on setpoint change
                    const setpointDelta = Math.abs(targetSetpoint - currentSetpoint);
                    const deltaConsumption = setpointDelta * this.opts.consumptionPerDegree;
                    const projectedConsumption = this.currentConsumption + deltaConsumption;

                    // Clamp to maximum consumption and recalculate delta
                    const clampedConsumption = Math.min(projectedConsumption, this.opts.maxCompressorConsumption);
                    const delta = clampedConsumption - this.currentConsumption;

                    if (delta > 0 && delta !== lastDelta) { // Only include if it actually increases consumption and is not duplicate
                        increments.push({
                            delta,
                            targetSetpoint,
                        });
                        lastDelta = delta;
                    }
                }
            }
        }

        return increments;
    }

    /**
     * Calculate available power consumption decreases.
     * 
     * Returns array of ClimateIncrement objects representing ways to decrease device consumption:
     * - Setpoint adjustments away from user desired setpoint (limited by comfort setpoint if specified)
     * - Mode changes to fan-only (only when no comfort setpoint specified)
     * - All decreases respect comfort boundaries and minimum consumption floors
     * 
     * Power calculation factors in:
     * - Current actual consumption as baseline
     * - Mode-specific minimum consumption limits
     * - Temperature differential reductions from setpoint changes
     */
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
        const step = this.opts.setpointStep;
        let lastDelta: number | undefined;

        if (desiredMode === "heat") {
            // For heating, move setpoint lower (less aggressive heating)
            const lowerBound = (this.hassControls.enableComfortSetpoint && this.hassControls.comfortSetpoint !== undefined)
                ? this.hassControls.comfortSetpoint
                : this.opts.minSetpoint;

            for (let targetSetpoint = currentSetpoint - step;
                targetSetpoint >= lowerBound && targetSetpoint >= this.opts.minSetpoint;
                targetSetpoint -= step) {

                // Calculate consumption reduction (negative delta)
                const setpointDelta = Math.abs(targetSetpoint - currentSetpoint);
                const consumptionReduction = setpointDelta * this.opts.consumptionPerDegree;

                // Clamp reduction to not go below minimum consumption
                const maxReduction = currentConsumption - this.opts.heatCoolMinConsumption;
                const clampedReduction = Math.min(consumptionReduction, maxReduction);
                const delta = -clampedReduction; // Negative for decrease increments

                if (clampedReduction > 0 && delta !== lastDelta) { // Only include if it actually decreases consumption and is not duplicate
                    increments.push({
                        delta,
                        targetSetpoint,
                    });
                    lastDelta = delta;
                }
            }
        } else if (desiredMode === "cool") {
            // For cooling, move setpoint higher (less aggressive cooling)
            const upperBound = (this.hassControls.enableComfortSetpoint && this.hassControls.comfortSetpoint !== undefined)
                ? this.hassControls.comfortSetpoint
                : this.opts.maxSetpoint;

            for (let targetSetpoint = currentSetpoint + step;
                targetSetpoint <= upperBound && targetSetpoint <= this.opts.maxSetpoint;
                targetSetpoint += step) {

                // Calculate consumption reduction (negative delta)
                const setpointDelta = Math.abs(targetSetpoint - currentSetpoint);
                const consumptionReduction = setpointDelta * this.opts.consumptionPerDegree;

                // Clamp reduction to not go below minimum consumption
                const maxReduction = currentConsumption - this.opts.heatCoolMinConsumption;
                const clampedReduction = Math.min(consumptionReduction, maxReduction);
                const delta = -clampedReduction; // Negative for decrease increments

                if (clampedReduction > 0 && delta !== lastDelta) { // Only include if it actually decreases consumption and is not duplicate
                    increments.push({
                        delta,
                        targetSetpoint,
                    });
                    lastDelta = delta;
                }
            }
        }

        // Handle mode transitions to fan-only (only when no comfort setpoint specified)
        if ((currentMode === "heat" || currentMode === "cool") && !this.hassControls.enableComfortSetpoint) {
            const fanOnlyReduction = currentConsumption - this.opts.fanOnlyMinConsumption;
            if (fanOnlyReduction > 0) {
                increments.push({
                    delta: -fanOnlyReduction, // Negative for decrease increments
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

    /**
     * Record state change and set appropriate debounce period.
     * 
     * Different operation types have different debounce periods:
     * - Setpoint changes: 2+ minutes (allow HVAC system to respond)
     * - Mode changes: 5+ minutes (compressor/heat pump cycling)
     * - Startup: 5+ minutes (system ramp-up time)
     */
    private recordStateChange(operationType: "setpoint" | "mode" | "startup"): void {
        const now = Date.now();

        // Set appropriate debounce period based on operation type
        switch (operationType) {
            case "setpoint":
                this.unlockedTime = now + this.opts.setpointDebounceMs;
                break;
            case "mode":
                this.unlockedTime = now + this.opts.modeDebounceMs;
                break;
            case "startup":
                this.unlockedTime = now + this.opts.startupDebounceMs;
                break;
        }
    }

    /**
     * Start timeout for automatic device shutdown from fan-only mode.
     * 
     * After the configured timeout period, device automatically turns off to prevent
     * unnecessary fan consumption. This implements the progression:
     * heat/cool → fan-only → automatic off
     */
    private startFanOnlyTimeout(): void {
        // Clear any existing timeout
        this.clearFanOnlyTimeout();

        // Start new timeout for automatic off transition
        this.fanOnlyTimeoutTimer = setTimeout(() => {
            this.climateEntityRef.turnOff();
            this.fanOnlyTimeoutTimer = null;

            // Reset state machine to idle after auto-off
            this.consumptionTransitionStateMachine.transitionTo(
                ConsumptionTransitionState.IDLE,
            );
        }, this.opts.fanOnlyTimeoutMs);
    }

    private clearFanOnlyTimeout(): void {
        if (this.fanOnlyTimeoutTimer) {
            clearTimeout(this.fanOnlyTimeoutTimer);
            this.fanOnlyTimeoutTimer = null;
        }
    }

    increaseConsumptionBy(increment: ClimateIncrement): void {
        // Check for debounce - return silently if in debounce period
        if (this.changeState?.type === "debounce") {
            return;
        }

        DeviceHelper.validateIncreaseConsumptionBy(this, increment);

        // Execute encoded actions based on increment properties
        if (increment.modeChange && this.climateEntityRef.state === "off") {
            // Startup from off state: Set initial mode and setpoint
            if (increment.targetSetpoint !== undefined) {
                this.climateEntityRef.setTemperature({
                    temperature: increment.targetSetpoint,
                    hvac_mode: increment.modeChange,
                });
            } else {
                this.climateEntityRef.setHvacMode(increment.modeChange);
            }
            this.recordStateChange("startup");
            this.consumptionTransitionStateMachine.transitionTo(
                ConsumptionTransitionState.INCREASE_PENDING,
            );
        } else if (increment.modeChange) {
            // Mode change (e.g., fan_only to heat/cool)
            if (increment.targetSetpoint !== undefined) {
                this.climateEntityRef.setTemperature({
                    temperature: increment.targetSetpoint,
                    hvac_mode: increment.modeChange,
                });
            } else {
                this.climateEntityRef.setHvacMode(increment.modeChange);
            }

            // Clear fan-only timeout when transitioning away from fan-only mode
            this.clearFanOnlyTimeout();

            this.recordStateChange("mode");
            this.consumptionTransitionStateMachine.transitionTo(
                ConsumptionTransitionState.INCREASE_PENDING,
            );
        } else if (increment.targetSetpoint !== undefined) {
            // Absolute setpoint change
            this.climateEntityRef.setTemperature({
                temperature: increment.targetSetpoint,
            });
            this.recordStateChange("setpoint");
            this.consumptionTransitionStateMachine.transitionTo(
                ConsumptionTransitionState.INCREASE_PENDING,
            );
        }
    }

    decreaseConsumptionBy(increment: ClimateIncrement): void {
        // Check for debounce - return silently if in debounce period
        if (this.changeState?.type === "debounce") {
            return;
        }

        DeviceHelper.validateDecreaseConsumptionBy(this, increment);

        // Execute decrease actions (setpoint adjustments, fan-only mode)
        if (increment.modeChange === "fan_only") {
            // Mode change to fan-only
            this.climateEntityRef.setHvacMode("fan_only");

            // Start fan-only timeout for automatic off transition
            this.startFanOnlyTimeout();

            this.recordStateChange("mode");
            this.consumptionTransitionStateMachine.transitionTo(
                ConsumptionTransitionState.DECREASE_PENDING,
            );
        } else if (increment.targetSetpoint !== undefined) {
            // Absolute setpoint change
            this.climateEntityRef.setTemperature({
                temperature: increment.targetSetpoint,
            });
            this.recordStateChange("setpoint");
            this.consumptionTransitionStateMachine.transitionTo(
                ConsumptionTransitionState.DECREASE_PENDING,
            );
        }
    }

    stop(): void {
        // Turn off device immediately
        this.climateEntityRef.turnOff();

        // Clear any pending fan-only timeout
        this.clearFanOnlyTimeout();

        // Reset state machine to idle
        this.consumptionTransitionStateMachine.transitionTo(
            ConsumptionTransitionState.IDLE,
        );

        // Reset debounce state
        this.unlockedTime = 0;
    }
}

export class ClimateHassControls implements IClimateHassControls {
    // Following some crude hacks to resolve type-checking stack issues...
    // private readonly desiredSetpointEntity: ReturnType<TServiceParams["synapse"]["number"]>;
    private readonly desiredSetpointEntity: { native_value: number };
    // private readonly desiredModeEntity: ReturnType<TServiceParams["synapse"]["select"]>;
    private readonly desiredModeEntity: { current_option: string };
    // private readonly comfortSetpointEntity: ReturnType<TServiceParams["synapse"]["number"]>;
    private readonly comfortSetpointEntity: { native_value: number };
    // private readonly comfortSetpointEntity: ReturnType<TServiceParams["synapse"]["number"]>;
    private readonly enableComfortSetpointEntity: { is_on: boolean };

    constructor(
        name: string,
        synapse: TServiceParams["synapse"],
        context: TServiceParams["context"],
        private readonly baseControls: BaseHassControls,
    ) {
        this.desiredSetpointEntity = synapse
            .number({
                context,
                device_id: baseControls.subDevice,
                name: "Desired Setpoint",
                unique_id: "daytime_load_" + toSnakeCase(name) + "_desired_setpoint",
                suggested_object_id: "daytime_load_" + toSnakeCase(name) + "_desired_setpoint",
                step: 1,
                native_min_value: 16,
                native_max_value: 30,
                mode: 'slider',
                icon: "mdi:thermostat",
            })

        this.desiredModeEntity = synapse
            .select({
                context,
                device_id: baseControls.subDevice,
                name: "Desired Mode",
                unique_id: "daytime_load_" + toSnakeCase(name) + "_desired_mode",
                suggested_object_id: "daytime_load_" + toSnakeCase(name) + "_desired_mode",
                options: ["heat", "cool", "off"],
                icon: "mdi:hvac",
            })

        this.comfortSetpointEntity = synapse
            .number({
                context,
                device_id: baseControls.subDevice,
                name: "Comfort Setpoint",
                unique_id: "daytime_load_" + toSnakeCase(name) + "_comfort_setpoint",
                suggested_object_id: "daytime_load_" + toSnakeCase(name) + "_comfort_setpoint",
                step: 1,
                native_min_value: 16,
                native_max_value: 30,
                mode: 'slider',
                icon: "mdi:home-thermometer",
            })

        this.enableComfortSetpointEntity = synapse
            .switch({
                context,
                device_id: baseControls.subDevice,
                name: "Enable Comfort Setpoint",
                unique_id: "daytime_load_" + toSnakeCase(name) + "_enable_comfort_setpoint",
                suggested_object_id: "daytime_load_" + toSnakeCase(name) + "_enable_comfort_setpoint",
                icon: "mdi:thermometer",
            })
    }

    get desiredSetpoint(): number {
        return this.desiredSetpointEntity.native_value;
    }

    get desiredMode(): "heat" | "cool" | "off" {
        switch (this.desiredModeEntity.current_option) {
            case "heat":
                return "heat";
            case "cool":
                return "cool";
            case "off":
                return "off";
            default:
                throw new Error(
                    "Invalid desired mode: " + this.desiredModeEntity.current_option,
                );
        }
    }

    get enableComfortSetpoint(): boolean {
        return this.enableComfortSetpointEntity.is_on;
    }

    get comfortSetpoint(): number | undefined {
        const state = this.comfortSetpointEntity.native_value;
        return state !== undefined && state !== null ? state : undefined;
    }

    get managementEnabled(): boolean {
        return this.baseControls.managementEnabled;
    }
}
