import { data, redirect, redirectDocument } from "react-router";

import type { Route } from "./+types/lists.add";
import { getOptionalUser } from "~server/auth/require";
import { signInPath } from "~server/auth/sign-in-url";
import { readForm } from "~server/http/body";
import { privateHeaders } from "~server/http/cache";
import { asksForData, cameFrom } from "~server/http/came-from";
import { checkWrite } from "~server/http/write-guard";
import { runAddToList } from "~server/lists/item-actions";
import { rateLimit } from "~server/rate-limit";
import { getDb, getWriteLimiter } from "~server/runtime-env";

// The form has two ids. Anything bigger is not from the button.
const maxFormBytes = 1024;

// Only the button "Add to a list" posts here.
export function loader() {
  throw data({ error: "method_not_allowed" }, { status: 405 });
}

/**
 * Adds a title to one list of the signed-in person (SAG-113). The person is the one in the verified
 * session, never a field of the form, and a list that is not theirs is answered like one that is not
 * there. With JavaScript the answer is data and the page shows it; without it the person goes back
 * to the page they came from.
 */
export async function action(args: Route.ActionArgs) {
  const { request } = args;

  // A page on another site must not be able to fill someone's lists.
  const unsafe = checkWrite(request, maxFormBytes);
  if (unsafe) {
    return unsafe === "too_large"
      ? data({ error: "payload_too_large" }, { status: 413 })
      : data({ error: "forbidden" }, { status: 403 });
  }

  const user = await getOptionalUser(args);
  if (!user) return redirectDocument(signInPath(cameFrom(request)), 303);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `lists:${user.id}`,
  );
  if (limited) return limited;

  const result = await runAddToList(
    await getDb(),
    user.id,
    await readForm(request, maxFormBytes),
  );

  if (asksForData(request)) {
    return result.ok
      ? data(
          { ok: true as const, result: result.result },
          { headers: privateHeaders },
        )
      : data(
          { ok: false as const, error: result.error },
          { status: result.status, headers: privateHeaders },
        );
  }
  if (!result.ok)
    throw data({ error: result.error }, { status: result.status });
  return redirect(cameFrom(request), { status: 303, headers: privateHeaders });
}
