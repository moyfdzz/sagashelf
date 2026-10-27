import { useTranslation } from "react-i18next";
import { data, Form, useFetcher, useNavigation } from "react-router";
import type { ZodError } from "zod";

import { rootAuthLoader } from "@clerk/react-router/server";

import type { Route } from "./+types/settings.profile";
import type { action as deleteAction } from "./settings.delete";
import type { action as usernameAction } from "./settings.username";
import { ClerkSession } from "~/components/ClerkSession";
import { SettingsNav } from "~/components/SettingsNav";
import { StatusToast } from "~/components/StatusToast";
import { formatDate } from "~/lib/format";
import { localeNames, supportedLanguages } from "~/locales";
import { getInstance, localeCookie } from "~/middleware/i18next";
import {
  bioMaxLength,
  displayNameMaxLength,
  profileUpdateSchema,
} from "~server/account/profile-schema";
import { usernameAvailableAt } from "~server/account/username-schema";
import { requireUser } from "~server/auth/require";
import { getProfile, updateProfile } from "~server/db/profile";
import { getUsernameChangedAt } from "~server/db/username";
import { rateLimit } from "~server/rate-limit";
import { getClerkKeys, getDb, getWriteLimiter } from "~server/runtime-env";
import { readForm } from "~server/http/body";

// The form has four short fields. Anything bigger is not from this page.
const maxFormBytes = 16 * 1024;

// Pages and answers that carry a person's data are never kept by a shared cache.
const privateHeaders = { "Cache-Control": "private, no-store" };

const privacyLevels = ["public", "friends", "private"] as const;

// Each code has its text in app/locales, under settings.profile.errors.
type ErrorCode =
  | "display_name_too_long"
  | "bio_too_long"
  | "invalid_locale"
  | "invalid_privacy"
  | "generic";

type FieldErrors = Partial<
  Record<"displayName" | "bio" | "locale" | "privacy" | "form", ErrorCode>
>;

// What a request that is not from the form gets back: one general message.
const notTheForm: FieldErrors = { form: "generic" };

/** The codes that the profile schema gives for the text fields. */
function textCode(message: string): ErrorCode {
  return message === "display_name_too_long" || message === "bio_too_long"
    ? message
    : "generic";
}

/** One error code per field, never the text or the value that was sent. */
function fieldErrors(error: ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (field === "displayName" || field === "bio") {
      errors[field] = textCode(issue.message);
    } else if (field === "locale") {
      errors.locale = "invalid_locale";
    } else if (field === "privacy") {
      errors.privacy = "invalid_privacy";
    } else {
      // A field the form does not have: someone is not using the form.
      errors.form = "generic";
    }
  }
  return errors;
}

// Answering before the body is read leaves it open, and the local runtime then fails the next
// request on the same connection. Read and drop it first (the size was already checked).
async function answerWithoutReading<T>(request: Request, response: T) {
  await request.arrayBuffer().catch(() => undefined);
  return response;
}

export async function loader(args: Route.LoaderArgs) {
  // Sends a visitor without a session to sign in, and refuses an account with no local row.
  const user = await requireUser(args);
  const db = await getDb();
  const profile = await getProfile(db, user.id);
  if (!profile) throw data({ error: "forbidden" }, { status: 403 });
  // When the username may be changed again, or null if it may be changed now.
  const nextUsernameChange = usernameAvailableAt(
    await getUsernameChangedAt(db, user.id),
  );

  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const { t } = getInstance(args.context);
  // Adds Clerk's state for this page, so Clerk's script can renew the session (ClerkSession).
  return rootAuthLoader(args, () => ({
    profile,
    nextUsernameChange: nextUsernameChange?.toISOString() ?? null,
    title: t("settings.profile.title"),
    publishableKey: keys.publishableKey,
  }));
}

// Pages and answers that carry a person's data are never kept by a shared cache. Set here, for
// the page and for its data requests alike, and the cookie of an answer is kept.
export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
  const merged = new Headers(loaderHeaders);
  actionHeaders.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") merged.append(key, value);
    else merged.set(key, value);
  });
  merged.set("Cache-Control", "private, no-store");
  return merged;
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    // A page about one person's account has nothing to show a search engine.
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function action(args: Route.ActionArgs) {
  const { request } = args;

  if (Number(request.headers.get("Content-Length") ?? 0) > maxFormBytes) {
    return answerWithoutReading(
      request,
      data({ ok: false as const, errors: notTheForm }, { status: 413 }),
    );
  }

  // A page on another site must not be able to change someone's profile.
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return answerWithoutReading(
      request,
      data({ ok: false as const, errors: notTheForm }, { status: 403 }),
    );
  }

  // The person is the one in the verified session, never a field of the form.
  const user = await requireUser(args);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `profile:${user.id}`,
  );
  if (limited) return answerWithoutReading(request, limited);

  const parsed = profileUpdateSchema.safeParse(
    await readForm(request, maxFormBytes),
  );
  if (!parsed.success) {
    return data(
      { ok: false as const, errors: fieldErrors(parsed.error) },
      { status: 400, headers: privateHeaders },
    );
  }

  const profile = await updateProfile(await getDb(), user.id, parsed.data);
  if (!profile) throw data({ error: "forbidden" }, { status: 403 });

  const headers = new Headers(privateHeaders);
  if (parsed.data.locale) {
    // The page switches language at once, in this browser too.
    headers.append(
      "Set-Cookie",
      await localeCookie.serialize(parsed.data.locale),
    );
  }
  return data({ ok: true as const, profile, savedAt: Date.now() }, { headers });
}

