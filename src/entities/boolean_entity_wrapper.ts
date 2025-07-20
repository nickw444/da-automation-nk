import {
  ByIdProxy,
  PICK_ENTITY,
  RemovableCallback,
} from "@digital-alchemy/hass";

export interface IBooleanEntityWrapper {
  get state(): string;
  turn_on(): void;
  turn_off(): void;
  onUpdate: RemovableCallback<
    PICK_ENTITY<"switch" | "light" | "fan" | "input_boolean">
  >;
}

export interface MockBooleanEntityWrapper extends IBooleanEntityWrapper {
  state: string;
}

export class BooleanEntityWrapper implements IBooleanEntityWrapper {
  constructor(
    private readonly entityRef: ByIdProxy<
      PICK_ENTITY<"switch" | "light" | "fan" | "input_boolean">
    >,
  ) {}

  get state(): string {
    return this.entityRef.state;
  }

  turn_on(): void {
    this.entityRef.turn_on();
  }

  turn_off(): void {
    this.entityRef.turn_off();
  }

  get onUpdate(): RemovableCallback<
    PICK_ENTITY<"switch" | "light" | "fan" | "input_boolean">
  > {
    return this.entityRef.onUpdate;
  }
}
