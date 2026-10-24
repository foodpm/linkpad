-- migration11: 索引优化 —— D1 按 Rows Read（扫描行数）计费，高频查询必须命中索引避免全表扫描
-- 参考: https://catcat.blog/2026/08/ai-goal-mode-cloudflare-d1-overage
-- 每次打开新标签页都会调用 /api/tools /api/categories，weread_notes 单用户可达上万行

-- 用户维度的热表（每次开页必查）
CREATE INDEX IF NOT EXISTS idx_user_tools_user ON user_tools(user_id);
CREATE INDEX IF NOT EXISTS idx_user_categories_user ON user_categories(user_id);
CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_repositories_user ON repositories(user_id);

-- 仓库维度（详情页 / 关注 / 收藏的 COUNT 与列表）
CREATE INDEX IF NOT EXISTS idx_repo_links_repo ON repo_links(repo_id, category_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_repo_categories_repo ON repo_categories(repo_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_repo_follows_repo ON repo_follows(repo_id);
CREATE INDEX IF NOT EXISTS idx_repo_bookmarks_repo ON repo_bookmarks(repo_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

-- 微信读书笔记（单用户上万行：随机抽取 / 分页排序 / 按书过滤）
CREATE INDEX IF NOT EXISTS idx_weread_notes_user_time ON weread_notes(user_id, create_time);
CREATE INDEX IF NOT EXISTS idx_weread_notes_user_book ON weread_notes(user_id, book_id);
