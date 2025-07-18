export enum DeviceTransitionState {
    IDLE = "IDLE",
    INCREASE_PENDING = "INCREASE_PENDING", 
    DECREASE_PENDING = "DECREASE_PENDING",
    DEBOUNCE = "DEBOUNCE"
}

export type DeviceTransitionStateInfo = 
    | { state: DeviceTransitionState.IDLE }
    | { state: DeviceTransitionState.DEBOUNCE }
    | { state: DeviceTransitionState.INCREASE_PENDING; expectedFutureConsumption: number }
    | { state: DeviceTransitionState.DECREASE_PENDING; expectedFutureConsumption: number };

export type DeviceTransitionSpec = 
    | { state: DeviceTransitionState.IDLE; transitionAfter: number }
    | { state: DeviceTransitionState.DEBOUNCE; transitionAfter: number }
    | { state: DeviceTransitionState.INCREASE_PENDING; expectedFutureConsumption: number; transitionAfter: number }
    | { state: DeviceTransitionState.DECREASE_PENDING; expectedFutureConsumption: number; transitionAfter: number };

export class DeviceTransitionStateMachine {
    private currentState: DeviceTransitionStateInfo = { state: DeviceTransitionState.IDLE };
    private transitionTimer?: NodeJS.Timeout;
    private transitionQueue: DeviceTransitionSpec[] = [];

    private static readonly VALID_TRANSITIONS: Map<DeviceTransitionState, DeviceTransitionState[]> = new Map([
        [DeviceTransitionState.IDLE, [DeviceTransitionState.INCREASE_PENDING, DeviceTransitionState.DECREASE_PENDING, DeviceTransitionState.IDLE]],
        [DeviceTransitionState.INCREASE_PENDING, [DeviceTransitionState.DEBOUNCE, DeviceTransitionState.IDLE]],
        [DeviceTransitionState.DECREASE_PENDING, [DeviceTransitionState.DEBOUNCE, DeviceTransitionState.IDLE]],
        [DeviceTransitionState.DEBOUNCE, [DeviceTransitionState.IDLE]]
    ]);

    get state(): DeviceTransitionStateInfo {
        return this.currentState;
    }

    /**
     * Transition to a new state.
     * Clears any pending transition queue to prevent unexpected future transitions.
     */
    transitionToState(newStateInfo: DeviceTransitionStateInfo): void {
        this.validateTransition(this.currentState.state, newStateInfo.state);
        
        // Clear any existing timer and queue
        this.clearTransitionTimer();
        this.transitionQueue = [];
        
        // Update state
        this.currentState = newStateInfo;
    }

    /**
     * Convenience method for simple pending state transitions.
     * 
     * Example: transitionToPending(DeviceTransitionState.INCREASE_PENDING, 500, 2000, 15000)
     * Results in: IDLE -> INCREASE_PENDING (wait 2000ms) -> DEBOUNCE (wait 15000ms) -> IDLE
     */
    transitionToPending(
        pendingState: DeviceTransitionState.INCREASE_PENDING | DeviceTransitionState.DECREASE_PENDING,
        expectedFutureConsumption: number,
        pendingDurationMs: number,
        debounceDurationMs: number
    ): void {
        this.transitionTo([
            { state: pendingState, expectedFutureConsumption, transitionAfter: pendingDurationMs },
            { state: DeviceTransitionState.DEBOUNCE, transitionAfter: debounceDurationMs }
        ]);
    }

    /**
     * Queue a series of state transitions with timing.
     * Each transition specifies the full state info and transition duration.
     * 
     * Example: transitionTo([
     *   {state: INCREASE_PENDING, expectedFutureConsumption: 500, transitionAfter: 2000},
     *   {state: DEBOUNCE, transitionAfter: 15000}
     * ])
     * Results in: IDLE -> INCREASE_PENDING (wait 2000ms) -> DEBOUNCE (wait 15000ms) -> IDLE
     */
    transitionTo(transitions: DeviceTransitionSpec[]): void {
        if (transitions.length === 0) {
            return;
        }

        // Clear any existing timer and queue, reset to IDLE to allow any transition
        this.clearTransitionTimer();
        this.transitionQueue = [];
        this.currentState = { state: DeviceTransitionState.IDLE };

        // Start with the first transition
        const firstTransition = transitions[0];
        const firstStateInfo = this.specToStateInfo(firstTransition);
        this.transitionToState(firstStateInfo);

        // Queue remaining transitions
        if (transitions.length > 1) {
            this.transitionQueue = transitions.slice(1);
            this.scheduleNextTransition(firstTransition.transitionAfter);
        } else {
            // Single transition - schedule return to IDLE
            this.scheduleReturnToIdle(firstTransition.transitionAfter);
        }
    }

    /**
     * Reset the state machine to IDLE and clear all timers.
     */
    reset(): void {
        this.clearTransitionTimer();
        this.transitionQueue = [];
        this.currentState = { state: DeviceTransitionState.IDLE };
    }

    private specToStateInfo(spec: DeviceTransitionSpec): DeviceTransitionStateInfo {
        switch (spec.state) {
            case DeviceTransitionState.IDLE:
                return { state: DeviceTransitionState.IDLE };
            case DeviceTransitionState.DEBOUNCE:
                return { state: DeviceTransitionState.DEBOUNCE };
            case DeviceTransitionState.INCREASE_PENDING:
                return { state: DeviceTransitionState.INCREASE_PENDING, expectedFutureConsumption: spec.expectedFutureConsumption };
            case DeviceTransitionState.DECREASE_PENDING:
                return { state: DeviceTransitionState.DECREASE_PENDING, expectedFutureConsumption: spec.expectedFutureConsumption };
        }
    }

    private validateTransition(fromState: DeviceTransitionState, toState: DeviceTransitionState): void {
        const allowedTransitions = DeviceTransitionStateMachine.VALID_TRANSITIONS.get(fromState);
        if (!allowedTransitions || !allowedTransitions.includes(toState)) {
            throw new Error(`Invalid transition from ${fromState} to ${toState}`);
        }
    }

    private scheduleNextTransition(durationMs: number): void {
        this.transitionTimer = setTimeout(() => {
            if (this.transitionQueue.length > 0) {
                const nextTransition = this.transitionQueue.shift()!;
                const nextStateInfo = this.specToStateInfo(nextTransition);
                this.transitionToState(nextStateInfo);
                
                if (this.transitionQueue.length > 0) {
                    this.scheduleNextTransition(nextTransition.transitionAfter);
                } else {
                    this.scheduleReturnToIdle(nextTransition.transitionAfter);
                }
            }
        }, durationMs);
    }

    private scheduleReturnToIdle(durationMs: number): void {
        this.transitionTimer = setTimeout(() => {
            this.transitionToState({ state: DeviceTransitionState.IDLE });
        }, durationMs);
    }

    private clearTransitionTimer(): void {
        if (this.transitionTimer) {
            clearTimeout(this.transitionTimer);
            this.transitionTimer = undefined;
        }
    }
}
