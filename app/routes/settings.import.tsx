import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data, Form, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/settings.import";
import { BackLink } from "~/components/BackLink";
import { ClerkSession } from "~/components/ClerkSession";
import { MeterBar } from "~/components/Progress";
import { ProfilePagination } from "~/components/ProfilePagination";
import { primaryButtonClass, secondaryLinkClass } from "~/lib/ui";
import { getInstance, getLocale } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import { readForm } from "~server/http/body";
import { latestImportProgress, skippedShown } from "~server/db/import-queue";
import { maxPage } from "~server/db/people-lists";
import { pageParam } from "~server/http/page-param";
import { previewImport, runImport } from "~server/library/import";
import {
  maxImportBytes,
  maxImportEntries,
  parseImportFile,
  type ParseError,
  type Skipped,
} from "~server/library/import-file";
import { titleFetchesPerDay } from "~server/db/title-budget";
import { rateLimit } from "~server/rate-limit";
import {
  getClerkKeys,
  getDb,
  getMediaProviders,
  getWriteLimiter,
} from "~server/runtime-env";
import { mergePrivateHeaders, privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";

// The file, or the file again when the person confirms, plus a few short fields.
const maxFormBytes = maxImportBytes + 16 * 1024;

// Each code has its text in app/locales, under settings.import.errors.
type ErrorCode = ParseError | "file_missing" | "file_too_large" | "generic";

const formSchema = z.strictObject({
  intent: z.enum(["preview", "confirm"]),
  file: z.instanceof(File).optional(),
  payload: z.string().optional(),
  replace: z.literal("on").optional(),
  keepVisibility: z.literal("on").optional(),
});

const fail = (error: ErrorCode, status = 400) =>
  data({ ok: false as const, error }, { status, headers: privateHeaders });

export async function loader(args: Route.LoaderArgs) {
  const user = await requireUser(args);
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const { t } = getInstance(args.context);
  // What the latest import did and what still waits for the background queue (SAG-241).
  // The titles that did not come in are listed a page at a time (`?page=`).
  const skippedPage = pageParam(args.request, maxPage);
  const progress = await latestImportProgress(
    await getDb(),
    user.id,
    skippedPage,
  );
  // Adds Clerk's state for this page, so Clerk's script can renew the session (ClerkSession).
  return rootAuthLoader(args, () => ({
    title: t("settings.import.title"),
    publishableKey: keys.publishableKey,
    perDay: titleFetchesPerDay,
    skippedPage,
    progress: progress
      ? { ...progress, createdAt: progress.createdAt.toISOString() }
      : null,
  }));
}

export const headers = mergePrivateHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    // A page about one person's account has nothing to show a search engine.
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function action(args: Route.ActionArgs) {
  const { request } = args;

  // A page on another site must not be able to write into someone's library.
  const unsafe = checkWrite(request, maxFormBytes);
  if (unsafe) {
    return unsafe === "too_large"
      ? fail("file_too_large", 413)
      : fail("generic", 403);
  }

  // The person is the one in the verified session, never something that is in the file.
  const user = await requireUser(args);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `import:${user.id}`,
  );
  if (limited) return limited;

  const parsedForm = formSchema.safeParse(
    await readForm(request, maxFormBytes),
  );
  if (!parsedForm.success) return fail("generic");
  const form = parsedForm.data;

  let text: string;
  if (form.intent === "preview") {
    if (!form.file || form.file.size === 0) return fail("file_missing");
    if (form.file.size > maxImportBytes) return fail("file_too_large", 413);
    text = await form.file.text();
  } else {
    if (form.payload === undefined) return fail("file_missing");
    text = form.payload;
  }

  // The file is read again at every step: nothing from the preview is trusted.
  const parsed = parseImportFile(text);
  if (!parsed.ok) return fail(parsed.error);

  const deps = { db: await getDb(), providers: getMediaProviders() };
  if (form.intent === "preview") {
    return data(
      {
        ok: true as const,
        step: "preview" as const,
        preview: await previewImport(deps, user.id, parsed.value),
        payload: text,
      },
      { headers: privateHeaders },
    );
  }
  // The titles we hold are written now; the ones only a provider knows wait in the queue, which
  // the scheduled job saves inside the per-person budget (ADR-047).
  return data(
    {
      ok: true as const,
      step: "done" as const,
      result: await runImport(deps, user.id, parsed.value, {
        replace: form.replace === "on",
        keepVisibility: form.keepVisibility === "on",
        locale: getLocale(args.context) === "en" ? "en" : "es",
      }),
    },
    { headers: privateHeaders },
  );
}

