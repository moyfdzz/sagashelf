import type { ProviderId } from "../providers/types";

type ImageSource = {
  host: string;
  basePath: string;
  /** The widths the proxy serves. Anything else is refused, so a caller cannot ask for more. */
  sizes: readonly string[];
  /** What a file name may look like. Nothing that could add a path or a query. */
  file: RegExp;
};

/**
 * The only hosts the image proxy calls. The host is written here, never taken from the request,
 * so the proxy cannot be pointed at another server (no SSRF). A provider is added here when
 * its adapter is added, after reading its image terms (ADR-005, ADR-017).
 */
export const imageSources = {
  tmdb: {
    host: "image.tmdb.org",
    basePath: "/t/p",
    sizes: ["w92", "w185", "w342", "w500", "w780"],
    file: /^[A-Za-z0-9_-]{1,64}\.(?:jpg|png)$/,
  },
} as const satisfies Partial<Record<ProviderId, ImageSource>>;

export type ImageProvider = keyof typeof imageSources;

export function isImageProvider(value: string): value is ImageProvider {
  return Object.hasOwn(imageSources, value);
}

/** The address at the provider for one image, or null when the request is not one we serve. */
export function upstreamUrl(
  provider: string,
  size: string,
  file: string,
): string | null {
  if (!isImageProvider(provider)) return null;
  const source: ImageSource = imageSources[provider];
  if (!source.sizes.includes(size) || !source.file.test(file)) return null;
  return `https://${source.host}${source.basePath}/${size}/${file}`;
}

/**
 * The address on our own site for a provider image we hold (`image_url` in the database), at the
 * size asked for. Null when the image is not from a host we serve, so the page shows no image
 * rather than a broken one.
 */
export function imageSrc(
  imageUrl: string | null | undefined,
  size: string,
): string | null {
  if (!imageUrl) return null;
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return null;
  }
  for (const [provider, source] of Object.entries(imageSources)) {
    if (url.protocol !== "https:" || url.host !== source.host) continue;
    const match = new RegExp(
      `^${source.basePath}/(?:w[0-9]+|original)/([^/]+)$`,
    ).exec(url.pathname);
    const file = match?.[1];
    if (file && upstreamUrl(provider, size, file)) {
      return `/img/${provider}/${size}/${file}`;
    }
  }
  return null;
}
