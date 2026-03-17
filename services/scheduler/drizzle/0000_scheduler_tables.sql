-- Idempotency keys table (owned by scheduler in V1; see packages/idempotency/src/schema.ts)
CREATE TABLE IF NOT EXISTS idempotency_keys (
	key TEXT PRIMARY KEY,
	status TEXT NOT NULL DEFAULT 'in_progress',
	claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	completed_at TIMESTAMPTZ,
	result JSONB,
	expires_at TIMESTAMPTZ NOT NULL
);

-- Command executions table
CREATE TABLE IF NOT EXISTS command_executions (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	pending_command_id UUID NOT NULL,
	idempotency_key TEXT UNIQUE NOT NULL,
	user_id UUID NOT NULL,
	command_type TEXT NOT NULL,
	payload JSONB NOT NULL,
	status TEXT NOT NULL DEFAULT 'queued',
	correlation_id TEXT NOT NULL,
	attempt_count INTEGER NOT NULL DEFAULT 0,
	last_error TEXT,
	queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	started_at TIMESTAMPTZ,
	completed_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reminder windows table
CREATE TABLE IF NOT EXISTS reminder_windows (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL,
	dedupe_key TEXT NOT NULL,
	cadence TEXT NOT NULL,
	scheduled_at TIMESTAMPTZ NOT NULL,
	fired_at TIMESTAMPTZ,
	status TEXT NOT NULL DEFAULT 'pending',
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_windows_dedupe_key
ON reminder_windows (dedupe_key);
