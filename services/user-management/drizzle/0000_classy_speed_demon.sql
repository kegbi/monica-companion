CREATE TABLE "setup_token_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid NOT NULL,
	"event" text NOT NULL,
	"actor_service" text NOT NULL,
	"ip_address" text,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setup_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" text NOT NULL,
	"step" text DEFAULT 'onboarding' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "setup_token_audit_log" ADD CONSTRAINT "setup_token_audit_log_token_id_setup_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."setup_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_log_token_id" ON "setup_token_audit_log" USING btree ("token_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_setup_tokens_active_user" ON "setup_tokens" USING btree ("telegram_user_id") WHERE status = 'active';