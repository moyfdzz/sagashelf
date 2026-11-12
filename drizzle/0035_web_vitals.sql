CREATE TABLE "analytics_vitals_daily" (
	"day" date NOT NULL,
	"page" text NOT NULL,
	"metric" text NOT NULL,
	"samples" integer NOT NULL,
	"p75" double precision NOT NULL,
	"good" integer NOT NULL,
	"needs_improvement" integer NOT NULL,
	"poor" integer NOT NULL,
	CONSTRAINT "analytics_vitals_daily_day_page_metric_pk" PRIMARY KEY("day","page","metric"),
	CONSTRAINT "analytics_vitals_daily_metric_check" CHECK ("analytics_vitals_daily"."metric" in ('LCP', 'CLS', 'INP')),
	CONSTRAINT "analytics_vitals_daily_page_check" CHECK (char_length("analytics_vitals_daily"."page") between 1 and 200),
	CONSTRAINT "analytics_vitals_daily_counts_check" CHECK ("analytics_vitals_daily"."samples" > 0 and "analytics_vitals_daily"."good" >= 0 and "analytics_vitals_daily"."needs_improvement" >= 0 and "analytics_vitals_daily"."poor" >= 0 and "analytics_vitals_daily"."good" + "analytics_vitals_daily"."needs_improvement" + "analytics_vitals_daily"."poor" = "analytics_vitals_daily"."samples" and "analytics_vitals_daily"."p75" >= 0)
);
--> statement-breakpoint
ALTER TABLE "analytics_events" DROP CONSTRAINT "analytics_events_kind_check";--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "lcp_ms" double precision;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "cls" double precision;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "inp_ms" double precision;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_vitals_check" CHECK (("analytics_events"."kind" = 'vitals') = ("analytics_events"."lcp_ms" is not null or "analytics_events"."cls" is not null or "analytics_events"."inp_ms" is not null) and ("analytics_events"."lcp_ms" is null or "analytics_events"."lcp_ms" between 0 and 60000) and ("analytics_events"."inp_ms" is null or "analytics_events"."inp_ms" between 0 and 60000) and ("analytics_events"."cls" is null or "analytics_events"."cls" between 0 and 100));--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_kind_check" CHECK ("analytics_events"."kind" in ('pageview', 'engaged', 'search', 'signup', 'add_to_library', 'follow', 'vitals'));