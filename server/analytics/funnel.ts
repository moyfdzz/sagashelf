import { logUnhandled } from "../http/error-log";
import { getAnalyticsEnabled, getDb, runInBackground } from "../runtime-env";
import { canMeasure, type CollectEvent } from "./event";
import { recordEvent } from "./record";

/** The steps of the funnel that the server records itself, when the action worked. */
export type FunnelEvent = {
  kind: Extract<CollectEvent["kind"], "add_to_library" | "follow">;
  path: string;
};

/**
 * Records a step of the funnel from inside the action that did it (SAG-24, ADR-050). It is written
 * by the server and not sent by the browser, so it cannot be forged from a script, an ad blocker
 * cannot cut it, and it only exists if the action worked. The caller says nothing about who: the
 * visitor is the same daily hash as the page views, made from the request.
 *
 * It follows the same rules as the collector: nothing is kept where the deployment did not switch
 * the analytics on, for a visitor who asked not to be measured, for a robot, or for an
 * administrator (the owner is not counted). The write runs after the answer is sent, so it adds no
 * time to the action, and a failure is logged without values and never reaches the person.
 *
 * `path` is the address of the action, not of the page the person was on, which the server does not
 * know.
 */
export function recordFunnelEvent(
  request: Request,
  user: { role: string },
  event: FunnelEvent,
): void {
  if (!getAnalyticsEnabled() || user.role === "admin") return;
  if (!canMeasure(request.headers)) return;

  runInBackground(
    (async () => {
      try {
        await recordEvent(await getDb(), request, event, new Date());
      } catch (error) {
        logUnhandled(error, request);
      }
    })(),
  );
}
