-- migration13: 链接失效自动检测
-- link_status: '' 未检测 / 'ok' 正常 / 'dead' 失效 / 'warning' 存疑(登录墙/防盗链/反爬，不标死)

ALTER TABLE repo_links ADD COLUMN link_status TEXT DEFAULT '';
ALTER TABLE repo_links ADD COLUMN last_checked_at INTEGER DEFAULT 0;
ALTER TABLE repo_links ADD COLUMN fail_count INTEGER DEFAULT 0;
ALTER TABLE repo_links ADD COLUMN last_http_status INTEGER DEFAULT 0;

ALTER TABLE user_tools ADD COLUMN link_status TEXT DEFAULT '';
ALTER TABLE user_tools ADD COLUMN last_checked_at INTEGER DEFAULT 0;
ALTER TABLE user_tools ADD COLUMN fail_count INTEGER DEFAULT 0;
ALTER TABLE user_tools ADD COLUMN last_http_status INTEGER DEFAULT 0;

-- cron 游标查询必须走索引，避免全表扫描
CREATE INDEX IF NOT EXISTS idx_repo_links_check ON repo_links(last_checked_at);
CREATE INDEX IF NOT EXISTS idx_user_tools_check ON user_tools(last_checked_at);
