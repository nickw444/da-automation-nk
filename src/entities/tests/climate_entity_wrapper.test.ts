import { TestRunner } from "@digital-alchemy/core";
import { LIB_HASS } from "@digital-alchemy/hass";
import { LIB_MOCK_ASSISTANT } from "@digital-alchemy/hass/mock-assistant";
import { ClimateEntityWrapper } from "../climate_entity_wrapper";

const runner = TestRunner()
  .appendLibrary(LIB_HASS)
  .appendLibrary(LIB_MOCK_ASSISTANT);

describe("ClimateEntityWrapper", () => {
  it("should return correct state", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "climate.hallway": { state: "heat" },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("climate.hallway");
        const wrapper = new ClimateEntityWrapper(entityRef);
        
        expect(wrapper.state).toBe("heat");
      });
  });

  it("should return room temperature", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "climate.hallway": { 
            state: "heat",
            attributes: { 
              current_temperature: 22,
              temperature: 20,
              min_temp: 16,
              max_temp: 30,
              hvac_modes: ["off", "heat", "cool"],
              target_temp_step: 1,
              fan_modes: ["auto", "low"],
              swing_modes: ["off"],
              fan_mode: "auto",
              swing_mode: "off",
              friendly_name: "Hallway AC",
              supported_features: 1
            }
          },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("climate.hallway");
        const wrapper = new ClimateEntityWrapper(entityRef);
        
        expect(wrapper.roomTemperature).toBe(22);
      });
  });

  it("should return target temperature", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "climate.hallway": { 
            state: "heat",
            attributes: { 
              temperature: 26,
              current_temperature: 22,
              min_temp: 16,
              max_temp: 30,
              hvac_modes: ["off", "heat", "cool"],
              target_temp_step: 1,
              fan_modes: ["auto", "low"],
              swing_modes: ["off"],
              fan_mode: "auto",
              swing_mode: "off",
              friendly_name: "Hallway AC",
              supported_features: 1
            }
          },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("climate.hallway");
        const wrapper = new ClimateEntityWrapper(entityRef);
        
        expect(wrapper.targetTemperature).toBe(26);
      });
  });

  it("should return essential attributes", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "climate.hallway": { 
            state: "heat",
            attributes: {
              current_temperature: 22,
              temperature: 26,
              min_temp: 16,
              max_temp: 30,
              hvac_modes: ["off", "heat_cool", "cool", "heat", "fan_only", "dry"],
              target_temp_step: 1,
              fan_modes: ["auto", "low"],
              swing_modes: ["off"],
              fan_mode: "auto",
              swing_mode: "off",
              friendly_name: "Hallway AC",
              supported_features: 1
            }
          },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("climate.hallway");
        const wrapper = new ClimateEntityWrapper(entityRef);
        
        expect(wrapper.attributes).toEqual({
          current_temperature: 22,
          temperature: 26,
          min_temp: 16,
          max_temp: 30,
          hvac_modes: ["off", "heat_cool", "cool", "heat", "fan_only", "dry"]
        });
      });
  });

  it("should call set_temperature service with temperature only", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "climate.hallway": { state: "heat" },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("climate.hallway");
        const wrapper = new ClimateEntityWrapper(entityRef);
        
        // Spy on the service call
        const setTempSpy = vi.spyOn(hass.call.climate, "set_temperature");
        wrapper.setTemperature({ temperature: 24 });
        
        expect(setTempSpy).toHaveBeenCalledWith({
          entity_id: "climate.hallway",
          temperature: 24,
        });
      });
  });

  it("should call set_temperature service with temperature and hvac_mode", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "climate.hallway": { state: "heat" },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("climate.hallway");
        const wrapper = new ClimateEntityWrapper(entityRef);
        
        // Spy on the service call
        const setTempSpy = vi.spyOn(hass.call.climate, "set_temperature");
        wrapper.setTemperature({ temperature: 22, hvac_mode: "cool" });
        
        expect(setTempSpy).toHaveBeenCalledWith({
          entity_id: "climate.hallway",
          temperature: 22,
          hvac_mode: "cool",
        });
      });
  });

  it("should call set_hvac_mode service", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "climate.hallway": { state: "heat" },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("climate.hallway");
        const wrapper = new ClimateEntityWrapper(entityRef);
        
        // Spy on the service call
        const setModeSpy = vi.spyOn(hass.call.climate, "set_hvac_mode");
        wrapper.setHvacMode("cool");
        
        expect(setModeSpy).toHaveBeenCalledWith({
          entity_id: "climate.hallway",
          hvac_mode: "cool",
        });
      });
  });

  it("should call turn_off service", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "climate.hallway": { state: "heat" },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("climate.hallway");
        const wrapper = new ClimateEntityWrapper(entityRef);
        
        // Spy on the service call
        const turnOffSpy = vi.spyOn(hass.call.climate, "turn_off");
        wrapper.turnOff();
        
        expect(turnOffSpy).toHaveBeenCalledWith({
          entity_id: "climate.hallway",
        });
      });
  });
});
