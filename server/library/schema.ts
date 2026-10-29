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
export const viewingNotesMaxLength = 500;
/** More episodes than any series has: a typo does not reach the database as a huge number. */
export const progressMax = 100_000;

/** What the progress of a book or a manga counts. Series and movies count episodes instead. */
export const progressUnits = ["pages", "chapters", "volumes"] as const;
export type ProgressUnit = (typeof progressUnits)[number];

/** The units a person can pick for a kind of title: none for those whose total is in the catalog. */
export function progressUnitsFor(type: string): readonly ProgressUnit[] {
  if (type === "book") return ["pages"];
  if (type === "manga") return ["chapters", "volumes"];
  return [];
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
    );
  });

/**
 * An empty field of the form means "no value". A field that is missing (the form leaves out the
 * finish date while the title is not completed) means the same.
 */
const optionalDate = z
  .union([z.literal(""), isoDate])
  .optional()
  .transform((value) => (value ? value : null));

const saveSchema = z.strictObject({
  intent: z.literal("save"),
  status: z.enum(libraryStatuses),
  progress: z
    .string()
    .regex(/^\d{1,6}$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(progressMax)),
  // Only the editor of a book or a manga sends these; empty or missing means "none".
  progressUnit: z
    .union([z.literal(""), z.enum(progressUnits)])
    .optional()
    .transform((value) => (value ? value : null)),
  progressTotal: z
    .union([z.literal(""), z.string().regex(/^\d{1,6}$/)])
    .optional()
    .transform((value) => (value ? Number(value) : null))
    .pipe(z.number().int().min(1).max(progressMax).nullable()),
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

// The fields of an earlier viewing have their own names, so an error names the form it belongs to.
const viewingFields = {
  viewStartedOn: optionalDate,
  viewFinishedOn: optionalDate,
  viewNotes: z
    .string()
    .transform((value) => value.replace(/\r\n/g, "\n").trim())
    .refine(
      (value) => [...value].length <= viewingNotesMaxLength,
      "notes_too_long",
    )
    .transform((value) => (value === "" ? null : value)),
};

type ViewingDates = {
  viewStartedOn: string | null;
  viewFinishedOn: string | null;
};

/** A viewing cannot end before it starts. The database has the same rule as a second wall. */
const datesInOrder = (
  { viewStartedOn, viewFinishedOn }: ViewingDates,
  context: z.RefinementCtx,
) => {
  if (viewStartedOn && viewFinishedOn && viewFinishedOn < viewStartedOn) {
    context.addIssue({
      code: "custom",
      path: ["viewFinishedOn"],
      message: "dates_order",
    });
  }
};

/**
 * What the editor forms can send: save every field, start again, remove the entry, or add,
 * change or remove an earlier viewing.
 */
export const libraryActionSchema = z.discriminatedUnion("intent", [
  saveSchema,
  z.strictObject({ intent: z.literal("remove") }),
  z.strictObject({ intent: z.literal("rewatch") }),
  z
    .strictObject({ intent: z.literal("viewing_add"), ...viewingFields })
    .superRefine(datesInOrder),
  z
    .strictObject({
      intent: z.literal("viewing_save"),
      viewingId: z.uuid(),
      ...viewingFields,
    })
    .superRefine(datesInOrder),
  z.strictObject({ intent: z.literal("viewing_remove"), viewingId: z.uuid() }),
]);

export type SaveInput = z.output<typeof saveSchema>;

export const addEntrySchema = z.strictObject({ mediaId: z.uuid() });

/**
 * A title that only a provider knows, as the search gives it: where it comes from and its id
 * there. The id looks like `movie/603` for TMDB: letters, digits and a few separators, never more
 * than 64. It is the same thing `/media/open` takes, so a title is named the same way by both.
 */
export const externalTitleSchema = z.strictObject({
  provider: z.enum([
    "tmdb",
    "tvmaze",
    "wikidata",
    "open_library",
    "google_books",
    "mangadex",
  ]),
  id: z.string().regex(/^[A-Za-z0-9_/.-]{1,64}$/),
});

export const sortOptions = ["recent", "title", "score", "year"] as const;
export type LibrarySort = (typeof sortOptions)[number];

/** How many entries one section of the library shows on a page. */
export const pageSize = 12;

/** The sections of the library page, in the order they are shown. */
export const sectionOrder = [
  "in_progress",
  "planned",
  "paused",
  "dropped",
  "completed",
] as const satisfies readonly LibraryStatus[];

export const libraryTypes = [
  "anime",
  "movie",
  "series",
  "book",
  "manga",
] as const;
export type LibraryType = (typeof libraryTypes)[number];

export const libraryViews = ["covers", "titles", "grid"] as const;
export type LibraryView = (typeof libraryViews)[number];

/** The longest text the search box accepts. */
export const searchMaxLength = 100;

const pageParam = z
  .string()
  .regex(/^\d{1,4}$/)
  .transform(Number)
  .pipe(z.number().int().min(1))
  .catch(1);

/**
 * The filters of the library page, read from the address. A value that is not valid is ignored.
 * Each section has its own page: `?completed_page=2`.
 */
export const libraryQuerySchema = z
  .object({
    type: z.enum(libraryTypes).optional().catch(undefined),
    q: z
      .string()
      .transform((value) => value.trim().slice(0, searchMaxLength))
      .transform((value) => (value === "" ? undefined : value))
      .optional()
      .catch(undefined),
    view: z.enum(libraryViews).optional().catch(undefined),
    visibility: z.enum(visibilityLevels).optional().catch(undefined),
    in_progress_page: pageParam,
    planned_page: pageParam,
    paused_page: pageParam,
    dropped_page: pageParam,
    completed_page: pageParam,
    year: z
      .string()
      .regex(/^\d{4}$/)
      .transform(Number)
      .optional()
      .catch(undefined),
    // A minimum from 1 to 10, or `none`: the entries that were never scored.
    score: z
      .union([
        z.literal("none"),
        z
          .string()
          .regex(/^(?:10|[1-9])$/)
          .transform(Number),
      ])
      .optional()
      .catch(undefined),
    sort: z.enum(sortOptions).catch("recent"),
  })
  .transform(
    ({
      in_progress_page,
      planned_page,
      paused_page,
      dropped_page,
      completed_page,
      ...rest
    }) => ({
      ...rest,
      pages: {
        in_progress: in_progress_page,
        planned: planned_page,
        paused: paused_page,
        dropped: dropped_page,
        completed: completed_page,
      } satisfies Record<LibraryStatus, number>,
    }),
  );

export type LibraryQuery = z.output<typeof libraryQuerySchema>;

/** The way the library is drawn is kept in a cookie, so it works without JavaScript. */
export const libraryViewCookie = "libraryView";
export const defaultLibraryView: LibraryView = "covers";
