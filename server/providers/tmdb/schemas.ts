import { z } from "zod";

import type { TmdbSeasonDetail, TmdbTitle } from "./map";

/**
 * What is read from a TMDB answer, checked before it is used (SAG-185). Only the fields without
 * which the answer is useless are required: an answer with no `id` would become `movie/undefined`.
 * The rest stays as optional as `TmdbTitle` already says.
 */
const id = z.number().int().positive();

/** Says the answer is a `T`: the schema checks the required fields, the type lists the rest. */
const typed = <T>(schema: z.ZodType): z.ZodType<T> =>
  schema as unknown as z.ZodType<T>;

export const titleAnswer = typed<TmdbTitle>(z.looseObject({ id }));

export const resultsAnswer = typed<{ results?: TmdbTitle[] }>(
  z.looseObject({ results: z.array(z.looseObject({ id })).optional() }),
);

export const showSeasonsAnswer = typed<{ seasons?: TmdbSeasonDetail[] }>(
  z.looseObject({
    seasons: z
      .array(z.looseObject({ season_number: z.number().int() }))
      .optional(),
  }),
);

export const seasonDetailsAnswer = typed<Record<string, TmdbSeasonDetail>>(
  z.record(z.string(), z.unknown()),
);
