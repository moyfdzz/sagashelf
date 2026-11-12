import { useEffect } from "react";
import { useLocation, useParams } from "react-router";

import {
  askedNotToBeMeasured,
  collectUrl,
  createTracker,
  pageOf,
  type Tracker,
  type TrackerEvent,
} from "~/lib/tracker";

/** Sends one event with `sendBeacon`, or with a `keepalive` fetch where the beacon is not there. */
function send(event: TrackerEvent) {
  try {
    const body = JSON.stringify(event);
    if (
      navigator.sendBeacon?.(
        collectUrl,
        // `text/plain` is a simple request: it needs no preflight and no new rule of the policy.
        new Blob([body], { type: "text/plain" }),
      )
    ) {
      return;
    }
    void fetch(collectUrl, {
      method: "POST",
      body,
      keepalive: true,
      credentials: "omit",
    }).catch(() => undefined);
  } catch {
    // An event that cannot be sent is lost. Measuring never breaks a page.
  }
}

function signals() {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return {
    doNotTrack: nav.doNotTrack,
    globalPrivacyControl: nav.globalPrivacyControl,
  };
}

/**
 * The one tracker of this document: `undefined` before it starts, `null` for a visitor who asked not
 * to be measured. It lives outside the component on purpose. React mounts a component again when a
 * navigation shows a route (and twice in development), and a tracker made by each mount would lose
 * which page was the first and the time already seen.
 */
let tracker: Tracker | null | undefined;
let lastPathname: string | null = null;

function startTracker(): Tracker | null {
  if (tracker !== undefined) return tracker;
  if (askedNotToBeMeasured(signals())) {
    tracker = null;
    return null;
  }
  const started = createTracker({
    send,
    now: () => performance.now(),
    origin: window.location.origin,
  });
  tracker = started;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") started.hide();
    else started.show();
  });
  // Safari does not always fire `visibilitychange` when a tab is closed; `pagehide` does.
  window.addEventListener("pagehide", () => started.hide());
  // A page restored from the back/forward cache was flushed by `pagehide`: its clock starts again.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && document.visibilityState === "visible")
      started.show();
  });
  measureSpeed(started);
  return started;
}

/**
 * The speed of the page (SAG-254): the library is loaded after the page, in a file of its own, so it
 * is not part of what a page costs to open. Its callbacks hand each number to the tracker, and the
 * tracker sends them in one event the first time the tab hides.
 *
 * If the tab hides before the file arrives, nothing was measured yet and nothing is sent. The layout
 * shift and the interaction time are of the whole visit, with every move inside the app, and are
 * counted for the page where the visit started (ADR-050).
 */
function measureSpeed(started: Tracker) {
  import("web-vitals")
    .then(({ onCLS, onINP, onLCP }) => {
      // Every change is handed over, not only the final value the library gives when the tab hides.
      // The tracker only keeps the last number, so it costs nothing, and it means that the number
      // is already there before the tab hides, whatever the order of `pagehide` and
      // `visibilitychange` (Chrome fires the first and then the second, and the library's last
      // value comes in the second) and whatever the order of the listeners of the library and ours.
      const all = { reportAllChanges: true };
      onLCP((metric) => started.vital("LCP", metric.value), all);
      onCLS((metric) => started.vital("CLS", metric.value), all);
      onINP((metric) => started.vital("INP", metric.value), all);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") started.flushVitals();
      });
      // A browser that does not fire `visibilitychange` when a tab is closed (Safari, sometimes)
      // still fires this one.
      window.addEventListener("pagehide", () => started.flushVitals());
    })
    .catch(() => {
      // The file could not be loaded (an ad blocker, a bad connection): nothing is measured.
    });
}

/**
 * The tracker of the cookieless analytics (SAG-24, ADR-050). It draws nothing. It is rendered only
 * when the deployment switched it on and the person is not an administrator, so with it off no page
 * carries it. A visitor who asked not to be measured (Do Not Track, Global Privacy Control) is not
 * measured either: nothing is sent. It keeps nothing in the browser: no cookie, no storage.
 */
export function Analytics() {
  const location = useLocation();
  const params = useParams();

  // A page opened: one page view for each path, so a move from one title to another counts. The
  // query string is not part of the page, and a render with the same path is not a new page.
  useEffect(() => {
    if (lastPathname === location.pathname) return;
    // Set first, so a path the tracker will not send (too long) or a visitor who asked not to be
    // measured is not worked out again at every render.
    lastPathname = location.pathname;
    const page = pageOf(location.pathname, params);
    const started = startTracker();
    if (!page || !started) return;
    started.visit(
      {
        page,
        search: window.location.search,
        referrer: document.referrer,
      },
      document.visibilityState === "visible",
    );
  }, [location.pathname, params]);

  // A search made on the search page: only its type is sent, never its text.
  const search = location.search;
  useEffect(() => {
    if (location.pathname !== "/search") return;
    if (!new URLSearchParams(search).get("q")?.trim()) return;
    startTracker()?.search(search);
  }, [location.pathname, search]);

  return null;
}
