import { rootAuthLoader } from "@clerk/react-router/server";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { data, redirect, useNavigation } from "react-router";
import type { ZodError } from "zod";

import type { Route } from "./+types/library.$mediaId";
import { ClerkSession } from "~/components/ClerkSession";
import { AddToList } from "~/components/lists/AddToList";
import { AlertsSection } from "~/components/library-entry/AlertsSection";
import { EntryForm } from "~/components/library-entry/EntryForm";
import { EntryHeader } from "~/components/library-entry/EntryHeader";
import { RemoveEntry } from "~/components/library-entry/RemoveEntry";
import {
  useEntryErrors,
  type Field,
  type FieldErrors,
} from "~/components/library-entry/shared";
import { ViewingsSection } from "~/components/library-entry/ViewingsSection";
import { StatusRegion } from "~/components/StatusRegion";
import { getInstance, getLocale } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import {
  getEntry,
  getSeasonCounts,
  removeEntry,
  rewatchEntry,
  saveEntry,
  setEntryNotifyNewEpisodes,
  totalEpisodes,
} from "~server/db/library";
import { listsForTitle } from "~server/db/list-items";
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
  progressUnitsFor,
  viewingNotesMaxLength,
  visibilityLevels,
} from "~server/library/schema";
import { libraryBackPath } from "~server/library/path";
import { mediaPath } from "~server/media/slug";
import { rateLimit } from "~server/rate-limit";
import { getClerkKeys, getDb, getWriteLimiter } from "~server/runtime-env";
import { readForm } from "~server/http/body";
import { z } from "zod";
import { mergePrivateHeaders, privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";

// The form has a few short fields and the notes (2000 characters, up to 4 bytes each).
const maxFormBytes = 16 * 1024;

const mediaIdSchema = z.uuid();

const fields: readonly Field[] = [
  "status",
  "progress",
  "progressUnit",
  "progressTotal",
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
  const lists = await listsForTitle(db, user.id, mediaId.data);

  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const { t } = getInstance(args.context);
  const url = new URL(args.request.url);
  // The library the person came from, with its tab, filters and pages. Only the first load of the
  // page knows it: when the editor saves, the loader runs again and the `Referer` is this page.
  const backToLibrary = url.pathname.endsWith(".data")
    ? null
    : libraryBackPath(args.request.headers.get("Referer"), url.origin);
  // Adds Clerk's state for this page, so Clerk's script can renew the session (ClerkSession).
  return rootAuthLoader(args, () => ({
    title: t("library.title"),
    backToLibrary,
    publishableKey: keys.publishableKey,
    entry: {
      mediaId: entry.mediaId,
      status: entry.status,
      progress: entry.progress,
      progressUnit: entry.progressUnit,
      progressTotal: entry.progressTotal,
      score: entry.score,
      startedAt: entry.startedAt,
      finishedAt: entry.finishedAt,
      notes: entry.notes,
      visibility: entry.visibility,
      notifyNewEpisodes: entry.notifyNewEpisodes,
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
    lists,
    timesWatched: timesWatched(viewings.length, entry.status),
    totalEpisodes: totalEpisodes(seasons),
    // The units this kind of title can count; empty for those whose total is in the catalog.
    progressUnits: progressUnitsFor(entry.type),
    progressAt: locateProgress(seasons, entry.progress),
  }));
}

export const headers = mergePrivateHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    // A page about one person's entries has nothing to show a search engine.
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function action(args: Route.ActionArgs) {
  const { request } = args;

  // A page on another site must not be able to change someone's library.
  const unsafe = checkWrite(request, maxFormBytes);
  if (unsafe) {
    return unsafe === "too_large"
      ? data({ ok: false as const, errors: notTheForm }, { status: 413 })
      : data({ ok: false as const, errors: notTheForm }, { status: 403 });
  }

  // The person is the one in the verified session, never a field of the form.
  const user = await requireUser(args);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `library:${user.id}`,
  );
  if (limited) return limited;

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

  if (parsed.data.intent === "notify") {
    // The alerts of new episodes of this title (SAG-101): on when the box was ticked, off when it was
    // not, since an unticked box is not sent at all.
    const saved = await setEntryNotifyNewEpisodes(
      db,
      user.id,
      mediaId.data,
      parsed.data.notify === "on",
    );
    // Somebody else's entry and no entry at all look the same.
    if (!saved) throw data(null, { status: 404 });
    return data(
      { ok: true as const, saved: "notify" as const, savedAt: Date.now() },
      { headers: privateHeaders },
    );
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
          type: current.type,
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

  // Written only if the entry is as it was read: a change made at the same time elsewhere (a
  // "+1", the buttons of the title page, another tab) is not undone by this form. A rewatch also
  // puts the run that ends into the history in the same statement that restarts the entry.
  const written =
    parsed.data.intent === "rewatch"
      ? await rewatchEntry(
          db,
          user.id,
          mediaId.data,
          result.next,
          current.version,
        )
      : await saveEntry(
          db,
          user.id,
          mediaId.data,
          result.next,
          current.version,
        );
  if (written === "missing") throw data(null, { status: 404 });
  if (written !== "saved") {
    const errors: FieldErrors =
      written === "conflict"
        ? { form: "conflict" }
        : { viewings: "viewings_limit" };
    return data(
      { ok: false as const, errors },
      {
        status: written === "conflict" ? 409 : 400,
        headers: privateHeaders,
      },
    );
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

/** What the page is given, for the pieces of the page that draw it. */
export type LibraryEntryData = Route.ComponentProps["loaderData"];

// The lists and limits of the entry live in server/, which a component may not import.
const limits = {
  statuses: libraryStatuses,
  visibilityLevels,
  notesMax: notesMaxLength,
  viewingNotesMax: viewingNotesMaxLength,
};

export default function LibraryEntry({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  // Kept from the first load, so saving the entry does not send the person to a plain library.
  const [libraryPathBack] = useState(loaderData.backToLibrary ?? "/library");
  const {
    entry,
    media,
    viewings,
    timesWatched: watchedCount,
    totalEpisodes: total,
    progressUnits: units,
    progressAt,
  } = loaderData;
  const fieldErrors: FieldErrors =
    actionData?.ok === false ? actionData.errors : {};
  const errors = useEntryErrors(fieldErrors, media.type);
  const { context, hasErrors, errorText } = errors;

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-2xl px-4 py-10">
        <EntryHeader media={media} libraryPathBack={libraryPathBack} />

        <StatusRegion
          message={
            actionData?.ok !== true
              ? null
              : actionData.saved === "rewatch"
                ? t("library.editor.rewatched", { context })
                : actionData.saved === "notify"
                  ? t("library.editor.alerts.saved")
                  : actionData.saved === "viewing_add" ||
                      actionData.saved === "viewing_save" ||
                      actionData.saved === "viewing_remove"
                    ? t(`library.editor.viewings.toast.${actionData.saved}`)
                    : t("library.editor.saved")
          }
          messageKey={actionData?.ok === true ? actionData.savedAt : undefined}
        />
        {hasErrors ? (
          <p
            role="alert"
            className="border-danger-edge bg-danger-bg text-danger-fg mt-6 rounded-md border px-4 py-3 font-semibold"
          >
            {fieldErrors.form
              ? errorText(fieldErrors.form)
              : t("library.errors.summary")}
          </p>
        ) : null}

        <EntryForm
          entry={entry}
          units={units}
          total={total}
          progressAt={progressAt}
          saving={saving}
          errors={errors}
          limits={limits}
        />

        <ViewingsSection
          entry={entry}
          viewings={viewings}
          watchedCount={watchedCount}
          errors={errors}
          limits={limits}
        />

        <AddToList mediaId={entry.mediaId} lists={loaderData.lists} />

        {/* Only a series or an anime has episodes to be told about (SAG-101). */}
        {media.type === "series" || media.type === "anime" ? (
          <AlertsSection entry={entry} saving={saving} />
        ) : null}

        <RemoveEntry />
      </main>
    </ClerkSession>
  );
}
