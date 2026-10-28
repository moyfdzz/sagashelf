import type { ProviderId } from "../providers/types";

export type ImageSource = {
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
  /** Send the shared `User-Agent` with the call. MangaDex answers 400 without one. */
  sendUserAgent?: boolean;
  /** The most calls per second to this provider: the proxy spaces them out. */
  maxPerSecond?: number;
  /** The id of the title an image belongs to, so the list of removed titles can stop it. */
  externalIdOf?(file: string): string | null;
};

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// `[.]` and not an escaped dot: inside a template literal `\.` is just `.`.
const coverFile = `${uuid}[.](?:jpg|jpeg|png|webp|gif)`;

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
  // A cover is /covers/<manga id>/<file>, and the thumbnails add .256.jpg or .512.jpg to the file
  // name (also for a PNG: checked on 2026-10-28). The proxy file is "<manga id>_<file>". A hotlinked
  // image gets a different one and MangaDex says to proxy its images; it answers 400 to a call with
  // no User-Agent, and its limit is about 5 calls per second (terms read 2026-10-28).
  mangadex: {
    host: "uploads.mangadex.org",
    sizes: ["w92", "w185", "w342", "w500", "w780"],
    file: new RegExp(`^${uuid}_${coverFile}$`),
    path: (size, file) => {
      const [manga, cover] = file.split("_");
      const thumbnail = size === "w92" || size === "w185" ? 256 : 512;
      return `/covers/${manga}/${cover}.${thumbnail}.jpg`;
    },
    fileFromStored: (pathname) => {
      const match = new RegExp(`^/covers/(${uuid})/(${coverFile})$`).exec(
        pathname,
      );
      return match ? `${match[1]}_${match[2]}` : null;
    },
    sendUserAgent: true,
    maxPerSecond: 4,
    externalIdOf: (file) => file.split("_")[0] ?? null,
  },
} as const satisfies Partial<Record<ProviderId, ImageSource>>;

export type ImageProvider = keyof typeof imageSources;

export function isImageProvider(value: string): value is ImageProvider {
  return Object.hasOwn(imageSources, value);
}

/** What the proxy needs to know about a provider besides its address, or null. */
export function imageSourceOf(provider: string): ImageSource | null {
  return isImageProvider(provider) ? imageSources[provider] : null;
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
