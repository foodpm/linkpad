// LinkPad — Cloudflare Worker API v2
import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  DB: D1Database
  R2: R2Bucket
  ASSETS: Fetcher
  JWT_SECRET: string
  ADMIN_EMAIL: string
}

type User = {
  id: string
  email: string
  nickname: string
  avatar_url: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json({ error: err.message || 'Internal Server Error' }, 500)
})

app.use('/*', cors({
  origin: ['https://linkpad.site', 'https://www.linkpad.site', 'http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}))

// Allow iframe embedding (for browser extension new tab)
app.use('/*', async (c, next) => {
  await next()
  c.res.headers.delete('X-Frame-Options')
  const csp = c.res.headers.get('Content-Security-Policy')
  if (csp) {
    c.res.headers.set('Content-Security-Policy', csp.replace(/frame-ancestors\s+[^;]+;?/g, ''))
  }
})

// ==================== Auth Helpers ====================

async function hashPassword(password: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + secret)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function signJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 * 7 }))
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`))
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))
  return `${header}.${body}.${signature}`
}

async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    const sig = Uint8Array.from(atob(parts[2]), c => c.charCodeAt(0))
    const valid = await crypto.subtle.verify('HMAC', key, sig, encoder.encode(`${parts[0]}.${parts[1]}`))
    if (!valid) return null
    const payload = JSON.parse(atob(parts[1]))
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch { return null }
}

async function getUser(c: any): Promise<User | null> {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const payload = await verifyJWT(auth.slice(7), c.env.JWT_SECRET)
  if (!payload || !payload.sub) return null
  const user = await c.env.DB.prepare('SELECT id, email, nickname, avatar_url FROM users WHERE id = ?').bind(payload.sub).first()
  return user as User | null
}

function isAdmin(c: any, user: User | null): boolean {
  return user?.email === c.env.ADMIN_EMAIL
}

// ==================== Auth Routes ====================

app.post('/api/auth/register', async (c) => {
  const { email, password, nickname } = await c.req.json()
  if (!email || !password) return c.json({ error: '邮箱和密码不能为空' }, 400)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: '邮箱格式不正确' }, 400)
  if (password.length < 6) return c.json({ error: '密码至少6位' }, 400)

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (existing) return c.json({ error: '该邮箱已注册' }, 409)

  const id = crypto.randomUUID()
  const hash = await hashPassword(password, c.env.JWT_SECRET)
  const nick = nickname || email.split('@')[0]

  await c.env.DB.prepare('INSERT INTO users (id, email, password_hash, nickname) VALUES (?, ?, ?, ?)').bind(id, email, hash, nick).run()
  
  // 复制所有全局分类到用户表
  const { results: globalCats } = await c.env.DB.prepare('SELECT * FROM categories ORDER BY sort_order ASC').all()
  const idMapping: Record<string, string> = {}
  for (const cat of (globalCats as any[])) {
    const newId = crypto.randomUUID()
    idMapping[cat.id] = newId
    await c.env.DB.prepare('INSERT INTO user_categories (id, user_id, name, icon, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)').bind(
      newId, id, cat.name, cat.icon, null, cat.sort_order
    ).run()
  }
  
  // 第二次更新 parent_id（因为之前是 null，现在需要指向新的 id）
  for (const cat of (globalCats as any[])) {
    if (cat.parent_id) {
      const newParentId = idMapping[cat.parent_id]
      const newCatId = idMapping[cat.id]
      await c.env.DB.prepare('UPDATE user_categories SET parent_id = ? WHERE id = ?').bind(newParentId, newCatId).run()
    }
  }
  
  // 复制所有全局链接到用户表
  const { results: globalTools } = await c.env.DB.prepare('SELECT * FROM tools ORDER BY sort_order ASC').all()
  for (const tool of (globalTools as any[])) {
    const newId = crypto.randomUUID()
    const newCatId = idMapping[tool.category_id]
    await c.env.DB.prepare(`INSERT INTO user_tools (id, user_id, name, url, desc, category_id, icon, bg_color, text_color, sort_order, viewed) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).bind(
        newId, id, tool.name, tool.url, tool.desc, newCatId, tool.icon, tool.bg_color, tool.text_color, tool.sort_order
      ).run()
  }

  const token = await signJWT({ sub: id, email }, c.env.JWT_SECRET)
  return c.json({ token, user: { id, email, nickname: nick, avatar_url: '' } })
})

app.post('/api/auth/login', async (c) => {
  const { email, password } = await c.req.json()
  if (!email || !password) return c.json({ error: '请输入邮箱和密码' }, 400)

  const user = await c.env.DB.prepare('SELECT id, email, nickname, avatar_url, password_hash, status FROM users WHERE email = ?').bind(email).first() as any
  if (!user) return c.json({ error: '邮箱未注册' }, 401)
  if (user.status === 'disabled') return c.json({ error: '账户已被禁用' }, 403)

  const hash = await hashPassword(password, c.env.JWT_SECRET)
  if (hash !== user.password_hash) return c.json({ error: '密码错误' }, 401)

  const token = await signJWT({ sub: user.id, email: user.email }, c.env.JWT_SECRET)
  return c.json({ token, user: { id: user.id, email: user.email, nickname: user.nickname, avatar_url: user.avatar_url } })
})

app.get('/api/auth/me', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  return c.json(user)
})

// ==================== User Profile ====================

app.get('/api/users/:id', async (c) => {
  const id = c.req.param('id')
  const user = await c.env.DB.prepare('SELECT id, email, nickname, avatar_url, created_at FROM users WHERE id = ?').bind(id).first() as any
  if (!user) return c.json({ error: '用户不存在' }, 404)

  // Check if current user is following this profile
  const currentUser = await getUser(c)

  const [followerCount, followingCount, repoCount] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM follows WHERE following_id = ?').bind(id).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM follows WHERE follower_id = ?').bind(id).first(),
    currentUser && currentUser.id === id
      ? c.env.DB.prepare('SELECT COUNT(*) as count FROM repositories WHERE user_id = ?').bind(id).first()
      : c.env.DB.prepare('SELECT COUNT(*) as count FROM repositories WHERE user_id = ? AND visibility = \'public\'').bind(id).first(),
  ])

  let is_following = false
  if (currentUser && currentUser.id !== id) {
    const follow = await c.env.DB.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?').bind(currentUser.id, id).first()
    is_following = !!follow
  }

  return c.json({
    ...user,
    follower_count: (followerCount as any)?.count || 0,
    following_count: (followingCount as any)?.count || 0,
    repo_count: (repoCount as any)?.count || 0,
    is_following,
  })
})

app.get('/api/users/:id/followers', async (c) => {
  const id = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    'SELECT u.id, u.nickname, u.avatar_url FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.following_id = ? ORDER BY f.created_at DESC'
  ).bind(id).all()
  return c.json(results)
})

app.get('/api/users/:id/following', async (c) => {
  const id = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    'SELECT u.id, u.nickname, u.avatar_url FROM follows f JOIN users u ON u.id = f.following_id WHERE f.follower_id = ? ORDER BY f.created_at DESC'
  ).bind(id).all()
  return c.json(results)
})

app.get('/api/users/:id/repos', async (c) => {
  const id = c.req.param('id')
  const currentUser = await getUser(c)
  let query: string, params: string[]

  if (currentUser && currentUser.id === id) {
    query = 'SELECT * FROM repositories WHERE user_id = ? ORDER BY created_at DESC'
    params = [id]
  } else {
    query = 'SELECT * FROM repositories WHERE user_id = ? AND visibility = \'public\' ORDER BY created_at DESC'
    params = [id]
  }

  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  return c.json(results)
})

app.put('/api/users/me', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const { nickname, avatar_url } = await c.req.json()

  if (nickname !== undefined) {
    await c.env.DB.prepare('UPDATE users SET nickname = ? WHERE id = ?').bind(nickname, user.id).run()
  }
  if (avatar_url !== undefined) {
    await c.env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(avatar_url, user.id).run()
  }

  const updated = await c.env.DB.prepare('SELECT id, email, nickname, avatar_url FROM users WHERE id = ?').bind(user.id).first()
  return c.json(updated)
})

// ==================== User Widgets ====================

app.get('/api/user/widgets', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const prefs = await c.env.DB.prepare('SELECT widgets, item_order FROM user_preferences WHERE user_id = ?').bind(user.id).first()
  return c.json({
    widgets: prefs ? JSON.parse(prefs.widgets) : [],
    itemOrder: prefs ? JSON.parse(prefs.item_order) : {}
  })
})

app.post('/api/user/widgets', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const { widgets, itemOrder } = await c.req.json()
  const widgetsJson = typeof widgets === 'string' ? widgets : JSON.stringify(widgets)
  const orderJson = typeof itemOrder === 'string' ? itemOrder : JSON.stringify(itemOrder || {})
  await c.env.DB.prepare(
    "INSERT INTO user_preferences (user_id, widgets, item_order, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET widgets = ?, item_order = ?, updated_at = datetime('now')"
  ).bind(user.id, widgetsJson, orderJson, widgetsJson, orderJson).run()
  return c.json({ success: true })
})

// ==================== Avatar Upload ====================

app.post('/api/upload/avatar', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)

  const formData = await c.req.parseBody()
  const file = formData['file'] as File | null
  if (!file) return c.json({ error: '请选择文件' }, 400)

  const ext = file.name.split('.').pop() || 'png'
  const key = `avatars/${user.id}.${ext}`
  await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } })

  const url = `/api/avatars/${user.id}.${ext}`
  await c.env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(url, user.id).run()

  return c.json({ avatar_url: url })
})

// ==================== Serve Avatars from R2 ====================

app.get('/api/avatars/:key', async (c) => {
  const key = c.req.param('key')
  const obj = await c.env.R2.get(`avatars/${key}`)
  if (!obj) return c.json({ error: 'Not found' }, 404)
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('Cache-Control', 'public, max-age=31536000')
  headers.set('etag', obj.httpEtag)
  return new Response(obj.body, { headers })
})

// Serve extension download
app.get('/api/extension', async (c) => {
  const obj = await c.env.R2.get('linkpad-extension.zip')
  if (!obj) return c.json({ error: 'Not found' }, 404)
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('Content-Type', 'application/zip')
  headers.set('Content-Disposition', 'attachment; filename="linkpad-extension.zip"')
  headers.set('Cache-Control', 'public, max-age=3600')
  return new Response(obj.body, { headers })
})

// ==================== Repo helpers ====================

