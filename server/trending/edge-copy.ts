/**
 * A copy of an answer kept at the edge, in the Workers Cache API (SAG-23, ADR-051). Written once
 * for the two lists of the trending page. The copy is keyed by a made-up address on a host that
 * never exists, with a version that changes when the shape of an answer does, so a copy in the old
 * shape is not read. It never throws: a runtime with no Cache API, a cache that fails and a broken
 * copy only mean one more call to the source.
 */

/** The address a copy is kept under. `name` and `version` tell the lists apart. */
export const edgeKey = (
  name: string,
  version: string,
  parts: Record<string, string>,
): Request =>
  new Request(
    `https://${name}-cache.sagashelf.internal/${version}?${new URLSearchParams(parts)}`,
  );

/**
 * The copy under `key` when there is one that `parse` accepts; otherwise `load` runs, its answer is
 * kept for `seconds` and given back. An error of `load` goes to the caller and nothing is kept.
 */
export async function withEdgeCopy<T>(options: {
  cache: Cache | null;
  key: Request;
  seconds: number;
  /** The copy as a value, or null when its shape is not the expected one (a miss). */
  parse: (body: unknown) => T | null;
  load: () => Promise<T>;
}): Promise<T> {
  const { cache, key, seconds, parse, load } = options;

  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) {
        const copy = parse(await hit.json());
        if (copy !== null) return copy;
      }
    } catch {
      // A broken copy is a miss.
    }
  }

  const value = await load();

  if (cache) {
    try {
      await cache.put(
        key,
        new Response(JSON.stringify(value), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${seconds}`,
          },
        }),
      );
    } catch {
      // Not being able to keep a copy costs one more call to the source, nothing more.
    }
  }
  return value;
}
