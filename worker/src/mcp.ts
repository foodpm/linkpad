// LinkPad MCP 接入：Streamable HTTP（JSON 响应模式）端点 + 接入令牌管理
// - POST /api/mcp            JSON-RPC 2.0 协议端点（initialize / tools/list / tools/call）
// - GET  /api/mcp/tokens     当前用户令牌列表（JWT 鉴权）
// - POST /api/mcp/tokens     创建令牌（明文仅返回一次）
// - DELETE /api/mcp/tokens/:id
// 协议端点鉴权：Authorization: Bearer linkpad_<token>，仅存 SHA-256 哈希
import { Hono } from 'hono'
import { T } from './i18n'
import { bytesToB64url, isSafeHttpUrl, replaceRepoCategoryAssignments, syncLinkToFollowers, stripRepoPassword, verifyJWT } from './index'

type Bindings = {
  DB: D1Database
  R2: R2Bucket
  ASSETS: Fetcher
  JWT_SECRET: string
  ADMIN_EMAIL: string
}

type McpUser = { id: string; email: string; nickname: string; avatar_url: string }

type TokenRow = {
  id: string
  user_id: string
  name: string
  token_hash: string
  token_preview: string
}

type JsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: any
}

const mcpApp = new Hono<{ Bindings: Bindings }>()

const TOKEN_PREFIX = 'linkpad_'
const MCP_PROTOCOL_VERSION = '2025-06-18'

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ==================== 令牌鉴权 ====================

async function getMcpUser(c: any, tokenRow?: TokenRow | null): Promise<{ user: McpUser | null; token: TokenRow | null }> {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) return { user: null, token: null }
  const token = auth.slice(7).trim()
  if (!token.startsWith(TOKEN_PREFIX)) return { user: null, token: null }
  const hash = await sha256Hex(token)
  const row = await c.env.DB.prepare(
    'SELECT t.id, t.user_id, t.name, t.token_hash, t.token_preview, u.id, u.email, u.nickname, u.avatar_url, u.status FROM mcp_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?'
  ).bind(hash).first() as any
  if (!row || row.status === 'disabled') return { user: null, token: null }
  return {
    user: { id: row.id, email: row.email, nickname: row.nickname, avatar_url: row.avatar_url } as McpUser,
    token: { id: row.id, user_id: row.user_id, name: row.name, token_hash: row.token_hash, token_preview: row.token_preview } as TokenRow,
  }
}

// 记录令牌使用（失败不影响主流程）
async function touchToken(c: any, tokenId: string) {
  try {
    await c.env.DB.prepare(
      "UPDATE mcp_tokens SET use_count = use_count + 1, last_used_at = datetime('now') WHERE id = ?"
    ).bind(tokenId).run()
  } catch (e) {
    console.error('mcp touchToken failed:', e)
  }
}

