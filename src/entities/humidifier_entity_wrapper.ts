import {
  ByIdProxy,
  PICK_ENTITY,
  RemovableCallback,
} from "@digital-alchemy/hass";

export interface IHumidifierEntityWrapper {
  // State access
  get state(): "off" | "on" | undefined;

  // Essential attributes only
  get attributes(): {
    humidity: number;
    min_humidity: number;
    max_humidity: number;
    mode: string;
    available_modes: string[];
  };

  // Control methods
  setHumidity(humidity: number): void;
  setMode(mode: string): void;
  turnOn(): void;
  turnOff(): void;

  // Update callback
  onUpdate: RemovableCallback<PICK_ENTITY<"humidifier">>;
}

export interface MockHumidifierEntityWrapper extends IHumidifierEntityWrapper {
  // Writable properties for testing
  state: "off" | "on" | undefined;
  attributes: {
    humidity: number;
    min_humidity: number;
    max_humidity: number;
    mode: string;
    available_modes: string[];
  };
}

export class HumidifierEntityWrapper implements IHumidifierEntityWrapper {
  constructor(
    private readonly entityRef: ByIdProxy<PICK_ENTITY<"humidifier">>,
  ) {}

  get state(): "off" | "on" | undefined {
    switch (this.entityRef.state) {
      case "off":
      case "on":
        return this.entityRef.state;
      default:
        return undefined;
    }
  }

  get attributes() {
    return {
      humidity: this.entityRef.attributes.humidity,
      min_humidity: this.entityRef.attributes.min_humidity,
      max_humidity: this.entityRef.attributes.max_humidity,
      mode: this.entityRef.attributes.mode,
      available_modes: this.entityRef.attributes.available_modes,
    };
  }

  setHumidity(humidity: number): void {
    this.entityRef.set_humidity({
      humidity: humidity,
    });
  }

  setMode(mode: string): void {
    this.entityRef.set_mode({
      mode: mode,
    });
  }

  turnOn(): void {
    this.entityRef.turn_on();
  }

  turnOff(): void {
    this.entityRef.turn_off();
  }

  get onUpdate(): RemovableCallback<PICK_ENTITY<"humidifier">> {
    return this.entityRef.onUpdate;
  }
}
