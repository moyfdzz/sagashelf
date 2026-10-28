import { isAllowedRedirect, upstreamUrl } from "./sources";

/** A poster is a few hundred kilobytes at most; anything bigger is not what we asked for. */
export const maxImageBytes = 2 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

/** A day in the browser and in the edge cache, far inside the 6 months TMDB allows (ADR-017). */
export const imageCacheSeconds = 24 * 60 * 60;
const upstreamTimeoutMs = 3000;
/** An Open Library cover needs two redirects; a third is the most we follow. */
const maxRedirects = 3;

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
