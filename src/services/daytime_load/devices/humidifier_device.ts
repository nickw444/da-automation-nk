import { PICK_ENTITY } from "@digital-alchemy/hass";
import { BaseDevice } from "./base_device";

export class HumidifierDevice extends BaseDevice {
  constructor(
    private readonly entity_id: PICK_ENTITY<"humidifier">,
    private readonly consumption_entity_id: PICK_ENTITY<"sensor">,
    public readonly name: string,
    public readonly priority: number,
  ) {
    super();
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

  protected doIncreaseConsumptionBy(amount: number): void {
    // TODO: Implement humidifier device consumption control
  }

  protected doDecreaseConsumptionBy(amount: number): void {
    // TODO: Implement humidifier device consumption control
  }

  get hasChangePending(): "increase" | "decrease" | undefined {
    return undefined;
  }
}
