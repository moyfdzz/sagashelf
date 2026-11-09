import { getEntry, saveEntry, type StoredEntry } from "../db/library";
import type { ProfileDb } from "../db/profile";
import type { EntryState, RuleError, RuleResult } from "./rules";

// Losing the race is rare; a few tries are enough for quick presses on one button.
const maxTries = 3;

export type UpdateResult =
  | { outcome: "saved"; next: EntryState }
  | { outcome: "refused"; error: RuleError }
  | { outcome: "missing" }
  | { outcome: "conflict" };

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
