import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data, Form, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/settings.notifications";
import { BackLink } from "~/components/BackLink";
import { ClerkSession } from "~/components/ClerkSession";
import { StatusRegion } from "~/components/StatusRegion";
import { useFormatters } from "~/lib/format";
import {
  dangerButtonClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "~/lib/ui";
import { getInstance, getLocale } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import {
  addDiscordEndpoint,
  listEndpoints,
  listRecentDeliveries,
  maxEndpointsPerPerson,
  reenableEndpoint,
  removeEndpoint,
  setEndpointEvents,
} from "~server/db/webhooks";
import { readForm } from "~server/http/body";
import { sendTestMessage } from "~server/jobs/send-test-message";
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
import {
  episodeAiredEvent,
  type SubscribableEvent,
} from "~server/webhooks/events";
import { mergePrivateHeaders, privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";

// The form has one address (up to a few hundred characters) or one id. Anything bigger is not from
// this page.
const maxFormBytes = 2 * 1024;

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
  // A ticked box is sent and an unticked one is not, so "episodes" is there or it is not.
  z.strictObject({
    intent: z.literal("alerts"),
    id: entryId,
    episodes: z.literal("on").optional(),
  }),
]);

// Each code has its text in app/locales, under settings.notifications.errors. None of them carries
// what the person sent: an address that was refused is never written back.
type ErrorCode =
  | "invalid_url"
  | "duplicate"
  | "limit"
  | "not_found"
  | "cannot_reenable"
  | "unavailable"
  | "invalid_request";

const fail = (error: ErrorCode, status: number) =>
  data({ ok: false as const, error }, { status, headers: privateHeaders });

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
      episodeAlerts: endpoint.eventTypes.includes(episodeAiredEvent),
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
export const headers = mergePrivateHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    // A page about one person's account has nothing to show a search engine.
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function action(args: Route.ActionArgs) {
  const { request } = args;

  // A page on another site must not be able to connect a webhook, or send a message, for someone.
  const unsafe = checkWrite(request, maxFormBytes);
  if (unsafe) {
    return unsafe === "too_large"
      ? fail("invalid_request", 413)
      : fail("invalid_request", 403);
  }

  // The person is the one in the verified session, never a field of the form.
  const user = await requireUser(args);

  if (!getWebhooksEnabled()) {
    return fail("unavailable", 503);
  }

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `webhooks:${user.id}`,
  );
  if (limited) return limited;

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
      const turnedOn = await reenableEndpoint(db, user.id, form.id);
      if (turnedOn === "not_found") return fail("not_found", 404);
      // The page offers the button only for an endpoint that failed several times in a row (SAG-105);
      // this is what a form sent by hand for a webhook that Discord says is gone gets.
      if (turnedOn === "not_allowed") return fail("cannot_reenable", 409);
      return data(
        { ok: true as const, intent: "enable" as const },
        { headers: privateHeaders },
      );
    }
    case "alerts": {
      const types: SubscribableEvent[] =
        form.episodes === "on" ? [episodeAiredEvent] : [];
      if (!(await setEndpointEvents(db, user.id, form.id, types))) {
        return fail("not_found", 404);
      }
      return data(
        { ok: true as const, intent: "alerts" as const },
        { headers: privateHeaders },
      );
    }
    case "test": {
      const locale = getLocale(args.context) === "en" ? "en" : "es";
      // Sent now, by this request, with the same rules as the job, and never retried.
      const sent = await sendTestMessage(db, user.id, form.id, locale);
      if (!sent.found) return fail("not_found", 404);
      return data(
        {
          ok: true as const,
          intent: "test" as const,
          delivered: sent.delivered,
          status: sent.status,
          reason: sent.reason,
          endpointOn: sent.endpointOn,
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
  // A test message that did not arrive is not a green "it worked": it stays as text below.
  const failedTest =
    outcome?.intent === "test" && !outcome.delivered
      ? t("settings.notifications.result.testFailed", {
          reason: t(
            `settings.notifications.reason.${reasonOf(outcome.reason).kind}`,
            { status: reasonOf(outcome.reason).status },
          ),
        }) +
        (outcome.endpointOn
          ? ""
          : ` ${t("settings.notifications.result.testOff")}`)
      : null;
  const doneText =
    outcome?.intent === "add"
      ? t("settings.notifications.result.added")
      : outcome?.intent === "remove"
        ? t("settings.notifications.result.removed")
        : outcome?.intent === "enable"
          ? t("settings.notifications.result.enabled")
          : outcome?.intent === "alerts"
            ? t("settings.notifications.result.alertsSaved")
            : outcome?.intent === "test" && outcome.delivered
              ? t("settings.notifications.result.testOk") +
                (outcome.endpointOn
                  ? ""
                  : ` ${t("settings.notifications.result.testOff")}`)
              : null;
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
          <BackLink to="/settings/profile">
            {t("settings.notifications.back")}
          </BackLink>
        </p>

        <StatusRegion message={doneText} messageKey={outcome} />
        {failedTest ? (
          <p role="status" className="mt-6 font-semibold">
            {failedTest}
          </p>
        ) : null}
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
                      <Form
                        method="post"
                        // A key with the saved state puts the box back as saved after a save.
                        key={`${endpoint.id}:${endpoint.episodeAlerts}`}
                        className="mt-3"
                      >
                        <input type="hidden" name="intent" value="alerts" />
                        <input type="hidden" name="id" value={endpoint.id} />
                        <fieldset>
                          <legend className="font-semibold">
                            {t("settings.notifications.alerts.legend")}
                          </legend>
                          <div className="mt-2 flex items-start gap-3">
                            <input
                              id={`episodes-${endpoint.id}`}
                              name="episodes"
                              value="on"
                              type="checkbox"
                              defaultChecked={endpoint.episodeAlerts}
                              className="mt-1 h-5 w-5 shrink-0"
                              aria-describedby={`episodes-hint-${endpoint.id}`}
                            />
                            <div>
                              <label htmlFor={`episodes-${endpoint.id}`}>
                                {t("settings.notifications.alerts.episodes")}
                              </label>
                              <p
                                id={`episodes-hint-${endpoint.id}`}
                                className="text-fg-muted text-sm"
                              >
                                {t("settings.notifications.alerts.hint")}
                              </p>
                            </div>
                          </div>
                        </fieldset>
                        <button
                          type="submit"
                          disabled={busy}
                          className={`${secondaryButtonClass} mt-2`}
                        >
                          {busy
                            ? t("settings.notifications.alerts.saving")
                            : t("settings.notifications.alerts.save")}
                        </button>
                      </Form>
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
                        ) : endpoint.disabledReason === "too_many_failures" ? (
                          // Only for several failures in a row, which can pass. A webhook that
                          // Discord says is gone, or whose token it refuses, would fail again: it is
                          // removed and a new one is pasted, as the text above says (SAG-105).
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
                        ) : null}
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
                            className={dangerButtonClass}
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
