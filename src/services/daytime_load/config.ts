import type { TServiceParams } from "@digital-alchemy/core";
import { BooleanDevice } from "./devices/boolean_device";
import { Device } from "./devices/device";
import { PICK_ENTITY } from "@digital-alchemy/hass";
import { ClimateDeviceOptions } from "./devices/climate_device";
import { BooleanDeviceOptions } from "./devices/boolean_device";
import { DirectConsumptionDeviceOptions } from "./devices/direct_consumption_device";
import { DehumidifierDeviceOptions } from "./devices/dehumidifier_device";

type BaseDeviceConfig = {
  priority: number; // Priority for load management (lower number = higher priority)
  name: string; // Unique identifier for the device (used in logs and state tracking)
  // minCycleTime?: number; // Minimum cycle time in minutes (optional)
  // minRuntimePerDay?: number; // Minimum time per day in minutes (optional) << E.g. towel rail needs to be on for at least 4 hours per day
};

type BooleanDeviceConfig = {
  kind: "boolean";
  entityId: PICK_ENTITY<"switch">;
  consumptionEntityId: PICK_ENTITY<"sensor">;
  opts: BooleanDeviceOptions;
};

type ClimateDeviceConfig = {
  kind: "climate";
  entityId: PICK_ENTITY<"climate">;
  consumptionEntityId: PICK_ENTITY<"sensor">;
  opts: ClimateDeviceOptions;
};

type DehumidifierDeviceConfig = {
  kind: "dehumidifier";
  entityId: PICK_ENTITY<"humidifier">;
  consumptionEntityId: PICK_ENTITY<"sensor">;
  currentHumidityEntityId: PICK_ENTITY<"sensor">;
  opts: DehumidifierDeviceOptions;
};

type DirectConsumptionDeviceConfig = {
  kind: "direct_consumption";
  entityId: PICK_ENTITY<"input_number" | "number">;
  consumptionEntityId: PICK_ENTITY<"sensor">;
  voltageEntityId: PICK_ENTITY<"sensor">;
  enableEntityId: PICK_ENTITY<"switch" | "input_boolean">;
  canEnableEntityId: PICK_ENTITY<"binary_sensor">;
  opts: DirectConsumptionDeviceOptions;
};

type DeviceConfig = BaseDeviceConfig &
  (
    | BooleanDeviceConfig
    | ClimateDeviceConfig
    | DehumidifierDeviceConfig
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
  pvProductionActivationDelayMs: number; // in milliseconds

  // Desired grid consumption used for "right size" scheduling of devices.
  desiredGridConsumption: number;
  // If the grid consumption is above this threshold, devices will be shed to achieve right size consumption.
  maxConsumptionBeforeSheddingLoad: number;
  // If the grid consumption is below this threshold, devices will be activated to achieve right size consumption.
  minConsumptionBeforeAddingLoad: number;
};

