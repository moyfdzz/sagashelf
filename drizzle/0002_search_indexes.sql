-- Fuzzy title search: typos and missing accents ("pokemn" finds "Pokémon").
-- The expression must match the one used in queries: lowercase, then without accents.
CREATE INDEX "media_items_title_trgm_idx" ON "media_items" USING gin (immutable_unaccent(lower("title")) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "media_items_original_title_trgm_idx" ON "media_items" USING gin (immutable_unaccent(lower("original_title")) gin_trgm_ops);
