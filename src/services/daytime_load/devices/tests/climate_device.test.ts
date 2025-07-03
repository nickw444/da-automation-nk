import { TestRunner } from "@digital-alchemy/core";
import { LIB_HASS } from "@digital-alchemy/hass";
import { LIB_MOCK_ASSISTANT } from "@digital-alchemy/hass/mock-assistant";
import {
  ClimateDevice,
  IClimateHassControls,
  calculateSetpointForTargetConsumption,
} from "../climate_device";

const runner = TestRunner()
  .appendLibrary(LIB_HASS)
  .appendLibrary(LIB_MOCK_ASSISTANT);

describe("ClimateDevice", () => {
  // Mock hassControls for testing
  const mockHassControls: IClimateHassControls = {
    desiredSetpoint: 22,
    desiredMode: "heat",
  };

  // Use real entity IDs from fixtures
  const CLIMATE_ENTITY = "climate.hallway";
  const CONSUMPTION_SENSOR = "sensor.air_conditioning_power";

  describe("Capacity calculations when device is off", () => {
    it("should return correct capacity when entity is off and mode is heat", async () => {
      await runner
        .bootLibrariesFirst()
        .setup(({ mock_assistant }) => {
          mock_assistant.entity.setupState({
            [CLIMATE_ENTITY]: { state: "off" },
            [CONSUMPTION_SENSOR]: { state: 0 },
          });
        })
        .run(({ hass }) => {
          const entityRef = hass.refBy.id(CLIMATE_ENTITY);
          const consumptionRef = hass.refBy.id(CONSUMPTION_SENSOR);
          const device = new ClimateDevice(
            entityRef,
            consumptionRef,
            50, // fanOnlyExpectedConsumption
            300, // heatMinExpectedConsumption
            200, // coolMinExpectedConsumption
            1200, // heatMaxExpectedConsumption
            1000, // coolMaxExpectedConsumption
            "Test Climate Device",
            1,
            mockHassControls,
          );

          // When device is off, it can increase consumption based on desired mode
          expect(device.minIncreaseCapacity).toBe(300); // heatMinExpectedConsumption
          expect(device.maxIncreaseCapacity).toBe(1200); // heatMaxExpectedConsumption

          // When device is off, it cannot decrease consumption
          expect(device.minDecreaseCapacity).toBe(0);
          expect(device.maxDecreaseCapacity).toBe(0);
        });
    });

    it("should return correct capacity when entity is off and mode is cool", async () => {
      const coolModeControls: IClimateHassControls = {
        desiredSetpoint: 22,
        desiredMode: "cool",
      };

      await runner
        .bootLibrariesFirst()
        .setup(({ mock_assistant }) => {
          mock_assistant.entity.setupState({
            [CLIMATE_ENTITY]: { state: "off" },
            [CONSUMPTION_SENSOR]: { state: 0 },
          });
        })
        .run(({ hass }) => {
          const entityRef = hass.refBy.id(CLIMATE_ENTITY);
          const consumptionRef = hass.refBy.id(CONSUMPTION_SENSOR);
          const device = new ClimateDevice(
            entityRef,
            consumptionRef,
            50, // fanOnlyExpectedConsumption
            300, // heatMinExpectedConsumption
            200, // coolMinExpectedConsumption
            1200, // heatMaxExpectedConsumption
            1000, // coolMaxExpectedConsumption
            "Test Climate Device",
            1,
            coolModeControls,
          );

          // When device is off, it can increase consumption based on desired mode
          expect(device.minIncreaseCapacity).toBe(200); // coolMinExpectedConsumption
          expect(device.maxIncreaseCapacity).toBe(1000); // coolMaxExpectedConsumption

          // When device is off, it cannot decrease consumption
          expect(device.minDecreaseCapacity).toBe(0);
          expect(device.maxDecreaseCapacity).toBe(0);
        });
    });
  });

  describe("Capacity calculations when device is running", () => {
    it("should return correct capacity when entity is heating", async () => {
      await runner
        .bootLibrariesFirst()
        .setup(({ mock_assistant }) => {
          mock_assistant.entity.setupState({
            [CLIMATE_ENTITY]: { state: "heat" },
            [CONSUMPTION_SENSOR]: { state: 500 },
          });
        })
        .run(({ hass }) => {
          const entityRef = hass.refBy.id(CLIMATE_ENTITY);
          const consumptionRef = hass.refBy.id(CONSUMPTION_SENSOR);
          const device = new ClimateDevice(
            entityRef,
            consumptionRef,
            50, // fanOnlyExpectedConsumption
            300, // heatMinExpectedConsumption
            200, // coolMinExpectedConsumption
            1200, // heatMaxExpectedConsumption
            1000, // coolMaxExpectedConsumption
            "Test Climate Device",
            1,
            mockHassControls,
          );

          // When device is heating, it can increase consumption up to max
          expect(device.minIncreaseCapacity).toBe(0);
          expect(device.maxIncreaseCapacity).toBe(700); // 1200 - 500

          // When device is heating, it can decrease consumption down to min
          expect(device.minDecreaseCapacity).toBe(0);
          expect(device.maxDecreaseCapacity).toBe(200); // 500 - 300
        });
    });

    it("should return correct capacity when entity is cooling", async () => {
      await runner
        .bootLibrariesFirst()
        .setup(({ mock_assistant }) => {
          mock_assistant.entity.setupState({
            [CLIMATE_ENTITY]: { state: "cool" },
            [CONSUMPTION_SENSOR]: { state: 400 },
          });
        })
        .run(({ hass }) => {
          const entityRef = hass.refBy.id(CLIMATE_ENTITY);
          const consumptionRef = hass.refBy.id(CONSUMPTION_SENSOR);
          const device = new ClimateDevice(
            entityRef,
            consumptionRef,
            50, // fanOnlyExpectedConsumption
            300, // heatMinExpectedConsumption
            200, // coolMinExpectedConsumption
            1200, // heatMaxExpectedConsumption
            1000, // coolMaxExpectedConsumption
            "Test Climate Device",
            1,
            mockHassControls,
          );

          // When device is cooling, it can increase consumption up to max
          expect(device.minIncreaseCapacity).toBe(0);
          expect(device.maxIncreaseCapacity).toBe(600); // 1000 - 400

          // When device is cooling, it can decrease consumption down to min
          expect(device.minDecreaseCapacity).toBe(0);
          expect(device.maxDecreaseCapacity).toBe(200); // 400 - 200
        });
    });
  });

  describe("Service calls and state machine", () => {
    it("should turn on device when increaseConsumptionBy is called on off device", async () => {
      await runner
        .bootLibrariesFirst()
        .setup(({ mock_assistant }) => {
          mock_assistant.entity.setupState({
            [CLIMATE_ENTITY]: {
              state: "off",
              attributes: { current_temperature: 20, temperature: 22 } as any,
            },
            [CONSUMPTION_SENSOR]: { state: 0 },
          });
        })
        .run(({ hass }) => {
          const entityRef = hass.refBy.id(CLIMATE_ENTITY);
          const consumptionRef = hass.refBy.id(CONSUMPTION_SENSOR);
          const device = new ClimateDevice(
            entityRef,
            consumptionRef,
            50, // fanOnlyExpectedConsumption
            300, // heatMinExpectedConsumption
            200, // coolMinExpectedConsumption
            1200, // heatMaxExpectedConsumption
            1000, // coolMaxExpectedConsumption
            "Test Climate Device",
            1,
            mockHassControls,
          );

          // Spy on the service call
          const turnOnSpy = vi.spyOn(hass.call.climate, "turn_on");

          // Call increaseConsumptionBy with valid amount
          device.increaseConsumptionBy(300);

          // Verify turn_on service was called
          expect(turnOnSpy).toHaveBeenCalled();
        });
    });

    it.only("should turn off device when decreaseConsumptionBy amount equals or exceeds current consumption", async () => {
      await runner
        .bootLibrariesFirst()
        .setup(({ mock_assistant }) => {
          mock_assistant.entity.setupState({
            [CLIMATE_ENTITY]: {
              state: "heat",
              attributes: { current_temperature: 18, temperature: 22 } as any,
            },
            [CONSUMPTION_SENSOR]: { state: 300 }, // Set to exactly the min so we can turn off
          });
        })
        .run(({ hass }) => {
          const entityRef = hass.refBy.id(CLIMATE_ENTITY);
          const consumptionRef = hass.refBy.id(CONSUMPTION_SENSOR);
          const device = new ClimateDevice(
            entityRef,
            consumptionRef,
            50, // fanOnlyExpectedConsumption
            300, // heatMinExpectedConsumption
            200, // coolMinExpectedConsumption
            1200, // heatMaxExpectedConsumption
            1000, // coolMaxExpectedConsumption
            "Test Climate Device",
            1,
            mockHassControls,
          );

          // Spy on the service call
          const turnOffSpy = vi.spyOn(hass.call.climate, "turn_off");

          // Call decreaseConsumptionBy with amount that equals current consumption (to turn off)
          device.decreaseConsumptionBy(300);

          // Verify turn_off service was called
          expect(turnOffSpy).toHaveBeenCalled();
        });
    });

    it("should call set_temperature when adjusting consumption on running device", async () => {
      await runner
        .bootLibrariesFirst()
        .setup(({ mock_assistant }) => {
          mock_assistant.entity.setupState({
            [CLIMATE_ENTITY]: {
              state: "heat",
              attributes: { current_temperature: 18, temperature: 22 } as any,
            },
            [CONSUMPTION_SENSOR]: { state: 500 },
          });
        })
        .run(({ hass }) => {
          const entityRef = hass.refBy.id(CLIMATE_ENTITY);
          const consumptionRef = hass.refBy.id(CONSUMPTION_SENSOR);
          const device = new ClimateDevice(
            entityRef,
            consumptionRef,
            50, // fanOnlyExpectedConsumption
            300, // heatMinExpectedConsumption
            200, // coolMinExpectedConsumption
            1200, // heatMaxExpectedConsumption
            1000, // coolMaxExpectedConsumption
            "Test Climate Device",
            1,
            mockHassControls,
          );

          // Spy on the service call
          const setTempSpy = vi.spyOn(hass.call.climate, "set_temperature");

          // Call increaseConsumptionBy with valid amount
          device.increaseConsumptionBy(200);

          // Verify set_temperature service was called
          expect(setTempSpy).toHaveBeenCalledWith({
            hvac_mode: "heat",
            temperature: expect.any(Number),
          });

          // Verify state machine is in pending state
          expect(device.hasChangePending).toBe("decrease"); // Note: climate uses decrease for increase consumption
        });
    });
  });

  describe("Consumption calculations", () => {
    it("should return correct current consumption", async () => {
      await runner
        .bootLibrariesFirst()
        .setup(({ mock_assistant }) => {
          mock_assistant.entity.setupState({
            [CLIMATE_ENTITY]: { state: "heat" },
            [CONSUMPTION_SENSOR]: { state: 675 },
          });
        })
        .run(({ hass }) => {
          const entityRef = hass.refBy.id(CLIMATE_ENTITY);
          const consumptionRef = hass.refBy.id(CONSUMPTION_SENSOR);
          const device = new ClimateDevice(
            entityRef,
            consumptionRef,
            50, // fanOnlyExpectedConsumption
            300, // heatMinExpectedConsumption
            200, // coolMinExpectedConsumption
            1200, // heatMaxExpectedConsumption
            1000, // coolMaxExpectedConsumption
            "Test Climate Device",
            1,
            mockHassControls,
          );

          expect(device.currentConsumption).toBe(675);
        });
    });

    it("should return correct expected future consumption when change is pending", async () => {
      await runner
        .bootLibrariesFirst()
        .setup(({ mock_assistant }) => {
          mock_assistant.entity.setupState({
            [CLIMATE_ENTITY]: {
              state: "heat",
              attributes: { current_temperature: 18, temperature: 22 } as any,
            },
            [CONSUMPTION_SENSOR]: { state: 500 },
          });
        })
        .run(({ hass }) => {
          const entityRef = hass.refBy.id(CLIMATE_ENTITY);
          const consumptionRef = hass.refBy.id(CONSUMPTION_SENSOR);
          const device = new ClimateDevice(
            entityRef,
            consumptionRef,
            50, // fanOnlyExpectedConsumption
            300, // heatMinExpectedConsumption
            200, // coolMinExpectedConsumption
            1200, // heatMaxExpectedConsumption
            1000, // coolMaxExpectedConsumption
            "Test Climate Device",
            1,
            mockHassControls,
          );

          // Trigger increase to put device in pending state
          device.increaseConsumptionBy(200);

          // Test expected future consumption when change is pending
          expect(device.expectedFutureConsumption).toBe(700); // 500 + 200
        });
    });

    it("should fallback to 0 when sensor returns null/undefined", async () => {
      await runner
        .bootLibrariesFirst()
        .setup(({ mock_assistant }) => {
          mock_assistant.entity.setupState({
            [CLIMATE_ENTITY]: { state: "off" },
            [CONSUMPTION_SENSOR]: { state: null },
          });
        })
        .run(({ hass }) => {
          const entityRef = hass.refBy.id(CLIMATE_ENTITY);
          const consumptionRef = hass.refBy.id(CONSUMPTION_SENSOR);
          const device = new ClimateDevice(
            entityRef,
            consumptionRef,
            50, // fanOnlyExpectedConsumption
            300, // heatMinExpectedConsumption
            200, // coolMinExpectedConsumption
            1200, // heatMaxExpectedConsumption
            1000, // coolMaxExpectedConsumption
            "Test Climate Device",
            1,
            mockHassControls,
          );

          // Current consumption should return 0 when sensor is null
          expect(device.currentConsumption).toBe(0);
        });
    });
  });

  describe("Error handling and edge cases", () => {
    it("should throw error when trying to increase consumption beyond capacity", async () => {
      await runner
        .bootLibrariesFirst()
        .setup(({ mock_assistant }) => {
          mock_assistant.entity.setupState({
            [CLIMATE_ENTITY]: { state: "heat" },
            [CONSUMPTION_SENSOR]: { state: 1100 },
          });
        })
        .run(({ hass }) => {
          const entityRef = hass.refBy.id(CLIMATE_ENTITY);
          const consumptionRef = hass.refBy.id(CONSUMPTION_SENSOR);
          const device = new ClimateDevice(
            entityRef,
            consumptionRef,
            50, // fanOnlyExpectedConsumption
            300, // heatMinExpectedConsumption
            200, // coolMinExpectedConsumption
            1200, // heatMaxExpectedConsumption
            1000, // coolMaxExpectedConsumption
            "Test Climate Device",
            1,
            mockHassControls,
          );

          // When device is near max capacity, trying to increase beyond should throw
          expect(() => device.increaseConsumptionBy(200)).toThrow(
            "Cannot increase consumption for Test Climate Device: amount 200 exceeds maximum 100",
          );
        });
    });

    it("should throw error when trying to decrease consumption beyond capacity", async () => {
      await runner
        .bootLibrariesFirst()
        .setup(({ mock_assistant }) => {
          mock_assistant.entity.setupState({
            [CLIMATE_ENTITY]: { state: "heat" },
            [CONSUMPTION_SENSOR]: { state: 320 },
          });
        })
        .run(({ hass }) => {
          const entityRef = hass.refBy.id(CLIMATE_ENTITY);
          const consumptionRef = hass.refBy.id(CONSUMPTION_SENSOR);
          const device = new ClimateDevice(
            entityRef,
            consumptionRef,
            50, // fanOnlyExpectedConsumption
            300, // heatMinExpectedConsumption
            200, // coolMinExpectedConsumption
            1200, // heatMaxExpectedConsumption
            1000, // coolMaxExpectedConsumption
            "Test Climate Device",
            1,
            mockHassControls,
          );

          // When device is near min capacity, trying to decrease beyond should throw
          expect(() => device.decreaseConsumptionBy(50)).toThrow(
            "Cannot decrease consumption for Test Climate Device: amount 50 exceeds maximum 20",
          );
        });
    });

    it("should handle unknown climate state", async () => {
      await runner
        .bootLibrariesFirst()
        .setup(({ mock_assistant }) => {
          mock_assistant.entity.setupState({
            [CLIMATE_ENTITY]: { state: "unknown" as any },
            [CONSUMPTION_SENSOR]: { state: 0 },
          });
        })
        .run(({ hass }) => {
          const entityRef = hass.refBy.id(CLIMATE_ENTITY);
          const consumptionRef = hass.refBy.id(CONSUMPTION_SENSOR);
          const device = new ClimateDevice(
            entityRef,
            consumptionRef,
            50, // fanOnlyExpectedConsumption
            300, // heatMinExpectedConsumption
            200, // coolMinExpectedConsumption
            1200, // heatMaxExpectedConsumption
            1000, // coolMaxExpectedConsumption
            "Test Climate Device",
            1,
            mockHassControls,
          );

          // Should throw error for unknown state
          expect(() => device.minIncreaseCapacity).toThrow(
            "Unhandled state: unknown",
          );
          expect(() => device.maxIncreaseCapacity).toThrow(
            "Unhandled state: unknown",
          );
          expect(() => device.minDecreaseCapacity).toThrow(
            "Unhandled state: unknown",
          );
          expect(() => device.maxDecreaseCapacity).toThrow(
            "Unhandled state: unknown",
          );
        });
    });
  });

  describe("State machine timeout behavior", () => {
    it("should transition state machine back to IDLE after timeout", async () => {
      // Use fake timers to control setTimeout
      vi.useFakeTimers();

      try {
        await runner
          .bootLibrariesFirst()
          .setup(({ mock_assistant }) => {
            mock_assistant.entity.setupState({
              [CLIMATE_ENTITY]: {
                state: "heat",
                attributes: { current_temperature: 18, temperature: 22 } as any,
              },
              [CONSUMPTION_SENSOR]: { state: 500 },
            });
          })
          .run(({ hass }) => {
            const entityRef = hass.refBy.id(CLIMATE_ENTITY);
            const consumptionRef = hass.refBy.id(CONSUMPTION_SENSOR);
            const device = new ClimateDevice(
              entityRef,
              consumptionRef,
              50, // fanOnlyExpectedConsumption
              300, // heatMinExpectedConsumption
              200, // coolMinExpectedConsumption
              1200, // heatMaxExpectedConsumption
              1000, // coolMaxExpectedConsumption
              "Test Climate Device",
              1,
              mockHassControls,
            );

            // Call increaseConsumptionBy to trigger state machine transition
            device.increaseConsumptionBy(200);

            // Verify state machine is in pending state
            expect(device.hasChangePending).toBe("decrease");

            // Advance timers by 60000ms (60 seconds) to trigger timeout
            vi.advanceTimersByTime(60000);

            // Verify state machine is back to IDLE
            expect(device.hasChangePending).toBeUndefined();
          });
      } finally {
        // Always restore real timers
        vi.useRealTimers();
      }
    });
  });
});