const devices: DeviceConfig[] = [
  {
    kind: "climate",
    entityId: "climate.hallway",
    consumptionEntityId: "sensor.air_conditioning_power",
    name: "Hallway Climate",
    priority: 1,
    opts: {
      // Temperature Constraints
      minSetpoint: 16,
      maxSetpoint: 30,
      setpointStep: 1.0,

      // Power Configuration
      compressorStartupMinConsumption: 800,
      powerOnSetpointOffset: 2.0,
      consumptionPerDegree: 300,
      maxCompressorConsumption: 2400,
      fanOnlyMinConsumption: 200,
      heatCoolMinConsumption: 500,

      // Timing Configuration
      setpointChangeTransitionMs: 60_000,  // 1 minute for consumption to stabilize after setpoint change
      setpointDebounceMs: 1 * 60_000,      // additional 1 minutes before subsequent changes
      modeChangeTransitionMs: 3 * 60_000,  // 3 minutes for consumption to stabilize after mode change
      modeDebounceMs: 2 * 60_000,          // additional 2 minutes before subsequent changes
      startupTransitionMs: 5 * 60_000,     // 5 minutes for consumption to stabilize after startup
      startupDebounceMs: 5 * 60_000,       // additional 5 minutes before subsequent changes
      fanOnlyTimeoutMs: 30 * 60_000,       // 30 minutes before auto-off from fan-only
    }
  },
  {
    kind: "boolean",
    entityId: "switch.germination_shelf",
    consumptionEntityId: "sensor.germination_shelf_current_consumption",
    priority: 2,
    name: "Germination Shelf",
    opts: {
      expectedConsumption: 80,
      changeTransitionMs: 5000, // 5 seconds for consumption to stabilize after on/off
      turnOffDebounce: 5 * 60_000, // 5 minutes debounce after turning off
      turnOnDebounce: 1 * 60_000, // 1 minute debounce after turning on
    },
  },
  {
    kind: "boolean",
    entityId: "switch.towel_rail",
    consumptionEntityId: "sensor.towel_rail_current_consumption",
    priority: 2,
    name: "Towel Rail",
    opts: {
      expectedConsumption: 80,
      changeTransitionMs: 10_000, // 10 seconds for consumption to stabilize after on/off
      turnOffDebounce: 15 * 60_000, // 15 minutes debounce after turning off
      turnOnDebounce: 5 * 60_000, // 5 minutes debounce after turning on
    },
  },
  {
    kind: "boolean",
    entityId: "switch.subfloor_fan",
    consumptionEntityId: "sensor.subfloor_fan_current_consumption",
    priority: 3,
    name: "Subfloor Fan",
    opts: {
      expectedConsumption: 50,
      changeTransitionMs: 10_000, // 10 seconds for consumption to stabilize after on/off
      turnOffDebounce: 15 * 60_000, // 15 minutes debounce after turning off
      turnOnDebounce: 5 * 60_000, // 5 minutes debounce after turning on
    },
  },
  {
    kind: "dehumidifier",
    entityId: "humidifier.kogan_smart_dehumidifier",
    consumptionEntityId: "sensor.dehumidifier_current_consumption",
    currentHumidityEntityId: "sensor.dehumidifier_climate_humidity",
    name: "Dehumidifier",
    priority: 4,
    opts: {
      minSetpoint: 40,
      maxSetpoint: 80,
      setpointStep: 5,
      expectedDehumidifyingConsumption: 250,
      expectedFanOnlyConsumption: 30,
      fanOnlyTimeoutMs: 30 * 60_000, // 30 minutes
      setpointChangeTransitionMs: 30_000, // 30 seconds for consumption to stabilize
      setpointDebounceMs: 2 * 60_000, // 2 minutes before subsequent changes
    },
  },
  {
    kind: "direct_consumption",
    name: "Tesla Charger",
    priority: 100, // Last priority.
    entityId: "number.tesla_ble_972a00_charging_amps",
    consumptionEntityId: "sensor.tesla_wall_connector_power",
    voltageEntityId: "sensor.tesla_wall_connector_grid_voltage",
    enableEntityId: "switch.charger",
    canEnableEntityId: "binary_sensor.daytime_load_tesla_can_start_charging",
    opts: {
      startingMinCurrent: 5,
      maxCurrent: 20,
      currentStep: 1,
      changeTransitionMs: 15_000, // 15 seconds for consumption to stabilize after on/off
      debounceMs: 15_000, // additional 15 seconds debounce before further changes
      // <= 3A for > 10 minutes
      stoppingThreshold: 3,
      stoppingTimeoutMs: 10 * 60_000,
    }
  }
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

  pvProductionActivationThreshold: 600,
  pvProductionActivationDelayMs: 15 * 60 * 1000, // 15 minutes

  maxConsumptionBeforeSheddingLoad: 250,
  minConsumptionBeforeAddingLoad: -400,
  desiredGridConsumption: -300,
};
