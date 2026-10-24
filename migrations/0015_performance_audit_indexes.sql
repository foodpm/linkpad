-- migration15: 性能审计补充索引（2026-10-15）
-- 复合索引列顺序：等值列在前、范围/排序列在后

-- 1) sitemap: WHERE visibility='public' ORDER BY updated_at DESC
CREATE INDEX IF NOT EXISTS idx_repositories_public_updated ON repositories(visibility, updated_at);

-- 2) admin 列表 keyset 分页: ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_repositories_created ON repositories(created_at);

-- 3) notifications 每日清理: WHERE created_at < ? AND is_read = 1
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
