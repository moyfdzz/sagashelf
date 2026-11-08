import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data, Form, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/settings.people";
import { BackLink } from "~/components/BackLink";
import { ClerkSession } from "~/components/ClerkSession";
import { secondaryButtonClass } from "~/lib/ui";
import { getInstance } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import {
  listBlocked,
  listMuted,
  unblockUser,
  unmuteUser,
} from "~server/db/blocks-mutes";
import { type Person } from "~server/db/person";
import { readForm } from "~server/http/body";
import { rateLimit } from "~server/rate-limit";
import { getClerkKeys, getDb, getWriteLimiter } from "~server/runtime-env";
import { mergePrivateHeaders, privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";

// The form has an intent and one username. Anything bigger is not from this page.
const maxFormBytes = 1024;

const formSchema = z.strictObject({
  intent: z.enum(["unblock", "unmute"]),
  username: z.string().min(3).max(30),
});

const fail = (status: number) =>
  data(
    { ok: false as const, error: "invalid_request" as const },
    { status, headers: privateHeaders },
  );

const withAvatar = (person: Person) => ({
  username: person.username,
  displayName: person.displayName,
  avatarUrl: person.avatarUrl?.startsWith("https://") ? person.avatarUrl : null,
});

export async function loader(args: Route.LoaderArgs) {
  const user = await requireUser(args);
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const db = await getDb();
  // Only the people this person blocked or muted: nobody else can read either list.
  const [blocked, muted] = await Promise.all([
    listBlocked(db, user.id),
    listMuted(db, user.id),
  ]);

  const { t } = getInstance(args.context);
  return rootAuthLoader(args, () => ({
    title: t("app.pageTitle", { title: t("settings.people.title") }),
    publishableKey: keys.publishableKey,
    blocked: blocked.map(withAvatar),
    muted: muted.map(withAvatar),
  }));
}

// Pages and answers that carry a person's data are never kept by a shared cache. Set here, for
// the page and for its data requests alike, and the cookie of an answer is kept.
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

  // A page on another site must not be able to undo a block for someone.
  const unsafe = checkWrite(request, maxFormBytes);
  if (unsafe) {
    return unsafe === "too_large" ? fail(413) : fail(403);
  }

  // The person is the one in the verified session, never a field of the form.
  const user = await requireUser(args);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `social:${user.id}`,
  );
  if (limited) return limited;

  const parsed = formSchema.safeParse(await readForm(request, maxFormBytes));
  if (!parsed.success) return fail(400);
  const db = await getDb();

  if (parsed.data.intent === "unblock") {
    await unblockUser(db, user.id, parsed.data.username);
  } else {
    await unmuteUser(db, user.id, parsed.data.username);
  }
  return data(
    { ok: true as const, intent: parsed.data.intent },
    { headers: privateHeaders },
  );
}

type Row = Route.ComponentProps["loaderData"]["blocked"][number];

function PersonRow({
  person,
  intent,
  label,
  busy,
}: {
  person: Row;
  intent: "unblock" | "unmute";
  label: string;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const shown = person.displayName ?? person.username;
  return (
    <li className="border-border bg-surface-raised flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <div className="flex min-w-0 items-center gap-3">
        {person.avatarUrl ? (
          <img
            src={person.avatarUrl}
            alt={t("settings.people.avatarAlt", { name: shown })}
            width={40}
            height={40}
            loading="lazy"
            className="size-10 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="bg-accent text-accent-fg flex size-10 shrink-0 items-center justify-center rounded-full font-bold"
          >
            {shown.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="font-semibold break-words">{shown}</p>
          <p className="text-fg-muted text-sm break-words">
            {t("profile.handle", { username: person.username })}
          </p>
        </div>
      </div>
      <Form method="post">
        <input type="hidden" name="intent" value={intent} />
        <input type="hidden" name="username" value={person.username} />
        <button type="submit" disabled={busy} className={secondaryButtonClass}>
          {label}
        </button>
      </Form>
    </li>
  );
}

export default function People({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const { blocked, muted } = loaderData;
  const error = actionData?.ok === false ? actionData.error : null;
  const outcome = actionData?.ok === true ? actionData : null;

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-3xl font-bold">{t("settings.people.title")}</h1>
        <p className="text-fg-muted mt-2">{t("settings.people.description")}</p>
        {/* A plain link: the settings pages have a security policy of their own (ADR-018). */}
        <p className="mt-4">
          <BackLink to="/settings/profile">
            {t("settings.people.back")}
          </BackLink>
        </p>

        {/* Always in the page, so a screen reader announces each message that appears in it. */}
        <div role="status" className="mt-6 space-y-1">
          {outcome?.intent === "unblock" ? (
            <p className="font-semibold">
              {t("settings.people.result.unblocked")}
            </p>
          ) : null}
          {outcome?.intent === "unmute" ? (
            <p className="font-semibold">
              {t("settings.people.result.unmuted")}
            </p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-danger-text mt-3 font-semibold">
            {t(`settings.people.errors.${error}`)}
          </p>
        ) : null}

        <section aria-labelledby="blocked-title" className="mt-8">
          <h2 id="blocked-title" className="text-xl font-bold">
            {t("settings.people.blocked.title")}
          </h2>
          {blocked.length === 0 ? (
            <p className="text-fg-muted mt-2">
              {t("settings.people.blocked.empty")}
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {blocked.map((person) => (
                <PersonRow
                  key={person.username}
                  person={person}
                  intent="unblock"
                  label={t("settings.people.blocked.unblock")}
                  busy={busy}
                />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="muted-title" className="mt-8">
          <h2 id="muted-title" className="text-xl font-bold">
            {t("settings.people.muted.title")}
          </h2>
          {muted.length === 0 ? (
            <p className="text-fg-muted mt-2">
              {t("settings.people.muted.empty")}
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {muted.map((person) => (
                <PersonRow
                  key={person.username}
                  person={person}
                  intent="unmute"
                  label={t("settings.people.muted.unmute")}
                  busy={busy}
                />
              ))}
            </ul>
          )}
        </section>
      </main>
    </ClerkSession>
  );
}