const palette = [
  { bg: '#3B82F6', text: '#FFFFFF' }, { bg: '#EF4444', text: '#FFFFFF' },
  { bg: '#10B981', text: '#FFFFFF' }, { bg: '#F59E0B', text: '#FFFFFF' },
  { bg: '#8B5CF6', text: '#FFFFFF' }, { bg: '#EC4899', text: '#FFFFFF' },
  { bg: '#06B6D4', text: '#FFFFFF' }, { bg: '#F97316', text: '#FFFFFF' },
  { bg: '#6366F1', text: '#FFFFFF' }, { bg: '#14B8A6', text: '#FFFFFF' },
  { bg: '#84CC16', text: '#FFFFFF' }, { bg: '#D946EF', text: '#FFFFFF' },
  { bg: '#0EA5E9', text: '#FFFFFF' }, { bg: '#E11D48', text: '#FFFFFF' },
  { bg: '#7C3AED', text: '#FFFFFF' }, { bg: '#059669', text: '#FFFFFF' },
]
function randomColor() { return palette[Math.floor(Math.random() * palette.length)] }

async function canManageRepo(c: any, repoId: string): Promise<boolean> {
  const user = await getUser(c)
  if (!user) return false
  const repo = await c.env.DB.prepare('SELECT user_id FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (!repo) return false
  if (repo.user_id === user.id) return true
  const member = await c.env.DB.prepare('SELECT id FROM repo_members WHERE repo_id = ? AND user_id = ?').bind(repoId, user.id).first()
  return !!member
}

// ==================== Repositories ====================

app.get('/api/repos', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const { results } = await c.env.DB.prepare(
    `SELECT r.*,
      (SELECT COUNT(*) FROM repo_follows WHERE repo_id = r.id) as follower_count,
      (SELECT COUNT(*) FROM repo_bookmarks WHERE repo_id = r.id) as bookmark_count
    FROM repositories r WHERE r.user_id = ? ORDER BY r.created_at DESC`
  ).bind(user.id).all()
  return c.json(results)
})

app.post('/api/repos', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)

  const { name, description, visibility, password, categories } = await c.req.json()
  if (!name) return c.json({ error: '仓库名称不能为空' }, 400)

  const id = crypto.randomUUID()
  const icon = name.charAt(0).toUpperCase()
  const colors = randomColor()

  await c.env.DB.prepare(
    'INSERT INTO repositories (id, user_id, name, icon, bg_color, text_color, description, visibility, password) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, name, icon, colors.bg, colors.text, description || '', visibility || 'private', password || '').run()

  // Add categories
  if (categories && Array.isArray(categories) && categories.length > 0) {
    const stmt = c.env.DB.prepare('INSERT INTO repo_categories (id, repo_id, name, sort_order) VALUES (?, ?, ?, ?)')
    for (let i = 0; i < Math.min(categories.length, 20); i++) {
      await stmt.bind(crypto.randomUUID(), id, categories[i], i).run()
    }
  }

  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(id).first()
  return c.json(repo, 201)
})

app.get('/api/repos/:id', async (c) => {
  const id = c.req.param('id')
  const repo = await c.env.DB.prepare('SELECT r.*, u.nickname as owner_name, u.avatar_url as owner_avatar FROM repositories r JOIN users u ON u.id = r.user_id WHERE r.id = ?').bind(id).first() as any
  if (!repo) return c.json({ error: '仓库不存在' }, 404)

  // Check visibility
  if (repo.visibility === 'private') {
    const user = await getUser(c)
    if (!user || user.id !== repo.user_id) return c.json({ error: '无权访问' }, 403)
  }

  if (repo.visibility === 'password') {
    const password = c.req.query('password')
    if (repo.password && password !== repo.password) {
      const user = await getUser(c)
      if (!user || user.id !== repo.user_id) return c.json({ need_password: true }, 401)
    }
  }

  // Get categories and members
  const { results: categories } = await c.env.DB.prepare('SELECT id, name, sort_order FROM repo_categories WHERE repo_id = ? ORDER BY sort_order ASC').bind(id).all()
  const { results: members } = await c.env.DB.prepare(
    'SELECT u.id, u.nickname, u.avatar_url, rm.role FROM repo_members rm JOIN users u ON u.id = rm.user_id WHERE rm.repo_id = ? ORDER BY rm.created_at ASC'
  ).bind(id).all()

  // Get counts
  const [followerCount, bookmarkCount] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM repo_follows WHERE repo_id = ?').bind(id).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM repo_bookmarks WHERE repo_id = ?').bind(id).first(),
  ])

  // Current user's follow/bookmark/manage status
  let is_following = false, is_bookmarked = false, can_manage = false
  const user = await getUser(c)
  if (user) {
    const [follow, bookmark] = await Promise.all([
      c.env.DB.prepare('SELECT id FROM repo_follows WHERE user_id = ? AND repo_id = ?').bind(user.id, id).first(),
      c.env.DB.prepare('SELECT id FROM repo_bookmarks WHERE user_id = ? AND repo_id = ?').bind(user.id, id).first(),
    ])
    is_following = !!follow
    is_bookmarked = !!bookmark
    can_manage = user.id === repo.user_id || !!(await c.env.DB.prepare('SELECT id FROM repo_members WHERE repo_id = ? AND user_id = ?').bind(id, user.id).first())
  }

  return c.json({
    ...repo,
    categories: categories.map((c: any) => c.name),
    members,
    follower_count: (followerCount as any)?.count || 0,
    bookmark_count: (bookmarkCount as any)?.count || 0,
    is_following,
    is_bookmarked,
    can_manage,
  })
})

app.put('/api/repos/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)

  const id = c.req.param('id')
  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(id).first() as any
  if (!repo) return c.json({ error: '仓库不存在' }, 404)
  if (repo.user_id !== user.id) return c.json({ error: '无权修改' }, 403)

  const { name, icon, icon_key, bg_color, text_color, description, visibility, password } = await c.req.json()
  if (name !== undefined) await c.env.DB.prepare('UPDATE repositories SET name = ? WHERE id = ?').bind(name, id).run()
  if (icon !== undefined) await c.env.DB.prepare('UPDATE repositories SET icon = ? WHERE id = ?').bind(icon, id).run()
  if (icon_key !== undefined) await c.env.DB.prepare('UPDATE repositories SET icon_key = ? WHERE id = ?').bind(icon_key, id).run()
  if (bg_color !== undefined) await c.env.DB.prepare('UPDATE repositories SET bg_color = ? WHERE id = ?').bind(bg_color, id).run()
  if (text_color !== undefined) await c.env.DB.prepare('UPDATE repositories SET text_color = ? WHERE id = ?').bind(text_color, id).run()
  if (description !== undefined) await c.env.DB.prepare('UPDATE repositories SET description = ? WHERE id = ?').bind(description, id).run()
  if (visibility !== undefined) await c.env.DB.prepare('UPDATE repositories SET visibility = ? WHERE id = ?').bind(visibility, id).run()
  if (password !== undefined) await c.env.DB.prepare('UPDATE repositories SET password = ? WHERE id = ?').bind(password, id).run()

  // Update categories if provided
  const { categories } = await c.req.json()
  if (categories && Array.isArray(categories)) {
    await c.env.DB.prepare('DELETE FROM repo_categories WHERE repo_id = ?').bind(id).run()
    const stmt = c.env.DB.prepare('INSERT INTO repo_categories (id, repo_id, name, sort_order) VALUES (?, ?, ?, ?)')
    for (let i = 0; i < categories.length; i++) {
      await stmt.bind(crypto.randomUUID(), id, categories[i], i).run()
    }
  }

  const updated = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(id).first()
  return c.json(updated)
})

app.delete('/api/repos/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)

  const id = c.req.param('id')
  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(id).first() as any
  if (!repo) return c.json({ error: '仓库不存在' }, 404)
  if (repo.user_id !== user.id) return c.json({ error: '无权删除' }, 403)

  // Cascade delete
  await c.env.DB.prepare('DELETE FROM repo_links WHERE repo_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM repo_categories WHERE repo_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM repo_members WHERE repo_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM repo_follows WHERE repo_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM repo_bookmarks WHERE repo_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM repo_tags WHERE repo_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM repositories WHERE id = ?').bind(id).run()

  return c.json({ success: true })
})

// ==================== Repo Links ====================

app.get('/api/repos/:id/links', async (c) => {
  const id = c.req.param('id')
  const { results } = await c.env.DB.prepare('SELECT * FROM repo_links WHERE repo_id = ? ORDER BY sort_order ASC, created_at ASC').bind(id).all()
  return c.json(results)
})

app.post('/api/repos/:id/links', async (c) => {
  const repoId = c.req.param('id')
  if (!(await canManageRepo(c, repoId))) return c.json({ error: '无权操作' }, 403)

  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (!repo) return c.json({ error: '仓库不存在' }, 404)

  const { name, url, icon, category_id, desc } = await c.req.json()
  if (!name || !url) return c.json({ error: '名称和地址不能为空' }, 400)

  const linkId = crypto.randomUUID()
  const linkIcon = icon || name.charAt(0).toUpperCase()
  const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as max FROM repo_links WHERE repo_id = ?').bind(repoId).first() as any

  await c.env.DB.prepare(
    'INSERT INTO repo_links (id, repo_id, category_id, name, url, icon, sort_order, desc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(linkId, repoId, category_id || '', name, url, linkIcon, (maxOrder?.max ?? -1) + 1, desc || '').run()

  await c.env.DB.prepare('UPDATE repositories SET link_count = (SELECT COUNT(*) FROM repo_links WHERE repo_id = ?), updated_at = datetime(\'now\') WHERE id = ?').bind(repoId, repoId).run()

  const link = await c.env.DB.prepare('SELECT * FROM repo_links WHERE id = ?').bind(linkId).first()
  
  // Sync new link to all followers
  if (link) {
    await syncLinkToFollowers(c.env.DB, repoId, link, 'add')
  }

  return c.json(link, 201)
})

app.put('/api/links/:id', async (c) => {
  const id = c.req.param('id')
  const link = await c.env.DB.prepare('SELECT l.*, r.user_id FROM repo_links l JOIN repositories r ON r.id = l.repo_id WHERE l.id = ?').bind(id).first() as any
  if (!link) return c.json({ error: '链接不存在' }, 404)
  if (!(await canManageRepo(c, link.repo_id))) return c.json({ error: '无权修改' }, 403)

  const { name, url, icon, category_id, bg_color, text_color, desc } = await c.req.json()
  if (name !== undefined) await c.env.DB.prepare('UPDATE repo_links SET name = ? WHERE id = ?').bind(name, id).run()
  if (url !== undefined) await c.env.DB.prepare('UPDATE repo_links SET url = ? WHERE id = ?').bind(url, id).run()
  if (icon !== undefined) await c.env.DB.prepare('UPDATE repo_links SET icon = ? WHERE id = ?').bind(icon, id).run()
  if (category_id !== undefined) await c.env.DB.prepare('UPDATE repo_links SET category_id = ? WHERE id = ?').bind(category_id, id).run()
  if (bg_color !== undefined) await c.env.DB.prepare('UPDATE repo_links SET bg_color = ? WHERE id = ?').bind(bg_color, id).run()
  if (text_color !== undefined) await c.env.DB.prepare('UPDATE repo_links SET text_color = ? WHERE id = ?').bind(text_color, id).run()
  if (desc !== undefined) await c.env.DB.prepare('UPDATE repo_links SET desc = ? WHERE id = ?').bind(desc, id).run()

  // Mark repo as updated
  await c.env.DB.prepare('UPDATE repositories SET updated_at = datetime(\'now\') WHERE id = ?').bind(link.repo_id).run()

  const updated = await c.env.DB.prepare('SELECT * FROM repo_links WHERE id = ?').bind(id).first()
  
  // Sync update to followers
  if (updated) {
    syncLinkToFollowers(c.env.DB, link.repo_id, updated, 'update').catch(e => console.error('sync update error:', e))
  }

  return c.json(updated)
})

app.delete('/api/links/:id', async (c) => {
  const id = c.req.param('id')
  const link = await c.env.DB.prepare('SELECT l.*, r.user_id FROM repo_links l JOIN repositories r ON r.id = l.repo_id WHERE l.id = ?').bind(id).first() as any
  if (!link) return c.json({ error: '链接不存在' }, 404)
  if (!(await canManageRepo(c, link.repo_id))) return c.json({ error: '无权删除' }, 403)

  await c.env.DB.prepare('DELETE FROM repo_links WHERE id = ?').bind(id).run()
  await c.env.DB.prepare('UPDATE repositories SET link_count = (SELECT COUNT(*) FROM repo_links WHERE repo_id = ?), updated_at = datetime(\'now\') WHERE id = ?').bind(link.repo_id, link.repo_id).run()

  // Sync deletion to followers
  syncLinkToFollowers(c.env.DB, link.repo_id, link, 'delete').catch(e => console.error('sync delete error:', e))

  return c.json({ success: true })
})

// ==================== Repo Categories ====================

app.post('/api/repos/:id/categories', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)

  const repoId = c.req.param('id')
  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (!repo) return c.json({ error: '仓库不存在' }, 404)
  if (repo.user_id !== user.id) return c.json({ error: '无权修改' }, 403)

  const { name } = await c.req.json()
  if (!name) return c.json({ error: '分类名称不能为空' }, 400)

  const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as max FROM repo_categories WHERE repo_id = ?').bind(repoId).first() as any
  await c.env.DB.prepare('INSERT INTO repo_categories (id, repo_id, name, sort_order) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), repoId, name, (maxOrder?.max ?? -1) + 1).run()
  return c.json({ success: true })
})

