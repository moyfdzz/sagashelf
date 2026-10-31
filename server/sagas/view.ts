import type { SagaMember, SagaProgress } from "../db/sagas";
import type { libraryStatus } from "../db/schema/shared";
import { pickTitle } from "../db/titles";
import type { Locale } from "../providers/types";
import { mediaPath } from "../media/slug";

export type SagaOrder = "release" | "story";

/** The members in the order asked for. Release order: by year, then as curated; no year goes last. */
export function orderMembers(
  members: readonly SagaMember[],
  order: SagaOrder,
): SagaMember[] {
  return [...members].sort((a, b) => {
    if (order === "release") {
      const byYear = (a.year ?? 9999) - (b.year ?? 9999);
      if (byYear !== 0) return byYear;
    }
    return a.position - b.position;
  });
}

/** Whether the story order is not the release order, so a person has two orders to choose from. */
export function ordersDiffer(members: readonly SagaMember[]): boolean {
  const release = orderMembers(members, "release").map((member) => member.qid);
  const story = orderMembers(members, "story").map((member) => member.qid);
  return release.some((qid, index) => qid !== story[index]);
}

/** How far a person is in one title, from 0 to 1: finished is 1, and a total is needed for the rest. */
export function fractionOf(progress: SagaProgress | undefined): number {
  if (!progress) return 0;
  if (progress.status === "completed") return 1;
  if (progress.status === "planned" || !progress.total) return 0;
  return Math.min(1, progress.progress / progress.total);
}

export type SagaTotals = {
  /** The works of the saga that our catalog holds. */
  inCatalog: number;
  /** The ones the person has finished. */
  completed: number;
  /** The mean of how far the person is in each work we hold, as a whole percent. Null: none held. */
  percent: number | null;
};

/**
 * The overall progress: the mean over the works our catalog holds, so a work only Wikidata knows
 * (which cannot be tracked) does not pull it down. A work the person does not hold counts as 0.
 */
export function sagaTotals(
  members: readonly SagaMember[],
  progress: ReadonlyMap<string, SagaProgress>,
): SagaTotals {
  const held = members.filter((member) => member.media);
  if (held.length === 0) return { inCatalog: 0, completed: 0, percent: null };
  const fractions = held.map((member) =>
    fractionOf(progress.get(member.media?.id ?? "")),
  );
  const sum = fractions.reduce((total, fraction) => total + fraction, 0);
  return {
    inCatalog: held.length,
    completed: fractions.filter((fraction) => fraction === 1).length,
    percent: Math.round((sum / held.length) * 100),
  };
}

export type StartHint =
  /** The person has nothing in the saga: begin at the first work of the order. */
  | { kind: "start"; member: SagaMember }
  /** The person has started: the first work of the order they have not finished. */
  | { kind: "next"; member: SagaMember };

/**
 * Where to begin. With no entry in the saga it is the first work of the order; with some, the
 * first work that our catalog holds that the person has not finished. Nothing when all are done.
 */
export function startHint(
  ordered: readonly SagaMember[],
  progress: ReadonlyMap<string, SagaProgress>,
): StartHint | null {
  const first = ordered[0];
  if (!first) return null;
  const started = ordered.some(
    (member) => member.media && progress.has(member.media.id),
  );
  if (!started) return { kind: "start", member: first };
  const next = ordered.find(
    (member) => member.media && fractionOf(progress.get(member.media.id)) < 1,
  );
  return next ? { kind: "next", member: next } : null;
}

/** The formats a saga page lists, in the order it lists them. */
export const sagaFormats = [
  "anime",
  "movie",
  "series",
  "manga",
  "book",
  "game",
  "other",
] as const;
export type SagaFormat = (typeof sagaFormats)[number];

/** The statuses of the library, which the saga page names with the texts of the library. */
export type EntryStatus = (typeof libraryStatus.enumValues)[number];

export type SagaItem = {
  qid: string;
  label: string;
  year: number | null;
  href: string | null;
  /** What the person has done with it, when they hold it. */
  entry: { status: EntryStatus; percent: number } | null;
};

export type SagaGroup = { format: SagaFormat; items: SagaItem[] };

/** The name of a member in the language of the visitor, from our catalog when we hold it. */
export function memberLabel(member: SagaMember, locale: Locale): string | null {
  const other: Locale = locale === "es" ? "en" : "es";
  return member.media
    ? pickTitle(member.media, locale)
    : (member.labels[locale] ?? member.labels[other] ?? null);
}

/**
 * The members grouped by format, each group in the order given. A title we hold is grouped by its
 * own type, which is where the person finds it; one with no name in either language is left out.
 */
export function groupMembers(
  ordered: readonly SagaMember[],
  locale: Locale,
  progress: ReadonlyMap<string, SagaProgress>,
): SagaGroup[] {
  const groups = new Map<SagaFormat, SagaItem[]>();
  for (const member of ordered) {
    const label = memberLabel(member, locale);
    const format = member.media?.type ?? member.format;
    if (!label || !(sagaFormats as readonly string[]).includes(format)) {
      continue;
    }
    const held = member.media ? progress.get(member.media.id) : undefined;
    const items = groups.get(format as SagaFormat) ?? [];
    items.push({
      qid: member.qid,
      label,
      year: member.year,
      href: member.media
        ? mediaPath(member.media.type, label, member.media.id)
        : null,
      entry: held
        ? {
            status: held.status as EntryStatus,
            percent: Math.round(fractionOf(held) * 100),
          }
        : null,
    });
    groups.set(format as SagaFormat, items);
  }
  return sagaFormats.flatMap((format) => {
    const items = groups.get(format);
    return items ? [{ format, items }] : [];
  });
}
