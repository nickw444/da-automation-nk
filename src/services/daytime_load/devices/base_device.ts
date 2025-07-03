export interface IBaseDevice {
  name: string;
  priority: number;

  // Amount of energy that can still be allocated to this device to be consumed
  minIncreaseCapacity: number;
  maxIncreaseCapacity: number;
  minDecreaseCapacity: number;
  maxDecreaseCapacity: number;

  currentConsumption: number;
  expectedFutureConsumption: number;

  hasChangePending: "increase" | "decrease" | undefined;
  
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