app.delete('/api/repos/:id/categories/:name', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)

  const repoId = c.req.param('id')
  const catName = decodeURIComponent(c.req.param('name'))
  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (!repo) return c.json({ error: '仓库不存在' }, 404)
  if (repo.user_id !== user.id) return c.json({ error: '无权修改' }, 403)

  // Sync deletion to followers — remove their sub-category and tools
  const followers = await c.env.DB.prepare('SELECT user_id, target_category_id FROM repo_follows WHERE repo_id = ? AND target_category_id != \'\'').bind(repoId).all()
  for (const f of (followers.results || []) as any[]) {
    const subCat = await c.env.DB.prepare('SELECT id FROM user_categories WHERE user_id = ? AND parent_id = ? AND name = ?').bind(f.user_id, f.target_category_id, catName).first() as any
    if (subCat) {
      await c.env.DB.prepare('DELETE FROM user_tools WHERE user_id = ? AND category_id = ?').bind(f.user_id, subCat.id).run()
      await c.env.DB.prepare('DELETE FROM user_categories WHERE id = ? AND user_id = ?').bind(subCat.id, f.user_id).run()
    }
  }

  await c.env.DB.prepare('DELETE FROM repo_categories WHERE repo_id = ? AND name = ?').bind(repoId, catName).run()
  await c.env.DB.prepare('UPDATE repo_links SET category_id = \'\' WHERE repo_id = ? AND category_id = ?').bind(repoId, catName).run()
  return c.json({ success: true })
})

// Reorder repo categories
app.put('/api/repos/:id/categories/reorder', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const repoId = c.req.param('id')
  if (!(await canManageRepo(c, repoId))) return c.json({ error: '无权操作' }, 403)
  const { order } = await c.req.json() as { order: { name: string; sort_order: number }[] }
  if (!order) return c.json({ error: '无效参数' }, 400)
  const db = c.env.DB
  const tx = db.batch(order.map(o =>
    db.prepare('UPDATE repo_categories SET sort_order = ? WHERE repo_id = ? AND name = ?').bind(o.sort_order, repoId, o.name)
  ))
  await tx
  return c.json({ success: true })
})

// Rename repo category
app.put('/api/repos/:id/categories/:name', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const repoId = c.req.param('id')
  const oldName = decodeURIComponent(c.req.param('name'))
  const { name: newName } = await c.req.json()
  if (!newName?.trim()) return c.json({ error: '名称不能为空' }, 400)
  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (!repo) return c.json({ error: '仓库不存在' }, 404)
  if (repo.user_id !== user.id) return c.json({ error: '无权修改' }, 403)
  await c.env.DB.prepare('UPDATE repo_categories SET name = ? WHERE repo_id = ? AND name = ?').bind(newName.trim(), repoId, oldName).run()
  await c.env.DB.prepare('UPDATE repo_links SET category_id = ? WHERE repo_id = ? AND category_id = ?').bind(newName.trim(), repoId, oldName).run()
  
  // Sync category rename to followers
  const followers = await c.env.DB.prepare('SELECT user_id, target_category_id FROM repo_follows WHERE repo_id = ? AND target_category_id != \'\'').bind(repoId).all()
  for (const f of (followers.results || []) as any[]) {
    await c.env.DB.prepare('UPDATE user_categories SET name = ? WHERE user_id = ? AND parent_id = ? AND name = ?').bind(newName.trim(), f.user_id, f.target_category_id, oldName).run()
  }
  
  return c.json({ success: true })
})

// Reorder repo links
app.put('/api/repos/:id/links/reorder', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const repoId = c.req.param('id')
  if (!(await canManageRepo(c, repoId))) return c.json({ error: '无权操作' }, 403)
  const { order } = await c.req.json() as { order: { id: string; sort_order: number }[] }
  if (!order) return c.json({ error: '无效参数' }, 400)
  const db = c.env.DB
  const tx = db.batch(order.map(o =>
    db.prepare('UPDATE repo_links SET sort_order = ? WHERE id = ?').bind(o.sort_order, o.id)
  ))
  await tx
  return c.json({ success: true })
})

// ==================== Repo Members ====================

app.get('/api/repos/:id/members', async (c) => {
  const repoId = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    'SELECT u.id, u.nickname, u.avatar_url FROM repo_members rm JOIN users u ON u.id = rm.user_id WHERE rm.repo_id = ? ORDER BY rm.created_at ASC'
  ).bind(repoId).all()
  return c.json(results)
})

app.post('/api/repos/:id/members', async (c) => {
  const repoId = c.req.param('id')
  if (!(await canManageRepo(c, repoId))) return c.json({ error: '无权操作' }, 403)
  const repo = await c.env.DB.prepare('SELECT user_id FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (!repo) return c.json({ error: '仓库不存在' }, 404)

  const { nickname, email } = await c.req.json()
  if (!nickname && !email) return c.json({ error: '请提供昵称或邮箱' }, 400)

  let targetUser: any
  if (email) {
    targetUser = await c.env.DB.prepare('SELECT id, nickname, avatar_url FROM users WHERE email = ?').bind(email).first()
  } else {
    targetUser = await c.env.DB.prepare('SELECT id, nickname, avatar_url FROM users WHERE nickname = ?').bind(nickname).first()
  }
  if (!targetUser) return c.json({ error: '未找到该用户' }, 404)
  if (targetUser.id === repo.user_id) return c.json({ error: '不能添加创建者' }, 400)

  const existing = await c.env.DB.prepare('SELECT id FROM repo_members WHERE repo_id = ? AND user_id = ?').bind(repoId, targetUser.id).first()
  if (existing) return c.json({ error: '该用户已是成员' }, 409)

  await c.env.DB.prepare('INSERT INTO repo_members (id, repo_id, user_id, role) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), repoId, targetUser.id, 'member').run()
  return c.json({ success: true, user: targetUser })
})

app.delete('/api/repos/:id/members/:userId', async (c) => {
  const repoId = c.req.param('id')
  const userId = c.req.param('userId')
  if (!(await canManageRepo(c, repoId))) return c.json({ error: '无权操作' }, 403)

  await c.env.DB.prepare('DELETE FROM repo_members WHERE repo_id = ? AND user_id = ?').bind(repoId, userId).run()
  return c.json({ success: true })
})

// ==================== Repo Icon Upload ====================

app.post('/api/repos/:id/icon', async (c) => {
  const repoId = c.req.param('id')
  if (!(await canManageRepo(c, repoId))) return c.json({ error: '无权操作' }, 403)

  const formData = await c.req.parseBody()
  const file = formData['file'] as File | null
  if (!file) return c.json({ error: '请选择文件' }, 400)

  const ext = file.name.split('.').pop() || 'png'
  const key = `repo-icons/${repoId}.${ext}`
  await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } })

  const url = `/api/repo-icons/${repoId}.${ext}`
  await c.env.DB.prepare('UPDATE repositories SET icon_key = ? WHERE id = ?').bind(url, repoId).run()
  return c.json({ icon_key: url })
})

app.get('/api/repo-icons/:key', async (c) => {
  const key = `repo-icons/${c.req.param('key')}`
  const obj = await c.env.R2.get(key)
  if (!obj) return c.json({ error: 'Not found' }, 404)
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('Cache-Control', 'public, max-age=31536000')
  return new Response(obj.body, { headers })
})

// ==================== Follow / Unfollow Users ====================

app.post('/api/follows/user/:userId', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)

  const targetId = c.req.param('userId')
  if (user.id === targetId) return c.json({ error: '不能关注自己' }, 400)

  const target = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(targetId).first()
  if (!target) return c.json({ error: '用户不存在' }, 404)

  const existing = await c.env.DB.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?').bind(user.id, targetId).first()
  if (existing) return c.json({ error: '已关注' }, 409)

  await c.env.DB.prepare('INSERT INTO follows (id, follower_id, following_id) VALUES (?, ?, ?)').bind(crypto.randomUUID(), user.id, targetId).run()

  // Notify followed user
  const actorName = user.nickname || '某用户'
  await createNotification(c.env.DB, targetId, 'follow_user', user.id, '', `${actorName} 关注了您`)

  return c.json({ success: true })
})

app.delete('/api/follows/user/:userId', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)

  const targetId = c.req.param('userId')
  await c.env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').bind(user.id, targetId).run()
  return c.json({ success: true })
})

// ==================== Follow / Unfollow Repos ====================

