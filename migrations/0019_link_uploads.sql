-- Uploaded files used as link targets (currently PDFs stored in R2).
CREATE TABLE IF NOT EXISTS link_uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_link_uploads_user ON link_uploads(user_id);
