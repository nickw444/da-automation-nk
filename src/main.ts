import { CreateApplication } from "@digital-alchemy/core";
import { LIB_HASS } from "@digital-alchemy/hass";
import { LIB_SYNAPSE } from "@digital-alchemy/synapse";
import { LIB_AUTOMATION } from "@digital-alchemy/automation";
import { DaytimeLoadService } from "./services/daytime_load/service";

export const MY_APPLICATION = CreateApplication({
  name: "da_automation",
  libraries: [LIB_HASS, LIB_SYNAPSE, LIB_AUTOMATION],
  services: {
    daytimeLoad: DaytimeLoadService,
  },
  configuration: {
  },
});

declare module "@digital-alchemy/core" {
  export interface LoadedModules {
    da_automation: typeof MY_APPLICATION;
  }
}

await MY_APPLICATION.bootstrap();
