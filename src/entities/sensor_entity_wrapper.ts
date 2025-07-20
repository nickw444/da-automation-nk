import {
  ByIdProxy,
  PICK_ENTITY,
  RemovableCallback,
} from "@digital-alchemy/hass";

export interface ISensorEntityWrapper {
  get state(): string | number;
  onUpdate: RemovableCallback<PICK_ENTITY<"sensor">>;
}

export interface MockSensorEntityWrapper extends ISensorEntityWrapper {
  state: string | number;
}

export class SensorEntityWrapper implements ISensorEntityWrapper {
  constructor(private readonly entityRef: ByIdProxy<PICK_ENTITY<"sensor">>) {}

  get state(): string | number {
    return this.entityRef.state;
  }

  get onUpdate(): RemovableCallback<PICK_ENTITY<"sensor">> {
    return this.entityRef.onUpdate;
  }
}
