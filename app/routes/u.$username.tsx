import { useTranslation } from "react-i18next";
import { data, Form, Link, redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/u.$username";
import {
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
  secondaryLinkClass,
  textLinkClass,
} from "~/lib/ui";
import { getInstance, getLocale } from "~/middleware/i18next";
import { getOptionalUser, requireUser } from "~server/auth/require";
import { signInPath } from "~server/auth/sign-in-url";
import {
  profileStatuses,
  getProfileSections,
  type ProfileStatus,
} from "~server/db/profile-library";
import {
  blockUser,
  findProfile,
  followUser,
  getSocialCounts,
  isMuted,
  muteUser,
  unfollowUser,
  unmuteUser,
} from "~server/db/social";
import { readForm } from "~server/http/body";
import { imageSrc } from "~server/images/sources";
import { mediaPath } from "~server/media/slug";
import { rateLimit } from "~server/rate-limit";
import { getDb, getWriteLimiter } from "~server/runtime-env";
import type { MediaKind } from "~server/providers/types";

// Anything with the shape of a username. The database decides if it exists; this only keeps a
// path that cannot be one (too long, a slash, a space) from reaching it.
const usernameShape = /^[^\s/?#%\\]{3,30}$/;

// The form has one word. Anything bigger is not from this page.
const maxFormBytes = 1024;

// Pages and answers that depend on who is looking are never kept by a shared cache.
const privateHeaders = { "Cache-Control": "private, no-store" };

const formSchema = z.strictObject({
  intent: z.enum(["follow", "unfollow", "mute", "unmute", "block"]),
});

const notices = [
  "followed",
  "unfollowed",
  "muted",
  "unmuted",
  "too_many",
  "unavailable",
  "invalid_request",
] as const;
type Notice = (typeof notices)[number];

const asNotice = (value: string | null): Notice | null =>
  (notices as readonly string[]).includes(value ?? "")
    ? (value as Notice)
    : null;

// A person who may not see the profile, a profile that does not exist, an erased account and a
// block all get this same answer (ADR-031), so it says nothing about who exists.
const notFound = () => data(null, { status: 404, headers: privateHeaders });

export async function loader(args: Route.LoaderArgs) {
  const { params, request, context } = args;
  if (!usernameShape.test(params.username)) throw notFound();

  const db = await getDb();
  const viewer = await getOptionalUser(args);
  const found = await findProfile(db, viewer?.id ?? null, params.username);
  if (!found) throw notFound();
  const { owner, relationship, view } = found;

  const { t } = getInstance(context);
  const locale = getLocale(context) === "en" ? "en" : "es";
  const name = owner.displayName ?? owner.username;
  const notice = asNotice(new URL(request.url).searchParams.get("notice"));

  // What the viewer can do with this person, never more than the buttons the page draws.
  const you =
    relationship === "owner"
      ? ({ kind: "owner" } as const)
      : viewer
        ? ({
            kind: "member",
            following: relationship === "friend" || relationship === "follower",
            canFollow: owner.privacy === "public",
            muted: await isMuted(db, viewer.id, owner.id),
          } as const)
        : ({ kind: "visitor", signInPath: signInPath(request.url) } as const);

  const head = {
    username: owner.username,
    displayName: owner.displayName,
    // The picture is only ever an HTTPS address of ours or Clerk's; the policy of the page allows
    // only that origin.
    avatarUrl: owner.avatarUrl?.startsWith("https://") ? owner.avatarUrl : null,
  };
  const base = {
    title: t("app.pageTitle", {
      title: t("profile.pageTitle", { name, username: owner.username }),
    }),
    head,
    you,
    notice,
  };

  // A locked profile shows the card and nothing else: no bio, no counts, no library.
  if (view === "card") {
    return { ...base, view: "card" as const };
  }

  const [counts, sections] = await Promise.all([
    getSocialCounts(db, owner.id),
    getProfileSections(db, owner.id, owner.privacy, relationship, locale),
  ]);
  return {
    ...base,
    view: "full" as const,
    bio: owner.bio,
    counts,
    sections: profileStatuses.map((status) => ({
      status,
      total: sections[status].total,
      entries: sections[status].entries.map((entry) => ({
        href: mediaPath(entry.type as MediaKind, entry.title, entry.mediaId),
        title: entry.title,
        year: entry.year,
        score: entry.score,
        poster: imageSrc(entry.imageUrl, "w185"),
      })),
    })),
  };
}

// Pages and answers that depend on who is looking are never kept by a shared cache. Set here, for
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
    // The page of a person is not for a search engine, whatever level it has.
    { name: "robots", content: "noindex, nofollow" },
  ];
}

