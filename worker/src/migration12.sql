-- migration12: 用户自定义壁纸（图片存 R2，元数据存 D1，按 user_id 隔离，仅本人可见可用）
CREATE TABLE IF NOT EXISTS user_wallpapers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_wallpapers_user ON user_wallpapers(user_id);
