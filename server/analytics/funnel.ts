import { logUnhandled } from "../http/error-log";
import { getDb, runInBackground } from "../runtime-env";
import type { CollectEvent } from "./event";
import { isMeasured } from "./measure";
import { recordEvent } from "./record";

/**
 * The steps of the funnel that the server records itself, when the action worked. The path is the
 * address of the action, one of a short list, so a route that is renamed makes this fail to compile
 * instead of leaving the numbers under a stale name.
 */
export type FunnelEvent = {
  kind: Extract<CollectEvent["kind"], "add_to_library" | "follow">;
  path: "/library/add" | "/library/add-external" | "/u/:username";
};

/**
 * Records a step of the funnel from inside the action that did it (SAG-24, ADR-050). It is written
 * by the server and not sent by the browser, so it cannot be forged from a script, an ad blocker
 * cannot cut it, and it only exists if the action worked. The caller says nothing about who: the
 * visitor is the same daily hash as the page views, made from the request.
 *
 * It follows the same rules as the collector (`isMeasured`): nothing is kept where the deployment
 * did not switch the analytics on, for a visitor who asked not to be measured, for a robot, or for
 * an administrator (the owner is not counted). The write runs after the answer is sent, so it adds
 * no time to the action. Nothing in here may fail the action, which has already been done: the
 * whole of it is guarded, and a failure is logged without values and never reaches the person.
 *
 * `path` is the address of the action, not of the page the person was on, which the server does not
 * know.
 */
export function recordFunnelEvent(
  request: Request,
  user: { role: string },
  event: FunnelEvent,
): void {
  try {
    if (!isMeasured(request, user)) return;

    runInBackground(
      (async () => {
        try {
          await recordEvent(await getDb(), request, event, new Date());
        } catch (error) {
          logUnhandled(error, request);
        }
      })(),
    );
  } catch (error) {
    // The environment could not be read, or there is no request to run work after.
    logUnhandled(error, request);
  }
}
