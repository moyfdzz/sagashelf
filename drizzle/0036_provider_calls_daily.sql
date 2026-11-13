CREATE TABLE "provider_calls_daily" (
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"outcome" text NOT NULL,
	"calls" integer NOT NULL,
	"requests" integer NOT NULL,
	"latency_ms" bigint NOT NULL,
	CONSTRAINT "provider_calls_daily_day_provider_outcome_pk" PRIMARY KEY("day","provider","outcome"),
	CONSTRAINT "provider_calls_daily_outcome_check" CHECK ("provider_calls_daily"."outcome" in ('ok', 'http_4xx', 'http_429', 'http_5xx', 'http_other', 'timeout', 'network', 'invalid', 'rate_limited', 'circuit_open', 'cancelled')),
	CONSTRAINT "provider_calls_daily_provider_check" CHECK ("provider_calls_daily"."provider" ~ '^[a-z][a-z0-9_-]{1,29}$'),
	CONSTRAINT "provider_calls_daily_counts_check" CHECK ("provider_calls_daily"."calls" >= 0 and "provider_calls_daily"."requests" >= 0 and "provider_calls_daily"."latency_ms" >= 0)
);
