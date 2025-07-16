import { TServiceParams } from "@digital-alchemy/core";
import { toSnakeCase } from "../../../base/snake_case";
import { GenericSynapseEntity } from "@digital-alchemy/synapse";

export interface IBaseHassControls {
    // if enabled, no management actions will be performed for this device.
    managementEnabled: boolean;
}

export class BaseHassControls implements IBaseHassControls {
    readonly subDevice: ReturnType<TServiceParams["synapse"]["device"]["register"]>
    
    // This is crude.
    private readonly enableSystemSwitch: { is_on: boolean };

    constructor(
        name: string,
        logger: TServiceParams["logger"],
        synapse: TServiceParams["synapse"],
        context: TServiceParams["context"],
    ) {
        this.subDevice = synapse.device.register("daytime_load_" + toSnakeCase(name), {
            name: "Daytime Load " + name,
        });
    
        const enableSystemSwitch = synapse.switch({
            context,
            name: "Daytime Load " + name + " Management Enabled",
            unique_id: "daytime_load_" + toSnakeCase(name) + "_management_enabled",
            suggested_object_id: "daytime_load_" + toSnakeCase(name) + "_management_enabled",
        });
        enableSystemSwitch.onUpdate((newState) => {
            if (newState.state === 'unknown') {
                logger.warn("Daytime Load " + name + " Management Enabled is unknown/initial, setting to true");
                enableSystemSwitch.is_on = true;
            }
        });
        
    }

    get managementEnabled(): boolean {
        return this.enableSystemSwitch.is_on;
    }
}
