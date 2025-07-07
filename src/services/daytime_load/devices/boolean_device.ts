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
  private unlockedTime: number = 0;

  constructor(
    private readonly entityRef: ByIdProxy<
      PICK_ENTITY<"switch" | "light" | "fan">
    >,
    private readonly consumptionEntityRef: ByIdProxy<PICK_ENTITY<"sensor">>,
    private readonly expectedConsumption: number, // Expected power consumption in watts
    public readonly name: string,
    public readonly priority: number,
    private readonly offToOnDebounceMs: number,
    private readonly onToOffDebounceMs: number,
  ) {
  }

  get minIncreaseCapacity(): number {
    if (this.entityRef.state === "on") {
      // When already on, we can't increase consumption
      return 0;
    }
    return (
      unwrapNumericState(this.consumptionEntityRef.state) ||
      this.expectedConsumption
    );
  }
  get maxIncreaseCapacity(): number {
    if (this.entityRef.state === "on") {
      // When already on, we can't increase consumption
      return 0;
    }
    return (
      unwrapNumericState(this.consumptionEntityRef.state) ||
      this.expectedConsumption
    );
  }
  get minDecreaseCapacity(): number {
    if (this.entityRef.state === "off") {
      // When already off, we can't decrease consumption
      return 0;
    }
    return (
      unwrapNumericState(this.consumptionEntityRef.state) ||
      this.expectedConsumption
    );
  }
  get maxDecreaseCapacity(): number {
    if (this.entityRef.state === "off") {
      // When already off, we can't decrease consumption
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

  canChangeConsumption(): boolean {
    return Date.now() >= this.unlockedTime;
  }

  private recordStateChange(newState: "on" | "off"): void {
    const now = Date.now();
    if (newState === "on") {
      // After turning on, unlock after onToOffDebounceMs
      this.unlockedTime = now + this.onToOffDebounceMs;
    } else {
      // After turning off, unlock after offToOnDebounceMs
      this.unlockedTime = now + this.offToOnDebounceMs;
    }
  }

  increaseConsumptionBy(amount: number): void {
    DeviceHelper.validateIncreaseConsumptionBy(this, amount);

    if (amount > 0 && this.entityRef.state === "off") {
      if (!this.canChangeConsumption()) {
        return;
      }

      this.entityRef.turn_on();
      this.recordStateChange("on");
      
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
      if (!this.canChangeConsumption()) {
        return;
      }

      this.entityRef.turn_off();
      this.recordStateChange("off");
      
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
    this.recordStateChange("off");
    this.consumptionTransitionStateMachine.transitionTo(
      ConsumptionTransitionState.IDLE,
    );
  }
}
