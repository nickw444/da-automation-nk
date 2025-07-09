import { describe, it, expect, vi, beforeEach } from "vitest";
import { BooleanDevice } from "../boolean_device";
import { MockBooleanEntityWrapper } from "../../../../entities/boolean_entity_wrapper";
import { MockSensorEntityWrapper } from "../../../../entities/sensor_entity_wrapper";

describe("BooleanDevice", () => {
  let mockBooleanEntity: MockBooleanEntityWrapper;
  let mockSensorEntity: MockSensorEntityWrapper;
  let device: BooleanDevice;

  beforeEach(() => {
    mockBooleanEntity = {
      state: "off",
      turn_on: vi.fn(),
      turn_off: vi.fn(),
    };
    
    mockSensorEntity = {
      state: 0,
    };

    device = new BooleanDevice(
      mockBooleanEntity,
      mockSensorEntity,
      50,
      "Test Device",
      1,
      30000, // offToOnDebounceMs
      10000, // onToOffDebounceMs
    );
  });

  it("should return correct increments when entity is off", () => {
    mockBooleanEntity.state = "off";
    
    expect(device.increaseIncrements).toEqual([{ delta: 50, action: "turn_on" }]);
    expect(device.decreaseIncrements).toEqual([]);
  });

  it("should return correct increments when entity is on", () => {
    mockBooleanEntity.state = "on";
    mockSensorEntity.state = 45;
    
    expect(device.increaseIncrements).toEqual([]);
    expect(device.decreaseIncrements).toEqual([{ delta: 45, action: "turn_off" }]);
  });

  it("should turn on device when increaseConsumptionBy is called", () => {
    mockBooleanEntity.state = "off";
    
    device.increaseConsumptionBy({ delta: 50, action: "turn_on" });
    
    expect(mockBooleanEntity.turn_on).toHaveBeenCalledTimes(1);
    expect(device.changeState?.type).toBe("increase");
  });

  it("should turn off device when decreaseConsumptionBy is called", () => {
    mockBooleanEntity.state = "on";
    mockSensorEntity.state = 45;
    
    device.decreaseConsumptionBy({ delta: 45, action: "turn_off" });
    
    expect(mockBooleanEntity.turn_off).toHaveBeenCalledTimes(1);
    expect(device.changeState?.type).toBe("decrease");
  });

  it("should not call turn_on when device is already on", () => {
    mockBooleanEntity.state = "on";
    
    device.increaseConsumptionBy({ delta: 10, action: "turn_on" });
    
    expect(mockBooleanEntity.turn_on).not.toHaveBeenCalled();
    expect(device.changeState).toBeUndefined();
  });

  it("should not call turn_off when device is already off", () => {
    mockBooleanEntity.state = "off";
    
    device.decreaseConsumptionBy({ delta: 10, action: "turn_off" });
    
    expect(mockBooleanEntity.turn_off).not.toHaveBeenCalled();
    expect(device.changeState).toBeUndefined();
  });

  it("should return correct current consumption", () => {
    mockSensorEntity.state = 42;
    
    expect(device.currentConsumption).toBe(42);
  });

  it("should return correct expected future consumption when increase is pending", () => {
    mockBooleanEntity.state = "off";
    
    device.increaseConsumptionBy({ delta: 50, action: "turn_on" });
    
    const changeState = device.changeState;
    expect(changeState?.type).toBe("increase");
    if (changeState?.type === "increase") {
      expect(changeState.expectedFutureConsumption).toBe(50);
    }
  });

  it("should return correct expected future consumption when decrease is pending", () => {
    mockBooleanEntity.state = "on";
    mockSensorEntity.state = 45;
    
    device.decreaseConsumptionBy({ delta: 45, action: "turn_off" });
    
    const changeState = device.changeState;
    expect(changeState?.type).toBe("decrease");
    if (changeState?.type === "decrease") {
      expect(changeState.expectedFutureConsumption).toBe(0);
    }
  });

  it("should fallback to expectedConsumption when sensor returns unavailable", () => {
    mockBooleanEntity.state = "off";
    mockSensorEntity.state = "unavailable";
    
    expect(device.increaseIncrements).toEqual([{ delta: 50, action: "turn_on" }]);
    expect(device.currentConsumption).toBe(0);
  });

  it("should fallback to expectedConsumption for decrease increments when sensor returns unavailable", () => {
    mockBooleanEntity.state = "on";
    mockSensorEntity.state = "unavailable";
    
    expect(device.decreaseIncrements).toEqual([{ delta: 50, action: "turn_off" }]);
  });

  it("should transition state machine back to IDLE after timeout", () => {
    vi.useFakeTimers();
    
    try {
      mockBooleanEntity.state = "off";
      
      device.increaseConsumptionBy({ delta: 50, action: "turn_on" });
      expect(device.changeState?.type).toBe("increase");
      
      vi.advanceTimersByTime(1000);
      
      // After timeout, state machine should be back to IDLE but still in debounce
      expect(device.changeState?.type).toBe("debounce");
    } finally {
      vi.useRealTimers();
    }
  });

  it("should respect debounce period", () => {
    vi.useFakeTimers();
    
    try {
      mockBooleanEntity.state = "off";
      
      // First action
      device.increaseConsumptionBy({ delta: 50, action: "turn_on" });
      expect(mockBooleanEntity.turn_on).toHaveBeenCalledTimes(1);
      
      // Wait for state machine to settle
      vi.advanceTimersByTime(1000);
      
      // Should now be in debounce period
      expect(device.changeState?.type).toBe("debounce");
      
      // Try to turn off during debounce - should be ignored
      mockBooleanEntity.state = "on";
      device.decreaseConsumptionBy({ delta: 50, action: "turn_off" });
      expect(mockBooleanEntity.turn_off).not.toHaveBeenCalled();
      
      // After debounce period ends, actions should work again
      vi.advanceTimersByTime(10000); // onToOffDebounceMs
      expect(device.changeState).toBeUndefined();
      
      device.decreaseConsumptionBy({ delta: 50, action: "turn_off" });
      expect(mockBooleanEntity.turn_off).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should call stop method correctly", () => {
    device.stop();
    
    expect(mockBooleanEntity.turn_off).toHaveBeenCalledTimes(1);
    // After stopping, device should be in debounce state due to recordStateChange
    expect(device.changeState?.type).toBe("debounce");
  });
});
