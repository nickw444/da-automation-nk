import { TestRunner } from "@digital-alchemy/core";
import { LIB_HASS } from "@digital-alchemy/hass";
import { LIB_MOCK_ASSISTANT } from "@digital-alchemy/hass/mock-assistant";
import type { MockInstance } from "vitest";
import { DeviceLoadManager } from "../device_load_manager";
import { IBaseDevice } from "../devices/base_device";

const runner = TestRunner()
  .appendLibrary(LIB_HASS)
  .appendLibrary(LIB_MOCK_ASSISTANT);

describe("DeviceLoadManager", () => {
  let mockDevice: MockBaseDevice;

  beforeEach(() => {
    mockDevice = new MockBaseDevice();
    vi.clearAllTimers();
  });

  it("should handle null grid consumption gracefully", async () => {
    vi.useFakeTimers();

    try {
      await runner
        .bootLibrariesFirst()
        .setup(({ mock_assistant }) => {
          mock_assistant.entity.setupState({
            "sensor.inverter_meter_power": { state: null },
            "sensor.inverter_meter_power_mean_1m": { state: null },
            "switch.subfloor_fan": { state: "off" },
            "sensor.subfloor_fan_current_consumption": { state: 0 },
          });
        })
        .run(({ hass, logger }) => {
          const gridSensor = hass.refBy.id("sensor.inverter_meter_power");
          const gridSensorMean = hass.refBy.id(
            "sensor.inverter_meter_power_mean_1m",
          );

          // mockDevice is created in beforeEach

          const manager = new DeviceLoadManager(
            [mockDevice],
            logger,
            gridSensor,
            gridSensorMean,
            0, // desired
            100, // max before shedding
            -100, // min before adding
          );

          // Start the manager and advance timers to trigger the loop
          manager.start();
          vi.advanceTimersByTime(5000);

          // Verify no device actions were taken when grid consumption is null
          expect(mockDevice.decreaseConsumptionBy).not.toHaveBeenCalled();
          expect(mockDevice.increaseConsumptionBy).not.toHaveBeenCalled();

          manager.stop();
        });
    } finally {
      vi.useRealTimers();
    }
  });

  describe("Load Shedding", () => {
    it("should shed load when grid consumption exceeds max threshold", async () => {
      vi.useFakeTimers();

      try {
        await runner
          .bootLibrariesFirst()
          .setup(({ mock_assistant }) => {
            mock_assistant.entity.setupState({
              "sensor.inverter_meter_power": { state: 300 },
              "sensor.inverter_meter_power_mean_1m": { state: 300 }, // Exceeds max threshold of 100
              "switch.subfloor_fan": { state: "off" },
              "sensor.subfloor_fan_current_consumption": { state: 0 },
            });
          })
          .run(({ hass, logger }) => {
            const gridSensor = hass.refBy.id("sensor.inverter_meter_power");
            const gridSensorMean = hass.refBy.id(
              "sensor.inverter_meter_power_mean_1m",
            );

            // Configure mock device to have capacity for shedding
            mockDevice.currentConsumption = 50;
            mockDevice.setDecreaseIncrements([50]);

            const manager = new DeviceLoadManager(
              [mockDevice],
              logger,
              gridSensor,
              gridSensorMean,
              0, // desired
              100, // max before shedding
              -100, // min before adding
            );

            manager.start();
            vi.advanceTimersByTime(5000);

            // Verify device was asked to shed load
            expect(mockDevice.decreaseConsumptionBy).toHaveBeenCalledWith(50);

            manager.stop();
          });
      } finally {
        vi.useRealTimers();
      }
    });

    it("should shed load from lowest priority devices first", async () => {
      vi.useFakeTimers();

      try {
        await runner
          .bootLibrariesFirst()
          .setup(({ mock_assistant }) => {
            mock_assistant.entity.setupState({
              "sensor.inverter_meter_power": { state: 50 },
              "sensor.inverter_meter_power_mean_1m": { state: 50 }, // Need to shed 50W
              "switch.subfloor_fan": { state: "off" },
              "sensor.subfloor_fan_current_consumption": { state: 0 },
            });
          })
          .run(({ hass, logger }) => {
            const gridSensor = hass.refBy.id("sensor.inverter_meter_power");
            const gridSensorMean = hass.refBy.id(
              "sensor.inverter_meter_power_mean_1m",
            );

            // Create devices with different priorities
            const lowPriorityDevice = new MockBaseDevice({
              name: "Low Priority Device",
              priority: 5,
              currentConsumption: 50,
              increaseIncrements: [],
              decreaseIncrements: [50],
            });

            const highPriorityDevice = new MockBaseDevice({
              name: "High Priority Device",
              priority: 1,
              currentConsumption: 50,
              increaseIncrements: [],
              decreaseIncrements: [50],
            });

            const manager = new DeviceLoadManager(
              [lowPriorityDevice, highPriorityDevice],
              logger,
              gridSensor,
              gridSensorMean,
              0, // desired
              49, // max before shedding
              -100, // min before adding
            );

            manager.start();
            vi.advanceTimersByTime(5000);

            // Low priority device should be shed first
            expect(
              lowPriorityDevice.decreaseConsumptionBy,
            ).toHaveBeenCalledWith(50);
            // High priority device should not be shed
            expect(highPriorityDevice.decreaseConsumptionBy).not.toBeCalled();

            manager.stop();
          });
      } finally {
        vi.useRealTimers();
      }
    });

    it("should shed correct amount to reach desired consumption", async () => {
      vi.useFakeTimers();

      try {
        await runner
          .bootLibrariesFirst()
          .setup(({ mock_assistant }) => {
            mock_assistant.entity.setupState({
              "sensor.inverter_meter_power": { state: 130 },
              "sensor.inverter_meter_power_mean_1m": { state: 130 }, // Need to shed 30W to reach 100W desired
              "switch.subfloor_fan": { state: "off" },
              "sensor.subfloor_fan_current_consumption": { state: 0 },
            });
          })
          .run(({ hass, logger }) => {
            const gridSensor = hass.refBy.id("sensor.inverter_meter_power");
            const gridSensorMean = hass.refBy.id(
              "sensor.inverter_meter_power_mean_1m",
            );

            // Configure mock device with decrease increments
            mockDevice.currentConsumption = 80;
            mockDevice.setDecreaseIncrements([10, 20, 30, 40, 50, 60, 70, 80]);

            const manager = new DeviceLoadManager(
              [mockDevice],
              logger,
              gridSensor,
              gridSensorMean,
              100, // desired
              100, // max before shedding
              -100, // min before adding
            );

            manager.start();
            vi.advanceTimersByTime(5000);

            // Device should be asked to shed 30W (between min 10W and max 80W)
            expect(mockDevice.decreaseConsumptionBy).toHaveBeenCalledWith(30);

            manager.stop();
          });
      } finally {
        vi.useRealTimers();
      }
    });

    it("should skip devices with pending changes during shedding", async () => {
      vi.useFakeTimers();

      try {
        await runner
          .bootLibrariesFirst()
          .setup(({ mock_assistant }) => {
            mock_assistant.entity.setupState({
              "sensor.inverter_meter_power": { state: 200 },
              "sensor.inverter_meter_power_mean_1m": { state: 200 },
              "switch.subfloor_fan": { state: "off" },
              "sensor.subfloor_fan_current_consumption": { state: 0 },
            });
          })
          .run(({ hass, logger }) => {
            const gridSensor = hass.refBy.id("sensor.inverter_meter_power");
            const gridSensorMean = hass.refBy.id(
              "sensor.inverter_meter_power_mean_1m",
            );

            // Configure mock device with pending changes
            mockDevice.currentConsumption = 50;
            mockDevice.setDecreaseIncrements([50]);
            mockDevice.setChangeState({ type: "increase", expectedFutureConsumption: 75 });

            const manager = new DeviceLoadManager(
              [mockDevice],
              logger,
              gridSensor,
              gridSensorMean,
              0, // desired
              100, // max before shedding
              -100, // min before adding
            );

            manager.start();
            vi.advanceTimersByTime(5000);

            // Device should be skipped due to pending changes
            expect(mockDevice.decreaseConsumptionBy).not.toHaveBeenCalled();

            manager.stop();
          });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("Load Adding", () => {
    it("should add load when grid consumption is below min threshold", async () => {
      vi.useFakeTimers();

      try {
        await runner
          .bootLibrariesFirst()
          .setup(({ mock_assistant }) => {
            mock_assistant.entity.setupState({
              "sensor.inverter_meter_power": { state: -200 },
              "sensor.inverter_meter_power_mean_1m": { state: -200 }, // Below min threshold of -100
              "switch.subfloor_fan": { state: "off" },
              "sensor.subfloor_fan_current_consumption": { state: 0 },
            });
          })
          .run(({ hass, logger }) => {
            const gridSensor = hass.refBy.id("sensor.inverter_meter_power");
            const gridSensorMean = hass.refBy.id(
              "sensor.inverter_meter_power_mean_1m",
            );

            // Configure mock device to have capacity for adding
            mockDevice.currentConsumption = 0;
            mockDevice.setIncreaseIncrements([50]);

            const manager = new DeviceLoadManager(
              [mockDevice],
              logger,
              gridSensor,
              gridSensorMean,
              0, // desired
              100, // max before shedding
              -100, // min before adding
            );

            manager.start();
            vi.advanceTimersByTime(5000);

            // Verify device was asked to add load
            expect(mockDevice.increaseConsumptionBy).toHaveBeenCalledWith(50);

            manager.stop();
          });
      } finally {
        vi.useRealTimers();
      }
    });

    it("should add load to highest priority devices first", async () => {
      vi.useFakeTimers();

      try {
        await runner
          .bootLibrariesFirst()
          .setup(({ mock_assistant }) => {
            mock_assistant.entity.setupState({
              "sensor.inverter_meter_power": { state: -150 },
              "sensor.inverter_meter_power_mean_1m": { state: -150 }, // Need to add 50W
              "switch.subfloor_fan": { state: "off" },
              "sensor.subfloor_fan_current_consumption": { state: 0 },
            });
          })
          .run(({ hass, logger }) => {
            const gridSensor = hass.refBy.id("sensor.inverter_meter_power");
            const gridSensorMean = hass.refBy.id(
              "sensor.inverter_meter_power_mean_1m",
            );

            // Create devices with different priorities
            const lowPriorityDevice = new MockBaseDevice({
              name: "Low Priority Device",
              priority: 5,
              currentConsumption: 0,
              increaseIncrements: [50],
              decreaseIncrements: [],
            });

            const highPriorityDevice = new MockBaseDevice({
              name: "High Priority Device",
              priority: 1,
              currentConsumption: 0,
              increaseIncrements: [50],
              decreaseIncrements: [],
            });

            const manager = new DeviceLoadManager(
              [lowPriorityDevice, highPriorityDevice],
              logger,
              gridSensor,
              gridSensorMean,
              -100, // desired
              100, // max before shedding
              -100, // min before adding
            );

            manager.start();
            vi.advanceTimersByTime(5000);

            // High priority device should be added to first
            expect(
              highPriorityDevice.increaseConsumptionBy,
            ).toHaveBeenCalledWith(50);
            expect(
              lowPriorityDevice.increaseConsumptionBy,
            ).not.toHaveBeenCalled();

            manager.stop();
          });
      } finally {
        vi.useRealTimers();
      }
    });

    it("should add correct amount to reach desired consumption", async () => {
      vi.useFakeTimers();

      try {
        await runner
          .bootLibrariesFirst()
          .setup(({ mock_assistant }) => {
            mock_assistant.entity.setupState({
              "sensor.inverter_meter_power": { state: -130 },
              "sensor.inverter_meter_power_mean_1m": { state: -130 }, // Need to add 30W to reach -100W desired
              "switch.subfloor_fan": { state: "off" },
              "sensor.subfloor_fan_current_consumption": { state: 0 },
            });
          })
          .run(({ hass, logger }) => {
            const gridSensor = hass.refBy.id("sensor.inverter_meter_power");
            const gridSensorMean = hass.refBy.id(
              "sensor.inverter_meter_power_mean_1m",
            );

            // Configure mock device with increase increments
            mockDevice.currentConsumption = 0;
            mockDevice.setIncreaseIncrements([10, 20, 30, 40, 50, 60, 70, 80]);

            const manager = new DeviceLoadManager(
              [mockDevice],
              logger,
              gridSensor,
              gridSensorMean,
              -100, // desired
              100, // max before shedding
              -100, // min before adding
            );

            manager.start();
            vi.advanceTimersByTime(5000);

            // Device should be asked to add 30W (between min 10W and max 80W)
            expect(mockDevice.increaseConsumptionBy).toHaveBeenCalledWith(30);

            manager.stop();
          });
      } finally {
        vi.useRealTimers();
      }
    });

    it("should skip devices with pending decrease changes", async () => {
      vi.useFakeTimers();

      try {
        await runner
          .bootLibrariesFirst()
          .setup(({ mock_assistant }) => {
            mock_assistant.entity.setupState({
              "sensor.inverter_meter_power": { state: -200 },
              "sensor.inverter_meter_power_mean_1m": { state: -200 },
              "switch.subfloor_fan": { state: "off" },
              "sensor.subfloor_fan_current_consumption": { state: 0 },
            });
          })
          .run(({ hass, logger }) => {
            const gridSensor = hass.refBy.id("sensor.inverter_meter_power");
            const gridSensorMean = hass.refBy.id(
              "sensor.inverter_meter_power_mean_1m",
            );

            // Configure mock device with pending decrease change
            mockDevice.currentConsumption = 0;
            mockDevice.setIncreaseIncrements([50]);
            mockDevice.setChangeState({ type: "decrease", expectedFutureConsumption: 0 }); // Has pending decrease change

            const manager = new DeviceLoadManager(
              [mockDevice],
              logger,
              gridSensor,
              gridSensorMean,
              0, // desired
              100, // max before shedding
              -100, // min before adding
            );

            manager.start();
            vi.advanceTimersByTime(5000);

            // Device should be skipped due to pending decrease changes
            expect(mockDevice.increaseConsumptionBy).not.toHaveBeenCalled();

            manager.stop();
          });
      } finally {
        vi.useRealTimers();
      }
    });

    it("should account for devices with pending increase changes", async () => {
      vi.useFakeTimers();

      try {
        await runner
          .bootLibrariesFirst()
          .setup(({ mock_assistant }) => {
            mock_assistant.entity.setupState({
              "sensor.inverter_meter_power": { state: -200 },
              "sensor.inverter_meter_power_mean_1m": { state: -200 }, // Need to add 100W total
              "switch.subfloor_fan": { state: "off" },
              "sensor.subfloor_fan_current_consumption": { state: 0 },
            });
          })
          .run(({ hass, logger }) => {
            const gridSensor = hass.refBy.id("sensor.inverter_meter_power");
            const gridSensorMean = hass.refBy.id(
              "sensor.inverter_meter_power_mean_1m",
            );

            // Create device with pending increase change
            // Note: priority is important - pending device needs higher priority.
            const deviceWithPending = new MockBaseDevice({
              name: "Device With Pending",
              priority: 2,
              currentConsumption: 0,
              increaseIncrements: [25, 50],
              decreaseIncrements: [],
              changeState: { type: "increase", expectedFutureConsumption: 25 }, // Will consume 25W when pending change completes
            });

            // Create second device without pending changes
            const deviceWithoutPending = new MockBaseDevice({
              name: "Device Without Pending",
              priority: 1,
              currentConsumption: 0,
              increaseIncrements: [25, 50, 75, 100, 125],
              decreaseIncrements: [],
            });

            const manager = new DeviceLoadManager(
              [deviceWithPending, deviceWithoutPending],
              logger,
              gridSensor,
              gridSensorMean,
              -100, // desired
              100, // max before shedding
              -100, // min before adding
            );

            manager.start();
            vi.advanceTimersByTime(5000);

            // Device with pending change should be skipped for new changes
            expect(
              deviceWithPending.increaseConsumptionBy,
            ).not.toHaveBeenCalled();
            // Device without pending should get the remaining load (100W - 25W expected = 75W)
            expect(
              deviceWithoutPending.increaseConsumptionBy,
            ).toHaveBeenCalledWith(75);

            manager.stop();
          });
      } finally {
        vi.useRealTimers();
      }
    });

    it("should handle case when unable to add all surplus load", async () => {
      vi.useFakeTimers();

      try {
        await runner
          .bootLibrariesFirst()
          .setup(({ mock_assistant }) => {
            mock_assistant.entity.setupState({
              "sensor.inverter_meter_power": { state: -200 },
              "sensor.inverter_meter_power_mean_1m": { state: -200 }, // Need to add 100W but devices can only handle 50W
              "switch.subfloor_fan": { state: "off" },
              "sensor.subfloor_fan_current_consumption": { state: 0 },
            });
          })
          .run(({ hass, logger }) => {
            const gridSensor = hass.refBy.id("sensor.inverter_meter_power");
            const gridSensorMean = hass.refBy.id(
              "sensor.inverter_meter_power_mean_1m",
            );

            // Configure mock device with limited capacity
            mockDevice.currentConsumption = 0;
            mockDevice.setIncreaseIncrements([25, 50]); // Can only add 50W but need 100W

            const manager = new DeviceLoadManager(
              [mockDevice],
              logger,
              gridSensor,
              gridSensorMean,
              -100, // desired
              100, // max before shedding
              -100, // min before adding
            );

            manager.start();
            vi.advanceTimersByTime(5000);

            // Device should be asked to add its maximum capacity (50W) even though 100W is needed
            expect(mockDevice.increaseConsumptionBy).toHaveBeenCalledWith(50);

            manager.stop();
          });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("Within Range", () => {
    it("should take no action when consumption is within acceptable range", async () => {
      vi.useFakeTimers();

      try {
        await runner
          .bootLibrariesFirst()
          .setup(({ mock_assistant }) => {
            mock_assistant.entity.setupState({
              "sensor.inverter_meter_power": { state: 50 },
              "sensor.inverter_meter_power_mean_1m": { state: 50 }, // Within range: between -100 and 100
              "switch.subfloor_fan": { state: "off" },
              "sensor.subfloor_fan_current_consumption": { state: 0 },
            });
          })
          .run(({ hass, logger }) => {
            const gridSensor = hass.refBy.id("sensor.inverter_meter_power");
            const gridSensorMean = hass.refBy.id(
              "sensor.inverter_meter_power_mean_1m",
            );

            // Configure mock device with both increase and decrease capacity
            mockDevice.currentConsumption = 30;
            mockDevice.setIncreaseIncrements([20, 40, 60, 80, 100]);
            mockDevice.setDecreaseIncrements([20, 30]);

            const manager = new DeviceLoadManager(
              [mockDevice],
              logger,
              gridSensor,
              gridSensorMean,
              0, // desired
              100, // max before shedding
              -100, // min before adding
            );

            manager.start();
            vi.advanceTimersByTime(5000);

            // Verify no device actions were taken when within range
            expect(mockDevice.increaseConsumptionBy).not.toHaveBeenCalled();
            expect(mockDevice.decreaseConsumptionBy).not.toHaveBeenCalled();

            manager.stop();
          });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("Timer Management", () => {
    it("should start and stop interval correctly", async () => {
      vi.useFakeTimers();

      try {
        await runner
          .bootLibrariesFirst()
          .setup(({ mock_assistant }) => {
            mock_assistant.entity.setupState({
              "sensor.inverter_meter_power": { state: 50 },
              "sensor.inverter_meter_power_mean_1m": { state: 50 },
              "switch.subfloor_fan": { state: "off" },
              "sensor.subfloor_fan_current_consumption": { state: 0 },
            });
          })
          .run(({ hass, logger }) => {
            const gridSensor = hass.refBy.id("sensor.inverter_meter_power");
            const gridSensorMean = hass.refBy.id(
              "sensor.inverter_meter_power_mean_1m",
            );

            const manager = new DeviceLoadManager(
              [mockDevice],
              logger,
              gridSensor,
              gridSensorMean,
              0,
              100,
              -100,
            );

            // Get initial timer count
            const initialTimerCount = vi.getTimerCount();

            // Start the manager
            manager.start();
            expect(vi.getTimerCount()).toBe(initialTimerCount + 1);

            // Stop the manager
            manager.stop();
            expect(vi.getTimerCount()).toBe(initialTimerCount);
          });
      } finally {
        vi.useRealTimers();
      }
    });

    it("should handle stop when not started", async () => {
      await runner
        .bootLibrariesFirst()
        .setup(({ mock_assistant }) => {
          mock_assistant.entity.setupState({
            "sensor.inverter_meter_power": { state: 50 },
            "sensor.inverter_meter_power_mean_1m": { state: 50 },
            "switch.subfloor_fan": { state: "off" },
            "sensor.subfloor_fan_current_consumption": { state: 0 },
          });
        })
        .run(({ hass, logger }) => {
          const gridSensor = hass.refBy.id("sensor.inverter_meter_power");
          const gridSensorMean = hass.refBy.id(
            "sensor.inverter_meter_power_mean_1m",
          );

          const manager = new DeviceLoadManager(
            [mockDevice],
            logger,
            gridSensor,
            gridSensorMean,
            0,
            100,
            -100,
          );

          // Should not throw when stopping without starting
          expect(() => manager.stop()).not.toThrow();
        });
    });

    it("should run loop at 5000ms intervals", async () => {
      vi.useFakeTimers();

      try {
        await runner
          .bootLibrariesFirst()
          .setup(({ mock_assistant }) => {
            mock_assistant.entity.setupState({
              "sensor.inverter_meter_power": { state: 200 },
              "sensor.inverter_meter_power_mean_1m": { state: 200 },
              "switch.subfloor_fan": { state: "off" },
              "sensor.subfloor_fan_current_consumption": { state: 0 },
            });
          })
          .run(({ hass, logger }) => {
            const gridSensor = hass.refBy.id("sensor.inverter_meter_power");
            const gridSensorMean = hass.refBy.id(
              "sensor.inverter_meter_power_mean_1m",
            );

            // Configure mock device to respond to changes
            mockDevice.currentConsumption = 50;
            mockDevice.setDecreaseIncrements([50]);

            const manager = new DeviceLoadManager(
              [mockDevice],
              logger,
              gridSensor,
              gridSensorMean,
              0,
              100,
              -100,
            );

            manager.start();

            // Advance time by 4999ms - should not trigger
            vi.advanceTimersByTime(4999);
            expect(mockDevice.decreaseConsumptionBy).not.toHaveBeenCalled();

            // Advance time by 1ms more (total 5000ms) - should trigger
            vi.advanceTimersByTime(1);
            expect(mockDevice.decreaseConsumptionBy).toHaveBeenCalledTimes(1);

            // Reset the mock
            mockDevice.decreaseConsumptionBy.mockClear();

            // Advance another 5000ms - should trigger again
            vi.advanceTimersByTime(5000);
            expect(mockDevice.decreaseConsumptionBy).toHaveBeenCalledTimes(1);

            manager.stop();
          });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

class MockBaseDevice implements IBaseDevice {
  name: string;
  priority: number;
  currentConsumption: number;
  private _increaseIncrements: number[];
  private _decreaseIncrements: number[];
  private _changeState: 
    | { type: "increase" | "decrease", expectedFutureConsumption: number }
    | { type: "debounce" }
    | undefined;

  increaseConsumptionBy: MockInstance<(amount: number) => void> & ((amount: number) => void);
  decreaseConsumptionBy: MockInstance<(amount: number) => void> & ((amount: number) => void);

  constructor(
    overrides: {
      name?: string;
      priority?: number;
      currentConsumption?: number;
      increaseIncrements?: number[];
      decreaseIncrements?: number[];
      changeState?: 
        | { type: "increase" | "decrease", expectedFutureConsumption: number }
        | { type: "debounce" }
        | undefined;
    } = {},
  ) {
    this.name = overrides.name || "Mock Device";
    this.priority = overrides.priority || 1;
    this.currentConsumption = overrides.currentConsumption || 0;
    this._increaseIncrements = overrides.increaseIncrements || [50];
    this._decreaseIncrements = overrides.decreaseIncrements || [];
    this._changeState = overrides.changeState || undefined;
    
    // Setup mock functions
    this.increaseConsumptionBy = vi.fn();
    this.decreaseConsumptionBy = vi.fn();
  }

  get increaseIncrements(): number[] {
    return this._increaseIncrements;
  }

  get decreaseIncrements(): number[] {
    return this._decreaseIncrements;
  }

  get changeState(): 
    | { type: "increase" | "decrease", expectedFutureConsumption: number }
    | { type: "debounce" }
    | undefined {
    return this._changeState;
  }

  // Helper methods for tests to update state
  setIncreaseIncrements(increments: number[]) {
    this._increaseIncrements = increments;
  }

  setDecreaseIncrements(increments: number[]) {
    this._decreaseIncrements = increments;
  }

  setChangeState(changeState: 
    | { type: "increase" | "decrease", expectedFutureConsumption: number }
    | { type: "debounce" }
    | undefined) {
    this._changeState = changeState;
  }

  stop(): void {
    // Mock implementation - do nothing
  }

  resetSpies() {
    this.increaseConsumptionBy.mockClear();
    this.decreaseConsumptionBy.mockClear();
  }
}
