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
  return started;
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
    const page = pageOf(location.pathname, params);
    const started = startTracker();
    if (!page || !started) return;
    lastPathname = location.pathname;
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
