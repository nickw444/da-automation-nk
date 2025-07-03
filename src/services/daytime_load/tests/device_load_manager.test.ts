import { TestRunner } from "@digital-alchemy/core";
import { LIB_HASS } from "@digital-alchemy/hass";
import { LIB_MOCK_ASSISTANT } from "@digital-alchemy/hass/mock-assistant";
import { DeviceLoadManager } from "./device_load_manager";
import { BaseDevice } from "./devices/base_device";

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
            mockDevice.maxDecreaseCapacity = 50;

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

    it("should shed load from highest priority devices first", async () => {
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
              priority: 1,
              currentConsumption: 50,
              expectedFutureConsumption: 50,
              minIncreaseCapacity: 0,
              maxIncreaseCapacity: 0,
              minDecreaseCapacity: 50,
              maxDecreaseCapacity: 50,
            });

            const highPriorityDevice = new MockBaseDevice({
              name: "High Priority Device",
              priority: 5,
              currentConsumption: 50,
              expectedFutureConsumption: 50,
              minIncreaseCapacity: 0,
              maxIncreaseCapacity: 0,
              minDecreaseCapacity: 50,
              maxDecreaseCapacity: 50,
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
            // High priority device should be shed second to make up remaining 10W needed
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

            // Configure mock device with range between min and max capacity
            mockDevice.currentConsumption = 80;
            mockDevice.minDecreaseCapacity = 10;
            mockDevice.maxDecreaseCapacity = 80;

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
            mockDevice.maxDecreaseCapacity = 50;
            mockDevice.hasChangePending = "increase";

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
            mockDevice.minIncreaseCapacity = 50;
            mockDevice.maxIncreaseCapacity = 50;

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

    it("should add load to lowest priority devices first", async () => {
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
              priority: 1,
              currentConsumption: 0,
              expectedFutureConsumption: 0,
              minIncreaseCapacity: 50,
              maxIncreaseCapacity: 50,
              minDecreaseCapacity: 0,
              maxDecreaseCapacity: 0,
            });

            const highPriorityDevice = new MockBaseDevice({
              name: "High Priority Device",
              priority: 5,
              currentConsumption: 0,
              expectedFutureConsumption: 0,
              minIncreaseCapacity: 50,
              maxIncreaseCapacity: 50,
              minDecreaseCapacity: 0,
              maxDecreaseCapacity: 0,
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

            // Configure mock device with range between min and max capacity
            mockDevice.currentConsumption = 0;
            mockDevice.minIncreaseCapacity = 10;
            mockDevice.maxIncreaseCapacity = 80;

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
            mockDevice.maxIncreaseCapacity = 50;
            mockDevice.hasChangePending = "decrease"; // Has pending decrease change

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
              expectedFutureConsumption: 25, // Will consume 25W when pending change completes
              minIncreaseCapacity: 25,
              maxIncreaseCapacity: 50,
              minDecreaseCapacity: 0,
              maxDecreaseCapacity: 0,
            });
            deviceWithPending.hasChangePending = "increase";

            // Create second device without pending changes
            const deviceWithoutPending = new MockBaseDevice({
              name: "Device Without Pending",
              priority: 1,
              currentConsumption: 0,
              expectedFutureConsumption: 0,
              minIncreaseCapacity: 25,
              maxIncreaseCapacity: 125,
              minDecreaseCapacity: 0,
              maxDecreaseCapacity: 0,
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
            mockDevice.minIncreaseCapacity = 25;
            mockDevice.maxIncreaseCapacity = 50; // Can only add 50W but need 100W

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
            mockDevice.minIncreaseCapacity = 20;
            mockDevice.maxIncreaseCapacity = 100;
            mockDevice.minDecreaseCapacity = 20;
            mockDevice.maxDecreaseCapacity = 30;

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
            mockDevice.maxDecreaseCapacity = 50;

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

class MockBaseDevice extends BaseDevice {
  name: string;
  priority: number;
  currentConsumption: number;
  expectedFutureConsumption: number;
  minIncreaseCapacity: number;
  maxIncreaseCapacity: number;
  minDecreaseCapacity: number;
  maxDecreaseCapacity: number;
  hasChangePending: "increase" | "decrease" | undefined;

  increaseConsumptionBy = vi.fn();
  decreaseConsumptionBy = vi.fn();
  doIncreaseConsumptionBySpy = vi.fn();
  doDecreaseConsumptionBySpy = vi.fn();

  constructor(
    overrides: {
      name?: string;
      priority?: number;
      currentConsumption?: number;
      expectedFutureConsumption?: number;
      minIncreaseCapacity?: number;
      maxIncreaseCapacity?: number;
      minDecreaseCapacity?: number;
      maxDecreaseCapacity?: number;
      hasChangePending?: "increase" | "decrease" | undefined;
    } = {},
  ) {
    super();
    this.name = overrides.name || "Mock Device";
    this.priority = overrides.priority || 1;
    this.currentConsumption = overrides.currentConsumption || 0;
    this.expectedFutureConsumption = overrides.expectedFutureConsumption || 50;
    this.minIncreaseCapacity = overrides.minIncreaseCapacity || 50;
    this.maxIncreaseCapacity = overrides.maxIncreaseCapacity || 50;
    this.minDecreaseCapacity = overrides.minDecreaseCapacity || 0;
    this.maxDecreaseCapacity = overrides.maxDecreaseCapacity || 0;
    this.hasChangePending = overrides.hasChangePending || undefined;
  }

  protected doIncreaseConsumptionBy(amount: number): void {
    this.doIncreaseConsumptionBySpy(amount);
  }

  protected doDecreaseConsumptionBy(amount: number): void {
    this.doDecreaseConsumptionBySpy(amount);
  }

  resetSpies() {
    this.increaseConsumptionBy.mockClear();
    this.decreaseConsumptionBy.mockClear();
    this.doIncreaseConsumptionBySpy.mockClear();
    this.doDecreaseConsumptionBySpy.mockClear();
  }
}
