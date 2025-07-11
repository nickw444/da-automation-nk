import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClimateDevice, ClimateDeviceOptions, IClimateHassControls } from "../climate_device";
import { MockClimateEntityWrapper } from "../../../../entities/climate_entity_wrapper";
import { MockSensorEntityWrapper } from "../../../../entities/sensor_entity_wrapper";

describe("ClimateDevice", () => {
  let mockClimateEntity: MockClimateEntityWrapper;
  let mockSensorEntity: MockSensorEntityWrapper;
  let config: ClimateDeviceOptions;
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
      "Test Climate Device",
      1,
      mockClimateEntity,
      mockSensorEntity,
      hassControls,
      config,
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
            delta: 350, // 1°C more aggressive = 1*350W = 350W
          }),
          expect.objectContaining({
            targetSetpoint: 24,
            delta: 700, // 2°C more aggressive = 2*350W = 700W
          }),
          expect.objectContaining({
            targetSetpoint: 23,
            delta: 1050, // 3°C more aggressive = 3*350W = 1050W
          }),
          expect.objectContaining({
            targetSetpoint: 22,
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
            delta: 350, // 1°C more aggressive = 1*350W = 350W
          }),
          expect.objectContaining({
            targetSetpoint: 22, // Second increment (24 -> 22)
            delta: 700, // 2°C more aggressive = 2*350W = 700W
          }),
          expect.objectContaining({
            targetSetpoint: 21,
            delta: 1050, // 3°C more aggressive = 3*350W = 1050W
          }),
          expect.objectContaining({
            targetSetpoint: 20,
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
            modeChange: "cool",
            delta: 800, // 600W (startup) + |24-23|*350W = 600W + 350W = 950W total, 950W - 150W = 800W delta
          }),
          expect.objectContaining({
            targetSetpoint: 22,
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
        
        // With corrected implementation: deltas are negative values representing consumption reduction
        // Current consumption: 1400W, heatCoolMinConsumption: 700W, max reduction: 700W
        // 22°C -> 23°C: 1°C less aggressive = 350W reduction (delta: -350W)
        // 22°C -> 24°C: 2°C less aggressive = 700W reduction (delta: -700W) 
        // 22°C -> 25°C: 3°C would be 1050W, but clamped to 700W max reduction (delta: -700W, filtered as duplicate)
        // 22°C -> 26°C: 4°C would be 1400W, but clamped to 700W max reduction (delta: -700W, filtered as duplicate)
        
        // Should have 2 unique setpoint increments (duplicate deltas filtered out), no fan-only due to comfort setpoint
        expect(increments).toEqual([
          expect.objectContaining({ 
            targetSetpoint: 23, 
            delta: -350  // 350W reduction
            // No modeChange property for setpoint adjustments
          }),
          expect.objectContaining({ 
            targetSetpoint: 24, 
            delta: -700  // 700W reduction (max possible)
          }),
          // 25°C and 26°C setpoints filtered out due to duplicate -700W delta
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
        
        // Should have 2 unique setpoint increments + 1 fan-only increment (no comfort limit)
        // Current consumption: 1400W, heatCoolMinConsumption: 700W, max reduction: 700W
        // Duplicate deltas are filtered out (25°C-30°C would all be -700W, so only first occurrence is kept)
        expect(increments).toEqual([
          expect.objectContaining({ targetSetpoint: 23, delta: -350 }),  // 350W reduction
          expect.objectContaining({ targetSetpoint: 24, delta: -700 }),  // 700W reduction (max)
          // 25°C-30°C setpoints filtered out due to duplicate -700W delta
          expect.objectContaining({ 
            modeChange: "fan_only", 
            delta: -1250  // 1400W - 150W = 1250W reduction
            // No targetSetpoint for mode changes
          }),
        ]);
      });

      it("should not include fan-only mode when comfort setpoint is specified", () => {
        mockClimateEntity.state = "heat";
        mockClimateEntity.attributes.current_temperature = 20; // Room temp
        mockClimateEntity.attributes.temperature = 25; // Current setpoint
        mockSensorEntity.state = 1750; // Current consumption (5°C differential)
        
        // Set up for heating with comfort setpoint (fan-only not allowed)
        hassControls.desiredMode = "heat";
        hassControls.desiredSetpoint = 28;
        hassControls.comfortSetpoint = 24; // Minimum allowed for heating
        
        const increments = device.decreaseIncrements;
        
        const fanOnlyIncrement = increments.find(inc => inc.modeChange === "fan_only");
        expect(fanOnlyIncrement).toBeUndefined();
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
        
        // All increments should have negative delta (representing decreases)
        increments.forEach(increment => {
          expect(increment.delta).toBeLessThan(0);
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
    describe("increaseConsumptionBy", () => {
      it("should handle startup from off state with mode and setpoint", () => {
        mockClimateEntity.state = "off";
        const increment = {
          delta: 1300,
          modeChange: "cool" as const,
          targetSetpoint: 24,
        };

        device.increaseConsumptionBy(increment);

        expect(mockClimateEntity.setTemperature).toHaveBeenCalledWith({
          temperature: 24,
          hvac_mode: "cool",
        });
      });

      it("should handle mode change from fan_only to heat/cool", () => {
        mockClimateEntity.state = "fan_only";
        mockClimateEntity.attributes.temperature = 24;
        const increment = {
          delta: 800,
          modeChange: "cool" as const,
          targetSetpoint: 23,
        };

        device.increaseConsumptionBy(increment);

        expect(mockClimateEntity.setTemperature).toHaveBeenCalledWith({
          temperature: 23,
          hvac_mode: "cool",
        });
      });

      it("should handle absolute setpoint change", () => {
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.temperature = 24;
        const increment = {
          delta: 350,
          targetSetpoint: 23,
        };

        device.increaseConsumptionBy(increment);

        expect(mockClimateEntity.setTemperature).toHaveBeenCalledWith({
          temperature: 23,
        });
      });



      it("should record appropriate state change and set pending state", () => {
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.temperature = 24;
        const increment = {
          delta: 350,
          targetSetpoint: 23,
        };

        device.increaseConsumptionBy(increment);

        // Check that changeState indicates increase pending
        expect(device.changeState).toEqual({
          type: "increase",
          expectedFutureConsumption: 0
        });
      });

      it("should throw error when change already pending", () => {
        // First action to trigger pending state
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.temperature = 24;
        const firstIncrement = {
          delta: 350,
          targetSetpoint: 23,
        };
        device.increaseConsumptionBy(firstIncrement);
        
        // Second action should throw error due to pending change
        const secondIncrement = {
          delta: 700,
          targetSetpoint: 22,
        };
        expect(() => device.increaseConsumptionBy(secondIncrement)).toThrow(
          "Cannot increase consumption for Test Climate Device: change already pending"
        );
      });
    });

    describe("decreaseConsumptionBy", () => {
      it("should handle mode change to fan_only", () => {
        mockClimateEntity.state = "cool";
        const increment = {
          delta: -1250,
          modeChange: "fan_only" as const,
        };

        device.decreaseConsumptionBy(increment);

        expect(mockClimateEntity.setHvacMode).toHaveBeenCalledWith("fan_only");
      });

      it("should handle absolute setpoint change", () => {
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.temperature = 22;
        const increment = {
          delta: -350,
          targetSetpoint: 23,
        };

        device.decreaseConsumptionBy(increment);

        expect(mockClimateEntity.setTemperature).toHaveBeenCalledWith({
          temperature: 23,
        });
      });



      it("should record appropriate state change and set pending state", () => {
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.temperature = 22;
        const increment = {
          delta: -350,
          targetSetpoint: 23,
        };

        device.decreaseConsumptionBy(increment);

        // Check that changeState indicates decrease pending
        expect(device.changeState).toEqual({
          type: "decrease",
          expectedFutureConsumption: 0
        });
      });

      it("should throw error when change already pending", () => {
        // First action to trigger pending state
        mockClimateEntity.state = "cool";
        mockClimateEntity.attributes.temperature = 22;
        const firstIncrement = {
          delta: -350,
          targetSetpoint: 23,
        };
        device.decreaseConsumptionBy(firstIncrement);
        
        // Second action should throw error due to pending change
        const secondIncrement = {
          delta: -700,
          targetSetpoint: 24,
        };
        expect(() => device.decreaseConsumptionBy(secondIncrement)).toThrow(
          "Cannot decrease consumption for Test Climate Device: change already pending"
        );
      });
    });

    it("should call turnOff when stop is called", () => {
      device.stop();
      
      expect(mockClimateEntity.turnOff).toHaveBeenCalledTimes(1);
    });

    it("should reset state and debounce when stop is called", () => {
      // First trigger a state change
      mockClimateEntity.state = "cool";
      const increment = {
        delta: 350,
        targetSetpoint: 23,
      };
      device.increaseConsumptionBy(increment);

      // Verify we're in pending state
      expect(device.changeState?.type).toBe("increase");

      // Call stop
      device.stop();

      // State should be reset
      expect(device.changeState).toBeUndefined();
    });
  });

  // Note: Debounce logic will be tested functionally in Phase 5 when
  // increaseConsumptionBy/decreaseConsumptionBy trigger the debounce behavior

  describe("Fan-Only Timeout Logic", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should start timeout when transitioning to fan-only mode", () => {
      mockClimateEntity.state = "cool";
      mockSensorEntity.state = 1400;
      const increment = {
        delta: -1250,
        modeChange: "fan_only" as const,
      };

      device.decreaseConsumptionBy(increment);

      expect(mockClimateEntity.setHvacMode).toHaveBeenCalledWith("fan_only");
    });

    it("should automatically turn off device after fan-only timeout", () => {
      mockClimateEntity.state = "cool";
      mockSensorEntity.state = 1400;
      const increment = {
        delta: -1250,
        modeChange: "fan_only" as const,
      };

      device.decreaseConsumptionBy(increment);

      // Fast-forward time to trigger timeout
      vi.advanceTimersByTime(config.fanOnlyTimeoutMs);

      expect(mockClimateEntity.turnOff).toHaveBeenCalledTimes(1);
    });

    it("should clear timeout when transitioning away from fan-only mode", () => {
      // Test uses internal timeout mechanism rather than state machine interactions
      // since that would be tested in integration tests
      
      // Start with device in fan-only mode (simulating already completed transition)
      mockClimateEntity.state = "fan_only";
      mockSensorEntity.state = 150;
      
      // Create device and manually trigger fan-only timeout to verify it works
      const testDevice = new ClimateDevice(
        "Test Climate Device",
        1,
        mockClimateEntity,
        mockSensorEntity,
        hassControls,
        config,
      );
      
      // Access private method through any casting to start timeout
      (testDevice as any).startFanOnlyTimeout();
      
      // Move forward halfway through timeout
      vi.advanceTimersByTime(config.fanOnlyTimeoutMs / 2);
      
      // Clear timeout (simulating mode change)
      (testDevice as any).clearFanOnlyTimeout();
      
      // Fast-forward past when timeout would have triggered
      vi.advanceTimersByTime(config.fanOnlyTimeoutMs + 1000);

      // Device should NOT be turned off (timeout was cleared)
      expect(mockClimateEntity.turnOff).not.toHaveBeenCalled();
    });

    it("should clear timeout when stop is called", () => {
      // Transition to fan-only
      mockClimateEntity.state = "cool";
      mockSensorEntity.state = 1400;
      const increment = {
        delta: -1250,
        modeChange: "fan_only" as const,
      };
      device.decreaseConsumptionBy(increment);

      // Call stop before timeout
      device.stop();

      // Fast-forward past timeout
      vi.advanceTimersByTime(config.fanOnlyTimeoutMs + 1000);

      // turnOff should only be called once (from stop method), not from timeout
      expect(mockClimateEntity.turnOff).toHaveBeenCalledTimes(1);
    });

    it("should reset state machine after automatic timeout", () => {
      mockClimateEntity.state = "cool";
      mockSensorEntity.state = 1400;
      const increment = {
        delta: -1250,
        modeChange: "fan_only" as const,
      };

      device.decreaseConsumptionBy(increment);

      // Verify we're in pending state initially
      expect(device.changeState?.type).toBe("decrease");

      // Fast-forward to trigger timeout
      vi.advanceTimersByTime(config.fanOnlyTimeoutMs);

      // State should be reset after automatic off
      expect(device.changeState).toBeUndefined();
    });

    it("should handle multiple fan-only timeout starts by clearing previous timeout", () => {
      // Test internal timeout reset behavior directly
      mockClimateEntity.state = "fan_only";
      mockSensorEntity.state = 150;
      
      const testDevice = new ClimateDevice(
        "Test Climate Device",
        1,
        mockClimateEntity,
        mockSensorEntity,
        hassControls,
        config,
      );
      
      // Start first timeout
      (testDevice as any).startFanOnlyTimeout();
      
      // Move forward partway through first timeout
      vi.advanceTimersByTime(config.fanOnlyTimeoutMs / 2);
      
      // Start second timeout (should clear the first)
      (testDevice as any).startFanOnlyTimeout();

      // Advance to when the first timeout would have triggered
      vi.advanceTimersByTime(config.fanOnlyTimeoutMs / 2 + 1000);

      // Device should NOT be turned off yet (first timer was cleared)
      expect(mockClimateEntity.turnOff).not.toHaveBeenCalled();

      // Advance to complete the second timeout period
      vi.advanceTimersByTime(config.fanOnlyTimeoutMs / 2);

      // Now device should be turned off
      expect(mockClimateEntity.turnOff).toHaveBeenCalledTimes(1);
    });
  });

  describe("Configuration", () => {
    it("should accept valid configuration", () => {
      expect(() => new ClimateDevice(
        "Test Climate Device",
        1,
        mockClimateEntity,
        mockSensorEntity,
        hassControls,
        config,
      )).not.toThrow();
    });

    it("should accept hassControls without comfort setpoint", () => {
      const controlsWithoutComfort = {
        desiredSetpoint: 24,
        desiredMode: "cool" as const,
      };

      expect(() => new ClimateDevice(
        "Test Climate Device",
        1,
        mockClimateEntity,
        mockSensorEntity,
        controlsWithoutComfort,
        config,
      )).not.toThrow();
    });
  });
});