describe("calculateSetpointForTargetConsumption", () => {
  const baseParams = {
    coolMinExpectedConsumption: 200,
    coolMaxExpectedConsumption: 1000,
    heatMinExpectedConsumption: 300,
    heatMaxExpectedConsumption: 1200,
  };

  describe("Cooling Mode", () => {
    it("should decrease setpoint when increasing consumption in cool mode", () => {
      const result = calculateSetpointForTargetConsumption(
        600, // target consumption
        "cool",
        24, // current room temp
        26, // current setpoint
        400, // current consumption
        baseParams.coolMinExpectedConsumption,
        baseParams.coolMaxExpectedConsumption,
        baseParams.heatMinExpectedConsumption,
        baseParams.heatMaxExpectedConsumption,
        18, // user desired setpoint limit (min temp)
      );

      expect(result).toBeLessThan(26); // Should be lower than current setpoint
      expect(result).toBeGreaterThanOrEqual(18); // Should respect user limit
      expect(result % 0.5).toBe(0); // Should be rounded to nearest 0.5°
    });

    it("should respect minimum temperature limit in cool mode", () => {
      const result = calculateSetpointForTargetConsumption(
        1000, // max consumption
        "cool",
        20, // current room temp
        22, // current setpoint
        200, // current consumption
        baseParams.coolMinExpectedConsumption,
        baseParams.coolMaxExpectedConsumption,
        baseParams.heatMinExpectedConsumption,
        baseParams.heatMaxExpectedConsumption,
        19, // user desired setpoint limit (min temp)
      );

      expect(result).toBeGreaterThanOrEqual(19);
    });

    it("should increase setpoint when decreasing consumption in cool mode", () => {
      const result = calculateSetpointForTargetConsumption(
        200, // target consumption
        "cool",
        22, // current room temp
        20, // current setpoint
        500, // current consumption (at minimum)
        baseParams.coolMinExpectedConsumption,
        baseParams.coolMaxExpectedConsumption,
        baseParams.heatMinExpectedConsumption,
        baseParams.heatMaxExpectedConsumption,
        18, // user desired setpoint limit
      );

      expect(result).toBeGreaterThan(20); // Should increase setpoint when reducing consumption
      expect(result % 0.5).toBe(0);
    });
  });

  describe("Heating Mode", () => {
    it("should increase setpoint when increasing consumption in heat mode", () => {
      const result = calculateSetpointForTargetConsumption(
        800, // target consumption
        "heat",
        20, // current room temp
        22, // current setpoint
        500, // current consumption
        baseParams.coolMinExpectedConsumption,
        baseParams.coolMaxExpectedConsumption,
        baseParams.heatMinExpectedConsumption,
        baseParams.heatMaxExpectedConsumption,
        26, // user desired setpoint limit (max temp)
      );

      expect(result).toBeGreaterThan(22); // Should be higher than current setpoint
      expect(result).toBeLessThanOrEqual(26); // Should respect user limit
      expect(result % 0.5).toBe(0); // Should be rounded to nearest 0.5°
    });

    it("should respect maximum temperature limit in heat mode", () => {
      const result = calculateSetpointForTargetConsumption(
        1200, // max consumption
        "heat",
        18, // current room temp
        20, // current setpoint
        300, // current consumption
        baseParams.coolMinExpectedConsumption,
        baseParams.coolMaxExpectedConsumption,
        baseParams.heatMinExpectedConsumption,
        baseParams.heatMaxExpectedConsumption,
        23, // user desired setpoint limit (max temp)
      );

      expect(result).toBeLessThanOrEqual(23);
    });

    it("should handle consumption at minimum in heat mode", () => {
      const result = calculateSetpointForTargetConsumption(
        600, // target consumption
        "heat",
        22, // current room temp
        24, // current setpoint
        300, // current consumption (at minimum)
        baseParams.coolMinExpectedConsumption,
        baseParams.coolMaxExpectedConsumption,
        baseParams.heatMinExpectedConsumption,
        baseParams.heatMaxExpectedConsumption,
        28, // user desired setpoint limit
      );

      expect(result).toBeGreaterThan(22); // Should increase setpoint when increasing consumption
      expect(result % 0.5).toBe(0);
    });
  });

  describe("Edge Cases and Bounds", () => {
    it("should clamp target consumption to maximum bound", () => {
      const result = calculateSetpointForTargetConsumption(
        1500, // above maximum
        "heat",
        20, // current room temp
        22, // current setpoint
        500, // current consumption
        baseParams.coolMinExpectedConsumption,
        baseParams.coolMaxExpectedConsumption,
        baseParams.heatMinExpectedConsumption,
        baseParams.heatMaxExpectedConsumption,
        28, // user desired setpoint limit
      );

      expect(result).toBeGreaterThan(20); // Should move toward maximum consumption setpoint
    });

    it("should handle zero current differential gracefully", () => {
      const result = calculateSetpointForTargetConsumption(
        600, // target consumption
        "cool",
        24, // current room temp
        24, // current setpoint (same as room temp)
        400, // current consumption
        baseParams.coolMinExpectedConsumption,
        baseParams.coolMaxExpectedConsumption,
        baseParams.heatMinExpectedConsumption,
        baseParams.heatMaxExpectedConsumption,
        18, // user desired setpoint limit
      );

      expect(typeof result).toBe("number");
      expect(result % 0.5).toBe(0);
    });

    it("should always round to nearest 0.5 degrees", () => {
      const result = calculateSetpointForTargetConsumption(
        550, // target consumption
        "heat",
        21.3, // current room temp
        23.7, // current setpoint
        450, // current consumption
        baseParams.coolMinExpectedConsumption,
        baseParams.coolMaxExpectedConsumption,
        baseParams.heatMinExpectedConsumption,
        baseParams.heatMaxExpectedConsumption,
        27, // user desired setpoint limit
      );

      expect(result % 0.5).toBe(0);
    });
  });

  describe("Consumption Ratio Scaling", () => {
    it("should scale differential proportionally to consumption ratio change", () => {
      // Test scenario: doubling consumption should roughly double the differential
      const currentConsumption = 400;
      const targetConsumption = 600;
      const currentSetpoint = 26;
      const roomTemp = 24;

      const result = calculateSetpointForTargetConsumption(
        targetConsumption,
        "cool",
        roomTemp,
        currentSetpoint,
        currentConsumption,
        baseParams.coolMinExpectedConsumption,
        baseParams.coolMaxExpectedConsumption,
        baseParams.heatMinExpectedConsumption,
        baseParams.heatMaxExpectedConsumption,
        18, // user desired setpoint limit
      );

      const currentDiff = Math.abs(roomTemp - currentSetpoint);
      const newDiff = Math.abs(roomTemp - result);

      // New differential should be larger since we're increasing consumption
      expect(newDiff).toBeGreaterThan(currentDiff);
    });

    it("should handle very low current consumption ratios", () => {
      const result = calculateSetpointForTargetConsumption(
        800, // target consumption
        "cool",
        24, // current room temp
        24.1, // very close to room temp
        205, // very low current consumption
        baseParams.coolMinExpectedConsumption,
        baseParams.coolMaxExpectedConsumption,
        baseParams.heatMinExpectedConsumption,
        baseParams.heatMaxExpectedConsumption,
        18, // user desired setpoint limit
      );

      expect(typeof result).toBe("number");
      expect(result).toBeGreaterThanOrEqual(18);
      expect(result % 0.5).toBe(0);
    });
  });
});
