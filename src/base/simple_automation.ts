import { ILogger, TServiceParams } from "@digital-alchemy/core";
import { toSnakeCase } from "./snake_case";

export interface SimpleAutomation {
  setup(): void;
  teardown(): void;
}

export class SimpleAutomationHelper {
  public readonly subDevice: ReturnType<
    TServiceParams["synapse"]["device"]["register"]
  >;

  // private automationEnabledSwitch: ReturnType<TServiceParams["synapse"]["switch"]>
  private automationEnabledSwitch: {
    onUpdate: (
      cb: (
        newState: { state: string | number },
        oldState: { state: string | number },
      ) => void,
    ) => void;
  };

  private isRegistered: boolean = false;
  private isSetup: boolean = false;
  private logger: ILogger;

  constructor(
    protected readonly name: string,
    params: Pick<TServiceParams, "synapse" | "context" | "logger">,
  ) {
    const { synapse, context, logger } = params;
    this.logger = logger;

    this.subDevice = synapse.device.register(
      "da_automation_" + toSnakeCase(name),
      {
        name: "DA Automation " + name,
      },
    );
    this.automationEnabledSwitch = synapse.switch({
      context,
      device_id: this.subDevice,
      name: "DA Automation " + name + " Enabled",
      unique_id: "da_automation_" + toSnakeCase(name) + "_enabled",
      suggested_object_id: "da_automation_" + toSnakeCase(name) + "_enabled",
      icon: "mdi:cog",
      is_on: true,
    });
  }

  public register(automation: SimpleAutomation): void {
    if (this.isRegistered) {
      throw new Error("Automation already registered");
    }

    this.automationEnabledSwitch.onUpdate((newState) => {
      if (newState.state == "on") {
        if (!this.isSetup) {
          this.logger.info("Enabling automation: %s", this.name);
          automation.setup();
          this.isSetup = true;
        }
      } else {
        if (this.isSetup) {
          this.logger.info("Disabling automation: %s", this.name);
          automation.teardown();
          this.isSetup = false;
        }
      }
    });
  }
}
