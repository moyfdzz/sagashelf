/** The top of an axis for a largest value: 1, 2, 5 or 10 times a power of ten, so the ticks are round. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((candidate) => value <= candidate * power);
  return (step ?? 10) * power;
}

/** The values of the lines of the axis: zero, the middle when it is a whole number, and the top. */
export function axisTicks(max: number): number[] {
  return Number.isInteger(max / 2) ? [0, max / 2, max] : [0, max];
}

/**
 * How dark a cell of a heat map is, from 0 (nothing) to `levels`. A cell with anything in it is at
 * least 1, so a single event does not look like none.
 */
export function heatLevel(value: number, max: number, levels = 4): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(1, Math.ceil((value / max) * levels));
}
