-- Aggregated signed-in user activity for UV/PV reporting.
-- Dates use UTC+8 so "today" matches the product's primary audience.
CREATE TABLE IF NOT EXISTS user_daily_activity (
  user_id TEXT NOT NULL,
  activity_date TEXT NOT NULL,
  pv INTEGER NOT NULL DEFAULT 0,
  page_views INTEGER NOT NULL DEFAULT 0,
  scrolls INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  searches INTEGER NOT NULL DEFAULT 0,
  auths INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, activity_date)
);

CREATE INDEX IF NOT EXISTS idx_user_daily_activity_date ON user_daily_activity(activity_date);