const secondaryButtonClass =
  "border-input-edge bg-surface text-fg focus-visible:outline-accent rounded-md border px-4 py-2 font-semibold hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2";

const inputClass =
  "border-input-edge bg-surface text-fg focus-visible:outline-accent mt-1 block w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2";

export default function ProfileSettings({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  const deleter = useFetcher<typeof deleteAction>();
  const deleting = deleter.state !== "idle";
  const deleteError =
    deleter.data && "error" in deleter.data ? deleter.data.error : null;
  const renamer = useFetcher<typeof usernameAction>();
  const renaming = renamer.state !== "idle";
  const renameError =
    renamer.data && "error" in renamer.data ? renamer.data.error : null;
  const renamed = renamer.data && "ok" in renamer.data && renamer.data.ok;
  const { nextUsernameChange } = loaderData;

  const profile =
    actionData?.ok === true ? actionData.profile : loaderData.profile;
  const errors: FieldErrors = actionData?.ok === false ? actionData.errors : {};
  const hasErrors = Object.keys(errors).length > 0;
  const errorText = (code: ErrorCode) => t(`settings.profile.errors.${code}`);

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-3xl font-bold">{t("settings.profile.title")}</h1>
        <p className="text-fg-muted mt-2">
          {t("settings.profile.description")}
        </p>
        <SettingsNav />

        {/* Always in the page, so a screen reader announces each message that appears in it. */}
        <div
          role="status"
          className="pointer-events-none fixed inset-x-4 top-20 z-50 sm:right-6 sm:left-auto sm:w-96"
        >
          {actionData?.ok === true ? (
            <StatusToast key={actionData.savedAt}>
              {t("settings.profile.saved")}
            </StatusToast>
          ) : null}
        </div>
        {hasErrors ? (
          <p
            role="alert"
            className="border-danger-edge bg-danger-bg text-danger-fg mt-6 rounded-md border px-4 py-3 font-semibold"
          >
            {errors.form
              ? errorText(errors.form)
              : t("settings.profile.errors.summary")}
          </p>
        ) : null}

        <renamer.Form
          method="post"
          action="/settings/username"
          key={profile.username}
          className="mt-8 space-y-2"
        >
          <label htmlFor="username" className="font-semibold">
            {t("settings.profile.username")}
          </label>
          <div className="flex flex-wrap gap-3">
            <input
              id="username"
              name="username"
              defaultValue={profile.username}
              minLength={3}
              maxLength={30}
              pattern="[A-Za-z0-9_]+"
              autoComplete="username"
              spellCheck={false}
              disabled={nextUsernameChange !== null}
              aria-invalid={renameError ? true : undefined}
              aria-describedby={`username-hint${renameError ? " username-error" : ""}`}
              className={`${inputClass} mt-0 min-w-0 flex-1 disabled:opacity-60`}
            />
            <button
              type="submit"
              disabled={renaming || nextUsernameChange !== null}
              className={`${secondaryButtonClass} disabled:opacity-60`}
            >
              {renaming
                ? t("settings.username.submitting")
                : t("settings.username.submit")}
            </button>
          </div>
          <p id="username-hint" className="text-fg-muted text-sm">
            {nextUsernameChange
              ? t("settings.username.cooldown", {
                  date: formatDate(new Date(nextUsernameChange), i18n.language),
                })
              : t("settings.profile.usernameHint")}
          </p>
          {renameError ? (
            <p
              id="username-error"
              role="alert"
              className="text-danger-text text-sm font-semibold"
            >
              {t(`settings.username.errors.${renameError}`)}
            </p>
          ) : null}
          {renamed ? (
            <p role="status" className="text-sm font-semibold">
              {t("settings.username.saved")}
            </p>
          ) : null}
        </renamer.Form>

        {/* A key from the saved values makes the fields show what was stored after a save. */}
        <Form
          method="post"
          id="profile"
          className="mt-8 scroll-mt-4 space-y-6"
          key={JSON.stringify(profile)}
        >
          <div>
            <label htmlFor="displayName" className="font-semibold">
              {t("settings.profile.displayName")}
            </label>
            <input
              id="displayName"
              name="displayName"
              defaultValue={profile.displayName ?? ""}
              autoComplete="nickname"
              aria-invalid={errors.displayName ? true : undefined}
              aria-describedby={`displayName-hint${errors.displayName ? " displayName-error" : ""}`}
              className={inputClass}
            />
            <p id="displayName-hint" className="text-fg-muted mt-1 text-sm">
              {t("settings.profile.displayNameHint", {
                max: displayNameMaxLength,
              })}
            </p>
            {errors.displayName ? (
              <p
                id="displayName-error"
                className="text-danger-text mt-1 text-sm font-semibold"
              >
                {errorText(errors.displayName)}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="bio" className="font-semibold">
              {t("settings.profile.bio")}
            </label>
            <textarea
              id="bio"
              name="bio"
              rows={5}
              defaultValue={profile.bio ?? ""}
              aria-invalid={errors.bio ? true : undefined}
              aria-describedby={`bio-hint${errors.bio ? " bio-error" : ""}`}
              className={inputClass}
            />
            <p id="bio-hint" className="text-fg-muted mt-1 text-sm">
              {t("settings.profile.bioHint", { max: bioMaxLength })}
            </p>
            {errors.bio ? (
              <p
                id="bio-error"
                className="text-danger-text mt-1 text-sm font-semibold"
              >
                {errorText(errors.bio)}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="locale" className="font-semibold">
              {t("settings.profile.language")}
            </label>
            <select
              id="locale"
              name="locale"
              defaultValue={profile.locale}
              aria-invalid={errors.locale ? true : undefined}
              aria-describedby={errors.locale ? "locale-error" : undefined}
              className={inputClass}
            >
              {supportedLanguages.map((locale) => (
                <option key={locale} value={locale} lang={locale}>
                  {localeNames[locale]}
                </option>
              ))}
            </select>
            {errors.locale ? (
              <p
                id="locale-error"
                className="text-danger-text mt-1 text-sm font-semibold"
              >
                {errorText(errors.locale)}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="privacy" className="font-semibold">
              {t("settings.profile.privacy")}
            </label>
            <select
              id="privacy"
              name="privacy"
              defaultValue={profile.privacy}
              aria-invalid={errors.privacy ? true : undefined}
              aria-describedby={errors.privacy ? "privacy-error" : undefined}
              className={inputClass}
            >
              {privacyLevels.map((level) => (
                <option key={level} value={level}>
                  {t(`settings.profile.privacyOptions.${level}`)}
                </option>
              ))}
            </select>
            {errors.privacy ? (
              <p
                id="privacy-error"
                className="text-danger-text mt-1 text-sm font-semibold"
              >
                {errorText(errors.privacy)}
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="bg-accent text-accent-fg focus-visible:outline-accent rounded-md px-4 py-2 font-semibold transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 active:brightness-90 disabled:opacity-60"
          >
            {saving ? t("settings.profile.saving") : t("settings.profile.save")}
          </button>
        </Form>

        <section
          id="data"
          aria-labelledby="data-title"
          className="mt-12 scroll-mt-4"
        >
          <h2 id="data-title" className="text-2xl font-bold">
            {t("settings.data.title")}
          </h2>
          <p className="text-fg-muted mt-2">{t("settings.data.description")}</p>
          {/* A plain form: the browser asks for the file and saves it, and the page stays. */}
          <Form
            method="post"
            action="/settings/export"
            reloadDocument
            className="mt-4 flex flex-wrap gap-3"
          >
            <button
              type="submit"
              name="format"
              value="json"
              className={secondaryButtonClass}
            >
              {t("settings.data.json")}
            </button>
            <button
              type="submit"
              name="format"
              value="csv"
              className={secondaryButtonClass}
            >
              {t("settings.data.csv")}
            </button>
          </Form>
          {/* A plain link: the import page has its own security policy, which only a new
              document gets. */}
          <p className="mt-4">
            <a href="/settings/import" className="text-accent underline">
              {t("settings.data.import")}
            </a>
          </p>
        </section>

        <section
          id="delete"
          aria-labelledby="delete-title"
          className="border-danger-edge mt-12 scroll-mt-4 rounded-md border p-6"
        >
          <h2 id="delete-title" className="text-2xl font-bold">
            {t("settings.delete.title")}
          </h2>
          <p className="mt-2">{t("settings.delete.description")}</p>
          <p className="mt-2">{t("settings.delete.usernameFreed")}</p>
          {deleteError ? (
            <p
              role="alert"
              className="border-danger-edge bg-danger-bg text-danger-fg mt-4 rounded-md border px-4 py-3 font-semibold"
            >
              {t(`settings.delete.errors.${deleteError}`)}
            </p>
          ) : null}
          <deleter.Form
            method="post"
            action="/settings/delete"
            className="mt-4 space-y-4"
          >
            <div>
              <label htmlFor="confirm" className="font-semibold">
                {t("settings.delete.confirmLabel", {
                  username: profile.username,
                })}
              </label>
              <input
                id="confirm"
                name="confirm"
                autoComplete="off"
                required
                className={inputClass}
              />
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="understood"
                required
                className="shrink-0"
              />
              {t("settings.delete.understood")}
            </label>
            <button
              type="submit"
              disabled={deleting}
              className="border-danger-edge bg-danger-bg text-danger-fg focus-visible:outline-accent rounded-md border px-4 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
            >
              {deleting
                ? t("settings.delete.submitting")
                : t("settings.delete.submit")}
            </button>
          </deleter.Form>
        </section>
      </main>
    </ClerkSession>
  );
}
