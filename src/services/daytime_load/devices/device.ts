import { BooleanDevice } from "./boolean_device";
import { ClimateDevice } from "./climate_device";
import { DirectConsumptionDevice } from "./direct_consumption_device";
import { HumidifierDevice } from "./humidifier_device";

export type Device =
  | BooleanDevice
  | ClimateDevice
  | DirectConsumptionDevice
  | HumidifierDevice;
