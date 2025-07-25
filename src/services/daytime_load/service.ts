import type { TServiceParams } from "@digital-alchemy/core";
import { config as appConfig } from "./config";
import { BooleanDevice } from "./devices/boolean_device";
import { BooleanEntityWrapper } from "../../entities/boolean_entity_wrapper";
import { ClimateDevice, ClimateHassControls } from "./devices/climate_device";
import { ClimateEntityWrapper } from "../../entities/climate_entity_wrapper";
import { SensorEntityWrapper } from "../../entities/sensor_entity_wrapper";
import { DehumidifierDevice, DehumidifierHassControls } from "./devices/dehumidifier_device";
import { HumidifierEntityWrapper } from "../../entities/humidifier_entity_wrapper";
import { DirectConsumptionDevice } from "./devices/direct_consumption_device";
import { NumberEntityWrapper } from "../../entities/number_entity_wrapper";
import { BinarySensorEntityWrapper } from "../../entities/binary_sensor_entity_wrapper";

import { DeviceLoadManager } from "./device_load_manager";
import { SystemStateManager } from "./system_state_manager";
import { BaseHassControls } from "./devices/base_controls";

export function DaytimeLoadService({
  hass,
  logger,
  lifecycle,
  context,
  synapse,
}: TServiceParams) {
  const deviceFactories = appConfig.devices
    .map((deviceConfig) => {
      const baseHassControls = new BaseHassControls(deviceConfig.name, logger, synapse, context);
      switch (deviceConfig.kind) {
        case "boolean":
          // Create Boolean Entity and Sensor Entity wrappers
          return () => {
            const booleanEntityWrapper = new BooleanEntityWrapper(hass.refBy.id(deviceConfig.entityId));
            const booleanConsumptionSensorWrapper = new SensorEntityWrapper(hass.refBy.id(deviceConfig.consumptionEntityId));
            return new BooleanDevice(
              deviceConfig.name,
              deviceConfig.priority,
              logger,
              booleanEntityWrapper,
              booleanConsumptionSensorWrapper,
              baseHassControls,
              deviceConfig.opts,
            );
          }
        case "climate":
          // Create Climate Entity and Sensor Entity wrappers
          // Eagerly create controls to register synapse entities prior to onReady.
          const climateHassControls = new ClimateHassControls(deviceConfig.name, synapse, context, baseHassControls);
          return () => {
            const climateEntityWrapper = new ClimateEntityWrapper(hass.refBy.id(deviceConfig.entityId));
            const consumptionSensorWrapper = new SensorEntityWrapper(hass.refBy.id(deviceConfig.consumptionEntityId));
            return new ClimateDevice(
              deviceConfig.name,
              deviceConfig.priority,
              logger,
              climateEntityWrapper,
              consumptionSensorWrapper,
              climateHassControls,
              deviceConfig.opts,
            );
          }
        case "dehumidifier":
          // Create Dehumidifier Entity and Sensor Entity wrappers
          // Eagerly create controls to register synapse entities prior to onReady.
          const dehumidifierHassControls = new DehumidifierHassControls(deviceConfig.name, synapse, context, baseHassControls, deviceConfig.opts);
          return () => {
            const humidifierEntityWrapper = new HumidifierEntityWrapper(hass.refBy.id(deviceConfig.entityId));
            const consumptionSensorWrapper = new SensorEntityWrapper(hass.refBy.id(deviceConfig.consumptionEntityId));
            const currentHumiditySensorWrapper = new SensorEntityWrapper(hass.refBy.id(deviceConfig.currentHumidityEntityId));
            return new DehumidifierDevice(
              deviceConfig.name,
              deviceConfig.priority,
              logger,
              humidifierEntityWrapper,
              consumptionSensorWrapper,
              currentHumiditySensorWrapper,
              dehumidifierHassControls,
              deviceConfig.opts,
            );
          }
        case "direct_consumption":
          // Create Direct Consumption Device with all required entity wrappers
          return () => {
            const currentEntityWrapper = new NumberEntityWrapper(hass.refBy.id(deviceConfig.entityId));
            const directConsumptionSensorWrapper = new SensorEntityWrapper(hass.refBy.id(deviceConfig.consumptionEntityId));
            const voltageEntityWrapper = new SensorEntityWrapper(hass.refBy.id(deviceConfig.voltageEntityId));
            const enableEntityWrapper = new BooleanEntityWrapper(hass.refBy.id(deviceConfig.enableEntityId));
            const canEnableEntityWrapper = new BinarySensorEntityWrapper(hass.refBy.id(deviceConfig.canEnableEntityId));
            return new DirectConsumptionDevice(
              deviceConfig.name,
              deviceConfig.priority,
              logger,
              currentEntityWrapper,
              directConsumptionSensorWrapper,
              voltageEntityWrapper,
              enableEntityWrapper,
              canEnableEntityWrapper,
              baseHassControls,
              deviceConfig.opts,
            );
          }
        default:
          logger.error(`Unsupported device kind: ${(deviceConfig as any).kind}`);
          return null;
      }
    })
    .filter(exists);

  const systemStatusSensor = synapse.binary_sensor({
    context,
    name: "Daytime Load Management Active",
    device_class: "running",
    unique_id: "daytime_load_management_active",
    icon: "mdi:auto-mode",
  });

  const enableSystemSwitch = synapse.switch({
    context,
    name: "Daytime Load Management Enabled",
    unique_id: "daytime_load_management_enabled",
    suggested_object_id: "daytime_load_management_enabled",
  });

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

    const devices = deviceFactories.map((factory) => factory());

    logger.info(`Loaded ${devices.length} devices for daytime load management`);
    const stateManager = new SystemStateManager(
      logger,
      pvProductionSensorMean1m,
      enableSystemSwitch,
      appConfig.pvProductionActivationThreshold,
      appConfig.pvProductionActivationDelayMs,
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
