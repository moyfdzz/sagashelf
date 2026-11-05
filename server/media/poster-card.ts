import type { ProfileEntry } from "../db/profile-library";
import { imageSrc } from "../images/sources";
import type { MediaKind } from "../providers/types";
import { mediaPath } from "./slug";

/** A title of a profile as a page draws it: where it links to and its poster. */
export function posterCard(entry: ProfileEntry) {
  return {
    href: mediaPath(entry.type as MediaKind, entry.title, entry.mediaId),
    title: entry.title,
    year: entry.year,
    score: entry.score,
    poster: imageSrc(entry.imageUrl, "w185"),
  };
}