// Answering before the body is read leaves it open (see settings.profile.tsx).
async function answerWithoutReading<T>(request: Request, response: T) {
  await request.arrayBuffer().catch(() => undefined);
  return response;
}

/**
 * Follow, unfollow, mute, unmute and block, from the buttons of the page. The person is the one in
 * the verified session; the other one is named by the address of the page. Each one is a plain form
 * that reloads the page, like the button of the title page, and ends in a redirect with a short
 * word that the page turns into a message.
 */
export async function action(args: Route.ActionArgs) {
  const { request, params } = args;
  const back = `/u/${encodeURIComponent(params.username)}`;

  if (Number(request.headers.get("Content-Length") ?? 0) > maxFormBytes) {
    return answerWithoutReading(
      request,
      data({ error: "invalid_request" }, { status: 413 }),
    );
  }
  // A page on another site must not be able to follow or block for someone.
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return answerWithoutReading(
      request,
      data({ error: "invalid_request" }, { status: 403 }),
    );
  }
  if (!usernameShape.test(params.username)) throw notFound();

  const user = await requireUser(args);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `social:${user.id}`,
  );
  if (limited) return answerWithoutReading(request, limited);

  const parsed = formSchema.safeParse(await readForm(request, maxFormBytes));
  if (!parsed.success) {
    return redirect(`${back}?notice=invalid_request`, 303);
  }
  const db = await getDb();

  switch (parsed.data.intent) {
    case "follow": {
      const result = await followUser(db, user.id, params.username);
      return redirect(
        result === "followed"
          ? `${back}?notice=followed`
          : `${back}?notice=${result}`,
        303,
      );
    }
    case "unfollow":
      await unfollowUser(db, user.id, params.username);
      return redirect(`${back}?notice=unfollowed`, 303);
    case "mute":
      await muteUser(db, user.id, params.username);
      return redirect(`${back}?notice=muted`, 303);
    case "unmute":
      await unmuteUser(db, user.id, params.username);
      return redirect(`${back}?notice=unmuted`, 303);
    case "block":
      await blockUser(db, user.id, params.username);
      // Their profile is gone for this person now, so the way back is the page where it is undone.
      return redirect("/settings/people", 303);
  }
}

