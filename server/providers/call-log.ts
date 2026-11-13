import {
  providerNamePattern,
  stoppedByUsOutcomes,
  type ProviderOutcome,
} from "../db/schema/providers";

/**
 * The count of the calls to the providers that this Worker instance has made and not written yet
 * (SAG-26, ADR-052). Every call that goes through `createHttpClient` is added here, by day, provider
 * and outcome, and `flushProviderCalls` writes the totals in one statement after the response is
 * sent. The counts live in the memory of the instance: Workers do not share memory, and one that
 * dies before it writes loses what it held. The page of the administration says the numbers are
 * approximate.
 *
 * Nothing here holds an address, a header, a search text or an error message: only the name of the
 * provider, how the call ended and how long it took.
 */

export type ProviderCall = {
  provider: string;
  outcome: ProviderOutcome;
  /** Requests really sent for this call: a retry is one more, and a call never sent has none. */
  requests: number;
  /** Milliseconds from the start of the call to its end, retries and waits included. */
  ms: number;
};

/** A row of `provider_calls_daily`, ready to be written. */
export type ProviderCallRow = {
  day: string;
  provider: string;
  outcome: ProviderOutcome;
  calls: number;
  requests: number;
  latencyMs: number;
};

const pending = new Map<string, ProviderCallRow>();

const separator = "|";

/** Adds one call to the count of its day (UTC), provider and outcome. */
export function recordProviderCall(
  call: ProviderCall,
  now: Date = new Date(),
): void {
  // A name the table would refuse is not counted: one bad row would make every write fail.
  if (!providerNamePattern.test(call.provider)) return;
  const day = now.toISOString().slice(0, 10);
  const key = [day, call.provider, call.outcome].join(separator);
  const row = pending.get(key) ?? {
    day,
    provider: call.provider,
    outcome: call.outcome,
    calls: 0,
    requests: 0,
    latencyMs: 0,
  };
  row.calls += 1;
  row.requests += call.requests;
  // The time of a call that our own limit or circuit stopped (it may have waited for a place, or
  // sent a try before) says nothing about the provider, and neither does one that sent nothing.
  if (call.requests > 0 && !stoppedByUsOutcomes.includes(call.outcome)) {
    row.latencyMs += Math.max(0, Math.round(call.ms));
  }
  pending.set(key, row);
}

/**
 * Gives back what `takeProviderCalls` handed over and could not be written, adding it to what was
 * counted since. The number of rows cannot grow beyond days x providers x outcomes, so keeping them
 * for the next write costs nothing.
 */
export function restoreProviderCalls(rows: readonly ProviderCallRow[]): void {
  for (const back of rows) {
    const key = [back.day, back.provider, back.outcome].join(separator);
    const row = pending.get(key);
    if (row) {
      row.calls += back.calls;
      row.requests += back.requests;
      row.latencyMs += back.latencyMs;
    } else {
      pending.set(key, { ...back });
    }
  }
}

/** Hands over everything counted so far and starts from zero. */
export function takeProviderCalls(): ProviderCallRow[] {
  const rows = [...pending.values()];
  pending.clear();
  return rows;
}

/** Whether there is anything to write. */
export const hasProviderCalls = (): boolean => pending.size > 0;
