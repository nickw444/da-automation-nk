import { ByIdProxy, PICK_ENTITY } from "@digital-alchemy/hass";
import {
  ConsumptionTransitionState,
  ConsumptionTransitionStateMachine,
} from "./consumption_transition_state_machine";
import { unwrapNumericState } from "../states_helpers";
import { DeviceHelper, IBaseDevice } from "./base_device";

// User control interfaces
export interface IClimateHassControls {
  desiredSetpoint: number;        // User's target temperature
  desiredMode: "heat" | "cool";   // User's desired operating mode
  comfortSetpoint?: number;       // Optional comfort boundary temperature
}

// Device configuration
export interface ClimateDeviceConfig {
  // Device Identity
  name: string;                   // Device identifier (e.g., "living_room_ac")
  priority: number;               // Device priority for load management (lower = higher priority)
  
  // Home Assistant Entities
  climateEntity: string;          // climate.living_room_hvac
  consumptionEntity: string;      // sensor.hvac_power_consumption (required)
  
  // Temperature Constraints
  minSetpoint: number;            // 16 (absolute climate entity limits)
  maxSetpoint: number;            // 30 (absolute climate entity limits)
  setpointStep: number;           // 1.0 (temperature increment)
  
  // Power Configuration
  powerOnMinConsumption: number;  // 300 (minimum startup consumption with configured offset)
  powerOnSetpointOffset: number;  // 2.0 (degrees offset from room temp toward desired mode)
  consumptionPerDegree: number;   // 150 (watts per degree of setpoint delta from room temperature)
  maxCompressorConsumption: number; // 800 (maximum compressor consumption at full capacity)
  fanOnlyMinConsumption: number;  // 100 (minimum consumption in fan-only mode)
  heatModeMinConsumption: number; // 200 (minimum consumption when in heating mode)
  coolModeMinConsumption: number; // 200 (minimum consumption when in cooling mode)
  
  // Timing Configuration
  setpointDebounceMs: number;     // 2-5 minutes (120000-300000ms) between setpoint changes
  modeDebounceMs: number;         // 5-10 minutes (300000-600000ms) between mode changes
  startupDebounceMs: number;      // 5-10 minutes (300000-600000ms) for startup from off
  fanOnlyTimeoutMs: number;       // 30-60 minutes (1800000-3600000ms) before auto-off from fan-only
}

// Increment types
export interface ClimateIncreaseIncrement {
  delta: number;                  // Estimated power consumption change (in Watts)
  targetSetpoint?: number;        // Absolute target setpoint for the adjustment
  setpointChange?: number;        // Relative change from current setpoint
  modeChange?: "heat" | "cool";   // Mode switch operation (from off)
}

export interface ClimateDecreaseIncrement {
  delta: number;                  // Estimated power consumption change (in Watts)
  targetSetpoint?: number;        // Absolute target setpoint for the adjustment
  setpointChange?: number;        // Relative change from current setpoint
  modeChange?: "fan";             // Mode switch operation (to fan-only)
}

export class ClimateDevice implements IBaseDevice<ClimateIncreaseIncrement, ClimateDecreaseIncrement> {
  private readonly consumptionTransitionStateMachine: ConsumptionTransitionStateMachine =
    new ConsumptionTransitionStateMachine();
  private setpointUnlockedTime: number = 0;
  private modeUnlockedTime: number = 0;
  private startupUnlockedTime: number = 0;
  private fanOnlyStartTime: number = 0;

  constructor(
    private readonly climateEntityRef: ByIdProxy<PICK_ENTITY<"climate">>,
    private readonly consumptionEntityRef: ByIdProxy<PICK_ENTITY<"sensor">>,
    private readonly config: ClimateDeviceConfig,
    private readonly userControls: IClimateHassControls,
  ) {
  }

  get name(): string {
    return this.config.name;
  }

  get priority(): number {
    return this.config.priority;
  }

  get currentConsumption(): number {
    return unwrapNumericState(this.consumptionEntityRef.state) || 0;
  }

