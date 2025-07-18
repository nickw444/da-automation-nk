import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { HumidifierDevice, IHumidifierControls } from "../humidifier_device";
import { MockHumidifierEntityWrapper } from "../../../../entities/humidifier_entity_wrapper";
import { MockSensorEntityWrapper } from "../../../../entities/sensor_entity_wrapper";
import type { ILogger } from "@digital-alchemy/core";

interface TestHumidifierEntity extends MockHumidifierEntityWrapper {
  setHumidity: Mock;
  setMode: Mock;
  turnOn: Mock;
  turnOff: Mock;
}

interface TestSensorEntity extends MockSensorEntityWrapper {
  onUpdate: Mock;
}

describe("HumidifierDevice", () => {
  let mockLogger: ILogger;
  let mockHumidifierEntity: TestHumidifierEntity;
  let mockConsumptionEntity: TestSensorEntity;
  let mockRoomHumidityEntity: TestSensorEntity;
  let mockHumidifierControls: IHumidifierControls;
  let device: HumidifierDevice;

  beforeEach(() => {
    vi.useFakeTimers();

    mockLogger = {
      info: vi.fn(), debug: vi.fn(), warn: vi.fn(), 
      error: vi.fn(), fatal: vi.fn(), trace: vi.fn()
    } as ILogger;
    
    mockHumidifierEntity = {
      state: "off",
      attributes: {
        humidity: 50, // Current target setpoint
        min_humidity: 30,
        max_humidity: 70,
        mode: "normal",
        available_modes: ["normal", "silent"]
      },
      setHumidity: vi.fn(),
      setMode: vi.fn(),
      turnOn: vi.fn(),
      turnOff: vi.fn(),
      onUpdate: vi.fn()
    };

    mockConsumptionEntity = {
      state: 0,
      onUpdate: vi.fn()
    };

    mockRoomHumidityEntity = {
      state: 45, // Room humidity
      onUpdate: vi.fn()
    };

    mockHumidifierControls = {
      desiredSetpoint: 60, // User wants 60% humidity
      comfortSetpoint: undefined, // No comfort limit initially
    };

    device = new HumidifierDevice(
      "Test Humidifier",
      1,
      mockHumidifierEntity,
      mockConsumptionEntity,
      mockRoomHumidityEntity,
      mockHumidifierControls,
      {
        deviceType: "humidifier",
        operationalConsumption: 200,
        fanOnlyConsumption: 50,
        humidityStep: 5,
        setpointDebounceMs: 60000, // 1 minute
        modeDebounceMs: 120000, // 2 minutes
        fanOnlyTimeoutMs: 1800000, // 30 minutes
      }
    );

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Humidifier mode", () => {
    it("should provide turn-on increment when device is off", () => {
      mockHumidifierEntity.state = "off";
      
      const increments = device.increaseIncrements;
      
      expect(increments).toEqual([{
        delta: 200, // operational consumption (device starts working immediately)
        modeChange: "normal"
      }]);
    });

    it("should provide setpoint increase increment when room humidity < setpoint", () => {
      mockHumidifierEntity.state = "on";
      mockHumidifierEntity.attributes.humidity = 50; // Target setpoint
      mockRoomHumidityEntity.state = 45; // Room humidity below setpoint
      mockConsumptionEntity.state = 50; // Currently at fan-only consumption
      
      const increments = device.increaseIncrements;
      
      expect(increments).toEqual([{
        delta: 150, // 200 - 50 = 150W increase (would run to reach higher setpoint)
        targetHumidity: 55
      }]);
    });

    it("should provide setpoint decrease when room humidity < setpoint and device is running", () => {
      mockHumidifierEntity.state = "on";
      mockHumidifierEntity.attributes.humidity = 55; // Target setpoint
      mockRoomHumidityEntity.state = 45; // Room humidity below setpoint (device running)
      mockConsumptionEntity.state = 200; // Currently running
      
      const increments = device.decreaseIncrements;
      
      expect(increments).toEqual([{
        delta: -150, // 50 - 200 = -150W decrease (move to fan-only)
        targetHumidity: 45 // Moving closer to room humidity
      }]);
    });

    it("should execute setpoint increase correctly", () => {
      mockHumidifierEntity.state = "on";
      
      const increment = { delta: 150, targetHumidity: 55 };
      device.increaseConsumptionBy(increment);
      
      expect(mockHumidifierEntity.setHumidity).toHaveBeenCalledWith(55);
      expect(device.changeState?.type).toBe("increase");
    });

    it("should execute turn-on correctly", () => {
      mockHumidifierEntity.state = "off";
      
      const increment = { delta: 50, modeChange: "normal" };
      device.increaseConsumptionBy(increment);
      
      expect(mockHumidifierEntity.turnOn).toHaveBeenCalledTimes(1);
      expect(device.changeState?.type).toBe("increase");
    });



    it("should respect debounce period", () => {
      mockHumidifierEntity.state = "on";
      
      // First change
      device.increaseConsumptionBy({ delta: 150, targetHumidity: 55 });
      
      // Wait for state transition to complete
      vi.advanceTimersByTime(1000);
      vi.clearAllMocks();
      
      // Second change within debounce period should be ignored
      device.increaseConsumptionBy({ delta: 150, targetHumidity: 60 });
      
      expect(mockHumidifierEntity.setHumidity).not.toHaveBeenCalled();
    });

    it("should start fan-only timeout when setpoint change results in fan-only mode", () => {
      mockHumidifierEntity.state = "on";
      mockRoomHumidityEntity.state = 50; // Room humidity at 50%
      
      // Setting setpoint to 50% for humidifier would result in fan-only mode
      const increment = { delta: -150, targetHumidity: 50 };
      device.decreaseConsumptionBy(increment);
      
      // Fast forward to just before the timeout
      vi.advanceTimersByTime(1800000 - 1000); // 30 minutes - 1 second
      expect(mockHumidifierEntity.turnOff).not.toHaveBeenCalled();
      
      // Fast forward past the timeout
      vi.advanceTimersByTime(1000);
      expect(mockHumidifierEntity.turnOff).toHaveBeenCalledTimes(1);
    });

    it("should respect comfort setpoint when decreasing consumption", () => {
      mockHumidifierControls.comfortSetpoint = 50; // Set comfort limit at 50%
      mockHumidifierEntity.state = "on";
      mockHumidifierEntity.attributes.humidity = 55; // Target setpoint
      mockRoomHumidityEntity.state = 52; // Room humidity above comfort setpoint (device running)
      mockConsumptionEntity.state = 200; // Currently running
      
      const increments = device.decreaseIncrements;
      
      // Should allow decrease to comfort setpoint (50% setpoint would be fan-only)
      expect(increments).toEqual([{
        delta: -150, // 50 - 200 = -150W decrease (move to fan-only at comfort setpoint)
        targetHumidity: 50 // Limited by comfort setpoint
      }]);
    });
  });

  describe("Dehumidifier mode", () => {
    beforeEach(() => {
      mockHumidifierControls = {
        desiredSetpoint: 40, // User wants 40% humidity for dehumidifier
        comfortSetpoint: undefined, // No comfort limit initially
      };
      
      device = new HumidifierDevice(
        "Test Dehumidifier",
        1,
        mockHumidifierEntity,
        mockConsumptionEntity,
        mockRoomHumidityEntity,
        mockHumidifierControls,
        {
          deviceType: "dehumidifier",
          operationalConsumption: 300,
          fanOnlyConsumption: 60,
          humidityStep: 10,
          setpointDebounceMs: 60000,
          modeDebounceMs: 120000,
          fanOnlyTimeoutMs: 1800000,
        }
      );
    });

    it("should provide setpoint decrease increment when room humidity > setpoint", () => {
      mockHumidifierEntity.state = "on";
      mockHumidifierEntity.attributes.humidity = 50; // Target setpoint
      mockRoomHumidityEntity.state = 60; // Room humidity above setpoint
      mockConsumptionEntity.state = 60; // Currently at fan-only consumption
      
      const increments = device.increaseIncrements;
      
      expect(increments).toEqual([{
        delta: 240, // 300 - 60 = 240W increase (lower setpoint would make it run)
        targetHumidity: 40 // Lower setpoint for dehumidifier
      }]);
    });

    it("should provide setpoint increase decrement when room humidity > setpoint and device is running", () => {
      mockHumidifierEntity.state = "on";
      mockHumidifierEntity.attributes.humidity = 40; // Target setpoint
      mockRoomHumidityEntity.state = 60; // Room humidity above setpoint (device running)
      mockConsumptionEntity.state = 300; // Currently running
      
      const increments = device.decreaseIncrements;
      
      expect(increments).toEqual([{
        delta: -240, // 60 - 300 = -240W decrease (move to fan-only)
        targetHumidity: 60 // At room humidity level, device switches to fan-only
      }]);
    });

    it("should execute setpoint decrease correctly", () => {
      mockHumidifierEntity.state = "on";
      
      const increment = { delta: 240, targetHumidity: 40 };
      device.increaseConsumptionBy(increment);
      
      expect(mockHumidifierEntity.setHumidity).toHaveBeenCalledWith(40);
      expect(device.changeState?.type).toBe("increase");
    });

    it("should execute turn-on correctly", () => {
      mockHumidifierEntity.state = "off";
      
      const increment = { delta: 300, modeChange: "normal" };
      device.increaseConsumptionBy(increment);
      
      expect(mockHumidifierEntity.turnOn).toHaveBeenCalledTimes(1);
      expect(device.changeState?.type).toBe("increase");
    });

    it("should execute setpoint increase correctly", () => {
      mockHumidifierEntity.state = "on";
      
      const increment = { delta: -240, targetHumidity: 50 };
      device.decreaseConsumptionBy(increment);
      
      expect(mockHumidifierEntity.setHumidity).toHaveBeenCalledWith(50);
      expect(device.changeState?.type).toBe("decrease");
    });

    it("should start fan-only timeout when setpoint change results in fan-only mode", () => {
      mockHumidifierEntity.state = "on";
      mockRoomHumidityEntity.state = 50; // Room humidity at 50%
      
      // Setting setpoint to 50% for dehumidifier would result in fan-only mode
      const increment = { delta: -240, targetHumidity: 50 };
      device.decreaseConsumptionBy(increment);
      
      // Fast forward to just before the timeout
      vi.advanceTimersByTime(1800000 - 1000); // 30 minutes - 1 second
      expect(mockHumidifierEntity.turnOff).not.toHaveBeenCalled();
      
      // Fast forward past the timeout
      vi.advanceTimersByTime(1000);
      expect(mockHumidifierEntity.turnOff).toHaveBeenCalledTimes(1);
    });
  });

  it("should handle stop correctly", () => {
    mockHumidifierEntity.state = "on";
    
    device.stop();
    
    expect(mockHumidifierEntity.turnOff).toHaveBeenCalledTimes(1);
    expect(device.changeState).toBeUndefined();
  });
});