app.post('/api/follows/repo/:repoId', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const repoId = c.req.param('repoId')
  const { category_id } = await c.req.json() as { category_id?: string }

  // Check existing follow
  const existing = await c.env.DB.prepare('SELECT id FROM repo_follows WHERE user_id = ? AND repo_id = ?').bind(user.id, repoId).first() as any

  if (existing && !category_id) {
    // Already following, no sync needed
    return c.json({ success: true })
  }

  if (existing) {
    // Update target_category_id for re-sync
    await c.env.DB.prepare('UPDATE repo_follows SET target_category_id = ? WHERE user_id = ? AND repo_id = ?').bind(category_id || '', user.id, repoId).run()
  } else {
    await c.env.DB.prepare('INSERT INTO repo_follows (id, user_id, repo_id, target_category_id, last_viewed_at) VALUES (?, ?, ?, ?, datetime(\'now\'))').bind(crypto.randomUUID(), user.id, repoId, category_id || '').run()

    // Notify repo owner
    const repoInfo = await c.env.DB.prepare('SELECT user_id, name FROM repositories WHERE id = ?').bind(repoId).first() as any
    if (repoInfo) {
      await createNotification(c.env.DB, repoInfo.user_id, 'follow_repo', user.id, repoId, `${user.nickname || '某用户'} 关注了您的仓库「${repoInfo.name}」`)
    }
  }

  // Sync repo links to user's home tools (user-specific)
  if (category_id) {
    try {
      const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(repoId).first() as any
      if (!repo) return c.json({ error: '仓库不存在' }, 404)

      const db = c.env.DB
      const followPrefix = `follow-${repoId}-${user.id}-`

      // Clean up previous sync entries for this user
      await db.prepare('DELETE FROM user_tools WHERE id >= ? AND id < ? AND user_id = ?').bind(followPrefix, `${followPrefix}{`, user.id).run()
      // Clean up user sub-categories that came from this follow
      await db.prepare("DELETE FROM user_categories WHERE user_id = ? AND id LIKE ?").bind(user.id, `follow-sc-${repoId}-%`).run()

      // Get repo categories & uncategorized links
      const { results: repoCategories } = await c.env.DB.prepare('SELECT name, sort_order FROM repo_categories WHERE repo_id = ? ORDER BY sort_order ASC').bind(repoId).all()
      const { results: uncategorizedLinks } = await c.env.DB.prepare('SELECT * FROM repo_links WHERE repo_id = ? AND category_id = \'\' ORDER BY sort_order ASC').bind(repoId).all()

      const stmts: any[] = []
      const subCatIdMap: Record<string, string> = {}

      // First pass: create all sub-categories with the correct sort order
      const { results: existingSubCats } = await db.prepare('SELECT id, name FROM user_categories WHERE user_id = ? AND parent_id = ?').bind(user.id, category_id).all()
      const existingSubCatMap: Record<string, string> = {}
      for (const cat of (existingSubCats as any[])) {
        existingSubCatMap[cat.name] = cat.id
      }

      const maxOrderCat = await db.prepare('SELECT MAX(sort_order) as max FROM user_categories WHERE user_id = ? AND parent_id = ?').bind(user.id, category_id).first() as any
      let currentSortOrder = (maxOrderCat?.max ?? -1) + 1

      for (const repoCat of (repoCategories as any[])) {
        const catName = repoCat.name
        let subCatId: string
        if (existingSubCatMap[catName]) {
          subCatId = existingSubCatMap[catName]
        } else {
          subCatId = `follow-sc-${repoId}-${crypto.randomUUID().slice(0,8)}`
          stmts.push(db.prepare('INSERT INTO user_categories (id, user_id, name, icon, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)').bind(subCatId, user.id, catName, 'Folder', category_id, currentSortOrder))
          currentSortOrder++
        }
        subCatIdMap[catName] = subCatId
      }

      // Second pass: add links to each sub-category
      for (const repoCat of (repoCategories as any[])) {
        const catName = repoCat.name
        const subCatId = subCatIdMap[catName]
        
        const { results: catLinks } = await db.prepare('SELECT * FROM repo_links WHERE repo_id = ? AND category_id = ? ORDER BY sort_order ASC').bind(repoId, catName).all()
        if ((catLinks as any[]).length > 0) {
          const maxToolOrder = await db.prepare('SELECT MAX(sort_order) as max FROM user_tools WHERE user_id = ? AND category_id = ?').bind(user.id, subCatId).first() as any
          let toolSortOrder = (maxToolOrder?.max ?? -1) + 1
          for (const link of (catLinks as any[])) {
            stmts.push(db.prepare(
              'INSERT OR IGNORE INTO user_tools (id, user_id, name, url, desc, category_id, sort_order, icon, viewed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'
            ).bind(`follow-${repoId}-${user.id}-${link.id}`, user.id, link.name, link.url, link.desc || '', subCatId, toolSortOrder++, link.icon || ''))
          }
        }
      }

      // Uncategorized links
      if ((uncategorizedLinks as any[]).length > 0) {
        const maxToolOrder = await db.prepare('SELECT MAX(sort_order) as max FROM user_tools WHERE user_id = ? AND category_id = ?').bind(user.id, category_id).first() as any
        let toolSortOrder = (maxToolOrder?.max ?? -1) + 1
        for (const link of (uncategorizedLinks as any[])) {
          stmts.push(db.prepare(
            'INSERT OR IGNORE INTO user_tools (id, user_id, name, url, desc, category_id, sort_order, icon, viewed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'
          ).bind(`follow-${repoId}-${user.id}-${link.id}`, user.id, link.name, link.url, link.desc || '', category_id, toolSortOrder++, link.icon || ''))
        }
      }

      if (stmts.length > 0) await db.batch(stmts)
    } catch (e) {
      // Sync failed but follow is already saved — don't block user
      console.error('Follow sync error:', e)
    }
  }

  return c.json({ success: true })
})

app.delete('/api/follows/repo/:repoId', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)

  const repoId = c.req.param('repoId')
  const db = c.env.DB
  const followPrefix = `follow-${repoId}-${user.id}-`
  await db.prepare('DELETE FROM user_tools WHERE id >= ? AND id < ? AND user_id = ?').bind(followPrefix, `${followPrefix}{`, user.id).run()
  await db.prepare('DELETE FROM user_categories WHERE user_id = ? AND id LIKE ?').bind(user.id, `follow-sc-${repoId}-%`).run()
  await db.prepare('DELETE FROM repo_follows WHERE user_id = ? AND repo_id = ?').bind(user.id, repoId).run()
  return c.json({ success: true })
})

// ==================== Bookmark / Unbookmark Repos ====================

app.post('/api/bookmarks/repo/:repoId', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)

  const repoId = c.req.param('repoId')
  const existing = await c.env.DB.prepare('SELECT id FROM repo_bookmarks WHERE user_id = ? AND repo_id = ?').bind(user.id, repoId).first()
  if (existing) return c.json({ error: '已收藏' }, 409)

  await c.env.DB.prepare('INSERT INTO repo_bookmarks (id, user_id, repo_id) VALUES (?, ?, ?)').bind(crypto.randomUUID(), user.id, repoId).run()

  // Notify repo owner
  const repoInfo = await c.env.DB.prepare('SELECT user_id, name FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (repoInfo) {
    await createNotification(c.env.DB, repoInfo.user_id, 'bookmark_repo', user.id, repoId, `${user.nickname || '某用户'} 收藏了您的仓库「${repoInfo.name}」`)
  }

  return c.json({ success: true })
})

app.delete('/api/bookmarks/repo/:repoId', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)

  const repoId = c.req.param('repoId')
  await c.env.DB.prepare('DELETE FROM repo_bookmarks WHERE user_id = ? AND repo_id = ?').bind(user.id, repoId).run()
  return c.json({ success: true })
})

// ==================== Mark followed repo as viewed ====================

app.post('/api/follows/repo/:repoId/view', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)

  const repoId = c.req.param('repoId')
  await c.env.DB.prepare('UPDATE repo_follows SET last_viewed_at = datetime(\'now\') WHERE user_id = ? AND repo_id = ?').bind(user.id, repoId).run()
  return c.json({ success: true })
})

// ==================== Re-sync followed repo ====================

app.post('/api/follows/repo/:repoId/resync', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const repoId = c.req.param('repoId')

  // Check follow exists
  const follow = await c.env.DB.prepare('SELECT target_category_id FROM repo_follows WHERE user_id = ? AND repo_id = ?').bind(user.id, repoId).first() as any
  if (!follow) return c.json({ error: '未关注该仓库' }, 400)
  if (!follow.target_category_id) return c.json({ error: '关注时未选择同步分类，无法同步' }, 400)

  const db = c.env.DB
  const followPrefix = `follow-${repoId}-${user.id}-`

  // Clean up old sync entries
  await db.prepare('DELETE FROM user_tools WHERE id >= ? AND id < ? AND user_id = ?').bind(followPrefix, `${followPrefix}{`, user.id).run()
  await db.prepare("DELETE FROM user_categories WHERE user_id = ? AND id LIKE ?").bind(user.id, `follow-sc-${repoId}-%`).run()

  // Re-sync repo links
  const { results: repoCategories } = await db.prepare('SELECT name, sort_order FROM repo_categories WHERE repo_id = ? ORDER BY sort_order ASC').bind(repoId).all()
  const { results: uncategorizedLinks } = await db.prepare('SELECT * FROM repo_links WHERE repo_id = ? AND category_id = \'\' ORDER BY sort_order ASC').bind(repoId).all()

  const stmts: any[] = []
  const subCatIdMap: Record<string, string> = {}
  const category_id = follow.target_category_id

  const maxOrderCat = await db.prepare('SELECT MAX(sort_order) as max FROM user_categories WHERE user_id = ? AND parent_id = ?').bind(user.id, category_id).first() as any
  let currentSortOrder = (maxOrderCat?.max ?? -1) + 1

  for (const repoCat of (repoCategories as any[])) {
    const catName = repoCat.name
    const subCatId = `follow-sc-${repoId}-${crypto.randomUUID().slice(0,8)}`
    stmts.push(db.prepare('INSERT INTO user_categories (id, user_id, name, icon, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)').bind(subCatId, user.id, catName, 'Folder', category_id, currentSortOrder))
    currentSortOrder++
    subCatIdMap[catName] = subCatId

    const { results: catLinks } = await db.prepare('SELECT * FROM repo_links WHERE repo_id = ? AND category_id = ? ORDER BY sort_order ASC').bind(repoId, catName).all()
    if ((catLinks as any[]).length > 0) {
      let toolSortOrder = 0
      for (const link of (catLinks as any[])) {
        stmts.push(db.prepare(
          'INSERT OR IGNORE INTO user_tools (id, user_id, name, url, desc, category_id, sort_order, icon, viewed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'
        ).bind(`follow-${repoId}-${user.id}-${link.id}`, user.id, link.name, link.url, link.desc || '', subCatId, toolSortOrder++, link.icon || ''))
      }
    }
  }

  // Uncategorized links
  if ((uncategorizedLinks as any[]).length > 0) {
    let toolSortOrder = 0
    for (const link of (uncategorizedLinks as any[])) {
      stmts.push(db.prepare(
        'INSERT OR IGNORE INTO user_tools (id, user_id, name, url, desc, category_id, sort_order, icon, viewed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'
      ).bind(`follow-${repoId}-${user.id}-${link.id}`, user.id, link.name, link.url, link.desc || '', category_id, toolSortOrder++, link.icon || ''))
    }
  }

  if (stmts.length > 0) await db.batch(stmts)

  return c.json({ success: true, synced: stmts.length })
})

