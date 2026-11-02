import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data, Form, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/settings.notifications";
import { ClerkSession } from "~/components/ClerkSession";
import { useFormatters } from "~/lib/format";
import {
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  secondaryLinkClass,
  smallButtonClass,
} from "~/lib/ui";
import { getInstance, getLocale } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import {
  addDiscordEndpoint,
  claimEvent,
  listEndpoints,
  listRecentDeliveries,
  maxEndpointsPerPerson,
  queueTestEvent,
  reenableEndpoint,
  removeEndpoint,
} from "~server/db/webhooks";
import { readForm } from "~server/http/body";
import { deliverEvent } from "~server/jobs/deliver-outbox";
import { rateLimit } from "~server/rate-limit";
import {
  getClerkKeys,
  getDb,
  getWebhooksEnabled,
  getWriteLimiter,
} from "~server/runtime-env";
import {
  maxWebhookUrlLength,
  parseDiscordWebhookUrl,
} from "~server/webhooks/discord-url";

// The form has one address (up to a few hundred characters) or one id. Anything bigger is not from
// this page.
const maxFormBytes = 2 * 1024;

// Pages and answers that carry a person's data are never kept by a shared cache.
const privateHeaders = { "Cache-Control": "private, no-store" };

const entryId = z.uuid();

const formSchema = z.discriminatedUnion("intent", [
  z.strictObject({
    intent: z.literal("add"),
    // Longer than a real address on purpose, so the check that says "this is not a Discord webhook"
    // is the one that answers, not the one on the length of the field.
    url: z.string().max(maxWebhookUrlLength * 4),
  }),
  z.strictObject({ intent: z.literal("test"), id: entryId }),
  z.strictObject({ intent: z.literal("remove"), id: entryId }),
  z.strictObject({ intent: z.literal("enable"), id: entryId }),
]);

// Each code has its text in app/locales, under settings.notifications.errors. None of them carries
// what the person sent: an address that was refused is never written back.
type ErrorCode =
  | "invalid_url"
  | "duplicate"
  | "limit"
  | "not_found"
  | "unavailable"
  | "invalid_request";

const fail = (error: ErrorCode, status: number) =>
  data({ ok: false as const, error }, { status, headers: privateHeaders });

// Answering before the body is read leaves it open (see settings.profile.tsx).
async function answerWithoutReading<T>(request: Request, response: T) {
  await request.arrayBuffer().catch(() => undefined);
  return response;
}

export async function loader(args: Route.LoaderArgs) {
  // Sends a visitor without a session to sign in, and refuses an account with no local row.
  const user = await requireUser(args);
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const enabled = getWebhooksEnabled();
  // With the webhooks off nothing is read: the page only says so.
  const db = enabled ? await getDb() : null;
  const [endpoints, deliveries] = db
    ? await Promise.all([
        listEndpoints(db, user.id),
        listRecentDeliveries(db, user.id),
      ])
    : [[], []];

  const { t } = getInstance(args.context);
  return rootAuthLoader(args, () => ({
    title: t("app.pageTitle", { title: t("settings.notifications.title") }),
    publishableKey: keys.publishableKey,
    enabled,
    max: maxEndpointsPerPerson,
    // The address never leaves the server: only the masked form that `listEndpoints` makes.
    endpoints: endpoints.map((endpoint) => ({
      id: endpoint.id,
      maskedUrl: endpoint.maskedUrl,
      enabled: endpoint.enabled,
      disabledAt: endpoint.disabledAt?.toISOString() ?? null,
      disabledReason: endpoint.disabledReason,
    })),
    deliveries: deliveries.map((delivery) => ({
      id: delivery.id,
      endpointId: delivery.endpointId,
      type: delivery.type,
      attempt: delivery.attempt,
      statusCode: delivery.statusCode,
      latencyMs: delivery.latencyMs,
      error: delivery.error,
      createdAt: delivery.createdAt.toISOString(),
    })),
  }));
}

