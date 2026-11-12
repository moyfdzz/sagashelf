/**
 * The tracker of the cookieless analytics, without the browser (SAG-24, ADR-009, ADR-050). What it
 * decides is here, so every rule is tested without a page: which page a path is, whether the visitor
 * asked not to be measured, and when an event is sent. `Analytics.tsx` only connects it to the
 * events of the browser. Nothing here reads or writes a cookie or any storage.
 */

import { entryStatuses } from "./title-library";

/** Where a beacon goes. Same site, so the Content Security Policy needs no new origin. */
export const collectUrl = "/api/collect";

/** The shortest time on a page that is worth an event: under a second is a click through. */
export const minEngagedMs = 1000;

/** The longest the collector takes (four hours), so a tab left open all night is still accepted. */
export const maxEngagedMs = 14_400_000;

/** The longest path the collector takes. */
const maxPathLength = 200;

const searchTypes = ["all", "anime", "movie", "series", "book", "manga"];

export type TrackerEvent =
  | {
      kind: "pageview";
      path: string;
      referrer?: string;
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
    }
  | { kind: "engaged"; path: string; ms: number }
  | { kind: "search"; path: string; type: string }
  | { kind: "vitals"; path: string; lcp?: number; cls?: number; inp?: number };

/** The Core Web Vitals the tracker keeps (SAG-254). The same limits as the collector takes. */
export type VitalName = "LCP" | "CLS" | "INP";

const maxVitalMs = 60_000;
const maxCls = 100;

/** What the browser says about the wish not to be measured: Do Not Track and Global Privacy Control. */
export type PrivacySignals = {
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
};

/** Whether the visitor asked not to be measured. The collector asks the same of the headers. */
export function askedNotToBeMeasured(signals: PrivacySignals): boolean {
  return signals.doNotTrack === "1" || signals.globalPrivacyControl === true;
}

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Parameters whose value is one of a short list we wrote (a type of title, a list kind, a status):
 * kept as they are, so the numbers can group by type. Any other value in those places is typed text
 * and is named like the rest.
 */
const keptValues: Readonly<Record<string, readonly string[]>> = {
  type: ["anime", "movie", "series", "book", "manga"],
  kind: ["followers", "following", "friends"],
  status: entryStatuses,
};

/**
 * The page a path is, not the path itself: `/u/ana_reads` is `/u/:username` and an address nobody
 * wrote a page for is `/:splat`. The names of people, the slug of a title and the words of a
 * mistyped address never leave the browser, and the numbers group by kind of page.
 *
 * A parameter is found by its value. The segments are read from the end with the parameters from the
 * last one, each used once, so a slug that equals a word of the path (`/media/movie/media`) is still
 * the slug and the word `media` at the start stays the word.
 */
export function pageOf(
  pathname: string,
  params: Readonly<Record<string, string | undefined>>,
): string | null {
  const segments = pathname.split("/");
  let end = segments.length;
  const splat = params["*"];
  if (splat) {
    const count = Math.min(splat.split("/").length, segments.length - 1);
    segments.splice(segments.length - count, count, ":splat");
    end = segments.length - 1;
  }

  const queue = Object.entries(params).filter(
    ([name, value]) => name !== "*" && value,
  );
  for (let i = end - 1; i > 0 && queue.length > 0; i -= 1) {
    const [name, value] = queue[queue.length - 1] ?? [];
    if (!name || decoded(segments[i] ?? "") !== value) continue;
    queue.pop();
    if (!keptValues[name]?.includes(value ?? "")) segments[i] = `:${name}`;
  }

  const path = segments.join("/");
  if (!path.startsWith("/") || path.length > maxPathLength) return null;
  return path;
}

/**
 * The site a visit came from, without the path or the query of the page: the collector only keeps
 * its class and host, so nothing else needs to travel. Empty when there is none or it is not an address.
 */
