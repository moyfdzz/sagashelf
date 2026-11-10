import { describe, expect, it, vi } from "vitest";

import { refundDailyUnits } from "./daily-counter";

const columns = { day: "title_fetches_day", count: "title_fetches_count" };

describe("refundDailyUnits", () => {
  it("asks the database for nothing when there is nothing to give back", async () => {
    // An import without failures refunds 0: it must not cost a statement (a subrequest).
    const db = { execute: vi.fn() };

    await refundDailyUnits(db, "user-1", columns, 0);
    await refundDailyUnits(db, "user-1", columns, -2);

    expect(db.execute).not.toHaveBeenCalled();
  });

  it("uses one statement to give units back", async () => {
    const db = { execute: vi.fn().mockResolvedValue({ rows: [] }) };

    await refundDailyUnits(db, "user-1", columns, 3);

    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
