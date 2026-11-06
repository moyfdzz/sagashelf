import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import type { Route } from "./+types/social";
import { PersonRow } from "~/components/PersonRow";
import { inputClass, primaryButtonClass } from "~/lib/ui";
import { getInstance } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import {
  normalizePeopleQuery,
  peopleQueryMaxLength,
  peopleQueryMinLength,
  searchPeople,
} from "~server/db/people-search";
import { personCard } from "~server/db/person";
import { mergePrivateHeaders } from "~server/http/cache";
import { rateLimit } from "~server/rate-limit";
import { getDb, getSearchLimiter } from "~server/runtime-env";

export async function loader(args: Route.LoaderArgs) {
  const { request, context } = args;
  const user = await requireUser(args);
  const { t } = getInstance(context);
  const title = t("app.pageTitle", { title: t("social.title") });

  const raw = (new URL(request.url).searchParams.get("q") ?? "").trim();
  // Only as much as a username can be goes back into the field.
  const q = [...raw].slice(0, peopleQueryMaxLength + 1).join("");
  const query = normalizePeopleQuery(raw);
  const length = [...query].length;

  if (length === 0) {
    return { title, q, status: "idle" as const, people: [] };
  }
  if (length < peopleQueryMinLength) {
    return { title, q, status: "too_short" as const, people: [] };
  }
  if (length > peopleQueryMaxLength) {
    return { title, q, status: "results" as const, people: [] };
  }

  // Only a real search counts against the limit, not the empty page.
  const limited = await rateLimit(
    getSearchLimiter(),
    request,
    `people-search:${user.id}`,
  );
  if (limited) throw limited;

  const people = await searchPeople(await getDb(), user.id, query);
  return {
    title,
    q,
    status: "results" as const,
    people: people.map(personCard),
  };
}

// What a search finds depends on who is looking, so a shared cache never keeps it.
export const headers = mergePrivateHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export default function Social({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { q, status, people } = loaderData;

  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold">{t("social.title")}</h1>
      <p className="text-fg-muted mt-2">{t("social.description")}</p>

      <Form method="get" role="search" className="mt-6">
        <label htmlFor="people-search" className="font-semibold">
          {t("social.inputLabel")}
        </label>
        <div className="mt-1 flex flex-wrap gap-2">
          <input
            id="people-search"
            type="search"
            name="q"
            defaultValue={q}
            autoComplete="off"
            spellCheck={false}
            className={`${inputClass} min-w-0 flex-1 basis-48`}
          />
          <button type="submit" className={primaryButtonClass}>
            {t("social.submit")}
          </button>
        </div>
      </Form>

      {status === "idle" ? (
        <p className="text-fg-muted mt-6">
          {t("social.prompt", { count: peopleQueryMinLength })}
        </p>
      ) : null}
      {status === "too_short" ? (
        <p role="status" className="text-fg-muted mt-6">
          {t("social.tooShort", { count: peopleQueryMinLength })}
        </p>
      ) : null}
      {status === "results" && people.length === 0 ? (
        <p role="status" className="text-fg-muted mt-6">
          {t("social.empty", { query: q })}
        </p>
      ) : null}
      {people.length > 0 ? (
        <ul aria-label={t("social.resultsLabel")} className="mt-6 space-y-3">
          {people.map((person) => (
            <PersonRow key={person.username} person={person} />
          ))}
        </ul>
      ) : null}
    </main>
  );
}
