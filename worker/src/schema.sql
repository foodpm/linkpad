-- Categories (seed data)
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  parent_id TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);

-- Tools (seed data)
CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  desc TEXT NOT NULL,
  category_id TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  icon TEXT DEFAULT '',
  bg_color TEXT DEFAULT '',
  text_color TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- Tool bookmarks (legacy)
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tool_id) REFERENCES tools(id),
  UNIQUE(tool_id)
);

-- Discover columns (seed data)
CREATE TABLE IF NOT EXISTS discover_columns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  desc TEXT NOT NULL,
  icon TEXT NOT NULL
);

-- ========== NEW TABLES ==========

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  avatar_url TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Repositories
CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '',
  icon_key TEXT DEFAULT '',
  bg_color TEXT DEFAULT '#3B82F6',
  text_color TEXT DEFAULT '#FFFFFF',
  description TEXT DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'private',
  password TEXT DEFAULT '',
  link_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Repository categories (replaces tags)
CREATE TABLE IF NOT EXISTS repo_categories (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (repo_id) REFERENCES repositories(id)
);

-- Repository links
CREATE TABLE IF NOT EXISTS repo_links (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  category_id TEXT DEFAULT '',
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  icon TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (repo_id) REFERENCES repositories(id)
);

-- Repository members
CREATE TABLE IF NOT EXISTS repo_members (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (repo_id) REFERENCES repositories(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(repo_id, user_id)
);

-- User follows
CREATE TABLE IF NOT EXISTS follows (
  id TEXT PRIMARY KEY,
  follower_id TEXT NOT NULL,
  following_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (follower_id) REFERENCES users(id),
  FOREIGN KEY (following_id) REFERENCES users(id),
  UNIQUE(follower_id, following_id)
);

-- Repository follows (watch)
CREATE TABLE IF NOT EXISTS repo_follows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  target_category_id TEXT DEFAULT '',
  skip_link_ids TEXT NOT NULL DEFAULT '[]',
  exclude_duplicates INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  last_viewed_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (repo_id) REFERENCES repositories(id),
  UNIQUE(user_id, repo_id)
);

-- Password reset codes
CREATE TABLE IF NOT EXISTS password_reset_codes (
  email TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  repo_id TEXT DEFAULT '',
  message TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

-- Repository bookmarks
CREATE TABLE IF NOT EXISTS repo_bookmarks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (repo_id) REFERENCES repositories(id),
  UNIQUE(user_id, repo_id)
);

-- User personalization: hidden global defaults
CREATE TABLE IF NOT EXISTS user_hidden_categories (
  user_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, category_id)
);

CREATE TABLE IF NOT EXISTS user_hidden_tools (
  user_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, tool_id)
);

-- User personalization: custom categories & tools
CREATE TABLE IF NOT EXISTS user_categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '',
  parent_id TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_tools (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category_id TEXT DEFAULT '',
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  desc TEXT DEFAULT '',
  icon TEXT DEFAULT '',
  bg_color TEXT DEFAULT '',
  text_color TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Todos
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  is_completed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Seed data (existing)
INSERT OR IGNORE INTO categories (id, name, icon) VALUES
  ('search', '搜索引擎', 'Search'),
  ('ai', 'AI 工具', 'Cpu'),
  ('dev', '开发助手', 'Code'),
  ('design', '设计资源', 'PenTool'),
  ('work', '办公效率', 'Briefcase'),
  ('learn', '学习充电', 'BookOpen'),
  ('relax', '休闲娱乐', 'Coffee');

INSERT OR IGNORE INTO discover_columns (id, name, desc, icon) VALUES
  ('trending', '热门推荐', '大家都在用的热门工具', 'Flame'),
  ('newest', '最近更新', '新收录的工具和资源', 'Sparkles'),
  ('picked', '精选合集', '编辑精选的实用工具集', 'TrendingUp');

INSERT OR IGNORE INTO tools (id, name, url, desc, category_id) VALUES
  ('google', 'Google', 'https://google.com', '全球最大的搜索引擎', 'search'),
  ('bing', 'Bing', 'https://bing.com', '微软提供的搜索引擎', 'search'),
  ('baidu', '百度', 'https://baidu.com', '最大的中文搜索引擎', 'search'),
  ('duckduckgo', 'DuckDuckGo', 'https://duckduckgo.com', '保护隐私的搜索引擎', 'search'),
  ('chatgpt', 'ChatGPT', 'https://chat.openai.com', 'OpenAI 强大的 AI 对话模型', 'ai'),
  ('claude', 'Claude', 'https://claude.ai', 'Anthropic 的智能 AI 助手', 'ai'),
  ('gemini', 'Gemini', 'https://gemini.google.com', 'Google 的下一代多模态 AI 模型', 'ai'),
  ('midjourney', 'Midjourney', 'https://www.midjourney.com', '高质量 AI 图像生成工具', 'ai'),
  ('github', 'GitHub', 'https://github.com', '全球最大的代码托管平台', 'dev'),
  ('stackoverflow', 'Stack Overflow', 'https://stackoverflow.com', '开发者问答社区', 'dev'),
  ('vercel', 'Vercel', 'https://vercel.com', '现代 Web 应用部署平台', 'dev'),
  ('mdn', 'MDN Web Docs', 'https://developer.mozilla.org', '权威的 Web 开发文档', 'dev'),
  ('figma', 'Figma', 'https://figma.com', '协作式界面设计工具', 'design'),
  ('dribbble', 'Dribbble', 'https://dribbble.com', '全球顶尖设计作品展示平台', 'design'),
  ('pexels', 'Pexels', 'https://pexels.com', '免费高清无版权图片库', 'design'),
  ('iconfont', 'Iconfont', 'https://www.iconfont.cn', '阿里巴巴矢量图标库', 'design'),
  ('notion', 'Notion', 'https://notion.so', '多合一的知识管理与协作工作区', 'work'),
  ('feishu', '飞书', 'https://feishu.cn', '先进的企业协同办公平台', 'work'),
  ('processon', 'ProcessOn', 'https://processon.com', '免费在线作图工具', 'work'),
  ('coursera', 'Coursera', 'https://coursera.org', '提供顶尖大学课程的在线学习平台', 'learn'),
  ('bilibili_learn', 'Bilibili', 'https://bilibili.com', '除了娱乐，也是最大的学习视频网站', 'learn'),
  ('duolingo', '多邻国', 'https://www.duolingo.cn', '免费有趣的语言学习应用', 'learn'),
  ('youtube', 'YouTube', 'https://youtube.com', '全球最大的视频分享平台', 'relax'),
  ('spotify', 'Spotify', 'https://spotify.com', '流行的正版流媒体音乐服务平台', 'relax'),
  ('douban', '豆瓣', 'https://douban.com', '书籍、电影、音乐发现与评价社区', 'relax');
