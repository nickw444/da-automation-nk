import { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";

export interface ISensorEntityWrapper {
  get state(): string | number;
}

export interface MockSensorEntityWrapper extends ISensorEntityWrapper {
  state: string | number;
}

export class SensorEntityWrapper implements ISensorEntityWrapper {
  constructor(
    private readonly entityRef: ByIdProxy<PICK_ENTITY<"sensor">>
  ) {}

  get state(): string | number {
    return this.entityRef.state;
  }
}
