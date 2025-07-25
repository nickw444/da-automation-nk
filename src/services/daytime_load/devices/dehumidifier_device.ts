import {
    DeviceTransitionState,
    DeviceTransitionStateMachine,
} from "./device_transition_state_machine";
import { unwrapNumericState } from "../states_helpers";
import { DeviceHelper, IBaseDevice } from "./base_device";
import { IHumidifierEntityWrapper } from "../../../entities/humidifier_entity_wrapper";
import { ISensorEntityWrapper } from "../../../entities/sensor_entity_wrapper";
import { TServiceParams } from "@digital-alchemy/core";
import { toSnakeCase } from "../../../base/snake_case";
import { BaseHassControls, IBaseHassControls } from "./base_controls";

export interface DehumidifierDeviceOptions {
    // Humidity Constraints
    minSetpoint: number;            // Minimum humidity setpoint (e.g., 30%)
    maxSetpoint: number;            // Maximum humidity setpoint (e.g., 80%)
    setpointStep: number;           // Humidity increment step (e.g., 5%)

    // Power Configuration
    expectedDehumidifyingConsumption: number;  // Expected consumption when actively dehumidifying
    expectedFanOnlyConsumption: number;        // Expected consumption in fan-only mode

    // Timing Configuration
    fanOnlyTimeoutMs: number;            // Time before auto-off from fan-only mode (e.g., 30-60 minutes)
    setpointChangeTransitionMs: number;  // Time to stay in PENDING state after setpoint change (e.g., 30-60 seconds for consumption to stabilize)
    setpointDebounceMs: number;          // Time to wait before new changes allowed after setpoint change (e.g., 2-5 minutes)
}

// User control interface for DehumidifierDevice
export interface IDehumidifierHassControls extends IBaseHassControls {
    desiredSetpoint: number;        // User's target humidity percentage
    enableComfortSetpoint: boolean;
    comfortSetpoint?: number;       // Optional comfort boundary humidity (limits decrease operations only)
}

/**
 * DehumidifierIncrement represents a possible device action for increasing or decreasing consumption.
 * 
 * Dehumidifiers operate on bang-bang logic - when current humidity > setpoint, they dehumidify actively.
 * When humidity reaches setpoint, they switch to fan-only mode.
 * 
 * To increase consumption: Lower setpoint (below current humidity to trigger dehumidifying)
 * To decrease consumption: Raise setpoint (above current humidity to stay in fan-only mode)
 */
export interface DehumidifierIncrement {
    delta: number;                  // Power consumption change (in Watts)
    targetSetpoint?: number;        // Absolute target humidity setpoint (percentage)
}

export class DehumidifierDevice implements IBaseDevice<DehumidifierIncrement, DehumidifierIncrement> {
    private readonly deviceTransitionStateMachine: DeviceTransitionStateMachine = new DeviceTransitionStateMachine();
    private fanOnlyTimeoutTimer: NodeJS.Timeout | null = null;
    
    constructor(
        readonly name: string,
        readonly priority: number,
        private readonly logger: TServiceParams['logger'],
        private readonly humidifierEntityRef: IHumidifierEntityWrapper,
        private readonly consumptionEntityRef: ISensorEntityWrapper,
        private readonly currentHumidityEntityRef: ISensorEntityWrapper,
        private readonly hassControls: IDehumidifierHassControls,
        private readonly opts: DehumidifierDeviceOptions,
    ) {
        // Monitor consumption to detect fan-only mode and start timeout
        this.consumptionEntityRef.onUpdate((newState) => {
            if (this.isInFanOnlyMode() && !this.hassControls.enableComfortSetpoint) {
                this.startFanOnlyTimeout();
            } else {
                this.clearFanOnlyTimeout();
            }
        });

        // Monitor humidity changes
        this.currentHumidityEntityRef.onUpdate((newState) => {
            this.logger.debug(`${this.name}: Humidity changed to ${newState.state}%`);
        });
    }

