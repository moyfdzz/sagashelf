/**
 * The events a person can ask a webhook to receive (SAG-28, ADR-030). `webhook.test` is not one of
 * them: it is sent on request, to one endpoint, and never chosen. `webhook_endpoints.event_types`
 * holds the ones a person ticked; an endpoint with none receives only the test.
 */
export const episodeAiredEvent = "episode.aired";

export const subscribableEvents = [episodeAiredEvent] as const;

export type SubscribableEvent = (typeof subscribableEvents)[number];
