export interface IBaseDevice {
  name: string;
  priority: number;

  minIncreaseCapacity: number;
  maxIncreaseCapacity: number;
  minDecreaseCapacity: number;
  maxDecreaseCapacity: number;

  currentConsumption: number;
  expectedFutureConsumption: number;

  hasChangePending: "increase" | "decrease" | undefined;

  canChangeConsumption(): boolean;
  increaseConsumptionBy(amount: number): void;
  decreaseConsumptionBy(amount: number): void;
  stop(): void;
}

export class DeviceHelper {
  static validateIncreaseConsumptionBy(device: IBaseDevice, amount: number) {
    if (device.hasChangePending) {
      throw new Error(
        `Cannot increase consumption for ${device.name}: change already pending`,
      );
    }
    if (!device.canChangeConsumption()) {
      throw new Error(
        `Cannot increase consumption for ${device.name}: device cannot change consumption`,
      );
    }
    if (amount < device.minIncreaseCapacity) {
      throw new Error(
        `Cannot increase consumption for ${device.name}: amount ${amount} below minimum ${device.minIncreaseCapacity}`,
      );
    }
    if (amount > device.maxIncreaseCapacity) {
      throw new Error(
        `Cannot increase consumption for ${device.name}: amount ${amount} exceeds maximum ${device.maxIncreaseCapacity}`,
      );
    }
  }

  static validateDecreaseConsumptionBy(device: IBaseDevice, amount: number) {
    if (device.hasChangePending) {
      throw new Error(
        `Cannot decrease consumption for ${device.name}: change already pending`,
      );
    }
    if (!device.canChangeConsumption()) {
      throw new Error(
        `Cannot decrease consumption for ${device.name}: device cannot change consumption`,
      );
    }
    if (amount < device.minDecreaseCapacity) {
      throw new Error(
        `Cannot decrease consumption for ${device.name}: amount ${amount} below minimum ${device.minDecreaseCapacity}`,
      );
    }
    if (amount > device.maxDecreaseCapacity) {
      throw new Error(
        `Cannot decrease consumption for ${device.name}: amount ${amount} exceeds maximum ${device.maxDecreaseCapacity}`,
      );
    }
  }
}
