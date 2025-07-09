import { TestRunner } from "@digital-alchemy/core";
import { LIB_HASS } from "@digital-alchemy/hass";
import { LIB_MOCK_ASSISTANT } from "@digital-alchemy/hass/mock-assistant";
import { BooleanDevice } from "../boolean_device";

const runner = TestRunner()
  .appendLibrary(LIB_HASS)
  .appendLibrary(LIB_MOCK_ASSISTANT);

describe("BooleanDevice", () => {
  it("should return correct increments when entity is off", async () => {
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
          30000, // offToOnDebounceMs
          10000, // onToOffDebounceMs
        );

        // When device is off, it can increase consumption
        expect(device.increaseIncrements).toEqual([{ delta: 50, action: "turn_on" }]);

        // When device is off, it cannot decrease consumption
        expect(device.decreaseIncrements).toEqual([]);
      });
  });

  it("should return correct increments when entity is on", async () => {
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
          30000, // offToOnDebounceMs
          10000, // onToOffDebounceMs
        );

        // When device is on, it cannot increase consumption
        expect(device.increaseIncrements).toEqual([]);

        // When device is on, it can decrease consumption
        expect(device.decreaseIncrements).toEqual([{ delta: 45, action: "turn_off" }]);
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
          30000, // offToOnDebounceMs
          10000, // onToOffDebounceMs
        );

        // Spy on the service call
        const turnOnSpy = vi.spyOn(hass.call.switch, "turn_on");

        // Call increaseConsumptionBy with the device's capacity
        device.increaseConsumptionBy({ delta: 50, action: "turn_on" });

        // Verify turn_on service was called with correct entity
        expect(turnOnSpy).toHaveBeenCalledWith({
          entity_id: "switch.subfloor_fan",
        });

        // Verify state machine is in INCREASE_PENDING state
        expect(device.changeState?.type).toBe("increase");
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
          30000, // offToOnDebounceMs
          10000, // onToOffDebounceMs
        );

        // Spy on the service call
        const turnOffSpy = vi.spyOn(hass.call.switch, "turn_off");

        // Call decreaseConsumptionBy with the device's capacity
        device.decreaseConsumptionBy({ delta: 45, action: "turn_off" });

        // Verify turn_off service was called with correct entity
        expect(turnOffSpy).toHaveBeenCalledWith({
          entity_id: "switch.subfloor_fan",
        });

        // Verify state machine is in DECREASE_PENDING state
        expect(device.changeState?.type).toBe("decrease");
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
          30000, // offToOnDebounceMs
          10000, // onToOffDebounceMs
        );

        // Spy on the service call
        const turnOnSpy = vi.spyOn(hass.call.switch, "turn_on");

        // When device is already on, increaseConsumptionBy will not do anything
        // since the condition (increment.delta > 0 && state === "off") won't be met
        device.increaseConsumptionBy({ delta: 10, action: "turn_on" });

        // Verify turn_on was NOT called
        expect(turnOnSpy).not.toHaveBeenCalled();

        // Verify no change is pending
        expect(device.changeState).toBeUndefined();
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
          30000, // offToOnDebounceMs
          10000, // onToOffDebounceMs
        );

        // Spy on the service call
        const turnOffSpy = vi.spyOn(hass.call.switch, "turn_off");

        // When device is already off, decreaseConsumptionBy will not do anything
        // since the condition (increment.delta > 0 && state === "on") won't be met
        device.decreaseConsumptionBy({ delta: 10, action: "turn_off" });

        // Verify turn_off was NOT called
        expect(turnOffSpy).not.toHaveBeenCalled();

        // Verify no change is pending
        expect(device.changeState).toBeUndefined();
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
          30000, // offToOnDebounceMs
          10000, // onToOffDebounceMs
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
          30000, // offToOnDebounceMs
          10000, // onToOffDebounceMs
        );

        // Trigger increase to put device in pending state
        device.increaseConsumptionBy({ delta: 50, action: "turn_on" });

        // Test expected future consumption when increase is pending
        const changeState = device.changeState;
        expect(changeState?.type).toBe("increase");
        if (changeState?.type === "increase") {
          expect(changeState.expectedFutureConsumption).toBe(50);
        }
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
          30000, // offToOnDebounceMs
          10000, // onToOffDebounceMs
        );

        // Trigger decrease to put device in pending state
        device.decreaseConsumptionBy({ delta: 45, action: "turn_off" });

        // Test expected future consumption when decrease is pending
        const changeState = device.changeState;
        expect(changeState?.type).toBe("decrease");
        if (changeState?.type === "decrease") {
          expect(changeState.expectedFutureConsumption).toBe(0);
        }
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
          30000, // offToOnDebounceMs
          10000, // onToOffDebounceMs
        );

        // When sensor returns null, should fallback to expectedConsumption for increments
        expect(device.increaseIncrements).toEqual([{ delta: 50, action: "turn_on" }]);

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
            30000, // offToOnDebounceMs
            10000, // onToOffDebounceMs
          );

          // Call increaseConsumptionBy to trigger state machine transition
          device.increaseConsumptionBy({ delta: 50, action: "turn_on" });

          // Verify state machine is in INCREASE_PENDING state
          expect(device.changeState?.type).toBe("increase");

          // Advance timers by 1000ms to trigger timeout
          vi.advanceTimersByTime(1000);

          // Verify state machine is back to IDLE (no longer increase pending)
          // but device is still in debounce period since onToOffDebounceMs is 10000ms
          expect(device.changeState?.type).toBe("debounce");
        });
    } finally {
      // Always restore real timers
      vi.useRealTimers();
    }
  });
});