function Avatar({
  url,
  name,
  className,
}: {
  url: string | null;
  name: string;
  className: string;
}) {
  const { t } = useTranslation();
  return url ? (
    <img
      src={url}
      alt={t("profile.avatarAlt", { name })}
      width={96}
      height={96}
      className={`${className} object-cover`}
    />
  ) : (
    <div
      aria-hidden="true"
      className={`${className} bg-accent text-accent-fg flex items-center justify-center text-3xl font-bold`}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

type You = Route.ComponentProps["loaderData"]["you"];

function Actions({ you, username }: { you: You; username: string }) {
  const { t } = useTranslation();
  if (you.kind === "owner") {
    return (
      <p>
        {/* A plain link: the settings have a security policy of their own (ADR-018). */}
        <a href="/settings/profile" className={secondaryLinkClass}>
          {t("profile.editProfile")}
        </a>
      </p>
    );
  }
  if (you.kind === "visitor") {
    return (
      <p>
        <a href={you.signInPath} className={secondaryLinkClass}>
          {t("profile.signInToFollow")}
        </a>
      </p>
    );
  }
  const button = (intent: string, label: string, className: string) => (
    <Form
      method="post"
      reloadDocument
      action={`/u/${encodeURIComponent(username)}`}
    >
      <input type="hidden" name="intent" value={intent} />
      <button type="submit" className={className}>
        {label}
      </button>
    </Form>
  );
  return (
    <div
      role="group"
      aria-label={t("profile.actions.label")}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-start gap-2">
        {you.following
          ? button(
              "unfollow",
              t("profile.actions.unfollow"),
              secondaryButtonClass,
            )
          : you.canFollow
            ? button("follow", t("profile.actions.follow"), primaryButtonClass)
            : null}
        {you.muted
          ? button("unmute", t("profile.actions.unmute"), secondaryButtonClass)
          : button("mute", t("profile.actions.mute"), secondaryButtonClass)}
        {button("block", t("profile.actions.block"), dangerButtonClass)}
      </div>
      <p className="text-fg-muted text-sm">{t("profile.actions.blockHint")}</p>
    </div>
  );
}

export default function Profile({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { head, you, notice } = loaderData;
  const name = head.displayName ?? head.username;

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <header className="flex flex-wrap items-center gap-4">
        <Avatar
          url={head.avatarUrl}
          name={name}
          className="size-24 rounded-full"
        />
        <div className="min-w-0">
          <h1 className="text-3xl font-bold break-words">{name}</h1>
          <p className="text-fg-muted">
            {t("profile.handle", { username: head.username })}
          </p>
        </div>
      </header>

      <div className="mt-6">
        <Actions you={you} username={head.username} />
      </div>

      {/* Always in the page, so a screen reader announces the result of a button. */}
      <div role="status" className="mt-4">
        {notice ? (
          <p className="font-semibold">{t(`profile.notice.${notice}`)}</p>
        ) : null}
      </div>

      {loaderData.view === "full" ? (
        <FullProfile loaderData={loaderData} username={head.username} />
      ) : (
        <p className="text-fg-muted mt-6">
          {t("profile.locked")}
          {you.kind === "member" && !you.following ? (
            <span className="ml-1">{t("profile.requestsSoon")}</span>
          ) : null}
        </p>
      )}
    </main>
  );
}

function FullProfile({
  loaderData,
  username,
}: {
  loaderData: Extract<Route.ComponentProps["loaderData"], { view: "full" }>;
  username: string;
}) {
  const { t } = useTranslation();
  const { bio, counts, sections } = loaderData;
  const base = `/u/${encodeURIComponent(username)}`;
  const empty = sections.every((section) => section.total === 0);

  return (
    <>
      {bio ? (
        <p className="mt-6 max-w-prose whitespace-pre-line">{bio}</p>
      ) : null}

      <nav aria-label={t("profile.counts.label")} className="mt-6">
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          <li>
            <Link to={`${base}/followers`} className={textLinkClass}>
              {t("profile.counts.followers", { count: counts.followers })}
            </Link>
          </li>
          <li>
            <Link to={`${base}/following`} className={textLinkClass}>
              {t("profile.counts.following", { count: counts.following })}
            </Link>
          </li>
          <li>
            <Link to={`${base}/friends`} className={textLinkClass}>
              {t("profile.counts.friends", { count: counts.friends })}
            </Link>
          </li>
        </ul>
      </nav>

      {empty ? (
        <p className="text-fg-muted mt-8">{t("profile.empty")}</p>
      ) : (
        sections
          .filter((section) => section.total > 0)
          .map((section) => <Section key={section.status} section={section} />)
      )}
    </>
  );
}

function Section({
  section,
}: {
  section: Extract<
    Route.ComponentProps["loaderData"],
    { view: "full" }
  >["sections"][number];
}) {
  const { t } = useTranslation();
  const status: ProfileStatus = section.status;
  const titleId = `section-${status}`;
  return (
    <section aria-labelledby={titleId} className="mt-8">
      <h2 id={titleId} className="text-xl font-bold">
        {t(`profile.sections.${status}`)}
      </h2>
      {section.total > section.entries.length ? (
        <p className="text-fg-muted text-sm">
          {t("profile.sections.shown", {
            shown: section.entries.length,
            total: section.total,
          })}
        </p>
      ) : null}
      <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
        {section.entries.map((entry) => (
          <li key={entry.href}>
            <Link to={entry.href} className="block">
              {entry.poster ? (
                // The title is written under it, so a screen reader skips the picture.
                <span aria-hidden="true" className="block">
                  <img
                    src={entry.poster}
                    alt={t("media.posterAlt", { title: entry.title })}
                    width={185}
                    height={278}
                    loading="lazy"
                    className="border-border aspect-[2/3] w-full rounded-md border object-cover"
                  />
                </span>
              ) : (
                <div
                  aria-hidden="true"
                  className="bg-border aspect-[2/3] w-full rounded-md"
                />
              )}
              <span className="mt-1 block text-sm font-semibold break-words">
                {entry.title}
              </span>
            </Link>
            {entry.score ? (
              <span className="text-fg-muted text-sm">
                {t("library.card.scoreShort", { score: entry.score })}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
