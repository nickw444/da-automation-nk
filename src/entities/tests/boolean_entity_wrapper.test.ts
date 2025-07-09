import { TestRunner } from "@digital-alchemy/core";
import { LIB_HASS } from "@digital-alchemy/hass";
import { LIB_MOCK_ASSISTANT } from "@digital-alchemy/hass/mock-assistant";
import { BooleanEntityWrapper } from "../boolean_entity_wrapper";

const runner = TestRunner()
  .appendLibrary(LIB_HASS)
  .appendLibrary(LIB_MOCK_ASSISTANT);

describe("BooleanEntityWrapper", () => {
  it("should return correct state", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "switch.subfloor_fan": { state: "on" },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("switch.subfloor_fan");
        const wrapper = new BooleanEntityWrapper(entityRef);
        
        expect(wrapper.state).toBe("on");
      });
  });

  it("should call turn_on on the entity", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "switch.subfloor_fan": { state: "off" },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("switch.subfloor_fan");
        const wrapper = new BooleanEntityWrapper(entityRef);
        
        const turnOnSpy = vi.spyOn(hass.call.switch, "turn_on");
        wrapper.turn_on();
        
        expect(turnOnSpy).toHaveBeenCalledWith({
          entity_id: "switch.subfloor_fan",
        });
      });
  });

  it("should call turn_off on the entity", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "switch.subfloor_fan": { state: "on" },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("switch.subfloor_fan");
        const wrapper = new BooleanEntityWrapper(entityRef);
        
        const turnOffSpy = vi.spyOn(hass.call.switch, "turn_off");
        wrapper.turn_off();
        
        expect(turnOffSpy).toHaveBeenCalledWith({
          entity_id: "switch.subfloor_fan",
        });
      });
  });
});
