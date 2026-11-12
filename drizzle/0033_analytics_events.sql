CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"path" text NOT NULL,
	"visitor" text NOT NULL,
	"engaged_ms" integer,
	"search_type" text,
	"referrer_class" text,
	"referrer_host" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"country" text,
	"region" text,
	"device" text,
	CONSTRAINT "analytics_events_kind_check" CHECK ("analytics_events"."kind" in ('pageview', 'engaged', 'search', 'signup', 'add_to_library', 'follow')),
	CONSTRAINT "analytics_events_path_check" CHECK (char_length("analytics_events"."path") between 1 and 200 and left("analytics_events"."path", 1) = '/'),
	CONSTRAINT "analytics_events_visitor_check" CHECK ("analytics_events"."visitor" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "analytics_events_engaged_check" CHECK (("analytics_events"."kind" = 'engaged') = ("analytics_events"."engaged_ms" is not null) and ("analytics_events"."engaged_ms" is null or "analytics_events"."engaged_ms" between 0 and 14400000)),
	CONSTRAINT "analytics_events_search_check" CHECK (("analytics_events"."kind" = 'search') = ("analytics_events"."search_type" is not null)),
	CONSTRAINT "analytics_events_referrer_class_check" CHECK ("analytics_events"."referrer_class" is null or "analytics_events"."referrer_class" in ('direct', 'search', 'social', 'internal', 'other')),
	CONSTRAINT "analytics_events_device_check" CHECK ("analytics_events"."device" is null or "analytics_events"."device" in ('mobile', 'desktop')),
	CONSTRAINT "analytics_events_country_check" CHECK ("analytics_events"."country" is null or "analytics_events"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "analytics_events_text_length_check" CHECK (char_length("analytics_events"."referrer_host") <= 100 and char_length("analytics_events"."utm_source") <= 100 and char_length("analytics_events"."utm_medium") <= 100 and char_length("analytics_events"."utm_campaign") <= 100 and char_length("analytics_events"."region") <= 100 and char_length("analytics_events"."search_type") <= 20)
);
--> statement-breakpoint
CREATE TABLE "analytics_salts" (
	"day" date PRIMARY KEY NOT NULL,
	"salt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "analytics_events_occurred_idx" ON "analytics_events" USING btree ("occurred_at");