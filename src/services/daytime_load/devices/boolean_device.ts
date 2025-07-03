import { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";
import {
  ConsumptionTransitionState,
  ConsumptionTransitionStateMachine,
} from "./consumption_transition_state_machine";
import { unwrapNumericState } from "../states_helpers";
import { DeviceHelper, IBaseDevice } from "./base_device";

export class BooleanDevice implements IBaseDevice {
  private readonly consumptionTransitionStateMachine: ConsumptionTransitionStateMachine =
    new ConsumptionTransitionStateMachine();

  constructor(
    private readonly entityRef: ByIdProxy<
      PICK_ENTITY<"switch" | "light" | "fan">
    >,
    private readonly consumptionEntityRef: ByIdProxy<PICK_ENTITY<"sensor">>,
    private readonly expectedConsumption: number, // Expected power consumption in watts
    public readonly name: string,
    public readonly priority: number,
  ) {
  }

  get minIncreaseCapacity(): number {
    if (this.entityRef.state === "on") {
      return 0;
    }
    return (
      unwrapNumericState(this.consumptionEntityRef.state) ||
      this.expectedConsumption
    );
  }
  get maxIncreaseCapacity(): number {
    if (this.entityRef.state === "on") {
      return 0;
    }
    return (
      unwrapNumericState(this.consumptionEntityRef.state) ||
      this.expectedConsumption
    );
  }
  get minDecreaseCapacity(): number {
    if (this.entityRef.state === "off") {
      return 0;
    }
    return (
      unwrapNumericState(this.consumptionEntityRef.state) ||
      this.expectedConsumption
    );
  }
  get maxDecreaseCapacity(): number {
    if (this.entityRef.state === "off") {
      return 0;
    }
    return (
      unwrapNumericState(this.consumptionEntityRef.state) ||
      this.expectedConsumption
    );
  }
  get currentConsumption(): number {
    return unwrapNumericState(this.consumptionEntityRef.state) || 0;
  }

  get expectedFutureConsumption(): number {
    if (
      this.consumptionTransitionStateMachine.state ===
      ConsumptionTransitionState.INCREASE_PENDING
    ) {
      return this.expectedConsumption;
    } else if (
      this.consumptionTransitionStateMachine.state ===
      ConsumptionTransitionState.DECREASE_PENDING
    ) {
      return 0;
    }
    throw new Error(
      "Cannot get expectedFutureConsumption with no pending change",
    );
  }

  increaseConsumptionBy(amount: number): void {
    DeviceHelper.validateIncreaseConsumptionBy(this, amount);

    if (amount > 0 && this.entityRef.state === "off") {
      this.entityRef.turn_on();
      if (
        this.consumptionTransitionStateMachine.transitionTo(
          ConsumptionTransitionState.INCREASE_PENDING,
        )
      ) {
        setTimeout(() => {
          this.consumptionTransitionStateMachine.transitionTo(
            ConsumptionTransitionState.IDLE,
          );
        }, 1000);
      }
    }
  }

  decreaseConsumptionBy(amount: number): void {
    DeviceHelper.validateDecreaseConsumptionBy(this, amount);

    if (amount > 0 && this.entityRef.state === "on") {
      this.entityRef.turn_off();
      if (
        this.consumptionTransitionStateMachine.transitionTo(
          ConsumptionTransitionState.DECREASE_PENDING,
        )
      ) {
        setTimeout(() => {
          this.consumptionTransitionStateMachine.transitionTo(
            ConsumptionTransitionState.IDLE,
          );
        }, 1000);
      }
    }
  }

  get hasChangePending(): "increase" | "decrease" | undefined {
    if (
      this.consumptionTransitionStateMachine.state ===
      ConsumptionTransitionState.INCREASE_PENDING
    ) {
      return "increase";
    } else if (
      this.consumptionTransitionStateMachine.state ===
      ConsumptionTransitionState.DECREASE_PENDING
    ) {
      return "decrease";
    }
    return undefined;
  }

  stop(): void {
    this.entityRef.turn_off();
    this.consumptionTransitionStateMachine.transitionTo(
      ConsumptionTransitionState.IDLE,
    );
  }
}
