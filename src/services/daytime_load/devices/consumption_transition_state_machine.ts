export enum ConsumptionTransitionState {
  IDLE = "idle",
  INCREASE_PENDING = "increase_pending",
  DECREASE_PENDING = "decrease_pending",
}

type ConsumptionStateTransition = {
  from: ConsumptionTransitionState;
  to: ConsumptionTransitionState;
};

export class ConsumptionTransitionStateMachine {
  private readonly validTransitions: ConsumptionStateTransition[] = [
    {
      from: ConsumptionTransitionState.IDLE,
      to: ConsumptionTransitionState.INCREASE_PENDING,
    },
    {
      from: ConsumptionTransitionState.IDLE,
      to: ConsumptionTransitionState.DECREASE_PENDING,
    },
    {
      from: ConsumptionTransitionState.DECREASE_PENDING,
      to: ConsumptionTransitionState.IDLE,
    },
    {
      from: ConsumptionTransitionState.INCREASE_PENDING,
      to: ConsumptionTransitionState.IDLE,
    },
  ];

  private currentState: ConsumptionTransitionState;

  constructor() {
    this.currentState = ConsumptionTransitionState.IDLE;
  }

  get state(): ConsumptionTransitionState {
    return this.currentState;
  }

  transitionTo(
    newState: ConsumptionTransitionState,
    onTransition?: (
      from: ConsumptionTransitionState,
      to: ConsumptionTransitionState,
    ) => void,
  ): boolean {
    const isValidTransition = this.validTransitions.some(
      (transition) =>
        transition.from === this.currentState && transition.to === newState,
    );

    if (!isValidTransition) {
      return false;
    }

    const previousState = this.currentState;
    this.currentState = newState;
    onTransition?.(previousState, newState);
    return true;
  }

  canTransitionTo(newState: ConsumptionTransitionState): boolean {
    return this.validTransitions.some(
      (transition) =>
        transition.from === this.currentState && transition.to === newState,
    );
  }
}
