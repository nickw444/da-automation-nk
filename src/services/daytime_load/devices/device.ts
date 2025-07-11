import { BooleanDevice } from "./boolean_device";
import { ClimateDevice } from "./climate_device";

export type Device =
  | BooleanDevice
  | ClimateDevice
