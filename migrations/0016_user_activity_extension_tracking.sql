-- migration16: 用户活跃时间 + 浏览器扩展安装/使用追踪
ALTER TABLE users ADD COLUMN first_active_at TEXT;
ALTER TABLE users ADD COLUMN last_active_at TEXT;

-- 历史用户无法还原真实首次登录，先用注册时间作为近似值。
UPDATE users
SET first_active_at = created_at,
    last_active_at = created_at
WHERE first_active_at IS NULL;

CREATE TABLE IF NOT EXISTS extension_installs (
  install_id TEXT PRIMARY KEY,
  version TEXT DEFAULT '',
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_event TEXT DEFAULT '',
  use_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS extension_user_installs (
  user_id TEXT NOT NULL,
  install_id TEXT NOT NULL,
  first_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, install_id)
);

CREATE INDEX IF NOT EXISTS idx_extension_user_installs_user ON extension_user_installs(user_id, last_used_at);
