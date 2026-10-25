import { z } from "zod";

export const libraryStatuses = [
  "planned",
  "in_progress",
  "completed",
  "paused",
  "dropped",
] as const;
export type LibraryStatus = (typeof libraryStatuses)[number];

export const visibilityLevels = ["public", "friends", "private"] as const;
export type Visibility = (typeof visibilityLevels)[number];

export const notesMaxLength = 2000;
/** More episodes than any series has: a typo does not reach the database as a huge number. */
export const progressMax = 100_000;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
    );
  });

/** An empty field of the form means "no value". */
const optionalDate = z
  .union([z.literal(""), isoDate])
  .transform((value) => (value === "" ? null : value));

const saveSchema = z.strictObject({
  intent: z.literal("save"),
  status: z.enum(libraryStatuses),
  progress: z
    .string()
    .regex(/^\d{1,6}$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(progressMax)),
  score: z
    .string()
    .regex(/^(?:10|[1-9])?$/)
    .transform((value) => (value === "" ? null : Number(value))),
  startedAt: optionalDate,
  finishedAt: optionalDate,
  // The database counts characters, not UTF-16 units: an emoji is one.
  notes: z
    .string()
    .transform((value) => value.replace(/\r\n/g, "\n").trim())
    .refine((value) => [...value].length <= notesMaxLength, "notes_too_long")
    .transform((value) => (value === "" ? null : value)),
  visibility: z.enum(visibilityLevels),
});

/** What the editor form can send: save every field, start again, or remove the entry. */
export const libraryActionSchema = z.discriminatedUnion("intent", [
  saveSchema,
  z.strictObject({ intent: z.literal("remove") }),
  z.strictObject({ intent: z.literal("rewatch") }),
]);

export type SaveInput = z.output<typeof saveSchema>;

export const addEntrySchema = z.strictObject({ mediaId: z.uuid() });

export const sortOptions = ["recent", "title", "score", "year"] as const;
export type LibrarySort = (typeof sortOptions)[number];

export const pageSize = 24;

/** The filters of the library page, read from the address. A value that is not valid is ignored. */
export const libraryQuerySchema = z.object({
  type: z
    .enum(["anime", "movie", "series", "book", "manga"])
    .optional()
    .catch(undefined),
  status: z.enum(libraryStatuses).optional().catch(undefined),
  year: z
    .string()
    .regex(/^\d{4}$/)
    .transform(Number)
    .optional()
    .catch(undefined),
  score: z
    .string()
    .regex(/^(?:10|[1-9])$/)
    .transform(Number)
    .optional()
    .catch(undefined),
  sort: z.enum(sortOptions).catch("recent"),
  page: z
    .string()
    .regex(/^\d{1,4}$/)
    .transform(Number)
    .pipe(z.number().int().min(1))
    .catch(1),
});

export type LibraryQuery = z.output<typeof libraryQuerySchema>;
