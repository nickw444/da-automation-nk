import { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";

export interface IBinarySensorEntityWrapper {
  get state(): "on" | "off";
}

export interface MockBinarySensorEntityWrapper extends IBinarySensorEntityWrapper {
  state: "on" | "off";
}

export class BinarySensorEntityWrapper implements IBinarySensorEntityWrapper {
  constructor(
    private readonly entityRef: ByIdProxy<PICK_ENTITY<"binary_sensor">>
  ) {}

  get state(): "on" | "off" {
    return this.entityRef.state;
  }
}
