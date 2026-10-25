import type { MediaKind } from "../providers/types";

export const mediaKinds = [
  "anime",
  "movie",
  "series",
  "book",
  "manga",
] as const satisfies readonly MediaKind[];

export function isMediaKind(value: string): value is MediaKind {
  return (mediaKinds as readonly string[]).includes(value);
}

const uuidTail =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The readable part of an address: lowercase letters and digits, no accents, joined by hyphens. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    // Latin letters and digits only, so the address needs no escaping.
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "title";
}

/** The canonical address of a title: `/media/movie/matrix-<id>`. */
export function mediaPath(type: MediaKind, title: string, id: string): string {
  return `/media/${type}/${slugify(title)}-${id}`;
}

/** The id at the end of the last part of the address, or null. The words before it are for people. */
export function idFromSlug(slugAndId: string): string | null {
  return uuidTail.exec(slugAndId.toLowerCase())?.[1] ?? null;
}

/** The address that opens a title we do not hold yet: it saves it, then goes to the canonical one. */
export function openPath(provider: string, externalId: string): string {
  return `/media/open?${new URLSearchParams({ provider, id: externalId })}`;
}