    get baseControls(): IBaseHassControls {
        return this.hassControls;
    }

    /**
     * Calculate available power consumption increases.
     * 
     * Returns array of DehumidifierIncrement objects representing ways to increase device consumption:
     * - When device is off: Returns startup increment with initial setpoint below current humidity
     * - When device is on: Returns setpoint adjustments to trigger more aggressive dehumidifying
     * - Always moves toward more aggressive dehumidifying (ignores comfort setpoint)
     */
    get increaseIncrements(): DehumidifierIncrement[] {
        const currentHumidity = this.getCurrentHumidity();
        const desiredSetpoint = this.hassControls.desiredSetpoint;
        const increments: DehumidifierIncrement[] = [];

        if (currentHumidity === undefined) {
            this.logger.warn(`${this.name} increaseIncrements: current humidity unavailable, no increments available`);
            return [];
        }

        // Handle device-off case (startup)
        if (this.humidifierEntityRef.state === "off") {
            this.logger.info(`${this.name} increaseIncrements: device is off, calculating startup increment`);
            
            // Only offer startup if current humidity is above desired setpoint (dehumidifying needed)
            if (currentHumidity > desiredSetpoint) {
                // Calculate initial setpoint at desired setpoint (or limited by constraints)
                let initialSetpoint = desiredSetpoint;
                
                // Apply absolute limits
                initialSetpoint = Math.max(this.opts.minSetpoint, Math.min(this.opts.maxSetpoint, initialSetpoint));
                
                const startupPower = this.opts.expectedDehumidifyingConsumption;
                
                this.logger.info(`${this.name} increaseIncrements: • startup power: ${startupPower}W, target setpoint: ${initialSetpoint}%`);
                
                increments.push({
                    delta: startupPower,
                    targetSetpoint: initialSetpoint,
                });
            }
            
            return increments;
        }

        // Device is on - calculate setpoint adjustments toward more aggressive dehumidifying
        const currentSetpoint = this.humidifierEntityRef.attributes.humidity;
        const step = this.opts.setpointStep;

        // Generate setpoint decreases (lower setpoint = more aggressive dehumidifying)
        for (let targetSetpoint = currentSetpoint - step;
             targetSetpoint >= desiredSetpoint && targetSetpoint >= this.opts.minSetpoint;
             targetSetpoint -= step) {

            // Only include if it would increase dehumidifying activity
            if (targetSetpoint < currentHumidity) {
                // Calculate consumption increase if moving from fan-only to dehumidifying
                let delta = 0;
                if (this.isInFanOnlyMode()) {
                    delta = this.opts.expectedDehumidifyingConsumption - this.currentConsumption;
                } else {
                    // Already dehumidifying, minimal change expected
                    delta = 0;
                }

                if (delta > 0) {
                    increments.push({
                        delta,
                        targetSetpoint,
                    });
                }
            }
        }

        return increments;
    }

