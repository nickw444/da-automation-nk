# Climate Device Specification

## Overview

Climate devices (air conditioners, heat pumps) represent a more complex load management challenge compared to simple boolean devices. They offer variable power consumption through temperature setpoint adjustments and multiple operating modes.

**Design Assumptions:**
- **Single Zone Systems**: Each climate device manages one zone independently
- **Manual Mode Selection**: Users manually set desired mode (heat/cool) via `User Desired Mode` input based on season - no automatic seasonal behavior adaptation

## Temperature Terminology

To avoid confusion, this specification uses the following temperature terminology consistently:

- **User Desired Setpoint**: Target temperature the user actually wants to achieve
- **User Comfort Setpoint**: Optional boundary temperature the user is willing to accept for load management:
  - For cooling mode: Maximum allowed temperature (warmer than desired)
  - For heating mode: Minimum allowed temperature (cooler than desired)
- **Current Room Temperature**: Actual measured temperature in the room from climate entity sensor
- **Device Setpoint**: The actual target setpoint configured on the underlying air conditioner/climate device

## Control Architecture

### User Control Interface
- **User Desired Setpoint**: Target temperature the user actually wants to achieve (provided via Home Assistant entity)
- **User Desired Mode**: Heat or Cool mode provided via Home Assistant entity
- **User Comfort Setpoint**: Optional boundary temperature for load management (provided via Home Assistant entity)

### Device Control Logic
- **Device Setpoint**: System adjusts the actual climate entity setpoint relative to user desired setpoint (within comfort bounds if specified)
- **Operating Mode**: Device sets climate entity mode based on desired mode, but may cycle to fan-only mode for greater load shedding (only when user comfort setpoint not set)

### Control Constraints
- Minimum and maximum temperature setpoints (typically 16-30°C)
- Heat/cool/fan-only modes assumed to be available for all climate devices

## IBaseDevice Interface Implementation

### Current Consumption
- Real-time power usage from consumption sensor (always available)

### Consumption Increments

**Increase Increments**: Power consumption increases (in Watts) calculated using blended scaling approach
- **Calculation method**: Scales actual current consumption based on temperature differential ratios, blended with linear model estimates
- **When device is off**: Uses startup power calculation with clamped setpoint and minimum baseline
- **Direction**: Move device setpoint closer to user desired setpoint (more aggressive heating/cooling)
- **Constraints**: 
  - Limited by reaching user desired setpoint and absolute temperature bounds
  - Consumption capped at `maxCompressorConsumption`. Omit duplicate entries with the same delta value.
- **Realistic estimates**: Leverages actual device performance under current conditions rather than pure theoretical calculations

**Decrease Increments**: Power consumption decreases (in Watts) calculated using blended scaling approach  
- **Calculation method**: Scales actual current consumption based on temperature differential ratios, with mode-specific minimum consumption floors
- **Direction**: Move device setpoint away from user desired setpoint (less aggressive heating/cooling)
- **Constraints**:
  - Limited by user comfort setpoint (if specified) or absolute temperature bounds
  - Consumption floored at mode-specific minimums (`heatModeMinConsumption`, `coolModeMinConsumption`, `fanOnlyMinConsumption`)
  - Fan-only mode available only when no user comfort setpoint specified
- **Reality check**: If room temperature has reached device setpoint, actual consumption may already be near minimum, limiting available decreases
- **Adaptive calculation**: Uses real device performance to predict realistic consumption reductions rather than theoretical estimates

### Change State Management
- Track pending setpoint changes during HVAC response time (1-2 minutes for compressor to ramp up/spin down)
- Implement debounce periods between setpoint adjustments
- Handle transition states when HVAC system is responding to new setpoint to prevent additional changes while consumption is still adjusting

## Power Estimation Strategy

### Available Data Sources
- **Current Room Temperature**: Available from climate entity's room temperature attribute (actual temperature the climate device is operating within)
- **Real-time Consumption**: From dedicated consumption sensor
- **User Controls**: Desired setpoint, mode, and optional user comfort setpoint

### Estimation Approach
- Use real-time consumption data as baseline for all power calculations
- **Naive estimation approach**: System self-optimizes over time through iterative increase/decrease calls until steady state
- **Simple calculation factors**:
  - Delta between current device setpoint and next proposed setpoint
  - Delta between current room temperature and current device setpoint
  - Blend with current actual consumption as baseline
- **Configurable consumption rates**: Use `consumptionPerDegree` to calculate power based on setpoint delta from room temperature
- **Maximum capacity handling**: Cap consumption at `maxCompressorConsumption` when differential > 3°C (full compressor speed)
- **Critical for decrease increments**: If current room temperature has reached/exceeded device setpoint, device may already be at low consumption (<100W), limiting available power decreases
- **Simple calculation**: `consumption = min(|roomTemp - deviceSetpoint| * consumptionPerDegree, maxCompressorConsumption)`

### Algorithm Steps

**Calculate Increment Arrays** (for `increaseIncrements` and `decreaseIncrements` properties):
1. Get user desired setpoint, mode, and user comfort setpoint (if specified) from user controls
2. Get current device setpoint and current room temperature from climate entity
3. Calculate available setpoint adjustments (increase: toward desired, decrease: away from desired)
4. Apply constraints (comfort bounds, min/max limits, mode availability)
5. **Apply maximum capacity constraint**: For increase increments, exclude setpoint changes if temperature differential already > 3°C
6. For each possible adjustment, create increment object containing:
   - `delta`: Estimated power consumption change (in Watts)
   - `targetSetpoint`: Absolute target setpoint for the adjustment
   - `setpointChange`: Relative change from current setpoint
   - `modeChange`: Mode switch operation (if applicable)
