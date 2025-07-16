import type { ILogger } from "@digital-alchemy/core";
import { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";
import { unwrapNumericState } from "./states_helpers";

export class SystemStateManager {
  public state: "STOPPED" | "RUNNING" = "STOPPED";

  private targetState: string | undefined = undefined;
  private stateChangeStartTime: Date | undefined = undefined;
  private listeners: Array<(newState: "STOPPED" | "RUNNING") => void> = [];

  constructor(
    private readonly logger: ILogger,
    private readonly pvProductionSensor: ByIdProxy<PICK_ENTITY<"sensor">>,
    private readonly enableSystemSwitch: ByIdProxy<PICK_ENTITY<"switch">>,
    private readonly pvProductionActivationThreshold: number,
    private readonly pvProductionActivationDelayMs: number,
  ) {
    if (this.getDesiredState() === "RUNNING") {
      this.state = "RUNNING";
    }

    pvProductionSensor.onUpdate((state, previousState) => {
      const pvProduction = unwrapNumericState(state.state);
      this.onPvProductionUpdate(pvProduction);
    });

    enableSystemSwitch.onUpdate((state, previousState) => {
      if (!state) {
        return;
      }
      this.onSwitchStateUpdate();
    });
  }

  private getDesiredState(): "STOPPED" | "RUNNING" {
    const pvProduction = unwrapNumericState(this.pvProductionSensor.state);
    const switchEnabled = this.enableSystemSwitch.state === "on";
    
    return pvProduction != null && 
           pvProduction > this.pvProductionActivationThreshold && 
           switchEnabled
      ? "RUNNING"
      : "STOPPED";
  }

  private onPvProductionUpdate(pvProduction: number | undefined) {
    if (pvProduction == null) {
      return;
    }
    this.handleStateChange();
  }

  private onSwitchStateUpdate() {
    this.handleStateChange();
  }

  private handleStateChange() {
    const desiredState = this.getDesiredState();
    if (this.state === desiredState) {
      // Already in desired state, reset timing
      this.stateChangeStartTime = undefined;
      this.targetState = undefined;
    } else if (this.targetState !== desiredState) {
      // Starting transition to new state
      this.stateChangeStartTime = new Date();
      this.targetState = desiredState;
      console.log(
        `Starting transition to ${desiredState}, waiting ${this.pvProductionActivationDelayMs}ms`,
      );
    } else if (this.stateChangeStartTime) {
      // Check if delay has passed
      const elapsedTime = Date.now() - this.stateChangeStartTime.getTime();
      if (elapsedTime >= this.pvProductionActivationDelayMs) {
        this.state = this.targetState;
        console.log(
          `State changed to ${this.state} after ${elapsedTime}ms delay`,
        );
        this.stateChangeStartTime = undefined;
        this.targetState = undefined;
        this.listeners.forEach((listener) => listener(this.state));
      }
    }
  }

  onSystemStateChange(listener: (newState: "STOPPED" | "RUNNING") => void) {
    this.listeners.push(listener);
    setTimeout(() => listener(this.state), 0); // Notify immediately with current state
  }
}
