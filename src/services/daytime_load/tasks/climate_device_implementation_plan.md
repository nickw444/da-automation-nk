# Climate Device Implementation Plan

## Overview

This plan outlines the step-by-step implementation of the `ClimateDevice` class based on the specification in `climate_device.md`. The implementation follows the established patterns from `BooleanDevice` while handling the complexity of temperature setpoints, multiple modes, and sophisticated power calculations.

## Implementation Strategy

- **Incremental Development**: Each phase builds upon the previous one with comprehensive testing
- **Test-Driven Approach**: Every increment includes corresponding unit tests
- **Entity Wrapper Pattern**: Uses `IClimateEntityWrapper` and `ISensorEntityWrapper` for testability
- **State Machine Integration**: Create own implementation of `ConsumptionTransitionStateMachine` for pending changes specific to climate devices.
- **Type Safety**: Maintains strong typing throughout with custom increment interfaces

## Phase 1: Foundation Setup

### 1. Create basic ClimateDevice class structure
- [x] Create `src/services/daytime_load/devices/climate_device.ts`
- [x] Implement `IBaseDevice` interface with placeholder increment types
- [x] Add constructor with climate entity wrapper, sensor entity wrapper, and config
- [x] Implement empty/minimal getter methods (`name`, `priority`, `currentConsumption`)
- [x] Create basic test file `src/services/daytime_load/devices/tests/climate_device.test.ts`
- [x] Add basic test setup with mock entities

### 2. Define increment types and interfaces
- [x] Create `ClimateIncrement` interface with required properties:
  - `delta: number` (power consumption change)
  - `targetSetpoint?: number` (absolute setpoint)
  - `setpointChange?: number` (relative change)
  - `modeChange?: string` (mode switch operation)
- [x] Define `IClimateHassControls` interface for user inputs
- [x] Create `ClimateDeviceConfig` interface matching the spec
- [x] Add interface definitions to separate file or inline
- [x] Test that types compile correctly

## Phase 2: Basic Property Implementation

### 3. Implement currentConsumption
- [x] Return real-time consumption from sensor entity using `unwrapNumericState`
- [x] Handle sensor unavailability gracefully (return 0 or fallback)
- [x] Add test to verify consumption reading
- [x] Test sensor unavailability handling

### 4. Implement basic changeState logic
- [x] Add consumption transition state machine integration
- [x] Implement debounce timing logic (setpoint, mode, startup)
- [x] Add private `unlockedTime` tracking similar to `BooleanDevice`
- [x] Return appropriate state based on pending changes and debounce
- [x] Add tests for state transitions and debounce behavior
- [x] Test different debounce periods (setpoint vs mode vs startup)

## Phase 3: Core Power Calculation Logic

### 5. Implement power calculation helpers
- [x] Create helper methods for temperature differential calculations
- [x] Add consumption scaling and blending logic per spec formulas
- [x] Implement startup power calculation with `powerOnSetpointOffset`
- [x] Add `clamp` and `blend` utility functions
- [x] Create comprehensive unit tests for power calculations
- [x] Test edge cases (device off, temperature extremes, etc.)

### 6. Implement increaseIncrements property
- [x] Handle device-off case (startup power calculation)
- [x] Calculate setpoint adjustments toward user desired setpoint
- [x] Apply temperature and consumption constraints
- [x] Use blended scaling approach from spec
- [x] Cap consumption at `maxCompressorConsumption`
- [x] Test various scenarios:
  - [x] Device off → startup increment
  - [x] Setpoint increases toward desired
  - [x] Mode changes (fan → heat/cool)
  - [x] Constraint enforcement

## Phase 4: Decrease Consumption Logic

### 7. Implement decreaseIncrements property
- [x] Calculate setpoint adjustments away from user desired setpoint
- [x] Handle comfort setpoint boundaries
- [x] Add fan-only mode transitions (when no comfort setpoint)
- [x] Apply minimum consumption floors per mode
- [x] Test decrease scenarios:
  - [x] With comfort setpoint limits
  - [x] Without comfort limits (fan-only available)
  - [x] Mode transitions (heat/cool → fan-only)
  - [x] Minimum consumption enforcement

