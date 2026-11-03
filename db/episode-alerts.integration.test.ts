import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  announceNewEpisodes,
  announceWindowDays,
  maxTitlesPerMessage,
} from "../server/db/episode-alerts";
import {
  libraryEntries,
  mediaNextEpisode,
  outbox,
  webhookEndpoints,
} from "../server/db/schema";
import { claimDueEvents, setEndpointEvents } from "../server/db/webhooks";
import { fakeWebhookUrl, otherWebhookUrl } from "../server/testing/discord";
import { discordMessage } from "../server/webhooks/message";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser, newMedia } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE users, media_items, outbox, webhook_endpoints RESTART IDENTITY CASCADE`,
  );
});

const now = new Date("2026-11-10T12:00:00Z");
const hoursAgo = (hours: number) =>
  new Date(now.getTime() - hours * 60 * 60 * 1000);
const hoursFromNow = (hours: number) => hoursAgo(-hours);

let tvmazeId = 0;

/** A series with its next episode as TVmaze gave it. */
async function series(
  title: string,
  next: {
    airStamp: Date | null;
    season?: number | null;
    number?: number | null;
  },
  titles: Record<string, string> = {},
) {
  const media = await newMedia({ type: "series", title, titles });
  tvmazeId += 1;
  await db.insert(mediaNextEpisode).values({
    mediaId: media.id,
    tvmazeId,
    showStatus: "Running",
    airDate: next.airStamp?.toISOString().slice(0, 10) ?? null,
    airStamp: next.airStamp,
    season: next.season === undefined ? 1 : next.season,
    number: next.number === undefined ? 1 : next.number,
    nextCheckAt: hoursFromNow(24),
  });
  return media;
}

async function watching(
  userId: string,
  mediaId: string,
  status: typeof libraryEntries.$inferInsert.status = "in_progress",
) {
  await db.insert(libraryEntries).values({ userId, mediaId, status });
}

async function endpoint(
  userId: string,
  values: Partial<typeof webhookEndpoints.$inferInsert> = {},
) {
  const [row] = await db
    .insert(webhookEndpoints)
    .values({
      userId,
      kind: "discord",
      url: fakeWebhookUrl,
      eventTypes: ["episode.aired"],
      ...values,
    })
    .returning();
  if (!row) throw new Error("The endpoint was not created");
  return row;
}

const queued = () => db.select().from(outbox).orderBy(asc(outbox.createdAt));

type Digest = {
  locale: string;
  total: number;
  episodes: { title: string; season: number | null; number: number | null }[];
};
const digestOf = (row: { payload: unknown }) => row.payload as Digest;

describe("announceNewEpisodes (SAG-28)", () => {
  it("tells a person that an episode of what they are watching is out, once, to the endpoint that asked", async () => {
    const person = await newUser();
    const ep = await endpoint(person.id);
    const show = await series("Severance", {
      airStamp: hoursAgo(2),
      season: 2,
      number: 5,
    });
    await watching(person.id, show.id);

    const summary = await announceNewEpisodes(db, now);

    expect(summary).toEqual({ episodes: 1, messages: 1 });
    const rows = await queued();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "episode.aired",
      endpointId: ep.id,
      status: "pending",
    });
    expect(digestOf(rows[0] ?? { payload: null })).toEqual({
      locale: "es",
      total: 1,
      episodes: [{ title: "Severance", season: 2, number: 5 }],
    });
  });

  it("marks the episode as told with its own moment", async () => {
    const person = await newUser();
    await endpoint(person.id);
    const stamp = hoursAgo(2);
    const show = await series("Severance", { airStamp: stamp });
    await watching(person.id, show.id);

    await announceNewEpisodes(db, now);

    const [row] = await db
      .select()
      .from(mediaNextEpisode)
      .where(eq(mediaNextEpisode.mediaId, show.id));
    expect(row?.announcedStamp?.toISOString()).toBe(stamp.toISOString());
  });

  it("never tells the same episode twice, however many times it runs", async () => {
    const person = await newUser();
    await endpoint(person.id);
    const show = await series("Severance", { airStamp: hoursAgo(2) });
    await watching(person.id, show.id);

    const first = await announceNewEpisodes(db, now);
    const second = await announceNewEpisodes(db, now);
    const later = await announceNewEpisodes(db, hoursFromNow(5));

    expect(first.messages).toBe(1);
    expect(second).toEqual({ episodes: 0, messages: 0 });
    expect(later).toEqual({ episodes: 0, messages: 0 });
    expect(await queued()).toHaveLength(1);
  });

  it("queues one message, not two, when two runs happen at the same time", async () => {
    const person = await newUser();
    await endpoint(person.id);
    const show = await series("Severance", { airStamp: hoursAgo(2) });
    await watching(person.id, show.id);

    const runs = await Promise.all([
      announceNewEpisodes(db, now),
      announceNewEpisodes(db, now),
      announceNewEpisodes(db, now),
    ]);

    expect(runs.reduce((sum, run) => sum + run.messages, 0)).toBe(1);
    expect(await queued()).toHaveLength(1);
  });

  it("waits for an episode whose time has not come, and tells it when it does", async () => {
    const person = await newUser();
    await endpoint(person.id);
    const stamp = hoursFromNow(3);
    const show = await series("Severance", { airStamp: stamp });
    await watching(person.id, show.id);

    const before = await announceNewEpisodes(db, now);
    const [unmarked] = await db
      .select()
      .from(mediaNextEpisode)
      .where(eq(mediaNextEpisode.mediaId, show.id));
    const after = await announceNewEpisodes(db, hoursFromNow(4));

    expect(before).toEqual({ episodes: 0, messages: 0 });
    expect(unmarked?.announcedStamp).toBeNull();
    expect(after).toEqual({ episodes: 1, messages: 1 });
  });

  it("does not announce an episode that came out longer ago than the window, so a first run is not a flood", async () => {
    const person = await newUser();
    await endpoint(person.id);
    const old = await series("Old news", {
      airStamp: hoursAgo(announceWindowDays * 24 + 1),
    });
    const fresh = await series("Fresh", {
      airStamp: hoursAgo(announceWindowDays * 24 - 1),
    });
    await watching(person.id, old.id);
    await watching(person.id, fresh.id);

    const summary = await announceNewEpisodes(db, now);

    expect(summary).toEqual({ episodes: 1, messages: 1 });
    const [row] = await queued();
    expect(digestOf(row ?? { payload: null }).episodes).toEqual([
      { title: "Fresh", season: 1, number: 1 },
    ]);
  });

  it("skips a show with no moment, and one that TVmaze gave no next episode for", async () => {
    const person = await newUser();
    await endpoint(person.id);
    const none = await series("No date", { airStamp: null });
    await watching(person.id, none.id);

    expect(await announceNewEpisodes(db, now)).toEqual({
      episodes: 0,
      messages: 0,
    });
  });

  describe("who hears it", () => {
    it.each(["planned", "completed", "paused", "dropped"] as const)(
      "does not tell a person who has the title as %s",
      async (status) => {
        const person = await newUser();
        await endpoint(person.id);
        const show = await series("Severance", { airStamp: hoursAgo(1) });
        await watching(person.id, show.id, status);

        const summary = await announceNewEpisodes(db, now);

        expect(summary.messages).toBe(0);
        expect(await queued()).toHaveLength(0);
      },
    );

    it("still marks the episode when nobody follows it, so a person who starts later is not told old news", async () => {
      const person = await newUser();
      await endpoint(person.id);
      const show = await series("Severance", { airStamp: hoursAgo(1) });

      const first = await announceNewEpisodes(db, now);
      await watching(person.id, show.id);
      const second = await announceNewEpisodes(db, now);

      expect(first).toEqual({ episodes: 1, messages: 0 });
      expect(second).toEqual({ episodes: 0, messages: 0 });
      expect(await queued()).toHaveLength(0);
    });

    it("does not tell a person who has no endpoint, or none that asked for it, or one that is off", async () => {
      const noEndpoint = await newUser();
      const noAsk = await newUser();
      const other = await newUser();
      const off = await newUser();
      await endpoint(noAsk.id, { eventTypes: [] });
      await endpoint(other.id, { eventTypes: ["library.completed"] });
      await endpoint(off.id, {
        enabled: false,
        disabledAt: now,
        disabledReason: "not_found",
      });
      const show = await series("Severance", { airStamp: hoursAgo(1) });
      for (const person of [noEndpoint, noAsk, other, off]) {
        await watching(person.id, show.id);
      }

      const summary = await announceNewEpisodes(db, now);

      expect(summary).toEqual({ episodes: 1, messages: 0 });
      expect(await queued()).toHaveLength(0);
    });

    it("tells each person only about their own titles, and never the library of another", async () => {
      const ana = await newUser();
      const beto = await newUser();
      const anaEndpoint = await endpoint(ana.id);
      const betoEndpoint = await endpoint(beto.id, { url: otherWebhookUrl });
      const shared = await series("Shared", { airStamp: hoursAgo(1) });
      const onlyAna = await series("Only Ana", { airStamp: hoursAgo(1) });
      const onlyBeto = await series("Only Beto", { airStamp: hoursAgo(1) });
      await watching(ana.id, shared.id);
      await watching(ana.id, onlyAna.id);
      await watching(beto.id, shared.id);
      await watching(beto.id, onlyBeto.id);

      const summary = await announceNewEpisodes(db, now);

      expect(summary).toEqual({ episodes: 3, messages: 2 });
      const rows = await queued();
      const titlesOf = (endpointId: string) =>
        digestOf(
          rows.find((row) => row.endpointId === endpointId) ?? {
            payload: null,
          },
        ).episodes.map((episode) => episode.title);
      expect(titlesOf(anaEndpoint.id)).toEqual(["Only Ana", "Shared"]);
      expect(titlesOf(betoEndpoint.id)).toEqual(["Only Beto", "Shared"]);
    });

    it("sends one message per endpoint of the same person, each with the whole list", async () => {
      const person = await newUser();
      await endpoint(person.id);
      await endpoint(person.id, { url: otherWebhookUrl });
      const show = await series("Severance", { airStamp: hoursAgo(1) });
      await watching(person.id, show.id);

      const summary = await announceNewEpisodes(db, now);

      expect(summary).toEqual({ episodes: 1, messages: 2 });
      expect(new Set((await queued()).map((row) => row.endpointId)).size).toBe(
        2,
      );
    });
  });

  describe("the digest", () => {
    it("puts every episode of the moment in ONE message for the endpoint, in order of title", async () => {
      const person = await newUser();
      await endpoint(person.id);
      for (const title of ["Charlie", "Alpha", "Bravo"]) {
        const show = await series(title, { airStamp: hoursAgo(1) });
        await watching(person.id, show.id);
      }

      const summary = await announceNewEpisodes(db, now);

      expect(summary).toEqual({ episodes: 3, messages: 1 });
      const [row] = await queued();
      const digest = digestOf(row ?? { payload: null });
      expect(digest.total).toBe(3);
      expect(digest.episodes.map((episode) => episode.title)).toEqual([
        "Alpha",
        "Bravo",
        "Charlie",
      ]);
    });

    it("lists a few titles and counts the rest, so a message stays short", async () => {
      const person = await newUser();
      await endpoint(person.id);
      for (let index = 0; index < maxTitlesPerMessage + 2; index += 1) {
        const show = await series(`Show ${String(index).padStart(2, "0")}`, {
          airStamp: hoursAgo(1),
        });
        await watching(person.id, show.id);
      }

      await announceNewEpisodes(db, now);

      const [row] = await queued();
      const digest = digestOf(row ?? { payload: null });
      expect(digest.total).toBe(maxTitlesPerMessage + 2);
      expect(digest.episodes).toHaveLength(maxTitlesPerMessage);
      expect(digest.episodes[0]?.title).toBe("Show 00");
    });

    it("tells a later episode of a show that was already told, and not the same one again", async () => {
      const person = await newUser();
      await endpoint(person.id);
      const show = await series("Severance", {
        airStamp: hoursAgo(30),
        season: 2,
        number: 5,
      });
      await watching(person.id, show.id);
      await announceNewEpisodes(db, hoursAgo(29));

      // The refresh job replaces the next episode with the one after it.
      await db
        .update(mediaNextEpisode)
        .set({ airStamp: hoursAgo(1), season: 2, number: 6 })
        .where(eq(mediaNextEpisode.mediaId, show.id));
      const next = await announceNewEpisodes(db, now);
      const again = await announceNewEpisodes(db, now);

      expect(next).toEqual({ episodes: 1, messages: 1 });
      expect(again).toEqual({ episodes: 0, messages: 0 });
      const rows = await queued();
      expect(rows).toHaveLength(2);
      expect(digestOf(rows[1] ?? { payload: null }).episodes).toEqual([
        { title: "Severance", season: 2, number: 6 },
      ]);
    });

    it("uses the language and the title of the person", async () => {
      const spanish = await newUser({ locale: "es" });
      const english = await newUser({ locale: "en" });
      const spanishEndpoint = await endpoint(spanish.id);
      const englishEndpoint = await endpoint(english.id, {
        url: otherWebhookUrl,
      });
      const show = await series(
        "Severance",
        { airStamp: hoursAgo(1) },
        { es: "Separación", en: "Severance (US)" },
      );
      const noSpanish = await series(
        "Only English",
        { airStamp: hoursAgo(1) },
        { en: "Only English" },
      );
      for (const person of [spanish, english]) {
        await watching(person.id, show.id);
        await watching(person.id, noSpanish.id);
      }

      await announceNewEpisodes(db, now);

      const rows = await queued();
      const forEndpoint = (id: string) =>
        digestOf(
          rows.find((row) => row.endpointId === id) ?? { payload: null },
        );
      expect(forEndpoint(spanishEndpoint.id)).toMatchObject({
        locale: "es",
        episodes: [{ title: "Only English" }, { title: "Separación" }],
      });
      expect(forEndpoint(englishEndpoint.id)).toMatchObject({
        locale: "en",
        episodes: [{ title: "Only English" }, { title: "Severance (US)" }],
      });
    });
  });

  it("queues something the delivery job can claim and turn into a message", async () => {
    const person = await newUser();
    await endpoint(person.id);
    const show = await series("Severance", {
      airStamp: hoursAgo(1),
      season: 2,
      number: 5,
    });
    await watching(person.id, show.id);

    await announceNewEpisodes(db, now);
    // The row was queued with the clock of the database, which can be a fraction of a second ahead of
    // this process (it is, in Docker), so it is claimed with a time that is clearly after it.
    const claimed = await claimDueEvents(
      db,
      10,
      new Date(Date.now() + 60 * 60 * 1000),
    );

    expect(claimed).toHaveLength(1);
    expect(
      discordMessage(claimed[0]?.type ?? "", claimed[0]?.payload ?? {})
        ?.content,
    ).toContain("Severance: temporada 2, episodio 5");
  });
});

describe("setEndpointEvents (SAG-28)", () => {
  it("replaces the events of a webhook of the person, and an empty list turns the alerts off", async () => {
    const person = await newUser();
    const ep = await endpoint(person.id, { eventTypes: [] });

    const on = await setEndpointEvents(db, person.id, ep.id, ["episode.aired"]);
    const [afterOn] = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, ep.id));
    const off = await setEndpointEvents(db, person.id, ep.id, []);
    const [afterOff] = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, ep.id));

    expect([on, off]).toEqual([true, true]);
    expect(afterOn?.eventTypes).toEqual(["episode.aired"]);
    expect(afterOff?.eventTypes).toEqual([]);
  });

  it("changes nothing, and says so, for a webhook that is not the person's", async () => {
    const owner = await newUser();
    const stranger = await newUser();
    const ep = await endpoint(owner.id, { eventTypes: [] });

    const changed = await setEndpointEvents(db, stranger.id, ep.id, [
      "episode.aired",
    ]);
    const [row] = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, ep.id));

    expect(changed).toBe(false);
    expect(row?.eventTypes).toEqual([]);
  });

  it("is what makes the alerts reach a webhook: nothing before it, a message after it", async () => {
    const person = await newUser();
    const ep = await endpoint(person.id, { eventTypes: [] });
    const show = await series("Severance", { airStamp: hoursAgo(1) });
    await watching(person.id, show.id);
    const other = await series("Next one", { airStamp: hoursAgo(1) });
    await watching(person.id, other.id);

    const before = await announceNewEpisodes(db, now);
    await setEndpointEvents(db, person.id, ep.id, ["episode.aired"]);
    await db
      .update(mediaNextEpisode)
      .set({ airStamp: hoursAgo(0.5), season: 1, number: 2 })
      .where(eq(mediaNextEpisode.mediaId, show.id));
    const after = await announceNewEpisodes(db, now);

    expect(before.messages).toBe(0);
    expect(after.messages).toBe(1);
  });
});
