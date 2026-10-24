-- Migration 8
-- 1) 关注仓库：持久化"排除重复链接"偏好
ALTER TABLE repo_follows ADD COLUMN skip_link_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE repo_follows ADD COLUMN exclude_duplicates INTEGER NOT NULL DEFAULT 0;

-- 2) 密码重置验证码
CREATE TABLE IF NOT EXISTS password_reset_codes (
  email TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
