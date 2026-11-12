import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { libraryEntries, users } from "../server/db/schema";
import {
  getSiteFavorites,
  listSize,
  type Period,
} from "../server/db/site-favorites";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser, newMedia } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users, media_items RESTART IDENTITY CASCADE`);
});

// January 2026; the end is not included.
const january: Period = { from: "2026-01-01", to: "2026-02-01" };
const inJanuary = new Date("2026-01-15T12:00:00Z");

type Entry = Partial<typeof libraryEntries.$inferInsert>;

async function people(count: number) {
  const made = [];
  for (let index = 0; index < count; index += 1) made.push(await newUser());
  return made;
}

/** Every person gets an entry of the title, public and created in January unless it says otherwise. */
async function addEntries(
  group: { id: string }[],
  mediaId: string,
  values: Entry | ((index: number) => Entry) = {},
) {
  for (const [index, person] of group.entries()) {
    await db.insert(libraryEntries).values({
      userId: person.id,
      mediaId,
      visibility: "public",
      createdAt: inJanuary,
      ...(typeof values === "function" ? values(index) : values),
    });
  }
}

const ids = (list: { mediaId: string }[]) => list.map((item) => item.mediaId);

describe("the favorites of the site (SAG-23)", () => {
  it("is three empty lists when nobody has anything public", async () => {
    expect(await getSiteFavorites(db, "movie", january, "es")).toEqual({
      mostAdded: [],
      mostCompleted: [],
      bestRated: [],
    });
  });

  describe("most added", () => {
    it("lists the titles with the most people, and leaves out one with fewer than three", async () => {
      const group = await people(5);
      const popular = await newMedia({ title: "Popular" });
      const middle = await newMedia({ title: "Middle" });
      const lonely = await newMedia({ title: "Lonely" });
      await addEntries(group, popular.id);
      await addEntries(group.slice(0, 3), middle.id);
      await addEntries(group.slice(0, 2), lonely.id);

      const { mostAdded } = await getSiteFavorites(db, "movie", january, "es");

      expect(mostAdded.map((item) => [item.title, item.people])).toEqual([
        ["Popular", 5],
        ["Middle", 3],
      ]);
      expect(mostAdded[0]).toMatchObject({ type: "movie", average: null });
    });

    it("counts an entry only on the days of the period, the end day not included", async () => {
      const group = await people(3);
      const first = await newMedia({ title: "First day" });
      const last = await newMedia({ title: "Last day" });
      const before = await newMedia({ title: "Before" });
      const end = await newMedia({ title: "End" });
      await addEntries(group, first.id, {
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      await addEntries(group, last.id, {
        createdAt: new Date("2026-01-31T23:59:59Z"),
      });
      await addEntries(group, before.id, {
        createdAt: new Date("2025-12-31T23:59:59Z"),
      });
      await addEntries(group, end.id, {
        createdAt: new Date("2026-02-01T00:00:00Z"),
      });

      const { mostAdded } = await getSiteFavorites(db, "movie", january, "es");

      expect(mostAdded.map((item) => item.title).sort()).toEqual([
        "First day",
        "Last day",
      ]);
    });

    it("counts only entries that are public, of a public profile", async () => {
      const open = await people(3);
      const friendsProfile = await newUser({ privacy: "friends" });
      const privateProfile = await newUser({ privacy: "private" });
      const erased = await newUser({ deletedAt: new Date() });
      const title = await newMedia({ title: "Counted" });
      const shortOfThree = await newMedia({ title: "Two and four hidden" });
      await addEntries(open, title.id);
      // Public entries of people who are not public: none counts.
      await addEntries([friendsProfile, privateProfile, erased], title.id, {});
      await addEntries(open.slice(0, 2), shortOfThree.id);
      await addEntries(open.slice(2), shortOfThree.id, {
        visibility: "private",
      });
      await addEntries([friendsProfile], shortOfThree.id, {});
      const withFriendsEntry = await newMedia({ title: "Friends entry" });
      await addEntries(open.slice(0, 2), withFriendsEntry.id);
      await addEntries(open.slice(2), withFriendsEntry.id, {
        visibility: "friends",
      });

      const { mostAdded } = await getSiteFavorites(db, "movie", january, "es");

      expect(mostAdded.map((item) => [item.title, item.people])).toEqual([
        ["Counted", 3],
      ]);
    });

    it("keeps only titles of the type asked, and never a custom title", async () => {
      const group = await people(3);
      const movie = await newMedia({ title: "A movie" });
      const series = await newMedia({ type: "series", title: "A series" });
      const custom = await newMedia({ type: "custom", title: "Mine" });
      for (const media of [movie, series, custom]) {
        await addEntries(group, media.id);
      }

      expect(
        (await getSiteFavorites(db, "movie", january, "es")).mostAdded.map(
          (item) => item.title,
        ),
      ).toEqual(["A movie"]);
      expect(
        (await getSiteFavorites(db, "series", january, "es")).mostAdded.map(
          (item) => item.title,
        ),
      ).toEqual(["A series"]);
    });

    it("shows the title in the language asked", async () => {
      const group = await people(3);
      const media = await newMedia({
        title: "Interestelar",
        titles: { es: "Interestelar", en: "Interstellar" },
      });
      await addEntries(group, media.id);

      expect(
        (await getSiteFavorites(db, "movie", january, "en")).mostAdded[0]
          ?.title,
      ).toBe("Interstellar");
      expect(
        (await getSiteFavorites(db, "movie", january, "es")).mostAdded[0]
          ?.title,
      ).toBe("Interestelar");
    });

    it("shows at most ten titles, the ones with more people first", async () => {
      const group = await people(4);
      const medias = [];
      for (let index = 0; index < listSize + 2; index += 1) {
        medias.push(await newMedia({ title: `Title ${index}` }));
      }
      // Title 0 to 11 are added by three people; the last two by four.
      for (const [index, media] of medias.entries()) {
        await addEntries(group.slice(0, index >= listSize ? 4 : 3), media.id);
      }

      const { mostAdded } = await getSiteFavorites(db, "movie", january, "es");

      expect(mostAdded).toHaveLength(listSize);
      expect(ids(mostAdded.slice(0, 2)).sort()).toEqual(
        [medias[10]?.id, medias[11]?.id].sort(),
      );
      expect(mostAdded.slice(0, 2).map((item) => item.people)).toEqual([4, 4]);
    });
  });

  describe("most completed", () => {
    it("counts completed entries by their finish date, in the period", async () => {
      const group = await people(3);
      const done = await newMedia({ title: "Done in January" });
      const undated = await newMedia({ title: "No finish date" });
      const watching = await newMedia({ title: "Still watching" });
      const lastYear = await newMedia({ title: "Finished in December" });
      await addEntries(group, done.id, {
        status: "completed",
        finishedAt: "2026-01-20",
      });
      await addEntries(group, undated.id, { status: "completed" });
      await addEntries(group, watching.id, {
        status: "in_progress",
        finishedAt: "2026-01-20",
      });
      await addEntries(group, lastYear.id, {
        status: "completed",
        finishedAt: "2025-12-31",
      });

      const { mostCompleted } = await getSiteFavorites(
        db,
        "movie",
        january,
        "es",
      );

      expect(mostCompleted.map((item) => [item.title, item.people])).toEqual([
        ["Done in January", 3],
      ]);
    });

    it("does not count a private entry or a private profile", async () => {
      const group = await people(2);
      const hidden = await newUser({ privacy: "private" });
      const title = await newMedia({ title: "Two and a hidden one" });
      await addEntries([...group, hidden], title.id, {
        status: "completed",
        finishedAt: "2026-01-10",
      });
      const second = await newMedia({ title: "Two and a private entry" });
      await addEntries(group, second.id, {
        status: "completed",
        finishedAt: "2026-01-10",
      });
      await addEntries(await people(1), second.id, {
        status: "completed",
        finishedAt: "2026-01-10",
        visibility: "private",
      });

      expect(
        (await getSiteFavorites(db, "movie", january, "es")).mostCompleted,
      ).toEqual([]);
    });
  });

  describe("best rated", () => {
    it("ranks by the Bayesian average, so three tens do not beat many good scores", async () => {
      const few = await people(3);
      const many = await people(10);
      const low = await people(14);
      const fewTens = await newMedia({ title: "Three tens" });
      const manyNines = await newMedia({ title: "Ten nines" });
      const manyOnes = await newMedia({ title: "Fourteen ones" });
      await addEntries(few, fewTens.id, { score: 10 });
      await addEntries(many, manyNines.id, { score: 9 });
      await addEntries(low, manyOnes.id, { score: 1 });

      const { bestRated } = await getSiteFavorites(db, "movie", january, "es");

      // The mean of everything is (30 + 90 + 14) / 27 and the weight is 5 ratings, so: Ten nines
      // (90 + 5 * 4.963) / 15 = 7.65, Three tens (30 + 5 * 4.963) / 8 = 6.85, Fourteen ones
      // (14 + 5 * 4.963) / 19 = 2.04. The plain means would put the three tens first.
      expect(
        bestRated.map((item) => [item.title, item.people, item.average]),
      ).toEqual([
        ["Ten nines", 10, 9],
        ["Three tens", 3, 10],
        ["Fourteen ones", 14, 1],
      ]);
    });

    it("pulls a title towards the mean of the type, not towards zero", async () => {
      const few = await people(3);
      const many = await people(20);
      const threeSixes = await newMedia({ title: "Three sixes" });
      const twentyFives = await newMedia({ title: "Twenty fives" });
      await addEntries(few, threeSixes.id, { score: 6 });
      await addEntries(many, twentyFives.id, { score: 5 });

      const { bestRated } = await getSiteFavorites(db, "movie", january, "es");

      // The mean of the type is (18 + 100) / 23 = 5.13. Three sixes: (18 + 5 * 5.13) / 8 = 5.46.
      // Twenty fives: (100 + 5 * 5.13) / 25 = 5.03. Pulled towards zero instead, the twenty fives
      // would win (4 against 2.25).
      expect(bestRated.map((item) => item.title)).toEqual([
        "Three sixes",
        "Twenty fives",
      ]);
    });

    it("leaves out a title with fewer than three ratings", async () => {
      const group = await people(3);
      const title = await newMedia({ title: "Two scores" });
      await addEntries(group, title.id, (index) =>
        index < 2 ? { score: 10 } : {},
      );

      expect(
        (await getSiteFavorites(db, "movie", january, "es")).bestRated,
      ).toEqual([]);
    });

    it("never lets a private or friends rating into the average or the mean of the type", async () => {
      const group = await people(3);
      const secret = await people(2);
      const hidden = await newUser({ privacy: "friends" });
      const title = await newMedia({ title: "Rated" });
      await addEntries(group, title.id, { score: 10 });
      await addEntries(secret, title.id, { score: 1, visibility: "private" });
      await addEntries([hidden], title.id, { score: 1 });

      const { bestRated } = await getSiteFavorites(db, "movie", january, "es");

      expect(bestRated.map((item) => [item.people, item.average])).toEqual([
        [3, 10],
      ]);
    });

    it("places a rating on the finish date, or on the day it was added when there is none", async () => {
      const group = await people(3);
      const finished = await newMedia({ title: "Finished in January" });
      const added = await newMedia({ title: "Added in January" });
      const finishedBefore = await newMedia({ title: "Finished before" });
      await addEntries(group, finished.id, {
        score: 8,
        status: "completed",
        finishedAt: "2026-01-05",
        createdAt: new Date("2025-06-01T00:00:00Z"),
      });
      await addEntries(group, added.id, { score: 8 });
      await addEntries(group, finishedBefore.id, {
        score: 8,
        status: "completed",
        finishedAt: "2025-12-01",
        createdAt: inJanuary,
      });

      const { bestRated } = await getSiteFavorites(db, "movie", january, "es");

      expect(bestRated.map((item) => item.title).sort()).toEqual([
        "Added in January",
        "Finished in January",
      ]);
    });
  });

  it("stops counting a person as soon as they change their mind", async () => {
    const group = await people(3);
    const title = await newMedia({ title: "Changes" });
    await addEntries(group, title.id, { score: 7 });
    expect(
      (await getSiteFavorites(db, "movie", january, "es")).mostAdded,
    ).toHaveLength(1);

    await db
      .update(libraryEntries)
      .set({ visibility: "private" })
      .where(sql`${libraryEntries.userId} = ${group[0]?.id}::uuid`);
    const afterEntry = await getSiteFavorites(db, "movie", january, "es");
    expect(afterEntry.mostAdded).toEqual([]);
    expect(afterEntry.bestRated).toEqual([]);

    await db
      .update(libraryEntries)
      .set({ visibility: "public" })
      .where(sql`${libraryEntries.userId} = ${group[0]?.id}::uuid`);
    await db
      .update(users)
      .set({ privacy: "private" })
      .where(sql`${users.id} = ${group[1]?.id}::uuid`);
    expect(
      (await getSiteFavorites(db, "movie", january, "es")).mostAdded,
    ).toEqual([]);
  });
});
