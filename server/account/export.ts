import { eq, inArray } from "drizzle-orm";

import type { ProfileDb } from "../db/profile";
import {
  customEntries,
  libraryEntries,
  listItems,
  lists,
  mediaItems,
  users,
} from "../db/schema";

/** Everything SagaShelf holds about one person, in a shape they can read and keep. */
export type AccountExport = {
  exportedAt: string;
  profile: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    bio: string | null;
    locale: string;
    privacy: string;
    createdAt: string;
  };
  libraryEntries: Record<string, unknown>[];
  customEntries: Record<string, unknown>[];
  lists: Record<string, unknown>[];
};

/**
 * The data of one active account. Never the Clerk id, the role, the email address (Clerk keeps
 * the address; here there is only a normalized copy) or anything about other people.
 * Returns null when the account does not exist or was erased.
 */
export async function exportAccount(
  db: ProfileDb,
  userId: string,
  now: Date = new Date(),
): Promise<AccountExport | null> {
  const [user] = await db
    .select({
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
      locale: users.locale,
      privacy: users.privacy,
      createdAt: users.createdAt,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || user.deletedAt) return null;

  const entries = await db
    .select({
      title: mediaItems.title,
      titles: mediaItems.titles,
      status: libraryEntries.status,
      progress: libraryEntries.progress,
      score: libraryEntries.score,
      startedAt: libraryEntries.startedAt,
      finishedAt: libraryEntries.finishedAt,
      rewatchCount: libraryEntries.rewatchCount,
      notes: libraryEntries.notes,
      visibility: libraryEntries.visibility,
      createdAt: libraryEntries.createdAt,
    })
    .from(libraryEntries)
    .innerJoin(mediaItems, eq(libraryEntries.mediaId, mediaItems.id))
    .where(eq(libraryEntries.userId, userId));

  const custom = await db
    .select({
      title: mediaItems.title,
      originalTitle: mediaItems.originalTitle,
      visibility: customEntries.visibility,
      createdAt: customEntries.createdAt,
    })
    .from(customEntries)
    .innerJoin(mediaItems, eq(customEntries.mediaId, mediaItems.id))
    .where(eq(customEntries.ownerId, userId));

  const ownLists = await db
    .select({
      id: lists.id,
      title: lists.title,
      description: lists.description,
      createdAt: lists.createdAt,
    })
    .from(lists)
    .where(eq(lists.ownerId, userId));
  const items = ownLists.length
    ? await db
        .select({
          listId: listItems.listId,
          title: mediaItems.title,
          position: listItems.position,
          note: listItems.note,
        })
        .from(listItems)
        .innerJoin(mediaItems, eq(listItems.mediaId, mediaItems.id))
        .where(
          inArray(
            listItems.listId,
            ownLists.map((list) => list.id),
          ),
        )
    : [];

  return {
    exportedAt: now.toISOString(),
    profile: {
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      locale: user.locale,
      privacy: user.privacy,
      createdAt: user.createdAt.toISOString(),
    },
    libraryEntries: entries,
    customEntries: custom,
    lists: ownLists.map(({ id, ...list }) => ({
      ...list,
      items: items
        .filter((item) => item.listId === id)
        .sort((a, b) => a.position - b.position)
        .map((item) => ({
          title: item.title,
          position: item.position,
          note: item.note,
        })),
    })),
  };
}

/**
 * A cell that starts with `=`, `+`, `-` or `@` is run as a formula by spreadsheet programs, and
 * the bio is text anyone can write. A quote in front keeps it as text.
 */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const libraryColumns = [
  "title",
  "status",
  "progress",
  "score",
  "started_at",
  "finished_at",
  "times_watched_again",
  "notes",
  "visibility",
  "added_at",
] as const;

const day = (value: unknown) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : value;

/**
 * The profile as a table of `field,value`, and the library below it as a second table with its
 * own header, after an empty line. Lists and custom entries are in the JSON file.
 */
export function profileCsv(data: AccountExport): string {
  const rows: [string, unknown][] = [
    ["username", data.profile.username],
    ["display_name", data.profile.displayName],
    ["avatar_url", data.profile.avatarUrl],
    ["bio", data.profile.bio],
    ["language", data.profile.locale],
    ["privacy", data.profile.privacy],
    ["created_at", data.profile.createdAt],
  ];
  const lines = [
    "field,value",
    ...rows.map(([k, v]) => `${csvCell(k)},${csvCell(v)}`),
  ];

  if (data.libraryEntries.length > 0) {
    lines.push("", libraryColumns.join(","));
    for (const entry of data.libraryEntries) {
      lines.push(
        [
          entry.title,
          entry.status,
          entry.progress,
          entry.score,
          entry.startedAt,
          entry.finishedAt,
          entry.rewatchCount,
          entry.notes,
          entry.visibility,
          day(entry.createdAt),
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return lines.join("\r\n") + "\r\n";
}