  get increaseIncrements(): ClimateIncreaseIncrement[] {
    const increments: ClimateIncreaseIncrement[] = [];
    
    const currentMode = this.currentMode;
    const currentRoomTemp = this.currentRoomTemperature;
    const currentDeviceSetpoint = this.currentDeviceSetpoint;
    const desiredSetpoint = this.userControls.desiredSetpoint;
    const desiredMode = this.userControls.desiredMode;
    const comfortSetpoint = this.userControls.comfortSetpoint;
    
    // Case 1: Device is off - can turn on
    if (currentMode === "off") {
      const startupIncrement = this.calculateStartupIncrement(currentRoomTemp, desiredSetpoint, desiredMode, comfortSetpoint);
      if (startupIncrement) {
        increments.push(startupIncrement);
      }
      return increments;
    }
    
    // Case 2: Device is in fan-only mode - can switch to heat/cool
    if (currentMode === "fan_only") {
      const modeChangeIncrement = this.calculateModeChangeIncrement(currentRoomTemp, currentDeviceSetpoint, desiredMode);
      if (modeChangeIncrement) {
        increments.push(modeChangeIncrement);
      }
    }
    
    // Case 3: Device is in heat/cool mode - can adjust setpoint toward desired
    if (currentMode === desiredMode) {
      const setpointIncrements = this.calculateSetpointIncreaseIncrements(
        currentRoomTemp, currentDeviceSetpoint, desiredSetpoint, desiredMode, comfortSetpoint
      );
      increments.push(...setpointIncrements);
    }
    
    return increments;
  }

  get decreaseIncrements(): ClimateDecreaseIncrement[] {
    const increments: ClimateDecreaseIncrement[] = [];
    
    const currentMode = this.currentMode;
    const currentRoomTemp = this.currentRoomTemperature;
    const currentDeviceSetpoint = this.currentDeviceSetpoint;
    const desiredSetpoint = this.userControls.desiredSetpoint;
    const desiredMode = this.userControls.desiredMode;
    const comfortSetpoint = this.userControls.comfortSetpoint;
    
    // Case 1: Device is off - cannot decrease
    if (currentMode === "off") {
      return [];
    }
    
    // Case 2: Device is in fan-only mode - cannot decrease further (handled by timeout)
    if (currentMode === "fan_only") {
      return [];
    }
    
    // Case 3: Device is in heat/cool mode - can adjust setpoint or switch to fan
    if (currentMode === desiredMode) {
      // Option 1: Adjust setpoint away from desired
      const setpointIncrements = this.calculateSetpointDecreaseIncrements(
        currentRoomTemp, currentDeviceSetpoint, desiredSetpoint, desiredMode, comfortSetpoint
      );
      increments.push(...setpointIncrements);
      
      // Option 2: Switch to fan-only mode (only if no comfort setpoint specified)
      if (!comfortSetpoint) {
        const fanModeIncrement = this.calculateFanModeIncrement(currentRoomTemp, currentDeviceSetpoint);
        if (fanModeIncrement) {
          increments.push(fanModeIncrement);
        }
      }
    }
    
    return increments;
  }

  get changeState():
    | { type: "increase" | "decrease", expectedFutureConsumption: number }
    | { type: "debounce" }
    | undefined {
    
    // Check for pending state transitions first
    if (
      this.consumptionTransitionStateMachine.state ===
      ConsumptionTransitionState.INCREASE_PENDING
    ) {
      return { type: "increase", expectedFutureConsumption: this.estimateExpectedConsumption() };
    } else if (
      this.consumptionTransitionStateMachine.state ===
      ConsumptionTransitionState.DECREASE_PENDING
    ) {
      return { type: "decrease", expectedFutureConsumption: this.estimateExpectedConsumption() };
    }
    
    // Check debounce periods
    const now = Date.now();
    if (now < this.setpointUnlockedTime || now < this.modeUnlockedTime || now < this.startupUnlockedTime) {
      return { type: "debounce" };
    }
    
    return undefined;
  }

