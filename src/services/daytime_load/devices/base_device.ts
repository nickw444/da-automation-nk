export abstract class BaseDevice {
  // Amount of energy that can still be allocated to this device to be consumed
  abstract minIncreaseCapacity: number;
  abstract maxIncreaseCapacity: number;
  abstract minDecreaseCapacity: number;
  abstract maxDecreaseCapacity: number;

  abstract currentConsumption: number;
  abstract expectedFutureConsumption: number;

  abstract name: string;
  abstract priority: number;

  abstract stop(): void;
  protected abstract doIncreaseConsumptionBy(amount: number): void;
  protected abstract doDecreaseConsumptionBy(amount: number): void;

  increaseConsumptionBy(amount: number): void {
    if (this.hasChangePending) {
      throw new Error(
        `Cannot increase consumption for ${this.name}: change already pending`,
      );
    }
    if (amount < this.minIncreaseCapacity) {
      throw new Error(
        `Cannot increase consumption for ${this.name}: amount ${amount} below minimum ${this.minIncreaseCapacity}`,
      );
    }
    if (amount > this.maxIncreaseCapacity) {
      throw new Error(
        `Cannot increase consumption for ${this.name}: amount ${amount} exceeds maximum ${this.maxIncreaseCapacity}`,
      );
    }
    this.doIncreaseConsumptionBy(amount);
  }

  decreaseConsumptionBy(amount: number): void {
    if (this.hasChangePending) {
      throw new Error(
        `Cannot decrease consumption for ${this.name}: change already pending`,
      );
    }
    if (amount < this.minDecreaseCapacity) {
      throw new Error(
        `Cannot decrease consumption for ${this.name}: amount ${amount} below minimum ${this.minDecreaseCapacity}`,
      );
    }
    if (amount > this.maxDecreaseCapacity) {
      throw new Error(
        `Cannot decrease consumption for ${this.name}: amount ${amount} exceeds maximum ${this.maxDecreaseCapacity}`,
      );
    }
    this.doDecreaseConsumptionBy(amount);
  }
  abstract hasChangePending: "increase" | "decrease" | undefined;
}
