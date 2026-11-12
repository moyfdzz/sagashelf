/**
 * The Core Web Vitals the analytics keep (SAG-254, ADR-050): how fast a page shows its main content
 * (LCP), how much it moves while it loads (CLS) and how fast it answers a click or a tap (INP).
 * Written once for the collector, the rollup and the tests.
 */

export const vitalMetrics = ["LCP", "CLS", "INP"] as const;
export type VitalMetric = (typeof vitalMetrics)[number];

/**
 * Up to and including `good` is good, up to and including `poor` needs improvement, and above it is
 * poor. LCP and INP are in milliseconds, CLS is a score with no unit. Source: the README of the
 * `web-vitals` library (`LCPThresholds`, `CLSThresholds`, `INPThresholds`), read 2026-11-12.
 */
export const vitalThresholds: Readonly<
  Record<VitalMetric, { good: number; poor: number }>
> = {
  LCP: { good: 2500, poor: 4000 },
  CLS: { good: 0.1, poor: 0.25 },
  INP: { good: 200, poor: 500 },
};

/** The most a time can be: a real page does not take a minute, so more is a mistake or a forgery. */
export const maxVitalMs = 60_000;

/** The most a layout shift score can be. A page that moves more than 100 times its size is not real. */
export const maxCls = 100;

export type VitalRating = "good" | "needs-improvement" | "poor";

/** How a value rates for a metric, with the thresholds above. */
export function rateVital(metric: VitalMetric, value: number): VitalRating {
  const { good, poor } = vitalThresholds[metric];
  if (value <= good) return "good";
  return value <= poor ? "needs-improvement" : "poor";
}
