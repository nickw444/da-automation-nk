export function unwrapNumericState(value: number | string): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (value === "unavailable" || value === "unknown") {
    return undefined;
  }

  return Number(value) || undefined;
}
