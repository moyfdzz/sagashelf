import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { saveMedia } from "../server/db/media-store";
import { proposeSagaDrafts } from "../server/db/saga-drafts";
import { auditLog, sagas, sagaWikidataMembers } from "../server/db/schema";
import {
  findSagaSyncWork,
  getSagaBySlug,
  getSagasOfMedia,
  saveSagas,
} from "../server/db/sagas";
import {
  addSagaMember,
  createSaga,
  getSagaForAdmin,
  listSagasForAdmin,
  moveSagaMember,
  removeSagaMember,
  renameSaga,
  setSagaStatus,
} from "../server/db/sagas-admin";
import { saveWikidata } from "../server/db/wikidata-store";
import type { NormalizedMedia } from "../server/providers/types";
import type { WikidataItem } from "../server/providers/wikidata/map";
import { createTestDb } from "./test-database";
import { factories, failsWith } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE media_items, wikidata_items, wikidata_links, sagas, audit_log, users RESTART IDENTITY CASCADE`,
  );
});

const item = (
  overrides: Partial<WikidataItem> & { qid: string },
): WikidataItem => ({
  labels: {},
  format: "other",
  ids: {},
  franchises: [],
  basedOn: [],
  year: null,
  detailed: true,
  ...overrides,
});

const entry = {
  slug: "attack-on-titan",
  titles: { es: "Ataque a los Titanes", en: "Attack on Titan" },
  hash: "h1",
  members: ["Q1", "Q2", "Q3"],
};

const membersOf = async (id: string) =>
  (await getSagaForAdmin(db, id))?.members.map((member) => member.qid);

const actions = async () =>
  (await db.select().from(auditLog)).map((row) => row.action).sort();

describe("creating a saga", () => {
  it("makes a draft owned by the screen, and writes who did it", async () => {
    const admin = await newUser();

    const id = await createSaga(db, {
      slug: "dune",
      titles: { es: "Dune", en: "Dune" },
      actorId: admin.id,
    });

    expect(id).not.toBeNull();
    expect(await db.select().from(sagas)).toMatchObject([
      {
        slug: "dune",
        title: "Dune",
        titles: { es: "Dune", en: "Dune" },
        status: "draft",
        origin: "admin",
      },
    ]);
    expect(await db.select().from(auditLog)).toMatchObject([
      {
        actorId: admin.id,
        action: "saga.create",
        targetType: "saga",
        targetId: id,
        metadata: { slug: "dune" },
      },
    ]);
  });

  it("says no and writes nothing when the address is taken", async () => {
    const admin = await newUser();
    await createSaga(db, {
      slug: "dune",
      titles: { es: "A", en: "A" },
      actorId: admin.id,
    });

    const again = await createSaga(db, {
      slug: "dune",
      titles: { es: "B", en: "B" },
      actorId: admin.id,
    });

    expect(again).toBeNull();
    expect(await db.select().from(sagas)).toHaveLength(1);
    expect(await actions()).toEqual(["saga.create"]);
  });
});

describe("publishing, renaming and the screen taking over", () => {
  async function fileSaga() {
    await saveSagas(db, [entry]);
    const [row] = await db.select().from(sagas);
    if (!row) throw new Error("The saga was not saved");
    return row.id;
  }

  it("publishes and unpublishes, and each is a row of the record", async () => {
    const admin = await newUser();
    const id = await fileSaga();

    expect(await setSagaStatus(db, id, "draft", admin.id)).toBe(true);
    expect((await db.select().from(sagas))[0]?.status).toBe("draft");
    expect(await setSagaStatus(db, id, "published", admin.id)).toBe(true);
    expect((await db.select().from(sagas))[0]?.status).toBe("published");
    expect(await actions()).toEqual(["saga.publish", "saga.unpublish"]);
  });

  it("says false and writes nothing for a saga that does not exist", async () => {
    const admin = await newUser();
    const none = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

    expect(await setSagaStatus(db, none, "draft", admin.id)).toBe(false);
    expect(await renameSaga(db, none, { es: "a", en: "b" }, admin.id)).toBe(
      false,
    );
    expect(await removeSagaMember(db, none, "Q1", admin.id)).toBe(false);
    expect(await moveSagaMember(db, none, "Q1", "up", admin.id)).toBe(false);
    expect(await addSagaMember(db, none, "Q1", admin.id)).toEqual({
      found: false,
      added: false,
    });
    expect(await actions()).toEqual([]);
  });

  it("renames in both languages and keeps the address", async () => {
    const admin = await newUser();
    const id = await fileSaga();

    await renameSaga(db, id, { es: "Titanes", en: "Titans" }, admin.id);

    expect(await db.select().from(sagas)).toMatchObject([
      {
        slug: "attack-on-titan",
        title: "Titans",
        titles: { es: "Titanes", en: "Titans" },
        origin: "admin",
      },
    ]);
  });

  it("takes a saga from the file once an administrator touches it: the sync never saves it over", async () => {
    const admin = await newUser();
    const id = await fileSaga();
    expect((await db.select().from(sagas))[0]?.origin).toBe("file");

    await renameSaga(db, id, { es: "Mi saga", en: "My saga" }, admin.id);
    await removeSagaMember(db, id, "Q3", admin.id);

    // The file changed (a new hash and a new list), and the sync is asked about it.
    const work = await findSagaSyncWork(
      db,
      [{ slug: entry.slug, hash: "h2" }],
      ["Q1", "Q2", "Q3", "Q4"],
    );
    expect(work.changedSlugs).toEqual([]);
    await saveSagas(db, [
      {
        ...entry,
        hash: "h2",
        titles: { es: "Otro", en: "Other" },
        members: ["Q9"],
      },
    ]);

    expect(await db.select().from(sagas)).toMatchObject([
      {
        title: "My saga",
        titles: { es: "Mi saga", en: "My saga" },
        sourceHash: "h1",
      },
    ]);
    expect(await membersOf(id)).toEqual(["Q1", "Q2"]);
  });

  it("keeps updating a saga of the file that nobody touched", async () => {
    const id = await fileSaga();

    const work = await findSagaSyncWork(
      db,
      [{ slug: entry.slug, hash: "h2" }],
      [],
    );
    await saveSagas(db, [{ ...entry, hash: "h2", members: ["Q7", "Q1"] }]);

    expect(work.changedSlugs).toEqual([entry.slug]);
    expect(await membersOf(id)).toEqual(["Q7", "Q1"]);
  });

  it("never saves the file over a saga an administrator made with the same address", async () => {
    const admin = await newUser();
    await createSaga(db, {
      slug: entry.slug,
      titles: { es: "Mía", en: "Mine" },
      actorId: admin.id,
    });

    const work = await findSagaSyncWork(
      db,
      [{ slug: entry.slug, hash: "h1" }],
      [],
    );
    await saveSagas(db, [entry]);

    expect(work.changedSlugs).toEqual([]);
    expect(await db.select().from(sagas)).toMatchObject([
      { title: "Mine", origin: "admin", sourceHash: null },
    ]);
    expect(await db.select().from(sagaWikidataMembers)).toEqual([]);
  });
});

describe("the works of a saga", () => {
  async function saga() {
    const admin = await newUser();
    const id = await createSaga(db, {
      slug: "dune",
      titles: { es: "Dune", en: "Dune" },
      actorId: admin.id,
    });
    if (!id) throw new Error("The saga was not created");
    return { admin, id };
  }

  it("adds each work at the end, once, and the record says it", async () => {
    const { admin, id } = await saga();

    expect(await addSagaMember(db, id, "Q1", admin.id)).toEqual({
      found: true,
      added: true,
    });
    await addSagaMember(db, id, "Q2", admin.id);
    expect(await addSagaMember(db, id, "Q1", admin.id)).toEqual({
      found: true,
      added: false,
    });

    expect(await membersOf(id)).toEqual(["Q1", "Q2"]);
    expect(await actions()).toEqual([
      "saga.create",
      "saga.member_add",
      "saga.member_add",
    ]);
  });

  it("refuses a code that is not an item, through the table", async () => {
    const { id } = await saga();

    expect(
      (
        await failsWith(
          db.execute(
            sql`INSERT INTO saga_wikidata_members (saga_id, qid, position)
                VALUES (${id}::uuid, 'nope', 0)`,
          ),
        )
      ).constraint,
    ).toBe("saga_wikidata_members_qid_check");
  });

  it("moves a work up or down by swapping it with its neighbour", async () => {
    const { admin, id } = await saga();
    for (const qid of ["Q1", "Q2", "Q3"]) {
      await addSagaMember(db, id, qid, admin.id);
    }

    expect(await moveSagaMember(db, id, "Q3", "up", admin.id)).toBe(true);
    expect(await membersOf(id)).toEqual(["Q1", "Q3", "Q2"]);
    expect(await moveSagaMember(db, id, "Q1", "down", admin.id)).toBe(true);
    expect(await membersOf(id)).toEqual(["Q3", "Q1", "Q2"]);
    expect(await actions()).toContain("saga.member_move");
  });

  it("does not move the first work up, the last down, or a work the saga does not have", async () => {
    const { admin, id } = await saga();
    for (const qid of ["Q1", "Q2"]) await addSagaMember(db, id, qid, admin.id);
    const before = (await db.select().from(auditLog)).length;

    expect(await moveSagaMember(db, id, "Q1", "up", admin.id)).toBe(false);
    expect(await moveSagaMember(db, id, "Q2", "down", admin.id)).toBe(false);
    expect(await moveSagaMember(db, id, "Q9", "up", admin.id)).toBe(false);

    expect(await membersOf(id)).toEqual(["Q1", "Q2"]);
    expect((await db.select().from(auditLog)).length).toBe(before);
  });

  it("moves across the hole a removal leaves", async () => {
    const { admin, id } = await saga();
    for (const qid of ["Q1", "Q2", "Q3"]) {
      await addSagaMember(db, id, qid, admin.id);
    }
    await removeSagaMember(db, id, "Q2", admin.id);

    expect(await moveSagaMember(db, id, "Q3", "up", admin.id)).toBe(true);

    expect(await membersOf(id)).toEqual(["Q3", "Q1"]);
  });

  it("removes a work once, and says false the second time", async () => {
    const { admin, id } = await saga();
    await addSagaMember(db, id, "Q1", admin.id);

    expect(await removeSagaMember(db, id, "Q1", admin.id)).toBe(true);
    expect(await removeSagaMember(db, id, "Q1", admin.id)).toBe(false);
    expect(await membersOf(id)).toEqual([]);
  });

  it("only moves the works of the saga in the address", async () => {
    const { admin, id } = await saga();
    const other = await createSaga(db, {
      slug: "other",
      titles: { es: "O", en: "O" },
      actorId: admin.id,
    });
    if (!other) throw new Error("The saga was not created");
    for (const qid of ["Q1", "Q2"]) {
      await addSagaMember(db, id, qid, admin.id);
      await addSagaMember(db, other, qid, admin.id);
    }

    await moveSagaMember(db, id, "Q2", "up", admin.id);

    expect(await membersOf(id)).toEqual(["Q2", "Q1"]);
    expect(await membersOf(other)).toEqual(["Q1", "Q2"]);
  });

  it("writes who did it and never a token or an address in the record", async () => {
    const { admin, id } = await saga();
    await addSagaMember(db, id, "Q1", admin.id);

    const rows = await db.select().from(auditLog);

    for (const row of rows) {
      expect(row.actorId).toBe(admin.id);
      expect(JSON.stringify(row.metadata)).not.toMatch(/@|token|secret/i);
    }
  });
});

describe("what the screen reads", () => {
  it("lists the drafts first, with how many works Wikidata has described", async () => {
    const admin = await newUser();
    await saveSagas(db, [entry]);
    const draft = await createSaga(db, {
      slug: "zzz-draft",
      titles: { es: "Z", en: "Z" },
      actorId: admin.id,
    });
    if (!draft) throw new Error("The saga was not created");
    await addSagaMember(db, draft, "Q1", admin.id);
    await addSagaMember(db, draft, "Q2", admin.id);
    await saveWikidata(db, {
      titles: [],
      items: [
        item({ qid: "Q1", year: 1999 }),
        item({ qid: "Q2", detailed: false }),
      ],
    });

    const list = await listSagasForAdmin(db);

    expect(list.map((saga) => saga.slug)).toEqual([
      "zzz-draft",
      "attack-on-titan",
    ]);
    expect(list[0]).toMatchObject({
      status: "draft",
      origin: "admin",
      members: 2,
      described: 1,
    });
    expect(list[1]).toMatchObject({
      status: "published",
      origin: "file",
      members: 3,
    });
  });

  it("gives every work of a saga, described or not, in the order of the story", async () => {
    const admin = await newUser();
    const id = await createSaga(db, {
      slug: "dune",
      titles: { es: "Dune", en: "Dune" },
      actorId: admin.id,
    });
    if (!id) throw new Error("The saga was not created");
    await addSagaMember(db, id, "Q2", admin.id);
    await addSagaMember(db, id, "Q1", admin.id);
    await saveWikidata(db, {
      titles: [],
      items: [
        item({ qid: "Q1", labels: { en: "One" }, format: "book", year: 1965 }),
        item({ qid: "Q2", labels: { en: "Two" }, detailed: false }),
      ],
    });

    const page = await getSagaForAdmin(db, id);

    expect(page?.saga).toMatchObject({ slug: "dune", status: "draft" });
    expect(page?.members).toEqual([
      // Looked up only: it has a name from a lookup but no description, so the screen says so.
      { qid: "Q2", position: 0, format: null, labels: {}, year: null },
      {
        qid: "Q1",
        position: 1,
        format: "book",
        labels: { en: "One" },
        year: 1965,
      },
    ]);
  });

  it("gives a saga with no works, and null for one that does not exist", async () => {
    const admin = await newUser();
    const id = await createSaga(db, {
      slug: "empty",
      titles: { es: "E", en: "E" },
      actorId: admin.id,
    });
    if (!id) throw new Error("The saga was not created");

    expect((await getSagaForAdmin(db, id))?.members).toEqual([]);
    expect(
      await getSagaForAdmin(db, "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f"),
    ).toBeNull();
  });
});

describe("a draft is never seen by a visitor", () => {
  const anime: NormalizedMedia = {
    type: "anime",
    title: "Attack on Titan",
    originalTitle: null,
    year: 2013,
    synopsis: {},
    imageUrl: null,
    status: "finished",
    popularity: 1,
    externalId: { provider: "tmdb", id: "tv/1429" },
  };

  async function publishedSaga() {
    await saveSagas(db, [entry]);
    await saveWikidata(db, {
      titles: [],
      items: [
        item({ qid: "Q1", labels: { en: "One" }, format: "manga", year: 2009 }),
        item({
          qid: "Q2",
          labels: { en: "Two" },
          format: "anime",
          year: 2013,
          ids: { tmdb_tv: "1429" },
        }),
        item({
          qid: "Q3",
          labels: { en: "Three" },
          format: "movie",
          year: 2015,
        }),
      ],
    });
    const media = await saveMedia(db, anime);
    const [row] = await db.select().from(sagas);
    if (!row) throw new Error("The saga was not saved");
    return { id: row.id, media };
  }

  it("shows a published saga on its page and on the badge of its titles", async () => {
    const { media } = await publishedSaga();

    expect((await getSagaBySlug(db, "attack-on-titan"))?.members).toHaveLength(
      3,
    );
    expect(await getSagasOfMedia(db, media)).toHaveLength(1);
  });

  it("hides a saga on its page and on every badge when it goes back to a draft, and shows it again when published", async () => {
    const admin = await newUser();
    const { id, media } = await publishedSaga();

    await setSagaStatus(db, id, "draft", admin.id);
    expect(await getSagaBySlug(db, "attack-on-titan")).toBeNull();
    expect(await getSagasOfMedia(db, media)).toEqual([]);

    await setSagaStatus(db, id, "published", admin.id);
    expect(await getSagaBySlug(db, "attack-on-titan")).not.toBeNull();
    expect(await getSagasOfMedia(db, media)).toHaveLength(1);
  });

  it("shows nothing of a draft made on the screen", async () => {
    const admin = await newUser();
    const id = await createSaga(db, {
      slug: "secret",
      titles: { es: "S", en: "S" },
      actorId: admin.id,
    });
    if (!id) throw new Error("The saga was not created");
    await addSagaMember(db, id, "Q2", admin.id);
    await publishedSaga();

    expect(await getSagaBySlug(db, "secret")).toBeNull();
  });
});

describe("the drafts Wikidata suggests (SAG-92)", () => {
  /** Two titles of the catalog that Wikidata says belong to one franchise, and some of its works. */
  async function franchise(options: { titles?: number; named?: boolean } = {}) {
    const { titles = 2, named = true } = options;
    const ids: string[] = [];
    for (let index = 0; index < titles; index += 1) {
      ids.push(
        await saveMedia(db, {
          type: "anime",
          title: `Title ${index}`,
          originalTitle: null,
          year: 2000 + index,
          synopsis: {},
          imageUrl: null,
          status: "finished",
          popularity: 1,
          externalId: { provider: "tmdb", id: `tv/${100 + index}` },
        }),
      );
    }
    await saveWikidata(db, {
      titles: ids.map((mediaId, index) => ({ mediaId, qid: `Q${10 + index}` })),
      items: [
        item({
          qid: "Q10",
          format: "anime",
          year: 2000,
          labels: { en: "Ten" },
          franchises: ["Q500"],
        }),
        item({
          qid: "Q11",
          format: "manga",
          year: 1995,
          labels: { en: "Eleven" },
          franchises: ["Q500"],
        }),
        item({
          qid: "Q12",
          format: "game",
          year: 2010,
          labels: { en: "A game" },
          franchises: ["Q500"],
        }),
        item({
          qid: "Q13",
          format: "movie",
          labels: { en: "No date" },
          franchises: ["Q500"],
        }),
        ...(named
          ? [
              item({
                qid: "Q500",
                format: "franchise",
                labels: { en: "Café Saga: Début!", es: "Saga del Café" },
              }),
            ]
          : []),
      ],
    });
  }

  it("proposes a draft for a franchise with two titles of the catalog, named from Wikidata", async () => {
    await franchise();

    expect(await proposeSagaDrafts(db)).toBe(1);

    expect(await db.select().from(sagas)).toMatchObject([
      {
        slug: "cafe-saga-debut",
        title: "Café Saga: Début!",
        titles: { en: "Café Saga: Début!", es: "Saga del Café" },
        status: "draft",
        origin: "wikidata",
        franchiseQid: "Q500",
      },
    ]);
  });

  it("starts the draft with the main works, the oldest first and the ones with no date last, and no games", async () => {
    await franchise();

    await proposeSagaDrafts(db);

    const [created] = await db.select().from(sagas);
    expect(await membersOf(created?.id ?? "")).toEqual(["Q11", "Q10", "Q13"]);
  });

  it("is never visible to a visitor, and the record says Wikidata proposed it", async () => {
    await franchise();

    await proposeSagaDrafts(db);

    expect(await getSagaBySlug(db, "cafe-saga-debut")).toBeNull();
    expect(await db.select().from(auditLog)).toMatchObject([
      {
        actorId: null,
        action: "saga.draft_proposed",
        metadata: { slug: "cafe-saga-debut", franchise: "Q500" },
      },
    ]);
  });

  it("proposes a franchise once", async () => {
    await franchise();

    expect(await proposeSagaDrafts(db)).toBe(1);
    expect(await proposeSagaDrafts(db)).toBe(0);
    expect(await db.select().from(sagas)).toHaveLength(1);
  });

  it("does not propose a franchise with fewer than two titles of the catalog", async () => {
    await franchise({ titles: 1 });

    expect(await proposeSagaDrafts(db)).toBe(0);
    expect(await db.select().from(sagas)).toEqual([]);
  });

  it("does not propose a franchise that has no name in Wikidata yet", async () => {
    await franchise({ named: false });

    expect(await proposeSagaDrafts(db)).toBe(0);
  });

  it("does not propose a franchise when one of its works is already in a saga", async () => {
    const admin = await newUser();
    await franchise();
    const existing = await createSaga(db, {
      slug: "mine",
      titles: { es: "M", en: "M" },
      actorId: admin.id,
    });
    if (!existing) throw new Error("The saga was not created");
    await addSagaMember(db, existing, "Q11", admin.id);

    expect(await proposeSagaDrafts(db)).toBe(0);
    expect(await db.select().from(sagas)).toHaveLength(1);
  });

  it("uses the code of the franchise in the address when the name is taken", async () => {
    const admin = await newUser();
    await createSaga(db, {
      slug: "cafe-saga-debut",
      titles: { es: "x", en: "x" },
      actorId: admin.id,
    });
    await franchise();

    await proposeSagaDrafts(db);

    expect(
      (await db.select().from(sagas)).map((saga) => saga.slug).sort(),
    ).toEqual(["cafe-saga-debut", "cafe-saga-debut-q500"]);
  });

  it("makes at most the number asked for in one run, the franchise with most titles first", async () => {
    await franchise();
    await saveWikidata(db, {
      titles: [],
      items: [
        item({ qid: "Q600", format: "franchise", labels: { en: "Second" } }),
        item({
          qid: "Q20",
          format: "anime",
          year: 2001,
          labels: { en: "Twenty" },
          franchises: ["Q600"],
        }),
        item({
          qid: "Q21",
          format: "anime",
          year: 2002,
          labels: { en: "Twenty one" },
          franchises: ["Q600"],
        }),
      ],
    });
    // Three titles of the catalog in the second franchise, so it has the most.
    const extra: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      extra.push(
        await saveMedia(db, {
          type: "anime",
          title: `Other ${index}`,
          originalTitle: null,
          year: 2010,
          synopsis: {},
          imageUrl: null,
          status: "finished",
          popularity: 1,
          externalId: { provider: "tmdb", id: `tv/${900 + index}` },
        }),
      );
    }
    await saveWikidata(db, {
      titles: extra.map((mediaId, index) => ({
        mediaId,
        qid: index === 0 ? "Q20" : "Q21",
      })),
      items: [],
    });

    expect(await proposeSagaDrafts(db, 1)).toBe(1);

    const [created] = await db.select().from(sagas);
    expect(created?.franchiseQid).toBe("Q600");
  });

  it("stays out of the way of the sync: a draft of Wikidata is never saved over, and its works are described", async () => {
    await franchise();
    await proposeSagaDrafts(db);
    await saveSagas(db, [{ ...entry, slug: "cafe-saga-debut" }]);

    const [created] = await db.select().from(sagas);
    expect(created).toMatchObject({ origin: "wikidata", sourceHash: null });

    const work = await findSagaSyncWork(db, [], []);
    // Q13 has no description yet in this test, as the others do: the draft's works are asked for.
    expect(work.missingQids).toEqual([]);
    await db.execute(
      sql`UPDATE wikidata_items SET details_at = NULL WHERE qid = 'Q13'`,
    );
    expect((await findSagaSyncWork(db, [], [])).missingQids).toEqual(["Q13"]);
  });
});

describe("the status and the origin of a saga", () => {
  it("refuse a value that is not on the list", async () => {
    expect(
      (
        await failsWith(
          db.execute(
            sql`INSERT INTO sagas (slug, title, status) VALUES ('a', 'A', 'archived')`,
          ),
        )
      ).constraint,
    ).toBe("sagas_status_check");
    expect(
      (
        await failsWith(
          db.execute(
            sql`INSERT INTO sagas (slug, title, origin) VALUES ('b', 'B', 'robot')`,
          ),
        )
      ).constraint,
    ).toBe("sagas_origin_check");
  });

  it("start as a saga of the file, published, so the 21 that exist keep showing", async () => {
    await db.execute(
      sql`INSERT INTO sagas (slug, title) VALUES ('old', 'Old')`,
    );

    expect(await db.select().from(sagas)).toMatchObject([
      { status: "published", origin: "file", franchiseQid: null },
    ]);
  });

  it("allow one saga per franchise", async () => {
    await db.execute(
      sql`INSERT INTO sagas (slug, title, franchise_qid) VALUES ('a', 'A', 'Q1')`,
    );

    expect(
      (
        await failsWith(
          db.execute(
            sql`INSERT INTO sagas (slug, title, franchise_qid) VALUES ('b', 'B', 'Q1')`,
          ),
        )
      ).code,
    ).toBe("23505");
  });
});
