CREATE TABLE "analytics_daily" (
	"day" date NOT NULL,
	"dimension" text NOT NULL,
	"value" text NOT NULL,
	"events" integer NOT NULL,
	"visitors" integer NOT NULL,
	"engaged_ms" bigint NOT NULL,
	CONSTRAINT "analytics_daily_day_dimension_value_pk" PRIMARY KEY("day","dimension","value"),
	CONSTRAINT "analytics_daily_dimension_check" CHECK ("analytics_daily"."dimension" in ('kind', 'page', 'referrer_class', 'referrer_host', 'utm_source', 'utm_medium', 'utm_campaign', 'country', 'region', 'device', 'search_type')),
	CONSTRAINT "analytics_daily_value_check" CHECK (char_length("analytics_daily"."value") <= 200),
	CONSTRAINT "analytics_daily_counts_check" CHECK ("analytics_daily"."events" >= 0 and "analytics_daily"."visitors" >= 0 and "analytics_daily"."engaged_ms" >= 0)
);
