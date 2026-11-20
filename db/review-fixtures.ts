import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { expect } from "vitest";

import {
  readReviews,
  saveReview,
  type ReviewInput,
} from "../server/db/reviews";
import { reviewFingerprint } from "../server/reviews/rules";
import type { Level } from "../server/social/can-view";
import type { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

// The people, titles and reviews of the integration tests of reviews (SAG-22, ADR-053, ADR-056).

export type Person = { id: string; username: string };

type ReviewOptions = Partial<Omit<ReviewInput, "body" | "fingerprint">>;

const bodyFor = (seed: string) =>
  `${seed}. ${"Una reseña con algo de sustancia sobre la historia. ".repeat(12)}`.trim();

/** A review of at least 500 characters, different for each seed. */
export async function input(
  seed: string,
  options: ReviewOptions = {},
): Promise<ReviewInput> {
  const body = bodyFor(seed);
  return {
    body,
    fingerprint: await reviewFingerprint(body),
    spoiler: options.spoiler ?? false,
    visibility: options.visibility ?? "public",
  };
}

export function reviewFixtures(db: ReturnType<typeof createTestDb>["db"]) {
  const { newUser, newMedia } = factories(db);
  let titles = 0;

  /** Empties the database; the titles are numbered from 1 again. */
  async function reset() {
    await db.execute(sql`TRUNCATE users, media_items RESTART IDENTITY CASCADE`);
    titles = 0;
  }

  /** A person whose account is two days old, so their reviews are not held (ADR-053). */
  async function person(
    privacy: Level = "public",
    ageHours = 48,
  ): Promise<Person> {
    const row = await newUser({ privacy });
    await db.execute(sql`
      UPDATE users SET created_at = now() - make_interval(hours => ${ageHours})
      WHERE id = ${row.id}::uuid`);
    return { id: row.id, username: row.username };
  }

  async function follow(follower: Person, followee: Person) {
    await db.execute(
      sql`INSERT INTO follows (follower_id, followee_id) VALUES (${follower.id}::uuid, ${followee.id}::uuid)`,
    );
  }

  async function entryOf(
    who: Person,
    mediaId: string,
    options: { status?: string; entry?: Level; score?: number | null } = {},
  ) {
    await db.execute(sql`
      INSERT INTO library_entries (user_id, media_id, status, visibility, score)
      VALUES (${who.id}::uuid, ${mediaId}::uuid, ${options.status ?? "completed"}::library_status,
              ${options.entry ?? "public"}::privacy_level, ${options.score ?? null}::smallint)`);
  }

  /** A new title in the library of `who`, by hand (a custom title cannot be added by `addEntry`). */
  async function titleOf(
    who: Person,
    options: {
      status?: string;
      entry?: Level;
      score?: number | null;
      mediaType?: "anime" | "custom";
    } = {},
  ): Promise<string> {
    titles += 1;
    const media = await newMedia({
      type: options.mediaType ?? "anime",
      title: `Title ${titles}`,
    });
    await entryOf(who, media.id, options);
    return media.id;
  }

  /** Writes a new review of `who`, which must be created. */
  async function review(
    who: Person,
    mediaId: string,
    options: ReviewOptions = {},
  ) {
    const result = await saveReview(
      db,
      who.id,
      mediaId,
      await input(`${who.username} ${mediaId}`, options),
      randomUUID(),
    );
    expect(result).toBe("created");
  }

  const authorsSeenBy = async (viewer: Person | null, mediaId: string) =>
    (
      await readReviews(db, viewer?.id ?? null, mediaId, "recent", 1)
    ).reviews.map((one) => one.author.username);

  const count = async (query: ReturnType<typeof sql>) =>
    Number((await db.execute(query)).rows[0]?.n);

  return {
    newMedia,
    reset,
    person,
    follow,
    entryOf,
    titleOf,
    review,
    authorsSeenBy,
    count,
  };
}
