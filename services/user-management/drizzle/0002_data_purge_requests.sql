CREATE TABLE "data_purge_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "status" text NOT NULL DEFAULT 'pending',
  "reason" text NOT NULL,
  "requested_at" timestamptz NOT NULL DEFAULT NOW(),
  "purge_after" timestamptz NOT NULL,
  "claimed_at" timestamptz,
  "completed_at" timestamptz,
  "retry_count" integer NOT NULL DEFAULT 0,
  "error" text
);

CREATE INDEX "idx_data_purge_requests_status" ON "data_purge_requests" ("status", "purge_after");
CREATE INDEX "idx_data_purge_requests_user_id" ON "data_purge_requests" ("user_id");
