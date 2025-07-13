import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DirectConsumptionDevice, DirectConsumptionDeviceOptions } from "../direct_consumption_device";
import { MockNumberEntityWrapper } from "../../../../entities/number_entity_wrapper";
import { MockSensorEntityWrapper } from "../../../../entities/sensor_entity_wrapper";
import { MockBooleanEntityWrapper } from "../../../../entities/boolean_entity_wrapper";

describe("DirectConsumptionDevice", () => {
    let mockCurrentEntity: MockNumberEntityWrapper;
    let mockConsumptionEntity: MockSensorEntityWrapper;
    let mockVoltageEntity: MockSensorEntityWrapper;
    let mockEnableEntity: MockBooleanEntityWrapper;
    let config: DirectConsumptionDeviceOptions;
    let device: DirectConsumptionDevice;

    beforeEach(() => {
        mockCurrentEntity = {
            state: 0,
            attributes: { min: 0, max: 20, step: 0.5 },
            setValue: vi.fn(),
        };
        
        mockConsumptionEntity = {
            state: 0,
        };
        
        mockVoltageEntity = {
            state: 240, // Standard voltage
        };
        
        mockEnableEntity = {
            state: "off",
            turn_on: vi.fn(),
            turn_off: vi.fn(),
        };

        config = {
            startingMinCurrent: 4.0,        // 4A minimum to start
            maxCurrent: 16.0,               // 16A maximum
            currentStep: 1.0,               // 1A steps
            debounceMs: 30000,              // 30 second debounce
            stoppingThreshold: 2.0,         // Stop below 2A
            stoppingTimeoutMs: 60000,       // 1 minute timeout
        };

        device = new DirectConsumptionDevice(
            "Test Direct Consumption Device",
            1,
            mockCurrentEntity,
            mockConsumptionEntity,
            mockVoltageEntity,
            mockEnableEntity,
            config,
        );
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("Basic Properties", () => {
        it("should return correct name", () => {
            expect(device.name).toBe("Test Direct Consumption Device");
        });

        it("should return correct priority", () => {
            expect(device.priority).toBe(1);
        });

        it("should return correct current consumption", () => {
            mockConsumptionEntity.state = 1200;
            expect(device.currentConsumption).toBe(1200);
        });

        it("should return 0 for current consumption when sensor is unavailable", () => {
            mockConsumptionEntity.state = "unavailable";
            expect(device.currentConsumption).toBe(0);
        });

        it("should return actual consumption from sensor even when it differs from theoretical current × voltage", () => {
            mockCurrentEntity.state = 10.0; // Current setting is 10A
            mockVoltageEntity.state = 240; // Voltage is 240V (theoretical: 10A × 240V = 2400W)
            mockConsumptionEntity.state = 1800; // But actual consumption is only 1800W

            // Should return the actual sensor reading, not the theoretical calculation
            expect(device.currentConsumption).toBe(1800);
        });
    });

    describe("Increase Increments", () => {
        it("should return enable increments for all current levels when device is disabled", () => {
            mockEnableEntity.state = "off";
            mockCurrentEntity.state = 0;
            mockVoltageEntity.state = 240;

            const increments = device.increaseIncrements;

            // Should offer all possible current levels from startingMinCurrent (4A) to maxCurrent (16A)
            expect(increments).toEqual([
                { delta: 960, action: "enable", targetCurrent: 4.0 }, // 4A * 240V = 960W
                { delta: 1200, action: "enable", targetCurrent: 5.0 }, // 5A * 240V = 1200W
                { delta: 1440, action: "enable", targetCurrent: 6.0 }, // 6A * 240V = 1440W
                { delta: 1680, action: "enable", targetCurrent: 7.0 }, // 7A * 240V = 1680W
                { delta: 1920, action: "enable", targetCurrent: 8.0 }, // 8A * 240V = 1920W
                { delta: 2160, action: "enable", targetCurrent: 9.0 }, // 9A * 240V = 2160W
                { delta: 2400, action: "enable", targetCurrent: 10.0 }, // 10A * 240V = 2400W
                { delta: 2640, action: "enable", targetCurrent: 11.0 }, // 11A * 240V = 2640W
                { delta: 2880, action: "enable", targetCurrent: 12.0 }, // 12A * 240V = 2880W
                { delta: 3120, action: "enable", targetCurrent: 13.0 }, // 13A * 240V = 3120W
                { delta: 3360, action: "enable", targetCurrent: 14.0 }, // 14A * 240V = 3360W
                { delta: 3600, action: "enable", targetCurrent: 15.0 }, // 15A * 240V = 3600W
                { delta: 3840, action: "enable", targetCurrent: 16.0 }, // 16A * 240V = 3840W
            ]);
        });

        it("should return current step increments when device is enabled", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 4.0; // Currently at starting minimum
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 960; // 4A * 240V

            const increments = device.increaseIncrements;

            // Should generate increments: 5A, 6A, 7A, etc. up to maxCurrent
            expect(increments).toEqual([
                { delta: 240, targetCurrent: 5.0 }, // (5.0 * 240) - 960 = 240W
                { delta: 480, targetCurrent: 6.0 }, // (6.0 * 240) - 960 = 480W
                { delta: 720, targetCurrent: 7.0 }, // (7.0 * 240) - 960 = 720W
                { delta: 960, targetCurrent: 8.0 }, // (8.0 * 240) - 960 = 960W
                { delta: 1200, targetCurrent: 9.0 }, // (9.0 * 240) - 960 = 1200W
                { delta: 1440, targetCurrent: 10.0 }, // (10.0 * 240) - 960 = 1440W
                { delta: 1680, targetCurrent: 11.0 }, // (11.0 * 240) - 960 = 1680W
                { delta: 1920, targetCurrent: 12.0 }, // (12.0 * 240) - 960 = 1920W
                { delta: 2160, targetCurrent: 13.0 }, // (13.0 * 240) - 960 = 2160W
                { delta: 2400, targetCurrent: 14.0 }, // (14.0 * 240) - 960 = 2400W
                { delta: 2640, targetCurrent: 15.0 }, // (15.0 * 240) - 960 = 2640W
                { delta: 2880, targetCurrent: 16.0 }, // (16.0 * 240) - 960 = 2880W
            ]);
        });

        it("should return empty array when already at maximum current", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 16.0; // At maximum
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 3840; // 16A * 240V

            const increments = device.increaseIncrements;

            expect(increments).toEqual([]);
        });

        it("should return empty array when already at maximum current but actual consumption is lower", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 16.0; // At maximum
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 1920;

            const increments = device.increaseIncrements;

            expect(increments).toEqual([]);
        });

        it("should handle different voltage levels correctly", () => {
            mockEnableEntity.state = "off";
            mockCurrentEntity.state = 0;
            mockVoltageEntity.state = 120; // Lower voltage

            const increments = device.increaseIncrements;

            // Should offer all current levels but with lower voltage calculations
            expect(increments).toEqual([
                { delta: 480, action: "enable", targetCurrent: 4.0 }, // 4A * 120V = 480W
                { delta: 600, action: "enable", targetCurrent: 5.0 }, // 5A * 120V = 600W
                { delta: 720, action: "enable", targetCurrent: 6.0 }, // 6A * 120V = 720W
                { delta: 840, action: "enable", targetCurrent: 7.0 }, // 7A * 120V = 840W
                { delta: 960, action: "enable", targetCurrent: 8.0 }, // 8A * 120V = 960W
                { delta: 1080, action: "enable", targetCurrent: 9.0 }, // 9A * 120V = 1080W
                { delta: 1200, action: "enable", targetCurrent: 10.0 }, // 10A * 120V = 1200W
                { delta: 1320, action: "enable", targetCurrent: 11.0 }, // 11A * 120V = 1320W
                { delta: 1440, action: "enable", targetCurrent: 12.0 }, // 12A * 120V = 1440W
                { delta: 1560, action: "enable", targetCurrent: 13.0 }, // 13A * 120V = 1560W
                { delta: 1680, action: "enable", targetCurrent: 14.0 }, // 14A * 120V = 1680W
                { delta: 1800, action: "enable", targetCurrent: 15.0 }, // 15A * 120V = 1800W
                { delta: 1920, action: "enable", targetCurrent: 16.0 }, // 16A * 120V = 1920W
            ]);
        });

        it("should return single increment when near maximum current", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 15.0; // Near maximum, only 1A step possible
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 3600; // 15A * 240V

            const increments = device.increaseIncrements;

            expect(increments).toEqual([
                { delta: 240, targetCurrent: 16.0 }, // (16.0 * 240) - 3600 = 240W
            ]);
        });

        it("should use default voltage when voltage sensor unavailable", () => {
            mockEnableEntity.state = "off";
            mockCurrentEntity.state = 0;
            mockVoltageEntity.state = "unavailable";

            const increments = device.increaseIncrements;

            // Should offer all current levels using default voltage (240V)
            expect(increments).toEqual([
                { delta: 960, action: "enable", targetCurrent: 4.0 }, // 4A * 240V = 960W
                { delta: 1200, action: "enable", targetCurrent: 5.0 }, // 5A * 240V = 1200W
                { delta: 1440, action: "enable", targetCurrent: 6.0 }, // 6A * 240V = 1440W
                { delta: 1680, action: "enable", targetCurrent: 7.0 }, // 7A * 240V = 1680W
                { delta: 1920, action: "enable", targetCurrent: 8.0 }, // 8A * 240V = 1920W
                { delta: 2160, action: "enable", targetCurrent: 9.0 }, // 9A * 240V = 2160W
                { delta: 2400, action: "enable", targetCurrent: 10.0 }, // 10A * 240V = 2400W
                { delta: 2640, action: "enable", targetCurrent: 11.0 }, // 11A * 240V = 2640W
                { delta: 2880, action: "enable", targetCurrent: 12.0 }, // 12A * 240V = 2880W
                { delta: 3120, action: "enable", targetCurrent: 13.0 }, // 13A * 240V = 3120W
                { delta: 3360, action: "enable", targetCurrent: 14.0 }, // 14A * 240V = 3360W
                { delta: 3600, action: "enable", targetCurrent: 15.0 }, // 15A * 240V = 3600W
                { delta: 3840, action: "enable", targetCurrent: 16.0 }, // 16A * 240V = 3840W
            ]);
        });

        it("should calculate deltas based on theoretical power change, not actual consumption sensor", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 8.0; // Current setting is 8A
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 1600; // Actual consumption sensor shows 1600W (lagging)

            const increments = device.increaseIncrements;

            // Deltas should model theoretical power change from current setting change
            expect(increments).toEqual([
                { delta: 240, targetCurrent: 9.0 }, // (9.0 * 240) - (8.0 * 240) = 240W
                { delta: 480, targetCurrent: 10.0 }, // (10.0 * 240) - (8.0 * 240) = 480W
                { delta: 720, targetCurrent: 11.0 }, // (11.0 * 240) - (8.0 * 240) = 720W
                { delta: 960, targetCurrent: 12.0 }, // (12.0 * 240) - (8.0 * 240) = 960W
                { delta: 1200, targetCurrent: 13.0 }, // (13.0 * 240) - (8.0 * 240) = 1200W
                { delta: 1440, targetCurrent: 14.0 }, // (14.0 * 240) - (8.0 * 240) = 1440W
                { delta: 1680, targetCurrent: 15.0 }, // (15.0 * 240) - (8.0 * 240) = 1680W
                { delta: 1920, targetCurrent: 16.0 }, // (16.0 * 240) - (8.0 * 240) = 1920W
            ]);
        });

        it("should not offer increments when device is in trickle charging mode with large consumption gap", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 10.0; // Current setting is 10A
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 1440; // Device only consuming 1440W (6A equivalent - trickle charging)

            const increments = device.increaseIncrements;

            // Gap: 10A - 6A = 4A, which is > 2 increments (2 * 1A = 2A)
            // Should not offer increments since device has significant unused capacity
            expect(increments).toEqual([]);
        });

        it("should not offer increments when consumption is 2 or more increments below current setting", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 4.0; // Current setting is 4A
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 240; // Only consuming 240W (1A equivalent)

            const increments = device.increaseIncrements;

            // Gap: 4A - 1A = 3A, which is >= 2 increments (2 * 1A = 2A)
            // Should not offer any increments since device has unused capacity
            expect(increments).toEqual([]);
        });

        it("should not offer increments when consumption gap is exactly 2 increments", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 6.0; // Current setting is 6A
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 960; // Consuming 960W (4A equivalent)

            const increments = device.increaseIncrements;

            // Gap: 6A - 4A = 2A, which equals 2 increments (2 * 1A = 2A)
            // Should not offer increments at the boundary (inclusive)
            expect(increments).toEqual([]);
        });

        it("should offer increments when consumption gap is less than 2 increments", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 8.0; // Current setting is 8A
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 1680; // Consuming 1680W (7A equivalent)

            const increments = device.increaseIncrements;

            // Gap: 8A - 7A = 1A, which is < 2 increments (2 * 1A = 2A)
            // Should offer increments normally
            expect(increments).toEqual([
                { delta: 240, targetCurrent: 9.0 }, // (9.0 * 240) - (8.0 * 240) = 240W
                { delta: 480, targetCurrent: 10.0 }, // (10.0 * 240) - (8.0 * 240) = 480W
                { delta: 720, targetCurrent: 11.0 }, // (11.0 * 240) - (8.0 * 240) = 720W
                { delta: 960, targetCurrent: 12.0 }, // (12.0 * 240) - (8.0 * 240) = 960W
                { delta: 1200, targetCurrent: 13.0 }, // (13.0 * 240) - (8.0 * 240) = 1200W
                { delta: 1440, targetCurrent: 14.0 }, // (14.0 * 240) - (8.0 * 240) = 1440W
                { delta: 1680, targetCurrent: 15.0 }, // (15.0 * 240) - (8.0 * 240) = 1680W
                { delta: 1920, targetCurrent: 16.0 }, // (16.0 * 240) - (8.0 * 240) = 1920W
            ]);
        });
    });

    describe("Decrease Increments", () => {
        it("should return empty array when device is disabled", () => {
            mockEnableEntity.state = "off";

            const increments = device.decreaseIncrements;

            expect(increments).toEqual([]);
        });

        it("should return current step decrements when device is enabled", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 5.0; // Well above minimum
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 1200; // 5A * 240V

            const increments = device.decreaseIncrements;

            // Should generate decrements: 4A, 3A, 2A, 1A down to minimum (0A)
            expect(increments).toEqual([
                { delta: -240, targetCurrent: 4.0 }, // (4.0 * 240) - 1200 = -240W
                { delta: -480, targetCurrent: 3.0 }, // (3.0 * 240) - 1200 = -480W
                { delta: -720, targetCurrent: 2.0 }, // (2.0 * 240) - 1200 = -720W
                { delta: -960, targetCurrent: 1.0 }, // (1.0 * 240) - 1200 = -960W
                { delta: -1200, targetCurrent: 0.0 }, // (0.0 * 240) - 1200 = -1200W
            ]);
        });

        it("should offer decrements down to minimum even when at stopping threshold", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 2.0; // At stopping threshold
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 480; // 2A * 240V

            const increments = device.decreaseIncrements;

            // Should still offer decrements down to entity minimum (0A)
            // Stopping threshold only affects automatic monitoring, not increment generation
            expect(increments).toEqual([
                { delta: -240, targetCurrent: 1.0 }, // (1.0 * 240) - (2.0 * 240) = -240W
                { delta: -480, targetCurrent: 0.0 }, // (0.0 * 240) - (2.0 * 240) = -480W
            ]);
        });

        it("should offer decrements down to minimum when above stopping threshold", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 3.0; // Just above stopping threshold (2.0 + step 1.0)
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 720; // 3A * 240V

            const increments = device.decreaseIncrements;

            expect(increments).toEqual([
                { delta: -240, targetCurrent: 2.0 }, // (2.0 * 240) - (3.0 * 240) = -240W
                { delta: -480, targetCurrent: 1.0 }, // (1.0 * 240) - (3.0 * 240) = -480W
                { delta: -720, targetCurrent: 0.0 }, // (0.0 * 240) - (3.0 * 240) = -720W
            ]);
        });

        it("should decrease down to minimum entity value", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 2.0;
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 480;

            const increments = device.decreaseIncrements;

            // Should go down to minimum entity value (0A)
            expect(increments).toEqual([
                { delta: -240, targetCurrent: 1.0 }, // (1.0 * 240) - 480 = -240W
                { delta: -480, targetCurrent: 0.0 }, // (0.0 * 240) - 480 = -480W
            ]);
        });

        it("should calculate decrease deltas correctly when consumption differs from current setting", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 8.0; // Current setting is 8A
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 2100; // But actual consumption is 2100W (8.75A equivalent)

            const increments = device.decreaseIncrements;

            // Consumption 2100W maps to 8.75A equivalent, rounds down to 8A
            // Decreases should start from 7A (8A - 1A step) down to 0A = 8 increments
            // Deltas calculated from actual consumption (2100W), not theoretical entity power
            expect(increments).toEqual([
                { delta: -420, targetCurrent: 7.0 }, // (7.0 * 240) - 2100 = -420W
                { delta: -660, targetCurrent: 6.0 }, // (6.0 * 240) - 2100 = -660W
                { delta: -900, targetCurrent: 5.0 }, // (5.0 * 240) - 2100 = -900W
                { delta: -1140, targetCurrent: 4.0 }, // (4.0 * 240) - 2100 = -1140W
                { delta: -1380, targetCurrent: 3.0 }, // (3.0 * 240) - 2100 = -1380W
                { delta: -1620, targetCurrent: 2.0 }, // (2.0 * 240) - 2100 = -1620W
                { delta: -1860, targetCurrent: 1.0 }, // (1.0 * 240) - 2100 = -1860W
                { delta: -2100, targetCurrent: 0.0 }, // (0.0 * 240) - 2100 = -2100W
            ]);
        });

        it("should calculate decrease deltas correctly when consumption differs from current setting with large delta", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 8.0; // Current setting is 8A
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 1440; // But actual consumption is 1440W (6A equivalent)

            const increments = device.decreaseIncrements;

            // Deltas should be calculated from theoretical power change, not actual consumption sensor value, but actual 
            // consumption sensor should be factored in. e.g. consumption: 1440 -> maps to 6A, therefore valid decreases
            // 5, 4, etc...
            expect(increments.length).toBe(6); // 5A down to 0A = 6 increments
            expect(increments[0]).toEqual({ delta: -240, targetCurrent: 5.0 }); // (5.0 * 240) - 1440 = -240W
            expect(increments[1]).toEqual({ delta: -480, targetCurrent: 4.0 }); // (4.0 * 240) - 1440 = -480W
            expect(increments[5]).toEqual({ delta: -1440, targetCurrent: 0.0 }); // (0.0 * 240) - 1440 = -1440W
        });

        it("should respect entity min attribute for decrease bounds", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 3.0;
            mockCurrentEntity.attributes.min = 1.0; // Set minimum to 1A instead of 0A
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 720;

            const increments = device.decreaseIncrements;

            // Should only go down to min attribute value (1A), not 0A
            expect(increments).toEqual([
                { delta: -240, targetCurrent: 2.0 }, // (2.0 * 240) - (3.0 * 240) = -240W
                { delta: -480, targetCurrent: 1.0 }, // (1.0 * 240) - (3.0 * 240) = -480W
                // Should stop at 1A (min attribute), not go to 0A
            ]);
        });

        it("should only offer decrease increments below current consumption equivalent", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 8.0; // Current setting is 8A
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 720; // But only consuming 720W (3A equivalent)

            const increments = device.decreaseIncrements;

            // Current consumption (720W) maps to 3A equivalent (720W ÷ 240V = 3A)
            // Decreases should only be offered for targets below this mapped current (3A)
            // Starting from 2A (3A - 1A step) down to 0A = 3 increments
            expect(increments).toEqual([
                { delta: -240, targetCurrent: 2.0 }, // (2.0 * 240) - 720 = -240W
                { delta: -480, targetCurrent: 1.0 }, // (1.0 * 240) - 720 = -480W
                { delta: -720, targetCurrent: 0.0 }, // (0.0 * 240) - 720 = -720W
            ]);
        });

        it("should offer decrease increments down to entity minimum when consumption allows", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 2.0; // Current setting is 2A
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 600; // Consuming 600W (2.5A equivalent)

            const increments = device.decreaseIncrements;

            // Current consumption (600W) maps to 2.5A equivalent, rounds down to 2A
            // Decreases should start from 1A (2A - 1A step) down to entity minimum (0A)
            expect(increments).toEqual([
                { delta: -360, targetCurrent: 1.0 }, // (1.0 * 240) - 600 = -360W
                { delta: -600, targetCurrent: 0.0 }, // (0.0 * 240) - 600 = -600W
            ]);
        });

        it("should offer no decrease increments when entity minimum exceeds consumption equivalent", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 5.0; // Current setting is 5A
            mockCurrentEntity.attributes.min = 3.0; // Entity minimum is 3A
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 480; // Only consuming 480W (2A equivalent)

            const increments = device.decreaseIncrements;

            // Current consumption (480W) maps to 2A equivalent, rounds down to 2A
            // Starting current would be 1A (2A - 1A step), but entity minimum is 3A
            // Since 1A < 3A (minimum), no decreases are possible
            expect(increments).toEqual([]);
        });
    });

    describe("Change State", () => {
        it("should return undefined when no changes pending and not in debounce", () => {
            expect(device.changeState).toBeUndefined();
        });

        it("should return increase pending after increaseConsumptionBy", () => {
            mockEnableEntity.state = "off";

            device.increaseConsumptionBy({
                delta: 1200,
                action: "enable",
                targetCurrent: 5.0,
            });

            expect(device.changeState).toEqual({
                type: "increase",
                expectedFutureConsumption: 1200, // 5.0A * 240V = 1200W
            });
        });

        it("should return decrease pending after decreaseConsumptionBy", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 5.0;

            device.decreaseConsumptionBy({
                delta: -120,
                targetCurrent: 4.5,
            });

            expect(device.changeState).toEqual({
                type: "decrease",
                expectedFutureConsumption: 1080, // 4.5A * 240V = 1080W
            });
        });
    });

    describe("Action Methods", () => {
        describe("increaseConsumptionBy", () => {
            it("should enable device and set current when action is enable", () => {
                mockEnableEntity.state = "off";

                device.increaseConsumptionBy({
                    delta: 1200,
                    action: "enable",
                    targetCurrent: 5.0,
                });

                expect(mockEnableEntity.turn_on).toHaveBeenCalledTimes(1);
                expect(mockCurrentEntity.setValue).toHaveBeenCalledWith(5.0);
            });

            it("should set current when targetCurrent is specified", () => {
                mockEnableEntity.state = "on";
                mockCurrentEntity.state = 4.0;

                device.increaseConsumptionBy({
                    delta: 240,
                    targetCurrent: 5.0,
                });

                expect(mockCurrentEntity.setValue).toHaveBeenCalledWith(5.0);
                expect(mockEnableEntity.turn_on).not.toHaveBeenCalled();
            });

            it("should set pending state after action", () => {
                mockEnableEntity.state = "on";
                mockCurrentEntity.state = 2.0;

                device.increaseConsumptionBy({
                    delta: 120,
                    targetCurrent: 2.5,
                });

                expect(device.changeState?.type).toBe("increase");
            });

            it("should throw error when change already pending", () => {
                mockEnableEntity.state = "on";
                mockCurrentEntity.state = 2.0;

                // First action
                device.increaseConsumptionBy({
                    delta: 120,
                    targetCurrent: 2.5,
                });

                // Second action should throw
                expect(() => device.increaseConsumptionBy({
                    delta: 240,
                    targetCurrent: 3.0,
                })).toThrow("Cannot increase consumption for Test Direct Consumption Device: change already pending");
            });

            it("should only allow one pending change at a time", () => {
                mockEnableEntity.state = "on";
                mockCurrentEntity.state = 2.0;

                // First action succeeds
                device.increaseConsumptionBy({
                    delta: 120,
                    targetCurrent: 2.5,
                });

                expect(device.changeState?.type).toBe("increase");
                expect(mockCurrentEntity.setValue).toHaveBeenCalledWith(2.5);

                // Second action while pending should throw
                expect(() => device.increaseConsumptionBy({
                    delta: 240,
                    targetCurrent: 3.0,
                })).toThrow("Cannot increase consumption for Test Direct Consumption Device: change already pending");

                // Only one call to setValue should have been made
                expect(mockCurrentEntity.setValue).toHaveBeenCalledTimes(1);
            });

            it("should prevent actions during debounce period", () => {
                const mockDateNow = vi.spyOn(Date, 'now');
                let currentTime = 1000000000; // Fixed starting time
                mockDateNow.mockImplementation(() => currentTime);

                try {
                    mockEnableEntity.state = "on";
                    mockCurrentEntity.state = 3.0;

                    const testDevice = new DirectConsumptionDevice(
                        "Test Debounce Device",
                        1,
                        mockCurrentEntity,
                        mockConsumptionEntity,
                        mockVoltageEntity,
                        mockEnableEntity,
                        config,
                    );

                    // Make an action to establish debounce timer
                    testDevice.increaseConsumptionBy({
                        delta: 240,
                        targetCurrent: 3.5,
                    });

                    expect(testDevice.changeState?.type).toBe("increase");

                    // The challenge is transitioning from PENDING to IDLE while preserving debounce.
                    // Since the auto-stop mechanism is complex to trigger reliably, and the user
                    // correctly pointed out that direct state manipulation shouldn't be "complex",
                    // we'll use minimal internal access with clear documentation.
                    
                    // Manually transition state machine to simulate completion
                    // This simulates what would happen when entity reaches target state
                    const stateMachine = (testDevice as any).consumptionTransitionStateMachine;
                    stateMachine.transitionTo("idle");

                    // Advance time but stay within debounce period
                    currentTime += 5000; // 5 seconds later (< 30 second debounce)

                    // Should now be in debounce state
                    expect(testDevice.changeState?.type).toBe("debounce");

                    // Clear mocks to test debounce behavior
                    vi.mocked(mockCurrentEntity.setValue).mockClear();

                    // Attempt action during debounce - should be silently ignored
                    testDevice.increaseConsumptionBy({
                        delta: 480,
                        targetCurrent: 4.0,
                    });

                    // No entity methods should have been called during debounce
                    expect(mockCurrentEntity.setValue).not.toHaveBeenCalled();
                    
                    // Should still be in debounce state
                    expect(testDevice.changeState?.type).toBe("debounce");

                    // Advance past debounce period
                    currentTime += 30000; // Past debounce period

                    // Should no longer be in debounce
                    expect(testDevice.changeState).toBeUndefined();

                    // Actions should work normally again
                    testDevice.increaseConsumptionBy({
                        delta: 240,
                        targetCurrent: 3.0,
                    });

                    expect(mockCurrentEntity.setValue).toHaveBeenCalledWith(3.0);

                } finally {
                    mockDateNow.mockRestore();
                }
            });
        });

        describe("decreaseConsumptionBy", () => {
            it("should set current when targetCurrent is specified", () => {
                mockEnableEntity.state = "on";
                mockCurrentEntity.state = 5.0;

                device.decreaseConsumptionBy({
                    delta: -120,
                    targetCurrent: 4.5,
                });

                expect(mockCurrentEntity.setValue).toHaveBeenCalledWith(4.5);
                expect(mockEnableEntity.turn_off).not.toHaveBeenCalled();
            });

            it("should set pending state after action", () => {
                mockEnableEntity.state = "on";
                mockCurrentEntity.state = 5.0;

                device.decreaseConsumptionBy({
                    delta: -120,
                    targetCurrent: 4.5,
                });

                expect(device.changeState?.type).toBe("decrease");
            });

            it("should throw error when change already pending", () => {
                mockEnableEntity.state = "on";
                mockCurrentEntity.state = 5.0;

                // First action
                device.decreaseConsumptionBy({
                    delta: -120,
                    targetCurrent: 4.5,
                });

                // Second action should throw
                expect(() => device.decreaseConsumptionBy({
                    delta: -240,
                    targetCurrent: 4.0,
                })).toThrow("Cannot decrease consumption for Test Direct Consumption Device: change already pending");
            });
        });

        describe("stop", () => {
            it("should disable device and reset current to 0", () => {
                device.stop();

                expect(mockEnableEntity.turn_off).toHaveBeenCalledTimes(1);
                expect(mockCurrentEntity.setValue).toHaveBeenCalledWith(0);
            });

            it("should reset state and debounce", () => {
                // First trigger a state change
                mockEnableEntity.state = "on";
                device.increaseConsumptionBy({
                    delta: 120,
                    targetCurrent: 2.5,
                });

                // Verify we're in pending state
                expect(device.changeState?.type).toBe("increase");

                // Call stop
                device.stop();

                // State should be reset
                expect(device.changeState).toBeUndefined();
            });
        });
    });

    describe("Stopping Threshold Logic", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("should auto-disable when current stays below threshold for timeout period", () => {
            // Start with device enabled but below threshold
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 1.0; // Below threshold (2.0A)

            // Create new device to trigger monitoring
            const testDevice = new DirectConsumptionDevice(
                "Test Device",
                1,
                mockCurrentEntity,
                mockConsumptionEntity,
                mockVoltageEntity,
                mockEnableEntity,
                config,
            );

            // Fast-forward to trigger timeout
            vi.advanceTimersByTime(config.stoppingTimeoutMs);

            expect(mockEnableEntity.turn_off).toHaveBeenCalledTimes(1);
        });

        it("should not auto-disable if current rises above threshold", () => {
            // Start with device enabled but below threshold
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 1.0; // Below threshold

            const testDevice = new DirectConsumptionDevice(
                "Test Device",
                1,
                mockCurrentEntity,
                mockConsumptionEntity,
                mockVoltageEntity,
                mockEnableEntity,
                config,
            );

            // Fast-forward partway through timeout
            vi.advanceTimersByTime(config.stoppingTimeoutMs / 2);

            // Current rises above threshold
            mockCurrentEntity.state = 3.0;

            // Complete the timeout period
            vi.advanceTimersByTime(config.stoppingTimeoutMs / 2 + 1000);

            // Device should not be auto-disabled
            expect(mockEnableEntity.turn_off).not.toHaveBeenCalled();
        });

        it("should not auto-disable when device is already disabled", () => {
            mockEnableEntity.state = "off";
            mockCurrentEntity.state = 1.0;

            const testDevice = new DirectConsumptionDevice(
                "Test Device",
                1,
                mockCurrentEntity,
                mockConsumptionEntity,
                mockVoltageEntity,
                mockEnableEntity,
                config,
            );

            vi.advanceTimersByTime(config.stoppingTimeoutMs);

            expect(mockEnableEntity.turn_off).not.toHaveBeenCalled();
        });

        it("should clear timeout when device is manually stopped via stop method", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 1.0;

            // Call stop method (this is how manual disable happens now)
            device.stop();

            // Fast-forward past timeout
            vi.advanceTimersByTime(config.stoppingTimeoutMs + 1000);

            // Should only be called once (from stop method), not from timeout
            expect(mockEnableEntity.turn_off).toHaveBeenCalledTimes(1);
        });

        it("should restart monitoring after current adjustments", () => {
            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 4.0; // Above threshold

            // Adjust current to below threshold
            device.decreaseConsumptionBy({
                delta: -240,
                targetCurrent: 1.0,
            });

            // Simulate current entity state change to below threshold
            mockCurrentEntity.state = 1.0;

            // Manually trigger monitoring restart (simulating what happens in real implementation)
            (device as any).startStoppingThresholdMonitoring();

            // Fast-forward to trigger timeout
            vi.advanceTimersByTime(config.stoppingTimeoutMs);

            // Device should be auto-disabled due to new monitoring
            expect(mockEnableEntity.turn_off).toHaveBeenCalledTimes(1);
        });
    });

    describe("Configuration", () => {
        it("should accept valid configuration", () => {
            expect(() => new DirectConsumptionDevice(
                "Test Device",
                1,
                mockCurrentEntity,
                mockConsumptionEntity,
                mockVoltageEntity,
                mockEnableEntity,
                config,
            )).not.toThrow();
        });

        it("should work with different step sizes", () => {
            const customConfig = { ...config, currentStep: 0.5 };

            const testDevice = new DirectConsumptionDevice(
                "Test Device",
                1,
                mockCurrentEntity,
                mockConsumptionEntity,
                mockVoltageEntity,
                mockEnableEntity,
                customConfig,
            );

            mockEnableEntity.state = "on";
            mockCurrentEntity.state = 4.0;
            mockVoltageEntity.state = 240;
            mockConsumptionEntity.state = 960;

            const increments = testDevice.increaseIncrements;

            // Should generate 0.5A steps instead of 1A
            expect(increments[0]).toEqual({ delta: 120, targetCurrent: 4.5 });
            expect(increments[1]).toEqual({ delta: 240, targetCurrent: 5.0 });
        });
    });
});
