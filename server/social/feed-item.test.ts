import { describe, expect, it } from "vitest";

import type { FeedEvent } from "../db/feed";
import { feedItems } from "./feed-item";

const mediaId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

const base: FeedEvent = {
  id: "event-1",
  type: "completed",
  payload: {},
  createdAt: new Date("2026-11-20T12:00:00.000Z"),
  level: "public",
  mine: false,
  actor: {
    username: "ana_reads",
    displayName: "Ana",
    avatarUrl: "https://img.clerk.com/ana",
  },
  media: { id: mediaId, type: "anime", title: "Frieren", imageUrl: null },
  likes: 2,
  liked: true,
  review: null,
};

const one = (event: Partial<FeedEvent>) => feedItems([{ ...base, ...event }]);

describe("feedItems (SAG-22)", () => {
  it("draws an event with its author, its title page and its likes", () => {
    expect(one({})).toEqual([
      {
        id: "event-1",
        kind: "completed",
        progress: null,
        score: null,
        createdAt: "2026-11-20T12:00:00.000Z",
        level: "public",
        mine: false,
        actor: {
          username: "ana_reads",
          displayName: "Ana",
          avatarUrl: "https://img.clerk.com/ana",
        },
        media: {
          href: `/media/anime/frieren-${mediaId}`,
          title: "Frieren",
          poster: null,
        },
        likes: 2,
        liked: true,
        review: null,
      },
    ]);
  });

  it.each<[Partial<FeedEvent>, object]>([
    [{ type: "started" }, { kind: "started" }],
    [{ type: "started", payload: { rewatch: true } }, { kind: "restarted" }],
    [{ type: "dropped" }, { kind: "dropped" }],
    [
      { type: "progressed", payload: { progress: 7, unit: "chapters" } },
      { kind: "progressed", progress: { count: 7, unit: "chapters" } },
    ],
    [
      { type: "progressed", payload: { progress: 3, unit: "episodes" } },
      { kind: "progressed", progress: { count: 3, unit: "episodes" } },
    ],
    [
      { type: "rated", payload: { score: 8 } },
      { kind: "rated", score: 8 },
    ],
  ])("reads the details of %j", (event, expected) => {
    expect(one(event)).toEqual([expect.objectContaining(expected)]);
  });

  it.each<Partial<FeedEvent>>([
    { type: "progressed", payload: {} },
    { type: "progressed", payload: { progress: 3, unit: "minutes" } },
    { type: "rated", payload: { score: 11 } },
    { type: "rated", payload: { score: "8" } },
    { type: "started", payload: { rewatch: "yes" } },
    { media: { ...base.media, type: "custom" } },
    { type: "reviewed", review: null },
  ])("leaves out an event it cannot draw: %j", (event) => {
    expect(one(event)).toEqual([]);
  });

  it("draws a review with an excerpt cut at a word and its spoiler mark", () => {
    const start = `${"word ".repeat(70)}tail`;
    const [item] = one({
      type: "reviewed",
      review: { start, more: false, spoiler: true },
    });
    expect(item?.kind).toBe("reviewed");
    expect(item?.review?.spoiler).toBe(true);
    expect(item?.review?.more).toBe(true);
    expect(item?.review?.excerpt.endsWith("word")).toBe(true);
    expect(start.startsWith(item?.review?.excerpt ?? "-")).toBe(true);
  });

  it("says a short review has nothing more", () => {
    const [item] = one({
      type: "reviewed",
      review: { start: "Short and complete.", more: false, spoiler: false },
    });
    expect(item?.review).toEqual({
      excerpt: "Short and complete.",
      more: false,
      spoiler: false,
    });
  });

  it("keeps only a picture from an HTTPS address", () => {
    const [item] = one({
      actor: { ...base.actor, avatarUrl: "http://not-safe.example/x" },
    });
    expect(item?.actor.avatarUrl).toBeNull();
  });
});