  increaseConsumptionBy(increment: ClimateIncreaseIncrement): void {
    // Check for debounce - return silently if in debounce period
    if (this.changeState?.type === "debounce") {
      return;
    }

    DeviceHelper.validateIncreaseConsumptionBy(this, increment);

    // Execute the encoded action
    this.executeIncreaseAction(increment);
    
    // Transition to pending state
    if (this.consumptionTransitionStateMachine.transitionTo(
      ConsumptionTransitionState.INCREASE_PENDING,
    )) {
      setTimeout(() => {
        this.consumptionTransitionStateMachine.transitionTo(
          ConsumptionTransitionState.IDLE,
        );
      }, 2000); // HVAC response time
    }
  }

  decreaseConsumptionBy(increment: ClimateDecreaseIncrement): void {
    // Check for debounce - return silently if in debounce period
    if (this.changeState?.type === "debounce") {
      return;
    }

    DeviceHelper.validateDecreaseConsumptionBy(this, increment);

    // Execute the encoded action
    this.executeDecreaseAction(increment);
    
    // Transition to pending state
    if (this.consumptionTransitionStateMachine.transitionTo(
      ConsumptionTransitionState.DECREASE_PENDING,
    )) {
      setTimeout(() => {
        this.consumptionTransitionStateMachine.transitionTo(
          ConsumptionTransitionState.IDLE,
        );
      }, 2000); // HVAC response time
    }
  }

  stop(): void {
    // Turn off climate entity
    this.climateEntityRef.turn_off();
    
    // Reset all timers
    this.setpointUnlockedTime = 0;
    this.modeUnlockedTime = 0;
    this.startupUnlockedTime = 0;
    this.fanOnlyStartTime = 0;
    
    this.consumptionTransitionStateMachine.transitionTo(
      ConsumptionTransitionState.IDLE,
    );
  }

  // Helper methods
  private get currentRoomTemperature(): number {
    return unwrapNumericState(this.climateEntityRef.attributes.current_temperature) || 20;
  }

  private get currentDeviceSetpoint(): number {
    return unwrapNumericState(this.climateEntityRef.attributes.temperature) || 20;
  }

  private get currentMode(): string {
    return this.climateEntityRef.state || "off";
  }

