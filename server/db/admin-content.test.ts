import { describe, expect, it } from "vitest";

import { getAdminContent } from "./admin-content";
import type { SqlExecutor } from "./clerk-sync";

const now = new Date("2026-11-12T15:00:00Z");

const answering = (row: Record<string, unknown> | undefined): SqlExecutor => ({
  execute: async () => ({ rows: row ? [row] : [] }),
});

describe("getAdminContent (SAG-26)", () => {
  it("reads numbers that arrive as text and the searches as parsed JSON", async () => {
    const content = await getAdminContent(
      answering({
        searches: [
          { type: "anime", searches: "9" },
          { type: "movie", searches: 7 },
        ],
        rolled: "28",
        custom_total: "3",
        custom_new: 1,
        sagas_published: "10",
        sagas_draft: 2,
        sagas_empty: "1",
        works: 40,
        works_described: "30",
      }),
      now,
      30,
    );

    expect(content).toEqual({
      days: 30,
      from: "2026-10-13",
      to: "2026-11-11",
      rolledDays: 28,
      searches: [
        { type: "anime", searches: 9 },
        { type: "movie", searches: 7 },
      ],
      customTotal: 3,
      customNew: 1,
      sagasPublished: 10,
      sagasDraft: 2,
      sagasEmpty: 1,
      works: 40,
      worksDescribed: 30,
    });
  });

  it("reads the searches when they arrive as text, and gives none when the text is not JSON", async () => {
    const parsed = await getAdminContent(
      answering({ searches: '[{"type":"book","searches":4}]' }),
      now,
      7,
    );
    const broken = await getAdminContent(
      answering({ searches: "not json" }),
      now,
      7,
    );
    const odd = await getAdminContent(answering({ searches: "{}" }), now, 7);

    expect(parsed.searches).toEqual([{ type: "book", searches: 4 }]);
    expect(broken.searches).toEqual([]);
    expect(odd.searches).toEqual([]);
  });

  it("answers with zeros when nothing comes back, and a number that is not one is zero", async () => {
    const empty = await getAdminContent(answering(undefined), now, 7);
    const odd = await getAdminContent(answering({ works: "abc" }), now, 7);

    expect(empty).toMatchObject({ customTotal: 0, works: 0, searches: [] });
    expect(odd.works).toBe(0);
  });

  it("asks for the days that end yesterday and for the creations before the start of today", async () => {
    const asked: string[] = [];
    await getAdminContent(
      {
        execute: async (query) => {
          asked.push(JSON.stringify(query));
          return { rows: [] };
        },
      },
      now,
      7,
    );

    expect(asked[0]).toContain('"2026-11-05"');
    expect(asked[0]).toContain('"2026-11-11"');
    expect(asked[0]).toContain("2026-11-05T00:00:00Z");
    expect(asked[0]).toContain("2026-11-12T00:00:00Z");
  });
});
