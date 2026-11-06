import { isReportReason, reasonsOf } from "../account/report-schema";
import {
  findPersonByUsername,
  restrictAccount,
  warnPerson,
} from "../db/account-actions";
import type { SqlExecutor } from "../db/clerk-sync";
import {
  canRestrict,
  done,
  error,
  failed,
  stopAccount,
  type ClerkUsers,
} from "./clerk-steps";
import type { ModerationForm } from "./run-action";

type PersonForm = Extract<
  ModerationForm,
  { intent: "warn_person" | "suspend_person" | "ban_person" }
>;

/**
 * Warns, suspends or bans a person named by username, with no report (SAG-146, ADR-040). The person
 * is found here, on the server, with the rules of the actions on a report: an erased account does
 * not exist, and neither an administrator nor the one asking can be acted on. The answer carries the
 * username, so the panel shows the same card again.
 */
export async function runPersonAction(
  db: SqlExecutor,
  clerk: ClerkUsers,
  actorId: string,
  form: PersonForm,
): Promise<string> {
  const back = (query: string) =>
    `person=${encodeURIComponent(form.username)}&${query}`;
  const person = await findPersonByUsername(db, actorId, form.username);
  if (!person) return back(error("not_found"));
  if (person.protected) return back(error("not_allowed"));
  const subject = { userId: person.userId };

  if (form.intent === "warn_person") {
    // The reason is one of the list for a person, never free text.
    if (
      !isReportReason(form.reason) ||
      !reasonsOf("user").includes(form.reason)
    ) {
      return back(error("invalid_request"));
    }
    return back(
      done(
        await warnPerson(db, actorId, subject, form.reason, form.note),
        "warned",
      ),
    );
  }

  const bans = form.intent === "ban_person";
  if (!canRestrict(person.state, bans)) return back(error("not_found"));
  const step = await stopAccount(clerk, person, bans);
  if (step.refused !== null) return back(failed(step.refused));
  const state = bans ? "banned" : "suspended";
  return back(
    done(
      await restrictAccount(db, actorId, subject, state, form.note),
      step.skipped ? "banned_no_clerk" : state,
    ),
  );
}
