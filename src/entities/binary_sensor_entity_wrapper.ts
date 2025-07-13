import { ByIdProxy, PICK_ENTITY, RemovableCallback } from "@digital-alchemy/hass";

export interface IBinarySensorEntityWrapper {
  get state(): "on" | "off";
  get onUpdate(): RemovableCallback<PICK_ENTITY<"binary_sensor">>
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

  get onUpdate(): RemovableCallback<PICK_ENTITY<"binary_sensor">> {
    return this.entityRef.onUpdate;
  }
}