    /**
     * Calculate available power consumption decreases.
     * 
     * Returns array of DehumidifierIncrement objects representing ways to decrease device consumption:
     * - Setpoint adjustments away from aggressive dehumidifying (limited by comfort setpoint if specified)
     * - All decreases respect comfort boundaries and move toward fan-only operation
     */
    get decreaseIncrements(): DehumidifierIncrement[] {
        const currentHumidity = this.getCurrentHumidity();
        const desiredSetpoint = this.hassControls.desiredSetpoint;
        const increments: DehumidifierIncrement[] = [];

        if (currentHumidity === undefined) {
            this.logger.warn(`${this.name} decreaseIncrements: current humidity unavailable, no decrements available`);
            return [];
        }

        // Handle device-off case - no decreases possible
        if (this.humidifierEntityRef.state === "off") {
            this.logger.info(`${this.name} decreaseIncrements: device is off, no decreases possible`);
            return [];
        }

        // Device is on - calculate setpoint increases to reduce dehumidifying activity
        const currentSetpoint = this.humidifierEntityRef.attributes.humidity;
        const step = this.opts.setpointStep;

        // Determine upper bound based on comfort setpoint
        const upperBound = (this.hassControls.enableComfortSetpoint && this.hassControls.comfortSetpoint !== undefined)
            ? this.hassControls.comfortSetpoint
            : this.opts.maxSetpoint;

        // Generate setpoint increases (higher setpoint = less aggressive dehumidifying)
        for (let targetSetpoint = currentSetpoint + step;
             targetSetpoint <= Math.max(upperBound, desiredSetpoint) && targetSetpoint <= this.opts.maxSetpoint;
             targetSetpoint += step) {

            // Only provide decrease if it would actually reduce consumption
            if (!this.isInFanOnlyMode()) {
                // Calculate consumption reduction if moving from dehumidifying to fan-only
                let delta = 0;
                if (targetSetpoint >= currentHumidity) {
                    // Would switch to fan-only mode
                    delta = this.opts.expectedFanOnlyConsumption - this.currentConsumption;
                }

                if (delta < 0) { // Negative for decrease increments
                    increments.push({
                        delta,
                        targetSetpoint,
                    });
                }
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

        switch (this.deviceTransitionStateMachine.state.state) {
            case DeviceTransitionState.INCREASE_PENDING:
                return {
                    type: "increase",
                    expectedFutureConsumption: Math.max(
                        this.deviceTransitionStateMachine.state.expectedFutureConsumption,
                        this.currentConsumption,
                    )
                };
            
            case DeviceTransitionState.DECREASE_PENDING:
                return {
                    type: "decrease",
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
     * Detect if device is in fan-only mode by checking consumption level.
     * Returns true if consumption is within range of expected fan-only consumption.
     */
    private isInFanOnlyMode(): boolean {
        const consumption = this.currentConsumption;
        const tolerance = this.opts.expectedFanOnlyConsumption * 0.2; // 20% tolerance
        return Math.abs(consumption - this.opts.expectedFanOnlyConsumption) <= tolerance;
    }

    /**
     * Get current humidity from sensor, handling undefined/unavailable states.
     */
    private getCurrentHumidity(): number | undefined {
        const humidity = unwrapNumericState(this.currentHumidityEntityRef.state);
        return humidity !== undefined ? humidity : undefined;
    }

    /**
     * Start timeout for automatic device shutdown from fan-only mode.
     * 
     * After the configured timeout period, device automatically turns off to prevent
     * unnecessary fan consumption when no comfort setpoint is enabled.
     */
    private startFanOnlyTimeout(): void {
        // Only start timeout if not already running and no comfort setpoint
        if (this.fanOnlyTimeoutTimer || this.hassControls.enableComfortSetpoint) {
            return;
        }

        this.logger.info(`${this.name} startFanOnlyTimeout: starting ${this.opts.fanOnlyTimeoutMs}ms timeout for auto-off`);

        this.fanOnlyTimeoutTimer = setTimeout(() => {
            this.logger.info(`${this.name} startFanOnlyTimeout: fan-only timeout expired, turning off device`);
            this.humidifierEntityRef.turnOff();
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

    increaseConsumptionBy(increment: DehumidifierIncrement): void {
        DeviceHelper.validateIncreaseConsumptionBy(this, increment);

        this.logger.info(`${this.name} increaseConsumptionBy: increasing by ${increment.delta}W`);

        if (this.humidifierEntityRef.state === "off" && increment.targetSetpoint !== undefined) {
            // Startup from off state: Turn on and set initial setpoint
            this.logger.info(`${this.name} increaseConsumptionBy: • startup from off - setpoint: ${increment.targetSetpoint}%`);
            
            this.humidifierEntityRef.turnOn();
            this.humidifierEntityRef.setHumidity(increment.targetSetpoint);

            this.deviceTransitionStateMachine.transitionToPending(
                DeviceTransitionState.INCREASE_PENDING,
                increment.delta, // Expected future consumption
                this.opts.setpointChangeTransitionMs,
                this.opts.setpointDebounceMs
            );
        } else if (increment.targetSetpoint !== undefined) {
            // Setpoint change on running device
            this.logger.info(`${this.name} increaseConsumptionBy: • setpoint change to ${increment.targetSetpoint}%`);
            
            this.humidifierEntityRef.setHumidity(increment.targetSetpoint);

            // Clear fan-only timeout when moving to more aggressive dehumidifying
            this.clearFanOnlyTimeout();

            this.deviceTransitionStateMachine.transitionToPending(
                DeviceTransitionState.INCREASE_PENDING,
                this.currentConsumption + increment.delta,
                this.opts.setpointChangeTransitionMs,
                this.opts.setpointDebounceMs
            );
        }
    }

    decreaseConsumptionBy(increment: DehumidifierIncrement): void {
        DeviceHelper.validateDecreaseConsumptionBy(this, increment);

        this.logger.info(`${this.name} decreaseConsumptionBy: decreasing by ${increment.delta}W`);

        if (increment.targetSetpoint !== undefined) {
            // Setpoint change to reduce consumption
            this.logger.info(`${this.name} decreaseConsumptionBy: • setpoint change to ${increment.targetSetpoint}%`);
            
            this.humidifierEntityRef.setHumidity(increment.targetSetpoint);

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
        this.humidifierEntityRef.turnOff();

        // Clear any pending fan-only timeout
        this.clearFanOnlyTimeout();

        // Reset state machine to idle
        this.deviceTransitionStateMachine.reset();
    }
}

export class DehumidifierHassControls implements IDehumidifierHassControls {
    // Following some crude hacks to resolve type-checking stack issues...
    private readonly desiredSetpointEntity: { native_value: number };
    private readonly comfortSetpointEntity: { native_value: number };
    private readonly enableComfortSetpointEntity: { is_on: boolean };

    constructor(
        name: string,
        synapse: TServiceParams["synapse"],
        context: TServiceParams["context"],
        private readonly baseControls: BaseHassControls,
        private readonly opts: DehumidifierDeviceOptions,
    ) {
        this.desiredSetpointEntity = synapse
            .number({
                context,
                device_id: baseControls.subDevice,
                name: "Desired Setpoint",
                unique_id: "daytime_load_" + toSnakeCase(name) + "_desired_setpoint",
                suggested_object_id: "daytime_load_" + toSnakeCase(name) + "_desired_setpoint",
                step: this.opts.setpointStep,
                native_min_value: this.opts.minSetpoint,
                native_max_value: this.opts.maxSetpoint,
                native_value: 70,
                mode: 'slider',
                icon: "mdi:water-percent",
            })

        this.comfortSetpointEntity = synapse
            .number({
                context,
                device_id: baseControls.subDevice,
                name: "Comfort Setpoint",
                unique_id: "daytime_load_" + toSnakeCase(name) + "_comfort_setpoint",
                suggested_object_id: "daytime_load_" + toSnakeCase(name) + "_comfort_setpoint",
                step: this.opts.setpointStep,
                native_min_value: this.opts.minSetpoint,
                native_max_value: this.opts.maxSetpoint,
                native_value: 80,
                mode: 'slider',
                icon: "mdi:home-thermometer-outline",
            })

        this.enableComfortSetpointEntity = synapse
            .switch({
                context,
                device_id: baseControls.subDevice,
                name: "Enable Comfort Setpoint",
                unique_id: "daytime_load_" + toSnakeCase(name) + "_enable_comfort_setpoint",
                suggested_object_id: "daytime_load_" + toSnakeCase(name) + "_enable_comfort_setpoint",
                icon: "mdi:water-thermometer",
                is_on: false,
            })
    }

    get desiredSetpoint(): number {
        return this.desiredSetpointEntity.native_value;
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