const inputClass =
  "border-input-edge bg-surface text-fg focus-visible:outline-accent mt-1 block w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2";
function SkippedList({
  skipped,
  total = skipped.length,
  paging,
}: {
  skipped: Skipped[];
  /** All the titles left out, when `skipped` holds only some of them. */
  total?: number;
  /** The latest import lists them all, a page at a time; a result before the queue lists 50. */
  paging?: { page: number; pathTo: (page: number) => string };
}) {
  const { t } = useTranslation();
  if (skipped.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="font-semibold">{t("settings.import.skipped")}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-6">
        {skipped.slice(0, skippedShown).map((item, index) => (
          <li key={index} className="break-words">
            {t("settings.import.skippedLine", {
              title: item.title || t("settings.import.untitled"),
              reason: t(`settings.import.reasons.${item.reason}`),
            })}
          </li>
        ))}
      </ul>
      {paging ? (
        <ProfilePagination
          page={paging.page}
          hasMore={paging.page * skippedShown < total}
          pathTo={paging.pathTo}
          label={t("settings.import.skipped")}
          plain
        />
      ) : total > 50 ? (
        <p className="text-fg-muted mt-2 text-sm">
          {t("settings.import.skippedMore", { count: total - 50 })}
        </p>
      ) : null}
    </div>
  );
}

type Progress = {
  total: number;
  pending: number;
  skippedCount: number;
  skipped: Skipped[];
};

/**
 * What the latest import did: how many titles are in the library, how many still wait for the
 * background queue, and which ones could not be imported and why (SAG-241).
 */
