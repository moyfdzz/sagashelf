import { expect, test } from "@playwright/test";

// The public profile (SAG-107). A visitor may open a profile, but a person who is not signed in and
// another site get nothing from the buttons, and an address that cannot be a profile never reaches
// the database. What a profile shows to each viewer needs people in a database and is tested
// against a real Postgres (`db/social-profile.integration.test.ts`) and in the route tests.
test.describe("the public profile", () => {
  test("an address that cannot be a username is a 404, the same one as for any profile that may not be seen", async ({
    request,
  }) => {
    for (const path of ["/u/ab", `/u/${"a".repeat(31)}`, "/u/has%20space"]) {
      const response = await request.get(path);

      expect(response.status(), path).toBe(404);
      expect(response.headers()["cache-control"], path).not.toMatch(/public/);
    }
  });

  test("a list of people that is not followers, following or friends is a 404", async ({
    request,
  }) => {
    for (const kind of ["other", "FOLLOWERS", "friend"]) {
      const response = await request.get(`/u/ana_reads/${kind}`);

      expect(response.status(), kind).toBe(404);
    }
  });

  test("a section of a profile that cannot exist is a 404, and is not kept by a cache", async ({
    request,
  }) => {
    for (const path of [
      "/u/ana_reads/library/paused",
      "/u/ana_reads/library/COMPLETED",
      "/u/ana_reads/library/completed?type=custom",
      "/u/ab/library/completed",
    ]) {
      const response = await request.get(path);

      expect(response.status(), path).toBe(404);
      expect(response.headers()["cache-control"], path).not.toMatch(/public/);
    }
  });

  test("a button sent by a visitor, or from another site, changes nothing", async ({
    request,
  }) => {
    for (const intent of ["follow", "unfollow", "mute", "unmute", "block"]) {
      const form = { intent };

      const visitor = await request.post("/u/ana_reads", {
        form,
        maxRedirects: 0,
      });
      const otherSite = await request.post("/u/ana_reads", {
        form,
        headers: { Origin: "https://evil.example" },
        maxRedirects: 0,
      });

      expect(visitor.status(), intent).toBeGreaterThanOrEqual(300);
      // A refusal. The framework turns a cross-site form away before the action (a 400); the check of
      // the action itself, a 403, is tested in u.$username.test.ts.
      expect(otherSite.status(), intent).toBeGreaterThanOrEqual(400);
    }
  });
});

test.describe("the page of blocked and muted people", () => {
  test("is not shown to a visitor", async ({ request }) => {
    const response = await request.get("/settings/people", {
      maxRedirects: 0,
    });

    // With Clerk's keys the visitor is sent to sign in; without them (CI) nobody gets in.
    expect([302, 303, 307, 503]).toContain(response.status());
    if (response.status() !== 503) {
      expect(response.headers()["location"]).toMatch(/sign-in|clerk/);
    }
    const body = await response.text();
    expect(body).not.toContain("No has bloqueado a nadie");
  });

  test("an undo sent by a visitor, or from another site, changes nothing", async ({
    request,
  }) => {
    const form = { intent: "unblock", username: "ben_one" };

    const visitor = await request.post("/settings/people", {
      form,
      maxRedirects: 0,
    });
    const otherSite = await request.post("/settings/people", {
      form,
      headers: { Origin: "https://evil.example" },
      maxRedirects: 0,
    });

    expect(visitor.status()).toBeGreaterThanOrEqual(300);
    expect(otherSite.status()).toBeGreaterThanOrEqual(400);
  });
});
