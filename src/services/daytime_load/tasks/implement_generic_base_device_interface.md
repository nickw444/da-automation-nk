# Task: Implement Generic IBaseDevice Interface Enhancement

## Overview
Enhance the `IBaseDevice` interface to be generic, allowing complex devices (like future climate devices) to encode action data directly in increment objects rather than requiring reverse-mapping calculations during increase/decrease operations.

## Current State
- [`IBaseDevice`](file:///Users/nickw/repos/da-automation-nk/src/services/daytime_load/devices/base_device.ts#L1-L32) currently uses `number[]` for increments
- [`BooleanDevice`](file:///Users/nickw/repos/da-automation-nk/src/services/daytime_load/devices/boolean_device.ts#L9) uses simple numeric increments (just power values)
- Complex devices would need to reverse-map power deltas to actions during operations
- No action-specific data is preserved in increment objects

## Required Changes

### 1. Update IBaseDevice Interface
**File**: `src/services/daytime_load/devices/base_device.ts`

Transform the interface to be generic with separate types for increase/decrease:

```typescript
export interface IBaseDevice<T extends {delta: number}, U extends {delta: number}> {
  name: string;
  priority: number;

  // Separate types for increase and decrease increments
  get increaseIncrements(): T[];
  get decreaseIncrements(): U[];

  get currentConsumption(): number;
  get changeState():
    | { type: "increase" | "decrease", expectedFutureConsumption: number }
    | { type: "debounce" }
    | undefined;

  // Type-safe parameters: T for increase, U for decrease
  increaseConsumptionBy(increment: T): void;
  decreaseConsumptionBy(increment: U): void;

  stop(): void;
}
```

### 2. Remove Exported Increment Interfaces
**Note**: Increment types should be defined within each device module, not exported from base_device.ts

### 3. Update DeviceHelper Class
**File**: `src/services/daytime_load/devices/base_device.ts`

Simplify validation methods (no need to validate increment existence):

```typescript
export class DeviceHelper {
  static validateIncreaseConsumptionBy<T extends {delta: number}, U extends {delta: number}>(
    device: IBaseDevice<T, U>, 
    increment: T
  ): void {
    // Only validate debounce state - assume increment is valid since caller
    // should pass objects directly from device.increaseIncrements
    const currentChangeState = device.changeState;
    if (currentChangeState?.type === "increase" || currentChangeState?.type === "decrease") {
      throw new Error(
        `Cannot increase consumption for ${device.name}: change already pending`
      );
    }
  }

  static validateDecreaseConsumptionBy<T extends {delta: number}, U extends {delta: number}>(
    device: IBaseDevice<T, U>, 
    increment: U
  ): void {
    // Only validate debounce state
    const currentChangeState = device.changeState;
    if (currentChangeState?.type === "increase" || currentChangeState?.type === "decrease") {
      throw new Error(
        `Cannot decrease consumption for ${device.name}: change already pending`
      );
    }
  }
}
```

### 4. Update BooleanDevice Implementation
**File**: `src/services/daytime_load/devices/boolean_device.ts`

Define increment types within the module and update the class:

```typescript
interface BooleanIncreaseIncrement {
  delta: number;     // Power consumption change in watts
  action: "turn_on"; // Encapsulated desired action
}

interface BooleanDecreaseIncrement {
  delta: number;     // Power consumption change in watts
  action: "turn_off"; // Encapsulated desired action
}

export class BooleanDevice implements IBaseDevice<BooleanIncreaseIncrement, BooleanDecreaseIncrement> {
  get increaseIncrements(): BooleanIncreaseIncrement[] {
    if (this.entityRef.state === "on") {
      return [];
    }
    return [{ 
      delta: this.expectedConsumption, 
      action: "turn_on" 
    }];
  }

  get decreaseIncrements(): BooleanDecreaseIncrement[] {
    if (this.entityRef.state === "off") {
      return [];
    }
    const consumption = unwrapNumericState(this.consumptionEntityRef.state) || this.expectedConsumption;
    return [{ 
      delta: consumption, 
      action: "turn_off" 
    }];
  }

  increaseConsumptionBy(increment: BooleanIncreaseIncrement): void {
    DeviceHelper.validateIncreaseConsumptionBy(this, increment);
    
    // Action is already encoded - just execute it
    this.entityRef.turn_on();
    this.recordStateChange("on");
    // ... existing state machine logic
  }

  decreaseConsumptionBy(increment: BooleanDecreaseIncrement): void {
    DeviceHelper.validateDecreaseConsumptionBy(this, increment);
    
    // Action is already encoded - just execute it
    this.entityRef.turn_off();
    this.recordStateChange("off");
    // ... existing state machine logic
  }
}
```

### 5. Backward Compatibility
Ensure smooth transition by:
- No default generic parameters needed - each device defines its own increment types
- Updating all existing device usages to work with new two-parameter interface

### 6. Update Device Manager and Tests
**Files**: Any files that create or use device instances

Update to work with new generic interface:
- Device manager code that calls `increaseConsumptionBy`/`decreaseConsumptionBy`
- Test files that mock or create device instances

## Benefits
1. **Type Safety**: Compiler enforces correct increment types for each device
2. **Encapsulated Actions**: All necessary action data stored in increment objects  
3. **Simplified Implementation**: Direct action application without duplicate calculations
4. **Extensibility**: Future complex device types can define custom increment interfaces
5. **Consistency**: All devices follow the same pattern regardless of complexity

## Migration Path
1. Update `IBaseDevice` interface with two generic parameters T and U (no defaults)
2. Update `DeviceHelper` validation methods to work with separate increment types
3. Update `BooleanDevice` to define separate increase/decrease increment types
4. Update any device manager code and tests to work with new interface
5. Verify type checking and functionality

## Testing Requirements
- Verify `BooleanDevice` implementations continue working correctly
- Validate type safety with TypeScript compiler
- Ensure `DeviceHelper` validation works with separate increment types
- Test device manager integration with new increment interface
- Verify compiler prevents mixing increase/decrease increment types

## Dependencies
- No external dependencies required
- Must update all existing device implementations and usage code
