import type { ILogger } from "@digital-alchemy/core";
import { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";
import { Device } from "./devices/device";
import { unwrapNumericState } from "./states_helpers";
import { BaseDevice } from "./devices/base_device";

export class DeviceLoadManager {
  private loopInterval: NodeJS.Timeout | undefined = undefined;

  constructor(
    private readonly devices: BaseDevice[],
    private readonly logger: ILogger,
    private readonly gridConsumptionSensor: ByIdProxy<PICK_ENTITY<"sensor">>,
    private readonly gridConsumptionSensorMean1m: ByIdProxy<
      PICK_ENTITY<"sensor">
    >,
    private readonly desiredGridConsumption: number,
    private readonly maxConsumptionBeforeSheddingLoad: number,
    private readonly minConsumptionBeforeAddingLoad: number,
  ) {}

  start() {
    this.logger.info("Starting device load management loop");
    this.loopInterval = setInterval(this.loop, 5000);
  }

  stop() {
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      for (const device of this.devices) {
        device.stop();
      }
      this.logger.info("Stopped device load management loop");
    }
  }

  private readonly loop = () => {
    this.logger.info("Running device load management loop");
    const gridConsumption = unwrapNumericState(
      this.gridConsumptionSensorMean1m.state,
    );
    if (gridConsumption == null) {
      this.logger.warn("Grid consumption is null, skipping load management");
      return;
    }

    this.logger.info(`Current grid consumption: ${gridConsumption} W`);

    // Bangbang control logic
    if (gridConsumption > this.maxConsumptionBeforeSheddingLoad) {
      // Too much consumption - shed load
      this.logger.info(
        `Grid consumption ${gridConsumption} W exceeds max ${this.maxConsumptionBeforeSheddingLoad} W, shedding load`,
      );
      this.shedLoad(gridConsumption - this.desiredGridConsumption);
    } else if (gridConsumption < this.minConsumptionBeforeAddingLoad) {
      // Surplus production - add load
      this.logger.info(
        `Grid consumption ${gridConsumption} W is below min ${this.minConsumptionBeforeAddingLoad} W, adding load`,
      );
      this.addLoad(this.desiredGridConsumption - gridConsumption);
    } else {
      // Within acceptable range - no action needed
      this.logger.debug(
        `Grid consumption ${gridConsumption} W is within acceptable range`,
      );
    }
  };

  private shedLoad(excessConsumption: number) {
    // Sort devices by priority (lowest first for shedding - shed low priority devices first)
    const sortedDevices = [...this.devices].sort(
      (a, b) => a.priority - b.priority,
    );

    let remainingToShed = excessConsumption;

    for (const device of sortedDevices) {
      if (remainingToShed <= 0) break;

      // Skip if device has pending changes
      if (device.hasChangePending) {
        this.logger.debug(`Skipping ${device.name} - has pending changes`);
        continue;
      }

      const availableDecrease = device.maxDecreaseCapacity;
      if (availableDecrease > 0) {
        const decreaseAmount = Math.min(availableDecrease, remainingToShed);

        // Check if the decrease amount meets the minimum required decrease
        if (decreaseAmount >= device.minDecreaseCapacity) {
          this.logger.info(`Shedding ${decreaseAmount} W from ${device.name}`);
          device.decreaseConsumptionBy(decreaseAmount);
          remainingToShed -= decreaseAmount;
        } else {
          this.logger.debug(
            `Skipping ${device.name} - decrease amount ${decreaseAmount} W is below minimum ${device.minDecreaseCapacity} W`,
          );
        }
      }
    }

    if (remainingToShed > 0) {
      this.logger.warn(
        `Could not shed enough load, ${remainingToShed} W remaining`,
      );
    }
  }

  private addLoad(surplusCapacity: number) {
    // Sort devices by priority (highest first for adding)
    const sortedDevices = [...this.devices].sort(
      (a, b) => b.priority - a.priority,
    );

    let remainingToAdd = surplusCapacity;

    for (const device of sortedDevices) {
      if (remainingToAdd <= 0) break;

      // Check if device has pending changes
      const pendingChange = device.hasChangePending;
      if (pendingChange === "increase") {
        // Device is already turning on, account for its additional future consumption
        const additionalConsumption =
          device.expectedFutureConsumption - device.currentConsumption;
        this.logger.debug(
          `${device.name} has pending increase, accounting for ${additionalConsumption} W additional consumption (${device.expectedFutureConsumption} W future - ${device.currentConsumption} W current)`,
        );
        remainingToAdd -= additionalConsumption;
        continue;
      } else if (pendingChange === "decrease") {
        // Device is turning off, skip it
        this.logger.debug(`Skipping ${device.name} - has pending decrease`);
        continue;
      }

      const availableIncrease = device.maxIncreaseCapacity;
      if (availableIncrease > 0) {
        const increaseAmount = Math.min(availableIncrease, remainingToAdd);

        // Check if the increase amount meets the minimum required increase
        if (increaseAmount >= device.minIncreaseCapacity) {
          this.logger.info(`Adding ${increaseAmount} W to ${device.name}`);
          device.increaseConsumptionBy(increaseAmount);
          remainingToAdd -= increaseAmount;
        } else {
          this.logger.debug(
            `Skipping ${device.name} - increase amount ${increaseAmount} W is below minimum ${device.minIncreaseCapacity} W`,
          );
        }
      }
    }

    if (remainingToAdd > 0) {
      this.logger.info(
        `Could not add all surplus load, ${remainingToAdd} W remaining`,
      );
    }
  }
}
