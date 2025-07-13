import { TestRunner } from "@digital-alchemy/core";
import { LIB_HASS } from "@digital-alchemy/hass";
import { LIB_MOCK_ASSISTANT } from "@digital-alchemy/hass/mock-assistant";
import { BinarySensorEntityWrapper } from "../binary_sensor_entity_wrapper";

const runner = TestRunner()
  .appendLibrary(LIB_HASS)
  .appendLibrary(LIB_MOCK_ASSISTANT);

describe("BinarySensorEntityWrapper", () => {
  it("should return correct state when on", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "binary_sensor.internal_motion_occupancy": { state: "on" },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("binary_sensor.internal_motion_occupancy");
        const wrapper = new BinarySensorEntityWrapper(entityRef);
        
        expect(wrapper.state).toBe("on");
      });
  });

  it("should return correct state when off", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "binary_sensor.internal_motion_occupancy": { state: "off" },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("binary_sensor.internal_motion_occupancy");
        const wrapper = new BinarySensorEntityWrapper(entityRef);
        
        expect(wrapper.state).toBe("off");
      });
  });


});
