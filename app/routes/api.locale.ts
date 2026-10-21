import { redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/api.locale";
import { supportedLanguages } from "~/locales";
import { localeCookie } from "~/middleware/i18next";
import { rateLimit } from "~server/rate-limit";
import { getWriteLimiter } from "~server/runtime-env";

const formSchema = z.object({
  locale: z.enum(supportedLanguages),
  // Only a path on this site. Anything else (//host, \host, a full URL) falls back to home.
  redirectTo: z
    .string()
    .regex(/^\/(?![/\\])/)
    .catch("/"),
});

// The form has two short fields; anything bigger is not from this site's form.
const maxFormBytes = 4096;

// Answering before the body is read leaves it open, and the local runtime then
// fails the next request on the same connection. Read and drop it first (it is
// small: the size was already checked).
async function answerWithoutReading(request: Request, response: Response) {
  await request.arrayBuffer().catch(() => undefined);
  return response;
}

// Saves the language in a cookie and goes back to the page the visitor was on.
export async function action({ request }: Route.ActionArgs) {
  if (Number(request.headers.get("Content-Length") ?? 0) > maxFormBytes) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  // A page on another site must not be able to change the visitor's language.
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return answerWithoutReading(
      request,
      Response.json({ error: "forbidden" }, { status: 403 }),
    );
  }

  const limited = await rateLimit(getWriteLimiter(), request, "locale");
  if (limited) return answerWithoutReading(request, limited);

  const form = formSchema.safeParse(
    Object.fromEntries(await request.formData()),
  );
  if (!form.success) {
    return Response.json({ error: "invalid_locale" }, { status: 400 });
  }

  return redirect(form.data.redirectTo, {
    status: 303,
    headers: { "Set-Cookie": await localeCookie.serialize(form.data.locale) },
  });
}

// Opening this URL directly just goes home.
export function loader() {
  return redirect("/");
}
