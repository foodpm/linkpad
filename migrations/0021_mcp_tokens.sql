-- MCP 接入令牌：个人中心创建，供 Claude Desktop / Cursor 等 MCP 客户端以 Bearer 令牌调用 /api/mcp
-- 仅存 SHA-256 哈希，明文令牌只在创建响应中返回一次
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_preview TEXT NOT NULL DEFAULT '',
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_tokens(user_id);
