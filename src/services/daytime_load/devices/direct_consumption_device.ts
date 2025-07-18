import {
    DeviceTransitionState,
    DeviceTransitionStateMachine,
} from "./device_transition_state_machine";
import { unwrapNumericState } from "../states_helpers";
import { DeviceHelper, IBaseDevice } from "./base_device";
import { INumberEntityWrapper } from "../../../entities/number_entity_wrapper";
import { ISensorEntityWrapper } from "../../../entities/sensor_entity_wrapper";
import { IBooleanEntityWrapper } from "../../../entities/boolean_entity_wrapper";
import { IBinarySensorEntityWrapper } from "../../../entities/binary_sensor_entity_wrapper";
import { IBaseHassControls } from "./base_controls";

export interface DirectConsumptionDeviceOptions {
    // Current Configuration
    startingMinCurrent: number;     // Minimum current required to "turn on" (first increment)
    maxCurrent: number;             // Maximum allowed current (safeguard)
    currentStep: number;            // Current increment steps (e.g., 0.5A, 1A)

    // Timing Configuration
    changeTransitionMs: number;     // Time to stay in PENDING state after on/off/change
    debounceMs: number;             // Time between current changes (debounce period)

    // Stopping Configuration
    stoppingThreshold: number;      // When on, if current below this for stoppingTimeoutMs, turn off
    stoppingTimeoutMs: number;      // Timeout before auto-stop when below threshold
}

export interface DirectConsumptionIncrement {
    delta: number;                  // Power consumption change (in Watts)
    targetCurrent?: number;         // Target current to set (in Amps)
    action?: "enable";              // Enable the device (disable is automatic)
}

export class DirectConsumptionDevice implements IBaseDevice<DirectConsumptionIncrement, DirectConsumptionIncrement> {
    private readonly deviceTransitionStateMachine: DeviceTransitionStateMachine =
        new DeviceTransitionStateMachine();
    private stoppingTimeoutTimer: NodeJS.Timeout | null = null;

    constructor(
        readonly name: string,
        readonly priority: number,
        private readonly currentEntityRef: INumberEntityWrapper,
        private readonly consumptionEntityRef: ISensorEntityWrapper,
        private readonly voltageEntityRef: ISensorEntityWrapper,
        private readonly enableEntityRef: IBooleanEntityWrapper,
        private readonly canEnableEntityRef: IBinarySensorEntityWrapper,
        public readonly baseControls: IBaseHassControls,
        private readonly opts: DirectConsumptionDeviceOptions,
    ) {
        // Start monitoring for auto-stop condition
        this.startStoppingThresholdMonitoring();
    }

    /**
     * Calculate available power consumption increases.
     * 
     * Returns array of DirectConsumptionIncrement objects representing ways to increase consumption:
     * - When device is disabled: Enable device with startingMinCurrent
     * - When device is enabled: Increase current in steps up to maxCurrent
     * 
     * Power calculation: current (A) × voltage (V) = power (W)
     */
    get increaseIncrements(): DirectConsumptionIncrement[] {
        const increments: DirectConsumptionIncrement[] = [];
        const currentVoltage = this.getCurrentVoltage();
        const currentCurrent = this.currentEntityRef.state;

        if (!this.baseControls.managementEnabled) {
            return [];
        }

        // Handle device-disabled case (startup)
        if (this.enableEntityRef.state === "off") {
            // Check if device is allowed to be enabled
            if (this.canEnableEntityRef.state === "off") {
                return []; // Device cannot be enabled, return no increments
            }
            // Generate increments for all possible current levels from startingMinCurrent to maxCurrent
            const step = this.opts.currentStep;
            const currentTheoreticalPower = 0; // Device is off, so baseline is 0

            for (let targetCurrent = this.opts.startingMinCurrent;
                targetCurrent <= this.opts.maxCurrent;
                targetCurrent += step) {

                const targetPower = targetCurrent * currentVoltage;
                const delta = targetPower - currentTheoreticalPower;

                if (delta > 0) {
                    increments.push({
                        delta,
                        action: "enable",
                        targetCurrent,
                    });
                }
            }
            return increments;
        }

        // Device is enabled - calculate current increases
        const step = this.opts.currentStep;

        // Check if device consumption is significantly below current setting
        // This prevents offering more increments when the device clearly has unused capacity
        const actualConsumption = this.currentConsumption;
        const theoreticalCurrentFromConsumption = actualConsumption / currentVoltage;
        const consumptionGap = currentCurrent - theoreticalCurrentFromConsumption;

        // If consumption is 2 or more increments below current setting, don't offer more increments
        // Example: Current=4A, Consumption=240W(1A) → Gap=3A >= 2 increments → No more increments
        // This indicates the device has unused capacity and should utilize current setting first
        if (consumptionGap >= (2 * step)) {
            return increments; // Return empty array
        }

        for (let targetCurrent = currentCurrent + step;
            targetCurrent <= this.opts.maxCurrent;
            targetCurrent += step) {

            // Calculate power delta based on theoretical power change
            const targetPower = targetCurrent * currentVoltage;
            const currentTheoreticalPower = currentCurrent * currentVoltage;
            const delta = targetPower - currentTheoreticalPower;

            if (delta > 0) {
                increments.push({
                    delta,
                    targetCurrent,
                });
            }
        }

        return increments;
    }

