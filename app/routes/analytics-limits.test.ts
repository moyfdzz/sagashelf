import { getTableConfig } from "drizzle-orm/pg-core";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { maxCls, maxVitalMs } from "~/lib/tracker";
import { collectEventSchema } from "~server/analytics/event";
import {
  maxCls as serverMaxCls,
  maxVitalMs as serverMaxVitalMs,
} from "~server/analytics/vitals";
import { analyticsEvents } from "../../server/db/schema/analytics";

/**
 * The limits of the speed numbers are written in the tracker, in the collector and in the table
 * (SAG-254). Client code cannot import the server's, so they are copies, and this is what keeps them
 * equal: a number the tracker sends must be one the collector and the table take.
 */
describe("the limits of the speed numbers are the same in the tracker, the collector and the table", () => {
  it("are the same number in the tracker and in the collector", () => {
    expect(maxVitalMs).toBe(serverMaxVitalMs);
    expect(maxCls).toBe(serverMaxCls);
  });

  it("are the biggest the collector takes, and not a hair more", () => {
    const take = (numbers: Record<string, number>) =>
      collectEventSchema.safeParse({ kind: "vitals", path: "/", ...numbers })
        .success;

    expect(take({ lcp: maxVitalMs })).toBe(true);
    expect(take({ inp: maxVitalMs })).toBe(true);
    expect(take({ cls: maxCls })).toBe(true);
    expect(take({ lcp: maxVitalMs + 0.001 })).toBe(false);
    expect(take({ inp: maxVitalMs + 0.001 })).toBe(false);
    expect(take({ cls: maxCls + 0.001 })).toBe(false);
  });

  it("are written in the check of the table", () => {
    const { checks } = getTableConfig(analyticsEvents);
    const vitals = checks.find(
      (check) => check.name === "analytics_events_vitals_check",
    );
    const text = new PgDialect().sqlToQuery(vitals?.value as never).sql;

    expect(text).toContain(`between 0 and ${maxVitalMs}`);
    expect(text).toContain(`between 0 and ${maxCls}`);
  });
});
