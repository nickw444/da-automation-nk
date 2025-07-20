import { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";

export interface IClimateEntityWrapper {
  // State access
  get state(): "off" | "heat_cool" | "cool" | "heat" | "fan_only" | "dry";
  get roomTemperature(): number;
  get targetTemperature(): number;

  // Essential attributes only
  get attributes(): {
    current_temperature: number;
    temperature: number;
    min_temp: number;
    max_temp: number;
    hvac_modes: ("off" | "heat_cool" | "cool" | "heat" | "fan_only" | "dry")[];
  };

  // Control methods
  setTemperature(options: {
    temperature: number;
    hvac_mode?: "off" | "heat_cool" | "cool" | "heat" | "fan_only" | "dry";
  }): void;
  setHvacMode(
    mode: "off" | "heat_cool" | "cool" | "heat" | "fan_only" | "dry",
  ): void;
  turnOff(): void;
}

export interface MockClimateEntityWrapper extends IClimateEntityWrapper {
  // Writable properties for testing
  state: "off" | "heat_cool" | "cool" | "heat" | "fan_only" | "dry";
  attributes: {
    current_temperature: number;
    temperature: number;
    min_temp: number;
    max_temp: number;
    hvac_modes: ("off" | "heat_cool" | "cool" | "heat" | "fan_only" | "dry")[];
  };
}

export class ClimateEntityWrapper implements IClimateEntityWrapper {
  constructor(private readonly entityRef: ByIdProxy<PICK_ENTITY<"climate">>) {}

  get state(): "off" | "heat_cool" | "cool" | "heat" | "fan_only" | "dry" {
    return this.entityRef.state;
  }

  get roomTemperature(): number {
    return this.entityRef.attributes.current_temperature;
  }

  get targetTemperature(): number {
    return this.entityRef.attributes.temperature;
  }

  get attributes() {
    return {
      current_temperature: this.entityRef.attributes.current_temperature,
      temperature: this.entityRef.attributes.temperature,
      min_temp: this.entityRef.attributes.min_temp,
      max_temp: this.entityRef.attributes.max_temp,
      hvac_modes: this.entityRef.attributes.hvac_modes,
    };
  }

  setTemperature(options: {
    temperature: number;
    hvac_mode?: "off" | "heat_cool" | "cool" | "heat" | "fan_only" | "dry";
  }): void {
    this.entityRef.set_temperature({
      temperature: options.temperature,
      ...(options.hvac_mode && { hvac_mode: options.hvac_mode }),
    });
  }

  setHvacMode(
    mode: "off" | "heat_cool" | "cool" | "heat" | "fan_only" | "dry",
  ): void {
    this.entityRef.set_hvac_mode({
      hvac_mode: mode,
    });
  }

  turnOff(): void {
    this.entityRef.turn_off();
  }
}
