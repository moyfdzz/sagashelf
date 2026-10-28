import type { ProviderId } from "../providers/types";

type ImageSource = {
  host: string;
  /** The widths the proxy serves. Anything else is refused, so a caller cannot ask for more. */
  sizes: readonly string[];
  /** What a file name may look like. Nothing that could add a path or a query. */
  file: RegExp;
  /** The path at the provider of one image, for a size and a file that passed the checks above. */
  path(size: string, file: string): string;
  /** The file name of an address we stored, from its path, or null when it is not an image of ours. */
  fileFromStored(pathname: string): string | null;
  /**
   * The hosts a redirect from this provider may lead to. Without it a redirect is refused. A
   * provider that serves its images from a storage of another host (Open Library covers come from
   * archive.org) lists exactly that domain.
   */
  redirectHosts?: RegExp;
};

/**
 * The only hosts the image proxy calls. The host is written here, never taken from the request,
 * so the proxy cannot be pointed at another server (no SSRF). A provider is added here when
 * its adapter is added, after reading its image terms (ADR-005, ADR-017).
 */
export const imageSources = {
  tmdb: {
    host: "image.tmdb.org",
    sizes: ["w92", "w185", "w342", "w500", "w780"],
    file: /^[A-Za-z0-9_-]{1,64}\.(?:jpg|png)$/,
    path: (size, file) => `/t/p/${size}/${file}`,
    fileFromStored: (pathname) =>
      /^\/t\/p\/(?:w[0-9]+|original)\/([^/]+)$/.exec(pathname)?.[1] ?? null,
  },
  // Covers by cover id are the ones without a rate limit. The file is the id, and the size letter
  // is chosen here: S is 50 px wide, M 180 and L 500 or more. Terms read 2026-10-28.
  open_library: {
    host: "covers.openlibrary.org",
    sizes: ["w92", "w185", "w342", "w500", "w780"],
    file: /^[0-9]{1,12}\.jpg$/,
    path: (size, file) =>
      `/b/id/${file.replace(".jpg", "")}-${size === "w92" ? "S" : size === "w185" ? "M" : "L"}.jpg`,
    fileFromStored: (pathname) => {
      const id = /^\/b\/id\/([0-9]{1,12})-[SML]\.jpg$/.exec(pathname)?.[1];
      return id ? `${id}.jpg` : null;
    },
    // A cover answers with a redirect to archive.org, and that one to a server of its own.
    redirectHosts: /^(?:[a-z0-9-]+\.)*archive\.org$/,
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
  return `https://${source.host}${source.path(size, file)}`;
}

/** Whether a redirect from this provider's image may go to `url`: https, and a host on its list. */
export function isAllowedRedirect(provider: string, url: URL): boolean {
  if (!isImageProvider(provider)) return false;
  const source: ImageSource = imageSources[provider];
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    (source.redirectHosts?.test(url.hostname) ?? false)
  );
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
    const file = source.fileFromStored(url.pathname);
    if (file && upstreamUrl(provider, size, file)) {
      return `/img/${provider}/${size}/${file}`;
    }
  }
  return null;
}
