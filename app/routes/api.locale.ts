import { redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/api.locale";
import { supportedLanguages } from "~/locales";
import { localeCookie } from "~/middleware/i18next";

const formSchema = z.object({
  locale: z.enum(supportedLanguages),
  // Only a path on this site. Anything else (//host, \host, a full URL) falls back to home.
  redirectTo: z
    .string()
    .regex(/^\/(?![/\\])/)
    .catch("/"),
});

// Saves the language in a cookie and goes back to the page the visitor was on.
export async function action({ request }: Route.ActionArgs) {
  // A page on another site must not be able to change the visitor's language.
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

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
