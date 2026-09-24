CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  widgets TEXT DEFAULT '[]',
  item_order TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);
