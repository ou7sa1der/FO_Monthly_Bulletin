CREATE TABLE IF NOT EXISTS slack_periods (
  period_key TEXT PRIMARY KEY,
  successful_sends INTEGER NOT NULL DEFAULT 0 CHECK (successful_sends BETWEEN 0 AND 3),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS slack_deliveries (
  id TEXT PRIMARY KEY,
  period_key TEXT NOT NULL,
  period_label TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_id TEXT NOT NULL,
  message_ts TEXT,
  channel_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (period_key) REFERENCES slack_periods(period_key)
);

CREATE INDEX IF NOT EXISTS idx_slack_deliveries_period_created
  ON slack_deliveries (period_key, created_at DESC);
