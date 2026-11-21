import { z } from "zod";

import type { FeedEvent } from "../db/feed";
import { personCard } from "../db/person";
import { imageSrc } from "../images/sources";
import { progressUnits } from "../library/schema";
import { isMediaKind, mediaPath } from "../media/slug";
import { splitExcerpt } from "../reviews/rules";

/**
 * One event of the feed as the page draws it (SAG-22): what happened, who did it, the title and its
 * likes. The details of an event are a JSON column, so they are read here with a schema and an
 * event whose details do not fit is left out instead of drawing something wrong.
 */

// The unit of a progress event: the one of a book or a manga, or episodes (`unitOf` in activity.ts).
const eventUnits = ["episodes", ...progressUnits] as const;

const progressed = z.object({
  progress: z.number().int().min(0),
  unit: z.enum(eventUnits),
});
const rated = z.object({ score: z.number().int().min(1).max(10) });
const started = z.object({ rewatch: z.boolean().optional() });

export type FeedItem = {
  id: string;
  /** `restarted` is a rewatch: a `started` event with `rewatch` set (ADR-054). */
  kind:
    | "started"
    | "restarted"
    | "progressed"
    | "completed"
    | "dropped"
    | "rated"
    | "reviewed";
  progress: { count: number; unit: (typeof eventUnits)[number] } | null;
  score: number | null;
  createdAt: string;
  level: FeedEvent["level"];
  mine: boolean;
  actor: FeedEvent["actor"];
  media: { href: string; title: string; poster: string | null };
  likes: number;
  liked: boolean;
  /**
   * A review: its id (to report it), its start, cut at a word, whether it goes on, its spoiler mark
   * and whether a moderator removed it. The page hides the start of a review with spoilers behind a
   * warning; a removed one only ever reaches its author (ADR-057).
   */
  review: {
    id: string;
    excerpt: string;
    more: boolean;
    spoiler: boolean;
    removed: boolean;
  } | null;
};

type Details = Pick<FeedItem, "kind" | "progress" | "score" | "review">;

function detailsOf(event: FeedEvent): Details | null {
  switch (event.type) {
    case "started": {
      const parsed = started.safeParse(event.payload);
      if (!parsed.success) return null;
      return {
        kind: parsed.data.rewatch ? "restarted" : "started",
        progress: null,
        score: null,
        review: null,
      };
    }
    case "progressed": {
      const parsed = progressed.safeParse(event.payload);
      if (!parsed.success) return null;
      return {
        kind: "progressed",
        progress: { count: parsed.data.progress, unit: parsed.data.unit },
        score: null,
        review: null,
      };
    }
    case "rated": {
      const parsed = rated.safeParse(event.payload);
      if (!parsed.success) return null;
      return {
        kind: "rated",
        progress: null,
        score: parsed.data.score,
        review: null,
      };
    }
    case "completed":
    case "dropped":
      return { kind: event.type, progress: null, score: null, review: null };
    case "reviewed": {
      if (!event.review) return null;
      const { excerpt, rest } = splitExcerpt(event.review.start);
      return {
        kind: "reviewed",
        progress: null,
        score: null,
        review: {
          id: event.review.id,
          excerpt,
          more: event.review.more || rest !== "",
          spoiler: event.review.spoiler,
          removed: event.review.removed,
        },
      };
    }
  }
}

/** The events of a page of the feed as the page draws them, in the same order. */
export function feedItems(events: readonly FeedEvent[]): FeedItem[] {
  return events.flatMap((event) => {
    const details = detailsOf(event);
    // The feed never reads a custom title, so every title has a page of its own.
    if (!details || !isMediaKind(event.media.type)) return [];
    return [
      {
        id: event.id,
        ...details,
        createdAt: event.createdAt.toISOString(),
        level: event.level,
        mine: event.mine,
        actor: personCard(event.actor),
        media: {
          href: mediaPath(event.media.type, event.media.title, event.media.id),
          title: event.media.title,
          poster: imageSrc(event.media.imageUrl, "w185"),
        },
        likes: event.likes,
        liked: event.liked,
      },
    ];
  });
}
