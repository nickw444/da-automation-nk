import {
  ConsumptionTransitionState,
  ConsumptionTransitionStateMachine,
} from "./consumption_transition_state_machine";
import { unwrapNumericState } from "../states_helpers";
import { DeviceHelper, IBaseDevice } from "./base_device";
import { IHumidifierEntityWrapper } from "../../../entities/humidifier_entity_wrapper";
import { ISensorEntityWrapper } from "../../../entities/sensor_entity_wrapper";
import { TServiceParams } from "@digital-alchemy/core";
import { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";
import { toSnakeCase } from "../../../base/snake_case";

export interface HumidifierDeviceOptions {
  deviceType: "humidifier" | "dehumidifier";  // Device operation type
  operationalConsumption: number;             // Power consumption when actively running in watts
  fanOnlyConsumption: number;                 // Power consumption in fan-only mode in watts
  humidityStep: number;                       // Humidity percentage step size (e.g., 5, 10)
  setpointDebounceMs: number;                // Debounce time between setpoint changes
  modeDebounceMs: number;                    // Debounce time between mode changes
  fanOnlyTimeoutMs: number;                  // Time before auto-off from fan-only mode
}

// User control interface for HumidifierDevice
export interface IHumidifierControls {
  desiredSetpoint: number;        // User's target humidity percentage
  comfortSetpoint?: number;       // Optional comfort boundary humidity (limits decrease operations only)
}

export interface HumidifierIncrement {
  delta: number;              // Power consumption change in watts
  targetHumidity?: number;    // Target humidity percentage
  modeChange?: string;        // Mode change operation
}

export class HumidifierDevice implements IBaseDevice<HumidifierIncrement, HumidifierIncrement> {
  private readonly consumptionTransitionStateMachine: ConsumptionTransitionStateMachine =
    new ConsumptionTransitionStateMachine();
  private unlockedTime: number = 0;
  private fanOnlyTimeoutTimer: NodeJS.Timeout | null = null;

  constructor(
    public readonly name: string,
    public readonly priority: number,
    private readonly entityRef: IHumidifierEntityWrapper,
    private readonly consumptionEntityRef: ISensorEntityWrapper,
    private readonly roomHumidityEntityRef: ISensorEntityWrapper,
    private readonly humidifierControls: IHumidifierControls,
    private readonly opts: HumidifierDeviceOptions,
  ) {
  }

  get increaseIncrements(): HumidifierIncrement[] {
    if (this.entityRef.state === "off") {
      // When off, turning on will consume operational power (device starts working immediately)
      return [{
        delta: this.opts.operationalConsumption,
        modeChange: "normal" // Most humidifiers have "normal" as default mode
      }];
    }

    const currentSetpoint = this.entityRef.attributes.humidity; // This is the target humidity setpoint
    const roomHumidity = unwrapNumericState(this.roomHumidityEntityRef.state);
    const increments: HumidifierIncrement[] = [];

    // If room humidity is unavailable, cannot make decisions
    if (roomHumidity === undefined) {
      return [];
    }

    // Calculate setpoint changes that increase consumption
    const step = this.opts.humidityStep;
    const minHumidity = this.entityRef.attributes.min_humidity;
    const maxHumidity = this.entityRef.attributes.max_humidity;

    if (this.opts.deviceType === "humidifier") {
      // For humidifier: when room humidity < setpoint, device runs
      // To increase consumption, move setpoint toward desired setpoint
      for (let target = currentSetpoint + step; 
           target <= this.humidifierControls.desiredSetpoint && target <= maxHumidity; 
           target += step) {
        // Calculate expected consumption at this setpoint
        const expectedConsumption = target > roomHumidity ? this.opts.operationalConsumption : this.opts.fanOnlyConsumption;
        const delta = expectedConsumption - this.currentConsumption;
        
        if (delta > 0) {
          increments.push({
            delta,
            targetHumidity: target,
          });
          break; // Only provide one increment
        }
      }
    } else {
      // For dehumidifier: when room humidity > setpoint, device runs
      // To increase consumption, move setpoint toward desired setpoint
      for (let target = currentSetpoint - step; 
           target >= this.humidifierControls.desiredSetpoint && target >= minHumidity; 
           target -= step) {
        // Calculate expected consumption at this setpoint
        const expectedConsumption = target < roomHumidity ? this.opts.operationalConsumption : this.opts.fanOnlyConsumption;
        const delta = expectedConsumption - this.currentConsumption;
        
        if (delta > 0) {
          increments.push({
            delta,
            targetHumidity: target,
          });
          break; // Only provide one increment
        }
      }
    }

    return increments;
  }

  get decreaseIncrements(): HumidifierIncrement[] {
    if (this.entityRef.state === "off") {
      return []; // Cannot decrease when already off
    }

    const currentSetpoint = this.entityRef.attributes.humidity; // This is the target humidity setpoint
    const roomHumidity = unwrapNumericState(this.roomHumidityEntityRef.state);
    const increments: HumidifierIncrement[] = [];

    // If room humidity is unavailable, cannot make decisions
    if (roomHumidity === undefined) {
      return [];
    }

    // Calculate setpoint changes that decrease consumption
    const step = this.opts.humidityStep;
    const minHumidity = this.entityRef.attributes.min_humidity;
    const maxHumidity = this.entityRef.attributes.max_humidity;

    if (this.opts.deviceType === "humidifier") {
      // For humidifier: when room humidity < setpoint, device runs
      // To decrease consumption, move setpoint away from desired setpoint (limited by comfort setpoint)
      const lowerBound = this.humidifierControls.comfortSetpoint !== undefined 
        ? this.humidifierControls.comfortSetpoint 
        : minHumidity;
      
      for (let target = currentSetpoint - step; 
           target >= lowerBound && target >= minHumidity; 
           target -= step) {
        // Calculate expected consumption at this setpoint
        const expectedConsumption = target > roomHumidity ? this.opts.operationalConsumption : this.opts.fanOnlyConsumption;
        const delta = expectedConsumption - this.currentConsumption;
        
        if (delta < 0) {
          increments.push({
            delta,
            targetHumidity: target,
          });
          break; // Only provide one decrement
        }
      }
    } else {
      // For dehumidifier: when room humidity > setpoint, device runs
      // To decrease consumption, move setpoint away from desired setpoint (limited by comfort setpoint)
      const upperBound = this.humidifierControls.comfortSetpoint !== undefined
        ? this.humidifierControls.comfortSetpoint
        : maxHumidity;
      
      for (let target = currentSetpoint + step; 
           target <= upperBound && target <= maxHumidity; 
           target += step) {
        // Calculate expected consumption at this setpoint
        const expectedConsumption = target < roomHumidity ? this.opts.operationalConsumption : this.opts.fanOnlyConsumption;
        const delta = expectedConsumption - this.currentConsumption;
        
        if (delta < 0) {
          increments.push({
            delta,
            targetHumidity: target,
          });
          break; // Only provide one decrement
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
    
    // Check for pending state transitions
    if (
      this.consumptionTransitionStateMachine.state ===
      ConsumptionTransitionState.INCREASE_PENDING
    ) {
      return { type: "increase", expectedFutureConsumption: this.opts.operationalConsumption };
    } else if (
      this.consumptionTransitionStateMachine.state ===
      ConsumptionTransitionState.DECREASE_PENDING
    ) {
      return { type: "decrease", expectedFutureConsumption: this.opts.fanOnlyConsumption };
    }
    
    // Check for debounce period
    if (Date.now() < this.unlockedTime) {
      return { type: "debounce" };
    }
    
    return undefined;
  }

  private recordStateChange(operationType: "setpoint" | "mode"): void {
    const now = Date.now();
    
    switch (operationType) {
      case "setpoint":
        this.unlockedTime = now + this.opts.setpointDebounceMs;
        break;
      case "mode":
        this.unlockedTime = now + this.opts.modeDebounceMs;
        break;
    }
  }

  private startFanOnlyTimeout(): void {
    // Clear any existing timeout
    this.clearFanOnlyTimeout();
    
    // Start new timeout for automatic off transition
    this.fanOnlyTimeoutTimer = setTimeout(() => {
      this.entityRef.turnOff();
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

  increaseConsumptionBy(increment: HumidifierIncrement): void {
    // Check for debounce
    if (this.changeState?.type === "debounce") {
      return;
    }

    DeviceHelper.validateIncreaseConsumptionBy(this, increment);

    if (increment.modeChange && this.entityRef.state === "off") {
      // Turn on with the specified mode
      this.entityRef.turnOn();
      if (increment.modeChange !== "normal") {
        this.entityRef.setMode(increment.modeChange);
      }
      this.recordStateChange("mode");
    } else if (increment.targetHumidity !== undefined) {
      // Set target humidity
      this.entityRef.setHumidity(increment.targetHumidity);
      this.recordStateChange("setpoint");
      
      // Check if this setpoint change would result in fan-only mode
      const roomHumidity = unwrapNumericState(this.roomHumidityEntityRef.state);
      if (roomHumidity !== undefined) {
        const wouldBeFanOnly = this.opts.deviceType === "humidifier" 
          ? increment.targetHumidity <= roomHumidity
          : increment.targetHumidity >= roomHumidity;
        
        if (wouldBeFanOnly) {
          this.startFanOnlyTimeout();
        }
      }
    }

    // Transition to pending state
    this.consumptionTransitionStateMachine.transitionTo(
      ConsumptionTransitionState.INCREASE_PENDING,
    );
    
    // Auto-transition back to idle after timeout
    setTimeout(() => {
      this.consumptionTransitionStateMachine.transitionTo(
        ConsumptionTransitionState.IDLE,
      );
    }, 1000);
  }

  decreaseConsumptionBy(increment: HumidifierIncrement): void {
    // Check for debounce
    if (this.changeState?.type === "debounce") {
      return;
    }

    DeviceHelper.validateDecreaseConsumptionBy(this, increment);

    if (increment.targetHumidity !== undefined) {
      // Set target humidity
      this.entityRef.setHumidity(increment.targetHumidity);
      this.recordStateChange("setpoint");
      
      // Check if this setpoint change would result in fan-only mode
      const roomHumidity = unwrapNumericState(this.roomHumidityEntityRef.state);
      if (roomHumidity !== undefined) {
        const wouldBeFanOnly = this.opts.deviceType === "humidifier" 
          ? increment.targetHumidity <= roomHumidity
          : increment.targetHumidity >= roomHumidity;
        
        if (wouldBeFanOnly) {
          this.startFanOnlyTimeout();
        }
      }
    }

    // Transition to pending state
    this.consumptionTransitionStateMachine.transitionTo(
      ConsumptionTransitionState.DECREASE_PENDING,
    );
    
    // Auto-transition back to idle after timeout
    setTimeout(() => {
      this.consumptionTransitionStateMachine.transitionTo(
        ConsumptionTransitionState.IDLE,
      );
    }, 1000);
  }

  stop(): void {
    this.entityRef.turnOff();
    
    // Clear any pending fan-only timeout
    this.clearFanOnlyTimeout();
    
    this.consumptionTransitionStateMachine.transitionTo(
      ConsumptionTransitionState.IDLE,
    );
    this.unlockedTime = 0;
  }
}

export class HumidifierControls implements IHumidifierControls {
  private readonly desiredSetpointEntity: ByIdProxy<PICK_ENTITY<"number">>;
  private readonly comfortSetpointEntity: ByIdProxy<PICK_ENTITY<"number">>;

  constructor(
    name: string,
    synapse: TServiceParams["synapse"],
    context: TServiceParams["context"],
  ) {
    const subDevice = synapse.device.register("daytime_load_" + toSnakeCase(name), {
      name: "Daytime Load " + name,
    });

    this.desiredSetpointEntity = synapse
      .number({
        context,
        device_id: subDevice,
        name: "Desired Setpoint",
        unique_id: "daytime_load_" + toSnakeCase(name) + "_desired_setpoint",
        suggested_object_id: "daytime_load_" + toSnakeCase(name) + "_desired_setpoint",
        step: 1,
        native_min_value: 0,
        native_max_value: 100,
        mode: 'slider',
      })
      .getEntity() as ByIdProxy<PICK_ENTITY<"number">>;

    this.comfortSetpointEntity = synapse
      .number({
        context,
        device_id: subDevice,
        name: "Comfort Setpoint",
        unique_id: "daytime_load_" + toSnakeCase(name) + "_comfort_setpoint",
        suggested_object_id: "daytime_load_" + toSnakeCase(name) + "_comfort_setpoint",
        step: 1,
        native_min_value: 0,
        native_max_value: 100,
        mode: 'slider',
      })
      .getEntity() as ByIdProxy<PICK_ENTITY<"number">>;
  }

  get desiredSetpoint(): number {
    return this.desiredSetpointEntity.state;
  }

  get comfortSetpoint(): number | undefined {
    const state = this.comfortSetpointEntity.state;
    return state !== undefined && state !== null ? state : undefined;
  }
}
