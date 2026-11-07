CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"reply_email" text,
	"status" text DEFAULT 'new' NOT NULL,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_messages_kind_check" CHECK ("contact_messages"."kind" in ('feedback', 'problem', 'help')),
	CONSTRAINT "contact_messages_body_length_check" CHECK (char_length("contact_messages"."body") between 1 and 2000),
	CONSTRAINT "contact_messages_reply_email_length_check" CHECK (char_length("contact_messages"."reply_email") <= 254),
	CONSTRAINT "contact_messages_reply_visitor_check" CHECK ("contact_messages"."user_id" is null or "contact_messages"."reply_email" is null),
	CONSTRAINT "contact_messages_status_check" CHECK ("contact_messages"."status" in ('new', 'handled')),
	CONSTRAINT "contact_messages_handled_check" CHECK (("contact_messages"."status" = 'handled') = ("contact_messages"."handled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_messages_created_idx" ON "contact_messages" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "contact_messages_user_created_idx" ON "contact_messages" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE "contact_messages"."user_id" is not null;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('episode.aired', 'report.created', 'moderation.warning', 'contact.created'));