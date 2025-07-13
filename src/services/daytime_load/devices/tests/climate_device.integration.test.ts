import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClimateDevice, ClimateDeviceOptions, IClimateHassControls } from "../climate_device";
import { MockClimateEntityWrapper } from "../../../../entities/climate_entity_wrapper";
import { MockSensorEntityWrapper } from "../../../../entities/sensor_entity_wrapper";
import { ConsumptionTransitionState } from "../consumption_transition_state_machine";

describe("ClimateDevice Integration Tests", () => {
  let mockClimateEntity: MockClimateEntityWrapper;
  let mockSensorEntity: MockSensorEntityWrapper;
  let config: ClimateDeviceOptions;
  let hassControls: IClimateHassControls;
  let device: ClimateDevice;

  beforeEach(() => {
    vi.useFakeTimers();

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
      onUpdate: vi.fn(),
    };

    config = {
      minSetpoint: 16,
      maxSetpoint: 30,
      setpointStep: 1.0,
      compressorStartupMinConsumption: 600,
      powerOnSetpointOffset: 2.0,
      consumptionPerDegree: 350,
      maxCompressorConsumption: 2500,
      fanOnlyMinConsumption: 150,
      heatCoolMinConsumption: 700,
      setpointDebounceMs: 120000, // 2 minutes
      modeDebounceMs: 300000,     // 5 minutes
      startupDebounceMs: 300000,  // 5 minutes
      fanOnlyTimeoutMs: 1800000,  // 30 minutes
    };

    hassControls = {
      desiredSetpoint: 20,
      desiredMode: "cool",
      comfortSetpoint: 26, // For cooling, comfort setpoint is max acceptable (warmer than desired)
    };

    device = new ClimateDevice(
      "Integration Test Climate",
      1,
      mockClimateEntity,
      mockSensorEntity,
      hassControls,
      config,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Complete Cooling Cycle", () => {
    it("should execute a complete cooling workflow from off to target", async () => {
      // Initial state: Device off, hot room
      mockClimateEntity.state = "off";
      mockClimateEntity.attributes.current_temperature = 28; // Hot room
      mockSensorEntity.state = 0; // No consumption

      // Step 1: Get startup increment and execute
      const startupIncrements = device.increaseIncrements;
      expect(startupIncrements).toHaveLength(1);
      const startupIncrement = startupIncrements[0];

      expect(startupIncrement).toEqual({
        delta: 1300, // 600W + |28-26|*350W = 600W + 700W = 1300W
        modeChange: "cool",
        targetSetpoint: 26, // 28 - 2 (offset) = 26
      });

      device.increaseConsumptionBy(startupIncrement);

      // Verify device was commanded to start
      expect(mockClimateEntity.setTemperature).toHaveBeenCalledWith({
        temperature: 26,
        hvac_mode: "cool",
      });

      // Device should be in pending increase state
      expect(device.changeState).toEqual({
        type: "increase",
        expectedFutureConsumption: 0
      });

      // Step 2: Simulate device startup completion
      mockClimateEntity.state = "cool";
      mockClimateEntity.attributes.temperature = 26;
      mockSensorEntity.state = 1300; // Startup consumption achieved

      // Wait for full startup debounce period and clear pending state
      vi.advanceTimersByTime(config.startupDebounceMs); // Full startup debounce
      (device as any).consumptionTransitionStateMachine.transitionTo(ConsumptionTransitionState.IDLE);

      // Step 3: Get more aggressive increments to move toward desired (20°C)
      const aggressiveIncrements = device.increaseIncrements;
      expect(aggressiveIncrements.length).toBeGreaterThan(0);

      const nextIncrement = aggressiveIncrements[0];
      expect(nextIncrement.targetSetpoint).toBe(25); // 26 -> 25 (more aggressive)

      device.increaseConsumptionBy(nextIncrement);

      // Verify setpoint adjustment (should be the second call, first was startup)
      expect(mockClimateEntity.setTemperature).toHaveBeenNthCalledWith(2, {
        temperature: 25,
      });

      // Step 4: Simulate room cooling down over time and setpoint change completing
      mockClimateEntity.attributes.current_temperature = 25; // Room cooling toward setpoint
      mockClimateEntity.attributes.temperature = 25; // Device achieved new setpoint
      mockSensorEntity.state = 1750; // Higher consumption for aggressive cooling

      // Wait for setpoint debounce to complete
      vi.advanceTimersByTime(config.setpointDebounceMs);
      (device as any).consumptionTransitionStateMachine.transitionTo(ConsumptionTransitionState.IDLE);

      // Step 5: Device should offer decreases (move setpoint toward comfort limit)
      const decreaseIncrements = device.decreaseIncrements;
      expect(decreaseIncrements.length).toBeGreaterThan(0);

      // Should offer less aggressive setpoints (moving toward comfort limit of 26°C)
      decreaseIncrements.forEach(dec => {
        if (dec.targetSetpoint) {
          expect(dec.targetSetpoint).toBeGreaterThan(25); // Moving away from desired (less aggressive cooling)
          expect(dec.targetSetpoint).toBeLessThanOrEqual(hassControls.comfortSetpoint!); // Limited by comfort (26°C)
        }
        expect(dec.delta).toBeLessThan(0); // All should be consumption decreases
      });
    });
  });

  describe("Complete Heating Cycle", () => {
    it("should execute a complete heating workflow", async () => {
      // Setup for heating scenario
      hassControls.desiredMode = "heat";
      hassControls.desiredSetpoint = 26;
      hassControls.comfortSetpoint = 20; // Minimum acceptable for heating

      // Initial state: Device off, cold room
      mockClimateEntity.state = "off";
      mockClimateEntity.attributes.current_temperature = 18; // Cold room
      mockSensorEntity.state = 0;

      // Step 1: Startup
      const startupIncrements = device.increaseIncrements;
      const startupIncrement = startupIncrements[0];

      expect(startupIncrement).toEqual({
        delta: 1300, // 600W + |18-20|*350W = 600W + 700W = 1300W
        modeChange: "heat",
        targetSetpoint: 20, // 18 + 2 (offset) = 20
      });

      device.increaseConsumptionBy(startupIncrement);

      // Step 2: Simulate heating progression
      mockClimateEntity.state = "heat";
      mockClimateEntity.attributes.temperature = 20;
      mockSensorEntity.state = 1300;

      vi.advanceTimersByTime(60000);
      (device as any).consumptionTransitionStateMachine.transitionTo(ConsumptionTransitionState.IDLE);

      // Step 3: Increase toward desired
      const increaseIncrements = device.increaseIncrements;
      const nextIncrement = increaseIncrements[0];
      expect(nextIncrement.targetSetpoint).toBe(21); // 20 -> 21 (more aggressive heating)

      device.increaseConsumptionBy(nextIncrement);

      // Step 4: Room warms up to comfort level
      mockClimateEntity.attributes.current_temperature = 20; // At comfort setpoint
      mockClimateEntity.attributes.temperature = 21;

      vi.advanceTimersByTime(60000);
      (device as any).consumptionTransitionStateMachine.transitionTo(ConsumptionTransitionState.IDLE);

      // Should still offer more aggressive heating (comfort doesn't limit increases)
      const moreIncreases = device.increaseIncrements;
      expect(moreIncreases.length).toBeGreaterThan(0);

      // But decreases should be limited by comfort setpoint
      const decreaseIncrements = device.decreaseIncrements;
      decreaseIncrements.forEach(increment => {
        if (increment.targetSetpoint) {
          expect(increment.targetSetpoint).toBeGreaterThanOrEqual(20); // Above comfort minimum
        }
      });
    });
  });

  describe("Fan-Only Mode Transitions", () => {
    it("should handle fan-only mode with automatic timeout", async () => {
      // Setup: Device running in cooling mode
      mockClimateEntity.state = "cool";
      mockClimateEntity.attributes.current_temperature = 24;
      mockClimateEntity.attributes.temperature = 22;
      mockSensorEntity.state = 1400;

      // Remove comfort setpoint to allow fan-only mode
      hassControls.comfortSetpoint = undefined;

      // Step 1: Get decrease increments (should include fan-only)
      const decreaseIncrements = device.decreaseIncrements;
      const fanOnlyIncrement = decreaseIncrements.find(inc => inc.modeChange === "fan_only");

      expect(fanOnlyIncrement).toBeDefined();
      expect(fanOnlyIncrement!.delta).toBe(-1250); // 1400W - 150W = 1250W reduction

      // Step 2: Execute fan-only transition
      device.decreaseConsumptionBy(fanOnlyIncrement!);

      expect(mockClimateEntity.setHvacMode).toHaveBeenCalledWith("fan_only");

      // Step 3: Simulate fan-only mode operation (timeout starts when decreaseConsumptionBy is called)
      mockClimateEntity.state = "fan_only";
      mockSensorEntity.state = 150; // Fan-only consumption

      // Clear the pending state after some time
      vi.advanceTimersByTime(60000);
      (device as any).consumptionTransitionStateMachine.transitionTo(ConsumptionTransitionState.IDLE);

      // Clear any previous turnOff calls from other setup
      vi.mocked(mockClimateEntity.turnOff).mockClear();

      // Step 4: Fast-forward but NOT to the full timeout (timeout started when decreaseConsumptionBy was called)
      // We need to account for the 60 seconds we already advanced
      vi.advanceTimersByTime(config.fanOnlyTimeoutMs - 120000); // Account for already advanced time, stop 2 min before
      expect(mockClimateEntity.turnOff).not.toHaveBeenCalled();

      // Step 5: Timeout should trigger automatic off
      vi.advanceTimersByTime(120000); // Complete the remaining time to trigger timeout
      expect(mockClimateEntity.turnOff).toHaveBeenCalledTimes(1);

      // Device should return to idle state
      expect(device.changeState).toBeUndefined();
    });

    it("should transition from fan-only back to heating/cooling", async () => {
      // Setup: Device in fan-only mode
      mockClimateEntity.state = "fan_only";
      mockClimateEntity.attributes.current_temperature = 24;
      mockClimateEntity.attributes.temperature = 24;
      mockSensorEntity.state = 150;

      // Step 1: Get increase increments (should include mode change to cooling)
      const increaseIncrements = device.increaseIncrements;
      const coolModeIncrement = increaseIncrements.find(inc => inc.modeChange === "cool");

      expect(coolModeIncrement).toBeDefined();
      expect(coolModeIncrement!.targetSetpoint).toBe(23); // First step toward desired 20°C

      // Step 2: Execute mode change
      device.increaseConsumptionBy(coolModeIncrement!);

      expect(mockClimateEntity.setTemperature).toHaveBeenCalledWith({
        temperature: 23,
        hvac_mode: "cool",
      });

      // Fan-only timeout should be cleared
      vi.advanceTimersByTime(config.fanOnlyTimeoutMs + 60000);
      expect(mockClimateEntity.turnOff).toHaveBeenCalledTimes(0); // No automatic off
    });
  });

  describe("Load Management Scenarios", () => {
    it("should handle rapid load management adjustments correctly", async () => {
      // Setup: Device running
      mockClimateEntity.state = "cool";
      mockClimateEntity.attributes.current_temperature = 26;
      mockClimateEntity.attributes.temperature = 24;
      mockSensorEntity.state = 1200;

      // Step 1: Increase consumption
      const increaseIncrements = device.increaseIncrements;
      const increase = increaseIncrements[0];

      device.increaseConsumptionBy(increase);

      // Should be in pending state, preventing immediate additional changes
      expect(device.changeState?.type).toBe("increase");

      // Step 2: Attempt another increase (should be prevented)
      expect(() => device.increaseConsumptionBy(increase)).toThrow(
        "Cannot increase consumption for Integration Test Climate: change already pending"
      );

      // Step 3: Simulate system response and clear pending state after full debounce
      mockClimateEntity.attributes.temperature = increase.targetSetpoint!;
      mockSensorEntity.state = 1200 + increase.delta;

      // Wait for full setpoint debounce period
      vi.advanceTimersByTime(config.setpointDebounceMs);
      (device as any).consumptionTransitionStateMachine.transitionTo(ConsumptionTransitionState.IDLE);

      // Step 4: Now should be able to make additional adjustments
      expect(device.changeState).toBeUndefined();

      const decreaseIncrements = device.decreaseIncrements;
      const decrease = decreaseIncrements[0];

      device.decreaseConsumptionBy(decrease);
      expect(device.changeState?.type).toBe("decrease");
    });

    it("should respect debounce periods between operations", async () => {
      // Setup: Device running
      mockClimateEntity.state = "cool";
      mockClimateEntity.attributes.current_temperature = 26;
      mockClimateEntity.attributes.temperature = 24;
      mockSensorEntity.state = 1200;

      // Step 1: Make a setpoint change
      const increaseIncrements = device.increaseIncrements;
      const increase = increaseIncrements[0];

      device.increaseConsumptionBy(increase);

      // Step 2: Clear pending state but stay within debounce period
      vi.advanceTimersByTime(60000); // 1 minute
      (device as any).consumptionTransitionStateMachine.transitionTo(ConsumptionTransitionState.IDLE);

      // Should still be in debounce period (setpoint debounce is 2 minutes)
      expect(device.changeState?.type).toBe("debounce");

      // Attempt to make another change should return silently
      const anotherIncrease = increaseIncrements[1];
      device.increaseConsumptionBy(anotherIncrease); // Should return silently

      // No additional setTemperature calls should be made
      expect(mockClimateEntity.setTemperature).toHaveBeenCalledTimes(1);

      // Step 3: Wait for debounce period to complete
      vi.advanceTimersByTime(config.setpointDebounceMs); // Complete 2 minutes

      expect(device.changeState).toBeUndefined();

      // Now should be able to make changes again
      device.increaseConsumptionBy(anotherIncrease);
      expect(mockClimateEntity.setTemperature).toHaveBeenCalledTimes(2);
    });
  });

  describe("Error Conditions and Edge Cases", () => {
    it("should handle sensor failure gracefully", () => {
      mockSensorEntity.state = "unavailable";

      // Current consumption should return 0
      expect(device.currentConsumption).toBe(0);

      // Increments should still be calculated (using 0 as baseline)
      const increments = device.increaseIncrements;
      expect(increments.length).toBeGreaterThan(0);
    });

    it("should handle temperature extremes correctly", () => {
      // Very hot room scenario - device running high but has room for adjustment
      mockClimateEntity.state = "cool";
      mockClimateEntity.attributes.current_temperature = 30; // Very hot room
      mockClimateEntity.attributes.temperature = 26; // Aggressive cooling setpoint
      mockSensorEntity.state = 1800; // High consumption

      hassControls.desiredSetpoint = 20; // Very aggressive desired
      hassControls.comfortSetpoint = 28; // Comfort limit

      // Should offer more aggressive increases toward desired
      const increments = device.increaseIncrements;
      expect(increments.length).toBeGreaterThan(0);

      // Should offer decreases up to comfort limit
      const decreases = device.decreaseIncrements;
      expect(decreases.length).toBeGreaterThan(0);

      // All decreases should respect comfort limit
      decreases.forEach(dec => {
        if (dec.targetSetpoint) {
          expect(dec.targetSetpoint).toBeLessThanOrEqual(28); // Comfort limit
        }
      });
    });

    it("should handle configuration edge cases", () => {
      // Test with minimal configuration differences
      const edgeCaseConfig = { ...config };
      edgeCaseConfig.minSetpoint = 18;
      edgeCaseConfig.maxSetpoint = 28;

      const edgeDevice = new ClimateDevice(
        "Integration Test Climate",
        1,
        mockClimateEntity,
        mockSensorEntity,
        hassControls,
        edgeCaseConfig,
      );

      // Should still function with different limits
      expect(edgeDevice.name).toBe("Integration Test Climate");
      expect(() => edgeDevice.increaseIncrements).not.toThrow();
      expect(() => edgeDevice.decreaseIncrements).not.toThrow();
    });

    it("should handle emergency stop correctly", () => {
      // Setup: Device running with pending changes and timers
      mockClimateEntity.state = "cool";
      mockSensorEntity.state = 1400;

      // Start a change
      const increment = device.increaseIncrements[0];
      device.increaseConsumptionBy(increment);

      // Wait for setpoint debounce to complete, then transition to fan-only
      vi.advanceTimersByTime(config.setpointDebounceMs);
      (device as any).consumptionTransitionStateMachine.transitionTo(ConsumptionTransitionState.IDLE);

      const fanOnlyIncrement = { delta: -1250, modeChange: "fan_only" as const };
      hassControls.comfortSetpoint = undefined; // Allow fan-only

      device.decreaseConsumptionBy(fanOnlyIncrement);

      // Verify pending state and timer
      expect(device.changeState?.type).toBe("decrease");

      // Emergency stop
      device.stop();

      // Everything should be reset
      expect(device.changeState).toBeUndefined();
      expect(mockClimateEntity.turnOff).toHaveBeenCalledTimes(1);

      // Fan-only timer should be cleared (no additional turnOff calls)
      vi.advanceTimersByTime(config.fanOnlyTimeoutMs + 60000);
      expect(mockClimateEntity.turnOff).toHaveBeenCalledTimes(1); // Still just the one from stop()
    });
  });
});
