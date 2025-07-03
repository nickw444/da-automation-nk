import { TestRunner } from "@digital-alchemy/core";
import { LIB_HASS } from "@digital-alchemy/hass";
import { LIB_MOCK_ASSISTANT } from "@digital-alchemy/hass/mock-assistant";
import { BooleanDevice } from "../boolean_device";

const runner = TestRunner()
  .appendLibrary(LIB_HASS)
  .appendLibrary(LIB_MOCK_ASSISTANT);

describe("BooleanDevice", () => {
  it("should return correct capacity when entity is off", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "switch.subfloor_fan": { state: "off" },
          "sensor.subfloor_fan_current_consumption": { state: 0 },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("switch.subfloor_fan");
        const consumptionRef = hass.refBy.id(
          "sensor.subfloor_fan_current_consumption",
        );
        const device = new BooleanDevice(
          entityRef,
          consumptionRef,
          50,
          "Test Device",
          1,
        );

        // When device is off, it can increase consumption
        expect(device.minIncreaseCapacity).toBe(50); // falls back to expectedConsumption
        expect(device.maxIncreaseCapacity).toBe(50); // falls back to expectedConsumption

        // When device is off, it cannot decrease consumption
        expect(device.minDecreaseCapacity).toBe(0);
        expect(device.maxDecreaseCapacity).toBe(0);
      });
  });

  it("should return correct capacity when entity is on", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "switch.subfloor_fan": { state: "on" },
          "sensor.subfloor_fan_current_consumption": { state: 45 },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("switch.subfloor_fan");
        const consumptionRef = hass.refBy.id(
          "sensor.subfloor_fan_current_consumption",
        );
        const device = new BooleanDevice(
          entityRef,
          consumptionRef,
          50,
          "Test Device",
          1,
        );

        // When device is on, it cannot increase consumption
        expect(device.minIncreaseCapacity).toBe(0);
        expect(device.maxIncreaseCapacity).toBe(0);

        // When device is on, it can decrease consumption
        expect(device.minDecreaseCapacity).toBe(45); // actual consumption
        expect(device.maxDecreaseCapacity).toBe(45); // actual consumption
      });
  });

  it("should turn on device when increaseConsumptionBy is called", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "switch.subfloor_fan": { state: "off" },
          "sensor.subfloor_fan_current_consumption": { state: 0 },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("switch.subfloor_fan");
        const consumptionRef = hass.refBy.id(
          "sensor.subfloor_fan_current_consumption",
        );
        const device = new BooleanDevice(
          entityRef,
          consumptionRef,
          50,
          "Test Device",
          1,
        );

        // Spy on the service call
        const turnOnSpy = vi.spyOn(hass.call.switch, "turn_on");

        // Call increaseConsumptionBy with the device's capacity
        device.increaseConsumptionBy(50);

        // Verify turn_on service was called with correct entity
        expect(turnOnSpy).toHaveBeenCalledWith({
          entity_id: "switch.subfloor_fan",
        });

        // Verify state machine is in INCREASE_PENDING state
        expect(device.hasChangePending).toBe("increase");
      });
  });

  it("should turn off device when decreaseConsumptionBy is called", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "switch.subfloor_fan": { state: "on" },
          "sensor.subfloor_fan_current_consumption": { state: 45 },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("switch.subfloor_fan");
        const consumptionRef = hass.refBy.id(
          "sensor.subfloor_fan_current_consumption",
        );
        const device = new BooleanDevice(
          entityRef,
          consumptionRef,
          50,
          "Test Device",
          1,
        );

        // Spy on the service call
        const turnOffSpy = vi.spyOn(hass.call.switch, "turn_off");

        // Call decreaseConsumptionBy with the device's capacity
        device.decreaseConsumptionBy(45);

        // Verify turn_off service was called with correct entity
        expect(turnOffSpy).toHaveBeenCalledWith({
          entity_id: "switch.subfloor_fan",
        });

        // Verify state machine is in DECREASE_PENDING state
        expect(device.hasChangePending).toBe("decrease");
      });
  });

  it("should not call turn_on when device is already on and has no increase capacity", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "switch.subfloor_fan": { state: "on" },
          "sensor.subfloor_fan_current_consumption": { state: 45 },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("switch.subfloor_fan");
        const consumptionRef = hass.refBy.id(
          "sensor.subfloor_fan_current_consumption",
        );
        const device = new BooleanDevice(
          entityRef,
          consumptionRef,
          50,
          "Test Device",
          1,
        );

        // Spy on the service call
        const turnOnSpy = vi.spyOn(hass.call.switch, "turn_on");

        // When device is already on, max increase capacity is 0, so calling increaseConsumptionBy should throw
        expect(() => device.increaseConsumptionBy(10)).toThrow(
          "Cannot increase consumption for Test Device: amount 10 exceeds maximum 0",
        );

        // Verify turn_on was NOT called
        expect(turnOnSpy).not.toHaveBeenCalled();

        // Verify no change is pending
        expect(device.hasChangePending).toBeUndefined();
      });
  });

  it("should not call turn_off when device is already off and has no decrease capacity", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "switch.subfloor_fan": { state: "off" },
          "sensor.subfloor_fan_current_consumption": { state: 0 },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("switch.subfloor_fan");
        const consumptionRef = hass.refBy.id(
          "sensor.subfloor_fan_current_consumption",
        );
        const device = new BooleanDevice(
          entityRef,
          consumptionRef,
          50,
          "Test Device",
          1,
        );

        // Spy on the service call
        const turnOffSpy = vi.spyOn(hass.call.switch, "turn_off");

        // When device is already off, max decrease capacity is 0, so calling decreaseConsumptionBy should throw
        expect(() => device.decreaseConsumptionBy(10)).toThrow(
          "Cannot decrease consumption for Test Device: amount 10 exceeds maximum 0",
        );

        // Verify turn_off was NOT called
        expect(turnOffSpy).not.toHaveBeenCalled();

        // Verify no change is pending
        expect(device.hasChangePending).toBeUndefined();
      });
  });

  it("should return correct current consumption", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "switch.subfloor_fan": { state: "on" },
          "sensor.subfloor_fan_current_consumption": { state: 42 },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("switch.subfloor_fan");
        const consumptionRef = hass.refBy.id(
          "sensor.subfloor_fan_current_consumption",
        );
        const device = new BooleanDevice(
          entityRef,
          consumptionRef,
          50,
          "Test Device",
          1,
        );

        // Test current consumption
        expect(device.currentConsumption).toBe(42);
      });
  });

  it("should return correct expected future consumption when increase is pending", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "switch.subfloor_fan": { state: "off" },
          "sensor.subfloor_fan_current_consumption": { state: 0 },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("switch.subfloor_fan");
        const consumptionRef = hass.refBy.id(
          "sensor.subfloor_fan_current_consumption",
        );
        const device = new BooleanDevice(
          entityRef,
          consumptionRef,
          50,
          "Test Device",
          1,
        );

        // Trigger increase to put device in pending state
        device.increaseConsumptionBy(50);

        // Test expected future consumption when increase is pending
        expect(device.expectedFutureConsumption).toBe(50);
      });
  });

  it("should return correct expected future consumption when decrease is pending", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "switch.subfloor_fan": { state: "on" },
          "sensor.subfloor_fan_current_consumption": { state: 45 },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("switch.subfloor_fan");
        const consumptionRef = hass.refBy.id(
          "sensor.subfloor_fan_current_consumption",
        );
        const device = new BooleanDevice(
          entityRef,
          consumptionRef,
          50,
          "Test Device",
          1,
        );

        // Trigger decrease to put device in pending state
        device.decreaseConsumptionBy(45);

        // Test expected future consumption when decrease is pending
        expect(device.expectedFutureConsumption).toBe(0);
      });
  });

  it("should fallback to expectedConsumption when sensor returns null/undefined", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "switch.subfloor_fan": { state: "off" },
          "sensor.subfloor_fan_current_consumption": { state: null },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("switch.subfloor_fan");
        const consumptionRef = hass.refBy.id(
          "sensor.subfloor_fan_current_consumption",
        );
        const device = new BooleanDevice(
          entityRef,
          consumptionRef,
          50,
          "Test Device",
          1,
        );

        // When sensor returns null, should fallback to expectedConsumption for capacity
        expect(device.minIncreaseCapacity).toBe(50);
        expect(device.maxIncreaseCapacity).toBe(50);

        // Current consumption should return 0 when sensor is null
        expect(device.currentConsumption).toBe(0);
      });
  });

  it("should transition state machine back to IDLE after timeout", async () => {
    // Use fake timers to control setTimeout
    vi.useFakeTimers();

    try {
      await runner
        .bootLibrariesFirst()
        .setup(({ mock_assistant }) => {
          mock_assistant.entity.setupState({
            "switch.subfloor_fan": { state: "off" },
            "sensor.subfloor_fan_current_consumption": { state: 0 },
          });
        })
        .run(({ hass }) => {
          const entityRef = hass.refBy.id("switch.subfloor_fan");
          const consumptionRef = hass.refBy.id(
            "sensor.subfloor_fan_current_consumption",
          );
          const device = new BooleanDevice(
            entityRef,
            consumptionRef,
            50,
            "Test Device",
            1,
          );

          // Call increaseConsumptionBy to trigger state machine transition
          device.increaseConsumptionBy(50);

          // Verify state machine is in INCREASE_PENDING state
          expect(device.hasChangePending).toBe("increase");

          // Advance timers by 1000ms to trigger timeout
          vi.advanceTimersByTime(1000);

          // Verify state machine is back to IDLE
          expect(device.hasChangePending).toBeUndefined();
        });
    } finally {
      // Always restore real timers
      vi.useRealTimers();
    }
  });
});
