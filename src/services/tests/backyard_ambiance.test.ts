import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { BackyardAmbianceAutomation } from "../backyard_ambiance";
import { MockBooleanEntityWrapper } from "../../entities/boolean_entity_wrapper";
import { MockBinarySensorEntityWrapper } from "../../entities/binary_sensor_entity_wrapper";
import { MockSensorEntityWrapper } from "../../entities/sensor_entity_wrapper";
import type { ILogger } from "@digital-alchemy/core";

interface TestBooleanEntity extends MockBooleanEntityWrapper {
  turn_on: Mock;
  turn_off: Mock;
}

interface TestBinarySensorEntity extends MockBinarySensorEntityWrapper {
  onUpdate: Mock;
}

interface TestSensorEntity extends MockSensorEntityWrapper {
  onUpdate: Mock;
}

describe("BackyardAmbianceAutomation", () => {
  let mockLogger: ILogger;
  let mockLightEntities: TestBooleanEntity[];
  let mockDoorEntity: TestBinarySensorEntity;
  let mockOccupancyEntities: TestBinarySensorEntity[];
  let mockOutdoorIlluminationEntity: TestSensorEntity;
  let automation: BackyardAmbianceAutomation;
  
  // Callback functions captured from entity registration
  let doorCallback: (state: { state: "on" | "off" | undefined }) => void;
  let occupancyCallbacks: ((state: { state: "on" | "off" | undefined }) => void)[];
  let luxCallback: (state: { state: string | number | undefined }) => void;

  beforeEach(() => {
    vi.useFakeTimers();

    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
    } as ILogger;

    mockLightEntities = [
      {
        state: "off",
        turn_on: vi.fn(),
        turn_off: vi.fn(),
      },
      {
        state: "off", 
        turn_on: vi.fn(),
        turn_off: vi.fn(),
      },
      {
        state: "off",
        turn_on: vi.fn(),
        turn_off: vi.fn(),
      },
    ];

    mockDoorEntity = {
      state: "off",
      onUpdate: vi.fn((callback) => {
        doorCallback = callback;
      }),
    };

    occupancyCallbacks = [];
    mockOccupancyEntities = [
      {
        state: "off",
        onUpdate: vi.fn((callback) => {
          occupancyCallbacks[0] = callback;
        }),
      },
      {
        state: "off",
        onUpdate: vi.fn((callback) => {
          occupancyCallbacks[1] = callback;
        }),
      },
    ];

    mockOutdoorIlluminationEntity = {
      state: 0,
      onUpdate: vi.fn((callback) => {
        luxCallback = callback;
      }),
    };

    automation = new BackyardAmbianceAutomation(
      mockLogger,
      mockLightEntities as unknown as import("../../entities/boolean_entity_wrapper").BooleanEntityWrapper[],
      mockDoorEntity as unknown as import("../../entities/binary_sensor_entity_wrapper").BinarySensorEntityWrapper,
      mockOccupancyEntities as unknown as import("../../entities/binary_sensor_entity_wrapper").BinarySensorEntityWrapper[],
      mockOutdoorIlluminationEntity as unknown as import("../../entities/sensor_entity_wrapper").SensorEntityWrapper
    );

    // Clear mocks after setup to ignore any initial state processing
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Door automation", () => {
    it("should turn lights on when door opens and it's dark", () => {
      // Set dark conditions (lux < 1000)
      mockOutdoorIlluminationEntity.state = 500;
      
      // Simulate door opening
      doorCallback({ state: "on" });

      // All lights should be turned on
      expect(mockLightEntities[0].turn_on).toHaveBeenCalledTimes(1);
      expect(mockLightEntities[1].turn_on).toHaveBeenCalledTimes(1);
      expect(mockLightEntities[2].turn_on).toHaveBeenCalledTimes(1);
    });

    it("should not turn lights on when door opens and it's bright", () => {
      // Set bright conditions (lux >= 1000)
      mockOutdoorIlluminationEntity.state = 1500;
      
      // Simulate door opening
      doorCallback({ state: "on" });

      // No lights should be turned on
      expect(mockLightEntities[0].turn_on).not.toHaveBeenCalled();
      expect(mockLightEntities[1].turn_on).not.toHaveBeenCalled();
      expect(mockLightEntities[2].turn_on).not.toHaveBeenCalled();
    });

    it("should handle lux threshold boundary conditions", () => {
      // Test exactly at threshold (should not trigger)
      mockOutdoorIlluminationEntity.state = 1000;
      doorCallback({ state: "on" });
      expect(mockLightEntities[0].turn_on).not.toHaveBeenCalled();

      // Reset mocks
      vi.clearAllMocks();

      // Test just below threshold (should trigger)
      mockOutdoorIlluminationEntity.state = 999;
      doorCallback({ state: "on" });
      expect(mockLightEntities[0].turn_on).toHaveBeenCalledTimes(1);
    });

    it("should not turn lights on when door closes", () => {
      // Simulate door closing
      doorCallback({ state: "off" });

      // No lights should be turned on
      expect(mockLightEntities[0].turn_on).not.toHaveBeenCalled();
      expect(mockLightEntities[1].turn_on).not.toHaveBeenCalled();
      expect(mockLightEntities[2].turn_on).not.toHaveBeenCalled();
    });

    it("should clear any existing timer when door opens with occupancy detected", () => {
      // Set dark conditions
      mockOutdoorIlluminationEntity.state = 500;
      
      // Set up no occupancy situation to start timer
      mockOccupancyEntities[0].state = "off";
      mockOccupancyEntities[1].state = "off";
      
      // Trigger occupancy change to start timer
      occupancyCallbacks[0]({ state: "off" });

      // Now someone is detected when door opens
      mockOccupancyEntities[0].state = "on";

      // Door opens - should clear timer and not restart it due to occupancy
      doorCallback({ state: "on" });

      // Advance timer past 10 minutes
      vi.advanceTimersByTime(10 * 60 * 1000 + 1000);

      // Lights should not turn off because timer was cleared and occupancy detected
      expect(mockLightEntities[0].turn_off).not.toHaveBeenCalled();
    });

    it("should start timer immediately when door opens but no occupancy detected", () => {
      // Set dark conditions
      mockOutdoorIlluminationEntity.state = 500;
      
      // Set no occupancy
      mockOccupancyEntities[0].state = "off";
      mockOccupancyEntities[1].state = "off";

      // Door opens (lights turn on, timer should start due to no occupancy)
      doorCallback({ state: "on" });

      // Verify lights turned on
      expect(mockLightEntities[0].turn_on).toHaveBeenCalledTimes(1);

      // Advance timer by exactly 10 minutes
      vi.advanceTimersByTime(10 * 60 * 1000);

      // Lights should turn off because no occupancy was detected when door opened
      expect(mockLightEntities[0].turn_off).toHaveBeenCalledTimes(1);
    });

    it("should not start timer when door opens and occupancy is detected", () => {
      // Set dark conditions
      mockOutdoorIlluminationEntity.state = 500;
      
      // Set occupancy detected
      mockOccupancyEntities[0].state = "on";
      mockOccupancyEntities[1].state = "off";

      // Door opens (lights turn on, but timer should not start due to occupancy)
      doorCallback({ state: "on" });

      // Verify lights turned on
      expect(mockLightEntities[0].turn_on).toHaveBeenCalledTimes(1);

      // Advance timer past 10 minutes
      vi.advanceTimersByTime(10 * 60 * 1000 + 1000);

      // Lights should not turn off because occupancy was detected
      expect(mockLightEntities[0].turn_off).not.toHaveBeenCalled();
    });
  });

  describe("Occupancy automation", () => {
    it("should turn off lights after 10 minutes when no occupancy detected", () => {
      // Set no occupancy
      mockOccupancyEntities[0].state = "off";
      mockOccupancyEntities[1].state = "off";

      // Trigger occupancy change
      occupancyCallbacks[0]({ state: "off" });

      // Advance timer by exactly 10 minutes
      vi.advanceTimersByTime(10 * 60 * 1000);

      // All lights should be turned off
      expect(mockLightEntities[0].turn_off).toHaveBeenCalledTimes(1);
      expect(mockLightEntities[1].turn_off).toHaveBeenCalledTimes(1);
      expect(mockLightEntities[2].turn_off).toHaveBeenCalledTimes(1);
    });

    it("should not turn off lights when occupancy is detected", () => {
      // Set occupancy detected
      mockOccupancyEntities[0].state = "on";
      mockOccupancyEntities[1].state = "off";

      // Trigger occupancy change
      occupancyCallbacks[0]({ state: "on" });

      // Advance timer past 10 minutes
      vi.advanceTimersByTime(10 * 60 * 1000 + 1000);

      // Lights should not turn off
      expect(mockLightEntities[0].turn_off).not.toHaveBeenCalled();
    });

    it("should restart timer when occupancy is lost after being detected", () => {
      // Start with no occupancy - timer starts
      mockOccupancyEntities[0].state = "off";
      mockOccupancyEntities[1].state = "off";
      occupancyCallbacks[0]({ state: "off" });

      // Advance timer partway
      vi.advanceTimersByTime(5 * 60 * 1000); // 5 minutes

      // Occupancy detected - timer should be cleared
      mockOccupancyEntities[0].state = "on";
      occupancyCallbacks[0]({ state: "on" });

      // Occupancy lost again - timer should restart
      mockOccupancyEntities[0].state = "off";
      occupancyCallbacks[0]({ state: "off" });

      // Advance by full 10 minutes from restart
      vi.advanceTimersByTime(10 * 60 * 1000);

      // Lights should turn off
      expect(mockLightEntities[0].turn_off).toHaveBeenCalledTimes(1);
    });

    it("should handle multiple occupancy sensors correctly", () => {
      // Both sensors off - should start timer
      mockOccupancyEntities[0].state = "off";
      mockOccupancyEntities[1].state = "off";
      occupancyCallbacks[0]({ state: "off" });

      // One sensor turns on - should clear timer
      mockOccupancyEntities[1].state = "on";
      occupancyCallbacks[1]({ state: "on" });

      // Both sensors off again - should restart timer
      mockOccupancyEntities[1].state = "off";
      occupancyCallbacks[1]({ state: "off" });

      // Advance by 10 minutes
      vi.advanceTimersByTime(10 * 60 * 1000);

      // Lights should turn off
      expect(mockLightEntities[0].turn_off).toHaveBeenCalledTimes(1);
    });

    it("should ignore undefined state updates", () => {
      // Set initial state with no occupancy
      mockOccupancyEntities[0].state = "off";
      mockOccupancyEntities[1].state = "off";

      // Trigger a valid occupancy change (starts timer)
      occupancyCallbacks[0]({ state: "off" });

      // Trigger undefined state updates (should be ignored)
      occupancyCallbacks[0]({ state: undefined });
      doorCallback({ state: undefined });

      // Advance timer by exactly 10 minutes
      vi.advanceTimersByTime(10 * 60 * 1000);

      // Lights should still turn off because undefined updates were ignored
      expect(mockLightEntities[0].turn_off).toHaveBeenCalledTimes(1);
    });
  });

  describe("Lux monitoring automation", () => {
    it("should turn lights on when lux drops below threshold with presence detected", () => {
      // Set occupancy detected
      mockOccupancyEntities[0].state = "on";
      mockOccupancyEntities[1].state = "off";
      
      // Set bright conditions initially
      mockOutdoorIlluminationEntity.state = 1500;
      
      // Lux drops below threshold (gets dark)
      mockOutdoorIlluminationEntity.state = 500;
      luxCallback({ state: 500 });

      // Lights should turn on
      expect(mockLightEntities[0].turn_on).toHaveBeenCalledTimes(1);
      expect(mockLightEntities[1].turn_on).toHaveBeenCalledTimes(1);
      expect(mockLightEntities[2].turn_on).toHaveBeenCalledTimes(1);
    });

    it("should not turn lights on when lux drops but no presence detected", () => {
      // Set no occupancy
      mockOccupancyEntities[0].state = "off";
      mockOccupancyEntities[1].state = "off";
      
      // Lux drops below threshold
      mockOutdoorIlluminationEntity.state = 500;
      luxCallback({ state: 500 });

      // Lights should not turn on
      expect(mockLightEntities[0].turn_on).not.toHaveBeenCalled();
      expect(mockLightEntities[1].turn_on).not.toHaveBeenCalled();
      expect(mockLightEntities[2].turn_on).not.toHaveBeenCalled();
    });

    it("should handle lux threshold boundary conditions with presence", () => {
      // Set occupancy detected
      mockOccupancyEntities[0].state = "on";
      
      // Test lux exactly at threshold (should not trigger)
      mockOutdoorIlluminationEntity.state = 1000;
      luxCallback({ state: 1000 });
      expect(mockLightEntities[0].turn_on).not.toHaveBeenCalled();

      // Reset mocks
      vi.clearAllMocks();

      // Test lux just below threshold (should trigger)
      mockOutdoorIlluminationEntity.state = 999;
      luxCallback({ state: 999 });
      expect(mockLightEntities[0].turn_on).toHaveBeenCalledTimes(1);
    });

    it("should handle string lux values", () => {
      // Set occupancy detected
      mockOccupancyEntities[0].state = "on";
      
      // Test with string value below threshold
      mockOutdoorIlluminationEntity.state = "500";
      luxCallback({ state: "500" });
      expect(mockLightEntities[0].turn_on).toHaveBeenCalledTimes(1);

      // Reset mocks
      vi.clearAllMocks();

      // Test with string value above threshold
      mockOutdoorIlluminationEntity.state = "1500";
      luxCallback({ state: "1500" });
      expect(mockLightEntities[0].turn_on).not.toHaveBeenCalled();
    });

    it("should ignore undefined lux state updates", () => {
      // Set bright conditions to ensure isDark() returns false
      mockOutdoorIlluminationEntity.state = 1500;
      
      // Set occupancy detected
      mockOccupancyEntities[0].state = "on";
      
      // Trigger undefined lux update
      luxCallback({ state: undefined });
      
      // Lights should not turn on
      expect(mockLightEntities[0].turn_on).not.toHaveBeenCalled();
    });

    it("should start timer when lux triggers lights with no occupancy", () => {
      // Set occupancy detected initially
      mockOccupancyEntities[0].state = "on";
      
      // Lux drops and lights turn on
      mockOutdoorIlluminationEntity.state = 500;
      luxCallback({ state: 500 });
      
      // Then occupancy is lost
      mockOccupancyEntities[0].state = "off";
      occupancyCallbacks[0]({ state: "off" });
      
      // Advance timer by 10 minutes
      vi.advanceTimersByTime(10 * 60 * 1000);
      
      // Lights should turn off
      expect(mockLightEntities[0].turn_off).toHaveBeenCalledTimes(1);
    });
  });

  describe("Integration scenarios", () => {
    it("should handle door and occupancy events together", () => {
      // Set dark conditions
      mockOutdoorIlluminationEntity.state = 500;
      
      // Set initial occupancy detected
      mockOccupancyEntities[0].state = "on";
      mockOccupancyEntities[1].state = "off";

      // Door opening with occupancy detected (turns lights on, no timer)
      doorCallback({ state: "on" });
      expect(mockLightEntities[0].turn_on).toHaveBeenCalledTimes(1);

      // Set no occupancy and trigger change (starts timer)
      mockOccupancyEntities[0].state = "off";
      occupancyCallbacks[0]({ state: "off" });

      // Occupancy detected again, door opens (should clear timer and not restart)
      mockOccupancyEntities[0].state = "on";
      doorCallback({ state: "on" });

      // Advance past timer time
      vi.advanceTimersByTime(10 * 60 * 1000 + 1000);

      // Lights should not turn off because occupancy was detected when door opened
      expect(mockLightEntities[0].turn_off).not.toHaveBeenCalled();
    });

    it("should handle complex lux, door, and occupancy interactions", () => {
      // Start bright (no door trigger), no occupancy
      mockOutdoorIlluminationEntity.state = 1500;
      mockOccupancyEntities[0].state = "off";
      mockOccupancyEntities[1].state = "off";

      // Door opens in bright conditions - should not turn on lights
      doorCallback({ state: "on" });
      expect(mockLightEntities[0].turn_on).not.toHaveBeenCalled();

      // Reset mocks
      vi.clearAllMocks();

      // Someone arrives (occupancy detected)
      mockOccupancyEntities[0].state = "on";
      occupancyCallbacks[0]({ state: "on" });

      // Gets dark while someone is present - should turn on lights
      mockOutdoorIlluminationEntity.state = 500;
      luxCallback({ state: 500 });
      expect(mockLightEntities[0].turn_on).toHaveBeenCalledTimes(1);

      // Person leaves
      mockOccupancyEntities[0].state = "off";
      occupancyCallbacks[0]({ state: "off" });

      // Lights should turn off after timer
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(mockLightEntities[0].turn_off).toHaveBeenCalledTimes(1);

      // Reset mocks
      vi.clearAllMocks();

      // Door opens again in dark conditions - should turn on lights
      doorCallback({ state: "on" });
      expect(mockLightEntities[0].turn_on).toHaveBeenCalledTimes(1);
    });
  });
});