  private estimateExpectedConsumption(): number {
    // TODO: Implement power estimation logic
    // This should predict the expected consumption after a pending change
    return this.currentConsumption;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private recordSetpointChange(): void {
    this.setpointUnlockedTime = Date.now() + this.config.setpointDebounceMs;
  }

  private recordModeChange(): void {
    this.modeUnlockedTime = Date.now() + this.config.modeDebounceMs;
  }

  private recordStartupChange(): void {
    this.startupUnlockedTime = Date.now() + this.config.startupDebounceMs;
  }

  // Increment calculation methods
  private calculateStartupIncrement(
    roomTemp: number, 
    desiredSetpoint: number, 
    desiredMode: "heat" | "cool", 
    comfortSetpoint?: number
  ): ClimateIncreaseIncrement | null {
    // Calculate initial setpoint: room temp ± offset toward desired
    const offset = this.config.powerOnSetpointOffset;
    let initialSetpoint: number;
    
    if (desiredMode === "heat") {
      initialSetpoint = roomTemp + offset; // Move warmer
    } else {
      initialSetpoint = roomTemp - offset; // Move cooler
    }
    
    // Apply bounds and constraints
    const boundedSetpoint = this.clamp(initialSetpoint, this.config.minSetpoint, this.config.maxSetpoint);
    
    // Clamp between desired and comfort setpoints if comfort is specified
    let finalSetpoint = boundedSetpoint;
    if (comfortSetpoint) {
      if (desiredMode === "heat") {
        // For heating: comfort is minimum, desired is maximum
        finalSetpoint = this.clamp(boundedSetpoint, comfortSetpoint, desiredSetpoint);
      } else {
        // For cooling: desired is minimum, comfort is maximum
        finalSetpoint = this.clamp(boundedSetpoint, desiredSetpoint, comfortSetpoint);
      }
    }
    
    // Calculate power consumption
    const tempDiff = Math.abs(roomTemp - finalSetpoint);
    const consumption = Math.max(
      tempDiff * this.config.consumptionPerDegree,
      this.config.powerOnMinConsumption
    );
    
    return {
      delta: consumption,
      targetSetpoint: finalSetpoint,
      modeChange: desiredMode,
    };
  }

  private calculateModeChangeIncrement(
    roomTemp: number, 
    currentSetpoint: number, 
    desiredMode: "heat" | "cool"
  ): ClimateIncreaseIncrement | null {
    // Switching from fan-only to heat/cool mode
    const tempDiff = Math.abs(roomTemp - currentSetpoint);
    const modeMinConsumption = desiredMode === "heat" ? 
      this.config.heatModeMinConsumption : this.config.coolModeMinConsumption;
    
    const consumption = Math.max(
      tempDiff * this.config.consumptionPerDegree,
      modeMinConsumption
    );
    
    return {
      delta: consumption - this.config.fanOnlyMinConsumption, // Delta from fan-only
      modeChange: desiredMode,
    };
  }

  private calculateSetpointIncreaseIncrements(
    roomTemp: number, 
    currentSetpoint: number, 
    desiredSetpoint: number, 
    desiredMode: "heat" | "cool", 
    comfortSetpoint?: number
  ): ClimateIncreaseIncrement[] {
    const increments: ClimateIncreaseIncrement[] = [];
    
    // Determine direction: toward desired setpoint
    const isHeating = desiredMode === "heat";
    const towardDesired = isHeating ? 
      (currentSetpoint < desiredSetpoint) : 
      (currentSetpoint > desiredSetpoint);
    
    if (!towardDesired) {
      return []; // Already at or past desired
    }
    
    // Calculate possible setpoint adjustments
    const step = this.config.setpointStep;
    const direction = isHeating ? 1 : -1;
    const maxSteps = Math.floor(Math.abs(desiredSetpoint - currentSetpoint) / step);
    
    for (let i = 1; i <= Math.min(maxSteps, 5); i++) { // Limit to 5 increments
      const newSetpoint = currentSetpoint + (direction * step * i);
      
      // Check bounds
      const boundedSetpoint = this.clamp(newSetpoint, this.config.minSetpoint, this.config.maxSetpoint);
      
      // Skip if differential > 3°C (already at max capacity)
      const tempDiff = Math.abs(roomTemp - boundedSetpoint);
      if (tempDiff > 3) {
        continue;
      }
      
      const consumption = this.calculateConsumptionForSetpoint(roomTemp, boundedSetpoint, desiredMode);
      const currentConsumption = this.currentConsumption;
      
      increments.push({
        delta: consumption - currentConsumption,
        targetSetpoint: boundedSetpoint,
        setpointChange: boundedSetpoint - currentSetpoint,
      });
    }
    
    return increments;
  }

  private calculateSetpointDecreaseIncrements(
    roomTemp: number, 
    currentSetpoint: number, 
    desiredSetpoint: number, 
    desiredMode: "heat" | "cool", 
    comfortSetpoint?: number
  ): ClimateDecreaseIncrement[] {
    const increments: ClimateDecreaseIncrement[] = [];
    
    // Determine direction: away from desired setpoint
    const isHeating = desiredMode === "heat";
    const step = this.config.setpointStep;
    const direction = isHeating ? -1 : 1; // Opposite direction from increase
    
    // Calculate bounds
    let minBound = this.config.minSetpoint;
    let maxBound = this.config.maxSetpoint;
    
    if (comfortSetpoint) {
      if (isHeating) {
        minBound = Math.max(minBound, comfortSetpoint); // Don't go below comfort
      } else {
        maxBound = Math.min(maxBound, comfortSetpoint); // Don't go above comfort
      }
    }
    
    // Calculate possible setpoint adjustments
    const maxSteps = Math.floor(
      isHeating ? 
        (currentSetpoint - minBound) / step : 
        (maxBound - currentSetpoint) / step
    );
    
    for (let i = 1; i <= Math.min(maxSteps, 5); i++) { // Limit to 5 increments
      const newSetpoint = currentSetpoint + (direction * step * i);
      
      // Check bounds
      const boundedSetpoint = this.clamp(newSetpoint, minBound, maxBound);
      
      if (boundedSetpoint === currentSetpoint) {
        continue; // No change possible
      }
      
      const consumption = this.calculateConsumptionForSetpoint(roomTemp, boundedSetpoint, desiredMode);
      const currentConsumption = this.currentConsumption;
      
      increments.push({
        delta: currentConsumption - consumption, // Positive delta for decrease
        targetSetpoint: boundedSetpoint,
        setpointChange: boundedSetpoint - currentSetpoint,
      });
    }
    
    return increments;
  }

  private calculateFanModeIncrement(roomTemp: number, currentSetpoint: number): ClimateDecreaseIncrement | null {
    const currentConsumption = this.currentConsumption;
    const fanConsumption = this.config.fanOnlyMinConsumption;
    
    if (currentConsumption <= fanConsumption) {
      return null; // Already at or below fan-only consumption
    }
    
    return {
      delta: currentConsumption - fanConsumption,
      modeChange: "fan",
    };
  }

  private calculateConsumptionForSetpoint(roomTemp: number, setpoint: number, mode: "heat" | "cool"): number {
    const tempDiff = Math.abs(roomTemp - setpoint);
    const modeMinConsumption = mode === "heat" ? 
      this.config.heatModeMinConsumption : this.config.coolModeMinConsumption;
    
    const baseConsumption = Math.max(
      tempDiff * this.config.consumptionPerDegree,
      modeMinConsumption
    );
    
    return Math.min(baseConsumption, this.config.maxCompressorConsumption);
  }

  private blend(scaledValue: number, linearValue: number, scaledWeight: number = 0.7): number {
    return scaledValue * scaledWeight + linearValue * (1 - scaledWeight);
  }

  // Action execution methods
  private executeIncreaseAction(increment: ClimateIncreaseIncrement): void {
    // Handle mode change from off
    if (increment.modeChange && this.currentMode === "off") {
      this.climateEntityRef.turn_on();
      this.climateEntityRef.set_hvac_mode({ hvac_mode: increment.modeChange });
      this.recordModeChange();
      this.recordStartupChange();
      
      // Set initial setpoint if specified
      if (increment.targetSetpoint) {
        this.climateEntityRef.set_temperature({ temperature: increment.targetSetpoint });
        this.recordSetpointChange();
      }
      
      // Note: We don't switch to fan-only from off in increase operations
      
      return;
    }
    
    // Handle mode change from fan-only to heat/cool
    if (increment.modeChange && this.currentMode === "fan_only") {
      this.climateEntityRef.set_hvac_mode({ hvac_mode: increment.modeChange });
      this.recordModeChange();
      this.fanOnlyStartTime = 0; // Reset fan-only timeout
      return;
    }
    
    // Handle setpoint changes
    if (increment.targetSetpoint) {
      this.climateEntityRef.set_temperature({ temperature: increment.targetSetpoint });
      this.recordSetpointChange();
    } else if (increment.setpointChange) {
      const newSetpoint = this.currentDeviceSetpoint + increment.setpointChange;
      this.climateEntityRef.set_temperature({ temperature: newSetpoint });
      this.recordSetpointChange();
    }
  }

  private executeDecreaseAction(increment: ClimateDecreaseIncrement): void {
    // Handle mode change to fan-only
    if (increment.modeChange === "fan") {
      this.climateEntityRef.set_hvac_mode({ hvac_mode: "fan_only" });
      this.recordModeChange();
      this.fanOnlyStartTime = Date.now(); // Start fan-only timeout
      return;
    }
    
    // Handle setpoint changes
    if (increment.targetSetpoint) {
      this.climateEntityRef.set_temperature({ temperature: increment.targetSetpoint });
      this.recordSetpointChange();
    } else if (increment.setpointChange) {
      const newSetpoint = this.currentDeviceSetpoint + increment.setpointChange;
      this.climateEntityRef.set_temperature({ temperature: newSetpoint });
      this.recordSetpointChange();
    }
  }

  // Fan-only timeout handling
  private checkFanOnlyTimeout(): void {
    if (this.currentMode === "fan_only" && this.fanOnlyStartTime > 0) {
      const elapsed = Date.now() - this.fanOnlyStartTime;
      if (elapsed > this.config.fanOnlyTimeoutMs) {
        this.climateEntityRef.turn_off();
        this.fanOnlyStartTime = 0;
      }
    }
  }
}