export function referrerOrigin(referrer: string): string | undefined {
  try {
    const origin = new URL(referrer).origin;
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}

/** The three UTM values of an address, only the ones that are there. */
export function utmOf(search: string): {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
} {
  const query = new URLSearchParams(search);
  const read = (name: string) => {
    const value = query.get(name)?.trim().slice(0, 100);
    return value || undefined;
  };
  const utm = {
    utmSource: read("utm_source"),
    utmMedium: read("utm_medium"),
    utmCampaign: read("utm_campaign"),
  };
  return Object.fromEntries(
    Object.entries(utm).filter(([, value]) => value !== undefined),
  );
}

/** The type of a search from its address: one of ours, or `all`. Never the text. */
export function searchTypeOf(search: string): string {
  const type = new URLSearchParams(search).get("type") ?? "";
  return searchTypes.includes(type) ? type : "all";
}

export type TrackerDeps = {
  /** Sends one event, and never throws: the answer of a beacon is not read. */
  send(event: TrackerEvent): void;
  /** Milliseconds, only to measure how long a page was visible. */
  now(): number;
  /** The origin of this site, said as the referrer of a move between its own pages. */
  origin: string;
};

export type Visit = {
  /** The page, from `pageOf`. */
  page: string;
  search: string;
  /** `document.referrer`, used only for the first page of a visit. */
  referrer: string;
};

/**
 * The state of one visit: which page is open and for how long it was visible. A page view goes out
 * when a page opens and a time on the page when it is left or hidden. The first page carries the
 * referrer and the UTM values of the address; the rest were reached from this site.
 */
export function createTracker({ send, now, origin }: TrackerDeps) {
  let page: string | null = null;
  let visibleSince: number | null = null;
  let visibleMs = 0;
  let first = true;
  let lastSearch: string | null = null;
  // The page where the visit started and the speed of its load (SAG-254). The browser measures a
  // document and not each move inside the app, so the numbers belong to the first page.
  let landing: string | null = null;
  const vitals: Partial<Record<VitalName, number>> = {};
  let vitalsSent = false;

  function stopClock() {
    if (visibleSince !== null) {
      visibleMs += now() - visibleSince;
      visibleSince = null;
    }
  }

  /**
   * Sends the time seen so far once it is worth an event. Short visits to a tab are kept and added
   * up, so a person who comes back to a page many times is not lost; leaving the page (`final`)
   * drops what is too short, since it is a click through.
   */
  function flush(final: boolean) {
    stopClock();
    if (page && visibleMs >= minEngagedMs) {
      send({
        kind: "engaged",
        path: page,
        ms: Math.min(Math.round(visibleMs), maxEngagedMs),
      });
      visibleMs = 0;
    } else if (final) {
      visibleMs = 0;
    }
  }

  return {
    /** A page opened (the first one or after a move). The one before is closed first. */
    visit({ page: next, search, referrer }: Visit, visible: boolean) {
      flush(true);
      page = next;
      landing ??= next;
      if (visible) visibleSince = now();
      send({
        kind: "pageview",
        path: next,
        referrer: first ? referrerOrigin(referrer) : origin,
        ...(first ? utmOf(search) : {}),
      });
      first = false;
    },
    /**
     * A search was made on the open page: only its type is sent. The same words and type again (the
     * next page of the results, a reload of the address) are the same search, not a new one.
     */
    search(search: string) {
      if (!page) return;
      const query = new URLSearchParams(search);
      const type = searchTypeOf(search);
      const same = `${(query.get("q") ?? "").trim().toLowerCase()}|${type}`;
      if (same === lastSearch) return;
      lastSearch = same;
      send({ kind: "search", path: page, type });
    },
    /** The tab became visible again. */
    show() {
      if (page && visibleSince === null) visibleSince = now();
    },
    /** The tab was hidden or is being left: what was seen so far is sent. */
    hide() {
      flush(false);
    },
    /**
     * A Core Web Vital was measured, or measured again: the last value is the one that counts. A
     * number the collector would refuse (negative, not finite, or past what a real page does) is
     * left out, so one bad number does not cost the others.
     */
    vital(name: VitalName, value: number) {
      const limit = name === "CLS" ? maxCls : maxVitalMs;
      if (!Number.isFinite(value) || value < 0 || value > limit) return;
      // Milliseconds with a decimal, and a score with four.
      vitals[name] =
        name === "CLS"
          ? Math.round(value * 10_000) / 10_000
          : Math.round(value * 10) / 10;
    },
    /**
     * Sends the speed of the page where the visit started, once, in one event with the numbers that
     * were measured. Later hides send nothing: the visit is one event. With no number there is no
     * event, and with no page opened there is nothing to say it belongs to.
     */
    flushVitals() {
      if (vitalsSent || !landing) return;
      const { LCP: lcp, CLS: cls, INP: inp } = vitals;
      if (lcp === undefined && cls === undefined && inp === undefined) return;
      vitalsSent = true;
      send({
        kind: "vitals",
        path: landing,
        ...(lcp !== undefined ? { lcp } : {}),
        ...(cls !== undefined ? { cls } : {}),
        ...(inp !== undefined ? { inp } : {}),
      });
    },
  };
}

export type Tracker = ReturnType<typeof createTracker>;
