/**
 * The tracker of the cookieless analytics, without the browser (SAG-24, ADR-009, ADR-050). What it
 * decides is here, so every rule is tested without a page: which page a path is, whether the visitor
 * asked not to be measured, and when an event is sent. `Analytics.tsx` only connects it to the
 * events of the browser. Nothing here reads or writes a cookie or any storage.
 */

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
  | { kind: "search"; path: string; type: string };

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

/** Parameters whose value is one of a short list we wrote (a type of title, a list kind): kept as they are. */
const keptParams = new Set(["type", "kind", "status"]);

/**
 * The page a path is, not the path itself: `/u/ana_reads` is `/u/:username` and a path nobody wrote
 * a page for is `/:splat`. The names of people, the slug of a title and the words of a mistyped
 * address never leave the browser, and the numbers group by kind of page. A parameter is found by
 * its value in the path.
 */
export function pageOf(
  pathname: string,
  params: Readonly<Record<string, string | undefined>>,
): string | null {
  const splat = params["*"];
  let path = pathname;
  if (splat) {
    const whole = decoded(pathname);
    const cut = whole.lastIndexOf(splat);
    path = cut > 0 ? `${whole.slice(0, cut)}:splat` : "/:splat";
  } else {
    const names = new Map<string, string>();
    for (const [name, value] of Object.entries(params)) {
      if (value && !keptParams.has(name)) names.set(value, name);
    }
    path = pathname
      .split("/")
      .map((segment) => {
        const name = names.get(decoded(segment));
        return name ? `:${name}` : segment;
      })
      .join("/");
  }
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

  function stopClock() {
    if (visibleSince !== null) {
      visibleMs += now() - visibleSince;
      visibleSince = null;
    }
  }

  function flush() {
    stopClock();
    if (page && visibleMs >= minEngagedMs) {
      send({
        kind: "engaged",
        path: page,
        ms: Math.min(Math.round(visibleMs), maxEngagedMs),
      });
    }
    visibleMs = 0;
  }

  return {
    /** A page opened (the first one or after a move). The one before is closed first. */
    visit({ page: next, search, referrer }: Visit, visible: boolean) {
      flush();
      page = next;
      if (visible) visibleSince = now();
      send({
        kind: "pageview",
        path: next,
        referrer: first ? referrerOrigin(referrer) : origin,
        ...(first ? utmOf(search) : {}),
      });
      first = false;
    },
    /** A search was made on the open page: only its type is sent. */
    search(search: string) {
      if (page)
        send({ kind: "search", path: page, type: searchTypeOf(search) });
    },
    /** The tab became visible again. */
    show() {
      if (page && visibleSince === null) visibleSince = now();
    },
    /** The tab was hidden or is being left: what was seen so far is sent. */
    hide() {
      flush();
    },
  };
}

export type Tracker = ReturnType<typeof createTracker>;