    /**
     * Calculate available power consumption decreases.
     * 
     * Returns array of DirectConsumptionIncrement objects representing ways to decrease consumption:
     * - Map current consumption to equivalent current value
     * - Generate decreases from that mapped current downward to entity minimum
     * - Calculate deltas from actual consumption, not theoretical entity power
     */
    get decreaseIncrements(): DirectConsumptionIncrement[] {
        const increments: DirectConsumptionIncrement[] = [];
        const currentVoltage = this.getCurrentVoltage();
        const actualConsumption = this.currentConsumption;

        if (!this.baseControls.managementEnabled) {
            return [];
        }

        // Handle device-disabled case - no decreases possible
        if (this.enableEntityRef.state !== "on") {
            return [];
        }

        // Device is enabled - calculate current decreases based on actual consumption
        const step = this.opts.currentStep;

        // Map current consumption to equivalent current value
        const consumptionEquivalentCurrent = actualConsumption / currentVoltage;

        // Round down to nearest step to get the highest target current we can decrease from
        const startingCurrent = Math.floor(consumptionEquivalentCurrent / step) * step;

        // Generate decrements down to minimum allowed by number entity
        const minCurrent = this.currentEntityRef.attributes.min ?? 0;
        for (let targetCurrent = startingCurrent - step;
            targetCurrent >= minCurrent;
            targetCurrent -= step) {

            // Calculate power delta from actual consumption (negative for decrease)
            const targetPower = targetCurrent * currentVoltage;
            const delta = targetPower - actualConsumption; // This will be negative

            if (delta < 0) {
                increments.push({
                    delta,
                    targetCurrent,
                });
            }
        }

        // Note: Disable action is handled automatically by stopping threshold monitoring
        // when current stays below stoppingThreshold for stoppingTimeoutMs

        return increments;
    }

    get currentConsumption(): number {
        // Always return actual consumption from sensor, not theoretical current × voltage
        // This handles cases where consumption lags behind current setting or device
        // consumes less than maximum (e.g., trickle charging phase)
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

    private getCurrentVoltage(): number {
        return unwrapNumericState(this.voltageEntityRef.state) || 240; // Default 240V if unavailable
    }



    /**
     * Start monitoring for automatic stopping when current falls below threshold.
     * This runs continuously when the device is enabled to implement auto-stop behavior.
     */
    private startStoppingThresholdMonitoring(): void {
        // Clear any existing timeout
        this.clearStoppingTimeout();

        // Check current level and start timeout if below threshold
        const currentCurrent = this.currentEntityRef.state;
        const isEnabled = this.enableEntityRef.state === "on";

        if (isEnabled && currentCurrent < this.opts.stoppingThreshold) {
            this.stoppingTimeoutTimer = setTimeout(() => {
                // Double-check conditions before auto-stopping
                const stillEnabled = this.enableEntityRef.state === "on";
                const stillBelowThreshold = this.currentEntityRef.state < this.opts.stoppingThreshold;

                if (stillEnabled && stillBelowThreshold) {
                    this.enableEntityRef.turn_off();

                    // Reset state machine to idle after auto-stop
                    this.deviceTransitionStateMachine.transitionToState({ state: DeviceTransitionState.IDLE });
                }

                this.stoppingTimeoutTimer = null;
            }, this.opts.stoppingTimeoutMs);
        }
    }

    private clearStoppingTimeout(): void {
        if (this.stoppingTimeoutTimer) {
            clearTimeout(this.stoppingTimeoutTimer);
            this.stoppingTimeoutTimer = null;
        }
    }

    increaseConsumptionBy(increment: DirectConsumptionIncrement): void {
        DeviceHelper.validateIncreaseConsumptionBy(this, increment);

        // Execute encoded actions based on increment properties
        if (increment.action === "enable") {
            // Check if device is allowed to be enabled
            if (this.canEnableEntityRef.state === "off") {
                return; // Device cannot be enabled, exit silently
            }

            // Enable device and set starting current
            this.enableEntityRef.turn_on();
            if (increment.targetCurrent !== undefined) {
                this.currentEntityRef.setValue(increment.targetCurrent);
            }

            // Clear stopping timeout when enabling
            this.clearStoppingTimeout();

            this.deviceTransitionStateMachine.transitionToPending(
                DeviceTransitionState.INCREASE_PENDING,
                this.currentConsumption + increment.delta,
                this.opts.changeTransitionMs,
                this.opts.debounceMs
            );
        } else if (increment.targetCurrent !== undefined) {
            if (this.enableEntityRef.state !== "on") {
                return;
            }
            
            // Adjust current level
            this.currentEntityRef.setValue(increment.targetCurrent);

            // Restart stopping threshold monitoring
            this.startStoppingThresholdMonitoring();

            this.deviceTransitionStateMachine.transitionToPending(
                DeviceTransitionState.INCREASE_PENDING,
                this.currentConsumption + increment.delta,
                this.opts.changeTransitionMs,
                this.opts.debounceMs
            );
        }
    }

    decreaseConsumptionBy(increment: DirectConsumptionIncrement): void {
        DeviceHelper.validateDecreaseConsumptionBy(this, increment);

        // Only allow decrease operations when device is enabled
        if (this.enableEntityRef.state !== "on") {
            return;
        }

        // Execute decrease actions (only targetCurrent adjustments)
        if (increment.targetCurrent !== undefined) {
            // Adjust current level
            this.currentEntityRef.setValue(increment.targetCurrent);

            // Restart stopping threshold monitoring
            this.startStoppingThresholdMonitoring();

            this.deviceTransitionStateMachine.transitionToPending(
                DeviceTransitionState.DECREASE_PENDING,
                this.currentConsumption + increment.delta,
                this.opts.changeTransitionMs,
                this.opts.debounceMs
            );
        }
    }

    stop(): void {
        // Disable device immediately
        this.enableEntityRef.turn_off();

        // Set current to 0
        this.currentEntityRef.setValue(0);

        // Clear any pending stopping timeout
        this.clearStoppingTimeout();

        // Reset state machine to idle
        this.deviceTransitionStateMachine.reset();
    }
}
