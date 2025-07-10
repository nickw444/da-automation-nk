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
      compressorStartupMinConsumption: 600,     // 600W minimum startup consumption
      powerOnSetpointOffset: 2.0,
      consumptionPerDegree: 350,      // 350W per degree differential (realistic for 8kW unit)
      maxCompressorConsumption: 2500, // 2.5kW maximum consumption at full duty
      fanOnlyMinConsumption: 150,     // 150W fan-only mode
      heatCoolMinConsumption: 700,    // 700W minimum heating/cooling mode
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
        
        expect(increments).toEqual([
          expect.objectContaining({
            delta: 1300, // 600W (startup base) + |22-24| * 350 = 600W + 2*350 = 600W + 700W = 1300W
            modeChange: "cool",
            targetSetpoint: 24, // min(22 - 2, 24) = min(20, 24) = 20, but then clamped to desired 24
          })
        ]);
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
        
        expect(increments).toEqual([
          expect.objectContaining({
            delta: 1300, // 600W (startup base) + |20-22| * 350 = 600W + 2*350 = 600W + 700W = 1300W
            modeChange: "heat",
            targetSetpoint: 22, // 20 + 2 (powerOnSetpointOffset)
          })
        ]);
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
        
        expect(increments).toEqual([
          expect.objectContaining({
            delta: 1300, // 600W (startup base) + |26-24| * 350 = 600W + 2*350 = 600W + 700W = 1300W
            modeChange: "cool",
            targetSetpoint: 24, // 26 - 2 (powerOnSetpointOffset)
          })
        ]);
      });

      it("should move toward desired setpoint regardless of comfort bounds for startup", () => {
        mockClimateEntity.state = "off";
        mockClimateEntity.attributes.current_temperature = 26; // Room temp
        mockSensorEntity.state = 0;
        
        // Set up for cooling - should move toward desired, not limited by comfort
        hassControls.desiredMode = "cool";
        hassControls.desiredSetpoint = 20;
        hassControls.comfortSetpoint = 23; // Should NOT limit increase operations
        
        const increments = device.increaseIncrements;
        
        expect(increments).toEqual([
          expect.objectContaining({
            delta: 1300, // 600W (startup base) + |26-24| * 350 = 600W + 2*350 = 600W + 700W = 1300W
            modeChange: "cool",
            targetSetpoint: 24, // 26 - 2 (powerOnSetpointOffset), moving toward desired 20°C
          })
        ]);
      });

      it("should ignore comfort setpoint when calculating increase increments", () => {
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.current_temperature = 28; // Hot room
        mockClimateEntity.attributes.temperature = 26; // Current setpoint
        mockSensorEntity.state = 1200; // Current consumption
        
        // Set up with comfort setpoint that would normally "limit" us
        hassControls.desiredMode = "cool";
        hassControls.desiredSetpoint = 18; // Very aggressive desired
        hassControls.comfortSetpoint = 24; // Comfort limit warmer than current setpoint
        
        const increments = device.increaseIncrements;
        
        // Should generate increments all the way to desired (18°C), ignoring comfort (24°C)
        expect(increments).toEqual([
          expect.objectContaining({
            targetSetpoint: 25,
            setpointChange: -1,
            delta: 350, // 1°C more aggressive = 1*350W = 350W
          }),
          expect.objectContaining({
            targetSetpoint: 24,
            setpointChange: -2,
            delta: 700, // 2°C more aggressive = 2*350W = 700W
          }),
          expect.objectContaining({
            targetSetpoint: 23,
            setpointChange: -3,
            delta: 1050, // 3°C more aggressive = 3*350W = 1050W
          }),
          expect.objectContaining({
            targetSetpoint: 22,
            setpointChange: -4,
            delta: 1300, // 4°C would be 1400W, but 1200W + 1400W = 2600W clamped to 2500W → delta = 1300W
          }),
          // Note: Further increments would all produce delta=1300W due to maxCompressorConsumption clamping,
          // so they get filtered out by the duplicate delta check
        ]);
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
        
        expect(increments).toEqual([
          expect.objectContaining({
            targetSetpoint: 23, // First increment (24 -> 23)
            setpointChange: -1,
            delta: 350, // 1°C more aggressive = 1*350W = 350W
          }),
          expect.objectContaining({
            targetSetpoint: 22, // Second increment (24 -> 22)
            setpointChange: -2,
            delta: 700, // 2°C more aggressive = 2*350W = 700W
          }),
          expect.objectContaining({
            targetSetpoint: 21,
            setpointChange: -3,
            delta: 1050, // 3°C more aggressive = 3*350W = 1050W
          }),
          expect.objectContaining({
            targetSetpoint: 20,
            setpointChange: -4,
            delta: 1300, // 4°C would be 1400W, but 1200W + 1400W = 2600W clamped to 2500W → delta = 1300W
          }),
        ]);
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
        
        expect(increments).toEqual([
          expect.objectContaining({
            targetSetpoint: 23,
            setpointChange: -1, // 23 - 24
            modeChange: "cool",
            delta: 800, // 600W (startup) + |24-23|*350W = 600W + 350W = 950W total, 950W - 150W = 800W delta
          }),
          expect.objectContaining({
            targetSetpoint: 22,
            setpointChange: -2, // 22 - 24
            modeChange: "cool",
            delta: 1150, // 600W (startup) + |24-22|*350W = 600W + 700W = 1300W total, 1300W - 150W = 1150W delta
          }),
        ]);
      });

      it("should return empty array when already at maximum capacity", () => {
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.current_temperature = 30; // Very hot room
        mockClimateEntity.attributes.temperature = 26; // Current setpoint (4°C differential)
        mockSensorEntity.state = 2500; // At maximum consumption (maxCompressorConsumption)
        
        hassControls.desiredMode = "cool";
        hassControls.desiredSetpoint = 22;
        
        const increments = device.increaseIncrements;
        
        // At maximum consumption (2500W), no increments should increase consumption further
        expect(increments).toEqual([]);
      });

      it("should not include increments with zero or negative delta", () => {
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.current_temperature = 22; // Room temp
        mockClimateEntity.attributes.temperature = 24; // Current setpoint warmer than room temp
        mockSensorEntity.state = 200; // Current low consumption (ineffective setpoint)
        
        hassControls.desiredMode = "cool";
        hassControls.desiredSetpoint = 20;
        
        const increments = device.increaseIncrements;
        
        // Should return some increments
        expect(increments.length).toBeGreaterThan(0);
        
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
        
        // Should not exceed maxSetpoint (30) - only one increment from 29 to 30
        expect(increments).toEqual([
          expect.objectContaining({
            targetSetpoint: 30, // Should be clamped to maxSetpoint
            setpointChange: 1, // 30 - 29
            delta: expect.any(Number),
          }),
        ]);
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
        
        // With corrected implementation: deltas are positive values representing consumption reduction
        // Current setpoint: 22°C, moving to higher setpoints reduces aggressiveness
        // 22°C -> 23°C: 1°C less aggressive = 350W reduction
        // 22°C -> 24°C: 2°C less aggressive = 700W reduction
        // 22°C -> 25°C: 3°C less aggressive = 1050W reduction
        // 22°C -> 26°C: 4°C less aggressive = 1400W reduction
        
        // Should have 4 setpoint increments (up to comfort setpoint 26°C), no fan-only due to comfort setpoint
        expect(increments).toEqual([
          expect.objectContaining({ 
            targetSetpoint: 23, 
            setpointChange: 1, 
            delta: 350
            // No modeChange property for setpoint adjustments
          }),
          expect.objectContaining({ 
            targetSetpoint: 24, 
            setpointChange: 2, 
            delta: 700
          }),
          expect.objectContaining({ 
            targetSetpoint: 25, 
            setpointChange: 3, 
            delta: 1050
          }),
          expect.objectContaining({ 
            targetSetpoint: 26, 
            setpointChange: 4, 
            delta: 1400
          }),
          // No fan-only increment because comfort setpoint is specified
        ]);

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
        
        // Should have 8 setpoint increments (23-30°C) + 1 fan-only increment (no comfort limit)
        expect(increments).toEqual([
          expect.objectContaining({ targetSetpoint: 23, setpointChange: 1, delta: 350 }),   // 1°C less aggressive
          expect.objectContaining({ targetSetpoint: 24, setpointChange: 2, delta: 700 }),   // 2°C less aggressive  
          expect.objectContaining({ targetSetpoint: 25, setpointChange: 3, delta: 1050 }),  // 3°C less aggressive
          expect.objectContaining({ targetSetpoint: 26, setpointChange: 4, delta: 1400 }),  // 4°C less aggressive
          expect.objectContaining({ targetSetpoint: 27, setpointChange: 5, delta: 1750 }),  // 5°C less aggressive
          expect.objectContaining({ targetSetpoint: 28, setpointChange: 6, delta: 2100 }),  // 6°C less aggressive
          expect.objectContaining({ targetSetpoint: 29, setpointChange: 7, delta: 2450 }),  // 7°C less aggressive
          expect.objectContaining({ targetSetpoint: 30, setpointChange: 8, delta: 2800 }),  // 8°C less aggressive (maxSetpoint)
          expect.objectContaining({ 
            modeChange: "fan_only", 
            delta: 1250  // 1400W - 150W = 1250W reduction
            // No targetSetpoint for mode changes
          }),
        ]);
        
        // Check that off increment is NOT offered (handled internally by fan_only timeout)
        const offIncrement = increments.find(inc => inc.modeChange === "off");
        expect(offIncrement).toBeUndefined();
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

      it("should not include off mode increment (handled internally by fan_only timeout)", () => {
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.current_temperature = 24; // Room temp
        mockClimateEntity.attributes.temperature = 22; // Current setpoint
        mockSensorEntity.state = 1400; // Current consumption
        
        hassControls.desiredMode = "cool";
        hassControls.desiredSetpoint = 20;
        
        const increments = device.decreaseIncrements;
        
        // Off mode should not be offered as direct increment - it's handled internally by fan_only timeout
        const offIncrement = increments.find(inc => inc.modeChange === "off");
        expect(offIncrement).toBeUndefined();
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
