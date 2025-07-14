# Automation Service Creation Guide

Follow this step-by-step guide to create new automation services using established patterns.

**⚠️ IMPORTANT: The code examples below are for STRUCTURE and PATTERN reference only. Do not copy them literally - replace entity types, names, logic, and tests with your actual automation requirements.**

## 1. Create Service File

Create a new file in `src/services/${automation_name}.ts`:

```typescript
import { TServiceParams } from "@digital-alchemy/core";
import { BooleanEntityWrapper, IBooleanEntityWrapper } from "../entities/boolean_entity_wrapper";
import { BinarySensorEntityWrapper, IBinarySensorEntityWrapper } from "../entities/binary_sensor_entity_wrapper";
import { SensorEntityWrapper, ISensorEntityWrapper } from "../entities/sensor_entity_wrapper";

export class MyAutomationService {
    constructor(
        private readonly logger: TServiceParams['logger'],
        private readonly lightEntity: IBooleanEntityWrapper,
        private readonly motionEntity: IBinarySensorEntityWrapper,
        private readonly luxEntity: ISensorEntityWrapper,
    ) {
        // TODO: Set up entity event listeners
        this.motionEntity.onUpdate((newState, oldState) => {
            if (newState !== undefined) {
                // TODO: Handle motion changes
            }
        });
    }

    // TODO: Add private helper methods for automation logic
    
    private checkConditions(): boolean {
        // Access entity state directly outside of update hooks
        const motionDetected = this.motionEntity.state === "on";
        const luxLevel = this.luxEntity.state;
        // TODO: Implement your logic here
        return motionDetected && luxLevel !== undefined;
    }

    static create({ hass, logger }: TServiceParams): void {
        new MyAutomationService(
            logger,
            new BooleanEntityWrapper(hass.refBy.id('light.my_light')), // TODO: Replace with actual entity ID
            new BinarySensorEntityWrapper(hass.refBy.id('binary_sensor.my_motion')), // TODO: Replace
            new SensorEntityWrapper(hass.refBy.id('sensor.my_lux')) // TODO: Replace
        );
    }
}
```

## 2. Install Service in main.ts

Add your service to the services object:

```typescript
export const MY_APPLICATION = CreateApplication({
  name: "da_automation",
  libraries: [LIB_HASS, LIB_SYNAPSE, LIB_AUTOMATION],
  services: {
    myAutomation: MyAutomationService.create, // TODO: Add your service here
    // ... other services
  },
  configuration: {},
});
```

## 3. Write Unit Tests

Create test file at `src/services/tests/${automation_name}.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { MyAutomationService } from "../my_automation";
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

describe("MyAutomationService", () => {
  let mockLogger: ILogger;
  let mockLightEntities: TestBooleanEntity[]; // Array for multiple lights
  let mockMotionEntity: TestBinarySensorEntity;
  let mockLuxEntity: TestSensorEntity;
  let automation: MyAutomationService;
  
  // Capture callbacks from entity registration
  let motionCallback: (newState: { state: "on" | "off" | undefined }, oldState: { state: "on" | "off" | undefined }) => void;
  let luxCallback: (newState: { state: string | number | undefined }, oldState: { state: string | number | undefined }) => void;

  beforeEach(() => {
    vi.useFakeTimers(); // For timer testing

    mockLogger = {
      info: vi.fn(), debug: vi.fn(), warn: vi.fn(), 
      error: vi.fn(), fatal: vi.fn(), trace: vi.fn()
    } as ILogger;
    
    // TODO: Set up multiple light entities if needed
    mockLightEntities = [
      { state: "off", turn_on: vi.fn(), turn_off: vi.fn() },
      { state: "off", turn_on: vi.fn(), turn_off: vi.fn() },
    ];
    
    mockMotionEntity = {
      state: "off",
      onUpdate: vi.fn((callback) => { motionCallback = callback; }),
    };

    mockLuxEntity = {
      state: 500, // TODO: Set initial state
      onUpdate: vi.fn((callback) => { luxCallback = callback; }),
    };

    automation = new MyAutomationService(
      mockLogger,
      mockLightEntities,
      mockMotionEntity,
      mockLuxEntity,
    );

    vi.clearAllMocks(); // Clear setup calls
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Motion automation", () => {
    it("should turn lights on when motion detected and dark", () => {
      mockLuxEntity.state = 500; // Dark conditions
      
      motionCallback({ state: "on" }, { state: "off" });

      // Test all lights turned on
      expect(mockLightEntities[0].turn_on).toHaveBeenCalledTimes(1);
      expect(mockLightEntities[1].turn_on).toHaveBeenCalledTimes(1);
    });

    it("should handle threshold boundary conditions", () => {
      // Test exactly at threshold
      mockLuxEntity.state = 1000;
      motionCallback({ state: "on" }, { state: "off" });
      expect(mockLightEntities[0].turn_on).not.toHaveBeenCalled();

      vi.clearAllMocks();

      // Test just below threshold
      mockLuxEntity.state = 999;
      motionCallback({ state: "on" }, { state: "off" });
      expect(mockLightEntities[0].turn_on).toHaveBeenCalledTimes(1);
    });

    it("should ignore undefined state updates", () => {
      motionCallback({ state: undefined }, { state: "off" });
      expect(mockLightEntities[0].turn_on).not.toHaveBeenCalled();
    });

    // TODO: Add timer tests if automation uses timers
    // TODO: Add integration scenarios
  });

  // TODO: Add more describe blocks for different automation features
});
```

## Key Testing Patterns

- **Mock Entity Types**: Extend mock interfaces with `Mock` types for method spies
- **Callback Capture**: Store entity callback functions to trigger events in tests
- **State Setup**: Set mock entity states before triggering callbacks
- **Clear Mocks**: Use `vi.clearAllMocks()` after setup to ignore initialization calls
- **Test Boundaries**: Test threshold conditions (exactly at, just above/below limits)
- **Handle Undefined**: Always test undefined state handling for offline entities

## Entity Wrapper Benefits

- **Testability**: Mock interfaces allow easy unit testing without Home Assistant
- **Type Safety**: Strong typing prevents runtime errors
- **Abstraction**: Business logic doesn't depend on Digital Alchemy internals
- **Reusability**: Entity wrappers can be shared across multiple automations

## Reference Implementation

See `src/services/backyard_ambiance.ts` and `src/services/tests/backyard_ambiance.test.ts` for a complete working example.
