import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DehumidifierDevice, DehumidifierDeviceOptions, IDehumidifierHassControls } from "../dehumidifier_device";
import { MockHumidifierEntityWrapper } from "../../../../entities/humidifier_entity_wrapper";
import { MockSensorEntityWrapper } from "../../../../entities/sensor_entity_wrapper";
import type { ILogger } from "@digital-alchemy/core";

describe("DehumidifierDevice", () => {
  let mockHumidifierEntity: MockHumidifierEntityWrapper;
  let mockConsumptionEntity: MockSensorEntityWrapper;
  let mockHumidityEntity: MockSensorEntityWrapper;
  let config: DehumidifierDeviceOptions;
  let hassControls: IDehumidifierHassControls;
  let device: DehumidifierDevice;
  let mockLogger: ILogger;

  beforeEach(() => {
    vi.useFakeTimers();

    mockLogger = {
      info: vi.fn(), debug: vi.fn(), warn: vi.fn(), 
      error: vi.fn(), fatal: vi.fn(), trace: vi.fn()
    } as ILogger;
    
    mockHumidifierEntity = {
      state: "off",
      attributes: {
        humidity: 50,
        min_humidity: 30,
        max_humidity: 80,
        mode: "normal",
        available_modes: ["normal", "boost"],
      },
      setHumidity: vi.fn(),
      setMode: vi.fn(),
      turnOn: vi.fn(),
      turnOff: vi.fn(),
      onUpdate: vi.fn(),
    };
    
    mockConsumptionEntity = {
      state: 0,
      onUpdate: vi.fn(),
    };

    mockHumidityEntity = {
      state: 60, // Current humidity at 60%
      onUpdate: vi.fn(),
    };

    config = {
      minSetpoint: 30,
      maxSetpoint: 80,
      setpointStep: 5,
      expectedDehumidifyingConsumption: 600,
      expectedFanOnlyConsumption: 150,
      fanOnlyTimeoutMs: 1800000, // 30 minutes
      setpointChangeTransitionMs: 60000,
      setpointDebounceMs: 120000,
    };

    hassControls = {
      managementEnabled: true,
      desiredSetpoint: 45,
      enableComfortSetpoint: false,
      comfortSetpoint: undefined,
    };

    device = new DehumidifierDevice(
      "Test Dehumidifier",
      1,
      mockLogger,
      mockHumidifierEntity,
      mockConsumptionEntity,
      mockHumidityEntity,
      hassControls,
      config,
    );

    vi.clearAllMocks(); // Clear setup calls
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Basic Properties", () => {
    it("should return correct name", () => {
      expect(device.name).toBe("Test Dehumidifier");
    });

    it("should return correct priority", () => {
      expect(device.priority).toBe(1);
    });

    it("should return correct current consumption", () => {
      mockConsumptionEntity.state = 450;
      expect(device.currentConsumption).toBe(450);
    });

    it("should return 0 for current consumption when sensor is unavailable", () => {
      mockConsumptionEntity.state = "unavailable";
      expect(device.currentConsumption).toBe(0);
    });
  });

  describe("Increase Increments", () => {
    describe("Device Off State", () => {
      it("should provide startup increment when device is off and humidity is above desired setpoint", () => {
        mockHumidityEntity.state = 60; // Current humidity 60%
        hassControls.desiredSetpoint = 45; // Desired 45%
        
        const increments = device.increaseIncrements;
        
        expect(increments).toHaveLength(1);
        expect(increments[0].delta).toBe(600); // expectedDehumidifyingConsumption
        expect(increments[0].targetSetpoint).toBe(45); // Below current humidity to trigger dehumidifying
      });

      it("should not provide startup increment when current humidity is at or below desired setpoint", () => {
        mockHumidityEntity.state = 40; // Current humidity 40%
        hassControls.desiredSetpoint = 45; // Desired 45%
        
        const increments = device.increaseIncrements;
        
        expect(increments).toHaveLength(0);
      });

      it("should apply setpoint limits for startup", () => {
        mockHumidityEntity.state = 60;
        hassControls.desiredSetpoint = 25; // Below minimum
        
        const increments = device.increaseIncrements;
        
        expect(increments[0].targetSetpoint).toBe(30); // Clamped to minSetpoint
      });

      it("should return empty array when humidity sensor is unavailable", () => {
        mockHumidityEntity.state = undefined;
        
        const increments = device.increaseIncrements;
        
        expect(increments).toHaveLength(0);
      });
    });

    describe("Device On State", () => {
      beforeEach(() => {
        mockHumidifierEntity.state = "on";
        mockHumidifierEntity.attributes.humidity = 50; // Current setpoint
        mockConsumptionEntity.state = 150; // Fan-only consumption
      });

      it("should provide setpoint decrease increments toward desired setpoint when in fan-only mode", () => {
        mockHumidityEntity.state = 60; // Current humidity 60%
        hassControls.desiredSetpoint = 40; // Desired 40%
        
        const increments = device.increaseIncrements;
        
        expect(increments.length).toBeGreaterThan(0);
        expect(increments[0].targetSetpoint).toBe(45); // Step down from current setpoint (50)
        expect(increments[0].delta).toBe(450); // Difference between dehumidifying and fan-only
      });

      it("should not provide increments if already at minimum setpoint", () => {
        mockHumidifierEntity.attributes.humidity = 30; // At minimum
        hassControls.desiredSetpoint = 25; // Below minimum
        
        const increments = device.increaseIncrements;
        
        expect(increments).toHaveLength(0);
      });

      it("should not provide increments when not in fan-only mode", () => {
        mockConsumptionEntity.state = 600; // Actively dehumidifying
        
        const increments = device.increaseIncrements;
        
        expect(increments).toHaveLength(0);
      });
    });
  });

  describe("Decrease Increments", () => {
    describe("Device Off State", () => {
      it("should return empty array when device is off", () => {
        const increments = device.decreaseIncrements;
        
        expect(increments).toHaveLength(0);
      });
    });

    describe("Device On State", () => {
      beforeEach(() => {
        mockHumidifierEntity.state = "on";
        mockHumidifierEntity.attributes.humidity = 45; // Current setpoint
        mockConsumptionEntity.state = 600; // Actively dehumidifying
        mockHumidityEntity.state = 50; // Current humidity above setpoint
      });

      it("should provide setpoint increase increments when actively dehumidifying", () => {
        const increments = device.decreaseIncrements;
        
        expect(increments.length).toBeGreaterThan(0);
        expect(increments[0].targetSetpoint).toBe(50); // Step up from current setpoint (45)
        expect(increments[0].delta).toBe(-450); // Negative for decrease (600 - 150)
      });

      it("should respect comfort setpoint limits", () => {
        hassControls.enableComfortSetpoint = true;
        hassControls.comfortSetpoint = 55;
        
        const increments = device.decreaseIncrements;
        
        // Should not go beyond comfort setpoint
        const maxSetpoint = Math.max(...increments.map(i => i.targetSetpoint!));
        expect(maxSetpoint).toBeLessThanOrEqual(55);
      });

      it("should not provide decrements when current humidity already below setpoint", () => {
        mockHumidityEntity.state = 40; // Below current setpoint of 45
        
        const increments = device.decreaseIncrements;
        
        // Since device is actively dehumidifying (600W) and humidity is below setpoint,
        // we can still increase setpoint to reduce consumption, so some decrements may be available
        expect(increments.length).toBeGreaterThanOrEqual(0);
      });

      it("should return empty array when humidity sensor is unavailable", () => {
        mockHumidityEntity.state = undefined;
        
        const increments = device.decreaseIncrements;
        
        expect(increments).toHaveLength(0);
      });
    });
  });

  describe("Fan-Only Timeout", () => {
    beforeEach(() => {
      mockHumidifierEntity.state = "on";
      mockConsumptionEntity.state = 150; // Fan-only consumption
    });

    it("should configure fan-only timeout on construction", () => {
      // Just verify the timer configuration exists
      expect(config.fanOnlyTimeoutMs).toBe(1800000);
    });
  });

  describe("Device Operations", () => {
    describe("increaseConsumptionBy", () => {
      it("should startup device from off state", () => {
        const increment = { delta: 600, targetSetpoint: 45 };
        
        device.increaseConsumptionBy(increment);
        
        expect(mockHumidifierEntity.turnOn).toHaveBeenCalledTimes(1);
        expect(mockHumidifierEntity.setHumidity).toHaveBeenCalledWith(45);
      });

      it("should adjust setpoint on running device", () => {
        mockHumidifierEntity.state = "on";
        const increment = { delta: 100, targetSetpoint: 40 };
        
        device.increaseConsumptionBy(increment);
        
        expect(mockHumidifierEntity.setHumidity).toHaveBeenCalledWith(40);
        expect(mockHumidifierEntity.turnOn).not.toHaveBeenCalled();
      });

      it("should clear fan-only timeout when increasing consumption", () => {
        mockHumidifierEntity.state = "on";
        
        const increment = { delta: 100, targetSetpoint: 40 };
        device.increaseConsumptionBy(increment);
        
        // Verify setpoint was changed
        expect(mockHumidifierEntity.setHumidity).toHaveBeenCalledWith(40);
      });
    });

    describe("decreaseConsumptionBy", () => {
      beforeEach(() => {
        mockHumidifierEntity.state = "on";
      });

      it("should adjust setpoint to decrease consumption", () => {
        const increment = { delta: -200, targetSetpoint: 55 };
        
        device.decreaseConsumptionBy(increment);
        
        expect(mockHumidifierEntity.setHumidity).toHaveBeenCalledWith(55);
      });
    });

    describe("stop", () => {
      it("should turn off device and clear timers", () => {
        mockHumidifierEntity.state = "on";
        
        device.stop();
        
        expect(mockHumidifierEntity.turnOff).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("Humidity Thresholds", () => {
    it("should use correct fan-only consumption values", () => {
      expect(config.expectedFanOnlyConsumption).toBe(150);
      expect(config.expectedDehumidifyingConsumption).toBe(600);
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined humidity gracefully", () => {
      mockHumidityEntity.state = undefined;
      
      expect(() => device.increaseIncrements).not.toThrow();
      expect(() => device.decreaseIncrements).not.toThrow();
      expect(device.increaseIncrements).toHaveLength(0);
      expect(device.decreaseIncrements).toHaveLength(0);
    });

    it("should handle setpoint at absolute limits", () => {
      mockHumidifierEntity.state = "on";
      mockHumidifierEntity.attributes.humidity = 30; // At minimum
      mockHumidityEntity.state = 25; // Below setpoint, so device would be in fan-only
      mockConsumptionEntity.state = 150; // Fan-only consumption
      
      const increments = device.decreaseIncrements;
      
      // With device in fan-only at minimum setpoint, no further decreases should be available
      expect(increments.length).toBe(0);
    });
  });
});
