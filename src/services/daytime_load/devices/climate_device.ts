import { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";
import { DeviceHelper, IBaseDevice } from "./base_device";
import {
  ConsumptionTransitionState,
  ConsumptionTransitionStateMachine,
} from "./consumption_transition_state_machine";
import { unwrapNumericState } from "../states_helpers";
import { TServiceParams } from "@digital-alchemy/core";

/**
 * TODO:
 *  - Manual override (e.g. do not turn off when in override mode.)
 *  - Debounce control logic (e.g. do not cycle too quickly)
 *  - Switch to fan mode for lowest possible consumption, then back to heat/cool.
 *      ^ might not be needed, since consumption is reduced simply by setpoint control.
 *  - Implement stop behaviour
 */

export interface IClimateHassControls {
  desiredSetpoint: number;
  desiredMode: "heat" | "cool";
}

export class ClimateHassControls implements IClimateHassControls {
  private readonly desiredSetpointEntity: ByIdProxy<PICK_ENTITY<"number">>;
  private readonly desiredModeEntity: ByIdProxy<PICK_ENTITY<"select">>;

  constructor(
    name: string,
    synapse: TServiceParams["synapse"],
    context: TServiceParams["context"],
  ) {
    const subDevice = synapse.device.register("daytime_load_" + name, {
      name: "Daytime Load " + name,
    });

    this.desiredSetpointEntity = synapse
      .number({
        context,
        device_id: subDevice,
        name: "Desired Setpoint",
        unique_id: "daytime_load_" + name + "_desired_setpoint",
      })
      .getEntity() as ByIdProxy<PICK_ENTITY<"number">>;

    this.desiredModeEntity = synapse
      .select({
        context,
        device_id: subDevice,
        name: "Desired Mode",
        unique_id: "daytime_load_" + name + "_desired_mode",
        options: ["heat", "cool"],
      })
      .getEntity() as ByIdProxy<PICK_ENTITY<"select">>;
  }

  get desiredSetpoint() {
    return this.desiredSetpointEntity.state;
  }

  get desiredMode() {
    switch (this.desiredModeEntity.state) {
      case "heat":
        return "heat";
      case "cool":
        return "cool";
      default:
        throw new Error(
          "Invalid desired mode: " + this.desiredModeEntity.state,
        );
    }
  }
}

export class ClimateDevice implements IBaseDevice {
  private readonly consumptionTransitionStateMachine: ConsumptionTransitionStateMachine =
    new ConsumptionTransitionStateMachine();
  private _expectedFutureConsumption: number | undefined = undefined;

  constructor(
    // private readonly entityRef: ByIdProxy<PICK_ENTITY<'climate'>>,
    private readonly entityRef: ByIdProxy<PICK_ENTITY<"climate">>,
    private readonly consumptionEntityRef: ByIdProxy<PICK_ENTITY<"sensor">>,
    private readonly fanOnlyExpectedConsumption: number,
    private readonly heatMinExpectedConsumption: number,
    private readonly coolMinExpectedConsumption: number,
    private readonly heatMaxExpectedConsumption: number,
    private readonly coolMaxExpectedConsumption: number,
    public readonly name: string,
    public readonly priority: number,
    private readonly hassControls: IClimateHassControls,
  ) {
  }

  get minIncreaseCapacity(): number {
    switch (this.entityRef.state) {
      case "off":
        return this.hassControls.desiredMode === "heat"
          ? this.heatMinExpectedConsumption
          : this.coolMinExpectedConsumption;
      case "heat":
      case "cool":
        // When the AC is running, then it's always valid to increase the capacity by nothing...
        return 0;
      default:
        throw new Error("Unhandled state: " + this.entityRef.state);
    }
  }

  get maxIncreaseCapacity(): number {
    switch (this.entityRef.state) {
      case "off":
        return this.hassControls.desiredMode === "heat"
          ? this.heatMaxExpectedConsumption
          : this.coolMaxExpectedConsumption;
      case "heat":
        // 300W consump, 200W min, 1000W max -> 700W
        // 200W consump, 200W min, 1000W max -> 800W
        return Math.max(
          this.heatMaxExpectedConsumption - this.currentConsumption,
          0,
        );
      case "cool":
        return Math.max(
          this.coolMaxExpectedConsumption - this.currentConsumption,
          0,
        );
      default:
        throw new Error("Unhandled state: " + this.entityRef.state);
    }
  }

  get minDecreaseCapacity(): number {
    switch (this.entityRef.state) {
      case "off":
        return 0;
      case "heat":
      case "cool":
        // When the AC is running, then it's always valid to decrease the capacity by nothing...
        return 0;
      default:
        throw new Error("Unhandled state: " + this.entityRef.state);
    }
  }

  get maxDecreaseCapacity(): number {
    switch (this.entityRef.state) {
      case "off":
        return 0;
      case "heat":
        // 300W consump, 200W min, 1000W max -> 100W
        // 200W consump, 200W min, 1000W max -> 0W
        return Math.max(
          this.currentConsumption - this.heatMinExpectedConsumption,
          0,
        );
      case "cool":
        return Math.max(
          this.currentConsumption - this.coolMinExpectedConsumption,
          0,
        );
      default:
        throw new Error("Unhandled state: " + this.entityRef.state);
    }
  }

  get currentConsumption(): number {
    return unwrapNumericState(this.consumptionEntityRef.state) || 0;
  }

  get expectedFutureConsumption(): number {
    switch (this.consumptionTransitionStateMachine.state) {
      case ConsumptionTransitionState.INCREASE_PENDING:
        return this._expectedFutureConsumption;
      case ConsumptionTransitionState.DECREASE_PENDING:
        return this._expectedFutureConsumption;
      default:
        throw new Error(
          "Cannot get expectedFutureConsumption with no pending change",
        );
    }
  }

  get hasChangePending(): "increase" | "decrease" | undefined {
    switch (this.consumptionTransitionStateMachine.state) {
      case ConsumptionTransitionState.INCREASE_PENDING:
        return "increase";
      case ConsumptionTransitionState.DECREASE_PENDING:
        return "decrease";
      default:
        return undefined;
    }
  }

  increaseConsumptionBy(amount: number): void {
    DeviceHelper.validateIncreaseConsumptionBy(this, amount);

    if (amount > 0 && this.entityRef.state === "off") {
      if (
        this.consumptionTransitionStateMachine.transitionTo(
          ConsumptionTransitionState.DECREASE_PENDING,
        )
      ) {
        this.entityRef.turn_on();
        this.entityRef.set_temperature({
          hvac_mode: this.hassControls.desiredMode,
          temperature:
            (this.hassControls.desiredSetpoint +
              this.entityRef.attributes.current_temperature) /
            2,
        });
        setTimeout(() => {
          this.consumptionTransitionStateMachine.transitionTo(
            ConsumptionTransitionState.IDLE,
          );
        }, 120000);
        return;
      }
    }

    if (this.entityRef.state !== "heat" && this.entityRef.state !== "cool") {
      return;
    }

    // TODO(NW): handle case where user changes mode...
    const newSetpoint = calculateSetpointForTargetConsumption(
      this.currentConsumption + amount,
      this.entityRef.state,
      this.entityRef.attributes.current_temperature,
      this.entityRef.attributes.temperature,
      this.currentConsumption,
      this.coolMinExpectedConsumption,
      this.coolMaxExpectedConsumption,
      this.heatMinExpectedConsumption,
      this.heatMaxExpectedConsumption,
      this.hassControls.desiredSetpoint,
    );

    if (newSetpoint == this.entityRef.attributes.temperature) {
      return;
    }

    if (
      this.consumptionTransitionStateMachine.transitionTo(
        ConsumptionTransitionState.DECREASE_PENDING,
      )
    ) {
      this._expectedFutureConsumption = this.currentConsumption + amount;
      this.entityRef.set_temperature({
        hvac_mode: this.hassControls.desiredMode,
        temperature: newSetpoint,
      });
      setTimeout(() => {
        this.consumptionTransitionStateMachine.transitionTo(
          ConsumptionTransitionState.IDLE,
        );
      }, 60000);
    }
  }

  decreaseConsumptionBy(amount: number): void {
    DeviceHelper.validateDecreaseConsumptionBy(this, amount);

    if (amount >= this.currentConsumption && this.entityRef.state !== "off") {
      this.entityRef.turn_off();
    }

    if (this.entityRef.state !== "heat" && this.entityRef.state !== "cool") {
      return;
    }

    // TODO(NW): handle case where user changes mode...
    const newSetpoint = calculateSetpointForTargetConsumption(
      this.currentConsumption - amount,
      this.entityRef.state,
      this.entityRef.attributes.current_temperature,
      this.entityRef.attributes.temperature,
      this.currentConsumption,
      this.coolMinExpectedConsumption,
      this.coolMaxExpectedConsumption,
      this.heatMinExpectedConsumption,
      this.heatMaxExpectedConsumption,
      this.hassControls.desiredSetpoint,
    );

    if (newSetpoint == this.entityRef.attributes.temperature) {
      return;
    }

    if (
      this.consumptionTransitionStateMachine.transitionTo(
        ConsumptionTransitionState.DECREASE_PENDING,
      )
    ) {
      this._expectedFutureConsumption = this.currentConsumption - amount;
      this.entityRef.set_temperature({
        hvac_mode: this.hassControls.desiredMode,
        temperature: newSetpoint,
      });
      setTimeout(() => {
        this.consumptionTransitionStateMachine.transitionTo(
          ConsumptionTransitionState.IDLE,
        );
      }, 60000);
    }
  }

  stop(): void {
    throw new Error("Method not implemented.");
  }
}

export function calculateSetpointForTargetConsumption(
  targetConsumption: number,
  mode: "heat" | "cool",
  currentRoomTemp: number,
  currentSetpoint: number,
  currentConsumption: number,
  coolMinExpectedConsumption: number,
  coolMaxExpectedConsumption: number,
  heatMinExpectedConsumption: number,
  heatMaxExpectedConsumption: number,
  userDesiredSetpointLimit: number,
): number {
  // Example: Cool mode, room=24°, setpoint=26°, consumption=400W
  // Min=200W, Max=1000W, target=600W, limit=18°
  // currentDifferential = |24-26| = 2°
  // currentRatio = (400-200)/(1000-200) = 0.25 (25% of range)
  // targetRatio = (600-200)/(1000-200) = 0.5 (50% of range)
  // targetDifferential = 2° * (0.5/0.25) = 4°
  // newSetpoint = 24° - 4° = 20° (cooling: lower temp = higher consumption)

  const minConsumption =
    mode === "cool" ? coolMinExpectedConsumption : heatMinExpectedConsumption;
  const maxConsumption =
    mode === "cool" ? coolMaxExpectedConsumption : heatMaxExpectedConsumption;

  // Clamp target consumption within bounds
  const clampedTarget = Math.max(
    minConsumption,
    Math.min(maxConsumption, targetConsumption),
  );

  // Current temperature differential and consumption position
  const currentDifferential = Math.abs(currentRoomTemp - currentSetpoint);
  const currentConsumptionRatio =
    (currentConsumption - minConsumption) / (maxConsumption - minConsumption);

  // Target consumption position
  const targetConsumptionRatio =
    (clampedTarget - minConsumption) / (maxConsumption - minConsumption);

  // Calculate target differential based on consumption ratio scaling
  const targetDifferential =
    currentDifferential *
    (targetConsumptionRatio / Math.max(currentConsumptionRatio, 0.01));

  // Calculate new setpoint based on mode
  let newSetpoint: number;
  if (mode === "cool") {
    // For cooling: lower setpoint = higher consumption
    newSetpoint = currentRoomTemp - targetDifferential;
    // Respect user's minimum temperature limit
    newSetpoint = Math.max(newSetpoint, userDesiredSetpointLimit);
  } else {
    // For heating: higher setpoint = higher consumption
    newSetpoint = currentRoomTemp + targetDifferential;
    // Respect user's maximum temperature limit
    newSetpoint = Math.min(newSetpoint, userDesiredSetpointLimit);
  }

  return Math.round(newSetpoint); // Round to nearest °
}
