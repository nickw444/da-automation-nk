import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeviceLoadManager } from "../device_load_manager";
import { IBaseDevice } from "../devices/base_device";
import type { ILogger } from "@digital-alchemy/core";
import { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";

describe("DeviceLoadManager", () => {
  let mockLogger: ILogger;
  let mockGridSensor: ByIdProxy<PICK_ENTITY<"sensor">>;
  let mockGridSensorMean: ByIdProxy<PICK_ENTITY<"sensor">>;
  let mockDevices: IBaseDevice<{delta: number}, {delta: number}>[];
  let deviceLoadManager: DeviceLoadManager;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;

    mockGridSensor = {
      state: 1000,
    } as any;

    mockGridSensorMean = {
      state: 1000,
    } as any;

    // Create mock devices with negative deltas for decrease increments
    mockDevices = [
      {
        name: "Device1",
        priority: 1,
        currentConsumption: 0,
        changeState: undefined,
        increaseIncrements: [{ delta: 100 }],
        decreaseIncrements: [],
        increaseConsumptionBy: vi.fn(),
        decreaseConsumptionBy: vi.fn(),
        stop: vi.fn(),
      },
      {
        name: "Device2", 
        priority: 2,
        currentConsumption: 80,
        changeState: undefined,
        increaseIncrements: [],
        decreaseIncrements: [{ delta: -80 }], // Negative delta
        increaseConsumptionBy: vi.fn(),
        decreaseConsumptionBy: vi.fn(),
        stop: vi.fn(),
      },
      {
        name: "Device3",
        priority: 3,
        currentConsumption: 150,
        changeState: undefined,
        increaseIncrements: [],
        decreaseIncrements: [{ delta: -150 }], // Negative delta
        increaseConsumptionBy: vi.fn(),
        decreaseConsumptionBy: vi.fn(),
        stop: vi.fn(),
      },
    ];

    deviceLoadManager = new DeviceLoadManager(
      mockDevices,
      mockLogger,
      mockGridSensor,
      mockGridSensorMean,
      500, // desiredGridConsumption
      800, // maxConsumptionBeforeSheddingLoad  
      200, // minConsumptionBeforeAddingLoad
    );
  });

  it("should shed load using devices with negative delta decrements", () => {
    // Set grid consumption high to trigger load shedding
    mockGridSensorMean.state = 900; // Exceeds max of 800W
    
    // Mock the private loop method by calling it directly
    (deviceLoadManager as any).loop();

    // Should shed 400W (900 - 500 desired)
    // Device2 has -80W decrement, Device3 has -150W decrement
    // Should call Device3 first (lower priority = shed first) then Device2
    expect(mockDevices[2].decreaseConsumptionBy).toHaveBeenCalledWith({ delta: -150 });
    expect(mockDevices[1].decreaseConsumptionBy).toHaveBeenCalledWith({ delta: -80 });
    expect(mockDevices[0].decreaseConsumptionBy).not.toHaveBeenCalled();
  });

  it("should only shed appropriate amount when negative deltas are available", () => {
    // Set grid consumption slightly high to trigger small load shedding
    mockGridSensorMean.state = 850; // Exceeds max of 800W, need to shed 350W (850 - 500)
    
    (deviceLoadManager as any).loop();

    // Should shed Device3 (-150W) and Device2 (-80W) for total of 230W
    expect(mockDevices[2].decreaseConsumptionBy).toHaveBeenCalledWith({ delta: -150 });
    expect(mockDevices[1].decreaseConsumptionBy).toHaveBeenCalledWith({ delta: -80 });
    expect(mockDevices[0].decreaseConsumptionBy).not.toHaveBeenCalled();
  });

  it("should skip devices with no suitable negative delta decrements", () => {
    // Set a small overage that no device can handle
    mockGridSensorMean.state = 850; // Exceeds max of 800W, need to shed 350W (850 - 500)
    
    // Create devices with decrements larger than needed
    const deviceWithLargeDecrement1 = {
      ...mockDevices[1],
      decreaseIncrements: [{ delta: -400 }], // Too large
    };
    const deviceWithLargeDecrement2 = {
      ...mockDevices[2],  
      decreaseIncrements: [{ delta: -500 }], // Too large
    };
    
    // Create a new device manager with these devices
    const testDeviceManager = new DeviceLoadManager(
      [mockDevices[0], deviceWithLargeDecrement1, deviceWithLargeDecrement2],
      mockLogger,
      mockGridSensor,
      mockGridSensorMean,
      500, // desiredGridConsumption
      800, // maxConsumptionBeforeSheddingLoad  
      200, // minConsumptionBeforeAddingLoad
    );
    
    (testDeviceManager as any).loop();

    // No devices should be called since their decrements are too large
    expect(deviceWithLargeDecrement1.decreaseConsumptionBy).not.toHaveBeenCalled();
    expect(deviceWithLargeDecrement2.decreaseConsumptionBy).not.toHaveBeenCalled();
    
    // Should log warning about not being able to shed enough
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not shed enough load")
    );
  });

  it("should log correct wattage values for negative deltas", () => {
    mockGridSensorMean.state = 900;
    
    (deviceLoadManager as any).loop();

    // Should log positive wattage values even though deltas are negative
    expect(mockLogger.info).toHaveBeenCalledWith("Shedding 150 W from Device3");
    expect(mockLogger.info).toHaveBeenCalledWith("Shedding 80 W from Device2");
  });

  it("should handle devices with pending changes correctly", () => {
    mockGridSensorMean.state = 900;
    
    // Create device with pending changes
    const deviceWithPendingChanges = {
      ...mockDevices[2],
      changeState: { type: "decrease" as const, expectedFutureConsumption: 0 },
    };
    mockDevices[2] = deviceWithPendingChanges;
    
    (deviceLoadManager as any).loop();

    // Should skip Device3 and only use Device2
    expect(mockDevices[2].decreaseConsumptionBy).not.toHaveBeenCalled();
    expect(mockDevices[1].decreaseConsumptionBy).toHaveBeenCalledWith({ delta: -80 });
    expect(mockLogger.debug).toHaveBeenCalledWith("Skipping Device3 - has pending changes");
  });

  it("should handle devices in debounce state correctly", () => {
    mockGridSensorMean.state = 900;
    
    // Create device in debounce state
    const deviceInDebounce = {
      ...mockDevices[1],
      changeState: { type: "debounce" as const },
    };
    mockDevices[1] = deviceInDebounce;
    
    (deviceLoadManager as any).loop();

    // Should skip Device2 and only use Device3
    expect(mockDevices[1].decreaseConsumptionBy).not.toHaveBeenCalled();
    expect(mockDevices[2].decreaseConsumptionBy).toHaveBeenCalledWith({ delta: -150 });
    expect(mockLogger.debug).toHaveBeenCalledWith("Skipping Device2 - in debounce period");
  });

  describe("Load Adding", () => {
    beforeEach(() => {
      // Reset devices for load adding tests
      mockDevices = [
        {
          name: "Device1",
          priority: 1, // High priority - should be added to first
          currentConsumption: 0,
          changeState: undefined,
          increaseIncrements: [{ delta: 100 }],
          decreaseIncrements: [],
          increaseConsumptionBy: vi.fn(),
          decreaseConsumptionBy: vi.fn(),
          stop: vi.fn(),
        },
        {
          name: "Device2", 
          priority: 2, // Lower priority
          currentConsumption: 0,
          changeState: undefined,
          increaseIncrements: [{ delta: 80 }],
          decreaseIncrements: [],
          increaseConsumptionBy: vi.fn(),
          decreaseConsumptionBy: vi.fn(),
          stop: vi.fn(),
        },
      ];

      deviceLoadManager = new DeviceLoadManager(
        mockDevices,
        mockLogger,
        mockGridSensor,
        mockGridSensorMean,
        500, // desiredGridConsumption
        800, // maxConsumptionBeforeSheddingLoad  
        200, // minConsumptionBeforeAddingLoad
      );
    });

    it("should add load when grid consumption is below min threshold", () => {
      // Set grid consumption low to trigger load adding
      mockGridSensorMean.state = 100; // Below min of 200W
      
      (deviceLoadManager as any).loop();

      // Should add 400W (500 desired - 100 current)
      // Device1 has higher priority (1), should be called first
      expect(mockDevices[0].increaseConsumptionBy).toHaveBeenCalledWith({ delta: 100 });
      expect(mockDevices[1].increaseConsumptionBy).toHaveBeenCalledWith({ delta: 80 });
    });

    it("should add load to highest priority devices first", () => {
      mockGridSensorMean.state = 150; // Below min of 200W, need 350W (500 - 150)
      
      (deviceLoadManager as any).loop();

      // Device1 (priority 1) should be called first, Device2 (priority 2) second
      expect(mockDevices[0].increaseConsumptionBy).toHaveBeenCalledWith({ delta: 100 });
      expect(mockDevices[1].increaseConsumptionBy).toHaveBeenCalledWith({ delta: 80 });
    });

    it("should account for devices with pending increase changes", () => {
      mockGridSensorMean.state = 100; // Below min, need 400W total
      
      // Create device with pending increase
      const deviceWithPending = {
        ...mockDevices[0],
        changeState: { type: "increase" as const, expectedFutureConsumption: 100 },
      };
      mockDevices[0] = deviceWithPending;
      
      (deviceLoadManager as any).loop();

      // Device1 has pending increase (100W), so remaining capacity is 300W
      // Device1 should be skipped, Device2 should get 80W
      expect(mockDevices[0].increaseConsumptionBy).not.toHaveBeenCalled();
      expect(mockDevices[1].increaseConsumptionBy).toHaveBeenCalledWith({ delta: 80 });
    });

    it("should skip devices with pending decrease changes", () => {
      mockGridSensorMean.state = 100;
      
      // Create device with pending decrease
      const deviceWithPendingDecrease = {
        ...mockDevices[0],
        changeState: { type: "decrease" as const, expectedFutureConsumption: 0 },
      };
      mockDevices[0] = deviceWithPendingDecrease;
      
      (deviceLoadManager as any).loop();

      // Device1 should be skipped, only Device2 should be called
      expect(mockDevices[0].increaseConsumptionBy).not.toHaveBeenCalled();
      expect(mockDevices[1].increaseConsumptionBy).toHaveBeenCalledWith({ delta: 80 });
    });

    it("should find best fitting increment for load adding", () => {
      mockGridSensorMean.state = 150; // Below min of 200W, need 350W (500 - 150)
      
      // Create device with multiple increment options - should pick largest that fits
      const deviceWithMultipleIncrements = {
        ...mockDevices[0],
        increaseIncrements: [{ delta: 25 }, { delta: 50 }, { delta: 75 }, { delta: 100 }],
      };
      
      // Create new device manager with updated device
      const testDeviceManager = new DeviceLoadManager(
        [deviceWithMultipleIncrements, mockDevices[1]],
        mockLogger,
        mockGridSensor,
        mockGridSensorMean,
        500, // desiredGridConsumption
        800, // maxConsumptionBeforeSheddingLoad  
        200, // minConsumptionBeforeAddingLoad
      );
      
      (testDeviceManager as any).loop();

      // Should choose the largest increment (100W) first, then Device2 gets 80W
      expect(deviceWithMultipleIncrements.increaseConsumptionBy).toHaveBeenCalledWith({ delta: 100 });
      expect(mockDevices[1].increaseConsumptionBy).toHaveBeenCalledWith({ delta: 80 });
    });
  });

  describe("Within Acceptable Range", () => {
    it("should take no action when consumption is within acceptable range", () => {
      // Set consumption within range (between 200 and 800)
      mockGridSensorMean.state = 500; // Exactly at desired, within range
      
      (deviceLoadManager as any).loop();

      // No devices should be called
      expect(mockDevices[0].decreaseConsumptionBy).not.toHaveBeenCalled();
      expect(mockDevices[0].increaseConsumptionBy).not.toHaveBeenCalled();
      expect(mockDevices[1].decreaseConsumptionBy).not.toHaveBeenCalled();
      expect(mockDevices[1].increaseConsumptionBy).not.toHaveBeenCalled();
      expect(mockDevices[2].decreaseConsumptionBy).not.toHaveBeenCalled();
      expect(mockDevices[2].increaseConsumptionBy).not.toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("should handle null grid consumption gracefully", () => {
      mockGridSensorMean.state = null;
      
      (deviceLoadManager as any).loop();

      // Should log warning and not call any devices
      expect(mockLogger.warn).toHaveBeenCalledWith("Grid consumption is null, skipping load management");
      expect(mockDevices[0].decreaseConsumptionBy).not.toHaveBeenCalled();
      expect(mockDevices[0].increaseConsumptionBy).not.toHaveBeenCalled();
    });

    it("should handle unavailable grid consumption gracefully", () => {
      mockGridSensorMean.state = "unavailable";
      
      (deviceLoadManager as any).loop();

      // Should log warning and not call any devices
      expect(mockLogger.warn).toHaveBeenCalledWith("Grid consumption is null, skipping load management");
      expect(mockDevices[0].decreaseConsumptionBy).not.toHaveBeenCalled();
      expect(mockDevices[0].increaseConsumptionBy).not.toHaveBeenCalled();
    });
  });

  describe("Timer Management", () => {
    it("should call stop on all devices when stopping after start", () => {
      // Start first to create the interval
      deviceLoadManager.start();
      deviceLoadManager.stop();

      // All devices should have stop called
      expect(mockDevices[0].stop).toHaveBeenCalledTimes(1);
      expect(mockDevices[1].stop).toHaveBeenCalledTimes(1);
      expect(mockDevices[2].stop).toHaveBeenCalledTimes(1);
    });

    it("should not call device.stop when stopping without starting", () => {
      deviceLoadManager.stop();

      // No devices should have stop called since start was never called
      expect(mockDevices[0].stop).not.toHaveBeenCalled();
      expect(mockDevices[1].stop).not.toHaveBeenCalled();
      expect(mockDevices[2].stop).not.toHaveBeenCalled();
    });
  });
});
