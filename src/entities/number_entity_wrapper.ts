import { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";

export interface INumberEntityWrapper {
  get state(): number;
  get attributes(): {
    min?: number;
    max?: number;
    step?: number;
  };
  setValue(value: number): void;
}

export interface MockNumberEntityWrapper extends INumberEntityWrapper {
  state: number;
  attributes: {
    min?: number;
    max?: number;
    step?: number;
  };
}

export class NumberEntityWrapper implements INumberEntityWrapper {
  constructor(
    private readonly entityRef: ByIdProxy<
      PICK_ENTITY<"number" | "input_number">
    >,
  ) {}

  get state(): number {
    const state = this.entityRef.state;
    return typeof state === "number" ? state : parseFloat(state as string) || 0;
  }

  get attributes() {
    const attrs = this.entityRef.attributes;
    return {
      min: "min" in attrs ? attrs.min : undefined,
      max: "max" in attrs ? attrs.max : undefined,
      step: "step" in attrs ? attrs.step : undefined,
    };
  }

  setValue(value: number): void {
    const attrs = this.attributes;
    let finalValue = value;

    // Apply constraints only if they are defined
    if (attrs.min != null) {
      finalValue = Math.max(finalValue, attrs.min);
    }
    if (attrs.max != null) {
      finalValue = Math.min(finalValue, attrs.max);
    }

    // Apply step rounding only if step is defined
    if (attrs.step != null && attrs.step > 0) {
      finalValue = Math.round(finalValue / attrs.step) * attrs.step;
    }

    this.entityRef.set_value({ value: finalValue });
  }
}
