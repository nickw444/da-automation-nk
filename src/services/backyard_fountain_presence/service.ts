import { TServiceParams } from "@digital-alchemy/core";
import { IBooleanEntityWrapper, BooleanEntityWrapper } from "../../entities/boolean_entity_wrapper";
import { BinarySensorEntityWrapper, IBinarySensorEntityWrapper } from "../../entities/binary_sensor_entity_wrapper";
import { SimpleAutomation, SimpleAutomationHelper } from "../../base/simple_automation";

const PRESENCE_ON_DELAY_MS = 5 * 60 * 1000; // 5 minutes
const PRESENCE_OFF_DELAY_MS = 5 * 60 * 1000; // 5 minutes

export class BackyardFountainPresenceAutomation implements SimpleAutomation {
    private fountainOnTimer?: NodeJS.Timeout;
    private fountainOffTimer?: NodeJS.Timeout;
    private readonly unregisterCallbacks: (() => void)[] = [];

    constructor(
        private readonly logger: TServiceParams['logger'],
        private readonly fountainEntity: IBooleanEntityWrapper,
        private readonly deckPresenceEntity: IBinarySensorEntityWrapper,
        private readonly allPresenceEntities: IBinarySensorEntityWrapper[],
    ) {
        this.fountainEntity = fountainEntity;
        this.deckPresenceEntity = deckPresenceEntity;
        this.allPresenceEntities = allPresenceEntities;
    }

    setup(): void {
        // Monitor deck presence for turn-on logic
        const deckCallback = this.deckPresenceEntity.onUpdate((state) => {
            if (state !== undefined) {
                this.handleDeckPresenceChange();
            }
        });
        this.unregisterCallbacks.push(deckCallback);

        // Monitor all presence entities for turn-off logic
        this.allPresenceEntities.forEach(entity => {
            const callback = entity.onUpdate((state) => {
                if (state !== undefined) {
                    this.handleAnyPresenceChange();
                }
            });
            this.unregisterCallbacks.push(callback);
        });

        // Monitor fountain state changes (including manual overrides)
        const fountainCallback = this.fountainEntity.onUpdate((state) => {
            if (state !== undefined) {
                this.handleFountainStateChange();
            }
        });
        this.unregisterCallbacks.push(fountainCallback);
    }

    teardown(): void {
        this.clearFountainOnTimer();
        this.clearFountainOffTimer();
        this.unregisterCallbacks.forEach(callback => callback());
        this.unregisterCallbacks.length = 0;
    }

    private handleDeckPresenceChange(): void {
        if (this.deckPresenceEntity.state === "on") {
            // Deck presence detected - start timer to turn fountain on
            this.startFountainOnTimer();
        } else {
            // Deck presence gone - clear turn-on timer and check for turn-off
            this.clearFountainOnTimer();
            this.handleAnyPresenceChange();
        }
    }

    private handleAnyPresenceChange(): void {
        if (this.isAnyPresenceDetected()) {
            // Any presence detected - clear turn-off timer
            this.clearFountainOffTimer();
        } else {
            // No presence anywhere - start timer to turn fountain off
            this.startFountainOffTimer();
        }
    }

    private handleFountainStateChange(): void {
        // If fountain was manually turned on, monitor for auto turn-off
        if (this.fountainEntity.state === "on") {
            this.clearFountainOnTimer(); // Clear any pending turn-on
            this.handleAnyPresenceChange(); // Check if we should start turn-off timer
        } else {
            // Fountain turned off - clear all timers
            this.clearFountainOnTimer();
            this.clearFountainOffTimer();
        }
    }

    private startFountainOnTimer(): void {
        this.clearFountainOnTimer();
        this.logger.info(`Starting fountain on timer (${PRESENCE_ON_DELAY_MS / 1000 / 60} minutes)`);

        this.fountainOnTimer = setTimeout(() => {
            this.turnFountainOn();
            this.fountainOnTimer = undefined;
        }, PRESENCE_ON_DELAY_MS);
    }

    private startFountainOffTimer(): void {
        // Only start turn-off timer if fountain is currently on
        if (this.fountainEntity.state !== "on") {
            return;
        }

        this.clearFountainOffTimer();
        this.logger.info(`Starting fountain off timer (${PRESENCE_OFF_DELAY_MS / 1000 / 60} minutes)`);

        this.fountainOffTimer = setTimeout(() => {
            this.turnFountainOff();
            this.fountainOffTimer = undefined;
        }, PRESENCE_OFF_DELAY_MS);
    }

    private clearFountainOnTimer(): void {
        if (this.fountainOnTimer) {
            clearTimeout(this.fountainOnTimer);
            this.fountainOnTimer = undefined;
        }
    }

    private clearFountainOffTimer(): void {
        if (this.fountainOffTimer) {
            clearTimeout(this.fountainOffTimer);
            this.fountainOffTimer = undefined;
        }
    }

    private turnFountainOn(): void {
        this.logger.info('Turning fountain on due to presence');
        this.fountainEntity.turn_on();
    }

    private turnFountainOff(): void {
        this.logger.info('Turning fountain off due to no presence');
        this.fountainEntity.turn_off();
    }

    private isAnyPresenceDetected(): boolean {
        return this.allPresenceEntities.some(entity => entity.state === "on");
    }

    static create(params: TServiceParams): void {
        const { hass, logger } = params;
        const helper = new SimpleAutomationHelper("Backyard Fountain Presence", params);
        const automation = new BackyardFountainPresenceAutomation(
            logger,
            new BooleanEntityWrapper(hass.refBy.id('switch.front_garden_fountain')),
            new BinarySensorEntityWrapper(hass.refBy.id('binary_sensor.shed_fp2_presence_sensor_deck')),
            [
                new BinarySensorEntityWrapper(hass.refBy.id('binary_sensor.shed_fp2_presence_sensor_deck')),
                new BinarySensorEntityWrapper(hass.refBy.id('binary_sensor.back_yard_person_detected')),
                new BinarySensorEntityWrapper(hass.refBy.id('binary_sensor.shed_motion_occupancy')),
                new BinarySensorEntityWrapper(hass.refBy.id('binary_sensor.shed_fp2_presence_sensor_all_zones'))
            ]
        );
        helper.register(automation);
    }
}
