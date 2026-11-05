import { data, redirect, redirectDocument } from "react-router";

import type { Route } from "./+types/media.open";
import { getLocale } from "~/middleware/i18next";
import { getOptionalUser } from "~server/auth/require";
import { signInPath } from "~server/auth/sign-in-url";
import { externalTitleSchema } from "~server/library/schema";
import { findMediaByExternalId } from "~server/db/media-detail";
import { importMedia } from "~server/media/import";
import { mediaPath } from "~server/media/slug";
import { ProviderError } from "~server/providers/http";
import { rateLimit } from "~server/rate-limit";
import { getDb, getMediaProviders, getOpenLimiter } from "~server/runtime-env";
import { privateHeaders, privateRouteHeaders } from "~server/http/cache";

/**
 * Opens a title the search found: the first time it saves it (so the page can show it), and
 * always ends in the canonical address. Nothing is saved from a search alone, only from this.
 *
 * A title we already hold opens for everybody. Saving a new one is a write, and this is a `GET`
 * that anyone, or a page on another site, can send, so only a person with a session saves: a
 * visitor is sent to sign in and brought back here, and the person is limited (SAG-130, ADR-035).
 */
export async function loader(args: Route.LoaderArgs) {
  const { request, context } = args;
  const url = new URL(request.url);
  const query = externalTitleSchema.safeParse({
    provider: url.searchParams.get("provider"),
    id: url.searchParams.get("id"),
  });
  if (!query.success) throw data(null, { status: 400 });

  const db = await getDb();
  const known = await findMediaByExternalId(
    db,
    query.data.provider,
    query.data.id,
  );
  if (known) {
    return redirect(mediaPath(known.type, known.title, known.id), 302);
  }

  // Nobody without a session saves a title. The way back is this same address, so signing in
  // ends in the title that was asked for.
  const user = await getOptionalUser(args);
  if (!user) {
    return redirectDocument(signInPath(request.url), {
      status: 302,
      headers: privateHeaders,
    });
  }

  // Only a call to the provider counts against the limit, and it is counted per person.
  const limited = await rateLimit(
    getOpenLimiter(),
    request,
    `media-open:${user.id}`,
  );
  if (limited) throw limited;

  try {
    const saved = await importMedia(
      { db, providers: getMediaProviders() },
      query.data.provider,
      query.data.id,
      getLocale(context) === "en" ? "en" : "es",
    );
    if (!saved) throw data(null, { status: 404 });
    return redirect(mediaPath(saved.type, saved.title, saved.id), 302);
  } catch (error) {
    if (error instanceof ProviderError) throw data(null, { status: 502 });
    throw error;
  }
}

export const headers = privateRouteHeaders;