// Helper to create a notification
async function createNotification(db: D1Database, userId: string, type: string, actorId: string, repoId: string, message: string) {
  const id = crypto.randomUUID()
  await db.prepare(
    'INSERT INTO notifications (id, user_id, type, actor_id, repo_id, message) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, userId, type, actorId, repoId, message).run()
}

// Find or create a sub-category for a follower (sync helper)
async function findOrCreateSubCategory(db: D1Database, uid: string, repoId: string, parentCatId: string, catName: string): Promise<any> {
  let subCat = await db.prepare('SELECT id FROM user_categories WHERE user_id = ? AND parent_id = ? AND name = ?').bind(uid, parentCatId, catName).first() as any
  if (!subCat) {
    const subCatId = `follow-sc-${repoId}-${crypto.randomUUID().slice(0,8)}`
    const maxOrder = await db.prepare('SELECT MAX(sort_order) as max FROM user_categories WHERE user_id = ? AND parent_id = ?').bind(uid, parentCatId).first() as any
    await db.prepare('INSERT INTO user_categories (id, user_id, name, icon, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)').bind(subCatId, uid, catName, 'Folder', parentCatId, (maxOrder?.max ?? -1) + 1).run()
    return { id: subCatId }
  }
  return subCat
}

// Sync a repo link change to all followers (add / update / delete)
async function syncLinkToFollowers(db: D1Database, repoId: string, link: any, action: 'add' | 'update' | 'delete') {
  try {
    const followers = await db.prepare('SELECT user_id, target_category_id FROM repo_follows WHERE repo_id = ? AND target_category_id != \'\'').bind(repoId).all()
    console.log(`syncLinkToFollowers(${action}): repo=${repoId}, link=${link.id}, cat="${link.category_id}", linkName="${link.name}", followers=${(followers.results || []).length}`)
    for (const f of (followers.results || []) as any[]) {
      const uid = f.user_id
      const targetCatId = f.target_category_id
      const toolId = `follow-${repoId}-${uid}-${link.id}`

      let catId = targetCatId
      if (link.category_id) {
        const subCat = await findOrCreateSubCategory(db, uid, repoId, targetCatId, link.category_id)
        if (!subCat) {
          console.log(`syncLinkToFollowers: subCat not found/created for user=${uid}, cat="${link.category_id}"`)
          continue
        }
        console.log(`syncLinkToFollowers: user=${uid}, subCat=${subCat.id}, catName="${link.category_id}"`)
        catId = subCat.id
      }

      if (action === 'delete') {
        await db.prepare('DELETE FROM user_tools WHERE id = ? AND user_id = ?').bind(toolId, uid).run()
        console.log(`syncLinkToFollowers: deleted tool ${toolId} for user ${uid}`)
      } else {
        const result = await db.prepare(
          'INSERT OR REPLACE INTO user_tools (id, user_id, name, url, desc, category_id, sort_order, icon, viewed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)'
        ).bind(toolId, uid, link.name, link.url, link.desc || '', catId, 99999, link.icon || '').run()
        console.log(`syncLinkToFollowers: ${action} tool ${toolId} for user ${uid}, result=${JSON.stringify(result)}`)
      }
    }
  } catch (e) {
    console.error(`syncLinkToFollowers(${action}) error:`, e)
  }
}

// ==================== Notifications ====================

app.get('/api/notifications', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)

  const { results } = await c.env.DB.prepare(
    `SELECT n.*, u.nickname as actor_name, u.avatar_url as actor_avatar
     FROM notifications n JOIN users u ON u.id = n.actor_id
     WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 50`
  ).bind(user.id).all()

  const unread = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
  ).bind(user.id).first() as any

  return c.json({ notifications: results, unread_count: unread?.count || 0 })
})

app.post('/api/notifications/read', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  await c.env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(user.id).run()
  return c.json({ success: true })
})

// ==================== User's followed repos & bookmarked repos ====================

app.get('/api/me/followed-repos', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)

  const { results } = await c.env.DB.prepare(
    `SELECT r.*, rf.created_at as followed_at, rf.last_viewed_at,
      (CASE WHEN r.updated_at IS NOT NULL AND rf.last_viewed_at IS NOT NULL AND r.updated_at > rf.last_viewed_at THEN 1 ELSE 0 END) as has_updates,
      (SELECT COUNT(*) FROM repo_follows WHERE repo_id = r.id) as follower_count,
      (SELECT COUNT(*) FROM repo_bookmarks WHERE repo_id = r.id) as bookmark_count
    FROM repo_follows rf JOIN repositories r ON r.id = rf.repo_id WHERE rf.user_id = ? ORDER BY rf.created_at DESC`
  ).bind(user.id).all()
  return c.json(results)
})

app.get('/api/me/bookmarked-repos', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)

  const { results } = await c.env.DB.prepare(
    `SELECT r.*, rb.created_at as bookmarked_at,
      (SELECT COUNT(*) FROM repo_follows WHERE repo_id = r.id) as follower_count,
      (SELECT COUNT(*) FROM repo_bookmarks WHERE repo_id = r.id) as bookmark_count
    FROM repo_bookmarks rb JOIN repositories r ON r.id = rb.repo_id WHERE rb.user_id = ? ORDER BY rb.created_at DESC`
  ).bind(user.id).all()
  return c.json(results)
})

// ==================== Admin ====================

app.get('/api/admin/check', async (c) => {
  const user = await getUser(c)
  return c.json({ isAdmin: user ? isAdmin(c, user) : false })
})

// Admin: list all users
app.get('/api/admin/users', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdmin(c, user)) return c.json({ error: '无权访问' }, 403)

  const { search, status, email, nickname } = c.req.query()
  let sql = `SELECT u.id, u.email, u.nickname, u.avatar_url, u.created_at, u.status,
    (SELECT COUNT(*) FROM follows WHERE following_id = u.id) as follower_count,
    (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) as following_count,
    (SELECT COUNT(*) FROM repo_follows WHERE user_id = u.id) as followed_repos_count,
    (SELECT COUNT(*) FROM repo_bookmarks WHERE user_id = u.id) as bookmark_count,
    (SELECT COUNT(*) FROM repositories WHERE user_id = u.id) as repo_count
    FROM users u WHERE 1=1`
  const params: string[] = []

  if (nickname) { sql += ' AND u.nickname LIKE ?'; params.push(`%${nickname}%`) }
  if (email) { sql += ' AND u.email LIKE ?'; params.push(`%${email}%`) }
  if (status) { sql += ' AND u.status = ?'; params.push(status) }

  sql += ' ORDER BY u.created_at DESC'
  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json(results)
})

// Admin: list all repos
app.get('/api/admin/repos', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdmin(c, user)) return c.json({ error: '无权访问' }, 403)

  const { search, visibility, ownerEmail, startDate, endDate } = c.req.query()
  let sql = `SELECT r.*, u.nickname as owner_name, u.email as owner_email,
    (SELECT COUNT(*) FROM repo_follows WHERE repo_id = r.id) as follower_count,
    (SELECT COUNT(*) FROM repo_bookmarks WHERE repo_id = r.id) as bookmark_count,
    (SELECT COUNT(*) FROM repo_links WHERE repo_id = r.id) as link_count
    FROM repositories r JOIN users u ON u.id = r.user_id WHERE 1=1`
  const params: string[] = []

  if (search) { sql += ' AND r.name LIKE ?'; params.push(`%${search}%`) }
  if (visibility) { sql += ' AND r.visibility = ?'; params.push(visibility) }
  if (ownerEmail) { sql += ' AND u.email LIKE ?'; params.push(`%${ownerEmail}%`) }
  if (startDate) { sql += ' AND r.created_at >= ?'; params.push(startDate) }
  if (endDate) { sql += ' AND r.created_at <= ?'; params.push(endDate) }

  sql += ' ORDER BY r.created_at DESC'
  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json(results)
})

// Admin: disable/enable user
app.put('/api/admin/users/:id/status', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdmin(c, user)) return c.json({ error: '无权访问' }, 403)
  const { status } = await c.req.json() as { status: string }
  const targetId = c.req.param('id')
  if (targetId === user.id) return c.json({ error: '不能操作自己的账户' }, 400)
  await c.env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(status, targetId).run()
  return c.json({ success: true })
})

// Admin: delete user
async function deleteUserData(db: D1Database, userId: string) {
  const { results: ownedRepos } = await db.prepare('SELECT id FROM repositories WHERE user_id = ?').bind(userId).all()
  for (const repo of (ownedRepos as any[])) {
    const repoId = repo.id
    await db.prepare('DELETE FROM repo_links WHERE repo_id = ?').bind(repoId).run()
    await db.prepare('DELETE FROM repo_categories WHERE repo_id = ?').bind(repoId).run()
    await db.prepare('DELETE FROM repo_members WHERE repo_id = ?').bind(repoId).run()
    await db.prepare('DELETE FROM repo_follows WHERE repo_id = ?').bind(repoId).run()
    await db.prepare('DELETE FROM repo_bookmarks WHERE repo_id = ?').bind(repoId).run()
    await db.prepare('DELETE FROM repo_tags WHERE repo_id = ?').bind(repoId).run()
    await db.prepare('UPDATE user_tools SET category_id = \'\' WHERE category_id LIKE ?').bind(`follow-sc-${repoId}-%`).run()
    await db.prepare('DELETE FROM user_tools WHERE id LIKE ?').bind(`follow-${repoId}-%`).run()
    await db.prepare('DELETE FROM user_categories WHERE id LIKE ?').bind(`follow-sc-${repoId}-%`).run()
    await db.prepare('DELETE FROM repositories WHERE id = ?').bind(repoId).run()
  }

  await db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').bind(userId, userId).run()
  await db.prepare('DELETE FROM repo_follows WHERE user_id = ?').bind(userId).run()
  await db.prepare('DELETE FROM repo_bookmarks WHERE user_id = ?').bind(userId).run()
  await db.prepare('DELETE FROM repo_members WHERE user_id = ?').bind(userId).run()
  await db.prepare('DELETE FROM notifications WHERE user_id = ? OR actor_id = ?').bind(userId, userId).run()
  await db.prepare('DELETE FROM user_categories WHERE user_id = ?').bind(userId).run()
  await db.prepare('DELETE FROM user_tools WHERE user_id = ?').bind(userId).run()
  await db.prepare('DELETE FROM todos WHERE user_id = ?').bind(userId).run()
  await db.prepare('DELETE FROM user_preferences WHERE user_id = ?').bind(userId).run()
  await db.prepare('DELETE FROM user_hidden_categories WHERE user_id = ?').bind(userId).run()
  await db.prepare('DELETE FROM user_hidden_tools WHERE user_id = ?').bind(userId).run()
}

