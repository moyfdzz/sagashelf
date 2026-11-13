import { describe, expect, it } from "vitest";

import { getAdminOverview } from "./admin-overview";
import type { SqlExecutor } from "./clerk-sync";

const now = new Date("2026-11-12T15:00:00Z");

const answering = (row: Record<string, unknown> | undefined): SqlExecutor => ({
  execute: async () => ({ rows: row ? [row] : [] }),
});

describe("getAdminOverview (SAG-26)", () => {
  it("reads the numbers the client hands over as text, and the chart as parsed JSON", async () => {
    const overview = await getAdminOverview(
      answering({
        total_users: "12",
        new_today: 1,
        new_30: "5",
        new_365: 9,
        active_7: 3,
        active_30: "4",
        entries: 40,
        titles: 25,
        signups: [
          { day: "2026-11-11", count: 2 },
          { day: "2026-11-12", count: "1" },
        ],
      }),
      now,
    );

    expect(overview).toEqual({
      totalUsers: 12,
      newToday: 1,
      newLast30Days: 5,
      newLast365Days: 9,
      activeLast7Days: 3,
      activeLast30Days: 4,
      entriesTracked: 40,
      titlesTracked: 25,
      signups: [
        { day: "2026-11-11", count: 2 },
        { day: "2026-11-12", count: 1 },
      ],
    });
  });

  it("reads the chart when it arrives as text", async () => {
    const overview = await getAdminOverview(
      answering({ signups: '[{"day":"2026-11-12T00:00:00","count":4}]' }),
      now,
    );

    expect(overview.signups).toEqual([{ day: "2026-11-12", count: 4 }]);
  });

  it("answers with zeros and no chart when the statement returns nothing usable", async () => {
    const empty = await getAdminOverview(answering(undefined), now);
    const odd = await getAdminOverview(
      answering({ total_users: "abc", signups: "{}" }),
      now,
    );
    const broken = await getAdminOverview(
      answering({ signups: "not json" }),
      now,
    );

    expect(empty.totalUsers).toBe(0);
    expect(empty.signups).toEqual([]);
    expect(odd.totalUsers).toBe(0);
    expect(odd.signups).toEqual([]);
    expect(broken.signups).toEqual([]);
  });

  it("asks for whole days of UTC, so the windows do not move with the zone of the server", async () => {
    const seen: string[] = [];
    await getAdminOverview(
      {
        execute: async (query) => {
          seen.push(JSON.stringify(query));
          return { rows: [] };
        },
      },
      now,
    );

    expect(seen[0]).toContain("2026-11-12T00:00:00Z");
    expect(seen[0]).toContain("2026-10-14T00:00:00Z");
    expect(seen[0]).toContain("2025-11-13T00:00:00Z");
    expect(seen[0]).toContain("2026-11-06T00:00:00Z");
  });
});
