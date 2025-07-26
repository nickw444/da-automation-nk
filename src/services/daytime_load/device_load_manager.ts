import type { ILogger } from "@digital-alchemy/core";
import { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";
import { Device } from "./devices/device";
import { unwrapNumericState } from "./states_helpers";
import { IBaseDevice } from "./devices/base_device";

export const LOOP_INTERVAL = 15000;

export class DeviceLoadManager {
  private loopInterval: NodeJS.Timeout | undefined = undefined;

  constructor(
    private readonly devices: IBaseDevice<{ delta: number }, { delta: number }>[],
    private readonly logger: ILogger,
    private readonly gridConsumptionSensor: ByIdProxy<PICK_ENTITY<"sensor">>,
    private readonly gridConsumptionSensorMean1m: ByIdProxy<
      PICK_ENTITY<"sensor">
    >,
    private readonly desiredGridConsumption: number,
    private readonly maxConsumptionBeforeSheddingLoad: number,
    private readonly minConsumptionBeforeAddingLoad: number,
  ) { }

  start() {
    this.logger.info("Starting device load management loop");
    this.loopInterval = setInterval(this.loop, LOOP_INTERVAL);
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
    const gridConsumptionNow = unwrapNumericState(
      this.gridConsumptionSensor.state,
    );
    if (gridConsumption == null || gridConsumptionNow == null) {
      this.logger.warn("Grid consumption is null, skipping load management");
      return;
    }

    this.logger.info(`Current grid consumption: ${gridConsumption} W (mean 1m) / ${gridConsumptionNow} W`);

    // Bangbang control logic
    if (gridConsumption > this.maxConsumptionBeforeSheddingLoad) {
      // Too much consumption - shed load
      this.logger.info(
        `Grid consumption ${gridConsumption} W exceeds max ${this.maxConsumptionBeforeSheddingLoad} W, shedding load`,
      );
      this.shedLoad(Math.max(gridConsumption, gridConsumptionNow) - this.desiredGridConsumption);
    } else if (gridConsumption < this.minConsumptionBeforeAddingLoad) {
      // Surplus production - add load
      this.logger.info(
        `Grid consumption ${gridConsumption} W is below min ${this.minConsumptionBeforeAddingLoad} W, adding load`,
      );
      this.addLoad(this.desiredGridConsumption - Math.max(gridConsumption, gridConsumptionNow));
    } else {
      // Within acceptable range - no action needed
      this.logger.info(
        `Grid consumption ${gridConsumption} W is within acceptable range`,
      );
    }
  };

  private shedLoad(excessConsumption: number) {
    // Sort devices by priority (highest first for shedding - shed low priority devices first)
    const sortedDevices = [...this.devices]
      .filter(device => device.baseControls.managementEnabled)
      .sort((a, b) => b.priority - a.priority);

    this.logger.info(`shedLoad across enabled devices: [${sortedDevices.map(d => d.name).join(', ')}]`);
    this.logger.info(` • Excess consumption: ${excessConsumption} W`);

    const expectedAdditionalFutureReduction = sortedDevices.reduce((acc, device) => {
      if (device.changeState?.type === "decrease") {
        this.logger.info(` • ${device.name} pending decrease, future consumption: ${device.changeState.expectedFutureConsumption} W w/ current consumption: ${device.currentConsumption} W`);
        acc += Math.min(0, device.changeState.expectedFutureConsumption - device.currentConsumption);
      }
      return acc;
    }, 0);
    let remainingToShed = excessConsumption - expectedAdditionalFutureReduction;
    this.logger.info(` • Expected additional future reduction: ${expectedAdditionalFutureReduction} W`);
    this.logger.info(` • Remaining to shed: ${remainingToShed} W`);

    if (remainingToShed <= 0) {
      this.logger.info(` • No load to shed.`);
      return;
    }

    for (const device of sortedDevices) {
      this.logger.info(` • Processing ${device.name}, remaining to shed: ${remainingToShed}`);

      if (remainingToShed <= 0) {
        this.logger.info(` • No further load to shed remainingToShed: ${remainingToShed}`);
        break;
      }

      // Skip if device has pending changes or is in debounce
      const changeState = device.changeState;
      if (!device.baseControls.managementEnabled) {
        this.logger.info(` • Skipping ${device.name} - management disabled`);
        continue;
      } else if (changeState?.type === "increase") {
        // Device is already turning on, skip it
        this.logger.info(` • Skipping ${device.name} - has pending increase`);
        continue;
      } else if (changeState?.type === "decrease") {
        // Device is turning off, skip it
        this.logger.info(` • Skipping ${device.name} - has pending decrease`);
        continue;
      } else if (changeState?.type === "debounce") {
        this.logger.info(` • Skipping ${device.name} - in debounce period`);
        continue;
      }

      const allIncrements = [...device.decreaseIncrements]
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      const largestFittingIndex = allIncrements.findIndex(increment => Math.abs(increment.delta) <= remainingToShed);
      const largest = allIncrements[largestFittingIndex];

      if (allIncrements.length > 0) {
        // Pick smallest increment which outsizes remainingToShed, otherwise shed largest amount.
        const suitableIncrement = largestFittingIndex !== -1  && largestFittingIndex > 0
          ? allIncrements[largestFittingIndex - 1]
          : allIncrements[0];
        this.logger.info(` • Shedding ${suitableIncrement.delta} W from ${device.name}`);
        device.decreaseConsumptionBy(suitableIncrement);
        remainingToShed += suitableIncrement.delta; // delta is negative, so add to remaining.
      } else {
        this.logger.info(
          ` • Skipping ${device.name} - no suitable increment (available: [${JSON.stringify(allIncrements)}] W, needed: ≤${remainingToShed} W)`,
        );
      }
    }

    if (remainingToShed > 0) {
      this.logger.info(` • Unable to shed all remaining load: ${remainingToShed}W excess remains`);
    }
  }

  private addLoad(surplusCapacity: number) {
    // Filter then sort devices by priority (lowest first for adding)
    const sortedDevices = [...this.devices]
      .filter(device => device.baseControls.managementEnabled)
      .sort((a, b) => a.priority - b.priority);

    this.logger.info(`addLoad across enabled devices: [${sortedDevices.map(d => d.name).join(', ')}]`);
    this.logger.info(` • Suplus capacity: ${surplusCapacity} W`);

    const expectedAdditionalFutureConsumption = sortedDevices.reduce((acc, device) => {
      if (device.changeState?.type === "increase") {
        this.logger.info(` • ${device.name} pending increase, future consumption: ${device.changeState.expectedFutureConsumption} W w/ current consumption: ${device.currentConsumption} W`);
        acc += Math.max(0, device.changeState.expectedFutureConsumption - device.currentConsumption);
      }
      return acc;
    }, 0);
    let remainingToAdd = surplusCapacity - expectedAdditionalFutureConsumption;

    this.logger.info(` • Expected additional future consumption: ${expectedAdditionalFutureConsumption} W`);
    this.logger.info(` • Remaining to add: ${remainingToAdd} W`);

    if (remainingToAdd <= 0) {
      this.logger.info(` • No load to add.`);
      return;
    }

    for (const device of sortedDevices) {
      this.logger.info(` • Processing ${device.name}, remaining to add: ${remainingToAdd}`);

      if (remainingToAdd <= 0) {
        this.logger.info(` • No further load to add remainingToAdd: ${remainingToAdd}`);
        break;
      }

      // Check if device has pending changes or is in debounce
      const changeState = device.changeState;
      if (!device.baseControls.managementEnabled) {
        this.logger.info(` • Skipping ${device.name} - management disabled`);
        continue;
      } else if (changeState?.type === "increase") {
        // Device is already turning on, skip it
        this.logger.info(` • Skipping ${device.name} - has pending increase`);
        continue;
      } else if (changeState?.type === "decrease") {
        // Device is turning off, skip it
        this.logger.info(` • Skipping ${device.name} - has pending decrease`);
        continue;
      } else if (changeState?.type === "debounce") {
        this.logger.info(` • Skipping ${device.name} - in debounce period`);
        continue;
      }

      // Find the best fitting increment that doesn't exceed remainingToAdd
      const allIncrements = device.increaseIncrements
      const suitableIncrements = allIncrements
        .filter(increment => increment.delta <= remainingToAdd)
        .sort((a, b) => b.delta - a.delta);
      if (suitableIncrements.length > 0) {
        const suitableIncrement = suitableIncrements[0]; // Pick the largest suitable increment
        this.logger.info(` • Adding ${suitableIncrement.delta} W to ${device.name}`);
        device.increaseConsumptionBy(suitableIncrement);
        remainingToAdd -= suitableIncrement.delta;
      } else {
        this.logger.info(
          ` • Skipping ${device.name} - no suitable increment (available: [${JSON.stringify(allIncrements)}] W, needed: ≤${remainingToAdd} W)`,
        );
      }
    }
    if (remainingToAdd > 0) {
      this.logger.info(` • Unable to add all surplus load: ${remainingToAdd}W surplus remains`);
    }
  }
}
