-- 微信读书笔记小组件
CREATE TABLE IF NOT EXISTS weread_settings (
  user_id TEXT PRIMARY KEY,
  api_key_enc TEXT NOT NULL,
  last_synced_at INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS weread_books (
  user_id TEXT, book_id TEXT, title TEXT, author TEXT, cover TEXT,
  note_count INTEGER DEFAULT 0, review_count INTEGER DEFAULT 0,
  last_note_sort INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, book_id)
);
CREATE TABLE IF NOT EXISTS weread_notes (
  id TEXT, user_id TEXT, book_id TEXT,
  type TEXT,
  content TEXT,
  abstract TEXT,
  chapter TEXT, create_time INTEGER,
  PRIMARY KEY (user_id, id)
);
