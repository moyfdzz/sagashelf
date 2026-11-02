ALTER TABLE "outbox" ADD COLUMN "endpoint_id" uuid;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_delivery_due_idx" ON "outbox" USING btree ("next_attempt_at") WHERE "outbox"."status" = 'pending' and "outbox"."endpoint_id" is not null;--> statement-breakpoint
CREATE INDEX "outbox_endpoint_idx" ON "outbox" USING btree ("endpoint_id");--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_user_url_unique" UNIQUE("user_id","url");--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_disabled_check" CHECK ("webhook_endpoints"."enabled" or "webhook_endpoints"."disabled_at" is not null);--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_disabled_reason_check" CHECK ("webhook_endpoints"."disabled_reason" is null or "webhook_endpoints"."disabled_reason" in ('unauthorized', 'not_found', 'too_many_failures'));