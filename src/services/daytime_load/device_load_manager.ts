import type { ILogger } from "@digital-alchemy/core";
import { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";
import { Device } from "./devices/device";
import { unwrapNumericState } from "./states_helpers";
import { IBaseDevice } from "./devices/base_device";

export class DeviceLoadManager {
  private loopInterval: NodeJS.Timeout | undefined = undefined;

  constructor(
    private readonly devices: IBaseDevice[],
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
    this.logger.debug("Running device load management loop");
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
      this.logger.debug(
        `Grid consumption ${gridConsumption} W exceeds max ${this.maxConsumptionBeforeSheddingLoad} W, shedding load`,
      );
      this.shedLoad(gridConsumption - this.desiredGridConsumption);
    } else if (gridConsumption < this.minConsumptionBeforeAddingLoad) {
      // Surplus production - add load
      this.logger.debug(
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
    // Sort devices by priority (highest first for shedding - shed low priority devices first)
    const sortedDevices = [...this.devices].sort(
      (a, b) => b.priority - a.priority,
    );

    let remainingToShed = excessConsumption;

    for (const device of sortedDevices) {
      if (remainingToShed <= 0) break;

      // Skip if device has pending changes or is in debounce
      const changeState = device.changeState;
      if (changeState?.type === "increase" || changeState?.type === "decrease") {
        this.logger.debug(`Skipping ${device.name} - has pending changes`);
        continue;
      }
      if (changeState?.type === "debounce") {
        this.logger.debug(`Skipping ${device.name} - in debounce period`);
        continue;
      }

      const decreaseIncrements = device.decreaseIncrements;
      if (decreaseIncrements.length > 0) {
        // Find the best fitting increment that doesn't exceed remainingToShed
        const suitableIncrement = decreaseIncrements
          .filter(increment => increment <= remainingToShed)
          .sort((a, b) => b - a)[0]; // Pick the largest suitable increment

        if (suitableIncrement !== undefined) {
          this.logger.info(`Shedding ${suitableIncrement} W from ${device.name}`);
          device.decreaseConsumptionBy(suitableIncrement);
          remainingToShed -= suitableIncrement;
        } else {
          this.logger.debug(
            `Skipping ${device.name} - no suitable increment (available: [${decreaseIncrements.join(', ')}] W, needed: ≤${remainingToShed} W)`,
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
    // Sort devices by priority (lowest first for adding)
    const sortedDevices = [...this.devices].sort(
      (a, b) => a.priority - b.priority,
    );

    let remainingToAdd = surplusCapacity;

    // First, account for all pending increases across all devices
    for (const device of sortedDevices) {
      const changeState = device.changeState;
      if (changeState?.type === "increase") {
        const additionalConsumption =
          changeState.expectedFutureConsumption - device.currentConsumption;
        this.logger.debug(
          `${device.name} has pending increase, accounting for ${additionalConsumption} W additional consumption (${changeState.expectedFutureConsumption} W future - ${device.currentConsumption} W current)`,
        );
        remainingToAdd -= additionalConsumption;
      }
    }

    for (const device of sortedDevices) {
      if (remainingToAdd <= 0) break;

      // Check if device has pending changes or is in debounce
      const changeState = device.changeState;
      if (changeState?.type === "increase") {
        // Device is already turning on, skip it
        this.logger.debug(`Skipping ${device.name} - has pending increase`);
        continue;
      } else if (changeState?.type === "decrease") {
        // Device is turning off, skip it
        this.logger.debug(`Skipping ${device.name} - has pending decrease`);
        continue;
      } else if (changeState?.type === "debounce") {
        this.logger.debug(`Skipping ${device.name} - in debounce period`);
        continue;
      }

      const increaseIncrements = device.increaseIncrements;
      if (increaseIncrements.length > 0) {
        // Find the best fitting increment that doesn't exceed remainingToAdd
        const suitableIncrement = increaseIncrements
          .filter(increment => increment <= remainingToAdd)
          .sort((a, b) => b - a)[0]; // Pick the largest suitable increment

        if (suitableIncrement !== undefined) {
          this.logger.info(`Adding ${suitableIncrement} W to ${device.name}`);
          device.increaseConsumptionBy(suitableIncrement);
          remainingToAdd -= suitableIncrement;
        } else {
          this.logger.debug(
            `Skipping ${device.name} - no suitable increment (available: [${increaseIncrements.join(', ')}] W, needed: ≤${remainingToAdd} W)`,
          );
        }
      }
    }
  }
}
