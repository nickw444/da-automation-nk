# Daytime Load Management Service

An intelligent solar load management system that automatically controls electrical devices based on solar production and grid consumption.

## Overview

The Daytime Load Management Service optimizes home energy consumption by automatically turning devices on/off based on excess solar power production. It prevents grid import while maximizing the use of free solar energy during the day.

## How It Works

### Core Concept
- **Monitors** solar production and grid power consumption in real-time
- **Activates** when sustained solar production exceeds the threshold for a configurable period
- **Manages** priority-based device switching to utilize excess solar power
- **Deactivates** when solar production drops below threshold for a configurable period

### Key Features

**Solar Production Tracking**
- Uses 1-minute averaged sensors for stable decision making (provided by Home Assistant)

**Priority-Based Load Management**
- Devices have configurable priorities (higher number = higher priority)
- Highest priority devices turn on first when excess solar is available
- Lowest priority devices turn off first during load shedding

**Intelligent Device Control**
- Gradual device activation (one device per cycle) to observe grid impact
- Devices have debounce periods prevent rapid on/off cycling
- Power reservation system prevents over-commitment of available capacity
- Immediate load shedding when grid import exceeds threshold

**Grid Protection**
- Monitors grid power threshold to prevent excessive import
- Automatically sheds loads when consumption exceeds limits

## Configuration

### Managed Devices
Devices are configured in [`config.ts`](file:///Users/nickw/repos/home/home-assistant/martin-pl/digitalalchemy/src/services/daytime-load/config.ts):

```typescript
{
  name: "towel_rail",           // Device identifier
  switchEntity: "switch.towel_rail",   // Home Assistant switch entity
  consumptionEntity: "sensor.towel_rail_current_consumption", // Optional power monitoring
  expectedPower: 80,            // Expected watts when on
  priority: 1                   // Priority (1 = lowest)
}
```

### Key Parameters
- **Production Threshold**: 500W (solar power needed to activate)
- **Debounce Period**: 15 minutes (time required for state changes)
- **Grid Threshold**: Configurable limit for grid import
- **Turn-on Delay**: Configurable debounce for device activation

## Architecture

The service consists of several key components:

- **[`service.ts`](./service.ts)** - Main orchestration and decision logic
- **[`device_load_manager.ts`](./device_load_manager.ts)** - Centralised device control and state management
- **[`*_device.ts`](./_device.ts)** - Individual device control and state management for different device types

### `device_load_manager.ts`

<TODO>: Explain high level load management algorithm </TODO>

## Benefits

- **Maximizes solar self-consumption** by automatically using excess production
- **Prevents grid import** through intelligent load management
- **Reduces electricity costs** by using free solar energy
- **Provides detailed monitoring** and logging for optimization

## Future Improvements

### Additional Device Support

- Setpoint Based Devices
  - Air Conditioners (Climate - Heat/Cool/Fan)
  - Dehumidifier (Humidity Setpoint/Fan)
- Direct Consumption Devices (e.g. EV Charger with "Charging Current" control)

### General Features

- Dynamic priorities
  - Min/Max runtime per day
  - Priority based on time of day
- Predictive scheduling
  - Based on solar production forecast
  - Based on weather forecast

