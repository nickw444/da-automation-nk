import { TestRunner } from "@digital-alchemy/core";
import { LIB_HASS } from "@digital-alchemy/hass";
import { LIB_MOCK_ASSISTANT } from "@digital-alchemy/hass/mock-assistant";
import { NumberEntityWrapper } from "../number_entity_wrapper";

const runner = TestRunner()
  .appendLibrary(LIB_HASS)
  .appendLibrary(LIB_MOCK_ASSISTANT);

describe("NumberEntityWrapper", () => {
  it("should return correct state", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "number.charging_amps": { state: 8 },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("number.charging_amps");
        const wrapper = new NumberEntityWrapper(entityRef);
        
        expect(wrapper.state).toBe(8);
      });
  });

  it("should call set_value on the entity", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "number.charging_amps": { state: 8 },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("number.charging_amps");
        const wrapper = new NumberEntityWrapper(entityRef);
        
        const setValueSpy = vi.spyOn(hass.call.number, "set_value");
        wrapper.setValue(12);
        
        expect(setValueSpy).toHaveBeenCalledWith({
          entity_id: "number.charging_amps",
          value: 12,
        });
      });
  });

  it("should clamp values to min/max constraints", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "number.charging_amps": { state: 8 },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("number.charging_amps");
        const wrapper = new NumberEntityWrapper(entityRef);
        
        const setValueSpy = vi.spyOn(hass.call.number, "set_value");
        
        // Test min constraint (charging_amps has min: 0)
        wrapper.setValue(-5);
        expect(setValueSpy).toHaveBeenCalledWith({
          entity_id: "number.charging_amps",
          value: 0,
        });
        
        // Test max constraint (charging_amps has max: 16)
        wrapper.setValue(25);
        expect(setValueSpy).toHaveBeenCalledWith({
          entity_id: "number.charging_amps",
          value: 16,
        });
      });
  });

  it("should return correct attributes", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "number.charging_amps": { state: 8 },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("number.charging_amps");
        const wrapper = new NumberEntityWrapper(entityRef);
        
        const attributes = wrapper.attributes;
        
        // charging_amps has min: 0, max: 16, step: 1
        expect(attributes).toMatchObject({
          min: 0,
          max: 16,
          step: 1,
        });
      });
  });
});
