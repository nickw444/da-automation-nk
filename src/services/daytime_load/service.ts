import type { TServiceParams } from "@digital-alchemy/core";
import { config as appConfig } from "./config";
import { BooleanDevice } from "./devices/boolean_device";
import { DeviceLoadManager } from "./device_load_manager";
import { SystemStateManager } from "./system_state_manager";

export function DaytimeLoadService({
  hass,
  logger,
  lifecycle,
  config,
  context,
  synapse,
}: TServiceParams) {
  lifecycle.onReady(() => {
    logger.info("Setting up daytime load management");

    const pvProductionSensor = hass.refBy.id(appConfig.pvProductionEntity.raw);
    const pvProductionSensorMean1m = hass.refBy.id(
      appConfig.pvProductionEntity.mean1min,
    );

    const gridConsumptionSensor = hass.refBy.id(
      appConfig.gridConsumptionEntity.raw,
    );
    const gridConsumptionSensorMean1m = hass.refBy.id(
      appConfig.gridConsumptionEntity.mean1min,
    );

    const devices = appConfig.devices
      .map((deviceConfig) => {
        switch (deviceConfig.kind) {
          case "boolean":
            return new BooleanDevice(
              hass.refBy.id(deviceConfig.entityId),
              hass.refBy.id(deviceConfig.consumptionEntityId),
              deviceConfig.expectedConsumption,
              deviceConfig.name,
              deviceConfig.priority,
              deviceConfig.offToOnDebounceMs,
              deviceConfig.onToOffDebounceMs,
            );
          default:
            logger.error(`Unsupported device kind: ${deviceConfig.kind}`);
            return null;
        }
      })
      .filter(exists);

    logger.info(`Loaded ${devices.length} devices for daytime load management`);

    const stateManager = new SystemStateManager(
      logger,
      pvProductionSensorMean1m,
    );
    const loadManager = new DeviceLoadManager(
      devices,
      logger,
      gridConsumptionSensor,
      gridConsumptionSensorMean1m,
      appConfig.desiredGridConsumption,
      appConfig.maxConsumptionBeforeSheddingLoad,
      appConfig.minConsumptionBeforeAddingLoad,
    );

    const systemStatusSensor = synapse.binary_sensor({
      context,
      name: "Daytime Load Management Active",
      device_class: "running",
      unique_id: "daytime_load_management_active",
    });

    stateManager.onSystemStateChange((newState) => {
      logger.info(`System state changed to ${newState}`);
      systemStatusSensor.is_on = newState === "RUNNING";
      if (newState === "RUNNING") {
        loadManager.start();
      } else {
        loadManager.stop();
      }
    });

    gridConsumptionSensorMean1m.onUpdate((state, previousState) => {
      logger.debug(`Grid Consumption: ${state.state} W`);
    });

    pvProductionSensorMean1m.onUpdate((state, previousState) => {
      logger.debug(`PV Production: ${state.state} W`);
    });
  });
}

function exists<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
