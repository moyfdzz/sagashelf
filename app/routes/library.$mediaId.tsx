import { rootAuthLoader } from "@clerk/react-router/server";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import type { ZodError } from "zod";

import type { Route } from "./+types/library.$mediaId";
import { ClerkSession } from "~/components/ClerkSession";
import { StatusToast } from "~/components/StatusToast";
import { useFormatters } from "~/lib/format";
import { getInstance, getLocale } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import {
  getEntry,
  getSeasonCounts,
  removeEntry,
  rewatchEntry,
  saveEntry,
  totalEpisodes,
} from "~server/db/library";
import {
  addViewing,
  listViewings,
  removeViewing,
  saveViewing,
} from "~server/db/viewings";
import { imageSrc } from "~server/images/sources";
import {
  applyRewatch,
  applySave,
  locateProgress,
  timesWatched,
} from "~server/library/rules";
import {
  libraryActionSchema,
  libraryStatuses,
  notesMaxLength,
  viewingNotesMaxLength,
  visibilityLevels,
} from "~server/library/schema";
import { mediaPath } from "~server/media/slug";
import { rateLimit } from "~server/rate-limit";
import { getClerkKeys, getDb, getWriteLimiter } from "~server/runtime-env";
import { readForm } from "~server/http/body";
import { z } from "zod";

// The form has a few short fields and the notes (2000 characters, up to 4 bytes each).
const maxFormBytes = 16 * 1024;

// Pages and answers that carry a person's data are never kept by a shared cache.
const privateHeaders = { "Cache-Control": "private, no-store" };

const mediaIdSchema = z.uuid();

// Each code has its text in app/locales, under library.errors.
type ErrorCode =
  | "invalid"
  | "progress_too_high"
  | "dates_order"
  | "notes_too_long"
  | "not_completed"
  | "viewings_limit"
  | "generic";

type Field =
  | "status"
  | "progress"
  | "score"
  | "startedAt"
  | "finishedAt"
  | "notes"
  | "visibility"
  | "viewStartedOn"
  | "viewFinishedOn"
  | "viewNotes"
  | "viewings"
  | "form";

type FieldErrors = Partial<Record<Field, ErrorCode>>;

const fields: readonly Field[] = [
  "status",
  "progress",
  "score",
  "startedAt",
  "finishedAt",
  "notes",
  "visibility",
  "viewStartedOn",
  "viewFinishedOn",
  "viewNotes",
];

/** One error code per field, never the text or the value that was sent. */
function fieldErrors(error: ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (!fields.includes(field as Field)) {
      // A field the form does not have: someone is not using the form.
      errors.form = "generic";
    } else if (field === "notes" && issue.message === "notes_too_long") {
      errors.notes = "notes_too_long";
    } else if (field === "viewNotes" && issue.message === "notes_too_long") {
      errors.viewNotes = "notes_too_long";
    } else if (field === "viewFinishedOn" && issue.message === "dates_order") {
      errors.viewFinishedOn = "dates_order";
    } else {
      errors[field as Field] = "invalid";
    }
  }
  return errors;
}

const notTheForm: FieldErrors = { form: "generic" };

