import {
    DeviceTransitionState,
    DeviceTransitionStateMachine,
} from "./device_transition_state_machine";
import { unwrapNumericState } from "../states_helpers";
import { DeviceHelper, IBaseDevice } from "./base_device";
import { IClimateEntityWrapper } from "../../../entities/climate_entity_wrapper";
import { ISensorEntityWrapper } from "../../../entities/sensor_entity_wrapper";
import { TServiceParams } from "@digital-alchemy/core";
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
    setpointChangeTransitionMs: number;  // Time to stay in PENDING state after setpoint change (e.g. 30-60 seconds for consumption to stabilize)
    setpointDebounceMs: number;          // Time to wait before new changes allowed after setpoint change (e.g. 2-5 minutes)
    modeChangeTransitionMs: number;      // Time to stay in PENDING state after mode change (e.g. 60-120 seconds for consumption to stabilize)
    modeDebounceMs: number;              // Time to wait before new changes allowed after mode change (e.g. 5-10 minutes)
    startupTransitionMs: number;         // Time to stay in PENDING state after startup (e.g. 60-120 seconds for consumption to stabilize)
    startupDebounceMs: number;           // Time to wait before new changes allowed after startup (e.g. 5-10 minutes)
    fanOnlyTimeoutMs: number;            // Time before auto-off from fan-only mode (e.g. 30-60 minutes)
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
    private readonly deviceTransitionStateMachine: DeviceTransitionStateMachine = new DeviceTransitionStateMachine();
    private fanOnlyTimeoutTimer: NodeJS.Timeout | null = null;

    constructor(
        readonly name: string,
        readonly priority: number,
        private readonly logger: TServiceParams['logger'],
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
        const { desiredSetpoint, desiredMode } = this.hassControls;

        // If desired mode is "off", no increase increments are available
        if (desiredMode === "off") {
            this.logger.info(`${this.name} increaseIncrements: desired mode is "off", no increments available`);
            return [];
        }

        const signedPowerOnSetpointOffset = this.opts.powerOnSetpointOffset * (desiredMode === 'heat' ? 1 : -1);
        const signedSetpointStep = this.opts.setpointStep * (desiredMode === 'heat' ? 1 : -1);
        const currentMode = this.climateEntityRef.state;
        const modeChangeRequired = currentMode !== desiredMode || this.climateEntityRef.state === "off";
        const additionalConsumptionRequired = modeChangeRequired || this.currentConsumption < this.opts.heatCoolMinConsumption
            ? this.opts.compressorStartupMinConsumption
            : 0;
        const currentSetpoint = (this.climateEntityRef.state === "off" || currentMode === 'fan_only')
            ? this.climateEntityRef.roomTemperature
            : this.climateEntityRef.targetTemperature;

        if (currentMode === 'heat' && currentSetpoint >= desiredSetpoint
            || currentMode === 'cool' && currentSetpoint <= desiredSetpoint) {
            // When in desired setpoint is reached, then we cannot increase consumption
            return []
        }

        const setpoints = this.climateEntityRef.state === "off"
            ? [desiredMode === 'heat'
                ? Math.min(desiredSetpoint, currentSetpoint + signedPowerOnSetpointOffset)
                : Math.max(desiredSetpoint, currentSetpoint + signedPowerOnSetpointOffset)]
            : range(currentSetpoint + signedSetpointStep, desiredSetpoint, this.opts.setpointStep);

        return setpoints.map(setpoint => {
            const tempDiff = Math.abs(currentSetpoint - setpoint);
            const temperaturePower = tempDiff * this.opts.consumptionPerDegree;
            const targetConsumption = Math.min(additionalConsumptionRequired + temperaturePower + this.currentConsumption, this.opts.maxCompressorConsumption);
            const delta = targetConsumption - this.currentConsumption;

            if (Math.abs(delta) < 10) {
                // Omit increments that are too small
                return undefined;
            }

            return ({
                delta,
                modeChange: modeChangeRequired ? desiredMode : undefined,
                targetSetpoint: setpoint,
            });
        })
            .filter(exists)
            .filter(byUniqueDelta());
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
        const { desiredMode, enableComfortSetpoint, comfortSetpoint } = this.hassControls;

        // Handle device-off case - no decreases possible
        if (this.climateEntityRef.state === "off") {
            this.logger.info(`${this.name} decreaseIncrements: device is off, no decreases possible`);
            return [];
        }

        const currentSetpoint = this.climateEntityRef.targetTemperature;
        const currentMode = this.climateEntityRef.state;
        const currentConsumption = this.currentConsumption;
        const signedSetpointStep = this.opts.setpointStep * (desiredMode === 'heat' ? -1 : 1);

        if (currentMode == 'fan_only'
            || currentMode === 'heat' && comfortSetpoint != null && currentSetpoint <= comfortSetpoint
            || currentMode === 'cool' && comfortSetpoint != null && currentSetpoint >= comfortSetpoint) {
            // When in fan-only or when comfort setpoint is reached, then we cannot decrease 
            // consumption
            return []
        }

        // Calculate setpoint boundary based on mode and comfort settings
        const setpointBound = desiredMode === "heat"
            ? (enableComfortSetpoint && comfortSetpoint !== undefined)
                ? Math.max(comfortSetpoint, this.opts.minSetpoint)
                : this.opts.minSetpoint
            : (enableComfortSetpoint && comfortSetpoint !== undefined)
                ? Math.min(comfortSetpoint, this.opts.maxSetpoint)
                : this.opts.maxSetpoint;

        // Generate setpoint decreases (away from desired setpoint)
        const setpoints = range(currentSetpoint + signedSetpointStep, setpointBound, this.opts.setpointStep);

        const setpointIncrements = setpoints.map(setpoint => {
            const setpointDelta = Math.abs(setpoint - currentSetpoint);
            const consumptionReduction = setpointDelta * this.opts.consumptionPerDegree;
            const maxReduction = currentConsumption - this.opts.heatCoolMinConsumption;
            const clampedReduction = Math.min(consumptionReduction, maxReduction);
            const delta = -clampedReduction; // Negative for decrease increments

            if (clampedReduction <= 0) {
                return undefined;
            }

            return {
                delta,
                targetSetpoint: setpoint,
            };
        })
            .filter(exists)
            .filter(byUniqueDelta());

        // Handle mode transitions to fan-only (only when no comfort setpoint specified)
        const fanOnlyIncrements = [];
        if ((currentMode === "heat" || currentMode === "cool") && !enableComfortSetpoint) {
            const fanOnlyReduction = currentConsumption - this.opts.fanOnlyMinConsumption;
            if (fanOnlyReduction > 0) {
                fanOnlyIncrements.push({
                    delta: -fanOnlyReduction, // Negative for decrease increments
                    modeChange: "fan_only" as const,
                });
            }
        }

        return [...setpointIncrements, ...fanOnlyIncrements];
    }

    get currentConsumption(): number {
        return unwrapNumericState(this.consumptionEntityRef.state) || 0;
    }

    get changeState():
        | { type: "increase" | "decrease", expectedFutureConsumption: number }
        | { type: "debounce" }
        | undefined {

        switch (this.deviceTransitionStateMachine.state.state) {
            case DeviceTransitionState.INCREASE_PENDING:
                return {
                    type: "increase",
                    // During increase, use the maximum of the current consumption and the expected future
                    // consumption, in the case where increase action is already occurred, but timer remains.
                    expectedFutureConsumption: Math.max(
                        this.deviceTransitionStateMachine.state.expectedFutureConsumption,
                        this.currentConsumption,
                    )
                };

            case DeviceTransitionState.DECREASE_PENDING:
                return {
                    type: "decrease",
                    // During decrease, use the minimum of the current consumption and the expected future
                    // consumption, in the case where decrease action is already occurred, but timer remains.
                    expectedFutureConsumption: Math.min(
                        this.deviceTransitionStateMachine.state.expectedFutureConsumption,
                        this.currentConsumption,
                    )
                };

            case DeviceTransitionState.DEBOUNCE:
                return { type: "debounce" };

            case DeviceTransitionState.IDLE:
            default:
                return undefined;
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

        this.logger.info(`${this.name} startFanOnlyTimeout: starting ${this.opts.fanOnlyTimeoutMs}ms timeout for auto-off`);

        // Start new timeout for automatic off transition
        this.fanOnlyTimeoutTimer = setTimeout(() => {
            this.logger.info(`${this.name} startFanOnlyTimeout: fan-only timeout expired, turning off device`);
            this.climateEntityRef.turnOff();
            this.fanOnlyTimeoutTimer = null;

            // Reset state machine to idle after auto-off
            this.deviceTransitionStateMachine.transitionToState({ state: DeviceTransitionState.IDLE });
        }, this.opts.fanOnlyTimeoutMs);
    }

    private clearFanOnlyTimeout(): void {
        if (this.fanOnlyTimeoutTimer) {
            this.logger.info(`${this.name} clearFanOnlyTimeout: clearing fan-only timeout`);
            clearTimeout(this.fanOnlyTimeoutTimer);
            this.fanOnlyTimeoutTimer = null;
        }
    }

    increaseConsumptionBy(increment: ClimateIncrement): void {
        DeviceHelper.validateIncreaseConsumptionBy(this, increment);

        this.logger.info(`${this.name} increaseConsumptionBy: increasing by ${increment.delta}W`);

        // Execute encoded actions based on increment properties
        if (increment.modeChange && this.climateEntityRef.state === "off") {
            // Startup from off state: Set initial mode and setpoint
            this.logger.info(`${this.name} increaseConsumptionBy: • startup from off - mode: ${increment.modeChange}, setpoint: ${increment.targetSetpoint}°C`);

            if (increment.targetSetpoint !== undefined) {
                this.climateEntityRef.setTemperature({
                    temperature: increment.targetSetpoint,
                    hvac_mode: increment.modeChange,
                });
            } else {
                this.climateEntityRef.setHvacMode(increment.modeChange);
            }
            this.deviceTransitionStateMachine.transitionToPending(
                DeviceTransitionState.INCREASE_PENDING,
                increment.delta, // In theory current consumption should be 0, so this is the same as the delta
                this.opts.startupTransitionMs,
                this.opts.startupDebounceMs
            );
        } else if (increment.modeChange) {
            // Mode change (e.g., fan_only to heat/cool)
            this.logger.info(`${this.name} increaseConsumptionBy: • mode change to ${increment.modeChange}, setpoint: ${increment.targetSetpoint}°C`);

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

            this.deviceTransitionStateMachine.transitionToPending(
                DeviceTransitionState.INCREASE_PENDING,
                this.currentConsumption + increment.delta,
                this.opts.modeChangeTransitionMs,
                this.opts.modeDebounceMs
            );
        } else if (increment.targetSetpoint !== undefined) {
            // Absolute setpoint change
            this.logger.info(`${this.name} increaseConsumptionBy: • setpoint change to ${increment.targetSetpoint}°C`);

            this.climateEntityRef.setTemperature({
                temperature: increment.targetSetpoint,
            });

            this.deviceTransitionStateMachine.transitionToPending(
                DeviceTransitionState.INCREASE_PENDING,
                this.currentConsumption + increment.delta,
                this.opts.setpointChangeTransitionMs,
                this.opts.setpointDebounceMs
            );
        }
    }

    decreaseConsumptionBy(increment: ClimateIncrement): void {
        DeviceHelper.validateDecreaseConsumptionBy(this, increment);

        this.logger.info(`${this.name} decreaseConsumptionBy: decreasing by ${increment.delta}W`);

        // Execute decrease actions (setpoint adjustments, fan-only mode)
        if (increment.modeChange === "fan_only") {
            // Mode change to fan-only
            this.logger.info(`${this.name} decreaseConsumptionBy: • mode change to fan_only`);

            this.climateEntityRef.setHvacMode("fan_only");

            // Start fan-only timeout for automatic off transition
            this.startFanOnlyTimeout();

            this.deviceTransitionStateMachine.transitionToPending(
                DeviceTransitionState.DECREASE_PENDING,
                this.currentConsumption + increment.delta,
                this.opts.modeChangeTransitionMs,
                this.opts.modeDebounceMs
            );
        } else if (increment.targetSetpoint !== undefined) {
            // Absolute setpoint change
            this.logger.info(`${this.name} decreaseConsumptionBy: • setpoint change to ${increment.targetSetpoint}°C`);

            this.climateEntityRef.setTemperature({
                temperature: increment.targetSetpoint,
            });

            this.deviceTransitionStateMachine.transitionToPending(
                DeviceTransitionState.DECREASE_PENDING,
                this.currentConsumption + increment.delta,
                this.opts.setpointChangeTransitionMs,
                this.opts.setpointDebounceMs
            );
        }
    }

    stop(): void {
        this.logger.info(`${this.name} stop: stopping device and clearing all timers`);

        // Turn off device immediately
        this.climateEntityRef.turnOff();

        // Clear any pending fan-only timeout
        this.clearFanOnlyTimeout();

        // Reset state machine to idle
        this.deviceTransitionStateMachine.reset();
    }
}

export class ClimateHassControls implements IClimateHassControls {
    // Following some crude hacks to resolve type-checking stack issues...
    // private readonly desiredSetpointEntity: ReturnType<TServiceParams["synapse"]["number"]>;
    private readonly desiredSetpointEntity: { native_value: number };
    // TODO(NW): After https://github.com/Digital-Alchemy-TS/synapse/pull/126
    // private readonly desiredSetpointEntity: SynapseNumber;
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

function clamp(min: number, value: number, max: number): number {
    return Math.max(min, Math.min(value, max));
}

function range(start: number, end: number, step: number): number[] {
    const result = [];
    if (start <= end) {
        for (let i = start; i <= end; i += step) {
            result.push(i);
        }
    } else {
        for (let i = start; i >= end; i -= step) {
            result.push(i);
        }
    }
    return result;
}

function byUniqueDelta() {
    const seenDeltas = new Set<number>();
    return ({ delta }: { delta: number }) => {
        const isSeen = seenDeltas.has(delta);
        seenDeltas.add(delta);
        return !isSeen;
    };
}

function exists<T>(entry: T): entry is NonNullable<T> {
    return entry !== undefined && entry !== null;
}