// 与 canManageRepo 同语义：创建者或仓库成员
async function canManageRepo(db: D1Database, userId: string, repoId: string): Promise<boolean> {
  const repo = await db.prepare('SELECT user_id FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (!repo) return false
  if (repo.user_id === userId) return true
  const member = await db.prepare('SELECT id FROM repo_members WHERE repo_id = ? AND user_id = ?').bind(repoId, userId).first()
  return !!member
}

// ==================== MCP 工具定义 ====================

const TOOL_DEFS: any[] = [
  {
    name: 'list_homepage',
    description: '查询我的 LinkPad 首页数据：首页分类与链接 / Query my LinkPad homepage: categories and links',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_repos',
    description: '查询我创建或管理的仓库列表 / List repositories I created or manage',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_repo',
    description: '查询仓库数据（详情、分类、成员、统计） / Get repository details: categories, members and stats',
    inputSchema: {
      type: 'object',
      properties: { repo_id: { type: 'string', description: '仓库 ID / Repository ID' } },
      required: ['repo_id'],
    },
  },
  {
    name: 'list_repo_categories',
    description: '查询仓库的分类数据 / List categories of a repository',
    inputSchema: {
      type: 'object',
      properties: { repo_id: { type: 'string', description: '仓库 ID / Repository ID' } },
      required: ['repo_id'],
    },
  },
  {
    name: 'list_repo_links',
    description: '查询仓库的链接数据，可按分类过滤 / List links of a repository, optionally filtered by category',
    inputSchema: {
      type: 'object',
      properties: {
        repo_id: { type: 'string', description: '仓库 ID / Repository ID' },
        category: { type: 'string', description: '分类名称（可选） / Category name (optional)' },
      },
      required: ['repo_id'],
    },
  },
  {
    name: 'add_repo_link',
    description: '向仓库添加链接 / Add a link to a repository',
    inputSchema: {
      type: 'object',
      properties: {
        repo_id: { type: 'string', description: '仓库 ID / Repository ID' },
        name: { type: 'string', description: '链接名称 / Link name' },
        url: { type: 'string', description: '链接地址（http/https） / Link URL (http/https)' },
        category: { type: 'string', description: '分类名称（可选，须为仓库已有分类） / Category name (optional, must exist in the repo)' },
        desc: { type: 'string', description: '描述（可选） / Description (optional)' },
      },
      required: ['repo_id', 'name', 'url'],
    },
  },
  {
    name: 'update_repo_link',
    description: '编辑仓库链接（名称 / 地址 / 分类 / 描述） / Update a repository link (name / URL / category / description)',
    inputSchema: {
      type: 'object',
      properties: {
        link_id: { type: 'string', description: '链接 ID / Link ID' },
        name: { type: 'string', description: '链接名称 / Link name' },
        url: { type: 'string', description: '链接地址（http/https） / Link URL (http/https)' },
        category: { type: 'string', description: '分类名称（须为仓库已有分类） / Category name (must exist in the repo)' },
        desc: { type: 'string', description: '描述 / Description' },
      },
      required: ['link_id'],
    },
  },
  {
    name: 'create_repo_category',
    description: '在仓库中创建分类 / Create a category in a repository',
    inputSchema: {
      type: 'object',
      properties: {
        repo_id: { type: 'string', description: '仓库 ID / Repository ID' },
        name: { type: 'string', description: '分类名称 / Category name' },
      },
      required: ['repo_id', 'name'],
    },
  },
]

// ==================== 工具实现 ====================

async function toolListHomepage(c: any, user: McpUser) {
  const { results: categories } = await c.env.DB.prepare(
    'SELECT id, name, icon, parent_id, sort_order FROM user_categories WHERE user_id = ? ORDER BY sort_order, id'
  ).bind(user.id).all()
  const { results: links } = await c.env.DB.prepare(
    'SELECT id, category_id, name, url, desc, icon, sort_order FROM user_tools WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).bind(user.id).all()
  return { categories: categories || [], links: links || [] }
}

async function toolListRepos(c: any, user: McpUser) {
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.name, r.description, r.visibility, r.link_count, r.created_at, r.updated_at,
      (SELECT COUNT(*) FROM repo_follows WHERE repo_id = r.id) as follower_count,
      (SELECT COUNT(*) FROM repo_members WHERE repo_id = r.id AND user_id != r.user_id) as member_count,
      (r.user_id = ?1) as is_owner
    FROM repositories r
    WHERE r.user_id = ?1 OR EXISTS (SELECT 1 FROM repo_members m WHERE m.repo_id = r.id AND m.user_id = ?1)
    ORDER BY r.created_at DESC`
  ).bind(user.id).all()
  return { repos: results || [] }
}

async function toolGetRepo(c: any, user: McpUser, args: any) {
  const repoId = String(args?.repo_id ?? '')
  if (!(await canManageRepo(c.env.DB, user.id, repoId))) throw new McpToolError('无权访问该仓库 / No permission to access this repository')
  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (!repo) throw new McpToolError('仓库不存在 / Repository not found')
  const { results: categories } = await c.env.DB.prepare(
    'SELECT id, name, sort_order FROM repo_categories WHERE repo_id = ? ORDER BY sort_order ASC'
  ).bind(repoId).all()
  const { results: members } = await c.env.DB.prepare(
    'SELECT u.id, u.nickname, rm.role FROM repo_members rm JOIN users u ON u.id = rm.user_id WHERE rm.repo_id = ? ORDER BY rm.created_at ASC'
  ).bind(repoId).all()
  const followerCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM repo_follows WHERE repo_id = ?').bind(repoId).first() as any
  return {
    ...stripRepoPassword(repo),
    categories: categories || [],
    members: members || [],
    follower_count: followerCount?.count || 0,
  }
}

async function toolListRepoCategories(c: any, user: McpUser, args: any) {
  const repoId = String(args?.repo_id ?? '')
  if (!(await canManageRepo(c.env.DB, user.id, repoId))) throw new McpToolError('无权访问该仓库 / No permission to access this repository')
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, sort_order, (SELECT COUNT(*) FROM repo_links l WHERE l.repo_id = repo_categories.repo_id AND l.category_id = repo_categories.name) as link_count FROM repo_categories WHERE repo_id = ? ORDER BY sort_order ASC'
  ).bind(repoId).all()
  return { categories: results || [] }
}

async function toolListRepoLinks(c: any, user: McpUser, args: any) {
  const repoId = String(args?.repo_id ?? '')
  const category = args?.category !== undefined ? String(args.category) : ''
  if (!(await canManageRepo(c.env.DB, user.id, repoId))) throw new McpToolError('无权访问该仓库 / No permission to access this repository')
  const catMapStmt = await c.env.DB.prepare(
    'SELECT link_id, category_id FROM link_category_assignments WHERE link_id IN (SELECT id FROM repo_links WHERE repo_id = ?)'
  ).bind(repoId).all()
  const catMap: Record<string, string[]> = {}
  for (const r of (catMapStmt.results || []) as any[]) {
    (catMap[r.link_id] = catMap[r.link_id] || []).push(r.category_id)
  }
  let sql = 'SELECT id, category_id, name, url, desc, icon, sort_order, created_at FROM repo_links WHERE repo_id = ?'
  const params: string[] = [repoId]
  if (category) {
    sql += ' AND category_id = ?'
    params.push(category)
  }
  sql += ' ORDER BY sort_order ASC, created_at ASC'
  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return { links: (results || []).map((l: any) => ({ ...l, category_ids: catMap[l.id] || [l.category_id].filter(Boolean) })) }
}

async function toolAddRepoLink(c: any, user: McpUser, args: any) {
  const repoId = String(args?.repo_id ?? '')
  const name = String(args?.name ?? '').trim()
  const url = String(args?.url ?? '').trim()
  if (!(await canManageRepo(c.env.DB, user.id, repoId))) throw new McpToolError('无权操作该仓库 / No permission to manage this repository')
  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (!repo) throw new McpToolError('仓库不存在 / Repository not found')
  if (!name || !url) throw new McpToolError('名称和地址不能为空 / Name and URL are required')
  if (!isSafeHttpUrl(url)) throw new McpToolError('链接地址必须是 http(s) 网址 / URL must be an http(s) URL')

  // 分类：仓库分类以名称存储，仅接受仓库已有分类
  let selectedCats: string[] = []
  const categoryName = args?.category !== undefined ? String(args.category).trim() : ''
  if (categoryName) {
    const { results: repoCatRows } = await c.env.DB.prepare('SELECT name FROM repo_categories WHERE repo_id = ?').bind(repoId).all()
    const repoCatNames = (repoCatRows || []).map((r: any) => r.name)
    if (!repoCatNames.includes(categoryName)) throw new McpToolError(`分类「${categoryName}」不存在，请先创建 / Category "${categoryName}" not found — create it first`)
    selectedCats = [categoryName]
  }

  const linkId = crypto.randomUUID()
  const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as max FROM repo_links WHERE repo_id = ?').bind(repoId).first() as any
  await c.env.DB.prepare(
    'INSERT INTO repo_links (id, repo_id, category_id, name, url, icon, sort_order, desc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(linkId, repoId, selectedCats[0] || '', name, url, name.charAt(0).toUpperCase(), (maxOrder?.max ?? -1) + 1, String(args?.desc ?? '')).run()
  if (selectedCats.length > 0) await replaceRepoCategoryAssignments(c.env.DB, linkId, selectedCats)
  await c.env.DB.prepare(
    "UPDATE repositories SET link_count = (SELECT COUNT(*) FROM repo_links WHERE repo_id = ?), updated_at = datetime('now') WHERE id = ?"
  ).bind(repoId, repoId).run()

  const link = await c.env.DB.prepare('SELECT * FROM repo_links WHERE id = ?').bind(linkId).first()
  if (link) await syncLinkToFollowers(c.env.DB, repoId, link, 'add')
  return { success: true, link }
}

async function toolUpdateRepoLink(c: any, user: McpUser, args: any) {
  const linkId = String(args?.link_id ?? '')
  const link = await c.env.DB.prepare(
    'SELECT l.*, r.user_id FROM repo_links l JOIN repositories r ON r.id = l.repo_id WHERE l.id = ?'
  ).bind(linkId).first() as any
  if (!link) throw new McpToolError('链接不存在 / Link not found')
  if (!(await canManageRepo(c.env.DB, user.id, link.repo_id))) throw new McpToolError('无权操作该仓库 / No permission to manage this repository')

  const name = args?.name !== undefined ? String(args.name).trim() : undefined
  const url = args?.url !== undefined ? String(args.url).trim() : undefined
  if (url !== undefined && !isSafeHttpUrl(url)) throw new McpToolError('链接地址必须是 http(s) 网址 / URL must be an http(s) URL')
  if (name !== undefined) {
    if (!name) throw new McpToolError('名称不能为空 / Name cannot be empty')
    await c.env.DB.prepare('UPDATE repo_links SET name = ? WHERE id = ?').bind(name, linkId).run()
  }
  if (url !== undefined) {
    await c.env.DB.prepare("UPDATE repo_links SET url = ?, link_status = '', last_checked_at = 0, fail_count = 0, last_http_status = 0 WHERE id = ?").bind(url, linkId).run()
  }
  const categoryName = args?.category !== undefined ? String(args.category).trim() : undefined
  if (categoryName !== undefined) {
    if (categoryName) {
      const { results: repoCatRows } = await c.env.DB.prepare('SELECT name FROM repo_categories WHERE repo_id = ?').bind(link.repo_id).all()
      const repoCatNames = (repoCatRows || []).map((r: any) => r.name)
      if (!repoCatNames.includes(categoryName)) throw new McpToolError(`分类「${categoryName}」不存在，请先创建 / Category "${categoryName}" not found — create it first`)
      await c.env.DB.prepare('UPDATE repo_links SET category_id = ? WHERE id = ?').bind(categoryName, linkId).run()
      await replaceRepoCategoryAssignments(c.env.DB, linkId, [categoryName])
    } else {
      await c.env.DB.prepare("UPDATE repo_links SET category_id = '' WHERE id = ?").bind(linkId).run()
      await replaceRepoCategoryAssignments(c.env.DB, linkId, [])
    }
  }
  if (args?.desc !== undefined) await c.env.DB.prepare('UPDATE repo_links SET desc = ? WHERE id = ?').bind(String(args.desc), linkId).run()
  await c.env.DB.prepare("UPDATE repositories SET updated_at = datetime('now') WHERE id = ?").bind(link.repo_id).run()

  const updated = await c.env.DB.prepare('SELECT * FROM repo_links WHERE id = ?').bind(linkId).first()
  if (updated) await syncLinkToFollowers(c.env.DB, link.repo_id, updated, 'update')
  return { success: true, link: updated }
}

async function toolCreateRepoCategory(c: any, user: McpUser, args: any) {
  const repoId = String(args?.repo_id ?? '')
  const name = String(args?.name ?? '').trim()
  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (!repo) throw new McpToolError('仓库不存在 / Repository not found')
  if (repo.user_id !== user.id) throw new McpToolError('仅仓库创建者可创建分类 / Only the repository owner can create categories')
  if (!name) throw new McpToolError('分类名称不能为空 / Category name is required')
  const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as max FROM repo_categories WHERE repo_id = ?').bind(repoId).first() as any
  await c.env.DB.prepare('INSERT INTO repo_categories (id, repo_id, name, sort_order) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), repoId, name, (maxOrder?.max ?? -1) + 1).run()
  return { success: true }
}

class McpToolError extends Error {}

const TOOL_HANDLERS: Record<string, (c: any, user: McpUser, args: any) => Promise<any>> = {
  list_homepage: toolListHomepage,
  list_repos: toolListRepos,
  get_repo: toolGetRepo,
  list_repo_categories: toolListRepoCategories,
  list_repo_links: toolListRepoLinks,
  add_repo_link: toolAddRepoLink,
  update_repo_link: toolUpdateRepoLink,
  create_repo_category: toolCreateRepoCategory,
}

// ==================== JSON-RPC 端点 ====================

function jsonRpcResult(id: any, result: any) {
  return { jsonrpc: '2.0', id, result }
}

function jsonRpcError(id: any, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

mcpApp.post('/api/mcp', async (c) => {
  let body: JsonRpcRequest
  try {
    body = await c.req.json()
  } catch {
    return c.json(jsonRpcError(null, -32700, 'Parse error'), 400)
  }
  const method = body.method ?? ''

  // initialize 无需令牌：客户端连接探测阶段调用，不携带凭证也应能完成握手
  if (method === 'initialize') {
    const requested = body.params?.protocolVersion
    const version = typeof requested === 'string' && requested ? requested : MCP_PROTOCOL_VERSION
    return c.json(jsonRpcResult(body.id ?? null, {
      protocolVersion: version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'LinkPad', version: '1.0.0' },
    }))
  }
  // 已弃用的 initialize 前置握手（protocolVersion 2025-06-18 前）
  if (method === 'ping') {
    return c.json(jsonRpcResult(body.id ?? null, {}))
  }

  const { user, token } = await getMcpUser(c)
  if (!user) {
    return c.json(jsonRpcError(body.id ?? null, -32001, '无效令牌 / Invalid token'), 401)
  }

  // 客户端就绪通知：无响应体
  if (method.startsWith('notifications/')) {
    return new Response(null, { status: 202 })
  }

  if (method === 'tools/list') {
    return c.json(jsonRpcResult(body.id ?? null, { tools: TOOL_DEFS }))
  }

  if (method === 'tools/call') {
    const name = String(body.params?.name ?? '')
    const handler = TOOL_HANDLERS[name]
    if (!handler) {
      return c.json(jsonRpcError(body.id ?? null, -32602, `未知工具 / Unknown tool: ${name}`), 400)
    }
    await touchToken(c, token!.id)
    try {
      const result = await handler(c, user, body.params?.arguments ?? {})
      return c.json(jsonRpcResult(body.id ?? null, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: false,
      }))
    } catch (e: any) {
      if (e instanceof McpToolError) {
        return c.json(jsonRpcResult(body.id ?? null, {
          content: [{ type: 'text', text: e.message }],
          isError: true,
        }))
      }
      console.error('MCP tool error:', e)
      return c.json(jsonRpcError(body.id ?? null, -32603, '内部错误 / Internal error'), 500)
    }
  }

  return c.json(jsonRpcError(body.id ?? null, -32601, `未知方法 / Method not found: ${method}`), 404)
})

// Streamable HTTP 的 SSE 模式未实现：明确返回 405，客户端将使用上方 JSON 响应模式
mcpApp.get('/api/mcp', (c) => c.json({ error: 'Method Not Allowed' }, 405))
mcpApp.delete('/api/mcp', (c) => c.json({ error: 'Method Not Allowed' }, 405))

// ==================== 令牌管理（JWT 鉴权，个人中心使用） ====================

async function requireUser(c: any): Promise<McpUser | null> {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const payload = await verifyJWT(auth.slice(7), c.env.JWT_SECRET)
  if (!payload || !payload.sub) return null
  const user = await c.env.DB.prepare('SELECT id, email, nickname, avatar_url, status FROM users WHERE id = ?').bind(payload.sub).first() as any
  if (!user || user.status === 'disabled') return null
  return { id: user.id, email: user.email, nickname: user.nickname, avatar_url: user.avatar_url } as McpUser
}

mcpApp.get('/api/mcp/tokens', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, token_preview, use_count, last_used_at, created_at FROM mcp_tokens WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all()
  return c.json(results)
})

mcpApp.post('/api/mcp/tokens', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const { name } = await c.req.json().catch(() => ({}))
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return c.json({ error: T(c, '名称不能为空') }, 400)
  if (trimmed.length > 50) return c.json({ error: T(c, '名称过长') }, 400)

  const count = await c.env.DB.prepare('SELECT COUNT(*) as count FROM mcp_tokens WHERE user_id = ?').bind(user.id).first() as any
  if ((count?.count ?? 0) >= 20) return c.json({ error: T(c, '令牌数量已达上限') }, 400)

  // 明文令牌：前缀 + 32 字节随机 base64url；服务端仅存哈希
  const raw = new Uint8Array(crypto.getRandomValues(new Uint8Array(32)))
  const token = TOKEN_PREFIX + bytesToB64url(raw)

  const id = crypto.randomUUID()
  const preview = token.slice(0, TOKEN_PREFIX.length + 6) + '...'
  await c.env.DB.prepare(
    'INSERT INTO mcp_tokens (id, user_id, name, token_hash, token_preview) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, user.id, trimmed, await sha256Hex(token), preview).run()

  return c.json({ id, name: trimmed, token, token_preview: preview }, 201)
})

mcpApp.delete('/api/mcp/tokens/:id', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  await c.env.DB.prepare('DELETE FROM mcp_tokens WHERE id = ? AND user_id = ?').bind(c.req.param('id'), user.id).run()
  return c.json({ success: true })
})

export { mcpApp }
