import { useTranslation } from "react-i18next";
import { data, Form, Link, redirect } from "react-router";

import type { Route } from "./+types/contact";
import { contactEmail } from "~/lib/legal";
import { inputClass, linkClass, primaryButtonClass } from "~/lib/ui";
import { getInstance } from "~/middleware/i18next";
import {
  contactFormError,
  contactFormSchema,
  contactKinds,
  contactTrapField,
  maxContactBody,
  maxReplyEmail,
} from "~server/account/contact-schema";
import { getOptionalUser } from "~server/auth/require";
import { createContactMessage } from "~server/db/contact-messages";
import { readForm } from "~server/http/body";
import { mergePrivateHeaders, privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";
import { rateLimit } from "~server/rate-limit";
import { getDb, getWriteLimiter } from "~server/runtime-env";

// A text of 2000 characters can take four bytes each, and the form has a few more fields.
const maxFormBytes = 12 * 1024;

const back = "/contact";

export async function loader(args: Route.LoaderArgs) {
  const { request, context } = args;
  const { t } = getInstance(context);
  // A suspended or banned person is sent to the page that says why, which shows the address.
  const user = await getOptionalUser(args);
  return {
    title: t("app.pageTitle", { title: t("contact.title") }),
    description: t("contact.description"),
    signedIn: user !== null,
    sent: new URL(request.url).searchParams.get("sent") === "1",
  };
}

/**
 * Stores a message of the contact page, from a signed-in person or from a visitor. The checks come
 * first and in this order: the size and the `Origin`, who is writing, the rate limit, and then the
 * form. A bot that fills the trap field is answered as if it had been sent, and nothing is kept.
 */
export async function action(args: Route.ActionArgs) {
  const { request } = args;

  // A page on another site must not be able to send a message in somebody's name.
  const unsafe = checkWrite(request, maxFormBytes);
  if (unsafe) {
    return data(
      { error: "invalid_request" as const },
      { status: unsafe === "too_large" ? 413 : 403, headers: privateHeaders },
    );
  }

  const user = await getOptionalUser(args);
  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `contact:${user?.id ?? "visitor"}`,
  );
  if (limited) return limited;

  const raw = await readForm(request, maxFormBytes);
  if (String(raw[contactTrapField] ?? "") !== "") {
    return redirect(`${back}?sent=1`, 303);
  }

  const parsed = contactFormSchema.safeParse(raw);
  if (!parsed.success) {
    // What was typed comes back, so a mistake does not cost the whole message.
    return data(
      {
        error: contactFormError(parsed.error),
        values: {
          kind: String(raw.kind ?? ""),
          body: String(raw.body ?? "").slice(0, maxContactBody),
          replyEmail: String(raw.replyEmail ?? "").slice(0, maxReplyEmail),
        },
      },
      { status: 400, headers: privateHeaders },
    );
  }
  const form = parsed.data;

  const outcome = await createContactMessage(await getDb(), {
    userId: user?.id ?? null,
    kind: form.kind,
    body: form.body,
    // A signed-in person is answered through their account, so an address is never kept for them.
    replyEmail: user ? null : form.replyEmail,
  });
  if (outcome === "limit") {
    return data(
      {
        error: "limit" as const,
        values: { kind: form.kind, body: form.body, replyEmail: "" },
      },
      { status: 429, headers: privateHeaders },
    );
  }
  return redirect(`${back}?sent=1`, 303);
}

// The page depends on who is looking, and the answer to a form is never kept.
export const headers = mergePrivateHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "description", content: loaderData?.description },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export default function Contact({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { t } = useTranslation();
  const { signedIn, sent } = loaderData;
  const error = actionData && "error" in actionData ? actionData.error : null;
  const values =
    actionData && "values" in actionData ? actionData.values : null;
  const chosenKind = contactKinds.find((kind) => kind === values?.kind);

  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold">{t("contact.title")}</h1>
      <p className="text-fg-muted mt-2">{t("contact.intro")}</p>

      {sent ? (
        <section className="mt-6 space-y-3">
          <p
            role="status"
            className="border-input-edge bg-surface rounded-md border px-4 py-3 font-semibold"
          >
            {t("contact.sent.title")}
          </p>
          <p>{t("contact.sent.body")}</p>
          <p>
            <a href={back} className={linkClass}>
              {t("contact.sent.another")}
            </a>
          </p>
        </section>
      ) : (
        <Form method="post" reloadDocument className="mt-6 space-y-6">
          <fieldset className="space-y-2">
            <legend className="font-semibold">{t("contact.kindLabel")}</legend>
            {contactKinds.map((kind) => (
              <label key={kind} className="flex items-start gap-2">
                <input
                  type="radio"
                  name="kind"
                  value={kind}
                  required
                  defaultChecked={
                    chosenKind ? chosenKind === kind : kind === "feedback"
                  }
                  className="mt-1 shrink-0"
                />
                {t(`contact.kinds.${kind}`)}
              </label>
            ))}
          </fieldset>

          <div>
            <label htmlFor="body" className="font-semibold">
              {t("contact.bodyLabel")}
            </label>
            <textarea
              id="body"
              name="body"
              rows={6}
              required
              maxLength={maxContactBody}
              defaultValue={values?.body ?? ""}
              aria-describedby="body-hint"
              aria-invalid={error === "body_invalid" ? true : undefined}
              className={inputClass}
            />
            <p id="body-hint" className="text-fg-muted mt-1 text-sm">
              {t("contact.bodyHint", { max: maxContactBody })}
            </p>
          </div>

          {signedIn ? (
            <p className="text-fg-muted text-sm">{t("contact.signedIn")}</p>
          ) : (
            <div>
              <label htmlFor="replyEmail" className="font-semibold">
                {t("contact.emailLabel")}
              </label>
              <input
                id="replyEmail"
                name="replyEmail"
                type="email"
                autoComplete="email"
                maxLength={maxReplyEmail}
                defaultValue={values?.replyEmail ?? ""}
                aria-describedby="email-hint"
                aria-invalid={error === "email_invalid" ? true : undefined}
                className={inputClass}
              />
              <p id="email-hint" className="text-fg-muted mt-1 text-sm">
                {t("contact.emailHint")}
              </p>
            </div>
          )}

          {/* The trap: people never see it, and a bot that fills every field gives itself away. */}
          <div className="hidden" aria-hidden="true">
            <label>
              {t("contact.trapLabel")}
              <input
                type="text"
                name={contactTrapField}
                tabIndex={-1}
                autoComplete="off"
              />
            </label>
          </div>

          {error ? (
            <p role="alert" className="text-danger-text text-sm font-semibold">
              {t(`contact.errors.${error}`, { max: maxContactBody })}
            </p>
          ) : null}
          <button type="submit" className={primaryButtonClass}>
            {t("contact.submit")}
          </button>
        </Form>
      )}

      <p className="text-fg-muted mt-8 text-sm">
        {t("contact.alternative", { email: contactEmail })}{" "}
        <Link to="/privacy" className={linkClass}>
          {t("contact.privacy")}
        </Link>
      </p>
    </main>
  );
}
