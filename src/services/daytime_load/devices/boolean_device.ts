import {
  DeviceTransitionState,
  DeviceTransitionStateMachine,
} from "./device_transition_state_machine";
import { unwrapNumericState } from "../states_helpers";
import { DeviceHelper, IBaseDevice } from "./base_device";
import { IBooleanEntityWrapper } from "../../../entities/boolean_entity_wrapper";
import { ISensorEntityWrapper } from "../../../entities/sensor_entity_wrapper";
import { IBaseHassControls } from "./base_controls";

export interface BooleanDeviceOptions {
  expectedConsumption: number;  // Expected power consumption in watts
  changeTransitionMs: number;   // Time to stay in PENDING state after on/off changes
  turnOffDebounce: number;      // Debounce time after turning off before allowing turn on
  turnOnDebounce: number;       // Debounce time after turning on before allowing turn off
}

interface BooleanIncreaseIncrement {
  delta: number;     // Power consumption change in watts
  action: "turn_on"; // Encapsulated desired action
}

interface BooleanDecreaseIncrement {
  delta: number;     // Power consumption change in watts
  action: "turn_off"; // Encapsulated desired action
}

export class BooleanDevice implements IBaseDevice<BooleanIncreaseIncrement, BooleanDecreaseIncrement> {
  private readonly deviceTransitionStateMachine: DeviceTransitionStateMachine = new DeviceTransitionStateMachine();

  constructor(
    public readonly name: string,
    public readonly priority: number,
    private readonly entityRef: IBooleanEntityWrapper,
    private readonly consumptionEntityRef: ISensorEntityWrapper,
    public readonly baseControls: IBaseHassControls,
    private readonly opts: BooleanDeviceOptions,
  ) {
  }

  get increaseIncrements(): BooleanIncreaseIncrement[] {
    if (this.entityRef.state === "on") {
      // When already on, we can't increase consumption
      return [];
    }
    // For off device, use expectedConsumption (don't rely on sensor when off)
    return [{ 
      delta: this.opts.expectedConsumption, 
      action: "turn_on" 
    }];
  }

  get decreaseIncrements(): BooleanDecreaseIncrement[] {
    if (this.entityRef.state === "off") {
      // When already off, we can't decrease consumption
      return [];
    }
    // For on device, use actual consumption from sensor, fallback to expected
    const consumption = unwrapNumericState(this.consumptionEntityRef.state) || this.opts.expectedConsumption;
    return [{ 
      delta: -consumption, 
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

    switch (this.deviceTransitionStateMachine.state.state) {
      case DeviceTransitionState.INCREASE_PENDING:
        return {
          type: "increase",
          expectedFutureConsumption: this.deviceTransitionStateMachine.state.expectedFutureConsumption
        };
      
      case DeviceTransitionState.DECREASE_PENDING:
        return {
          type: "decrease",
          expectedFutureConsumption: this.deviceTransitionStateMachine.state.expectedFutureConsumption
        };
      
      case DeviceTransitionState.DEBOUNCE:
        return { type: "debounce" };
      
      case DeviceTransitionState.IDLE:
      default:
        return undefined;
    }
  }

  increaseConsumptionBy(increment: BooleanIncreaseIncrement): void {
    DeviceHelper.validateIncreaseConsumptionBy(this, increment);

    if (increment.action === "turn_on" && this.entityRef.state === "off") {
      // Action is already encoded - just execute it
      this.entityRef.turn_on();
      
      this.deviceTransitionStateMachine.transitionToPending(
        DeviceTransitionState.INCREASE_PENDING,
        this.currentConsumption + increment.delta,
        this.opts.changeTransitionMs,
        this.opts.turnOnDebounce
      );
    }
  }

  decreaseConsumptionBy(increment: BooleanDecreaseIncrement): void {
    DeviceHelper.validateDecreaseConsumptionBy(this, increment);

    if (increment.action === "turn_off" && this.entityRef.state === "on") {
      this.entityRef.turn_off();
      
      this.deviceTransitionStateMachine.transitionToPending(
        DeviceTransitionState.DECREASE_PENDING,
        this.currentConsumption + increment.delta,
        this.opts.changeTransitionMs,
        this.opts.turnOffDebounce
      );
    }
  }

  stop(): void {
    this.entityRef.turn_off();
    this.deviceTransitionStateMachine.reset();
  }
}
