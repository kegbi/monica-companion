CREATE TABLE "conversation_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"summary" text NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_message_ref" text NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"execution_result" jsonb
);
--> statement-breakpoint
CREATE INDEX "idx_conversation_turns_user_created" ON "conversation_turns" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_conversation_turns_created_at" ON "conversation_turns" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_pending_commands_user_status" ON "pending_commands" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_pending_commands_expires_at" ON "pending_commands" USING btree ("expires_at");