// Answering before the body is read leaves it open (see settings.profile.tsx).
async function answerWithoutReading<T>(request: Request, response: T) {
  await request.arrayBuffer().catch(() => undefined);
  return response;
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

export async function loader(args: Route.LoaderArgs) {
  const user = await requireUser(args);
  const mediaId = mediaIdSchema.safeParse(args.params.mediaId);
  if (!mediaId.success) throw data(null, { status: 404 });

  const db = await getDb();
  const locale = getLocale(args.context) === "en" ? "en" : "es";
  const entry = await getEntry(db, user.id, mediaId.data, locale);
  // Somebody else's entry and no entry at all look the same.
  if (!entry) throw data(null, { status: 404 });
  const seasons = await getSeasonCounts(db, mediaId.data);
  const viewings = await listViewings(db, user.id, mediaId.data);

  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const { t } = getInstance(args.context);
  // Adds Clerk's state for this page, so Clerk's script can renew the session (ClerkSession).
  return rootAuthLoader(args, () => ({
    title: t("library.title"),
    publishableKey: keys.publishableKey,
    entry: {
      mediaId: entry.mediaId,
      status: entry.status,
      progress: entry.progress,
      score: entry.score,
      startedAt: entry.startedAt,
      finishedAt: entry.finishedAt,
      notes: entry.notes,
      visibility: entry.visibility,
    },
    media: {
      title: entry.title,
      type: entry.type,
      year: entry.year,
      poster: imageSrc(entry.imageUrl, "w185"),
      detailPath: mediaPath(
        entry.type as Parameters<typeof mediaPath>[0],
        entry.title,
        entry.mediaId,
      ),
    },
    viewings,
    timesWatched: timesWatched(viewings.length, entry.status),
    totalEpisodes: totalEpisodes(seasons),
    progressAt: locateProgress(seasons, entry.progress),
  }));
}

export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
  const merged = new Headers(loaderHeaders);
  actionHeaders.forEach((value, key) => merged.set(key, value));
  merged.set("Cache-Control", "private, no-store");
  return merged;
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    // A page about one person's entries has nothing to show a search engine.
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

  // A page on another site must not be able to change someone's library.
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
    `library:${user.id}`,
  );
  if (limited) return answerWithoutReading(request, limited);

  const mediaId = mediaIdSchema.safeParse(args.params.mediaId);
  if (!mediaId.success) throw data(null, { status: 404 });

  const parsed = libraryActionSchema.safeParse(
    await readForm(request, maxFormBytes),
  );
  if (!parsed.success) {
    return data(
      { ok: false as const, errors: fieldErrors(parsed.error) },
      { status: 400, headers: privateHeaders },
    );
  }

  const db = await getDb();

  if (parsed.data.intent === "remove") {
    await removeEntry(db, user.id, mediaId.data);
    return redirect("/library", { status: 303, headers: privateHeaders });
  }

  const intent = parsed.data.intent;
  if (
    intent === "viewing_add" ||
    intent === "viewing_save" ||
    intent === "viewing_remove"
  ) {
    const form = parsed.data;
    const viewing =
      "viewStartedOn" in form
        ? {
            startedOn: form.viewStartedOn,
            finishedOn: form.viewFinishedOn,
            notes: form.viewNotes,
          }
        : null;
    if (intent === "viewing_add" && viewing) {
      const added = await addViewing(db, user.id, mediaId.data, viewing);
      if (added === "missing") throw data(null, { status: 404 });
      if (added === "limit") {
        return data(
          {
            ok: false as const,
            errors: { viewings: "viewings_limit" } as FieldErrors,
          },
          { status: 400, headers: privateHeaders },
        );
      }
    } else if (intent === "viewing_save" && viewing && "viewingId" in form) {
      if (
        !(await saveViewing(db, user.id, mediaId.data, form.viewingId, viewing))
      ) {
        throw data(null, { status: 404 });
      }
    } else if (intent === "viewing_remove" && "viewingId" in form) {
      if (!(await removeViewing(db, user.id, mediaId.data, form.viewingId))) {
        throw data(null, { status: 404 });
      }
    }
    return data(
      { ok: true as const, saved: intent, savedAt: Date.now() },
      { headers: privateHeaders },
    );
  }

  const current = await getEntry(
    db,
    user.id,
    mediaId.data,
    getLocale(args.context) === "en" ? "en" : "es",
  );
  if (!current) throw data(null, { status: 404 });

  const result =
    parsed.data.intent === "rewatch"
      ? applyRewatch(current, { today: todayUtc() })
      : applySave(current, parsed.data, {
          totalEpisodes: totalEpisodes(await getSeasonCounts(db, mediaId.data)),
          today: todayUtc(),
        });
  if (!result.ok) {
    const errors: FieldErrors =
      result.error === "progress_too_high"
        ? { progress: "progress_too_high" }
        : result.error === "dates_order"
          ? { finishedAt: "dates_order" }
          : { form: "not_completed" };
    return data(
      { ok: false as const, errors },
      { status: 400, headers: privateHeaders },
    );
  }

  if (parsed.data.intent === "rewatch") {
    // The run that ends goes into the history in the same statement that restarts the entry.
    if (!(await rewatchEntry(db, user.id, mediaId.data, result.next))) {
      return data(
        {
          ok: false as const,
          errors: { viewings: "viewings_limit" } as FieldErrors,
        },
        { status: 400, headers: privateHeaders },
      );
    }
  } else if (!(await saveEntry(db, user.id, mediaId.data, result.next))) {
    throw data(null, { status: 404 });
  }
  return data(
    {
      ok: true as const,
      saved: parsed.data.intent === "rewatch" ? "rewatch" : "save",
      savedAt: Date.now(),
    },
    { headers: privateHeaders },
  );
}

const inputClass =
  "border-input-edge bg-surface text-fg focus-visible:outline-accent mt-1 block w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2";
