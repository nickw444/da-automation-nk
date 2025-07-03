import { PICK_ENTITY } from "@digital-alchemy/hass";
import { DeviceHelper, IBaseDevice } from "./base_device";

export class DirectConsumptionDevice implements IBaseDevice {
  constructor(
    private readonly entityRef: PICK_ENTITY<"number" | "input_number">,
    private readonly consumptionEntityRef: PICK_ENTITY<"sensor">,
    private readonly minConsumption: number,
    private readonly maxConsumption: number,
    public readonly name: string,
    public readonly priority: number,
  ) {
  }

  get minIncreaseCapacity(): number {
    return 0;
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

  increaseConsumptionBy(amount: number): void {
    DeviceHelper.validateIncreaseConsumptionBy(this, amount);
    // TODO: Implement direct consumption device control
  }

  decreaseConsumptionBy(amount: number): void {
    DeviceHelper.validateDecreaseConsumptionBy(this, amount);
    // TODO: Implement direct consumption device control
  }

  stop(): void {
    throw new Error("Method not implemented.");
  }

  get hasChangePending(): "increase" | "decrease" | undefined {
    return undefined;
  }
}
