import { providerUserAgent } from "../providers/http";
import { isRemoved } from "../providers/removed";
import { imageSourceOf, isAllowedRedirect, upstreamUrl } from "./sources";

/** A poster is a few hundred kilobytes at most; anything bigger is not what we asked for. */
export const maxImageBytes = 2 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

/** A day in the browser and in the edge cache, far inside the 6 months TMDB allows (ADR-017). */
export const imageCacheSeconds = 24 * 60 * 60;
const upstreamTimeoutMs = 3000;
/** An Open Library cover needs two redirects; a third is the most we follow. */
const maxRedirects = 3;

/** The longest a cover waits for its turn at a provider with a limit; after that it is asked to come back. */
const maxSpacingWaitMs = 3000;

/** When each provider with a limit may be called next, in this isolate. */
const sharedSpacing = new Map<string, number>();

/**
 * Takes the next free turn of a provider that allows `perSecond` calls a second, and says how long
 * to wait for it, or null when the wait would be too long (nothing is taken then). A page of
 * results asks for 20 covers at once; this spaces the calls instead of getting the address banned.
 */
function takeTurn(
  spacing: Map<string, number>,
  provider: string,
  perSecond: number,
  now: number,
): number | null {
  const start = Math.max(now, spacing.get(provider) ?? 0);
  if (start - now > maxSpacingWaitMs) return null;
  spacing.set(provider, start + 1000 / perSecond);
  return start - now;
}

/** Where a redirect leads, when this provider may send us there. */
function nextHop(provider: string, from: string, answer: Response) {
  const location = answer.headers.get("Location");
  if (!location) return null;
  try {
    const next = new URL(location, from);
    return isAllowedRedirect(provider, next) ? next.href : null;
  } catch {
    return null;
  }
}

export type ImageProxyDeps = {
  cache: Cache | null;
  /** Counts one request against the limit and says whether it may go on. */
  allow: () => Promise<boolean>;
  fetch?: typeof fetch;
  // Injectable so the tests need neither real time nor the module's own state.
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  spacing?: Map<string, number>;
  /** The titles to leave out; the real list unless a test passes its own. */
  removed?: ReadonlySet<string>;
};

function keyFor(path: string): Request {
  return new Request(`https://image-cache.sagashelf.internal${path}`);
}

const failure = (status: number) =>
  new Response(null, {
    status,
    // A failure is not kept: the next try may work.
    headers: { "Cache-Control": "no-store" },
  });

/**
 * Serves one provider image from our own origin: the page never talks to the provider, and the
 * provider never sees the visitor. It only fetches from the hosts in `sources.ts`, only the
 * sizes and file names that match, and only real images of a sane size. It keeps no copy beyond
 * the Cache API for one day, and sends no cookies in either direction.
 */
export async function serveImage(
  deps: ImageProxyDeps,
  provider: string,
  size: string,
  file: string,
): Promise<Response> {
  const upstream = upstreamUrl(provider, size, file);
  if (!upstream) return failure(404);

  const source = imageSourceOf(provider);
  // A title that was asked to be removed shows no cover, even one already in the cache.
  const titleId = source?.externalIdOf?.(file);
  if (titleId && isRemoved(provider, titleId, deps.removed)) {
    return failure(404);
  }

  const key = keyFor(`/${provider}/${size}/${file}`);
  try {
    const hit = await deps.cache?.match(key);
    // The headers of a cached response cannot be changed, and the Worker adds its own security
    // headers to every response, so what goes out is a copy with headers that can.
    if (hit) return new Response(hit.body, hit);
  } catch {
    // A broken cache only costs a call to the provider.
  }

  // Only a real call to the provider counts: the images already kept do not.
  if (!(await deps.allow())) {
    return new Response(null, {
      status: 429,
      headers: { "Retry-After": "60", "Cache-Control": "no-store" },
    });
  }

  if (source?.maxPerSecond) {
    const wait = takeTurn(
      deps.spacing ?? sharedSpacing,
      provider,
      source.maxPerSecond,
      (deps.now ?? Date.now)(),
    );
    if (wait === null) {
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "5", "Cache-Control": "no-store" },
      });
    }
    if (wait > 0) {
      await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(
        wait,
      );
    }
  }

  let answer: Response;
  try {
    const signal = AbortSignal.timeout(upstreamTimeoutMs);
    let target = upstream;
    for (let hops = 0; ; hops += 1) {
      answer = await (deps.fetch ?? fetch)(target, {
        // A Worker sends no cookies or referrer of its own. The runtime never follows a redirect
        // here: it is followed below, and only to a host this provider is allowed to use.
        redirect: "manual",
        signal,
        ...(source?.sendUserAgent
          ? { headers: { "User-Agent": providerUserAgent } }
          : {}),
      });
      if (answer.status < 300 || answer.status >= 400) break;
      const next = nextHop(provider, target, answer);
      if (!next || hops >= maxRedirects) return failure(502);
      target = next;
    }
  } catch {
    return failure(502);
  }
  if (answer.status === 404) return failure(404);
  if (!answer.ok) return failure(502);

  const type = answer.headers.get("Content-Type")?.split(";")[0]?.trim() ?? "";
  if (!allowedTypes.has(type)) return failure(502);
  if (Number(answer.headers.get("Content-Length") ?? 0) > maxImageBytes) {
    return failure(502);
  }
  const body = await answer.arrayBuffer().catch(() => null);
  if (!body || body.byteLength === 0 || body.byteLength > maxImageBytes) {
    return failure(502);
  }

  const response = new Response(body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": `public, max-age=${imageCacheSeconds}`,
    },
  });
  try {
    await deps.cache?.put(key, response.clone());
  } catch {
    // Not keeping the image costs a later call to the provider, nothing more.
  }
  return response;
}