app.delete('/api/admin/users/:id', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdmin(c, user)) return c.json({ error: '无权访问' }, 403)
  const targetId = c.req.param('id')
  if (targetId === user.id) return c.json({ error: '不能删除自己的账户' }, 400)
  await deleteUserData(c.env.DB, targetId)
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run()
  return c.json({ success: true })
})

// Admin: hide/show repo
app.put('/api/admin/repos/:id/visibility', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdmin(c, user)) return c.json({ error: '无权访问' }, 403)
  const { visibility } = await c.req.json() as { visibility: string }
  const repoId = c.req.param('id')
  await c.env.DB.prepare('UPDATE repositories SET visibility = ? WHERE id = ?').bind(visibility, repoId).run()
  return c.json({ success: true })
})

// Admin: delete repo
app.delete('/api/admin/repos/:id', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdmin(c, user)) return c.json({ error: '无权访问' }, 403)
  const repoId = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM repo_links WHERE repo_id = ?').bind(repoId).run()
  await c.env.DB.prepare('DELETE FROM repo_categories WHERE repo_id = ?').bind(repoId).run()
  await c.env.DB.prepare('DELETE FROM repo_members WHERE repo_id = ?').bind(repoId).run()
  await c.env.DB.prepare('DELETE FROM repo_follows WHERE repo_id = ?').bind(repoId).run()
  await c.env.DB.prepare('DELETE FROM repo_bookmarks WHERE repo_id = ?').bind(repoId).run()
  await c.env.DB.prepare('DELETE FROM repo_tags WHERE repo_id = ?').bind(repoId).run()
  await c.env.DB.prepare('UPDATE user_tools SET category_id = \'\' WHERE category_id LIKE ?').bind(`follow-sc-${repoId}-%`).run()
  await c.env.DB.prepare('DELETE FROM user_tools WHERE id LIKE ?').bind(`follow-${repoId}-%`).run()
  await c.env.DB.prepare('DELETE FROM user_categories WHERE id LIKE ?').bind(`follow-sc-${repoId}-%`).run()
  await c.env.DB.prepare('DELETE FROM repositories WHERE id = ?').bind(repoId).run()
  return c.json({ success: true })
})

// ==================== Discover - Public repos ====================