// Pages and answers that carry a person's data are never kept by a shared cache. Set here, for
// the page and for its data requests alike, and the cookie of an answer is kept.
export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
  const merged = new Headers(loaderHeaders);
  actionHeaders.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") merged.append(key, value);
    else merged.set(key, value);
  });
  merged.set("Cache-Control", "private, no-store");
  return merged;
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    // A page about one person's account has nothing to show a search engine.
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function action(args: Route.ActionArgs) {
  const { request } = args;

  if (Number(request.headers.get("Content-Length") ?? 0) > maxFormBytes) {
    return answerWithoutReading(request, fail("invalid_request", 413));
  }

  // A page on another site must not be able to connect a webhook, or send a message, for someone.
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return answerWithoutReading(request, fail("invalid_request", 403));
  }

  // The person is the one in the verified session, never a field of the form.
  const user = await requireUser(args);

  if (!getWebhooksEnabled()) {
    return answerWithoutReading(request, fail("unavailable", 503));
  }

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `webhooks:${user.id}`,
  );
  if (limited) return answerWithoutReading(request, limited);

  const parsed = formSchema.safeParse(await readForm(request, maxFormBytes));
  if (!parsed.success) return fail("invalid_request", 400);
  const form = parsed.data;
  const db = await getDb();

  switch (form.intent) {
    case "add": {
      // The address that is saved is built from the parts that were checked, never from the text.
      const address = parseDiscordWebhookUrl(form.url);
      if (!address) return fail("invalid_url", 400);
      const added = await addDiscordEndpoint(db, user.id, address.url);
      if (added === "duplicate") return fail("duplicate", 409);
      if (added === "limit") return fail("limit", 409);
      return data(
        { ok: true as const, intent: "add" as const },
        { headers: privateHeaders },
      );
    }
    case "remove": {
      if (!(await removeEndpoint(db, user.id, form.id))) {
        return fail("not_found", 404);
      }
      return data(
        { ok: true as const, intent: "remove" as const },
        { headers: privateHeaders },
      );
    }
    case "enable": {
      if (!(await reenableEndpoint(db, user.id, form.id))) {
        return fail("not_found", 404);
      }
      return data(
        { ok: true as const, intent: "enable" as const },
        { headers: privateHeaders },
      );
    }
    case "test": {
      const locale = getLocale(args.context) === "en" ? "en" : "es";
      const eventId = await queueTestEvent(db, user.id, form.id, locale);
      if (!eventId) return fail("not_found", 404);
      const event = await claimEvent(db, eventId);
      if (!event) return fail("not_found", 404);
      // The test is sent now, by this request, with the same rules as the job, and never retried.
      const result = await deliverEvent({ db }, event);
      return data(
        {
          ok: true as const,
          intent: "test" as const,
          delivered: result.outcome.kind === "delivered",
          status: result.statusCode,
          // A short code, never a body or an address.
          reason:
            result.outcome.kind === "delivered" ? null : result.outcome.error,
          endpointOn: result.endpointOn,
        },
        { headers: privateHeaders },
      );
    }
  }
}

type Reason = "timeout" | "network" | "redirect" | "http";

/** The text for the code a failed send gives: a status from Discord, or why there was none. */
function reasonOf(code: string | null): { kind: Reason; status: string } {
  if (code === "timeout" || code === "network" || code === "redirect") {
    return { kind: code, status: "" };
  }
  return { kind: "http", status: code?.replace("http_", "") ?? "" };
}

