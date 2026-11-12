import { getAnalyticsEnabled } from "../runtime-env";
import { canMeasure } from "./event";

/**
 * Whether a request is measured at all (SAG-24, ADR-050), written once for the collector and for the
 * steps the server records itself, so a rule added later cannot be missed in one of them: the
 * deployment switched the analytics on, the request may be measured (`canMeasure`), and the person
 * is not an administrator, so the owner is not counted. The collector has no session and passes no
 * user; the tracker is not loaded for an administrator in the first place.
 */
export function isMeasured(
  request: Request,
  user?: { role: string } | null,
): boolean {
  return (
    getAnalyticsEnabled() &&
    canMeasure(request.headers) &&
    user?.role !== "admin"
  );
}
