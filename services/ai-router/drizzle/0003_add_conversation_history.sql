CREATE TABLE "conversation_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_tool_call" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_conversation_history_user_id" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE INDEX "idx_conversation_history_updated_at" ON "conversation_history" USING btree ("updated_at");
