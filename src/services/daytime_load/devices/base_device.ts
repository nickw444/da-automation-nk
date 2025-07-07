export interface IBaseDevice {
  name: string;
  priority: number;

  // Amount of energy that can still be allocated to this device to be consumed
  get increaseIncrements(): number[];
  get decreaseIncrements(): number[];

  get currentConsumption(): number;
  get changeState():
    | { type: "increase" | "decrease", expectedFutureConsumption: number }
    | { type: "debounce" }
    | undefined;

  /**
   * Increase by amount specified in increments.
   *  -> [22º, 23º, 24º]
   *  -> [8A, 9A, 10A] -> [240W, 480W, 720W]
   *  -> [true] -> [100W]
   */
  increaseConsumptionBy(amount: number): void;

  /**
   * Decrease by amount specified in increments.
   */
  decreaseConsumptionBy(amount: number): void;

  /**
   * Cease consumption immediately (due to load management system shutdown)
   */
  stop(): void;
}

export class DeviceHelper {
  /**
   * Validates that a device can increase consumption by the specified amount.
   * Throws an error if validation fails, returns silently if in debounce period.
   */
  static validateIncreaseConsumptionBy(device: IBaseDevice, amount: number): void {
    // Validate that the amount is in our increments
    const validIncrements = device.increaseIncrements;
    if (!validIncrements.includes(amount)) {
      throw new Error(
        `Cannot increase consumption for ${device.name}: amount ${amount} W not in valid increments [${validIncrements.join(', ')}]`,
      );
    }

    // Check if we have a pending change
    const currentChangeState = device.changeState;
    if (currentChangeState?.type === "increase" || currentChangeState?.type === "decrease") {
      throw new Error(
        `Cannot increase consumption for ${device.name}: change already pending`,
      );
    }
  }

  /**
   * Validates that a device can decrease consumption by the specified amount.
   * Throws an error if validation fails, returns silently if in debounce period.
   */
  static validateDecreaseConsumptionBy(device: IBaseDevice, amount: number): void {
    // Validate that the amount is in our increments
    const validIncrements = device.decreaseIncrements;
    if (!validIncrements.includes(amount)) {
      throw new Error(
        `Cannot decrease consumption for ${device.name}: amount ${amount} W not in valid increments [${validIncrements.join(', ')}]`,
      );
    }

    // Check if we have a pending change
    const currentChangeState = device.changeState;
    if (currentChangeState?.type === "increase" || currentChangeState?.type === "decrease") {
      throw new Error(
        `Cannot decrease consumption for ${device.name}: change already pending`,
      );
    }
  }
}
