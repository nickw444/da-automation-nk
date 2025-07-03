import { PICK_ENTITY } from "@digital-alchemy/hass";
import { DeviceHelper, IBaseDevice } from "./base_device";

export class HumidifierDevice implements IBaseDevice {
  constructor(
    private readonly entity_id: PICK_ENTITY<"humidifier">,
    private readonly consumption_entity_id: PICK_ENTITY<"sensor">,
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
    // TODO: Implement humidifier device consumption control
  }

  decreaseConsumptionBy(amount: number): void {
    DeviceHelper.validateDecreaseConsumptionBy(this, amount);
    // TODO: Implement humidifier device consumption control
  }
  
  stop(): void {
    // TODO: Implement humidifier device consumption control
  }

  get hasChangePending(): "increase" | "decrease" | undefined {
    return undefined;
  }
}