app.get('/api/discover/repos', async (c) => {
  const currentUser = await getUser(c)
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, u.nickname as owner_name, u.avatar_url as owner_avatar,
      (SELECT COUNT(*) FROM repo_follows WHERE repo_id = r.id) as follower_count,
      (SELECT COUNT(*) FROM repo_bookmarks WHERE repo_id = r.id) as bookmark_count
    FROM repositories r
    JOIN users u ON u.id = r.user_id
    WHERE r.visibility = 'public' AND r.link_count > 0
    ORDER BY r.created_at DESC`
  ).all()

  // Add follow/bookmark status for current user
  const enriched = await Promise.all((results as any[]).map(async (repo) => {
    let is_following = false, is_bookmarked = false
    if (currentUser) {
      const [follow, bookmark] = await Promise.all([
        c.env.DB.prepare('SELECT id FROM repo_follows WHERE user_id = ? AND repo_id = ?').bind(currentUser.id, repo.id).first(),
        c.env.DB.prepare('SELECT id FROM repo_bookmarks WHERE user_id = ? AND repo_id = ?').bind(currentUser.id, repo.id).first(),
      ])
      is_following = !!follow
      is_bookmarked = !!bookmark
    }
    return { ...repo, is_following, is_bookmarked }
  }))

  return c.json(enriched)
})

// ==================== Categories CRUD ====================

app.get('/api/categories', async (c) => {
  const user = await getUser(c)
  const isAdminView = c.req.query('admin') === 'true'

  if (user && !isAdminView) {
    // 直接从用户表获取所有分类
    const { results } = await c.env.DB.prepare('SELECT * FROM user_categories WHERE user_id = ? ORDER BY sort_order, id').bind(user.id).all()
    return c.json(results)
  }

  // Admin view: return all global categories only
  if (user && isAdminView && isAdmin(c, user)) {
    const { results } = await c.env.DB.prepare('SELECT * FROM categories ORDER BY sort_order, id').all()
    return c.json(results)
  }
  const { results } = await c.env.DB.prepare('SELECT * FROM categories ORDER BY sort_order, id').all()
  return c.json(results)
})

app.post('/api/categories', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const { name, icon, parent_id, password } = await c.req.json()
  if (!name) return c.json({ error: '名称不能为空' }, 400)
  const isAdminView = c.req.query('admin') === 'true'

  if (isAdmin(c, user) && isAdminView) {
    // Admin + admin=true: create global default (at the end)
    const id = crypto.randomUUID()
    const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as max FROM categories').first() as any
    await c.env.DB.prepare('INSERT INTO categories (id, name, icon, parent_id, sort_order) VALUES (?, ?, ?, ?, ?)').bind(id, name, icon || 'Sparkles', parent_id || '', (maxOrder?.max ?? -1) + 1).run()
    const cat = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first()
    return c.json(cat, 201)
  }

  // Normal user OR admin without admin=true: create personal category
  const id = crypto.randomUUID()
  const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as max FROM user_categories WHERE user_id = ?').bind(user.id).first() as any
  await c.env.DB.prepare('INSERT INTO user_categories (id, user_id, name, icon, parent_id, sort_order, password) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, user.id, name, icon || 'Sparkles', parent_id || '', (maxOrder?.max ?? -1) + 1, password || '').run()
  const cat = await c.env.DB.prepare('SELECT * FROM user_categories WHERE id = ?').bind(id).first()
  return c.json(cat, 201)
})

app.put('/api/categories/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const id = c.req.param('id')
  const { name, icon, parent_id, password } = await c.req.json()
  const isAdminView = c.req.query('admin') === 'true'

  if (isAdmin(c, user) && isAdminView) {
    // Admin + admin=true: update global default
    if (name !== undefined) await c.env.DB.prepare('UPDATE categories SET name = ? WHERE id = ?').bind(name, id).run()
    if (icon !== undefined) await c.env.DB.prepare('UPDATE categories SET icon = ? WHERE id = ?').bind(icon, id).run()
    if (parent_id !== undefined) await c.env.DB.prepare('UPDATE categories SET parent_id = ? WHERE id = ?').bind(parent_id, id).run()
    const updated = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first()
    return c.json(updated)
  }

  // Normal user OR admin without admin=true: 直接更新用户自己的分类
  if (name !== undefined) await c.env.DB.prepare('UPDATE user_categories SET name = ? WHERE id = ? AND user_id = ?').bind(name, id, user.id).run()
  if (icon !== undefined) await c.env.DB.prepare('UPDATE user_categories SET icon = ? WHERE id = ? AND user_id = ?').bind(icon, id, user.id).run()
  if (parent_id !== undefined) await c.env.DB.prepare('UPDATE user_categories SET parent_id = ? WHERE id = ? AND user_id = ?').bind(parent_id, id, user.id).run()
  if (password !== undefined) await c.env.DB.prepare('UPDATE user_categories SET password = ? WHERE id = ? AND user_id = ?').bind(password, id, user.id).run()
  const updated = await c.env.DB.prepare('SELECT * FROM user_categories WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  return c.json(updated || {})
})

app.delete('/api/categories/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const id = c.req.param('id')
  const isAdminView = c.req.query('admin') === 'true'

  if (isAdmin(c, user) && isAdminView) {
    // Admin + admin=true: actually delete global
    await c.env.DB.prepare('DELETE FROM tools WHERE category_id = ?').bind(id).run()
    await c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  }

  // 直接删除用户自己的分类和里面的链接
  await c.env.DB.prepare('DELETE FROM user_tools WHERE category_id = ? AND user_id = ?').bind(id, user.id).run()
  await c.env.DB.prepare('DELETE FROM user_categories WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true })
})

// Reorder categories
app.put('/api/categories/reorder', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const { order } = await c.req.json() as { order: { id: string; sort_order: number }[] }
  if (!order) return c.json({ error: '无效参数' }, 400)
  const isAdminView = c.req.query('admin') === 'true'
  const db = c.env.DB

  if (isAdmin(c, user) && isAdminView) {
    // Admin + admin=true: update global categories only
    const tx = db.batch(order.map(o => 
      db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?').bind(o.sort_order, o.id)
    ))
    await tx
  } else {
    // Normal user or admin without admin=true: update user_categories only
    const tx = db.batch(order.map(o => 
      db.prepare('UPDATE user_categories SET sort_order = ? WHERE id = ? AND user_id = ?').bind(o.sort_order, o.id, user.id)
    ))
    await tx
  }
  return c.json({ success: true })
})

// ==================== Tools CRUD ====================

app.get('/api/tools', async (c) => {
  const user = await getUser(c)
  const categoryId = c.req.query('categoryId')
  const search = c.req.query('search')
  const isAdminView = c.req.query('admin') === 'true'

  if (user && !isAdminView) {
    // 直接从用户表获取所有工具
    let sql = 'SELECT * FROM user_tools WHERE user_id = ?'
    const params: string[] = [user.id]

    if (search) {
      sql += ' AND (LOWER(name) LIKE ? OR LOWER(desc) LIKE ?)'
      const term = `%${search.toLowerCase()}%`
      params.push(term, term)
    } else if (categoryId) {
      sql += ' AND category_id = ?'
      params.push(categoryId)
    }

    sql += ' ORDER BY sort_order ASC, created_at ASC'
    const { results } = await c.env.DB.prepare(sql).bind(...params).all()
    c.header('Cache-Control', 'no-store, max-age=0')
    return c.json(results)
  }

  // Admin view or unauthenticated: return global tools
  let query = 'SELECT * FROM tools'
  const params: string[] = []

  if (search) {
    query += ' WHERE LOWER(name) LIKE ? OR LOWER(desc) LIKE ?'
    const term = `%${search.toLowerCase()}%`
    params.push(term, term)
  } else if (categoryId) {
    query += ' WHERE category_id = ?'
    params.push(categoryId)
  }

  query += ' ORDER BY sort_order ASC, created_at ASC'
  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  return c.json(results)
})

app.post('/api/tools', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const { name, url, desc, category_id, icon, bg_color, text_color, password } = await c.req.json()
  if (!name || !url) return c.json({ error: '名称和地址不能为空' }, 400)
  const id = crypto.randomUUID()
  const isAdminView = c.req.query('admin') === 'true'

  if (isAdmin(c, user) && isAdminView) {
    // Admin + admin=true: create global default
    const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as max FROM tools WHERE category_id = ?').bind(category_id || '').first() as any
    await c.env.DB.prepare('INSERT INTO tools (id, name, url, desc, category_id, icon, bg_color, text_color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, name, url, desc || '', category_id || '', icon || '', bg_color || '', text_color || '', (maxOrder?.max ?? -1) + 1).run()
    const tool = await c.env.DB.prepare('SELECT * FROM tools WHERE id = ?').bind(id).first()
    return c.json(tool, 201)
  }

  // Normal user OR admin without admin=true: create personal tool
  const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as max FROM user_tools WHERE user_id = ? AND category_id = ?').bind(user.id, category_id || '').first() as any
  await c.env.DB.prepare('INSERT INTO user_tools (id, user_id, name, url, desc, category_id, icon, bg_color, text_color, sort_order, viewed, password) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)').bind(id, user.id, name, url, desc || '', category_id || '', icon || '', bg_color || '', text_color || '', (maxOrder?.max ?? -1) + 1, password || '').run()
  const tool = await c.env.DB.prepare('SELECT * FROM user_tools WHERE id = ?').bind(id).first()
  return c.json(tool, 201)
})

// Reorder tools (MUST be before /api/tools/:id to avoid route conflict)
app.put('/api/tools/reorder', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const { order } = await c.req.json() as { order: { id: string; sort_order: number }[] }
  if (!order) return c.json({ error: '无效参数' }, 400)
  const isAdminView = c.req.query('admin') === 'true'
  const db = c.env.DB

  if (isAdmin(c, user) && isAdminView) {
    // Admin + admin=true: update global tools only
    const tx = db.batch(order.map(o => 
      db.prepare('UPDATE tools SET sort_order = ? WHERE id = ?').bind(o.sort_order, o.id)
    ))
    await tx
  } else {
    // Normal user or admin without admin=true: update user_tools only
    const tx = db.batch(order.map(o => 
      db.prepare('UPDATE user_tools SET sort_order = ? WHERE id = ? AND user_id = ?').bind(o.sort_order, o.id, user.id)
    ))
    await tx
  }
  return c.json({ success: true })
})

app.put('/api/tools/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const id = c.req.param('id')
  const { name, url, desc, category_id, icon, bg_color, text_color, password } = await c.req.json()
  const isAdminView = c.req.query('admin') === 'true'

  if (isAdmin(c, user) && isAdminView) {
    // Admin + admin=true: update global default
    if (name !== undefined) await c.env.DB.prepare('UPDATE tools SET name = ? WHERE id = ?').bind(name, id).run()
    if (url !== undefined) await c.env.DB.prepare('UPDATE tools SET url = ? WHERE id = ?').bind(url, id).run()
    if (desc !== undefined) await c.env.DB.prepare('UPDATE tools SET desc = ? WHERE id = ?').bind(desc, id).run()
    if (category_id !== undefined) await c.env.DB.prepare('UPDATE tools SET category_id = ? WHERE id = ?').bind(category_id, id).run()
    if (icon !== undefined) await c.env.DB.prepare('UPDATE tools SET icon = ? WHERE id = ?').bind(icon, id).run()
    if (bg_color !== undefined) await c.env.DB.prepare('UPDATE tools SET bg_color = ? WHERE id = ?').bind(bg_color, id).run()
    if (text_color !== undefined) await c.env.DB.prepare('UPDATE tools SET text_color = ? WHERE id = ?').bind(text_color, id).run()
    const updated = await c.env.DB.prepare('SELECT * FROM tools WHERE id = ?').bind(id).first()
    return c.json(updated)
  }

  // Normal user OR admin without admin=true: 直接更新用户自己的工具
  if (name !== undefined) await c.env.DB.prepare('UPDATE user_tools SET name = ? WHERE id = ? AND user_id = ?').bind(name, id, user.id).run()
  if (url !== undefined) await c.env.DB.prepare('UPDATE user_tools SET url = ? WHERE id = ? AND user_id = ?').bind(url, id, user.id).run()
  if (desc !== undefined) await c.env.DB.prepare('UPDATE user_tools SET desc = ? WHERE id = ? AND user_id = ?').bind(desc, id, user.id).run()
  if (category_id !== undefined) await c.env.DB.prepare('UPDATE user_tools SET category_id = ? WHERE id = ? AND user_id = ?').bind(category_id, id, user.id).run()
  if (icon !== undefined) await c.env.DB.prepare('UPDATE user_tools SET icon = ? WHERE id = ? AND user_id = ?').bind(icon, id, user.id).run()
  if (bg_color !== undefined) await c.env.DB.prepare('UPDATE user_tools SET bg_color = ? WHERE id = ? AND user_id = ?').bind(bg_color, id, user.id).run()
  if (text_color !== undefined) await c.env.DB.prepare('UPDATE user_tools SET text_color = ? WHERE id = ? AND user_id = ?').bind(text_color, id, user.id).run()
  if (password !== undefined) await c.env.DB.prepare('UPDATE user_tools SET password = ? WHERE id = ? AND user_id = ?').bind(password, id, user.id).run()
  const updated = await c.env.DB.prepare('SELECT * FROM user_tools WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  return c.json(updated || {})
})

app.delete('/api/tools/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const id = c.req.param('id')
  const isForce = c.req.query('force') === 'true'
  const isAdminView = c.req.query('admin') === 'true'

  if (isAdmin(c, user) && isAdminView && isForce) {
    // Admin + admin=true + force: delete global default
    await c.env.DB.prepare('DELETE FROM tools WHERE id = ?').bind(id).run()
    await c.env.DB.prepare('DELETE FROM bookmarks WHERE tool_id = ?').bind(id).run()
    return c.json({ success: true })
  }

  // 直接删除用户自己的工具
  await c.env.DB.prepare('DELETE FROM user_tools WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true })
})

// Mark tool as viewed
app.post('/api/tools/:id/view', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE user_tools SET viewed = 1 WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true })
})

// Track tool click (increment click_count)
app.post('/api/tools/:id/click', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE user_tools SET click_count = COALESCE(click_count, 0) + 1 WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true })
})

// Tool Bookmarks (existing) ====================

// ==================== Favicon Cache ====================

const FAVICON_CACHE = 'favicons'

/** Simple domain hash for R2 key */
function domainKey(url: string): string {
  try {
    const domain = new URL(url).hostname.replace(/^www\./, '')
    // Use hex-encoded domain as key — safe for R2
    return [...domain].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  } catch { return '' }
}

app.post('/api/favicon', async (c) => {
  const { url } = await c.req.json() as { url: string }
  if (!url) return c.json({ error: '需要 url' }, 400)

  const key = domainKey(url)
  if (!key) return c.json({ error: '无效域名' }, 400)

  const r2Key = `${FAVICON_CACHE}/${key}.png`

  // Check R2 cache
  const existing = await c.env.R2.get(r2Key)
  if (existing) {
    return c.json({ icon_url: `/api/favicon-img/${key}.png` })
  }

  // Fetch from Google S2
  try {
    const domain = new URL(url).hostname
    const googleUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
    const resp = await fetch(googleUrl)
    if (resp.ok) {
      const buffer = await resp.arrayBuffer()
      await c.env.R2.put(r2Key, buffer, { httpMetadata: { contentType: 'image/png' } })
      return c.json({ icon_url: `/api/favicon-img/${key}.png` })
    }
  } catch { /* Google fallback below */ }

  // Fallback: try to fetch favicon directly from the domain
  try {
    const domain = new URL(url).hostname
    const directUrl = `https://${domain}/favicon.ico`
    const resp = await fetch(directUrl)
    if (resp.ok) {
      const buffer = await resp.arrayBuffer()
      await c.env.R2.put(r2Key, buffer, { httpMetadata: { contentType: 'image/x-icon' } })
      return c.json({ icon_url: `/api/favicon-img/${key}.png` })
    }
  } catch { /* no favicon available */ }

  return c.json({ icon_url: '' })
})

app.get('/api/favicon-img/:key', async (c) => {
  const key = c.req.param('key')
  const obj = await c.env.R2.get(`${FAVICON_CACHE}/${key}`)
  if (!obj) return c.json({ error: '未找到' }, 404)
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/png',
      'Cache-Control': 'public, max-age=31536000',
    },
  })
})

app.get('/api/bookmarks', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT t.*, b.id as bookmark_id, b.created_at as bookmarked_at FROM bookmarks b JOIN tools t ON t.id = b.tool_id ORDER BY b.created_at DESC'
  ).all()
  return c.json(results)
})

app.post('/api/bookmarks/tool/:toolId', async (c) => {
  const toolId = c.req.param('toolId')
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO bookmarks (id, tool_id) VALUES (?, ?)').bind(id, toolId).run()
  return c.json({ success: true, id })
})

app.delete('/api/bookmarks/tool/:toolId', async (c) => {
  const toolId = c.req.param('toolId')
  await c.env.DB.prepare('DELETE FROM bookmarks WHERE tool_id = ?').bind(toolId).run()
  return c.json({ success: true })
})

// ==================== Discover Columns (existing) ====================

app.get('/api/discover', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM discover_columns ORDER BY id').all()
  return c.json(results)
})

// ==================== Todos ====================

app.get('/api/todos', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const { results } = await c.env.DB.prepare('SELECT * FROM todos WHERE user_id = ? ORDER BY is_completed ASC, created_at DESC').bind(user.id).all()
  return c.json(results)
})

app.post('/api/todos', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const { content } = await c.req.json() as { content: string }
  if (!content?.trim()) return c.json({ error: '内容不能为空' }, 400)
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO todos (id, user_id, content) VALUES (?, ?, ?)').bind(id, user.id, content.trim()).run()
  const todo = await c.env.DB.prepare('SELECT * FROM todos WHERE id = ?').bind(id).first()
  return c.json(todo, 201)
})

app.put('/api/todos/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const id = c.req.param('id')
  const todo = await c.env.DB.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!todo) return c.json({ error: '待办事项不存在' }, 404)
  const { is_completed, content } = await c.req.json() as { is_completed?: number; content?: string }
  if (content !== undefined) await c.env.DB.prepare('UPDATE todos SET content = ? WHERE id = ?').bind(content.trim(), id).run()
  if (is_completed !== undefined) await c.env.DB.prepare('UPDATE todos SET is_completed = ? WHERE id = ?').bind(is_completed, id).run()
  const updated = await c.env.DB.prepare('SELECT * FROM todos WHERE id = ?').bind(id).first()
  return c.json(updated)
})

