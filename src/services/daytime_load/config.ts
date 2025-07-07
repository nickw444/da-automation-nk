import type { TServiceParams } from "@digital-alchemy/core";
import { BooleanDevice } from "./devices/boolean_device";
import { Device } from "./devices/device";
import { PICK_ENTITY } from "@digital-alchemy/hass";

type BaseDeviceConfig = {
  priority: number; // Priority for load management (lower number = higher priority)
  name: string; // Unique identifier for the device (used in logs and state tracking)
  minCycleTime?: number; // Minimum cycle time in minutes (optional)
  // minRuntimePerDay?: number; // Minimum time per day in minutes (optional) << E.g. towel rail needs to be on for at least 4 hours per day
};

type BooleanDeviceConfig = {
  kind: "boolean";
  entityId: PICK_ENTITY<"switch">;
  consumptionEntityId: PICK_ENTITY<"sensor">;
  expectedConsumption: number; // Expected power consumption in watts
  offToOnDebounceMs: number; // Debounce time from OFF to ON in milliseconds
  onToOffDebounceMs: number; // Debounce time from ON to OFF in milliseconds
};

type ClimateDeviceConfig = {
  kind: "climate";
  entityId: PICK_ENTITY<"climate">;
  consumptionEntityId: PICK_ENTITY<"sensor">;
  fanOnlyExpectedConsumption: number;
  heatMinExpectedConsumption: number;
  coolMinExpectedConsumption: number;
  heatMaxExpectedConsumption: number;
  coolMaxExpectedConsumption: number;
};

type HumidifierDeviceConfig = {
  kind: "humidifier";
  entityId: PICK_ENTITY<"humidifier">;
  consumptionEntityId: PICK_ENTITY<"sensor">;
};

type DirectConsumptionDeviceConfig = {
  kind: "direct_consumption";
  entityId: PICK_ENTITY<"input_number" | "number">;
  consumptionEntityId: PICK_ENTITY<"sensor">;
};

type DeviceConfig = BaseDeviceConfig &
  (
    | BooleanDeviceConfig
    | ClimateDeviceConfig
    | HumidifierDeviceConfig
    | DirectConsumptionDeviceConfig
  );

type Config = {
  devices: DeviceConfig[];
  pvProductionEntity: {
    raw: PICK_ENTITY<"sensor">;
    mean1min: PICK_ENTITY<"sensor">;
  };
  gridConsumptionEntity: {
    raw: PICK_ENTITY<"sensor">;
    mean1min: PICK_ENTITY<"sensor">;
  };

  // Minimum solar production to activate smart load management
  // If the production is below this threshold, devices will not be activated
  // If the production drops below this threshold after activation, load management will be stopped.
  // Special condition: If the current production is above this threshold at startup, the system will activate immediately.
  pvProductionActivationThreshold: number;
  pvProductionActivationDelay: number; // in minutes

  // Desired grid consumption used for "right size" scheduling of devices.
  desiredGridConsumption: number;
  // If the grid consumption is above this threshold, devices will be shed to achieve right size consumption.
  maxConsumptionBeforeSheddingLoad: number;
  // If the grid consumption is below this threshold, devices will be activated to achieve right size consumption.
  minConsumptionBeforeAddingLoad: number;
};

const devices: DeviceConfig[] = [
  {
    kind: "boolean",
    entityId: "switch.subfloor_fan",
    consumptionEntityId: "sensor.subfloor_fan_current_consumption",
    expectedConsumption: 50,
    priority: 2,
    name: "Subfloor Fan",
    offToOnDebounceMs: 15 * 60_000, // 15 minutes from OFF to ON
    onToOffDebounceMs: 10 * 60_000, // 10 minutes from ON to OFF
  },
  {
    kind: "boolean",
    entityId: "switch.towel_rail",
    consumptionEntityId: "sensor.towel_rail_current_consumption",
    expectedConsumption: 80,
    priority: 3,
    name: "Towel Rail",
    offToOnDebounceMs: 15 * 60_000, // 15 minutes from OFF to ON
    onToOffDebounceMs: 10 * 60_000, // 10 minutes from ON to OFF
  },
  {
    kind: "climate",
    entityId: "climate.hallway",
    consumptionEntityId: "sensor.air_conditioning_power",
    priority: 1,
    name: "Hallway Climate",
    fanOnlyExpectedConsumption: 50,
    heatMinExpectedConsumption: 300,
    coolMinExpectedConsumption: 300,
    heatMaxExpectedConsumption: 2200,
    coolMaxExpectedConsumption: 2200,
  },
];

export const config: Config = {
  devices,
  pvProductionEntity: {
    raw: "sensor.inverter_total_active_power",
    mean1min: "sensor.inverter_total_active_power_mean_1m",
  },
  gridConsumptionEntity: {
    raw: "sensor.inverter_meter_power",
    mean1min: "sensor.inverter_meter_power_mean_1m",
  },

  pvProductionActivationThreshold: 500,
  pvProductionActivationDelay: 15,

  maxConsumptionBeforeSheddingLoad: 100,
  minConsumptionBeforeAddingLoad: -400,
  desiredGridConsumption: -200,
};
