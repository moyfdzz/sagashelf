import {
  getEntry,
  getSeasonCounts,
  saveEntry,
  totalEpisodes,
  type StoredEntry,
} from "../db/library";
import type { ProfileDb } from "../db/profile";
import type { EntryState, RuleError, RuleResult } from "./rules";

// Losing the race is rare. Each loser needs one more try than the one before it, so this lets
// five presses sent together all land; more than that is not a person pressing a button.
const maxTries = 5;

/**
 * The episodes of a title, asked for the first time the rule needs them (so an entry that does not
 * exist costs no query) and never again, however many times the rule runs.
 */
export function lazyTotalEpisodes(db: ProfileDb, mediaId: string) {
  let total: Promise<number> | undefined;
  return () => {
    total ??= getSeasonCounts(db, mediaId).then(totalEpisodes);
    return total;
  };
}

export type UpdateResult =
  | { outcome: "saved"; next: EntryState }
  | { outcome: "refused"; error: RuleError }
  | { outcome: "missing" }
  | { outcome: "conflict" };

/**
 * How a quick button (the step, a status) answers when `updateEntry` did not save, written once
 * for both routes. `404`: no such entry. `409`: it kept changing. `400`: the rules refuse the
 * change. `tooHigh` is for the button that can say "already at the end" instead of a general
 * failure.
 */
type Failure<Error extends string> = {
  status: 404 | 409 | 400;
  error: "invalid_request" | "failed" | Error;
};
type NotSaved = Exclude<UpdateResult, { outcome: "saved" }>;

export function failureOf(result: NotSaved): Failure<never>;
export function failureOf(
  result: NotSaved,
  options: { tooHigh: true },
): Failure<"too_high">;
export function failureOf(
  result: NotSaved,
  { tooHigh = false }: { tooHigh?: boolean } = {},
): Failure<"too_high"> {
  if (result.outcome === "missing") {
    return { status: 404, error: "invalid_request" } as const;
  }
  if (result.outcome === "conflict") {
    return { status: 409, error: "failed" } as const;
  }
  return {
    status: 400,
    error:
      tooHigh && result.error === "progress_too_high" ? "too_high" : "failed",
  } as const;
}

/**
 * Reads the entry, works out the next state with `rule` (the rules of `rules.ts`) and writes it
 * only if the entry did not change in between. When it did, the entry is read again and the rule
 * is applied to what is there now, so two quick "+1" give two steps and a change made in another
 * tab is never undone. After a few lost races the answer is `conflict`.
 */
export async function updateEntry(
  db: ProfileDb,
  userId: string,
  mediaId: string,
  rule: (current: StoredEntry) => Promise<RuleResult> | RuleResult,
): Promise<UpdateResult> {
  for (let attempt = 0; attempt < maxTries; attempt += 1) {
    const current = await getEntry(db, userId, mediaId, "es");
    // Somebody else's entry and no entry at all look the same.
    if (!current) return { outcome: "missing" };

    const result = await rule(current);
    if (!result.ok) return { outcome: "refused", error: result.error };

    const saved = await saveEntry(
      db,
      userId,
      mediaId,
      result.next,
      current.version,
    );
    if (saved === "saved") return { outcome: "saved", next: result.next };
    if (saved === "missing") return { outcome: "missing" };
  }
  return { outcome: "conflict" };
}