function ImportProgress({
  progress,
  perDay,
  skippedPage,
}: {
  progress: Progress;
  perDay: number;
  skippedPage: number;
}) {
  const { t } = useTranslation();
  const inLibrary = progress.total - progress.pending - progress.skippedCount;
  // Titles dealt with: in the library or listed as a problem. It reaches 100% when the import ends.
  const resolved = progress.total - progress.pending;
  const percent =
    progress.total > 0 ? Math.floor((resolved / progress.total) * 100) : 100;
  return (
    <section className="mt-8" aria-labelledby="import-progress">
      <h2 id="import-progress" className="text-xl font-semibold">
        {t("settings.import.progress.title")}
      </h2>
      <p className="mt-2">
        {t("settings.import.progress.count", {
          done: inLibrary,
          total: progress.total,
        })}
      </p>
      {progress.pending > 0 ? (
        <div className="mt-2">
          <MeterBar value={resolved} max={progress.total} className="" />
          <p className="text-fg-muted mt-1 text-sm">
            {t("settings.import.progress.percent", { percent })}
          </p>
        </div>
      ) : null}
      <p className="text-fg-muted mt-1">
        {progress.pending > 0
          ? t("settings.import.progress.waiting", {
              count: progress.pending,
              max: perDay,
            })
          : t("settings.import.progress.finished")}
      </p>
      {progress.skippedCount > 0 ? (
        <div className="mt-4">
          <p className="border-danger-edge bg-danger-bg text-danger-fg rounded-md border px-4 py-3 font-semibold">
            {t("settings.import.progress.problems", {
              count: progress.skippedCount,
            })}
          </p>
          <SkippedList
            skipped={progress.skipped}
            total={progress.skippedCount}
            paging={{
              page: skippedPage,
              pathTo: (page) => `/settings/import?page=${page}#import-progress`,
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

export default function SettingsImport({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-2xl px-4 py-10">
        <p>
          {/* A plain link: the settings page has its own security policy, which only a new
              document gets. */}
          <BackLink to="/settings/profile#data">
            {t("settings.import.back")}
          </BackLink>
        </p>
        <h1 className="mt-4 text-3xl font-bold">
          {t("settings.import.title")}
        </h1>
        <p className="text-fg-muted mt-2">{t("settings.import.description")}</p>

        {actionData?.ok === false ? (
          <p
            role="alert"
            className="border-danger-edge bg-danger-bg text-danger-fg mt-6 rounded-md border px-4 py-3 font-semibold"
          >
            {t(`settings.import.errors.${actionData.error}`, {
              max: maxImportEntries,
              mb: maxImportBytes / (1024 * 1024),
            })}
          </p>
        ) : null}

        {loaderData.progress ? (
          <ImportProgress
            progress={loaderData.progress}
            perDay={loaderData.perDay}
            skippedPage={loaderData.skippedPage}
          />
        ) : null}

        {actionData?.ok === true && actionData.step === "done" ? (
          <section className="mt-8" role="status">
            <h2 className="text-xl font-semibold">
              {t("settings.import.done.title")}
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                {t("settings.import.done.added", {
                  count: actionData.result.added,
                })}
              </li>
              {actionData.result.replaced > 0 ? (
                <li>
                  {t("settings.import.done.replaced", {
                    count: actionData.result.replaced,
                  })}
                </li>
              ) : null}
              {actionData.result.kept > 0 ? (
                <li>
                  {t("settings.import.done.kept", {
                    count: actionData.result.kept,
                  })}
                </li>
              ) : null}
              {actionData.result.queued > 0 ? (
                <li>
                  {t("settings.import.done.queued", {
                    count: actionData.result.queued,
                  })}
                </li>
              ) : null}
            </ul>
            <p className="mt-4">
              {/* A plain link: the library has its own security policy. */}
              <a href="/library" className={secondaryLinkClass}>
                {t("settings.import.done.library")}
              </a>
            </p>
          </section>
        ) : null}

        {actionData?.ok === true && actionData.step === "preview" ? (
          <section className="mt-8">
            <h2 className="text-xl font-semibold">
              {t("settings.import.preview.title")}
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                {t("settings.import.preview.add", {
                  count: actionData.preview.add,
                })}
              </li>
              <li>
                {t("settings.import.preview.exists", {
                  count: actionData.preview.exists,
                })}
              </li>
              {actionData.preview.fetch > 0 ? (
                <li>
                  {t("settings.import.preview.fetch", {
                    count: actionData.preview.fetch,
                    max: actionData.preview.perDay,
                  })}
                </li>
              ) : null}
              {actionData.preview.shared.public > 0 ? (
                <li>
                  {t("settings.import.preview.sharedPublic", {
                    count: actionData.preview.shared.public,
                  })}
                </li>
              ) : null}
              {actionData.preview.shared.friends > 0 ? (
                <li>
                  {t("settings.import.preview.sharedFriends", {
                    count: actionData.preview.shared.friends,
                  })}
                </li>
              ) : null}
            </ul>
            <SkippedList skipped={actionData.preview.skipped} />
            <Form method="post" className="mt-6 space-y-4">
              <input type="hidden" name="intent" value="confirm" />
              <input type="hidden" name="payload" value={actionData.payload} />
              <div className="flex items-start gap-3">
                <input
                  id="replace"
                  name="replace"
                  type="checkbox"
                  className="mt-1 h-5 w-5 shrink-0"
                  aria-describedby="replace-hint"
                />
                <div>
                  <label htmlFor="replace" className="font-semibold">
                    {t("settings.import.replace")}
                  </label>
                  <p id="replace-hint" className="text-fg-muted text-sm">
                    {t("settings.import.replaceHint")}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <input
                  id="keepVisibility"
                  name="keepVisibility"
                  type="checkbox"
                  className="mt-1 h-5 w-5 shrink-0"
                  aria-describedby="keepVisibility-hint"
                />
                <div>
                  <label htmlFor="keepVisibility" className="font-semibold">
                    {t("settings.import.keepVisibility")}
                  </label>
                  <p id="keepVisibility-hint" className="text-fg-muted text-sm">
                    {t("settings.import.keepVisibilityHint")}
                  </p>
                </div>
              </div>
              <button
                type="submit"
                disabled={busy}
                className={primaryButtonClass}
              >
                {busy
                  ? t("settings.import.importing")
                  : t("settings.import.confirm")}
              </button>
            </Form>
          </section>
        ) : null}

        <Form
          method="post"
          encType="multipart/form-data"
          className="mt-8 space-y-4"
        >
          <input type="hidden" name="intent" value="preview" />
          <div>
            <label htmlFor="file" className="font-semibold">
              {t("settings.import.file")}
            </label>
            <input
              id="file"
              name="file"
              type="file"
              accept="application/json,.json"
              required
              aria-describedby="file-hint"
              className={inputClass}
            />
            <p id="file-hint" className="text-fg-muted mt-1 text-sm">
              {t("settings.import.fileHint", {
                max: maxImportEntries,
                mb: maxImportBytes / (1024 * 1024),
              })}
            </p>
          </div>
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {busy
              ? t("settings.import.previewing")
              : t("settings.import.previewButton")}
          </button>
        </Form>
      </main>
    </ClerkSession>
  );
}