7. Return arrays of `ClimateIncrement` objects

### Increment Calculation Formulas

**Startup Power (Device Off):**
```
clampedSetpoint = clamp(roomTemp ± powerOnSetpointOffset, comfortSetpoint, desiredSetpoint)
startupDelta = max(|roomTemp - clampedSetpoint| × consumptionPerDegree, powerOnMinConsumption)
```

**Increment Delta Calculation (Generic):**
```
actualCurrentConsumption = getCurrentConsumption()  // from sensor
currentDifferential = |roomTemp - currentSetpoint|
targetDifferential = |roomTemp - targetSetpoint|

// Scale actual consumption based on temperature differential ratio
scaledConsumption = actualCurrentConsumption × (targetDifferential / currentDifferential)

// Linear model estimate with bounds
if (targetDifferential > currentDifferential) {
    // Increase: cap at maximum
    linearEstimate = min(targetDifferential × consumptionPerDegree, maxCompressorConsumption)
} else {
    // Decrease: floor at minimum
    modeMinConsumption = (targetMode === "fan") ? fanOnlyMinConsumption : 
                        (targetMode === "heat") ? heatModeMinConsumption : coolModeMinConsumption
    linearEstimate = max(targetDifferential × consumptionPerDegree, modeMinConsumption)
}

// Blend the two approaches and apply final bounds
blendedConsumption = blend(scaledConsumption, linearEstimate)
finalTargetConsumption = clamp(blendedConsumption, modeMinConsumption, maxCompressorConsumption)

// Calculate delta (positive indicates direction of change)
delta = finalTargetConsumption - actualCurrentConsumption
```

**Helper Functions:**
```
blend(scaledValue, linearValue) → weightedAverage
    // Combines scaled consumption with linear estimate (e.g., 70% scaled + 30% linear)
    // Purpose: Balance real-world performance with theoretical model

clamp(value, min, max) → constrainedValue  
    // Constrains value between min and max bounds
    // Purpose: Enforce physical device consumption limits
```

**Increase Consumption** (when called with `ClimateIncrement` object):
1. Apply the encoded action directly:
   - If `modeChange` from off: Set initial device setpoint using `powerOnSetpointOffset` from current room temperature toward user desired setpoint
   - If `modeChange` specified: Switch from fan-only to heat/cool mode
   - If `targetSetpoint` specified: Set device to absolute setpoint
   - If `setpointChange` specified: Adjust device setpoint relatively
2. Record state change and initiate debounce period

**Decrease Consumption** (when called with `ClimateIncrement` object):
1. Apply the encoded action directly:
   - If `modeChange` specified: Switch to fan-only mode
   - If `targetSetpoint` specified: Set device to absolute setpoint
   - If `setpointChange` specified: Adjust device setpoint relatively
2. Record state change and initiate debounce period

### Initial Setpoint Strategy

When turning the device on from completely off state:
- **Calculate initial setpoint**: Current room temperature ± `powerOnSetpointOffset` in direction of user desired setpoint
- **Example (heating)**: Room 22°C, desired 28°C, offset 2°C → initial device setpoint 24°C (22 + 2)
- **Example (cooling)**: Room 26°C, desired 20°C, offset 2°C → initial device setpoint 24°C (26 - 2)
- **Power-on consumption**: Calculated using `|roomTemp - clampedSetpoint| * consumptionPerDegree`, with `powerOnMinConsumption` as minimum baseline
- **Rationale**: Conservative startup that moves toward user preference without being overly aggressive

**Integration with Increments:**
- The calculated power-on consumption becomes the increment advertised in `increaseIncrements` when device is off
- **Example (no clamping)**: Room 26°C, desired 20°C, offset 2°C → setpoint 24°C, delta = max(|26-24| * 150, 300) = max(300W, 300W) = 300W
- **Example (with clamping)**: Room 26°C, desired 20°C, comfort 22°C, offset 2°C → setpoint clamped to 22°C, delta = max(|26-22| * 150, 300) = max(600W, 300W) = 600W



## State Management & Timing

### Debounce Requirements
- **Setpoint Changes**: 2-5 minute debounce between adjustments
- **Mode Changes**: Longer debounce (5-10 minutes) for mode switching between heat/cool/fan
- **Startup from Off**: Extended debounce (5-10 minutes) when transitioning from off to heat/cool mode for device ramp-up
- **System Response Time**: Account for HVAC lag (1-2 minutes) for compressor to ramp up/spin down and reach new consumption levels
- **Pending State Management**: Prevent additional setpoint changes while system is transitioning to avoid over-commitment of load adjustments

### Automatic Off Timeout
- **Fan-Only Timeout**: After configured period in fan-only mode (e.g., 30-60 minutes), device automatically turns completely off
- **No Explicit Off Control**: Load management never explicitly turns device off - progression is heat/cool → fan-only → automatic timeout
- **Startup Detection**: Device detects off state and advertises startup increment when load management can allocate power

### Physical Response Characteristics
- Power consumption varies based on temperature setpoint and current ambient conditions
- Consumption increases when setpoint moves further from ambient temperature
- Different consumption patterns for heating vs cooling modes
- HVAC systems require 1-2 minutes to respond to setpoint changes

## Implementation Configuration

```typescript
interface IClimateHassControls {
  desiredSetpoint: number;        // User's target temperature
  desiredMode: "heat" | "cool";   // User's desired operating mode
  comfortSetpoint?: number;       // Optional comfort boundary temperature
}

interface ClimateDeviceConfig {
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
  powerOnSetpointOffset: number;  // 2.0 (degrees offset from room temp toward desired mode, clamped between desired and comfort setpoints)
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

// Note: IClimateHassControls instance passed separately to constructor, not part of config
```