app.delete('/api/todos/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const id = c.req.param('id')
  const todo = await c.env.DB.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!todo) return c.json({ error: '待办事项不存在' }, 404)
  await c.env.DB.prepare('DELETE FROM todos WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

 // ==================== Stock Proxy ====================
 
 app.get('/api/stock/quote', async (c) => {
   const symbols = c.req.query('symbols')
   if (!symbols) return c.json({ error: 'Missing symbols' }, 400)
 
  try {
     const hdrs = {
       'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
       'Accept': 'application/json,text/plain,*/*',
       'Referer': 'https://finance.yahoo.com/',
       'Origin': 'https://finance.yahoo.com',
     }
     const v7res = await fetch('https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(symbols), { headers: hdrs })
     if (v7res.ok) {
       const v7data: any = await v7res.json()
       if (v7data?.quoteResponse?.result?.length) return c.json(v7data)
     }
     // Fallback: v8 chart for each symbol
     const results: any[] = []
     for (const sym of symbols.split(',').map((s: string) => s.trim()).filter(Boolean)) {
       try {
         const chart = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?interval=1d&range=2d', { headers: hdrs })
         if (!chart.ok) continue
         const d: any = await chart.json()
         const m = d?.chart?.result?.[0]?.meta
         if (!m) continue
         const prev = m.chartPreviousClose
         const price = m.regularMarketPrice
         results.push({
           symbol: m.symbol || sym, shortName: m.shortName || '', longName: m.longName || '',
           regularMarketPrice: price, regularMarketChange: price - prev,
           regularMarketChangePercent: prev ? ((price - prev) / prev) * 100 : 0,
           regularMarketPreviousClose: prev, currency: m.currency || 'USD',
           marketState: m.currentTradingPeriod?.regular?.start ? 'REGULAR' : 'CLOSED',
         })
       } catch {}
     }
     return c.json({ quoteResponse: { result: results } })
  } catch {
    return c.json({ quoteResponse: { result: [] } })
 }
})

// ==================== Gold Price Proxy ====================

app.get('/api/gold/price', async (c) => {
  try {
    const hdrs = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json,text/plain,*/*',
      'Referer': 'https://finance.yahoo.com/',
      'Origin': 'https://finance.yahoo.com',
    }
    // Fetch gold futures and USD/CNY exchange rate in parallel
    const [goldRes, fxRes] = await Promise.all([
      fetch('https://query1.finance.yahoo.com/v7/finance/quote?symbols=GC%3DF', { headers: hdrs }),
      fetch('https://query1.finance.yahoo.com/v7/finance/quote?symbols=CNY%3DX', { headers: hdrs }),
    ])
    let usdCnyRate = 7.25  // fallback rate
    if (fxRes.ok) {
      const fxData: any = await fxRes.json()
      if (fxData?.quoteResponse?.result?.length) {
        usdCnyRate = fxData.quoteResponse.result[0].regularMarketPrice || usdCnyRate
      }
    }
    if (goldRes.ok) {
      const data: any = await goldRes.json()
      if (data?.quoteResponse?.result?.length) {
        const gold = data.quoteResponse.result[0]
        const cnyPerGram = (gold.regularMarketPrice / 31.1034768) * usdCnyRate
        return c.json({
          quoteResponse: {
            result: [{ ...gold, cnyPerGram: Math.round(cnyPerGram * 100) / 100 }]
          }
        })
      }
    }
    // Fallback: v8 chart for gold only
    const chart = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=2d', { headers: hdrs })
    if (!chart.ok) return c.json({ error: 'Failed' }, 500)
    const d: any = await chart.json()
    const m = d?.chart?.result?.[0]?.meta
    if (!m) return c.json({ error: 'No data' }, 500)
    const prev = m.chartPreviousClose
    const price = m.regularMarketPrice
    const cnyPerGram = Math.round(((price / 31.1034768) * usdCnyRate) * 100) / 100
    return c.json({
      quoteResponse: {
        result: [{
          symbol: 'GC=F',
          shortName: 'Gold Futures',
          longName: 'Gold Futures',
          regularMarketPrice: price,
          regularMarketChange: price - prev,
          regularMarketChangePercent: prev ? ((price - prev) / prev) * 100 : 0,
          regularMarketPreviousClose: prev,
          currency: 'USD',
          marketState: 'REGULAR',
          cnyPerGram: cnyPerGram,
        }]
      }
    })
  } catch {
    return c.json({ error: 'Failed' }, 500)
  }
})

app.get('/api/stock/search', async (c) => {
   const q = c.req.query('q')
   if (!q) return c.json({ error: 'Missing query' }, 400)
 
   try {
     const searchQuery = /^\d+$/.test(q) ? q + '.HK' : q
     const [usRes, hkRes] = await Promise.all([
       fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(searchQuery)}&lang=en-US&region=US`, {
         headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
       }),
       fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(searchQuery)}&lang=en-US&region=HK`, {
         headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
       }),
     ])
     const usData: any = await usRes.json()
     const hkData: any = await hkRes.json()
     const seen = new Set<string>()
     const merged = [...(usData.quotes || []), ...(hkData.quotes || [])].filter((r: any) => {
       if (seen.has(r.symbol)) return false
       seen.add(r.symbol)
       return true
     })
     return c.json({ quotes: merged })
   } catch {
     return c.json({ quotes: [] })
   }
 })
 
 // ==================== Health ====================

app.get('/api/health', (c) => {
  c.header('Cache-Control', 'no-store, max-age=0')
  return c.json({ status: 'ok', service: 'linkpad' })
})


// Google Search Console 验证文件（run_worker_first 使其绕过 assets 的 .html 重定向）
app.get('/googlefe93a97deb0e3b06.html', (c) =>
  c.text('google-site-verification: googlefe93a97deb0e3b06.html')
)

// ---------- SEO / GEO ----------

// XML / HTML 属性转义
const escXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

// datetime('now') 格式（UTC）转 W3C 时间；无效则返回 null
const toW3c = (s: any): string | null => {
  if (!s || typeof s !== 'string') return null
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
  return isNaN(d.getTime()) ? null : d.toISOString()
}

// sitemap：静态页 + 全部公开仓库（动态查询，新建仓库自动进入）
app.get('/sitemap.xml', async (c) => {
  const base = 'https://linkpad.site'
  const url = (loc: string, lastmod: string | null, changefreq: string, priority: string) =>
    `  <url>\n    <loc>${escXml(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`
  const entries = [
    url(`${base}/`, null, 'daily', '1.0'),
    url(`${base}/discover`, null, 'daily', '0.9'),
  ]
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT id, updated_at FROM repositories WHERE visibility = 'public' ORDER BY updated_at DESC LIMIT 5000`
    ).all()
    for (const r of results as any[]) {
      entries.push(url(`${base}/repo/${encodeURIComponent(r.id)}`, toW3c(r.updated_at), 'daily', '0.8'))
    }
  } catch (e) {
    console.error('[sitemap] query failed:', e)
  }
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>`,
    200,
    { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
  )
})

// 仓库详情页 SSR meta：AI/GEO 爬虫不执行 JS，meta 必须直接写在 HTML 里
app.get('/repo/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const repo = await c.env.DB.prepare(
      `SELECT r.name, r.description, r.visibility, r.updated_at, r.link_count, u.nickname AS owner_name
       FROM repositories r LEFT JOIN users u ON u.id = r.user_id WHERE r.id = ?`
    ).bind(id).first() as any

    const indexRes = await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url).toString()))
    if (indexRes.status !== 200) return c.notFound()
    let html = await indexRes.text()

    // 仓库不存在：404 + noindex（浏览器仍渲染 SPA 的错误视图）
    if (!repo) {
      html = html.replace('</title>', '</title>\n    <meta name="robots" content="noindex, nofollow" />')
      return c.html(html, 404)
    }

    // 私有/密码保护仓库：禁止索引
    if (repo.visibility !== 'public') {
      html = html.replace('</title>', '</title>\n    <meta name="robots" content="noindex, nofollow" />')
      return c.html(html)
    }

    const pageUrl = `https://linkpad.site/repo/${encodeURIComponent(id)}`
    const name = repo.name || '未命名仓库'
    const desc = (repo.description || `${repo.owner_name || 'TA'} 收藏整理的链接仓库「${name}」，共 ${repo.link_count ?? 0} 个链接。收藏好链接，分享好品味。`).slice(0, 200)
    const lastmod = toW3c(repo.updated_at)
    const meta = [
      `<title>${escXml(name)} - LinkPad 链接仓库</title>`,
      `<meta name="description" content="${escXml(desc)}" />`,
      `<link rel="canonical" href="${pageUrl}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:title" content="${escXml(name)} - LinkPad 链接仓库" />`,
      `<meta property="og:description" content="${escXml(desc)}" />`,
      `<meta property="og:url" content="${pageUrl}" />`,
      `<meta property="og:site_name" content="LinkPad" />`,
      `<meta property="og:image" content="https://linkpad.site/logo.png" />`,
      `<meta name="twitter:card" content="summary" />`,
      lastmod ? `<meta property="og:updated_time" content="${lastmod}" />` : '',
      `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name,
        description: repo.description || undefined,
        url: pageUrl,
        isPartOf: { '@type': 'WebSite', name: 'LinkPad', url: 'https://linkpad.site/' },
        author: repo.owner_name ? { '@type': 'Person', name: repo.owner_name } : undefined,
        dateModified: lastmod || undefined,
      })}</script>`,
    ].filter(Boolean).join('\n    ')

    // 用函数替换，避免 meta 内容中的 $ 序列被解释为替换模式
    html = html.replace(/<title>.*?<\/title>/s, () => meta)
    return c.html(html)
  } catch (e) {
    console.error('[repo-meta] failed:', c.req.path, e)
    // 出错时回退普通 SPA 页面
    const res = await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url).toString()))
    if (res.status === 200) {
      return new Response(res.body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    return c.notFound()
  }
})

// Catch-all: serve static assets through Worker to control iframe headers
app.get('/*', async (c) => {
  // 未匹配的 API 路径返回 404 JSON，而不是 SPA 页面
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404)
  try {
    let response = await c.env.ASSETS.fetch(c.req.raw)
    // SPA 回退：非静态资源路径（如 /repo/:id、/user/:id 直接访问）返回 index.html
    if (response.status === 404) {
      const indexRes = await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url).toString()))
      if (indexRes.status === 200) response = indexRes
    }
    const headers = new Headers(response.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    // Prevent caching of HTML to ensure users get the latest version
    if (response.headers.get('content-type')?.includes('text/html')) {
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
      headers.set('Pragma', 'no-cache')
      headers.set('Expires', '0')
    }
    headers.delete('X-Frame-Options')
    const csp = headers.get('Content-Security-Policy')
    if (csp) {
      headers.set('Content-Security-Policy', csp.replace(/frame-ancestors\s+[^;]+;?/g, ''))
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch (e) {
    console.error('[catch-all] ASSETS.fetch failed:', c.req.path, e)
    return c.notFound()
  }
})

export default app
