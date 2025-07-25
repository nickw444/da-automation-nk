import { TServiceParams } from "@digital-alchemy/core";
import {
  BooleanEntityWrapper,
  IBooleanEntityWrapper,
} from "../entities/boolean_entity_wrapper";
import {
  BinarySensorEntityWrapper,
  IBinarySensorEntityWrapper,
} from "../entities/binary_sensor_entity_wrapper";
import {
  ISensorEntityWrapper,
  SensorEntityWrapper,
} from "../entities/sensor_entity_wrapper";
import {
  SimpleAutomation,
  SimpleAutomationHelper,
} from "../base/simple_automation";

const LIGHTS_OFF_DELAY_MS = 10 * 60 * 1000; // 10 minutes
const LUX_THRESHOLD = 1000;

export class BackyardAmbianceAutomation implements SimpleAutomation {
  private lightsOffTimer?: NodeJS.Timeout;
  private readonly unregisterCallbacks: (() => void)[] = [];

  constructor(
    private readonly logger: TServiceParams["logger"],
    private readonly lightEntities: IBooleanEntityWrapper[],
    private readonly doorEntity: IBinarySensorEntityWrapper,
    private readonly occupancyEntities: IBinarySensorEntityWrapper[],
    private readonly outdoorIlluminationEntity: ISensorEntityWrapper,
  ) {}

  setup(): void {
    // Door opens - turn lights on if dark enough
    const doorCallback = this.doorEntity.onUpdate((state) => {
      this.logger.info("Door state changed:", state);
      // Ignore undefined state values and only act on door opening
      if (state !== undefined && state.state === "on" && this.isDark()) {
        this.turnLightsOn();
        // Check occupancy immediately - if none detected, start timer
        this.handleOccupancyChange();
      }
    });
    this.unregisterCallbacks.push(doorCallback);

    // Occupancy changes - manage timer
    this.occupancyEntities.forEach((entity) => {
      const callback = entity.onUpdate((state) => {
        // Ignore undefined state values (entity offline/unavailable)
        if (state !== undefined) {
          this.handleOccupancyChange();
        }
      });
      this.unregisterCallbacks.push(callback);
    });

    // Lux changes - turn on lights if it gets dark with presence
    const luxCallback = this.outdoorIlluminationEntity.onUpdate((state) => {
      if (
        state !== undefined &&
        this.isDark() &&
        this.isAnyOccupancyDetected()
      ) {
        this.turnLightsOn();
        this.handleOccupancyChange();
      }
    });
    this.unregisterCallbacks.push(luxCallback);
  }

  teardown(): void {
    this.clearLightsOffTimer();
    this.unregisterCallbacks.forEach((callback) => callback());
    this.unregisterCallbacks.length = 0;
  }

  private turnLightsOn(): void {
    this.logger.info("Turning backyard lights on");
    this.clearLightsOffTimer();
    this.lightEntities.forEach((light) => light.turn_on());
  }

  private turnLightsOff(): void {
    this.logger.info("Turning backyard lights off");
    this.lightEntities.forEach((light) => light.turn_off());
  }

  private clearLightsOffTimer(): void {
    if (this.lightsOffTimer) {
      clearTimeout(this.lightsOffTimer);
      this.lightsOffTimer = undefined;
    }
  }

  private isAnyOccupancyDetected(): boolean {
    return this.occupancyEntities.some((entity) => entity.state === "on");
  }

  private isDark(): boolean {
    const luxValue = this.outdoorIlluminationEntity.state;
    if (luxValue === undefined) return false;
    const numericValue =
      typeof luxValue === "number" ? luxValue : parseFloat(luxValue);
    return numericValue < LUX_THRESHOLD;
  }

  private handleOccupancyChange(): void {
    if (this.isAnyOccupancyDetected()) {
      // Occupancy detected - clear any existing timer
      this.clearLightsOffTimer();
    } else {
      // No occupancy - start timer to turn off lights
      this.startLightsOffTimer();
    }
  }

  private startLightsOffTimer(): void {
    this.clearLightsOffTimer();
    this.logger.info(
      `Starting lights off timer (${LIGHTS_OFF_DELAY_MS / 1000 / 60} minutes)`,
    );

    this.lightsOffTimer = setTimeout(() => {
      this.turnLightsOff();
      this.lightsOffTimer = undefined;
    }, LIGHTS_OFF_DELAY_MS);
  }

  static create(params: TServiceParams): void {
    const { hass, logger } = params;
    const helper = new SimpleAutomationHelper("Backyard Ambiance", params);
    const automation = new BackyardAmbianceAutomation(
      logger,
      [
        new BooleanEntityWrapper(params.hass.refBy.id("light.festoon_lights")),
        new BooleanEntityWrapper(hass.refBy.id("light.shed_sconces")),
        new BooleanEntityWrapper(hass.refBy.id("light.back_garden")),
        new BooleanEntityWrapper(hass.refBy.id("light.deck_garden_lights")),
      ],
      new BinarySensorEntityWrapper(
        hass.refBy.id("binary_sensor.back_door_contact"),
      ),
      [
        new BinarySensorEntityWrapper(
          hass.refBy.id("binary_sensor.back_yard_person_detected"),
        ),
        new BinarySensorEntityWrapper(
          hass.refBy.id("binary_sensor.shed_motion_occupancy"),
        ),
        new BinarySensorEntityWrapper(
          hass.refBy.id("binary_sensor.shed_fp2_presence_sensor_all_zones"),
        ),
      ],
      new SensorEntityWrapper(hass.refBy.id("sensor.ecowitt_hub_solar_lux")),
    );
    helper.register(automation);
  }
}
