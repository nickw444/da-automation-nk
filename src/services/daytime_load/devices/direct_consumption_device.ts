import { PICK_ENTITY } from "@digital-alchemy/hass";
import { BaseDevice } from "./base_device";

export class DirectConsumptionDevice extends BaseDevice {
  constructor(
    private readonly entityRef: PICK_ENTITY<"number" | "input_number">,
    private readonly consumptionEntityRef: PICK_ENTITY<"sensor">,
    private readonly minConsumption: number,
    private readonly maxConsumption: number,
    public readonly name: string,
    public readonly priority: number,
  ) {
    super();
  }

  get minIncreaseCapacity(): number {
    this.entityRef.attr;
  }
  get maxIncreaseCapacity(): number {
    return 0;
  }
  get minDecreaseCapacity(): number {
    return 0;
  }
  get maxDecreaseCapacity(): number {
    return 0;
  }
  get currentConsumption(): number {
    return 0;
  }
  get expectedFutureConsumption(): number {
    return 0;
  }

  protected doIncreaseConsumptionBy(amount: number): void {
    // TODO: Implement direct consumption device control
  }

  protected doDecreaseConsumptionBy(amount: number): void {
    // TODO: Implement direct consumption device control
  }

  stop(): void {
    throw new Error("Method not implemented.");
  }

  get hasChangePending(): "increase" | "decrease" | undefined {
    return undefined;
  }
}
