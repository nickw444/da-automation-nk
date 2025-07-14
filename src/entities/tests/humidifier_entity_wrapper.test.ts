import { TestRunner } from "@digital-alchemy/core";
import { LIB_HASS } from "@digital-alchemy/hass";
import { LIB_MOCK_ASSISTANT } from "@digital-alchemy/hass/mock-assistant";
import { HumidifierEntityWrapper } from "../humidifier_entity_wrapper";

const runner = TestRunner()
  .appendLibrary(LIB_HASS)
  .appendLibrary(LIB_MOCK_ASSISTANT);

describe("HumidifierEntityWrapper", () => {
  it("should return correct state when on", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "humidifier.kogan_smart_dehumidifier": { state: "on" },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("humidifier.kogan_smart_dehumidifier");
        const wrapper = new HumidifierEntityWrapper(entityRef);
        
        expect(wrapper.state).toBe("on");
      });
  });

  it("should return correct state when off", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "humidifier.kogan_smart_dehumidifier": { state: "off" },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("humidifier.kogan_smart_dehumidifier");
        const wrapper = new HumidifierEntityWrapper(entityRef);
        
        expect(wrapper.state).toBe("off");
      });
  });

  it("should return undefined for unknown state", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "humidifier.kogan_smart_dehumidifier": { state: "unknown" },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("humidifier.kogan_smart_dehumidifier");
        const wrapper = new HumidifierEntityWrapper(entityRef);
        
        expect(wrapper.state).toBeUndefined();
      });
  });

  it("should return correct attributes", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "humidifier.kogan_smart_dehumidifier": {
            state: "on",
            attributes: {
              humidity: 50,
              min_humidity: 40,
              max_humidity: 80,
              mode: "Setting",
              available_modes: ["continuous"],
              device_class: "dehumidifier",
              friendly_name: "Kogan Smart Dehumidifier",
              supported_features: 1,
            },
          },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("humidifier.kogan_smart_dehumidifier");
        const wrapper = new HumidifierEntityWrapper(entityRef);
        
        expect(wrapper.attributes).toEqual({
          humidity: 50,
          min_humidity: 40,
          max_humidity: 80,
          mode: "Setting",
          available_modes: ["continuous"],
        });
      });
  });

  it("should call setHumidity on the entity", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "humidifier.kogan_smart_dehumidifier": { state: "on" },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("humidifier.kogan_smart_dehumidifier");
        const wrapper = new HumidifierEntityWrapper(entityRef);
        
        const setHumiditySpy = vi.spyOn(hass.call.humidifier, "set_humidity");
        wrapper.setHumidity(60);
        
        expect(setHumiditySpy).toHaveBeenCalledWith({
          entity_id: "humidifier.kogan_smart_dehumidifier",
          humidity: 60,
        });
      });
  });

  it("should call setMode on the entity", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "humidifier.kogan_smart_dehumidifier": { state: "on" },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("humidifier.kogan_smart_dehumidifier");
        const wrapper = new HumidifierEntityWrapper(entityRef);
        
        const setModeSpy = vi.spyOn(hass.call.humidifier, "set_mode");
        wrapper.setMode("continuous");
        
        expect(setModeSpy).toHaveBeenCalledWith({
          entity_id: "humidifier.kogan_smart_dehumidifier",
          mode: "continuous",
        });
      });
  });

  it("should call turn_on on the entity", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "humidifier.kogan_smart_dehumidifier": { state: "off" },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("humidifier.kogan_smart_dehumidifier");
        const wrapper = new HumidifierEntityWrapper(entityRef);
        
        const turnOnSpy = vi.spyOn(hass.call.humidifier, "turn_on");
        wrapper.turnOn();
        
        expect(turnOnSpy).toHaveBeenCalledWith({
          entity_id: "humidifier.kogan_smart_dehumidifier",
        });
      });
  });

  it("should call turn_off on the entity", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "humidifier.kogan_smart_dehumidifier": { state: "on" },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("humidifier.kogan_smart_dehumidifier");
        const wrapper = new HumidifierEntityWrapper(entityRef);
        
        const turnOffSpy = vi.spyOn(hass.call.humidifier, "turn_off");
        wrapper.turnOff();
        
        expect(turnOffSpy).toHaveBeenCalledWith({
          entity_id: "humidifier.kogan_smart_dehumidifier",
        });
      });
  });
});
