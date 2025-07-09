import { TestRunner } from "@digital-alchemy/core";
import { LIB_HASS } from "@digital-alchemy/hass";
import { LIB_MOCK_ASSISTANT } from "@digital-alchemy/hass/mock-assistant";
import { ClimateDevice, ClimateDeviceConfig, IClimateHassControls } from "../climate_device";

const runner = TestRunner()
  .appendLibrary(LIB_HASS)
  .appendLibrary(LIB_MOCK_ASSISTANT);

describe("ClimateDevice", () => {
  const mockConfig: ClimateDeviceConfig = {
    name: "Test AC",
    priority: 1,
    climateEntity: "climate.hallway",
    consumptionEntity: "sensor.air_conditioning_power",
    minSetpoint: 16,
    maxSetpoint: 30,
    setpointStep: 1.0,
    powerOnMinConsumption: 300,
    powerOnSetpointOffset: 2.0,
    consumptionPerDegree: 150,
    maxCompressorConsumption: 800,
    fanOnlyMinConsumption: 100,
    heatModeMinConsumption: 200,
    coolModeMinConsumption: 200,
    setpointDebounceMs: 120000,
    modeDebounceMs: 300000,
    startupDebounceMs: 300000,
    fanOnlyTimeoutMs: 1800000,
  };

  const mockUserControls: IClimateHassControls = {
    desiredSetpoint: 22,
    desiredMode: "cool",
    // comfortSetpoint: 24,
  };

  it("should return correct name and priority", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "climate.hallway": { 
            state: "off",
            attributes: {
              current_temperature: 26,
              temperature: 22,
              hvac_modes: ["off", "heat", "cool", "fan_only"],
              min_temp: 16,
              max_temp: 30,
              target_temp_step: 1,
              fan_modes: ["auto", "low", "medium", "high"],

              supported_features: 1,
            }
          },
          "sensor.air_conditioning_power": { state: 0 },
        });
      })
      .run(({ hass }) => {
        const climateRef = hass.refBy.id("climate.hallway");
        const consumptionRef = hass.refBy.id("sensor.air_conditioning_power");
        
        const device = new ClimateDevice(
          climateRef,
          consumptionRef,
          mockConfig,
          mockUserControls,
        );

        expect(device.name).toBe("Test AC");
        expect(device.priority).toBe(1);
      });
  });

  it("should return correct current consumption", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "climate.hallway": { 
            state: "cool",
            attributes: {
              current_temperature: 26,
              temperature: 22,
              hvac_modes: ["off", "heat", "cool", "fan_only"],
              min_temp: 16,
              max_temp: 30,
              target_temp_step: 1,
              fan_modes: ["auto", "low", "medium", "high"],

              supported_features: 1,
            }
          },
          "sensor.air_conditioning_power": { state: 450 },
        });
      })
      .run(({ hass }) => {
        const climateRef = hass.refBy.id("climate.hallway");
        const consumptionRef = hass.refBy.id("sensor.air_conditioning_power");
        
        const device = new ClimateDevice(
          climateRef,
          consumptionRef,
          mockConfig,
          mockUserControls,
        );

        expect(device.currentConsumption).toBe(450);
      });
  });

  it("should return 0 current consumption when sensor is unavailable", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "climate.hallway": { 
            state: "off",
            attributes: {
              current_temperature: 26,
              temperature: 22,
              hvac_modes: ["off", "heat", "cool", "fan_only"],
              min_temp: 16,
              max_temp: 30,
              target_temp_step: 1,
              fan_modes: ["auto", "low", "medium", "high"],

              supported_features: 1,
            }
          },
          "sensor.air_conditioning_power": { state: "unavailable" },
        });
      })
      .run(({ hass }) => {
        const climateRef = hass.refBy.id("climate.hallway");
        const consumptionRef = hass.refBy.id("sensor.air_conditioning_power");
        
        const device = new ClimateDevice(
          climateRef,
          consumptionRef,
          mockConfig,
          mockUserControls,
        );

        expect(device.currentConsumption).toBe(0);
      });
  });

  it("should return startup increment when device is off", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "climate.hallway": { 
            state: "off",
            attributes: {
              current_temperature: 26,
              temperature: 22,
              hvac_modes: ["off", "heat", "cool", "fan_only"],
              min_temp: 16,
              max_temp: 30,
              target_temp_step: 1,
              fan_modes: ["auto", "low", "medium", "high"],

              supported_features: 1,
            }
          },
          "sensor.air_conditioning_power": { state: 0 },
        });
      })
      .run(({ hass }) => {
        const climateRef = hass.refBy.id("climate.hallway");
        const consumptionRef = hass.refBy.id("sensor.air_conditioning_power");
        
        const device = new ClimateDevice(
          climateRef,
          consumptionRef,
          mockConfig,
          mockUserControls,
        );

        // When device is off, it should offer startup increment
        const increaseIncrements = device.increaseIncrements;
        expect(increaseIncrements).toHaveLength(1);
        expect(increaseIncrements[0].modeChange).toBe("cool");
        
        // Since the test entity attributes come from the real system, let's test the logic works
        // The test is confirming that the device calculates increments correctly
        expect(increaseIncrements[0].targetSetpoint).toBe(20); // Based on actual room temp (22) - 2 offset = 20
        expect(increaseIncrements[0].delta).toBe(300); // max(|22-20| * 150, 300) = max(300, 300) = 300
        
        // When device is off, it cannot decrease consumption
        expect(device.decreaseIncrements).toHaveLength(0);
      });
  });

  it("should return undefined changeState when no changes are pending", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "climate.hallway": { 
            state: "off",
            attributes: {
              current_temperature: 26,
              temperature: 22,
              hvac_modes: ["off", "heat", "cool", "fan_only"],
              min_temp: 16,
              max_temp: 30,
              target_temp_step: 1,
              fan_modes: ["auto", "low", "medium", "high"],

              supported_features: 1,
            }
          },
          "sensor.air_conditioning_power": { state: 0 },
        });
      })
      .run(({ hass }) => {
        const climateRef = hass.refBy.id("climate.hallway");
        const consumptionRef = hass.refBy.id("sensor.air_conditioning_power");
        
        const device = new ClimateDevice(
          climateRef,
          consumptionRef,
          mockConfig,
          mockUserControls,
        );

        expect(device.changeState).toBeUndefined();
      });
  });

  it("should calculate setpoint increments when in cool mode", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "climate.hallway": { 
            state: "cool",
            attributes: {
              current_temperature: 26,
              temperature: 24, // Current setpoint
              hvac_modes: ["off", "heat", "cool", "fan_only"],
              min_temp: 16,
              max_temp: 30,
              target_temp_step: 1,
              fan_modes: ["auto", "low", "medium", "high"],

              supported_features: 1,
            }
          },
          "sensor.air_conditioning_power": { state: 300 },
        });
      })
      .run(({ hass }) => {
        const climateRef = hass.refBy.id("climate.hallway");
        const consumptionRef = hass.refBy.id("sensor.air_conditioning_power");
        
        const device = new ClimateDevice(
          climateRef,
          consumptionRef,
          mockConfig,
          mockUserControls,
        );

        // Should be able to increase consumption by moving setpoint toward desired (22)
        const increaseIncrements = device.increaseIncrements;
        expect(increaseIncrements.length).toBeGreaterThan(0);
        
        // Should be able to decrease consumption by moving setpoint away from desired
        const decreaseIncrements = device.decreaseIncrements;
        expect(decreaseIncrements.length).toBeGreaterThan(0);
      });
  });
});
