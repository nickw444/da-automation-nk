import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { BackyardFountainPresenceAutomation } from "../service";
import { MockBooleanEntityWrapper } from "../../../entities/boolean_entity_wrapper";
import { MockBinarySensorEntityWrapper } from "../../../entities/binary_sensor_entity_wrapper";
import type { ILogger } from "@digital-alchemy/core";

interface TestBooleanEntity extends MockBooleanEntityWrapper {
  turn_on: Mock;
  turn_off: Mock;
  onUpdate: Mock;
}

interface TestBinarySensorEntity extends MockBinarySensorEntityWrapper {
  onUpdate: Mock;
}

describe("BackyardFountainPresenceAutomation", () => {
  let mockLogger: ILogger;
  let mockFountainEntity: TestBooleanEntity;
  let mockDeckPresenceEntity: TestBinarySensorEntity;
  let mockAllPresenceEntities: TestBinarySensorEntity[];
  let automation: BackyardFountainPresenceAutomation;
  
  // Capture callbacks from entity registration
  let fountainCallback: (newState: { state: "on" | "off" | undefined }, oldState: { state: "on" | "off" | undefined }) => void;
  let deckPresenceCallback: (newState: { state: "on" | "off" | undefined }, oldState: { state: "on" | "off" | undefined }) => void;
  let deckPresenceAllCallback: (newState: { state: "on" | "off" | undefined }, oldState: { state: "on" | "off" | undefined }) => void;
  let backYardPersonCallback: (newState: { state: "on" | "off" | undefined }, oldState: { state: "on" | "off" | undefined }) => void;
  let shedMotionCallback: (newState: { state: "on" | "off" | undefined }, oldState: { state: "on" | "off" | undefined }) => void;
  let shedAllZonesCallback: (newState: { state: "on" | "off" | undefined }, oldState: { state: "on" | "off" | undefined }) => void;

  beforeEach(() => {
    vi.useFakeTimers();

    mockLogger = {
      info: vi.fn(), debug: vi.fn(), warn: vi.fn(), 
      error: vi.fn(), fatal: vi.fn(), trace: vi.fn()
    } as ILogger;
    
    mockFountainEntity = {
      state: "off",
      turn_on: vi.fn(),
      turn_off: vi.fn(),
      onUpdate: vi.fn((callback) => { fountainCallback = callback; }),
    };
    
    mockDeckPresenceEntity = {
      state: "off",
      onUpdate: vi.fn((callback) => { deckPresenceCallback = callback; }),
    };

    mockAllPresenceEntities = [
      { state: "off", onUpdate: vi.fn((callback) => { deckPresenceAllCallback = callback; }) }, // deck (same as above)
      { state: "off", onUpdate: vi.fn((callback) => { backYardPersonCallback = callback; }) }, // back_yard_person_detected
      { state: "off", onUpdate: vi.fn((callback) => { shedMotionCallback = callback; }) }, // shed_motion_occupancy
      { state: "off", onUpdate: vi.fn((callback) => { shedAllZonesCallback = callback; }) }, // shed_fp2_presence_sensor_all_zones
    ];

    automation = new BackyardFountainPresenceAutomation(
      mockLogger,
      mockFountainEntity,
      mockDeckPresenceEntity,
      mockAllPresenceEntities,
    );

    vi.clearAllMocks(); // Clear setup calls
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Deck presence turn-on logic", () => {
    it("should create a timer when deck presence is detected", () => {
      // Verify initial state
      expect(mockDeckPresenceEntity.state).toBe("off");
      expect(mockFountainEntity.state).toBe("off");
      
      // Set presence state and trigger callback
      mockDeckPresenceEntity.state = "on";
      deckPresenceCallback({ state: "on" }, { state: "off" });
      
      // Should not turn on immediately
      expect(mockFountainEntity.turn_on).not.toHaveBeenCalled();
      
      // Logger should show timer starting
      expect(mockLogger.info).toHaveBeenCalledWith("Starting fountain on timer (5 minutes)");
    });

    it("should turn fountain on after 5 minutes of deck presence", () => {
      // Verify initial state
      expect(mockDeckPresenceEntity.state).toBe("off");
      expect(mockFountainEntity.state).toBe("off");
      
      // Set presence state and trigger callback
      mockDeckPresenceEntity.state = "on";
      deckPresenceCallback({ state: "on" }, { state: "off" });
      
      // Should not turn on immediately
      expect(mockFountainEntity.turn_on).not.toHaveBeenCalled();
      
      // Fast-forward 5 minutes
      vi.advanceTimersByTime(5 * 60 * 1000);
      
      expect(mockFountainEntity.turn_on).toHaveBeenCalledTimes(1);
    });

    it("should cancel turn-on timer if deck presence disappears", () => {
      mockDeckPresenceEntity.state = "on";
      deckPresenceCallback({ state: "on" }, { state: "off" });
      
      // Fast-forward 2 minutes
      vi.advanceTimersByTime(2 * 60 * 1000);
      
      // Presence disappears
      mockDeckPresenceEntity.state = "off";
      deckPresenceCallback({ state: "off" }, { state: "on" });
      
      // Fast-forward another 5 minutes (total 7 minutes)
      vi.advanceTimersByTime(5 * 60 * 1000);
      
      expect(mockFountainEntity.turn_on).not.toHaveBeenCalled();
    });

    it("should not start turn-on timer if deck presence is already off", () => {
      deckPresenceCallback({ state: "off" }, { state: "off" });
      
      vi.advanceTimersByTime(5 * 60 * 1000);
      
      expect(mockFountainEntity.turn_on).not.toHaveBeenCalled();
    });

    it("should ignore undefined deck presence state", () => {
      deckPresenceCallback({ state: undefined }, { state: "off" });
      
      vi.advanceTimersByTime(5 * 60 * 1000);
      
      expect(mockFountainEntity.turn_on).not.toHaveBeenCalled();
    });
  });

  describe("Multi-sensor turn-off logic", () => {
    beforeEach(() => {
      // Set fountain to on state
      mockFountainEntity.state = "on";
    });

    it("should turn fountain off after 5 minutes with no presence", () => {
      // All sensors show no presence
      deckPresenceCallback({ state: "off" }, { state: "on" });
      
      vi.advanceTimersByTime(5 * 60 * 1000);
      
      expect(mockFountainEntity.turn_off).toHaveBeenCalledTimes(1);
    });

    it("should cancel turn-off timer if any presence sensor detects presence", () => {
      // Start with no presence
      mockDeckPresenceEntity.state = "off";
      deckPresenceCallback({ state: "off" }, { state: "on" });
      
      // Fast-forward 2 minutes
      vi.advanceTimersByTime(2 * 60 * 1000);
      
      // Back yard person detected
      mockAllPresenceEntities[1].state = "on";
      backYardPersonCallback({ state: "on" }, { state: "off" });
      
      // Fast-forward another 5 minutes (total 7 minutes)
      vi.advanceTimersByTime(5 * 60 * 1000);
      
      expect(mockFountainEntity.turn_off).not.toHaveBeenCalled();
    });

    it("should restart turn-off timer when all presence disappears again", () => {
      // Start with presence in shed motion
      mockAllPresenceEntities[2].state = "on"; // shed_motion_occupancy
      
      // No deck presence
      mockDeckPresenceEntity.state = "off";
      deckPresenceCallback({ state: "off" }, { state: "on" });
      
      // Should not start timer yet (shed motion still on)
      vi.advanceTimersByTime(1 * 60 * 1000);
      expect(mockFountainEntity.turn_off).not.toHaveBeenCalled();
      
      // Shed motion goes off
      mockAllPresenceEntities[2].state = "off";
      shedMotionCallback({ state: "off" }, { state: "on" });
      
      // Now timer should start
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(mockFountainEntity.turn_off).toHaveBeenCalledTimes(1);
    });

    it("should not start turn-off timer if fountain is already off", () => {
      mockFountainEntity.state = "off";
      
      deckPresenceCallback({ state: "off" }, { state: "on" });
      
      vi.advanceTimersByTime(5 * 60 * 1000);
      
      expect(mockFountainEntity.turn_off).not.toHaveBeenCalled();
    });
  });

  describe("Manual fountain control", () => {
    it("should clear turn-on timer when fountain is manually turned on", () => {
      // Start deck presence timer
      mockDeckPresenceEntity.state = "on";
      deckPresenceCallback({ state: "on" }, { state: "off" });
      
      // Manual turn on
      mockFountainEntity.state = "on";
      fountainCallback({ state: "on" }, { state: "off" });
      
      // Fast-forward past turn-on timer
      vi.advanceTimersByTime(5 * 60 * 1000);
      
      // Should not call turn_on (was already manually turned on)
      expect(mockFountainEntity.turn_on).not.toHaveBeenCalled();
    });

    it("should start monitoring for turn-off when manually turned on", () => {
      // Manual turn on with no presence
      mockFountainEntity.state = "on";
      fountainCallback({ state: "on" }, { state: "off" });
      
      // Should start turn-off timer
      vi.advanceTimersByTime(5 * 60 * 1000);
      
      expect(mockFountainEntity.turn_off).toHaveBeenCalledTimes(1);
    });

    it("should clear all timers when manually turned off", () => {
      // Start with presence and fountain on
      deckPresenceCallback({ state: "on" }, { state: "off" });
      mockFountainEntity.state = "on";
      
      // Manual turn off
      mockFountainEntity.state = "off";
      fountainCallback({ state: "off" }, { state: "on" });
      
      // Fast-forward - no automatic actions should occur
      vi.advanceTimersByTime(10 * 60 * 1000);
      
      expect(mockFountainEntity.turn_on).not.toHaveBeenCalled();
      expect(mockFountainEntity.turn_off).not.toHaveBeenCalled();
    });
  });

  describe("Edge cases", () => {
    it("should handle undefined fountain state updates", () => {
      fountainCallback({ state: undefined }, { state: "off" });
      
      // Should not crash or cause issues
      vi.advanceTimersByTime(5 * 60 * 1000);
      
      expect(mockFountainEntity.turn_on).not.toHaveBeenCalled();
      expect(mockFountainEntity.turn_off).not.toHaveBeenCalled();
    });

    it("should handle undefined presence sensor updates", () => {
      backYardPersonCallback({ state: undefined }, { state: "off" });
      shedMotionCallback({ state: undefined }, { state: "off" });
      shedAllZonesCallback({ state: undefined }, { state: "off" });
      
      // Should not crash or cause issues
      vi.advanceTimersByTime(5 * 60 * 1000);
      
      expect(mockFountainEntity.turn_on).not.toHaveBeenCalled();
      expect(mockFountainEntity.turn_off).not.toHaveBeenCalled();
    });

    it("should handle rapid presence state changes correctly", () => {
      // Rapid on/off changes
      mockDeckPresenceEntity.state = "on";
      deckPresenceCallback({ state: "on" }, { state: "off" });
      mockDeckPresenceEntity.state = "off";
      deckPresenceCallback({ state: "off" }, { state: "on" });
      mockDeckPresenceEntity.state = "on";
      deckPresenceCallback({ state: "on" }, { state: "off" });
      
      // Only the last state should matter
      vi.advanceTimersByTime(5 * 60 * 1000);
      
      expect(mockFountainEntity.turn_on).toHaveBeenCalledTimes(1);
    });
  });
});
