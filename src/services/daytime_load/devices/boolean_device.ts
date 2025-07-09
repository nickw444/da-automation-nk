import { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";
import {
  ConsumptionTransitionState,
  ConsumptionTransitionStateMachine,
} from "./consumption_transition_state_machine";
import { unwrapNumericState } from "../states_helpers";
import { DeviceHelper, IBaseDevice } from "./base_device";

interface BooleanIncreaseIncrement {
  delta: number;     // Power consumption change in watts
  action: "turn_on"; // Encapsulated desired action
}

interface BooleanDecreaseIncrement {
  delta: number;     // Power consumption change in watts
  action: "turn_off"; // Encapsulated desired action
}

export class BooleanDevice implements IBaseDevice<BooleanIncreaseIncrement, BooleanDecreaseIncrement> {
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

  get increaseIncrements(): BooleanIncreaseIncrement[] {
    if (this.entityRef.state === "on") {
      // When already on, we can't increase consumption
      return [];
    }
    // For off device, use expectedConsumption (don't rely on sensor when off)
    return [{ 
      delta: this.expectedConsumption, 
      action: "turn_on" 
    }];
  }

  get decreaseIncrements(): BooleanDecreaseIncrement[] {
    if (this.entityRef.state === "off") {
      // When already off, we can't decrease consumption
      return [];
    }
    // For on device, use actual consumption from sensor, fallback to expected
    const consumption = unwrapNumericState(this.consumptionEntityRef.state) || this.expectedConsumption;
    return [{ 
      delta: consumption, 
      action: "turn_off" 
    }];
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
      return { type: "increase", expectedFutureConsumption: this.expectedConsumption };
    } else if (
      this.consumptionTransitionStateMachine.state ===
      ConsumptionTransitionState.DECREASE_PENDING
    ) {
      return { type: "decrease", expectedFutureConsumption: 0 };
    }
    
    // Then check if we're in debounce period (only when no pending change)
    if (Date.now() < this.unlockedTime) {
      return { type: "debounce" };
    }
    
    return undefined;
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

  increaseConsumptionBy(increment: BooleanIncreaseIncrement): void {
    // Check for debounce - return silently if in debounce period
    if (this.changeState?.type === "debounce") {
      return;
    }

    DeviceHelper.validateIncreaseConsumptionBy(this, increment);

    if (increment.action === "turn_on" && this.entityRef.state === "off") {
      // Action is already encoded - just execute it
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

  decreaseConsumptionBy(increment: BooleanDecreaseIncrement): void {
    // Check for debounce - return silently if in debounce period
    if (this.changeState?.type === "debounce") {
      return;
    }

    DeviceHelper.validateDecreaseConsumptionBy(this, increment);

    if (increment.action === "turn_off" && this.entityRef.state === "on") {
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



  stop(): void {
    this.entityRef.turn_off();
    this.recordStateChange("off");
    this.consumptionTransitionStateMachine.transitionTo(
      ConsumptionTransitionState.IDLE,
    );
  }
}
