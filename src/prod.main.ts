import { METADATA_UNIQUE_ID, MY_APPLICATION } from "./application";

await MY_APPLICATION.bootstrap({
  configuration: {
    boilerplate: { LOG_LEVEL: "info" },
    synapse: {
      METADATA_UNIQUE_ID: METADATA_UNIQUE_ID,
    },
  }
});