const secondaryButtonClass =
  "border-input-edge bg-surface text-fg focus-visible:outline-accent rounded-md border px-4 py-2 font-semibold hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2";
const primaryButtonClass =
  "bg-accent text-accent-fg focus-visible:outline-accent rounded-md px-4 py-2 font-semibold transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60";

export default function LibraryEntry({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  // The finish date can only be set while the status is "completed".
  const [status, setStatus] = useState(loaderData.entry.status);
  const { formatDate } = useFormatters();
  const {
    entry,
    media,
    viewings,
    timesWatched: watchedCount,
    totalEpisodes: total,
    progressAt,
  } = loaderData;
  const dayText = (value: string) =>
    formatDate(Date.parse(`${value}T00:00:00Z`));
  const viewingDates = (from: string | null, to: string | null) =>
    t("library.editor.viewings.dates", {
      context: from && to ? "range" : from ? "from" : to ? "to" : "none",
      from: from ? dayText(from) : "",
      to: to ? dayText(to) : "",
    });
  const errors: FieldErrors = actionData?.ok === false ? actionData.errors : {};
  const hasErrors = Object.keys(errors).length > 0;
  // The errors of the three viewing forms are shown once, above the list.
  const viewingError =
    errors.viewings ??
    errors.viewFinishedOn ??
    errors.viewStartedOn ??
    errors.viewNotes;
  const errorText = (code: ErrorCode) => t(`library.errors.${code}`);

  const fieldError = (field: Field) =>
    errors[field] ? (
      <p
        id={`${field}-error`}
        className="text-danger-text mt-1 text-sm font-semibold"
      >
        {errorText(errors[field])}
      </p>
    ) : null;
  const invalid = (field: Field, hint?: string) => ({
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby":
      [hint, errors[field] ? `${field}-error` : undefined]
        .filter(Boolean)
        .join(" ") || undefined,
  });

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-2xl px-4 py-10">
        <p>
          <Link to="/library" className="text-accent underline">
            {t("library.editor.back")}
          </Link>
        </p>

        <div className="mt-4 flex gap-4">
          {media.poster ? (
            <img
              src={media.poster}
              alt={t("media.posterAlt", { title: media.title })}
              width={96}
              height={144}
              className="border-border h-36 w-24 shrink-0 rounded-md border"
            />
          ) : null}
          <div>
            <h1 className="text-3xl font-bold">{media.title}</h1>
            <p className="text-fg-muted mt-1 font-semibold">
              {t(`media.kinds.${media.type as "movie"}`)}
              {media.year ? ` ${t("search.year", { year: media.year })}` : ""}
            </p>
            <p className="mt-2">
              <a href={media.detailPath} className="text-accent underline">
                {t("library.editor.viewTitle")}
              </a>
            </p>
          </div>
        </div>

        {/* Always in the page, so a screen reader announces each message that appears in it. */}
        <div
          role="status"
          className="pointer-events-none fixed inset-x-4 top-20 z-50 sm:right-6 sm:left-auto sm:w-96"
        >
          {actionData?.ok === true ? (
            <StatusToast key={actionData.savedAt}>
              {actionData.saved === "rewatch"
                ? t("library.editor.rewatched")
                : actionData.saved === "viewing_add" ||
                    actionData.saved === "viewing_save" ||
                    actionData.saved === "viewing_remove"
                  ? t(`library.editor.viewings.toast.${actionData.saved}`)
                  : t("library.editor.saved")}
            </StatusToast>
          ) : null}
        </div>
        {hasErrors ? (
          <p
            role="alert"
            className="border-danger-edge bg-danger-bg text-danger-fg mt-6 rounded-md border px-4 py-3 font-semibold"
          >
            {errors.form ? errorText(errors.form) : t("library.errors.summary")}
          </p>
        ) : null}

        {/* A key from the saved values makes the fields show what was stored after a save. */}
        <Form
          method="post"
          key={JSON.stringify(entry)}
          className="mt-8 space-y-6"
        >
          <input type="hidden" name="intent" value="save" />

          <div>
            <label htmlFor="status" className="font-semibold">
              {t("library.editor.status")}
            </label>
            <select
              id="status"
              name="status"
              defaultValue={entry.status}
              onChange={(event) =>
                setStatus(event.target.value as typeof entry.status)
              }
              {...invalid("status")}
              className={inputClass}
            >
              {libraryStatuses.map((status) => (
                <option key={status} value={status}>
                  {t(`library.status.${status}`)}
                </option>
              ))}
            </select>
            {fieldError("status")}
          </div>

          {total > 0 ? (
            <div>
              <label htmlFor="progress" className="font-semibold">
                {t("library.editor.progress")}
              </label>
              <input
                id="progress"
                name="progress"
                type="number"
                inputMode="numeric"
                min={0}
                max={total}
                defaultValue={entry.progress}
                {...invalid("progress", "progress-hint")}
                className={inputClass}
              />
              <p id="progress-hint" className="text-fg-muted mt-1 text-sm">
                {t("library.editor.progressHint", { total })}
                {progressAt
                  ? ` ${t("library.editor.progressAt", progressAt)}`
                  : ""}
              </p>
              {fieldError("progress")}
            </div>
          ) : (
            // A title with no episodes (a movie) keeps its progress as it is.
            <input type="hidden" name="progress" value={entry.progress} />
          )}

          <div>
            <label htmlFor="score" className="font-semibold">
              {t("library.editor.score")}
            </label>
            <select
              id="score"
              name="score"
              defaultValue={entry.score ?? ""}
              {...invalid("score")}
              className={inputClass}
            >
              <option value="">{t("library.editor.noScore")}</option>
              {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((score) => (
                <option key={score} value={score}>
                  {t("library.editor.scoreOption", { score })}
                </option>
              ))}
            </select>
            {fieldError("score")}
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label htmlFor="startedAt" className="font-semibold">
                {t("library.editor.startedAt")}
              </label>
              <input
                id="startedAt"
                name="startedAt"
                type="date"
                defaultValue={entry.startedAt ?? ""}
                {...invalid("startedAt")}
                className={inputClass}
              />
              {fieldError("startedAt")}
            </div>
            <div>
              <label htmlFor="finishedAt" className="font-semibold">
                {t("library.editor.finishedAt")}
              </label>
              <input
                id="finishedAt"
                name="finishedAt"
                type="date"
                defaultValue={entry.finishedAt ?? ""}
                disabled={status !== "completed"}
                {...invalid("finishedAt", "finishedAt-hint")}
                className={`${inputClass} disabled:opacity-60`}
              />
              <p id="finishedAt-hint" className="text-fg-muted mt-1 text-sm">
                {t("library.editor.finishedAtHint")}
              </p>
              {fieldError("finishedAt")}
            </div>
          </div>

          <div>
            <label htmlFor="notes" className="font-semibold">
              {t("library.editor.notes")}
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={5}
              maxLength={notesMaxLength}
              defaultValue={entry.notes ?? ""}
              {...invalid("notes", "notes-hint")}
              className={inputClass}
            />
            <p id="notes-hint" className="text-fg-muted mt-1 text-sm">
              {t("library.editor.notesHint", { max: notesMaxLength })}
            </p>
            {fieldError("notes")}
          </div>

          <div>
            <label htmlFor="visibility" className="font-semibold">
              {t("library.editor.visibility")}
            </label>
            <select
              id="visibility"
              name="visibility"
              defaultValue={entry.visibility}
              {...invalid("visibility", "visibility-hint")}
              className={inputClass}
            >
              {visibilityLevels.map((level) => (
                <option key={level} value={level}>
                  {t(`library.editor.visibilityOptions.${level}`)}
                </option>
              ))}
            </select>
            <p id="visibility-hint" className="text-fg-muted mt-1 text-sm">
              {t("library.editor.visibilityHint")}
            </p>
            {fieldError("visibility")}
          </div>

          <button
            type="submit"
            disabled={saving}
            className={primaryButtonClass}
          >
            {saving ? t("library.editor.saving") : t("library.editor.save")}
          </button>
        </Form>

        <section className="border-border mt-10 border-t pt-6">
          <h2 className="text-xl font-semibold">
            {t("library.editor.viewings.title")}
          </h2>
          <p className="text-fg-muted mt-1">
            {t("library.editor.viewings.count", { count: watchedCount })}
          </p>
          {viewingError ? (
            <p role="alert" className="text-danger-text mt-2 font-semibold">
              {errorText(viewingError)}
            </p>
          ) : null}
          {viewings.length === 0 ? (
            <p className="text-fg-muted mt-3 text-sm">
              {t("library.editor.viewings.empty")}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {viewings.map((viewing) => (
                <li
                  key={viewing.id}
                  className="border-border bg-surface-raised rounded-md border"
                >
                  <details>
                    <summary className="cursor-pointer px-4 py-3">
                      <span className="font-semibold">
                        {viewingDates(viewing.startedOn, viewing.finishedOn)}
                      </span>
                      {viewing.notes ? (
                        <span className="text-fg-muted block text-sm">
                          {viewing.notes}
                        </span>
                      ) : null}
                    </summary>
                    <Form
                      method="post"
                      key={JSON.stringify(viewing)}
                      className="border-border space-y-4 border-t px-4 py-4"
                    >
                      <input
                        type="hidden"
                        name="viewingId"
                        value={viewing.id}
                      />
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label
                            htmlFor={`viewStartedOn-${viewing.id}`}
                            className="font-semibold"
                          >
                            {t("library.editor.startedAt")}
                          </label>
                          <input
                            id={`viewStartedOn-${viewing.id}`}
                            name="viewStartedOn"
                            type="date"
                            defaultValue={viewing.startedOn ?? ""}
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`viewFinishedOn-${viewing.id}`}
                            className="font-semibold"
                          >
                            {t("library.editor.finishedAt")}
                          </label>
                          <input
                            id={`viewFinishedOn-${viewing.id}`}
                            name="viewFinishedOn"
                            type="date"
                            defaultValue={viewing.finishedOn ?? ""}
                            className={inputClass}
                          />
                        </div>
                      </div>
                      <div>
                        <label
                          htmlFor={`viewNotes-${viewing.id}`}
                          className="font-semibold"
                        >
                          {t("library.editor.viewings.notes")}
                        </label>
                        <textarea
                          id={`viewNotes-${viewing.id}`}
                          name="viewNotes"
                          rows={2}
                          maxLength={viewingNotesMaxLength}
                          defaultValue={viewing.notes ?? ""}
                          className={inputClass}
                        />
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="submit"
                          name="intent"
                          value="viewing_save"
                          className={primaryButtonClass}
                        >
                          {t("library.editor.viewings.save")}
                        </button>
                        <button
                          type="submit"
                          name="intent"
                          value="viewing_remove"
                          className={secondaryButtonClass}
                        >
                          {t("library.editor.viewings.remove")}
                        </button>
                      </div>
                    </Form>
                  </details>
                </li>
              ))}
            </ul>
          )}

          <details className="border-border mt-4 rounded-md border">
            <summary className="cursor-pointer px-4 py-3 font-semibold">
              {t("library.editor.viewings.add")}
            </summary>
            <Form
              method="post"
              key={`add-${viewings.length}`}
              className="border-border space-y-4 border-t px-4 py-4"
            >
              <input type="hidden" name="intent" value="viewing_add" />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="viewStartedOn" className="font-semibold">
                    {t("library.editor.startedAt")}
                  </label>
                  <input
                    id="viewStartedOn"
                    name="viewStartedOn"
                    type="date"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="viewFinishedOn" className="font-semibold">
                    {t("library.editor.finishedAt")}
                  </label>
                  <input
                    id="viewFinishedOn"
                    name="viewFinishedOn"
                    type="date"
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="viewNotes" className="font-semibold">
                  {t("library.editor.viewings.notes")}
                </label>
                <textarea
                  id="viewNotes"
                  name="viewNotes"
                  rows={2}
                  maxLength={viewingNotesMaxLength}
                  aria-describedby="viewNotes-hint"
                  className={inputClass}
                />
                <p id="viewNotes-hint" className="text-fg-muted mt-1 text-sm">
                  {t("library.editor.viewings.notesHint", {
                    max: viewingNotesMaxLength,
                  })}
                </p>
              </div>
              <button type="submit" className={primaryButtonClass}>
                {t("library.editor.viewings.addSubmit")}
              </button>
            </Form>
          </details>

          {entry.status === "completed" ? (
            <Form method="post" className="mt-3 space-y-2">
              <input type="hidden" name="intent" value="rewatch" />
              <button type="submit" className={secondaryButtonClass}>
                {t("library.editor.rewatch")}
              </button>
              <p className="text-fg-muted text-sm">
                {t("library.editor.rewatchHint")}
              </p>
            </Form>
          ) : null}
        </section>

        <details className="border-border mt-8 rounded-md border">
          <summary className="cursor-pointer px-4 py-3 font-semibold">
            {t("library.editor.remove.summary")}
          </summary>
          <Form method="post" className="border-border space-y-3 border-t p-4">
            <input type="hidden" name="intent" value="remove" />
            <p>{t("library.editor.remove.warning")}</p>
            <button
              type="submit"
              className="bg-danger-bg text-danger-fg border-danger-edge focus-visible:outline-accent rounded-md border px-4 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {t("library.editor.remove.confirm")}
            </button>
          </Form>
        </details>
      </main>
    </ClerkSession>
  );
}
