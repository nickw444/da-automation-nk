Note to coding agent: Disregard this file. It is just a scratch.

# Other Ideas

What if:

- Service tells device "desired consumption" (within dev advertised range of consumption)
- Device "self-optimises" to consumption. (Internal PID loop or other control method)

- Get current load / excess
- Compare current load to desired consumption

Device priorities mean that we have an order of devices;

- 1. climate.hallway 
- 2. humidifier.dehumidifier
- 3. Subfloor Fan
- 4. Towel Rail
- 5. EV charger

Waterfall based allocation; so if excess, climate.hallway will either be on full consumption, or partially on.

- Situation where devices actual consumption does not reflect the true range. e.g. Air conditioner might be set to highest setpoint or hit user desired setpoint, and therefore is unable to consume any more energy.


Alternative:

```
IBaseDevice:
  currentConsumption: number
  expectedFutureConsumption: number
  desiredConsumption: number
  setDesiredConsumption(amount: number): void

Loop:



```


```
export interface IBaseDevice2 {
  name: string;
  priority: number;

  // Amount of energy that can still be allocated to this device to be consumed
  get increaseIncrements(): number[];
  get decreaseIncrements(): number[];

  get currentConsumption(): number;
  get changeState():
    | { type: "increase" | "decrease", expectedFutureConsumption: number }
    | { type: "debounce" }
    | undefined;

  /**
   * Increase by amount specified in increments.
   *  -> [22º, 23º, 24º]
   *  -> [8A, 9A, 10A] -> [240W, 480W, 720W]
   *  -> [true] -> [100W]
   */
  increaseConsumptionBy(amount: number): void;

  /**
   * Decrease by amount specified in increments.
   */
  decreaseConsumptionBy(amount: number): void;

  /**
   * Cease consumption immediately (due to load management system shutdown)
   */
  stop(): void
}

```



## TODO

Need to handle future consumption