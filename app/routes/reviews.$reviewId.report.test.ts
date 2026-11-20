import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/reviews.$reviewId.report";
import { action, loader } from "./reviews.$reviewId.report";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getDb: vi.fn(),
  createReport: vi.fn(),
  cancelReport: vi.fn(),
  findReportableReview: vi.fn(),
  findMyReviewReport: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/runtime-env", () => ({
  getDb: mocks.getDb,
  getWriteLimiter: () => ({ limit: mocks.limit }),
}));
vi.mock("~server/db/reports", () => ({
  createReport: mocks.createReport,
  cancelReport: mocks.cancelReport,
}));
vi.mock("~server/db/review-reports", () => ({
  findReportableReview: mocks.findReportableReview,
  findMyReviewReport: mocks.findMyReviewReport,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
}));

const db = { fake: "database" };
const session = { id: "user-1", clerkId: "clerk_1", role: "user" };
const reviewId = "018f0000-0000-7000-8000-00000000aaaa";
const mediaId = "018f0000-0000-7000-8000-00000000bbbb";
const reportId = "018f0000-0000-7000-8000-00000000cccc";
const review = {
  id: reviewId,
  authorId: "ana-id",
  author: { username: "ana_reads", displayName: "Ana" },
  media: { id: mediaId, type: "anime", title: "Frieren" },
};

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue(session);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.createReport.mockReset().mockResolvedValue("reported");
  mocks.cancelReport.mockReset().mockResolvedValue(true);
  mocks.findReportableReview.mockReset().mockResolvedValue(review);
  mocks.findMyReviewReport.mockReset().mockResolvedValue(null);
  mocks.limit.mockReset().mockResolvedValue({ success: true });
});

function send(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
  id = reviewId,
) {
  const request = new Request(`http://localhost/reviews/${id}/report`, {
    method: "POST",
    headers: { Origin: "http://localhost", ...headers },
    body: new URLSearchParams(fields),
  });
  return action({
    request,
    params: { reviewId: id },
    context: {},
  } as unknown as Route.ActionArgs);
}

const open = (id = reviewId, query = "") =>
  loader({
    request: new Request(`http://localhost/reviews/${id}/report${query}`),
    params: { reviewId: id },
    context: {},
  } as unknown as Route.LoaderArgs);

const status = async (promise: Promise<unknown>) => {
  try {
    const result = await promise;
    return (result as { init?: { status?: number } }).init?.status ?? 200;
  } catch (thrown) {
    return (thrown as { init?: { status?: number } }).init?.status;
  }
};

const location = (response: unknown) =>
  (response as Response).headers.get("Location");

describe("the page to report a review", () => {
  it("answers 404 for an id that is not one and for a review the person may not report", async () => {
    expect(await status(open("not-an-id"))).toBe(404);
    expect(mocks.findReportableReview).not.toHaveBeenCalled();

    mocks.findReportableReview.mockResolvedValue(null);
    expect(await status(open())).toBe(404);
    expect(mocks.findReportableReview).toHaveBeenCalledWith(
      db,
      "user-1",
      reviewId,
    );
  });

  it("offers the reasons of a review, spoiler first, and a link back to the reviews of the title", async () => {
    const page = await open();
    expect(page.reasons).toEqual([
      "spoiler",
      "spam",
      "harassment",
      "hate",
      "sexual_content",
      "other",
    ]);
    expect(page.back).toBe(`/media/anime/frieren-${mediaId}#reviews`);
    expect(page.name).toBe("Ana");
    expect(page.existing).toBeNull();
  });

  it("says the person already reported it and whether they can still cancel", async () => {
    mocks.findMyReviewReport.mockResolvedValue({
      id: reportId,
      reason: "spoiler",
      status: "reviewing",
    });
    const page = await open();
    expect(page.existing).toEqual({
      id: reportId,
      reason: "spoiler",
      canCancel: false,
    });
  });

  it("takes only a notice it knows from the address", async () => {
    expect((await open(reviewId, "?notice=reported")).notice).toBe("reported");
    expect((await open(reviewId, "?notice=<b>")).notice).toBeNull();
  });
});

describe("sending a report of a review", () => {
  it("records it with the author the server read and the review, never ids of the form", async () => {
    const response = await send({
      intent: "report",
      kind: "review",
      reason: "spoiler",
      details: "Cuenta el final.",
    });

    expect(location(response)).toBe(
      `/reviews/${reviewId}/report?notice=reported`,
    );
    expect(mocks.createReport).toHaveBeenCalledWith(db, {
      reporterId: "user-1",
      targetId: "ana-id",
      kind: "review",
      reason: "spoiler",
      details: "Cuenta el final.",
      pictureUrl: null,
      reviewId,
    });
  });

  it.each(["spoiler", "other"])(
    "asks for the details of the reason %s",
    async (reason) => {
      const response = await send({ intent: "report", kind: "review", reason });
      expect(await status(Promise.resolve(response))).toBe(400);
      expect((response as { data: unknown }).data).toEqual({
        error: "details_required",
      });
      expect(mocks.createReport).not.toHaveBeenCalled();
    },
  );

  it("refuses a reason of another kind and the kind of a profile", async () => {
    for (const fields of [
      { intent: "report", kind: "review", reason: "impersonation" },
      { intent: "report", kind: "user", reason: "spam" },
    ]) {
      expect(await status(send(fields))).toBe(400);
    }
    expect(mocks.createReport).not.toHaveBeenCalled();
  });

  it("answers 404 when the review can no longer be reported", async () => {
    mocks.findReportableReview.mockResolvedValue(null);
    expect(
      await status(send({ intent: "report", kind: "review", reason: "spam" })),
    ).toBe(404);
    expect(mocks.createReport).not.toHaveBeenCalled();
  });

  it("cancels the person's own report and says when it could not", async () => {
    expect(location(await send({ intent: "cancel", id: reportId }))).toBe(
      `/reviews/${reviewId}/report?notice=cancelled`,
    );
    expect(mocks.cancelReport).toHaveBeenCalledWith(db, "user-1", reportId);
    mocks.cancelReport.mockResolvedValue(false);
    expect(location(await send({ intent: "cancel", id: reportId }))).toBe(
      `/reviews/${reviewId}/report?notice=unavailable`,
    );
  });

  it("refuses a post from another site", async () => {
    expect(
      await status(
        send(
          { intent: "report", kind: "review", reason: "spam" },
          { Origin: "https://evil.example" },
        ),
      ),
    ).toBe(403);
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });
});