### 8. Add constraint validation
- [x] Enforce min/max temperature limits from config
- [x] Validate comfort setpoint boundaries
- [x] Handle edge cases (already at limits, invalid configurations)
- [x] Test constraint enforcement thoroughly:
  - [x] Temperature bounds
  - [x] Comfort setpoint validation
  - [x] Configuration edge cases

## Phase 5: Action Execution

### 9. Implement increaseConsumptionBy method
- [x] Execute encoded actions based on increment properties:
  - [x] `modeChange` from off: Set initial device setpoint
  - [x] `modeChange` specified: Switch mode
  - [x] `targetSetpoint` specified: Set absolute setpoint
  - [x] `setpointChange` specified: Adjust relatively
- [x] Handle startup from off state with proper setpoint calculation
- [x] Integrate with state machine for pending changes
- [x] Add debounce period management using `recordStateChange`
- [x] Test action execution and state updates:
  - [x] Startup actions
  - [x] Setpoint adjustments
  - [x] Mode changes
  - [x] State machine transitions

### 10. Implement decreaseConsumptionBy method
- [x] Execute decrease actions (setpoint adjustments, fan-only mode)
- [x] Handle comfort setpoint constraints
- [x] Apply same action execution pattern as increase
- [x] Test decrease action execution:
  - [x] Setpoint adjustments
  - [x] Fan-only mode transitions
  - [x] Comfort boundary enforcement

## Phase 6: Advanced Features

### 11. Add fan-only timeout logic
- [ ] Implement automatic off transition after timeout
- [ ] Handle timeout state management with timers
- [ ] Add timeout configuration from `fanOnlyTimeoutMs`
- [ ] Test timeout behavior:
  - [ ] Automatic transition to off
  - [ ] Timer management
  - [ ] Timeout cancellation on mode change

### 12. Implement stop method
- [ ] Turn off device immediately using `turnOff()`
- [ ] Reset state machine to idle
- [ ] Clear any pending timers
- [ ] Test emergency stop functionality

## Phase 7: Integration and Polish

### 13. Add ClimateDevice to union type
- [ ] Update `src/services/daytime_load/devices/device.ts` union type
- [ ] Import `ClimateDevice` in the union
- [ ] Ensure type safety across the system

### 14. Comprehensive integration testing
- [ ] Test full workflow scenarios:
  - [ ] Complete heating cycle
  - [ ] Complete cooling cycle
  - [ ] Load management scenarios
- [ ] Test error conditions and edge cases
- [ ] Performance testing with rapid state changes
- [ ] Test concurrent increment calculations

### 15. Documentation and validation
- [ ] Add inline documentation for complex logic
- [ ] Validate against specification requirements
- [ ] Run full test suite and type checking
- [ ] Add usage examples in comments

## Key Testing Strategy

### Unit Tests
- **Mock entity interfaces** from `MockClimateEntityWrapper` and `MockSensorEntityWrapper`
- **Power calculation tests** with various temperature scenarios
- **Increment generation tests** for all constraint combinations
- **Action execution tests** with state verification

### State Machine Tests
- **Transition tests** for all valid state changes
- **Debounce tests** for different timing scenarios
- **Pending change tests** to prevent overlapping actions

### Integration Tests
- **Complete workflow tests** from off → heating → cooling → fan-only → off
- **Load management integration** with realistic scenarios
- **Error handling** for sensor failures and invalid configurations

### Edge Case Tests
- **Temperature extremes** (very hot/cold rooms)
- **Constraint boundaries** (min/max setpoints, comfort limits)
- **Configuration validation** (invalid values, missing entities)
- **Rapid state changes** (stress testing debounce logic)

## Success Criteria

- [ ] All increment calculations match specification formulas
- [ ] State machine prevents invalid transitions
- [ ] Debounce periods prevent rapid device changes
- [ ] Power calculations are realistic and bounded
- [ ] Integration with existing load management system
- [ ] 100% test coverage for business logic
- [ ] Type safety maintained throughout
- [ ] Performance acceptable for real-time load management

## Implementation Notes

- **Follow existing patterns** from `BooleanDevice` for consistency
- **Use entity wrapper interfaces** for testability
- **Apply specification formulas** exactly as documented
- **Handle sensor failures** gracefully
- **Maintain type safety** throughout implementation
- **Test incrementally** at each phase
- **Document complex logic** for future maintainers
