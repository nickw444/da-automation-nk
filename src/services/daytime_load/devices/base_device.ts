import { IBaseHassControls } from "./base_controls";

export interface IBaseDevice<T extends {delta: number}, U extends {delta: number}> {
  name: string;
  priority: number;
  get baseControls(): IBaseHassControls;

  // Amount of energy that can still be allocated to this device to be consumed
  // Separate types for increase and decrease increments
  get increaseIncrements(): T[];
  get decreaseIncrements(): U[];

  get currentConsumption(): number;
  get changeState():
    | { type: "increase" | "decrease", expectedFutureConsumption: number }
    | { type: "debounce" }
    | undefined;

  /**
   * Increase by amount specified in increments.
   * Type-safe parameters: T for increase
   *  -> [22º, 23º, 24º]
   *  -> [8A, 9A, 10A] -> [240W, 480W, 720W]
   *  -> [true] -> [100W]
   */
  increaseConsumptionBy(increment: T): void;

  /**
   * Decrease by amount specified in increments.
   * Type-safe parameters: U for decrease
   */
  decreaseConsumptionBy(increment: U): void;

  /**
   * Cease consumption immediately (due to load management system shutdown)
   */
  stop(): void;
}

export class DeviceHelper {
  /**
   * Validates that a device can increase consumption by the specified increment.
   * Throws an error if validation fails, returns silently if in debounce period.
   */
  static validateIncreaseConsumptionBy<T extends {delta: number}, U extends {delta: number}>(
    device: IBaseDevice<T, U>, 
    increment: T
  ): void {
    // Assume increment is valid since caller should pass objects directly from device.increaseIncrements
    const currentChangeState = device.changeState;
    if (currentChangeState?.type === "increase" || currentChangeState?.type === "decrease") {
      throw new Error(
        `Cannot increase consumption for ${device.name}: change already pending`
      );
    }
  }

  /**
   * Validates that a device can decrease consumption by the specified increment.
   * Throws an error if validation fails, returns silently if in debounce period.
   */
  static validateDecreaseConsumptionBy<T extends {delta: number}, U extends {delta: number}>(
    device: IBaseDevice<T, U>, 
    increment: U
  ): void {
    // Assume increment is valid since caller should pass objects directly from device.decreaseIncrements
    const currentChangeState = device.changeState;
    if (currentChangeState?.type === "increase" || currentChangeState?.type === "decrease") {
      throw new Error(
        `Cannot decrease consumption for ${device.name}: change already pending`
      );
    }
  }
}
