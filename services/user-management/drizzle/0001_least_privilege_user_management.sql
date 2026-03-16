CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" text NOT NULL,
	"monica_base_url" text NOT NULL,
	"monica_api_token_encrypted" text NOT NULL,
	"encryption_key_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_user_id_unique" UNIQUE("telegram_user_id")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"confirmation_mode" text DEFAULT 'explicit' NOT NULL,
	"timezone" text NOT NULL,
	"reminder_cadence" text DEFAULT 'daily' NOT NULL,
	"reminder_time" text DEFAULT '08:00' NOT NULL,
	"connector_type" text DEFAULT 'telegram' NOT NULL,
	"connector_routing_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "credential_access_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_service" text NOT NULL,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credential_access_audit_log" ADD CONSTRAINT "credential_access_audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_credential_audit_user_id" ON "credential_access_audit_log" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_credential_audit_created_at" ON "credential_access_audit_log" USING btree ("created_at");
