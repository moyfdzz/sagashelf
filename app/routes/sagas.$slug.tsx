import { Trans, useTranslation } from "react-i18next";
import { data, Link } from "react-router";

import { linkClass, textLinkClass } from "~/lib/ui";
import type { Route } from "./+types/sagas.$slug";
import { WikidataLink } from "~/components/WikidataLink";
import { getInstance, getLocale } from "~/middleware/i18next";
import { getOptionalUser } from "~server/auth/require";
import { signInPath } from "~server/auth/sign-in-url";
import { getSagaBySlug, getSagaProgress } from "~server/db/sagas";
import { getDb } from "~server/runtime-env";
import {
  groupMembers,
  memberLabel,
  orderMembers,
  ordersDiffer,
  sagaTotals,
  startHint,
  type SagaOrder,
} from "~server/sagas/view";
import { mediaPath } from "~server/media/slug";

const slugShape = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function loader(args: Route.LoaderArgs) {
  const { params, request, context } = args;
  if (params.slug.length > 80 || !slugShape.test(params.slug)) {
    throw data(null, { status: 404 });
  }

  const db = await getDb();
  const saga = await getSagaBySlug(db, params.slug);
  if (!saga) throw data(null, { status: 404 });

  const locale = getLocale(context) === "en" ? "en" : "es";
  const url = new URL(request.url);
  // Two orders are offered only when the story is not told in the order the works came out.
  const canChooseOrder = ordersDiffer(saga.members);
  const order: SagaOrder =
    canChooseOrder && url.searchParams.get("order") === "story"
      ? "story"
      : "release";
  const ordered = orderMembers(saga.members, order);

  // What the signed-in person has done with the works we hold. Everyone else sees the same page.
  const user = await getOptionalUser(args);
  const progress = user
    ? await getSagaProgress(
        db,
        user.id,
        ordered.flatMap((member) => (member.media ? [member.media.id] : [])),
      )
    : new Map();
  const totals = sagaTotals(ordered, progress);
  const hint = startHint(ordered, progress);

  const { t } = getInstance(context);
  const title = saga.titles[locale] || saga.title;
  const canonicalUrl = `${url.origin}/sagas/${saga.slug}`;
  const hintLabel = hint ? memberLabel(hint.member, locale) : null;

  return {
    slug: saga.slug,
    title,
    pageTitle: t("app.pageTitle", { title }),
    description: t("saga.description", { count: ordered.length, title }),
    canonicalUrl,
    count: ordered.length,
    order,
    canChooseOrder,
    groups: groupMembers(ordered, locale, progress),
    signedIn: user !== null,
    signInPath: user ? null : signInPath(request.url),
    totals,
    hint:
      hint && hintLabel
        ? {
            kind: hint.kind,
            label: hintLabel,
            href: hint.member.media
              ? mediaPath(
                  hint.member.media.type,
                  hintLabel,
                  hint.member.media.id,
                )
              : null,
          }
        : null,
  };
}

// The page shows what this person has done, so no shared cache keeps it.
export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return [
    { title: loaderData.pageTitle },
    { name: "description", content: loaderData.description },
    { tagName: "link", rel: "canonical", href: loaderData.canonicalUrl },
    { property: "og:type", content: "website" },
    { property: "og:title", content: loaderData.title },
    { property: "og:description", content: loaderData.description },
    { property: "og:url", content: loaderData.canonicalUrl },
    { name: "twitter:card", content: "summary" },
  ];
}

export default function SagaPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const saga = loaderData;
  const { totals } = saga;

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">{saga.title}</h1>
      <p className="text-fg-muted mt-2 font-semibold">
        {t("saga.summary", { count: saga.count })}
      </p>

      {saga.signedIn ? (
        <section aria-labelledby="saga-progress" className="mt-6">
          <h2 id="saga-progress" className="text-xl font-semibold">
            {t("saga.progress.title")}
          </h2>
          {totals.percent !== null && totals.percent > 0 ? (
            <>
              <progress
                aria-label={t("saga.progress.label")}
                value={totals.percent}
                max={100}
                className="mt-2 block h-2 w-full max-w-md"
              />
              <p className="mt-1">
                {t("saga.progress.summary", {
                  percent: totals.percent,
                  completed: totals.completed,
                  total: totals.inCatalog,
                })}
              </p>
            </>
          ) : (
            <p className="text-fg-muted mt-2">{t("saga.progress.none")}</p>
          )}
        </section>
      ) : (
        <p className="mt-4">
          <a href={saga.signInPath ?? "/sign-in"} className={linkClass}>
            {t("saga.signIn")}
          </a>
        </p>
      )}

      {saga.hint ? (
        <p className="mt-4">
          <span className="mr-1 font-semibold">
            {t(`saga.hint.${saga.hint.kind}`)}
          </span>
          {saga.hint.href ? (
            <Link to={saga.hint.href} className={textLinkClass}>
              {saga.hint.label}
            </Link>
          ) : (
            saga.hint.label
          )}
        </p>
      ) : null}

      {saga.canChooseOrder ? (
        <nav aria-label={t("saga.order.label")} className="mt-4 flex gap-4">
          {(["release", "story"] as const).map((order) => (
            <Link
              key={order}
              to={order === "story" ? "?order=story" : "."}
              aria-current={saga.order === order ? "page" : undefined}
              className={
                saga.order === order
                  ? "font-semibold underline underline-offset-4"
                  : textLinkClass
              }
            >
              {t(`saga.order.${order}`)}
            </Link>
          ))}
        </nav>
      ) : null}

      {saga.groups.map((group) => (
        <section key={group.format} className="mt-8">
          <h2 className="text-xl font-semibold">
            {t(`media.formats.${group.format}`)}
          </h2>
          <ol className="mt-2 space-y-2">
            {group.items.map((item) => (
              <li key={item.qid}>
                {item.href ? (
                  <Link to={item.href} className={textLinkClass}>
                    {item.label}
                  </Link>
                ) : (
                  item.label
                )}
                {item.year ? (
                  <span className="text-fg-muted ml-2">
                    {t("search.year", { year: item.year })}
                  </span>
                ) : null}
                {item.entry ? (
                  <span className="text-fg-muted block text-sm">
                    {t("saga.entry", {
                      status: t(`library.status.${item.entry.status}`),
                      percent: item.entry.percent,
                    })}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ))}

      <p className="text-fg-muted mt-10 text-sm">{t("saga.notHeld")}</p>
      <p className="text-fg-muted mt-2 text-sm">
        <Trans
          i18nKey="media.relationsSource"
          components={{ wikidata: <WikidataLink /> }}
        />
      </p>
    </main>
  );
}