export default function NotificationSettings({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { t } = useTranslation();
  const { formatDate } = useFormatters();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const { enabled, max, endpoints, deliveries } = loaderData;
  const when = (iso: string) =>
    formatDate(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  const error = actionData?.ok === false ? actionData.error : null;
  const outcome = actionData?.ok === true ? actionData : null;
  const maskedOf = new Map(
    endpoints.map((endpoint) => [endpoint.id, endpoint.maskedUrl]),
  );

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-3xl font-bold">
          {t("settings.notifications.title")}
        </h1>
        <p className="text-fg-muted mt-2">
          {t("settings.notifications.description")}
        </p>
        {/* A plain link: the settings pages have a security policy of their own (ADR-018). */}
        <p className="mt-4">
          <a href="/settings/profile" className={secondaryLinkClass}>
            {t("settings.notifications.back")}
          </a>
        </p>

        {/* Always in the page, so a screen reader announces each message that appears in it. */}
        <div role="status" className="mt-6 space-y-3">
          {outcome?.intent === "add" ? (
            <p className="font-semibold">
              {t("settings.notifications.result.added")}
            </p>
          ) : null}
          {outcome?.intent === "remove" ? (
            <p className="font-semibold">
              {t("settings.notifications.result.removed")}
            </p>
          ) : null}
          {outcome?.intent === "enable" ? (
            <p className="font-semibold">
              {t("settings.notifications.result.enabled")}
            </p>
          ) : null}
          {outcome?.intent === "test" ? (
            <p className="font-semibold">
              {outcome.delivered
                ? t("settings.notifications.result.testOk")
                : t("settings.notifications.result.testFailed", {
                    reason: t(
                      `settings.notifications.reason.${reasonOf(outcome.reason).kind}`,
                      { status: reasonOf(outcome.reason).status },
                    ),
                  })}
              {!outcome.endpointOn
                ? ` ${t("settings.notifications.result.testOff")}`
                : ""}
            </p>
          ) : null}
        </div>
        {error ? (
          <p
            role="alert"
            className="border-danger-edge bg-danger-bg text-danger-fg mt-3 rounded-md border px-4 py-3 font-semibold"
          >
            {t(`settings.notifications.errors.${error}`, { max })}
          </p>
        ) : null}

        {!enabled ? (
          <p className="border-border bg-surface-raised mt-8 rounded-md border p-4">
            {t("settings.notifications.unavailable")}
          </p>
        ) : (
          <>
            <section
              aria-labelledby="connect-title"
              className="mt-10 scroll-mt-4"
            >
              <h2 id="connect-title" className="text-2xl font-bold">
                {t("settings.notifications.connect.title")}
              </h2>
              <ol className="mt-3 list-decimal space-y-1 pl-6">
                <li>{t("settings.notifications.connect.step1")}</li>
                <li>{t("settings.notifications.connect.step2")}</li>
                <li>{t("settings.notifications.connect.step3")}</li>
              </ol>
              <p className="text-fg-muted mt-3">
                {t("settings.notifications.connect.privacy")}
              </p>
              <p className="text-fg-muted mt-2">
                {t("settings.notifications.connect.secret")}
              </p>
              <Form
                method="post"
                // A key from the number of webhooks clears the field after one was saved.
                key={endpoints.length}
                className="mt-4 space-y-2"
              >
                <input type="hidden" name="intent" value="add" />
                <label htmlFor="webhook-url" className="font-semibold">
                  {t("settings.notifications.connect.label")}
                </label>
                <input
                  id="webhook-url"
                  name="url"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="url"
                  aria-describedby="webhook-url-hint"
                  className={inputClass}
                />
                <p id="webhook-url-hint" className="text-fg-muted text-sm">
                  {t("settings.notifications.connect.hint")}
                </p>
                <button
                  type="submit"
                  disabled={busy || endpoints.length >= max}
                  className={primaryButtonClass}
                >
                  {busy
                    ? t("settings.notifications.connect.submitting")
                    : t("settings.notifications.connect.submit")}
                </button>
              </Form>
            </section>

            <section aria-labelledby="list-title" className="mt-12">
              <h2 id="list-title" className="text-2xl font-bold">
                {t("settings.notifications.list.title")}
              </h2>
              <p className="text-fg-muted mt-2">
                {t("settings.notifications.list.events")}
              </p>
              {endpoints.length === 0 ? (
                <p className="mt-4">{t("settings.notifications.list.empty")}</p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {endpoints.map((endpoint) => (
                    <li
                      key={endpoint.id}
                      className="border-border bg-surface-raised rounded-md border p-4"
                    >
                      <p className="font-semibold">
                        {t("settings.notifications.list.kind")}
                        <span className="text-fg-muted ml-2 font-mono text-sm font-normal break-all">
                          {endpoint.maskedUrl}
                        </span>
                      </p>
                      <p className="mt-1">
                        {endpoint.enabled
                          ? t("settings.notifications.list.on")
                          : t("settings.notifications.list.off")}
                      </p>
                      {!endpoint.enabled ? (
                        <p
                          className="border-danger-edge bg-danger-bg text-danger-fg mt-2 rounded-md border px-3 py-2"
                          role="note"
                        >
                          {endpoint.disabledReason
                            ? t(
                                `settings.notifications.list.reason.${endpoint.disabledReason}`,
                              )
                            : null}
                          {endpoint.disabledAt
                            ? ` ${t("settings.notifications.list.since", { date: when(endpoint.disabledAt) })}`
                            : ""}
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {endpoint.enabled ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="test" />
                            <input
                              type="hidden"
                              name="id"
                              value={endpoint.id}
                            />
                            <button
                              type="submit"
                              disabled={busy}
                              className={secondaryButtonClass}
                            >
                              {busy
                                ? t("settings.notifications.list.testing")
                                : t("settings.notifications.list.test")}
                            </button>
                          </Form>
                        ) : (
                          <Form method="post">
                            <input type="hidden" name="intent" value="enable" />
                            <input
                              type="hidden"
                              name="id"
                              value={endpoint.id}
                            />
                            <button
                              type="submit"
                              disabled={busy}
                              className={secondaryButtonClass}
                            >
                              {t("settings.notifications.list.enable")}
                            </button>
                          </Form>
                        )}
                        <Form method="post">
                          <input type="hidden" name="intent" value="remove" />
                          <input type="hidden" name="id" value={endpoint.id} />
                          <button
                            type="submit"
                            disabled={busy}
                            aria-label={t(
                              "settings.notifications.list.removeLabel",
                              { url: endpoint.maskedUrl },
                            )}
                            className={smallButtonClass}
                          >
                            {t("settings.notifications.list.remove")}
                          </button>
                        </Form>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="log-title" className="mt-12">
              <h2 id="log-title" className="text-2xl font-bold">
                {t("settings.notifications.log.title")}
              </h2>
              <p className="text-fg-muted mt-2">
                {t("settings.notifications.log.times")}
              </p>
              {deliveries.length === 0 ? (
                <p className="mt-4">{t("settings.notifications.log.empty")}</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {deliveries.map((delivery) => (
                    <li
                      key={delivery.id}
                      className="border-border rounded-md border px-3 py-2"
                    >
                      <p className="font-semibold">
                        {delivery.statusCode !== null &&
                        delivery.statusCode >= 200 &&
                        delivery.statusCode < 300
                          ? t("settings.notifications.log.delivered")
                          : t("settings.notifications.log.failed")}
                        <span className="text-fg-muted ml-2 font-normal">
                          {when(delivery.createdAt)}
                        </span>
                      </p>
                      {/* An address has no spaces: it must be allowed to break, or it widens the page. */}
                      <p className="text-fg-muted text-sm break-all">
                        {maskedOf.get(delivery.endpointId)}
                      </p>
                      <p className="text-fg-muted text-sm">
                        {t("settings.notifications.log.details", {
                          attempt: delivery.attempt,
                          code: delivery.statusCode ?? delivery.error ?? "–",
                          ms: delivery.latencyMs ?? 0,
                        })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </ClerkSession>
  );
}
