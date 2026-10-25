import { data, redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/media.open";
import { getLocale } from "~/middleware/i18next";
import { findMediaByExternalId } from "~server/db/media-detail";
import { importMedia } from "~server/media/import";
import { mediaPath } from "~server/media/slug";
import { ProviderError } from "~server/providers/http";
import { rateLimit } from "~server/rate-limit";
import {
  getDb,
  getMediaProviders,
  getSearchLimiter,
} from "~server/runtime-env";

const querySchema = z.object({
  provider: z.enum([
    "tmdb",
    "tvmaze",
    "wikidata",
    "open_library",
    "google_books",
    "mangadex",
  ]),
  // TMDB ids look like `movie/603`. Letters, digits and a few separators, never more than 64.
  id: z.string().regex(/^[A-Za-z0-9_/.-]{1,64}$/),
});

/**
 * Opens a title the search found: the first time it saves it (so the page can show it), and
 * always ends in the canonical address. Nothing is saved from a search alone, only from this.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const query = querySchema.safeParse({
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

  // Only a call to the provider counts against the limit.
  const limited = await rateLimit(getSearchLimiter(), request, "media-open");
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

export function headers() {
  return { "Cache-Control": "private, no-store" };
}
