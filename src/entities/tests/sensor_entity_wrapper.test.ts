import { TestRunner } from "@digital-alchemy/core";
import { LIB_HASS } from "@digital-alchemy/hass";
import { LIB_MOCK_ASSISTANT } from "@digital-alchemy/hass/mock-assistant";
import { SensorEntityWrapper } from "../sensor_entity_wrapper";

const runner = TestRunner()
  .appendLibrary(LIB_HASS)
  .appendLibrary(LIB_MOCK_ASSISTANT);

describe("SensorEntityWrapper", () => {
  it("should return correct state", async () => {
    await runner
      .bootLibrariesFirst()
      .setup(({ mock_assistant }) => {
        mock_assistant.entity.setupState({
          "sensor.subfloor_fan_current_consumption": { state: 42 },
        });
      })
      .run(({ hass }) => {
        const entityRef = hass.refBy.id("sensor.subfloor_fan_current_consumption");
        const wrapper = new SensorEntityWrapper(entityRef);
        
        expect(wrapper.state).toBe(42);
      });
  });
});
