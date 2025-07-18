import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DeviceTransitionStateMachine, DeviceTransitionState } from "../device_transition_state_machine";

describe("DeviceTransitionStateMachine", () => {
    let stateMachine: DeviceTransitionStateMachine;

    beforeEach(() => {
        vi.useFakeTimers();
        stateMachine = new DeviceTransitionStateMachine();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("Initial State", () => {
        it("should start in IDLE state", () => {
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
        });
    });

    describe("Single State Transitions", () => {
        it("should transition from IDLE to INCREASE_PENDING", () => {
            stateMachine.transitionToState({ state: DeviceTransitionState.INCREASE_PENDING, expectedFutureConsumption: 500 });
            
            const state = stateMachine.state;
            expect(state.state).toBe(DeviceTransitionState.INCREASE_PENDING);
            if (state.state === DeviceTransitionState.INCREASE_PENDING) {
                expect(state.expectedFutureConsumption).toBe(500);
            }
        });

        it("should transition from IDLE to DECREASE_PENDING", () => {
            stateMachine.transitionToState({ state: DeviceTransitionState.DECREASE_PENDING, expectedFutureConsumption: 300 });
            
            const state = stateMachine.state;
            expect(state.state).toBe(DeviceTransitionState.DECREASE_PENDING);
            if (state.state === DeviceTransitionState.DECREASE_PENDING) {
                expect(state.expectedFutureConsumption).toBe(300);
            }
        });

        it("should transition from INCREASE_PENDING to DEBOUNCE", () => {
            stateMachine.transitionToState({ state: DeviceTransitionState.INCREASE_PENDING, expectedFutureConsumption: 500 });
            stateMachine.transitionToState({ state: DeviceTransitionState.DEBOUNCE });
            
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.DEBOUNCE });
        });

        it("should transition from DECREASE_PENDING to DEBOUNCE", () => {
            stateMachine.transitionToState({ state: DeviceTransitionState.DECREASE_PENDING, expectedFutureConsumption: 300 });
            stateMachine.transitionToState({ state: DeviceTransitionState.DEBOUNCE });
            
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.DEBOUNCE });
        });

        it("should transition from PENDING states to IDLE", () => {
            stateMachine.transitionToState({ state: DeviceTransitionState.INCREASE_PENDING, expectedFutureConsumption: 500 });
            stateMachine.transitionToState({ state: DeviceTransitionState.IDLE });
            
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
        });

        it("should transition from DEBOUNCE to IDLE", () => {
            stateMachine.transitionToState({ state: DeviceTransitionState.INCREASE_PENDING, expectedFutureConsumption: 500 });
            stateMachine.transitionToState({ state: DeviceTransitionState.DEBOUNCE });
            stateMachine.transitionToState({ state: DeviceTransitionState.IDLE });
            
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
        });
    });

    describe("Invalid Transitions", () => {
        it("should throw error for invalid transition from IDLE to DEBOUNCE", () => {
            expect(() => {
                stateMachine.transitionToState({ state: DeviceTransitionState.DEBOUNCE });
            }).toThrow("Invalid transition from IDLE to DEBOUNCE");
        });

        it("should throw error for invalid transition from DEBOUNCE to INCREASE_PENDING", () => {
            stateMachine.transitionToState({ state: DeviceTransitionState.INCREASE_PENDING, expectedFutureConsumption: 500 });
            stateMachine.transitionToState({ state: DeviceTransitionState.DEBOUNCE });
            
            expect(() => {
                stateMachine.transitionToState({ state: DeviceTransitionState.INCREASE_PENDING, expectedFutureConsumption: 500 });
            }).toThrow("Invalid transition from DEBOUNCE to INCREASE_PENDING");
        });

        it("should throw error for invalid transition from INCREASE_PENDING to DECREASE_PENDING", () => {
            stateMachine.transitionToState({ state: DeviceTransitionState.INCREASE_PENDING, expectedFutureConsumption: 500 });
            
            expect(() => {
                stateMachine.transitionToState({ state: DeviceTransitionState.DECREASE_PENDING, expectedFutureConsumption: 300 });
            }).toThrow("Invalid transition from INCREASE_PENDING to DECREASE_PENDING");
        });
    });

    describe("Chained Transitions", () => {
        it("should handle single transition with automatic return to IDLE", () => {
            stateMachine.transitionTo([{
                state: DeviceTransitionState.INCREASE_PENDING, 
                expectedFutureConsumption: 500, 
                transitionAfter: 2000
            }]);
            
            const state = stateMachine.state;
            expect(state.state).toBe(DeviceTransitionState.INCREASE_PENDING);
            if (state.state === DeviceTransitionState.INCREASE_PENDING) {
                expect(state.expectedFutureConsumption).toBe(500);
            }
            
            vi.advanceTimersByTime(2000);
            
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
        });

        it("should handle two-state transition sequence", () => {
            stateMachine.transitionTo([
                { state: DeviceTransitionState.INCREASE_PENDING, expectedFutureConsumption: 500, transitionAfter: 2000 },
                { state: DeviceTransitionState.DEBOUNCE, transitionAfter: 15000 }
            ]);
            
            // Should start in INCREASE_PENDING
            const state1 = stateMachine.state;
            expect(state1.state).toBe(DeviceTransitionState.INCREASE_PENDING);
            if (state1.state === DeviceTransitionState.INCREASE_PENDING) {
                expect(state1.expectedFutureConsumption).toBe(500);
            }
            
            // After 2000ms, should transition to DEBOUNCE
            vi.advanceTimersByTime(2000);
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.DEBOUNCE });
            
            // After additional 15000ms, should return to IDLE
            vi.advanceTimersByTime(15000);
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
        });

        it("should handle three-state transition sequence", () => {
            stateMachine.transitionTo([
                { state: DeviceTransitionState.DECREASE_PENDING, expectedFutureConsumption: 300, transitionAfter: 1000 },
                { state: DeviceTransitionState.DEBOUNCE, transitionAfter: 5000 },
                { state: DeviceTransitionState.IDLE, transitionAfter: 2000 }
            ]);
            
            // Should start in DECREASE_PENDING
            const state1 = stateMachine.state;
            expect(state1.state).toBe(DeviceTransitionState.DECREASE_PENDING);
            if (state1.state === DeviceTransitionState.DECREASE_PENDING) {
                expect(state1.expectedFutureConsumption).toBe(300);
            }
            
            // After 1000ms, should transition to DEBOUNCE
            vi.advanceTimersByTime(1000);
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.DEBOUNCE });
            
            // After additional 5000ms, should transition to IDLE
            vi.advanceTimersByTime(5000);
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
            
            // After additional 2000ms, should still be in IDLE (final state)
            vi.advanceTimersByTime(2000);
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
        });

        it("should handle empty transition array", () => {
            stateMachine.transitionTo([]);
            
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
        });
    });

    describe("Timer Management", () => {
        it("should clear existing timer when new transition is started", () => {
            stateMachine.transitionTo([{
                state: DeviceTransitionState.INCREASE_PENDING, 
                expectedFutureConsumption: 500, 
                transitionAfter: 10000
            }]);
            
            const state1 = stateMachine.state;
            expect(state1.state).toBe(DeviceTransitionState.INCREASE_PENDING);
            
            // Start new transition before first completes
            vi.advanceTimersByTime(5000);
            stateMachine.transitionTo([{
                state: DeviceTransitionState.DECREASE_PENDING, 
                expectedFutureConsumption: 300, 
                transitionAfter: 3000
            }]);
            
            const state2 = stateMachine.state;
            expect(state2.state).toBe(DeviceTransitionState.DECREASE_PENDING);
            if (state2.state === DeviceTransitionState.DECREASE_PENDING) {
                expect(state2.expectedFutureConsumption).toBe(300);
            }
            
            // Original timer should be cleared, new timer should complete
            vi.advanceTimersByTime(3000);
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
        });

        it("should clear existing timer when transitionToState is called", () => {
            stateMachine.transitionTo([{
                state: DeviceTransitionState.INCREASE_PENDING, 
                expectedFutureConsumption: 500, 
                transitionAfter: 10000
            }]);
            
            const state1 = stateMachine.state;
            expect(state1.state).toBe(DeviceTransitionState.INCREASE_PENDING);
            
            // Direct state transition should clear timer
            vi.advanceTimersByTime(5000);
            stateMachine.transitionToState({ state: DeviceTransitionState.DEBOUNCE });
            
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.DEBOUNCE });
            
            // Original timer should be cleared - advancing time should not change state
            vi.advanceTimersByTime(10000);
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.DEBOUNCE });
        });

        it("should clear transition queue when transitionToState is called", () => {
            // Start a multi-step transition
            stateMachine.transitionTo([
                { state: DeviceTransitionState.INCREASE_PENDING, expectedFutureConsumption: 500, transitionAfter: 2000 },
                { state: DeviceTransitionState.DEBOUNCE, transitionAfter: 5000 }
            ]);
            
            expect(stateMachine.state.state).toBe(DeviceTransitionState.INCREASE_PENDING);
            
            // After partial time, manually override with transitionToState
            vi.advanceTimersByTime(1000);
            stateMachine.transitionToState({ state: DeviceTransitionState.DEBOUNCE });
            
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.DEBOUNCE });
            
            // The queued transition should be cleared - state should remain DEBOUNCE
            // (without the fix, it would transition to IDLE after the original timers)
            vi.advanceTimersByTime(10000);
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.DEBOUNCE });
        });

        it("should handle manual transition to IDLE during pending transition queue", () => {
            // Start a multi-step transition with both PENDING and DEBOUNCE phases
            stateMachine.transitionTo([
                { state: DeviceTransitionState.DECREASE_PENDING, expectedFutureConsumption: 300, transitionAfter: 3000 },
                { state: DeviceTransitionState.DEBOUNCE, transitionAfter: 8000 }
            ]);
            
            // Should start in DECREASE_PENDING
            const state1 = stateMachine.state;
            expect(state1.state).toBe(DeviceTransitionState.DECREASE_PENDING);
            if (state1.state === DeviceTransitionState.DECREASE_PENDING) {
                expect(state1.expectedFutureConsumption).toBe(300);
            }
            
            // After partial time (before first transition completes), manually go to IDLE
            vi.advanceTimersByTime(1500);
            stateMachine.transitionToState({ state: DeviceTransitionState.IDLE });
            
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
            
            // Advance time past all original transition points
            // Without the fix, it would try to execute queued transitions
            vi.advanceTimersByTime(15000);
            
            // Should remain in IDLE - no queued transitions should execute
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
        });

        it("should handle manual transition to IDLE during DEBOUNCE phase", () => {
            // Start a multi-step transition
            stateMachine.transitionTo([
                { state: DeviceTransitionState.INCREASE_PENDING, expectedFutureConsumption: 400, transitionAfter: 2000 },
                { state: DeviceTransitionState.DEBOUNCE, transitionAfter: 6000 }
            ]);
            
            // Let first transition complete (PENDING -> DEBOUNCE)
            vi.advanceTimersByTime(2000);
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.DEBOUNCE });
            
            // During DEBOUNCE phase, manually transition to IDLE
            vi.advanceTimersByTime(3000); // 3 seconds into the 6-second DEBOUNCE
            stateMachine.transitionToState({ state: DeviceTransitionState.IDLE });
            
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
            
            // Advance time past the original DEBOUNCE completion point
            vi.advanceTimersByTime(10000);
            
            // Should remain in IDLE - the automatic return to IDLE should not execute
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
        });
    });

    describe("Reset", () => {
        it("should reset to IDLE and clear all timers", () => {
            stateMachine.transitionTo([
                { state: DeviceTransitionState.INCREASE_PENDING, expectedFutureConsumption: 500, transitionAfter: 5000 },
                { state: DeviceTransitionState.DEBOUNCE, transitionAfter: 10000 }
            ]);
            
            const state1 = stateMachine.state;
            expect(state1.state).toBe(DeviceTransitionState.INCREASE_PENDING);
            if (state1.state === DeviceTransitionState.INCREASE_PENDING) {
                expect(state1.expectedFutureConsumption).toBe(500);
            }
            
            stateMachine.reset();
            
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
            
            // Advancing time should not change state
            vi.advanceTimersByTime(20000);
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
        });
    });

    describe("Convenience Methods", () => {
        it("should handle transitionToPending with INCREASE_PENDING", () => {
            stateMachine.transitionToPending(
                DeviceTransitionState.INCREASE_PENDING,
                750,  // expectedFutureConsumption
                3000, // pending duration
                12000 // debounce duration
            );
            
            // Should start in INCREASE_PENDING
            const state1 = stateMachine.state;
            expect(state1.state).toBe(DeviceTransitionState.INCREASE_PENDING);
            if (state1.state === DeviceTransitionState.INCREASE_PENDING) {
                expect(state1.expectedFutureConsumption).toBe(750);
            }
            
            // After 3000ms, should transition to DEBOUNCE
            vi.advanceTimersByTime(3000);
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.DEBOUNCE });
            
            // After additional 12000ms, should return to IDLE
            vi.advanceTimersByTime(12000);
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
        });

        it("should handle transitionToPending with DECREASE_PENDING", () => {
            stateMachine.transitionToPending(
                DeviceTransitionState.DECREASE_PENDING,
                250,  // expectedFutureConsumption
                1500, // pending duration
                8000  // debounce duration
            );
            
            // Should start in DECREASE_PENDING
            const state1 = stateMachine.state;
            expect(state1.state).toBe(DeviceTransitionState.DECREASE_PENDING);
            if (state1.state === DeviceTransitionState.DECREASE_PENDING) {
                expect(state1.expectedFutureConsumption).toBe(250);
            }
            
            // After 1500ms, should transition to DEBOUNCE
            vi.advanceTimersByTime(1500);
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.DEBOUNCE });
            
            // After additional 8000ms, should return to IDLE
            vi.advanceTimersByTime(8000);
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
        });

        it("should be equivalent to manual transitionTo with same parameters", () => {
            const expectedFutureConsumption = 600;
            const pendingDuration = 2500;
            const debounceDuration = 10000;
            
            // Test with convenience method
            stateMachine.transitionToPending(
                DeviceTransitionState.INCREASE_PENDING,
                expectedFutureConsumption,
                pendingDuration,
                debounceDuration
            );
            
            const state1 = stateMachine.state;
            expect(state1.state).toBe(DeviceTransitionState.INCREASE_PENDING);
            if (state1.state === DeviceTransitionState.INCREASE_PENDING) {
                expect(state1.expectedFutureConsumption).toBe(expectedFutureConsumption);
            }
            
            // Reset and test with manual method
            stateMachine.reset();
            stateMachine.transitionTo([
                { state: DeviceTransitionState.INCREASE_PENDING, expectedFutureConsumption, transitionAfter: pendingDuration },
                { state: DeviceTransitionState.DEBOUNCE, transitionAfter: debounceDuration }
            ]);
            
            const state2 = stateMachine.state;
            expect(state2.state).toBe(DeviceTransitionState.INCREASE_PENDING);
            if (state2.state === DeviceTransitionState.INCREASE_PENDING) {
                expect(state2.expectedFutureConsumption).toBe(expectedFutureConsumption);
            }
            
            // Both should behave identically
            expect(state1).toEqual(state2);
        });
    });

    describe("State Info", () => {
        it("should return correct state info for IDLE", () => {
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.IDLE });
        });

        it("should return correct state info for PENDING states", () => {
            stateMachine.transitionToState({ state: DeviceTransitionState.INCREASE_PENDING, expectedFutureConsumption: 750 });
            const state = stateMachine.state;
            expect(state.state).toBe(DeviceTransitionState.INCREASE_PENDING);
            if (state.state === DeviceTransitionState.INCREASE_PENDING) {
                expect(state.expectedFutureConsumption).toBe(750);
            }
        });

        it("should return correct state info for DEBOUNCE", () => {
            stateMachine.transitionToState({ state: DeviceTransitionState.INCREASE_PENDING, expectedFutureConsumption: 500 });
            stateMachine.transitionToState({ state: DeviceTransitionState.DEBOUNCE });
            expect(stateMachine.state).toEqual({ state: DeviceTransitionState.DEBOUNCE });
        });
    });
});
