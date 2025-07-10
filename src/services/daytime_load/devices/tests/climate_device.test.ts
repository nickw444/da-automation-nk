import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClimateDevice, ClimateDeviceConfig, IClimateHassControls } from "../climate_device";
import { MockClimateEntityWrapper } from "../../../../entities/climate_entity_wrapper";
import { MockSensorEntityWrapper } from "../../../../entities/sensor_entity_wrapper";

describe("ClimateDevice", () => {
  let mockClimateEntity: MockClimateEntityWrapper;
  let mockSensorEntity: MockSensorEntityWrapper;
  let config: ClimateDeviceConfig;
  let hassControls: IClimateHassControls;
  let device: ClimateDevice;

  beforeEach(() => {
    mockClimateEntity = {
      state: "off",
      attributes: {
        current_temperature: 22,
        temperature: 22,
        min_temp: 16,
        max_temp: 30,
        hvac_modes: ["off", "heat", "cool", "fan_only"],
      },
      get roomTemperature() { return this.attributes.current_temperature; },
      get targetTemperature() { return this.attributes.temperature; },
      setTemperature: vi.fn(),
      setHvacMode: vi.fn(),
      turnOff: vi.fn(),
    };
    
    mockSensorEntity = {
      state: 0,
    };

    config = {
      name: "Test Climate Device",
      priority: 1,
      climateEntity: "climate.test_hvac",
      consumptionEntity: "sensor.test_power",
      minSetpoint: 16,
      maxSetpoint: 30,
      setpointStep: 1.0,
      powerOnMinConsumption: 600,     // 600W minimum startup consumption
      powerOnSetpointOffset: 2.0,
      consumptionPerDegree: 350,      // 350W per degree differential (realistic for 8kW unit)
      maxCompressorConsumption: 2500, // 2.5kW maximum consumption at full duty
      fanOnlyMinConsumption: 150,     // 150W fan-only mode
      heatModeMinConsumption: 700,    // 700W minimum heating mode
      coolModeMinConsumption: 700,    // 700W minimum cooling mode
      setpointDebounceMs: 120000,
      modeDebounceMs: 300000,
      startupDebounceMs: 300000,
      fanOnlyTimeoutMs: 1800000,
    };

    hassControls = {
      desiredSetpoint: 24,
      desiredMode: "cool",
      comfortSetpoint: 26,
    };

    device = new ClimateDevice(
      mockClimateEntity,
      mockSensorEntity,
      config,
      hassControls,
    );
  });

  describe("Basic Properties", () => {
    it("should return correct name", () => {
      expect(device.name).toBe("Test Climate Device");
    });

    it("should return correct priority", () => {
      expect(device.priority).toBe(1);
    });

    it("should return correct current consumption", () => {
      mockSensorEntity.state = 450;
      expect(device.currentConsumption).toBe(450);
    });

    it("should return 0 for current consumption when sensor is unavailable", () => {
      mockSensorEntity.state = "unavailable";
      expect(device.currentConsumption).toBe(0);
    });
  });

  describe("Increment Properties", () => {

    describe("Increase Increments", () => {
      it("should return startup increment when device is off", () => {
        mockClimateEntity.state = "off";
        mockClimateEntity.attributes.current_temperature = 22; // Room temp
        mockSensorEntity.state = 0; // Device off, no consumption
        
        const increments = device.increaseIncrements;
        
        expect(increments).toHaveLength(1);
        expect(increments[0]).toHaveProperty("delta");
        expect(increments[0]).toHaveProperty("modeChange", "cool");
        expect(increments[0]).toHaveProperty("targetSetpoint");
        expect(increments[0].delta).toBeGreaterThan(0);
      });

      it("should calculate correct startup power for heating mode", () => {
        mockClimateEntity.state = "off";
        mockClimateEntity.attributes.current_temperature = 20; // Room temp
        mockSensorEntity.state = 0;
        
        // Set up for heating
        hassControls.desiredMode = "heat";
        hassControls.desiredSetpoint = 25;
        hassControls.comfortSetpoint = 18; // Minimum allowed for heating
        
        const increments = device.increaseIncrements;
        
        expect(increments).toHaveLength(1);
        expect(increments[0].modeChange).toBe("heat");
        expect(increments[0].targetSetpoint).toBe(22); // 20 + 2 (powerOnSetpointOffset)
        
        // Calculation: max(|20-22| * 350, 600) = max(700, 600) = 700W
        expect(increments[0].delta).toBe(700);
      });

      it("should calculate correct startup power for cooling mode", () => {
        mockClimateEntity.state = "off";
        mockClimateEntity.attributes.current_temperature = 26; // Room temp
        mockSensorEntity.state = 0;
        
        // Set up for cooling
        hassControls.desiredMode = "cool";
        hassControls.desiredSetpoint = 20;
        hassControls.comfortSetpoint = 24; // Maximum allowed for cooling
        
        const increments = device.increaseIncrements;
        
        expect(increments).toHaveLength(1);
        expect(increments[0].modeChange).toBe("cool");
        expect(increments[0].targetSetpoint).toBe(24); // 26 - 2 (powerOnSetpointOffset)
        
        // Calculation: max(|26-24| * 350, 600) = max(700, 600) = 700W
        expect(increments[0].delta).toBe(700);
      });

      it("should clamp startup setpoint to comfort bounds", () => {
        mockClimateEntity.state = "off";
        mockClimateEntity.attributes.current_temperature = 26; // Room temp
        mockSensorEntity.state = 0;
        
        // Set up for cooling with tight comfort bounds
        hassControls.desiredMode = "cool";
        hassControls.desiredSetpoint = 20;
        hassControls.comfortSetpoint = 23; // Maximum allowed for cooling
        
        const increments = device.increaseIncrements;
        
        expect(increments).toHaveLength(1);
        expect(increments[0].targetSetpoint).toBe(23); // Clamped to comfort setpoint
        // Calculation: max(|26-23| * 350, 600) = max(1050, 600) = 1050W
        expect(increments[0].delta).toBe(1050);
      });

      it("should return setpoint increase increments when device is on", () => {
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.current_temperature = 26; // Room temp (hot)
        mockClimateEntity.attributes.temperature = 24; // Current setpoint (cooling, but not aggressively)
        mockSensorEntity.state = 1200; // Current consumption (realistic for 2°C differential)
        
        // Set up for cooling with room to decrease setpoint further (more aggressive cooling)
        hassControls.desiredMode = "cool";
        hassControls.desiredSetpoint = 20; // Lower than current setpoint (more aggressive)
        
        const increments = device.increaseIncrements;
        
        expect(increments.length).toBeGreaterThan(0);
        
        // Should include increments for 23°C, 22°C, 21°C, 20°C
        expect(increments.length).toBe(4);
        
        // Check first increment (24°C -> 23°C)
        const firstIncrement = increments[0];
        expect(firstIncrement.targetSetpoint).toBe(23);
        expect(firstIncrement.setpointChange).toBe(-1);
        // Current: |26-24| = 2°C differential, Target: |26-23| = 3°C differential
        // Scaled: 1200 * (3/2) = 1800W, Linear: min(3*350, 2500) = 1050W
        // Blended: 1800*0.7 + 1050*0.3 = 1260 + 315 = 1575W, Delta: 1575-1200 = 375W
        expect(firstIncrement.delta).toBe(375);
      });

      it("should return mode change increment from fan_only to heat/cool", () => {
        mockClimateEntity.state = "fan_only";
        mockClimateEntity.attributes.current_temperature = 24; // Room temp
        mockClimateEntity.attributes.temperature = 24; // Current setpoint
        mockSensorEntity.state = 150; // Fan-only consumption
        
        // Set up for cooling mode change
        hassControls.desiredMode = "cool";
        hassControls.desiredSetpoint = 22;
        
        const increments = device.increaseIncrements;
        
        const modeChangeIncrement = increments.find(inc => inc.modeChange === "cool");
        expect(modeChangeIncrement).toBeDefined();
        expect(modeChangeIncrement!.delta).toBeGreaterThan(0);
      });

      it("should return empty array when already at maximum capacity", () => {
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.current_temperature = 30; // Very hot room
        mockClimateEntity.attributes.temperature = 26; // Current setpoint (4°C differential > 3°C)
        mockSensorEntity.state = 2400; // Near maximum consumption
        
        hassControls.desiredMode = "cool";
        hassControls.desiredSetpoint = 22;
        
        const increments = device.increaseIncrements;
        
        expect(increments).toHaveLength(0); // Already at max capacity
      });

      it("should not include increments with zero or negative delta", () => {
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.current_temperature = 22; // Room temp
        mockClimateEntity.attributes.temperature = 22; // Current setpoint matches room temp
        mockSensorEntity.state = 700; // Current minimum consumption
        
        hassControls.desiredMode = "cool";
        hassControls.desiredSetpoint = 20;
        
        const increments = device.increaseIncrements;
        
        // All increments should have positive delta
        increments.forEach(increment => {
          expect(increment.delta).toBeGreaterThan(0);
        });
      });

      it("should respect absolute temperature limits", () => {
        mockClimateEntity.state = "heat";
        mockClimateEntity.attributes.current_temperature = 18; // Room temp
        mockClimateEntity.attributes.temperature = 29; // Current setpoint near max
        mockSensorEntity.state = 2200; // High consumption for large differential
        
        hassControls.desiredMode = "heat";
        hassControls.desiredSetpoint = 32; // Above max setpoint
        
        const increments = device.increaseIncrements;
        
        // Should not exceed maxSetpoint (30)
        increments.forEach(increment => {
          if (increment.targetSetpoint) {
            expect(increment.targetSetpoint).toBeLessThanOrEqual(config.maxSetpoint);
          }
        });
      });
    });

    describe("Decrease Increments", () => {
      it("should return empty array when device is off", () => {
        mockClimateEntity.state = "off";
        mockSensorEntity.state = 0;
        
        const increments = device.decreaseIncrements;
        
        expect(increments).toHaveLength(0);
      });

      it("should return setpoint decrease increments when device is on", () => {
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.current_temperature = 24; // Room temp
        mockClimateEntity.attributes.temperature = 22; // Current setpoint (aggressive cooling)
        mockSensorEntity.state = 1400; // High consumption (realistic for 2°C differential)
        
        // Set up for cooling with room to increase setpoint (less aggressive)
        hassControls.desiredMode = "cool";
        hassControls.desiredSetpoint = 20; // Lower than current setpoint
        hassControls.comfortSetpoint = 26; // Maximum allowed for cooling
        
        const increments = device.decreaseIncrements;
        
        expect(increments.length).toBeGreaterThan(0);
        
        // Should include setpoint increases (moving away from desired toward comfort): 23°C, 24°C, 25°C, 26°C
        const setpointIncrements = increments.filter(inc => inc.targetSetpoint && inc.targetSetpoint > 22);
        expect(setpointIncrements.length).toBe(4);
        
        // Check first decrease increment (22°C -> 23°C, less aggressive cooling)
        const firstDecrement = setpointIncrements[0];
        expect(firstDecrement.targetSetpoint).toBe(23);
        expect(firstDecrement.setpointChange).toBe(1);
        // Current: |24-22| = 2°C differential, Target: |24-23| = 1°C differential  
        // Scaled: 1400 * (1/2) = 700W, Linear: max(1*350, 700) = 700W
        // Blended: 700*0.7 + 700*0.3 = 490 + 210 = 700W, Delta: |700-1400| = 700W
        expect(firstDecrement.delta).toBe(700);
      });

      it("should return fan-only mode increment when no comfort setpoint", () => {
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.current_temperature = 24; // Room temp
        mockClimateEntity.attributes.temperature = 22; // Current setpoint
        mockSensorEntity.state = 1400; // High consumption in cooling mode
        
        // Set up for cooling without comfort setpoint (fan-only allowed)
        hassControls.desiredMode = "cool";
        hassControls.desiredSetpoint = 20;
        hassControls.comfortSetpoint = undefined; // No comfort limit
        
        const increments = device.decreaseIncrements;
        
        const fanOnlyIncrement = increments.find(inc => inc.modeChange === "fan_only");
        expect(fanOnlyIncrement).toBeDefined();
        // Current calc: 1400W cooling -> fan_only mode
        // Blended calc gives final consumption, then delta = |final - current|
        expect(fanOnlyIncrement!.delta).toBe(210); // Actual calculated delta
      });

      it("should not include fan-only mode when comfort setpoint is specified", () => {
        mockClimateEntity.state = "heat";
        mockClimateEntity.attributes.current_temperature = 20; // Room temp
        mockClimateEntity.attributes.temperature = 25; // Current setpoint
        mockSensorEntity.state = 1750; // Current consumption (5°C differential)
        
        // Set up for heating with comfort setpoint (fan-only not allowed)
        hassControls.desiredMode = "heat";
        hassControls.desiredSetpoint = 28;
        hassControls.comfortSetpoint = 18; // Minimum allowed for heating
        
        const increments = device.decreaseIncrements;
        
        const fanOnlyIncrement = increments.find(inc => inc.modeChange === "fan_only");
        expect(fanOnlyIncrement).toBeUndefined();
      });

      it("should include off mode increment to turn device completely off", () => {
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.current_temperature = 24; // Room temp
        mockClimateEntity.attributes.temperature = 22; // Current setpoint
        mockSensorEntity.state = 1400; // Current consumption
        
        hassControls.desiredMode = "cool";
        hassControls.desiredSetpoint = 20;
        
        const increments = device.decreaseIncrements;
        
        const offIncrement = increments.find(inc => inc.modeChange === "off");
        expect(offIncrement).toBeDefined();
        expect(offIncrement!.delta).toBe(1400); // Should exactly equal current consumption
      });

      it("should respect comfort setpoint boundaries for heating", () => {
        mockClimateEntity.state = "heat";
        mockClimateEntity.attributes.current_temperature = 18; // Room temp
        mockClimateEntity.attributes.temperature = 25; // Current setpoint (aggressive heating)
        mockSensorEntity.state = 2200; // High consumption (7°C differential)
        
        // Set up for heating with comfort boundary
        hassControls.desiredMode = "heat";
        hassControls.desiredSetpoint = 28; // Higher than current setpoint
        hassControls.comfortSetpoint = 20; // Minimum allowed for heating
        
        const increments = device.decreaseIncrements;
        
        // All setpoint decreases should respect comfort boundary
        increments.forEach(increment => {
          if (increment.targetSetpoint) {
            expect(increment.targetSetpoint).toBeGreaterThanOrEqual(20); // Above comfort minimum
          }
        });
      });

      it("should respect comfort setpoint boundaries for cooling", () => {
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.current_temperature = 28; // Room temp
        mockClimateEntity.attributes.temperature = 22; // Current setpoint (aggressive cooling)
        mockSensorEntity.state = 700; // High consumption
        
        // Set up for cooling with comfort boundary
        hassControls.desiredMode = "cool";
        hassControls.desiredSetpoint = 20; // Lower than current setpoint
        hassControls.comfortSetpoint = 25; // Maximum allowed for cooling
        
        const increments = device.decreaseIncrements;
        
        // All setpoint increases should respect comfort boundary
        increments.forEach(increment => {
          if (increment.targetSetpoint) {
            expect(increment.targetSetpoint).toBeLessThanOrEqual(25); // Below comfort maximum
          }
        });
      });

      it("should not include increments that don't actually decrease consumption", () => {
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.current_temperature = 22; // Room temp
        mockClimateEntity.attributes.temperature = 24; // Current setpoint (room is cooler)
        mockSensorEntity.state = 200; // Low consumption already
        
        hassControls.desiredMode = "cool";
        hassControls.desiredSetpoint = 20;
        
        const increments = device.decreaseIncrements;
        
        // All increments should have positive delta (representing decreases)
        increments.forEach(increment => {
          expect(increment.delta).toBeGreaterThan(0);
        });
      });

      it("should respect absolute temperature limits", () => {
        mockClimateEntity.state = "heat";
        mockClimateEntity.attributes.current_temperature = 18; // Room temp
        mockClimateEntity.attributes.temperature = 17; // Current setpoint near min
        mockSensorEntity.state = 400; // Current consumption
        
        hassControls.desiredMode = "heat";
        hassControls.desiredSetpoint = 25;
        
        const increments = device.decreaseIncrements;
        
        // Should not go below minSetpoint (16)
        increments.forEach(increment => {
          if (increment.targetSetpoint) {
            expect(increment.targetSetpoint).toBeGreaterThanOrEqual(config.minSetpoint);
          }
        });
      });
    });
  });

  describe("Change State", () => {
    it("should return undefined when no changes pending and not in debounce", () => {
      expect(device.changeState).toBeUndefined();
    });

    // Note: Debounce state and pending state behavior will be tested functionally 
    // when increaseConsumptionBy/decreaseConsumptionBy are implemented in Phase 5
  });

  describe("Action Methods", () => {
    // Note: Debounce behavior during increaseConsumptionBy/decreaseConsumptionBy 
    // will be tested functionally when these methods are implemented in Phase 5

    it("should call turnOff when stop is called", () => {
      device.stop();
      
      expect(mockClimateEntity.turnOff).toHaveBeenCalledTimes(1);
    });

    // Note: Debounce state reset behavior will be tested functionally 
    // when debounce behavior is triggered through public API actions in Phase 5
  });

  // Note: Debounce logic will be tested functionally in Phase 5 when
  // increaseConsumptionBy/decreaseConsumptionBy trigger the debounce behavior

  describe("Configuration", () => {
    it("should accept valid configuration", () => {
      expect(() => new ClimateDevice(
        mockClimateEntity,
        mockSensorEntity,
        config,
        hassControls,
      )).not.toThrow();
    });

    it("should accept hassControls without comfort setpoint", () => {
      const controlsWithoutComfort = {
        desiredSetpoint: 24,
        desiredMode: "cool" as const,
      };

      expect(() => new ClimateDevice(
        mockClimateEntity,
        mockSensorEntity,
        config,
        controlsWithoutComfort,
      )).not.toThrow();
    });
  });
});
