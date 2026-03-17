CREATE TABLE "delivery_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"correlation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"connector_type" text NOT NULL,
	"connector_routing_id" text NOT NULL,
	"content_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "idx_delivery_audits_user_created" ON "delivery_audits" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_delivery_audits_correlation" ON "delivery_audits" USING btree ("correlation_id");