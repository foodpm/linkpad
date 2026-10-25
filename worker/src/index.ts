// LinkPad — Cloudflare Worker API v2
import { Hono } from 'hono'
import { cors } from 'hono/cors'
// @ts-ignore — cloudflare:email 由 workerd 运行时提供
import { EmailMessage } from 'cloudflare:email'
import { launch } from '@cloudflare/puppeteer'
import { type Lang, htmlLang, apiLang, interpolate, WORKER_EN, T } from './i18n'

type SendEmailBinding = {
  send: (message: EmailMessage) => Promise<void>
}

// 速率限制绑定（wrangler.toml [[unsafe.bindings]]）
type RateLimitBinding = {
  limit: (opts: { key: string }) => Promise<{ success: boolean }>
}

type Bindings = {
  DB: D1Database
  R2: R2Bucket
  ASSETS: Fetcher
  JWT_SECRET: string
  ADMIN_EMAIL: string
  SEND_EMAIL: SendEmailBinding
  BROWSER: unknown
  PREVIEW_RL: RateLimitBinding
  EXTENSION_RL: RateLimitBinding
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
}

type User = {
  id: string
  email: string
  nickname: string
  avatar_url: string
}

type ActivityAction =
  | 'extension_install'
  | 'extension_use'
  | 'profile_update'
  | 'repo_create'
  | 'repo_update'
  | 'category_create'
  | 'category_update'
  | 'link_create'
  | 'link_update'
  | 'link_move'
  | 'link_click'
  | 'follow_user'
  | 'follow_repo'
  | 'bookmark_repo'
  | 'widget_update'

type ActivityEvent = 'page_view' | 'scroll' | 'click' | 'search' | 'auth'

const app = new Hono<{ Bindings: Bindings; Variables: { lang: Lang } }>()

app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json({ error: err.message || 'Internal Server Error' }, 500)
})

// API 语言解析：X-Lang 头（前端携带用户选择）> Accept-Language > zh
app.use('/api/*', async (c, next) => {
  c.set('lang', apiLang(c.req.header('accept-language') ?? null, c.req.header('x-lang') ?? null))
  await next()
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

// A link can belong to several categories; table storage is id-based, while
// repo category storage remains name-based for compatibility with old data.
function normalizeCategoryIds(input: any): string[] {
  if (Array.isArray(input)) return [...new Set(input.map((v: any) => String(v)).filter(Boolean))]
  if (typeof input === 'string') return input ? [input] : []
  return []
}

// Resolve every repo category a link belongs to. `category_id` remains the
// primary category for sorting, duplicate display and older clients.
async function getRepoCategoryIds(db: D1Database, repoId: string, linkIds: string[]): Promise<Record<string, string[]>> {
  const map: Record<string, string[]> = {}
  if (linkIds.length === 0) return map
  const placeholders = linkIds.map(() => '?').join(',')
  const { results } = await db.prepare(
    `SELECT a.link_id, a.category_id, a.sort_order
     FROM link_category_assignments a
     JOIN repo_links l ON l.id = a.link_id
     WHERE l.repo_id = ? AND a.link_id IN (${placeholders})
     ORDER BY a.sort_order ASC, a.rowid ASC`
  ).bind(repoId, ...linkIds).all()
  for (const row of (results || []) as any[]) {
    (map[row.link_id] ||= []).push(row.category_id)
  }
  return map
}

async function replaceRepoCategoryAssignments(db: D1Database, linkId: string, categories: string[]) {
  await db.prepare('DELETE FROM link_category_assignments WHERE link_id = ?').bind(linkId).run()
  if (categories.length === 0) return
  await db.batch(categories.map((category, index) => db.prepare(
    'INSERT INTO link_category_assignments (link_id, category_id, sort_order) VALUES (?, ?, ?)'
  ).bind(linkId, category, index)))
}

// “有动作”统一以服务端成功写入的时间为准。只记录第一次活跃，后续只刷新最近活跃。
async function markUserActive(db: D1Database, userId: string) {
  try {
    await db.prepare(
      `UPDATE users
       SET first_active_at = COALESCE(first_active_at, datetime('now')),
           last_active_at = datetime('now')
       WHERE id = ?`
    ).bind(userId).run()
  } catch (err) {
    // Tracking must never make sign-in or product actions fail.
    console.error('Activity timestamp update failed:', err)
  }
}

async function recordActivity(c: any, user: User, action: ActivityAction) {
  try {
    await markUserActive(c.env.DB, user.id)
    console.log(JSON.stringify({ event: 'user_action', userId: user.id, action }))
  } catch (err) {
    // 埋点失败不能影响主业务请求
    console.error('Activity tracking failed:', err)
  }
}

// One aggregate row per user per Beijing day keeps UV exact without storing
// high-volume click/scroll event rows.
async function recordDailyActivity(
  db: D1Database,
  userId: string,
  event: ActivityEvent,
  count = 1
) {
  const pv = Math.max(1, Math.min(200, Math.trunc(count) || 1))
  const column = {
    page_view: 'page_views',
    scroll: 'scrolls',
    click: 'clicks',
    search: 'searches',
    auth: 'auths',
  }[event]

  try {
    await db.prepare(
      `INSERT INTO user_daily_activity (
         user_id, activity_date, pv, ${column}, first_seen_at, last_seen_at
       ) VALUES (?, date('now', '+8 hours'), ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(user_id, activity_date) DO UPDATE SET
         pv = user_daily_activity.pv + excluded.pv,
         ${column} = user_daily_activity.${column} + excluded.${column},
         last_seen_at = datetime('now')`
    ).bind(userId, pv, pv).run()
    await markUserActive(db, userId)
  } catch (err) {
    // Analytics failures must never break product interactions.
    console.error('Daily activity tracking failed:', err)
  }
}

// 批量计数：对当前页主键做 IN 点查（走既有索引），返回 id→count 映射
// 用于管理后台列表的展示性 COUNT，避免关联子查询进入主查询物化
async function countBy(db: D1Database, sql: string, ids: string[]): Promise<Record<string, number>> {
  const m: Record<string, number> = {}
  if (!ids.length) return m
  const { results } = await db.prepare(sql).bind(...ids).all()
  for (const r of results as any[]) m[r.id] = r.n
  return m
}

async function hmacSign(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// URL 归一化：忽略协议、www 前缀、大小写与末尾斜杠，用于重复链接比对
function normalizeUrl(u: string): string {
  return (u || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
}

// 提取域名（基于 normalizeUrl：去协议/www 后取第一段路径之前的部分），用于同域名兜底查重
function urlDomain(u: string): string {
  const n = normalizeUrl(u)
  const idx = n.indexOf('/')
  return idx === -1 ? n : n.slice(0, idx)
}

// ==================== Email Sending ====================

async function sendEmail(env: { SEND_EMAIL?: SendEmailBinding }, to: string, subject: string, text: string, html: string) {
  if (!env.SEND_EMAIL) throw new Error('SEND_EMAIL binding not configured')
  const from = 'noreply@linkpad.site'
  const b64 = (s: string) => {
    const bytes = new TextEncoder().encode(s)
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return btoa(bin)
  }
  const boundary = '----=_LinkPad_' + crypto.randomUUID().replace(/-/g, '')
  const raw = [
    `From: LinkPad <${from}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html),
    `--${boundary}--`,
    '',
  ].join('\r\n')
  await env.SEND_EMAIL.send(new EmailMessage(from, to, raw))
}

// ==================== Auth Routes ====================

// 新用户初始化：复制所有全局分类和链接到用户表
async function seedNewUser(db: D1Database, userId: string) {
  const { results: globalCats } = await db.prepare('SELECT * FROM categories ORDER BY sort_order ASC').all()
  const idMapping: Record<string, string> = {}
  for (const cat of (globalCats as any[])) {
    const newId = crypto.randomUUID()
    idMapping[cat.id] = newId
    await db.prepare('INSERT INTO user_categories (id, user_id, name, icon, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)').bind(
      newId, userId, cat.name, cat.icon, null, cat.sort_order
    ).run()
  }

  // 第二次更新 parent_id（因为之前是 null，现在需要指向新的 id）
  for (const cat of (globalCats as any[])) {
    if (cat.parent_id) {
      const newParentId = idMapping[cat.parent_id]
      const newCatId = idMapping[cat.id]
      await db.prepare('UPDATE user_categories SET parent_id = ? WHERE id = ?').bind(newParentId, newCatId).run()
    }
  }

  // 复制所有全局链接到用户表
  const { results: globalTools } = await db.prepare('SELECT * FROM tools ORDER BY sort_order ASC').all()
  for (const tool of (globalTools as any[])) {
    const newId = crypto.randomUUID()
    const newCatId = idMapping[tool.category_id]
    await db.prepare(`INSERT INTO user_tools (id, user_id, name, url, desc, category_id, icon, bg_color, text_color, sort_order, viewed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).bind(
        newId, userId, tool.name, tool.url, tool.desc, newCatId, tool.icon, tool.bg_color, tool.text_color, tool.sort_order
      ).run()
  }
}

app.post('/api/auth/register', async (c) => {
  const { email, password, nickname } = await c.req.json()
  if (!email || !password) return c.json({ error: T(c, '邮箱和密码不能为空') }, 400)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: T(c, '邮箱格式不正确') }, 400)
  if (password.length < 6) return c.json({ error: T(c, '密码至少6位') }, 400)

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (existing) return c.json({ error: T(c, '该邮箱已注册') }, 409)

  const id = crypto.randomUUID()
  const hash = await hashPassword(password, c.env.JWT_SECRET)
  const nick = nickname || email.split('@')[0]

  await c.env.DB.prepare('INSERT INTO users (id, email, password_hash, nickname) VALUES (?, ?, ?, ?)').bind(id, email, hash, nick).run()

  await seedNewUser(c.env.DB, id)
  await recordDailyActivity(c.env.DB, id, 'auth')

  const token = await signJWT({ sub: id, email }, c.env.JWT_SECRET)
  return c.json({ token, user: { id, email, nickname: nick, avatar_url: '' } })
})

app.post('/api/auth/login', async (c) => {
  const { email, password } = await c.req.json()
  if (!email || !password) return c.json({ error: T(c, '请输入邮箱和密码') }, 400)

  const user = await c.env.DB.prepare('SELECT id, email, nickname, avatar_url, password_hash, status FROM users WHERE email = ?').bind(email).first() as any
  if (!user) return c.json({ error: T(c, '邮箱未注册') }, 401)
  if (user.status === 'disabled') return c.json({ error: T(c, '账户已被禁用') }, 403)

  const hash = await hashPassword(password, c.env.JWT_SECRET)
  if (hash !== user.password_hash) return c.json({ error: T(c, '密码错误') }, 401)

  await recordDailyActivity(c.env.DB, user.id, 'auth')
  const token = await signJWT({ sub: user.id, email: user.email }, c.env.JWT_SECRET)
  return c.json({ token, user: { id: user.id, email: user.email, nickname: user.nickname, avatar_url: user.avatar_url } })
})

app.get('/api/auth/me', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  return c.json(user)
})

// ==================== Activity & Extension Tracking ====================

app.post('/api/activity/heartbeat', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  await recordDailyActivity(c.env.DB, user.id, 'page_view')
  return c.json({ success: true })
})

app.post('/api/activity/events', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

  const body = await c.req.json().catch(() => ({})) as { events?: Record<string, unknown> }
  const allowed: ActivityEvent[] = ['page_view', 'scroll', 'click', 'search', 'auth']
  const counts = allowed.map(event => {
    const raw = Number(body.events?.[event])
    return Number.isFinite(raw) ? Math.max(0, Math.min(200, Math.trunc(raw))) : 0
  })

  if (!counts.some(Boolean)) return c.json({ success: true })
  await Promise.all(allowed.map((event, i) => (
    counts[i] ? recordDailyActivity(c.env.DB, user.id, event, counts[i]) : Promise.resolve()
  )))
  return c.json({ success: true })
})

app.post('/api/extension/track', async (c) => {
  if (c.env.EXTENSION_RL) {
    const ip = c.req.header('CF-Connecting-IP') || 'unknown'
    const { success } = await c.env.EXTENSION_RL.limit({ key: `extension:${ip}` })
    if (!success) return c.json({ error: T(c, '请求过于频繁') }, 429)
  }

  const body = await c.req.json().catch(() => ({})) as {
    install_id?: string
    event?: string
    version?: string
  }
  const installId = String(body.install_id || '').trim()
  const event = body.event === 'install' || body.event === 'use' || body.event === 'link'
    ? body.event
    : ''
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(installId) || !event) {
    return c.json({ error: T(c, '无效的插件上报') }, 400)
  }

  const version = String(body.version || '').slice(0, 32)
  await c.env.DB.prepare(
    `INSERT INTO extension_installs (install_id, version, first_seen_at, last_seen_at, last_event, use_count)
     VALUES (?, ?, datetime('now'), datetime('now'), ?, ?)
     ON CONFLICT(install_id) DO UPDATE SET
       version = excluded.version,
       last_seen_at = datetime('now'),
       last_event = excluded.last_event,
       use_count = extension_installs.use_count + excluded.use_count`
  ).bind(installId, version, event, event === 'use' ? 1 : 0).run()

  const user = await getUser(c)
  if (event === 'link' && !user) return c.json({ error: T(c, '未登录') }, 401)
  if (user) {
    await c.env.DB.prepare(
      `INSERT INTO extension_user_installs (user_id, install_id, first_used_at, last_used_at)
       VALUES (?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(user_id, install_id) DO UPDATE SET last_used_at = datetime('now')`
    ).bind(user.id, installId).run()
    await recordActivity(c, user, event === 'install' ? 'extension_install' : 'extension_use')
  }
  return c.json({ success: true })
})

// ==================== Password Reset ====================

// 发送密码重置验证码
app.post('/api/auth/reset-code', async (c) => {
  const { email } = await c.req.json()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: T(c, '邮箱格式不正确') }, 400)

  const user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (!user) return c.json({ error: T(c, '该邮箱未注册') }, 404)

  // 频率限制：同一邮箱 60 秒内只能发送一次
  const now = Math.floor(Date.now() / 1000)
  const existing = await c.env.DB.prepare('SELECT created_at FROM password_reset_codes WHERE email = ?').bind(email).first() as any
  if (existing && now - existing.created_at < 60) return c.json({ error: T(c, '发送太频繁，请 1 分钟后再试') }, 429)

  const code = String(Math.floor(100000 + Math.random() * 900000))
  const expiresAt = now + 600
  await c.env.DB.prepare(
    `INSERT INTO password_reset_codes (email, code, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(email) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`
  ).bind(email, code, expiresAt, now).run()

  const text = T(c, '您正在重置 LinkPad 账户密码。\n\n验证码：{code}\n\n验证码 10 分钟内有效。如果这不是您本人的操作，请忽略此邮件。', { code })
  const html = `<div style="max-width:480px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;">
  <h2 style="margin:0 0 16px;color:#1f2937;font-size:20px;">${T(c, 'LinkPad 密码重置')}</h2>
  <p style="margin:0 0 24px;color:#4b5563;font-size:14px;line-height:1.6;">${T(c, '您正在重置 LinkPad 账户密码，请使用以下验证码完成重置：')}</p>
  <div style="background:#f3f4f6;border-radius:12px;padding:16px;text-align:center;margin-bottom:24px;">
    <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#3b82f6;">${code}</span>
  </div>
  <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">${T(c, '验证码 10 分钟内有效。如果这不是您本人的操作，请忽略此邮件。')}</p>
</div>`

  try {
    await sendEmail(c.env, email, T(c, 'LinkPad 密码重置验证码'), text, html)
  } catch (e) {
    console.error('发送重置邮件失败:', e)
    return c.json({ error: T(c, '邮件发送失败，请稍后再试') }, 500)
  }
  return c.json({ success: true })
})

// 校验验证码并重置密码
app.post('/api/auth/reset-password', async (c) => {
  const { email, code, password } = await c.req.json()
  if (!email || !code || !password) return c.json({ error: T(c, '参数不完整') }, 400)
  if (password.length < 6) return c.json({ error: T(c, '密码至少6位') }, 400)

  const now = Math.floor(Date.now() / 1000)
  const row = await c.env.DB.prepare('SELECT code, expires_at, attempts FROM password_reset_codes WHERE email = ?').bind(email).first() as any
  if (!row) return c.json({ error: T(c, '请先获取验证码') }, 400)
  if (row.expires_at < now) return c.json({ error: T(c, '验证码已过期，请重新获取') }, 400)
  if (row.attempts >= 5) return c.json({ error: T(c, '尝试次数过多，请重新获取验证码') }, 400)

  if (String(row.code) !== String(code).trim()) {
    await c.env.DB.prepare('UPDATE password_reset_codes SET attempts = attempts + 1 WHERE email = ?').bind(email).run()
    return c.json({ error: T(c, '验证码错误') }, 400)
  }

  const user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first() as any
  if (!user) return c.json({ error: T(c, '该邮箱未注册') }, 404)

  const hash = await hashPassword(password, c.env.JWT_SECRET)
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, user.id).run()
  await c.env.DB.prepare('DELETE FROM password_reset_codes WHERE email = ?').bind(email).run()
  return c.json({ success: true })
})

// ==================== Google OAuth ====================

const GOOGLE_REDIRECT_URI = 'https://linkpad.site/api/auth/google/callback'

// 发起 Google 登录：302 跳转到 Google 授权页
app.get('/api/auth/google/start', async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  if (!clientId) return c.json({ error: T(c, 'Google 登录未配置') }, 503)

  // 签名 state（无需存储）：随机数 + 过期时间 + 回跳路径
  const exp = Math.floor(Date.now() / 1000) + 600
  const next = c.req.query('next') && c.req.query('next')!.startsWith('/') ? c.req.query('next')! : '/'
  const stateBody = btoa(JSON.stringify({ n: crypto.randomUUID(), exp, next }))
  const sig = await hmacSign(stateBody, c.env.JWT_SECRET)
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state: `${stateBody}.${sig}`,
    prompt: 'select_account',
  })
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302)
})

// Google 回调：换 code → 取用户信息 → 注册/登录 → 带 JWT 跳回前端
app.get('/api/auth/google/callback', async (c) => {
  const fail = (msg: string) => c.redirect(`https://linkpad.site/?auth_error=${encodeURIComponent(msg)}`, 302)

  const clientId = c.env.GOOGLE_CLIENT_ID
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return fail(T(c, 'Google 登录未配置'))

  const code = c.req.query('code')
  const stateRaw = c.req.query('state') || ''
  if (!code || !stateRaw.includes('.')) return fail(T(c, '登录参数缺失，请重试'))

  // 校验 state 签名与有效期
  const dotIdx = stateRaw.lastIndexOf('.')
  const stateBody = stateRaw.slice(0, dotIdx)
  const sig = stateRaw.slice(dotIdx + 1)
  let state: { n: string; exp: number; next: string }
  try {
    state = JSON.parse(atob(stateBody))
  } catch {
    return fail(T(c, '登录状态无效，请重试'))
  }
  if (!state || typeof state.exp !== 'number') return fail(T(c, '登录状态无效，请重试'))
  if (sig !== await hmacSign(stateBody, c.env.JWT_SECRET)) return fail(T(c, '登录状态校验失败，请重试'))
  if (state.exp < Math.floor(Date.now() / 1000)) return fail(T(c, '登录已超时，请重试'))

  // 用授权码换取 access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenRes.ok) {
    console.error('Google token exchange failed:', await tokenRes.text())
    return fail(T(c, 'Google 授权失败，请重试'))
  }
  const tokenData = await tokenRes.json() as { access_token?: string }

  // 获取 Google 用户信息
  const uiRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })
  if (!uiRes.ok) return fail(T(c, '获取 Google 用户信息失败，请重试'))
  const ui = await uiRes.json() as { email?: string; name?: string; picture?: string }
  const email = String(ui.email || '').toLowerCase()
  if (!email) return fail(T(c, 'Google 账号未提供邮箱'))

  // 查找或创建用户（邮箱忽略大小写匹配）
  const existing = await c.env.DB.prepare('SELECT id, email, nickname, avatar_url, status FROM users WHERE email = ? COLLATE NOCASE').bind(email).first() as any
  if (existing && existing.status === 'disabled') return fail(T(c, '账户已被禁用'))

  let userId: string
  if (existing) {
    userId = existing.id
    // 已有账号没有头像时，补上 Google 头像
    if (!existing.avatar_url && ui.picture) {
      await c.env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(ui.picture, existing.id).run()
    }
  } else {
    userId = crypto.randomUUID()
    const nick = ui.name || email.split('@')[0]
    await c.env.DB.prepare('INSERT INTO users (id, email, password_hash, nickname, avatar_url) VALUES (?, ?, ?, ?, ?)')
      .bind(userId, email, '', nick, ui.picture || '').run()
    await seedNewUser(c.env.DB, userId)
  }
  await recordDailyActivity(c.env.DB, userId, 'auth')

  const user = await c.env.DB.prepare('SELECT id, email, nickname, avatar_url FROM users WHERE id = ?').bind(userId).first()
  const token = await signJWT({ sub: userId, email }, c.env.JWT_SECRET)

  const next = typeof state.next === 'string' && state.next.startsWith('/') ? state.next : '/'
  const sep = next.includes('?') ? '&' : '?'
  return c.redirect(`https://linkpad.site${next}${sep}google_token=${encodeURIComponent(token)}`, 302)
})

// ==================== User Profile ====================

app.get('/api/users/:id', async (c) => {
  const id = c.req.param('id')
  const user = await c.env.DB.prepare('SELECT id, email, nickname, avatar_url, created_at FROM users WHERE id = ?').bind(id).first() as any
  if (!user) return c.json({ error: T(c, '用户不存在') }, 404)

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
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const { nickname, avatar_url } = await c.req.json()

  if (nickname !== undefined) {
    await c.env.DB.prepare('UPDATE users SET nickname = ? WHERE id = ?').bind(nickname, user.id).run()
  }
  if (avatar_url !== undefined) {
    await c.env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(avatar_url, user.id).run()
  }
  await recordActivity(c, user, 'profile_update')

  const updated = await c.env.DB.prepare('SELECT id, email, nickname, avatar_url FROM users WHERE id = ?').bind(user.id).first()
  return c.json(updated)
})

// ==================== User Widgets ====================

app.get('/api/user/widgets', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const prefs = await c.env.DB.prepare('SELECT widgets, item_order, countdown_events, lang FROM user_preferences WHERE user_id = ?').bind(user.id).first<Record<string, string>>()
  return c.json({
    widgets: prefs ? JSON.parse(prefs.widgets) : [],
    itemOrder: prefs ? JSON.parse(prefs.item_order) : {},
    countdownEvents: prefs ? JSON.parse(prefs.countdown_events || '[]') : [],
    lang: (prefs as any)?.lang || ''
  })
})

// 用户语言偏好保存（独立轻量接口，不影响 widgets 整表覆盖逻辑）
app.post('/api/user/lang', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const { lang } = await c.req.json()
  if (lang !== 'zh' && lang !== 'en') return c.json({ error: T(c, '无效的语言') }, 400)
  await c.env.DB.prepare(
    "INSERT INTO user_preferences (user_id, widgets, item_order, countdown_events, lang, updated_at) VALUES (?, '[]', '{}', '[]', ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET lang = ?, updated_at = datetime('now')"
  ).bind(user.id, lang, lang).run()
  return c.json({ success: true, lang })
})

app.post('/api/user/widgets', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const { widgets, itemOrder, countdownEvents } = await c.req.json()
  const widgetsJson = typeof widgets === 'string' ? widgets : JSON.stringify(widgets)
  const orderJson = typeof itemOrder === 'string' ? itemOrder : JSON.stringify(itemOrder || {})
  const cdEventsJson = typeof countdownEvents === 'string' ? countdownEvents : JSON.stringify(countdownEvents || [])
  await c.env.DB.prepare(
    "INSERT INTO user_preferences (user_id, widgets, item_order, countdown_events, updated_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET widgets = ?, item_order = ?, countdown_events = ?, updated_at = datetime('now')"
  ).bind(user.id, widgetsJson, orderJson, cdEventsJson, widgetsJson, orderJson, cdEventsJson).run()
  await recordActivity(c, user, 'widget_update')
  return c.json({ success: true })
})

// ==================== Avatar Upload ====================

app.post('/api/upload/avatar', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

  const formData = await c.req.parseBody()
  const file = formData['file'] as File | null
  if (!file) return c.json({ error: T(c, '请选择文件') }, 400)

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

// ==================== User Wallpapers（用户自定义壁纸，仅本人可见可用） ====================

const WALLPAPER_TYPES = ['image/jpeg', 'image/png', 'image/webp']

app.get('/api/wallpapers', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const { results } = await c.env.DB.prepare(
    'SELECT id, filename, content_type, size, created_at FROM user_wallpapers WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all()
  return c.json(results || [])
})

app.post('/api/wallpapers', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const formData = await c.req.parseBody()
  const file = formData['file'] as File | null
  if (!file) return c.json({ error: T(c, '请选择文件') }, 400)
  if (!WALLPAPER_TYPES.includes(file.type)) return c.json({ error: T(c, '仅支持 JPG / PNG / WebP 图片') }, 400)
  if (file.size > 8 * 1024 * 1024) return c.json({ error: T(c, '图片过大（超过 8MB）') }, 400)
  const countRow = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM user_wallpapers WHERE user_id = ?').bind(user.id).first<any>()
  if ((countRow?.n || 0) >= 30) return c.json({ error: T(c, '最多上传 30 张壁纸') }, 400)
  const id = crypto.randomUUID()
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const r2Key = `wallpapers/${user.id}/${id}.${ext}`
  await c.env.R2.put(r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } })
  await c.env.DB.prepare('INSERT INTO user_wallpapers (id, user_id, r2_key, filename, content_type, size) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, user.id, r2Key, file.name || `${id}.${ext}`, file.type, file.size).run()
  return c.json({ id, filename: file.name, content_type: file.type, size: file.size })
})

app.delete('/api/wallpapers/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT id, r2_key FROM user_wallpapers WHERE id = ? AND user_id = ?').bind(id, user.id).first<any>()
  if (!row) return c.json({ error: T(c, '壁纸不存在') }, 404)
  await c.env.R2.delete(row.r2_key)
  await c.env.DB.prepare('DELETE FROM user_wallpapers WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

app.get('/api/wallpapers/:id/image', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT id, r2_key FROM user_wallpapers WHERE id = ? AND user_id = ?').bind(id, user.id).first<any>()
  if (!row) return c.json({ error: T(c, '壁纸不存在') }, 404)
  const obj = await c.env.R2.get(row.r2_key)
  if (!obj) return c.json({ error: 'Not found' }, 404)
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('Cache-Control', 'private, max-age=86400')
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
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
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
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

  const { name, description, visibility, password, categories } = await c.req.json()
  if (!name) return c.json({ error: T(c, '仓库名称不能为空') }, 400)

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

  await recordActivity(c, user, 'repo_create')
  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(id).first()
  return c.json(repo, 201)
})

app.get('/api/repos/:id', async (c) => {
  const id = c.req.param('id')
  const repo = await c.env.DB.prepare('SELECT r.*, u.nickname as owner_name, u.avatar_url as owner_avatar FROM repositories r JOIN users u ON u.id = r.user_id WHERE r.id = ?').bind(id).first() as any
  if (!repo) return c.json({ error: T(c, '仓库不存在') }, 404)

  // Check visibility
  if (repo.visibility === 'private') {
    const user = await getUser(c)
    if (!user || user.id !== repo.user_id) return c.json({ error: T(c, '无权访问') }, 403)
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
  let is_following = false, is_bookmarked = false, can_manage = false, follow_target_category_id = ''
  const user = await getUser(c)
  if (user) {
    const [follow, bookmark] = await Promise.all([
      c.env.DB.prepare('SELECT id, target_category_id FROM repo_follows WHERE user_id = ? AND repo_id = ?').bind(user.id, id).first() as any,
      c.env.DB.prepare('SELECT id FROM repo_bookmarks WHERE user_id = ? AND repo_id = ?').bind(user.id, id).first(),
    ])
    is_following = !!follow
    follow_target_category_id = follow?.target_category_id || ''
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
    follow_target_category_id,
  })
})

app.put('/api/repos/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

  const id = c.req.param('id')
  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(id).first() as any
  if (!repo) return c.json({ error: T(c, '仓库不存在') }, 404)
  if (repo.user_id !== user.id) return c.json({ error: T(c, '无权修改') }, 403)

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

  await recordActivity(c, user, 'repo_update')
  const updated = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(id).first()
  return c.json(updated)
})

app.delete('/api/repos/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

  const id = c.req.param('id')
  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(id).first() as any
  if (!repo) return c.json({ error: T(c, '仓库不存在') }, 404)
  if (repo.user_id !== user.id) return c.json({ error: T(c, '无权删除') }, 403)

  // Cascade delete
  await c.env.DB.prepare('DELETE FROM repo_links WHERE repo_id = ?').bind(id).run()
  await c.env.DB.prepare(
    'DELETE FROM link_category_assignments WHERE link_id IN (SELECT id FROM repo_links WHERE repo_id = ?)'
  ).bind(id).run()
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
  const catMap = await getRepoCategoryIds(c.env.DB, id, (results || []).map((r: any) => r.id))
  return c.json((results || []).map((link: any) => ({ ...link, category_ids: catMap[link.id] || [link.category_id].filter(Boolean) })))
})

// 检测仓库内是否已存在相同链接：精确匹配（忽略协议/大小写/末尾斜杠）优先，无精确命中时按同域名兜底（忽略路径）；exclude 用于编辑时排除自身
// GitHub 链接不做同域名兜底：不同路径代表不同仓库
app.get('/api/repos/:id/links/duplicates', async (c) => {
  const repoId = c.req.param('id')
  const key = normalizeUrl(c.req.query('url') ?? '')
  if (!key) return c.json({ duplicates: [] })
  const exclude = c.req.query('exclude') || ''
  const keyDomain = urlDomain(key)
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, url, icon, bg_color, text_color, category_id FROM repo_links WHERE repo_id = ?'
  ).bind(repoId).all()
  const list = ((results || []) as any[]).filter(l => l.id !== exclude)
  const exact = list.filter(l => normalizeUrl(l.url) === key)
  if (exact.length > 0) return c.json({ duplicates: exact, matchType: 'exact' })
  const byDomain = keyDomain && keyDomain !== 'github.com' ? list.filter(l => l.url && urlDomain(l.url) === keyDomain) : []
  return c.json({ duplicates: byDomain, matchType: 'domain' })
})

app.post('/api/repos/:id/links', async (c) => {
  const repoId = c.req.param('id')
  if (!(await canManageRepo(c, repoId))) return c.json({ error: T(c, '无权操作') }, 403)
  const currentUser = await getUser(c)

  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (!repo) return c.json({ error: T(c, '仓库不存在') }, 404)

  const { name, url, icon, category_id, category_ids, desc } = await c.req.json()
  if (!name || !url) return c.json({ error: T(c, '名称和地址不能为空') }, 400)

  // 分类多选：仓库 category_id 存分类名；兼容旧的单选参数
  const requestedCats = normalizeCategoryIds(category_ids)
    .concat(category_id && !Array.isArray(category_ids) ? [String(category_id)] : [])
    .filter((cat, index, list) => list.indexOf(cat) === index)
  const { results: repoCatRows } = await c.env.DB.prepare('SELECT name FROM repo_categories WHERE repo_id = ? ORDER BY sort_order ASC').bind(repoId).all()
  const repoCatNames = (repoCatRows || []).map((r: any) => r.name)
  const selectedCats = requestedCats.filter(cat => repoCatNames.includes(cat))
  const firstCat = selectedCats[0] || ''

  const linkId = crypto.randomUUID()
  const linkIcon = icon || name.charAt(0).toUpperCase()
  const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as max FROM repo_links WHERE repo_id = ?').bind(repoId).first() as any

  await c.env.DB.prepare(
    'INSERT INTO repo_links (id, repo_id, category_id, name, url, icon, sort_order, desc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(linkId, repoId, firstCat, name, url, linkIcon, (maxOrder?.max ?? -1) + 1, desc || '').run()
  await replaceRepoCategoryAssignments(c.env.DB, linkId, selectedCats)

  await c.env.DB.prepare('UPDATE repositories SET link_count = (SELECT COUNT(*) FROM repo_links WHERE repo_id = ?), updated_at = datetime(\'now\') WHERE id = ?').bind(repoId, repoId).run()

  const link = await c.env.DB.prepare('SELECT * FROM repo_links WHERE id = ?').bind(linkId).first()
  
  // Sync new link to all followers
  if (link) {
    await syncLinkToFollowers(c.env.DB, repoId, link, 'add')
  }

  // 后台预热该链接的悬停预览截图（不阻塞响应）
  c.executionCtx.waitUntil(preCapture(c.env, url))

  if (currentUser) await recordActivity(c, currentUser, 'link_create')
  return c.json(link, 201)
})

app.put('/api/links/:id', async (c) => {
  const id = c.req.param('id')
  const link = await c.env.DB.prepare('SELECT l.*, r.user_id FROM repo_links l JOIN repositories r ON r.id = l.repo_id WHERE l.id = ?').bind(id).first() as any
  if (!link) return c.json({ error: T(c, '链接不存在') }, 404)
  if (!(await canManageRepo(c, link.repo_id))) return c.json({ error: T(c, '无权修改') }, 403)

  const { name, url, icon, category_id, category_ids, bg_color, text_color, desc } = await c.req.json()
  if (name !== undefined) await c.env.DB.prepare('UPDATE repo_links SET name = ? WHERE id = ?').bind(name, id).run()
  if (url !== undefined) await c.env.DB.prepare('UPDATE repo_links SET url = ?, link_status = \'\', last_checked_at = 0, fail_count = 0, last_http_status = 0 WHERE id = ?').bind(url, id).run()
  // URL 变更时后台预热新地址的预览截图（不阻塞响应）
  if (url !== undefined) c.executionCtx.waitUntil(preCapture(c.env, url))
  if (icon !== undefined) await c.env.DB.prepare('UPDATE repo_links SET icon = ? WHERE id = ?').bind(icon, id).run()
  const requestedCategoryNames = normalizeCategoryIds(category_ids)
    .concat(category_id !== undefined && !Array.isArray(category_ids) ? [String(category_id)] : [])
    .filter((cat, index, list) => list.indexOf(cat) === index)
  if (category_ids !== undefined || category_id !== undefined) {
    const { results: repoCatRows } = await c.env.DB.prepare('SELECT name FROM repo_categories WHERE repo_id = ?').bind(link.repo_id).all()
    const repoCatNames = (repoCatRows || []).map((r: any) => r.name)
    const selectedCats = requestedCategoryNames.filter(cat => repoCatNames.includes(cat))
    if (category_ids !== undefined || selectedCats.length > 0) {
      await c.env.DB.prepare('UPDATE repo_links SET category_id = ? WHERE id = ?').bind(selectedCats[0] || '', id).run()
      await replaceRepoCategoryAssignments(c.env.DB, id, selectedCats)
    }
  }
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

  const user = await getUser(c)
  if (user) await recordActivity(c, user, 'link_update')
  return c.json(updated)
})

app.delete('/api/links/:id', async (c) => {
  const id = c.req.param('id')
  const link = await c.env.DB.prepare('SELECT l.*, r.user_id FROM repo_links l JOIN repositories r ON r.id = l.repo_id WHERE l.id = ?').bind(id).first() as any
  if (!link) return c.json({ error: T(c, '链接不存在') }, 404)
  if (!(await canManageRepo(c, link.repo_id))) return c.json({ error: T(c, '无权删除') }, 403)

  await c.env.DB.prepare('DELETE FROM link_category_assignments WHERE link_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM repo_links WHERE id = ?').bind(id).run()
  await c.env.DB.prepare('UPDATE repositories SET link_count = (SELECT COUNT(*) FROM repo_links WHERE repo_id = ?), updated_at = datetime(\'now\') WHERE id = ?').bind(link.repo_id, link.repo_id).run()

  // Sync deletion to followers
  syncLinkToFollowers(c.env.DB, link.repo_id, link, 'delete').catch(e => console.error('sync delete error:', e))

  return c.json({ success: true })
})

// ==================== Link Health Check ====================

// 仓库创建者打开仓库时触发：检测该仓库链接（24h 内检测过的自动跳过）
app.post('/api/repos/:id/links/check', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const repoId = c.req.param('id')
  const repo = await c.env.DB.prepare('SELECT user_id FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (!repo) return c.json({ error: T(c, '仓库不存在') }, 404)
  if (repo.user_id !== user.id) return c.json({ error: T(c, '仅仓库创建者可触发检测') }, 403)

  const since = Math.floor(Date.now() / 1000) - 24 * 3600
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, url, fail_count FROM repo_links WHERE repo_id = ? AND (last_checked_at IS NULL OR last_checked_at < ?) LIMIT 200'
  ).bind(repoId, since).all()
  const dead = await checkAndSaveLinks(c.env.DB, 'repo_links', results as any[])
  return c.json({ checked: results.length, dead })
})

// ==================== Repo Categories ====================

app.post('/api/repos/:id/categories', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

  const repoId = c.req.param('id')
  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (!repo) return c.json({ error: T(c, '仓库不存在') }, 404)
  if (repo.user_id !== user.id) return c.json({ error: T(c, '无权修改') }, 403)

  const { name } = await c.req.json()
  if (!name) return c.json({ error: T(c, '分类名称不能为空') }, 400)

  const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as max FROM repo_categories WHERE repo_id = ?').bind(repoId).first() as any
  await c.env.DB.prepare('INSERT INTO repo_categories (id, repo_id, name, sort_order) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), repoId, name, (maxOrder?.max ?? -1) + 1).run()
  await recordActivity(c, user, 'category_create')
  return c.json({ success: true })
})

app.delete('/api/repos/:id/categories/:name', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

  const repoId = c.req.param('id')
  const catName = decodeURIComponent(c.req.param('name'))
  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (!repo) return c.json({ error: T(c, '仓库不存在') }, 404)
  if (repo.user_id !== user.id) return c.json({ error: T(c, '无权修改') }, 403)

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
  await c.env.DB.prepare(
    'DELETE FROM link_category_assignments WHERE category_id = ? AND link_id IN (SELECT id FROM repo_links WHERE repo_id = ?)'
  ).bind(catName, repoId).run()
  await recordActivity(c, user, 'category_update')
  return c.json({ success: true })
})

// Reorder repo categories
app.put('/api/repos/:id/categories/reorder', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const repoId = c.req.param('id')
  if (!(await canManageRepo(c, repoId))) return c.json({ error: T(c, '无权操作') }, 403)
  const { order } = await c.req.json() as { order: { name: string; sort_order: number }[] }
  if (!order) return c.json({ error: T(c, '无效参数') }, 400)
  const db = c.env.DB
  const tx = db.batch(order.map(o =>
    db.prepare('UPDATE repo_categories SET sort_order = ? WHERE repo_id = ? AND name = ?').bind(o.sort_order, repoId, o.name)
  ))
  await tx

  // Sync category order to followers — mirror repo order onto their sub-categories
  try {
    const followers = await db.prepare('SELECT user_id, target_category_id FROM repo_follows WHERE repo_id = ? AND target_category_id != \'\'').bind(repoId).all()
    const stmts: any[] = []
    for (const f of (followers.results || []) as any[]) {
      for (const o of order) {
        stmts.push(db.prepare('UPDATE user_categories SET sort_order = ? WHERE user_id = ? AND parent_id = ? AND name = ?').bind(o.sort_order, f.user_id, f.target_category_id, o.name))
      }
    }
    if (stmts.length > 0) await db.batch(stmts)
  } catch (e) {
    console.error('Sync category reorder to followers error:', e)
  }

  await recordActivity(c, user, 'category_update')
  return c.json({ success: true })
})

// Rename repo category
app.put('/api/repos/:id/categories/:name', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const repoId = c.req.param('id')
  const oldName = decodeURIComponent(c.req.param('name'))
  const { name: newName } = await c.req.json()
  if (!newName?.trim()) return c.json({ error: T(c, '名称不能为空') }, 400)
  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (!repo) return c.json({ error: T(c, '仓库不存在') }, 404)
  if (repo.user_id !== user.id) return c.json({ error: T(c, '无权修改') }, 403)
  await c.env.DB.prepare('UPDATE repo_categories SET name = ? WHERE repo_id = ? AND name = ?').bind(newName.trim(), repoId, oldName).run()
  await c.env.DB.prepare('UPDATE repo_links SET category_id = ? WHERE repo_id = ? AND category_id = ?').bind(newName.trim(), repoId, oldName).run()
  await c.env.DB.prepare(
    'UPDATE link_category_assignments SET category_id = ? WHERE category_id = ? AND link_id IN (SELECT id FROM repo_links WHERE repo_id = ?)'
  ).bind(newName.trim(), oldName, repoId).run()
  
  // Sync category rename to followers
  const followers = await c.env.DB.prepare('SELECT user_id, target_category_id FROM repo_follows WHERE repo_id = ? AND target_category_id != \'\'').bind(repoId).all()
  for (const f of (followers.results || []) as any[]) {
    await c.env.DB.prepare('UPDATE user_categories SET name = ? WHERE user_id = ? AND parent_id = ? AND name = ?').bind(newName.trim(), f.user_id, f.target_category_id, oldName).run()
  }
  
  await recordActivity(c, user, 'category_update')
  return c.json({ success: true })
})

// Reorder repo links
app.put('/api/repos/:id/links/reorder', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const repoId = c.req.param('id')
  if (!(await canManageRepo(c, repoId))) return c.json({ error: T(c, '无权操作') }, 403)
  const { order } = await c.req.json() as { order: { id: string; sort_order: number }[] }
  if (!order) return c.json({ error: T(c, '无效参数') }, 400)
  const db = c.env.DB
  const tx = db.batch(order.map(o =>
    db.prepare('UPDATE repo_links SET sort_order = ? WHERE id = ?').bind(o.sort_order, o.id)
  ))
  await tx

  // Sync link order to followers — mirror the new in-section order onto their tools
  try {
    const followers = await db.prepare('SELECT user_id FROM repo_follows WHERE repo_id = ? AND target_category_id != \'\'').bind(repoId).all()
    if ((followers.results || []).length > 0) {
      const stmts: any[] = []
      for (const f of (followers.results || []) as any[]) {
        for (const o of order) {
          stmts.push(db.prepare('UPDATE user_tools SET sort_order = ? WHERE id = ? AND user_id = ?').bind(o.sort_order, `follow-${repoId}-${f.user_id}-${o.id}`, f.user_id))
        }
      }
      if (stmts.length > 0) await db.batch(stmts)
    }
  } catch (e) {
    console.error('Sync link reorder to followers error:', e)
  }
  await recordActivity(c, user, 'link_update')
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
  if (!(await canManageRepo(c, repoId))) return c.json({ error: T(c, '无权操作') }, 403)
  const repo = await c.env.DB.prepare('SELECT user_id FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (!repo) return c.json({ error: T(c, '仓库不存在') }, 404)

  const { nickname, email } = await c.req.json()
  if (!nickname && !email) return c.json({ error: T(c, '请提供昵称或邮箱') }, 400)

  let targetUser: any
  if (email) {
    targetUser = await c.env.DB.prepare('SELECT id, nickname, avatar_url FROM users WHERE email = ?').bind(email).first()
  } else {
    targetUser = await c.env.DB.prepare('SELECT id, nickname, avatar_url FROM users WHERE nickname = ?').bind(nickname).first()
  }
  if (!targetUser) return c.json({ error: T(c, '未找到该用户') }, 404)
  if (targetUser.id === repo.user_id) return c.json({ error: T(c, '不能添加创建者') }, 400)

  const existing = await c.env.DB.prepare('SELECT id FROM repo_members WHERE repo_id = ? AND user_id = ?').bind(repoId, targetUser.id).first()
  if (existing) return c.json({ error: T(c, '该用户已是成员') }, 409)

  await c.env.DB.prepare('INSERT INTO repo_members (id, repo_id, user_id, role) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), repoId, targetUser.id, 'member').run()
  return c.json({ success: true, user: targetUser })
})

app.delete('/api/repos/:id/members/:userId', async (c) => {
  const repoId = c.req.param('id')
  const userId = c.req.param('userId')
  if (!(await canManageRepo(c, repoId))) return c.json({ error: T(c, '无权操作') }, 403)

  await c.env.DB.prepare('DELETE FROM repo_members WHERE repo_id = ? AND user_id = ?').bind(repoId, userId).run()
  return c.json({ success: true })
})

// ==================== Repo Icon Upload ====================

app.post('/api/repos/:id/icon', async (c) => {
  const repoId = c.req.param('id')
  if (!(await canManageRepo(c, repoId))) return c.json({ error: T(c, '无权操作') }, 403)

  const formData = await c.req.parseBody()
  const file = formData['file'] as File | null
  if (!file) return c.json({ error: T(c, '请选择文件') }, 400)

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
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

  const targetId = c.req.param('userId')
  if (user.id === targetId) return c.json({ error: T(c, '不能关注自己') }, 400)

  const target = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(targetId).first()
  if (!target) return c.json({ error: T(c, '用户不存在') }, 404)

  const existing = await c.env.DB.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?').bind(user.id, targetId).first()
  if (existing) return c.json({ error: T(c, '已关注') }, 409)

  await c.env.DB.prepare('INSERT INTO follows (id, follower_id, following_id) VALUES (?, ?, ?)').bind(crypto.randomUUID(), user.id, targetId).run()

  // Notify followed user
  const actorName = user.nickname || '某用户'
  await createNotification(c.env.DB, targetId, 'follow_user', user.id, '', `${actorName} 关注了您`)

  await recordActivity(c, user, 'follow_user')
  return c.json({ success: true })
})

app.delete('/api/follows/user/:userId', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

  const targetId = c.req.param('userId')
  await c.env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').bind(user.id, targetId).run()
  return c.json({ success: true })
})

// ==================== Follow / Unfollow Repos ====================

app.post('/api/follows/repo/:repoId', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const repoId = c.req.param('repoId')
  const body = await c.req.json().catch(() => ({})) as { category_id?: string; skip_link_ids?: string[] }
  const { category_id } = body
  // 勾选排除的重复链接（repo_links 的 id）
  const skipSet = new Set<string>((body.skip_link_ids || []).map(String))
  const skipJson = JSON.stringify([...skipSet])
  const excludeDuplicates = skipSet.size > 0 ? 1 : 0

  // Check existing follow
  const existing = await c.env.DB.prepare('SELECT id FROM repo_follows WHERE user_id = ? AND repo_id = ?').bind(user.id, repoId).first() as any

  if (existing && !category_id) {
    // Already following, no sync needed
    return c.json({ success: true })
  }

  if (existing) {
    // Update target_category_id for re-sync
    await c.env.DB.prepare('UPDATE repo_follows SET target_category_id = ?, skip_link_ids = ?, exclude_duplicates = ? WHERE user_id = ? AND repo_id = ?').bind(category_id || '', skipJson, excludeDuplicates, user.id, repoId).run()
  } else {
    await c.env.DB.prepare('INSERT INTO repo_follows (id, user_id, repo_id, target_category_id, skip_link_ids, exclude_duplicates, last_viewed_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))').bind(crypto.randomUUID(), user.id, repoId, category_id || '', skipJson, excludeDuplicates).run()

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
      if (!repo) return c.json({ error: T(c, '仓库不存在') }, 404)

      const db = c.env.DB
      const followPrefix = `follow-${repoId}-${user.id}-`

      // Clean up previous sync entries for this user
      await db.prepare('DELETE FROM user_tools WHERE id >= ? AND id < ? AND user_id = ?').bind(followPrefix, `${followPrefix}{`, user.id).run()
      // Clean up user sub-categories that came from this follow
      await db.prepare("DELETE FROM user_categories WHERE user_id = ? AND id LIKE ?").bind(user.id, `follow-sc-${repoId}-%`).run()

      // Get repo categories & all links（一次取回内存分组，替代循环内逐分类查询）
      const { results: repoCategories } = await c.env.DB.prepare('SELECT name, sort_order FROM repo_categories WHERE repo_id = ? ORDER BY sort_order ASC').bind(repoId).all()
      const { results: allRepoLinks } = await db.prepare('SELECT * FROM repo_links WHERE repo_id = ? ORDER BY sort_order ASC').bind(repoId).all()
      const linksByCat: Record<string, any[]> = {}
      for (const l of (allRepoLinks as any[])) (linksByCat[l.category_id || ''] ||= []).push(l)
      const uncategorizedLinks = linksByCat[''] || []

      const stmts: any[] = []
      const subCatIdMap: Record<string, string> = {}

      // First pass: create all sub-categories mirroring the repo's category order
      const { results: existingSubCats } = await db.prepare('SELECT id, name FROM user_categories WHERE user_id = ? AND parent_id = ?').bind(user.id, category_id).all()
      const existingSubCatMap: Record<string, string> = {}
      for (const cat of (existingSubCats as any[])) {
        existingSubCatMap[cat.name] = cat.id
      }

      for (const [idx, repoCat] of (repoCategories as any[]).entries()) {
        const catName = repoCat.name
        let subCatId: string
        if (existingSubCatMap[catName]) {
          subCatId = existingSubCatMap[catName]
          // Re-sync: align existing sub-category order with the repo
          stmts.push(db.prepare('UPDATE user_categories SET sort_order = ? WHERE id = ? AND user_id = ?').bind(idx, subCatId, user.id))
        } else {
          subCatId = `follow-sc-${repoId}-${crypto.randomUUID().slice(0,8)}`
          stmts.push(db.prepare('INSERT INTO user_categories (id, user_id, name, icon, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)').bind(subCatId, user.id, catName, 'Folder', category_id, idx))
        }
        subCatIdMap[catName] = subCatId
      }

      // Second pass: add links to each sub-category（排序基准一次性 GROUP BY 取回，替代循环内逐分类 MAX 查询）
      const maxOrderIds = [...new Set([...Object.values(subCatIdMap), category_id])]
      const { results: maxOrderRows } = await db.prepare(`SELECT category_id, MAX(sort_order) AS max FROM user_tools WHERE user_id = ? AND category_id IN (${maxOrderIds.map(() => '?').join(',')}) GROUP BY category_id`).bind(user.id, ...maxOrderIds).all()
      const maxOrderMap: Record<string, number> = {}
      for (const r of (maxOrderRows as any[])) maxOrderMap[r.category_id] = r.max
      for (const repoCat of (repoCategories as any[])) {
        const catName = repoCat.name
        const subCatId = subCatIdMap[catName]

        const catLinks = linksByCat[catName] || []
        if (catLinks.length > 0) {
          let toolSortOrder = (maxOrderMap[subCatId] ?? -1) + 1
          for (const link of catLinks) {
            if (skipSet.has(String(link.id))) continue
            stmts.push(db.prepare(
              'INSERT OR IGNORE INTO user_tools (id, user_id, name, url, desc, category_id, sort_order, icon, viewed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'
            ).bind(`follow-${repoId}-${user.id}-${link.id}`, user.id, link.name, link.url, link.desc || '', subCatId, toolSortOrder++, link.icon || ''))
          }
        }
      }

      // Uncategorized links
      if (uncategorizedLinks.length > 0) {
        let toolSortOrder = (maxOrderMap[category_id] ?? -1) + 1
        for (const link of (uncategorizedLinks as any[])) {
          if (skipSet.has(String(link.id))) continue
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

  await recordActivity(c, user, 'follow_repo')
  return c.json({ success: true })
})

app.delete('/api/follows/repo/:repoId', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

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
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

  const repoId = c.req.param('repoId')
  const existing = await c.env.DB.prepare('SELECT id FROM repo_bookmarks WHERE user_id = ? AND repo_id = ?').bind(user.id, repoId).first()
  if (existing) return c.json({ error: T(c, '已收藏') }, 409)

  await c.env.DB.prepare('INSERT INTO repo_bookmarks (id, user_id, repo_id) VALUES (?, ?, ?)').bind(crypto.randomUUID(), user.id, repoId).run()

  // Notify repo owner
  const repoInfo = await c.env.DB.prepare('SELECT user_id, name FROM repositories WHERE id = ?').bind(repoId).first() as any
  if (repoInfo) {
    await createNotification(c.env.DB, repoInfo.user_id, 'bookmark_repo', user.id, repoId, `${user.nickname || '某用户'} 收藏了您的仓库「${repoInfo.name}」`)
  }

  await recordActivity(c, user, 'bookmark_repo')
  return c.json({ success: true })
})

app.delete('/api/bookmarks/repo/:repoId', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

  const repoId = c.req.param('repoId')
  await c.env.DB.prepare('DELETE FROM repo_bookmarks WHERE user_id = ? AND repo_id = ?').bind(user.id, repoId).run()
  return c.json({ success: true })
})

// ==================== Mark followed repo as viewed ====================

app.post('/api/follows/repo/:repoId/view', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

  const repoId = c.req.param('repoId')
  await c.env.DB.prepare('UPDATE repo_follows SET last_viewed_at = datetime(\'now\') WHERE user_id = ? AND repo_id = ?').bind(user.id, repoId).run()
  return c.json({ success: true })
})

// ==================== Duplicate link detection ====================

// 检测仓库链接与用户首页已有链接的重复项（不含本仓库自身的同步副本）
app.get('/api/follows/repo/:repoId/duplicates', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const repoId = c.req.param('repoId')

  const [repoLinks, userTools] = await Promise.all([
    c.env.DB.prepare('SELECT id, name, url FROM repo_links WHERE repo_id = ?').bind(repoId).all(),
    c.env.DB.prepare('SELECT id, name, url FROM user_tools WHERE user_id = ?').bind(user.id).all(),
  ])

  const ownPrefix = `follow-${repoId}-${user.id}-`
  const homeMap = new Map<string, any>()
  for (const t of (userTools.results || []) as any[]) {
    if (String(t.id).startsWith(ownPrefix)) continue
    const key = normalizeUrl(t.url)
    if (key && !homeMap.has(key)) homeMap.set(key, t)
  }

  const duplicates: any[] = []
  const seen = new Set<string>()
  for (const l of (repoLinks.results || []) as any[]) {
    const key = normalizeUrl(l.url)
    if (!key || seen.has(key)) continue
    const hit = homeMap.get(key)
    if (hit) {
      seen.add(key)
      duplicates.push({ link_id: l.id, name: l.name, url: l.url, existing_name: hit.name })
    }
  }
  return c.json({ duplicates })
})

// ==================== Re-sync followed repo ====================

app.post('/api/follows/repo/:repoId/resync', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const repoId = c.req.param('repoId')
  const body = await c.req.json().catch(() => ({})) as { skip_link_ids?: string[] }
  const skipSet = new Set<string>((body.skip_link_ids || []).map(String))
  const skipJson = JSON.stringify([...skipSet])
  const excludeDuplicates = skipSet.size > 0 ? 1 : 0

  // Check follow exists
  const follow = await c.env.DB.prepare('SELECT target_category_id FROM repo_follows WHERE user_id = ? AND repo_id = ?').bind(user.id, repoId).first() as any
  if (!follow) return c.json({ error: T(c, '未关注该仓库') }, 400)
  if (!follow.target_category_id) return c.json({ error: T(c, '关注时未选择同步分类，无法同步') }, 400)

  // Persist the exclusion preference for future incremental syncs
  await c.env.DB.prepare('UPDATE repo_follows SET skip_link_ids = ?, exclude_duplicates = ? WHERE user_id = ? AND repo_id = ?').bind(skipJson, excludeDuplicates, user.id, repoId).run()

  const db = c.env.DB
  const followPrefix = `follow-${repoId}-${user.id}-`

  // Clean up old sync entries
  await db.prepare('DELETE FROM user_tools WHERE id >= ? AND id < ? AND user_id = ?').bind(followPrefix, `${followPrefix}{`, user.id).run()
  await db.prepare("DELETE FROM user_categories WHERE user_id = ? AND id LIKE ?").bind(user.id, `follow-sc-${repoId}-%`).run()

  // Re-sync repo links（一次取回内存分组，替代循环内逐分类查询）
  const { results: repoCategories } = await db.prepare('SELECT name, sort_order FROM repo_categories WHERE repo_id = ? ORDER BY sort_order ASC').bind(repoId).all()
  const { results: allRepoLinks } = await db.prepare('SELECT * FROM repo_links WHERE repo_id = ? ORDER BY sort_order ASC').bind(repoId).all()
  const linksByCat: Record<string, any[]> = {}
  for (const l of (allRepoLinks as any[])) (linksByCat[l.category_id || ''] ||= []).push(l)
  const uncategorizedLinks = linksByCat[''] || []

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

    const catLinks = linksByCat[catName] || []
    if (catLinks.length > 0) {
      let toolSortOrder = 0
      for (const link of catLinks) {
        if (skipSet.has(String(link.id))) continue
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
      if (skipSet.has(String(link.id))) continue
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
    const followers = await db.prepare('SELECT user_id, target_category_id, skip_link_ids, exclude_duplicates FROM repo_follows WHERE repo_id = ? AND target_category_id != \'\'').bind(repoId).all()
    console.log(`syncLinkToFollowers(${action}): repo=${repoId}, link=${link.id}, cat="${link.category_id}", linkName="${link.name}", followers=${(followers.results || []).length}`)
    for (const f of (followers.results || []) as any[]) {
      const uid = f.user_id
      const targetCatId = f.target_category_id
      const toolId = `follow-${repoId}-${uid}-${link.id}`

      // 关注时勾选排除的链接：始终保持隐藏
      let skipLink = false
      try {
        skipLink = ((JSON.parse(f.skip_link_ids || '[]') as string[]) || []).includes(String(link.id))
      } catch { skipLink = false }

      // 开启"排除重复"后，仓库后续更新也隐藏与首页重复的链接
      if (!skipLink && f.exclude_duplicates && action !== 'delete') {
        const { results: ut } = await db.prepare('SELECT id, url FROM user_tools WHERE user_id = ?').bind(uid).all()
        const ownPrefix = `follow-${repoId}-${uid}-`
        const urlSet = new Set(((ut as any[]) || []).filter(t => !String(t.id).startsWith(ownPrefix)).map(t => normalizeUrl(t.url)))
        if (urlSet.has(normalizeUrl(link.url))) skipLink = true
      }

      if (skipLink) {
        if (action !== 'add') await db.prepare('DELETE FROM user_tools WHERE id = ? AND user_id = ?').bind(toolId, uid).run()
        console.log(`syncLinkToFollowers: link ${link.id} skipped (duplicate-excluded) for user ${uid}`)
        continue
      }

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
        // Mirror the repo's in-category order: rank = number of links sorted before this one in its category
        const rankRow = await db.prepare('SELECT COUNT(*) as rank FROM repo_links WHERE repo_id = ? AND category_id = ? AND sort_order < ?').bind(repoId, link.category_id || '', link.sort_order ?? 0).first() as any
        const sortOrder = rankRow?.rank ?? 0
        const result = await db.prepare(
          'INSERT OR REPLACE INTO user_tools (id, user_id, name, url, desc, category_id, sort_order, icon, viewed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)'
        ).bind(toolId, uid, link.name, link.url, link.desc || '', catId, sortOrder, link.icon || '').run()
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
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

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
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  await c.env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(user.id).run()
  return c.json({ success: true })
})

// ==================== User's followed repos & bookmarked repos ====================

app.get('/api/me/followed-repos', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

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
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

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

app.get('/api/admin/overview', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdmin(c, user)) return c.json({ error: T(c, '无权访问') }, 403)

  const [users, extensionUsers, extensionInstalls, todayActivity, activityTrend] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<any>(),
    c.env.DB.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM extension_user_installs').first<any>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM extension_installs').first<any>(),
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT user_id) AS uv, COALESCE(SUM(pv), 0) AS pv
       FROM user_daily_activity
       WHERE activity_date = date('now', '+8 hours')`
    ).first<any>(),
    c.env.DB.prepare(
      `WITH RECURSIVE days(day) AS (
         SELECT date('now', '+8 hours', '-6 days')
         UNION ALL
         SELECT date(day, '+1 day') FROM days WHERE day < date('now', '+8 hours')
       )
       SELECT days.day AS date,
         COUNT(DISTINCT a.user_id) AS uv,
         COALESCE(SUM(a.pv), 0) AS pv
       FROM days
       LEFT JOIN user_daily_activity a ON a.activity_date = days.day
       GROUP BY days.day
       ORDER BY days.day ASC`
    ).all(),
  ])
  return c.json({
    users: users?.n || 0,
    extensionUsers: extensionUsers?.n || 0,
    extensionInstalls: extensionInstalls?.n || 0,
    today: {
      uv: todayActivity?.uv || 0,
      pv: todayActivity?.pv || 0,
    },
    trend: (activityTrend.results as any[]).map(row => ({
      date: row.date,
      uv: row.uv || 0,
      pv: row.pv || 0,
    })),
  })
})

// Admin: list all users（keyset 分页 + 展示性 COUNT 对当前页二次点查，主查询不做关联聚合物化）
app.get('/api/admin/users', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdmin(c, user)) return c.json({ error: T(c, '无权访问') }, 403)

  const { search, status, email, nickname, cursor } = c.req.query()
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 100)

  let sql = 'SELECT u.id, u.email, u.nickname, u.avatar_url, u.created_at, u.first_active_at, u.last_active_at, u.status FROM users u WHERE 1=1'
  const params: any[] = []
  if (nickname) { sql += ' AND u.nickname LIKE ?'; params.push(`%${nickname}%`) }
  if (email) { sql += ' AND u.email LIKE ?'; params.push(`%${email}%`) }
  if (status) { sql += ' AND u.status = ?'; params.push(status) }
  if (cursor) {
    const [curTs, curId] = atob(cursor).split('|')
    if (curTs && curId) { sql += ' AND (u.created_at < ? OR (u.created_at = ? AND u.id < ?))'; params.push(curTs, curTs, curId) }
  }
  sql += ' ORDER BY u.created_at DESC, u.id DESC LIMIT ?'
  params.push(limit)

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  const rows = results as any[]
  const ids = rows.map(r => r.id)
  const ph = ids.map(() => '?').join(',')
  const [follower, following, followedRepos, bookmarks, repos, homeLinks, homeCategories, extensionInstalls] = await Promise.all([
    countBy(c.env.DB, `SELECT following_id AS id, COUNT(*) AS n FROM follows WHERE following_id IN (${ph}) GROUP BY following_id`, ids),
    countBy(c.env.DB, `SELECT follower_id AS id, COUNT(*) AS n FROM follows WHERE follower_id IN (${ph}) GROUP BY follower_id`, ids),
    countBy(c.env.DB, `SELECT user_id AS id, COUNT(*) AS n FROM repo_follows WHERE user_id IN (${ph}) GROUP BY user_id`, ids),
    countBy(c.env.DB, `SELECT user_id AS id, COUNT(*) AS n FROM repo_bookmarks WHERE user_id IN (${ph}) GROUP BY user_id`, ids),
    countBy(c.env.DB, `SELECT user_id AS id, COUNT(*) AS n FROM repositories WHERE user_id IN (${ph}) GROUP BY user_id`, ids),
    countBy(c.env.DB, `SELECT user_id AS id, COUNT(*) AS n FROM user_tools WHERE user_id IN (${ph}) GROUP BY user_id`, ids),
    countBy(c.env.DB, `SELECT user_id AS id, COUNT(*) AS n FROM user_categories WHERE user_id IN (${ph}) GROUP BY user_id`, ids),
    countBy(c.env.DB, `SELECT user_id AS id, COUNT(*) AS n FROM extension_user_installs WHERE user_id IN (${ph}) GROUP BY user_id`, ids),
  ])
  for (const r of rows) {
    r.follower_count = follower[r.id] || 0
    r.following_count = following[r.id] || 0
    r.followed_repos_count = followedRepos[r.id] || 0
    r.bookmark_count = bookmarks[r.id] || 0
    r.repo_count = repos[r.id] || 0
    r.home_link_count = homeLinks[r.id] || 0
    r.home_category_count = homeCategories[r.id] || 0
    r.extension_install_count = extensionInstalls[r.id] || 0
  }

  const nextCursor = rows.length === limit ? btoa(`${rows[rows.length - 1].created_at}|${rows[rows.length - 1].id}`) : null
  return c.json({ items: rows, nextCursor })
})

// Admin: list all repos（keyset 分页 + 展示性 COUNT 对当前页二次点查）
app.get('/api/admin/repos', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdmin(c, user)) return c.json({ error: T(c, '无权访问') }, 403)

  const { search, visibility, ownerEmail, startDate, endDate, cursor } = c.req.query()
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 100)

  let sql = `SELECT r.*, u.nickname as owner_name, u.email as owner_email
    FROM repositories r JOIN users u ON u.id = r.user_id WHERE 1=1`
  const params: any[] = []
  if (search) { sql += ' AND r.name LIKE ?'; params.push(`%${search}%`) }
  if (visibility) { sql += ' AND r.visibility = ?'; params.push(visibility) }
  if (ownerEmail) { sql += ' AND u.email LIKE ?'; params.push(`%${ownerEmail}%`) }
  if (startDate) { sql += ' AND r.created_at >= ?'; params.push(startDate) }
  if (endDate) { sql += ' AND r.created_at <= ?'; params.push(endDate) }
  if (cursor) {
    const [curTs, curId] = atob(cursor).split('|')
    if (curTs && curId) { sql += ' AND (r.created_at < ? OR (r.created_at = ? AND r.id < ?))'; params.push(curTs, curTs, curId) }
  }
  sql += ' ORDER BY r.created_at DESC, r.id DESC LIMIT ?'
  params.push(limit)

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  const rows = results as any[]
  const ids = rows.map(r => r.id)
  const ph = ids.map(() => '?').join(',')
  const [followers, bookmarks, links] = await Promise.all([
    countBy(c.env.DB, `SELECT repo_id AS id, COUNT(*) AS n FROM repo_follows WHERE repo_id IN (${ph}) GROUP BY repo_id`, ids),
    countBy(c.env.DB, `SELECT repo_id AS id, COUNT(*) AS n FROM repo_bookmarks WHERE repo_id IN (${ph}) GROUP BY repo_id`, ids),
    countBy(c.env.DB, `SELECT repo_id AS id, COUNT(*) AS n FROM repo_links WHERE repo_id IN (${ph}) GROUP BY repo_id`, ids),
  ])
  for (const r of rows) {
    r.follower_count = followers[r.id] || 0
    r.bookmark_count = bookmarks[r.id] || 0
    r.link_count = links[r.id] || 0
  }

  const nextCursor = rows.length === limit ? btoa(`${rows[rows.length - 1].created_at}|${rows[rows.length - 1].id}`) : null
  return c.json({ items: rows, nextCursor })
})

// Admin: disable/enable user
app.put('/api/admin/users/:id/status', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdmin(c, user)) return c.json({ error: T(c, '无权访问') }, 403)
  const { status } = await c.req.json() as { status: string }
  const targetId = c.req.param('id')
  if (targetId === user.id) return c.json({ error: T(c, '不能操作自己的账户') }, 400)
  await c.env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(status, targetId).run()
  return c.json({ success: true })
})

// Admin: delete user
async function deleteUserData(db: D1Database, userId: string) {
  const { results: ownedRepos } = await db.prepare('SELECT id FROM repositories WHERE user_id = ?').bind(userId).all()
  for (const repo of (ownedRepos as any[])) {
    const repoId = repo.id
    await db.prepare('DELETE FROM repo_links WHERE repo_id = ?').bind(repoId).run()
    await db.prepare(
      'DELETE FROM link_category_assignments WHERE link_id IN (SELECT id FROM repo_links WHERE repo_id = ?)'
    ).bind(repoId).run()
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
  await db.prepare('DELETE FROM extension_user_installs WHERE user_id = ?').bind(userId).run()
  await db.prepare('DELETE FROM user_daily_activity WHERE user_id = ?').bind(userId).run()
}

app.delete('/api/admin/users/:id', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdmin(c, user)) return c.json({ error: T(c, '无权访问') }, 403)
  const targetId = c.req.param('id')
  if (targetId === user.id) return c.json({ error: T(c, '不能删除自己的账户') }, 400)
  await deleteUserData(c.env.DB, targetId)
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run()
  return c.json({ success: true })
})

// Admin: hide/show repo
app.put('/api/admin/repos/:id/visibility', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdmin(c, user)) return c.json({ error: T(c, '无权访问') }, 403)
  const { visibility } = await c.req.json() as { visibility: string }
  const repoId = c.req.param('id')
  await c.env.DB.prepare('UPDATE repositories SET visibility = ? WHERE id = ?').bind(visibility, repoId).run()
  return c.json({ success: true })
})

// Admin: delete repo
app.delete('/api/admin/repos/:id', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdmin(c, user)) return c.json({ error: T(c, '无权访问') }, 403)
  const repoId = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM repo_links WHERE repo_id = ?').bind(repoId).run()
  await c.env.DB.prepare(
    'DELETE FROM link_category_assignments WHERE link_id IN (SELECT id FROM repo_links WHERE repo_id = ?)'
  ).bind(repoId).run()
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
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const { name, icon, parent_id, password } = await c.req.json()
  if (!name) return c.json({ error: T(c, '名称不能为空') }, 400)
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
  await recordActivity(c, user, 'category_create')
  const cat = await c.env.DB.prepare('SELECT * FROM user_categories WHERE id = ?').bind(id).first()
  return c.json(cat, 201)
})

app.put('/api/categories/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
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
  await recordActivity(c, user, 'category_update')
  const updated = await c.env.DB.prepare('SELECT * FROM user_categories WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  return c.json(updated || {})
})

app.delete('/api/categories/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
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
  await c.env.DB.prepare('DELETE FROM link_category_assignments WHERE category_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM user_categories WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true })
})

// Reorder categories
app.put('/api/categories/reorder', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const { order } = await c.req.json() as { order: { id: string; sort_order: number }[] }
  if (!order) return c.json({ error: T(c, '无效参数') }, 400)
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

// Resolve every category a homepage link belongs to. The primary category is
// kept on user_tools for existing queries and old clients.
async function getHomeCategoryIds(db: D1Database, linkIds: string[]): Promise<Record<string, string[]>> {
  const map: Record<string, string[]> = {}
  if (linkIds.length === 0) return map
  const placeholders = linkIds.map(() => '?').join(',')
  const { results } = await db.prepare(
    `SELECT link_id, category_id FROM link_category_assignments
     WHERE link_id IN (${placeholders}) ORDER BY sort_order ASC, rowid ASC`
  ).bind(...linkIds).all()
  for (const row of (results || []) as any[]) {
    (map[row.link_id] ||= []).push(row.category_id)
  }
  return map
}

async function replaceHomeCategoryAssignments(
  db: D1Database,
  linkId: string,
  categoryIds: string[],
  insertFirst: boolean
) {
  await db.prepare('DELETE FROM link_category_assignments WHERE link_id = ?').bind(linkId).run()
  const orderedIds = insertFirst ? categoryIds : [...categoryIds]
  if (orderedIds.length === 0) return
  await db.batch(orderedIds.map((categoryId, index) => db.prepare(
    'INSERT INTO link_category_assignments (link_id, category_id, sort_order) VALUES (?, ?, ?)'
  ).bind(linkId, categoryId, index)))
}

// 检测首页是否已存在相同链接：精确匹配（忽略协议/大小写/末尾斜杠）优先，无精确命中时按同域名兜底（忽略路径），返回重复项及其所在分类
// GitHub 链接不做同域名兜底：不同路径代表不同仓库
app.get('/api/tools/duplicates', async (c) => {
  const key = normalizeUrl(c.req.query('url') ?? '')
  if (!key) return c.json({ duplicates: [] })
  const keyDomain = urlDomain(key)
  const pick = (list: any[]) => {
    const exact = list.filter(t => normalizeUrl(t.url) === key)
    if (exact.length > 0) return { duplicates: exact, matchType: 'exact' }
    const byDomain = keyDomain && keyDomain !== 'github.com' ? list.filter(t => t.url && urlDomain(t.url) === keyDomain) : []
    return { duplicates: byDomain, matchType: 'domain' }
  }
  const user = await getUser(c)
  if (user) {
    const { results } = await c.env.DB.prepare(
      `SELECT t.id, t.name, t.url, t.icon, t.bg_color, c.name AS category_name
       FROM user_tools t LEFT JOIN user_categories c ON t.category_id = c.id
       WHERE t.user_id = ?`
    ).bind(user.id).all()
    return c.json(pick((results || []) as any[]))
  }
  // 未登录：比对全局默认链接
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.url, t.icon, t.bg_color, c.name AS category_name
     FROM tools t LEFT JOIN categories c ON t.category_id = c.id`
  ).all()
  return c.json(pick((results || []) as any[]))
})

app.post('/api/tools', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const { name, url, desc, category_id, category_ids, icon, bg_color, text_color, password } = await c.req.json()
  if (!name || !url) return c.json({ error: T(c, '名称和地址不能为空') }, 400)
  const id = crypto.randomUUID()
  const isAdminView = c.req.query('admin') === 'true'

  if (isAdmin(c, user) && isAdminView) {
    // Admin + admin=true: create global default
    const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as max FROM tools WHERE category_id = ?').bind(category_id || '').first() as any
    await c.env.DB.prepare('INSERT INTO tools (id, name, url, desc, category_id, icon, bg_color, text_color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, name, url, desc || '', category_id || '', icon || '', bg_color || '', text_color || '', (maxOrder?.max ?? -1) + 1).run()
    const tool = await c.env.DB.prepare('SELECT * FROM tools WHERE id = ?').bind(id).first()
    // 后台预热该链接的悬停预览截图（不阻塞响应）
    c.executionCtx.waitUntil(preCapture(c.env, url))
    return c.json(tool, 201)
  }

  // Normal user OR admin without admin=true: create personal tool
  const primaryCategoryId = normalizeCategoryIds(category_ids)[0] || category_id || ''
  const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as max FROM user_tools WHERE user_id = ? AND category_id = ?').bind(user.id, primaryCategoryId).first() as any
  await c.env.DB.prepare('INSERT INTO user_tools (id, user_id, name, url, desc, category_id, icon, bg_color, text_color, sort_order, viewed, password) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)').bind(id, user.id, name, url, desc || '', primaryCategoryId, icon || '', bg_color || '', text_color || '', (maxOrder?.max ?? -1) + 1, password || '').run()
  await replaceHomeCategoryAssignments(c.env.DB, id, normalizeCategoryIds(category_ids), false)
  await recordActivity(c, user, 'link_create')
  const tool = await c.env.DB.prepare('SELECT * FROM user_tools WHERE id = ?').bind(id).first()
  // 后台预热该链接的悬停预览截图（不阻塞响应）
  c.executionCtx.waitUntil(preCapture(c.env, url))
  return c.json(tool, 201)
})

// Reorder tools (MUST be before /api/tools/:id to avoid route conflict)
app.put('/api/tools/reorder', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const { order } = await c.req.json() as { order: { id: string; sort_order: number }[] }
  if (!order) return c.json({ error: T(c, '无效参数') }, 400)
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
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const id = c.req.param('id')
  const { name, url, desc, category_id, category_ids, icon, bg_color, text_color, password } = await c.req.json()
  const isAdminView = c.req.query('admin') === 'true'

  if (isAdmin(c, user) && isAdminView) {
    // Admin + admin=true: update global default
    if (name !== undefined) await c.env.DB.prepare('UPDATE tools SET name = ? WHERE id = ?').bind(name, id).run()
    if (url !== undefined) await c.env.DB.prepare('UPDATE tools SET url = ? WHERE id = ?').bind(url, id).run()
    // URL 变更时后台预热新地址的预览截图（不阻塞响应）
    if (url !== undefined) c.executionCtx.waitUntil(preCapture(c.env, url))
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
  if (url !== undefined) await c.env.DB.prepare('UPDATE user_tools SET url = ?, link_status = \'\', last_checked_at = 0, fail_count = 0, last_http_status = 0 WHERE id = ? AND user_id = ?').bind(url, id, user.id).run()
  // URL 变更时后台预热新地址的预览截图（不阻塞响应）
  if (url !== undefined) c.executionCtx.waitUntil(preCapture(c.env, url))
  if (desc !== undefined) await c.env.DB.prepare('UPDATE user_tools SET desc = ? WHERE id = ? AND user_id = ?').bind(desc, id, user.id).run()
  const requestedCategoryIds = normalizeCategoryIds(category_ids)
  const primaryCategoryId = requestedCategoryIds[0] || category_id
  if (primaryCategoryId !== undefined) await c.env.DB.prepare('UPDATE user_tools SET category_id = ? WHERE id = ? AND user_id = ?').bind(primaryCategoryId, id, user.id).run()
  if (category_ids !== undefined) await replaceHomeCategoryAssignments(c.env.DB, id, requestedCategoryIds, false)
  if (icon !== undefined) await c.env.DB.prepare('UPDATE user_tools SET icon = ? WHERE id = ? AND user_id = ?').bind(icon, id, user.id).run()
  if (bg_color !== undefined) await c.env.DB.prepare('UPDATE user_tools SET bg_color = ? WHERE id = ? AND user_id = ?').bind(bg_color, id, user.id).run()
  if (text_color !== undefined) await c.env.DB.prepare('UPDATE user_tools SET text_color = ? WHERE id = ? AND user_id = ?').bind(text_color, id, user.id).run()
  if (password !== undefined) await c.env.DB.prepare('UPDATE user_tools SET password = ? WHERE id = ? AND user_id = ?').bind(password, id, user.id).run()
  await recordActivity(c, user, 'link_update')
  const updated = await c.env.DB.prepare('SELECT * FROM user_tools WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  return c.json(updated || {})
})

app.delete('/api/tools/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
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
  await c.env.DB.prepare('DELETE FROM link_category_assignments WHERE link_id = ?').bind(id).run()
  return c.json({ success: true })
})

// 用户打开首页时触发：检测首页链接（24h 内检测过的自动跳过）
app.post('/api/tools/check', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

  const since = Math.floor(Date.now() / 1000) - 24 * 3600
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, url, fail_count FROM user_tools WHERE user_id = ? AND (last_checked_at IS NULL OR last_checked_at < ?) LIMIT 200'
  ).bind(user.id, since).all()
  const dead = await checkAndSaveLinks(c.env.DB, 'user_tools', results as any[])
  return c.json({ checked: results.length, dead })
})

// Mark tool as viewed
app.post('/api/tools/:id/view', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE user_tools SET viewed = 1 WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true })
})

// Track tool click (increment click_count)
app.post('/api/tools/:id/click', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE user_tools SET click_count = COALESCE(click_count, 0) + 1 WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  await recordActivity(c, user, 'link_click')
  return c.json({ success: true })
})

// Tool Bookmarks (existing) ====================

// ==================== Favicon Cache ====================

const FAVICON_CACHE = 'favicons'

/** R2 key with version suffix — bump so previously cached low-res (sz=64) icons are re-fetched */
const FAVICON_VERSION = '@2'

/** Simple domain hash for R2 key */
function domainKey(url: string): string {
  try {
    const domain = new URL(url).hostname.replace(/^www\./, '')
    // Use hex-encoded domain as key — safe for R2
    return [...domain].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  } catch { return '' }
}

const FAVICON_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** Fetch a URL and return its body only if it looks like a real image */
async function fetchImage(u: string): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  try {
    const resp = await fetch(u, { headers: { 'User-Agent': FAVICON_UA }, redirect: 'follow' })
    if (!resp.ok) return null
    const ct = (resp.headers.get('content-type') || '').toLowerCase()
    if (!ct.startsWith('image/') && !ct.includes('octet-stream')) return null
    const buffer = await resp.arrayBuffer()
    if (buffer.byteLength < 100) return null
    return { buffer, contentType: ct || 'image/png' }
  } catch { return null }
}

/** Pick the largest apple-touch-icon URL declared in the page HTML */
function pickTouchIcon(html: string, origin: string): string | null {
  const tags = html.match(/<link[^>]*>/gi) || []
  let best: { href: string; size: number } | null = null
  for (const tag of tags) {
    const rel = tag.match(/rel=["']([^"']*)["']/i)?.[1]?.toLowerCase() || ''
    if (!rel.includes('apple-touch-icon')) continue
    const href = tag.match(/href=["']([^"']*)["']/i)?.[1]
    if (!href) continue
    const size = parseInt(tag.match(/sizes=["'](\d+)[xX]\d+["']/i)?.[1] || '180', 10)
    if (!best || size > best.size) best = { href, size }
  }
  if (!best) return null
  try { return new URL(best.href, origin).toString() } catch { return null }
}

app.post('/api/favicon', async (c) => {
  const { url } = await c.req.json() as { url: string }
  if (!url) return c.json({ error: T(c, '需要 url') }, 400)

  const key = domainKey(url)
  if (!key) return c.json({ error: T(c, '无效域名') }, 400)

  const r2Key = `${FAVICON_CACHE}/${key}${FAVICON_VERSION}.png`

  // Check R2 cache
  const existing = await c.env.R2.get(r2Key)
  if (existing) {
    return c.json({ icon_url: `/api/favicon-img/${key}${FAVICON_VERSION}.png` })
  }

  const save = async (img: { buffer: ArrayBuffer; contentType: string }) => {
    await c.env.R2.put(r2Key, img.buffer, { httpMetadata: { contentType: img.contentType } })
    return c.json({ icon_url: `/api/favicon-img/${key}${FAVICON_VERSION}.png` })
  }

  let origin = ''
  try { origin = new URL(url).origin } catch { return c.json({ error: T(c, '无效域名') }, 400) }

  // 1. Best quality: the site's own apple-touch-icon (usually 180x180)
  try {
    const page = await fetch(origin, { headers: { 'User-Agent': FAVICON_UA }, redirect: 'follow' })
    const html = page.ok ? await page.text() : ''
    const iconUrl = html ? pickTouchIcon(html, origin) : null
    if (iconUrl) {
      const img = await fetchImage(iconUrl)
      if (img) return await save(img)
    }
  } catch { /* fall through */ }

  // 1b. Conventional path — some sites ship the file without declaring it
  {
    const img = await fetchImage(`${origin}/apple-touch-icon.png`)
    if (img) return await save(img)
  }

  // 2. Google S2 at 128px
  {
    const domain = new URL(url).hostname
    const img = await fetchImage(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`)
    if (img) return await save(img)
  }

  // 3. Last resort: favicon.ico at the domain root
  {
    const img = await fetchImage(`${origin}/favicon.ico`)
    if (img) return await save(img)
  }

  return c.json({ icon_url: '' })
})

app.get('/api/favicon-img/:key', async (c) => {
  const key = c.req.param('key')
  const obj = await c.env.R2.get(`${FAVICON_CACHE}/${key}`)
  if (!obj) return c.json({ error: T(c, '未找到') }, 404)
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/png',
      'Cache-Control': 'public, max-age=31536000',
    },
  })
})

// ==================== Link Metadata（自动填写网页描述） ====================

const LINK_META_CACHE = 'link-meta'

const decodeHtmlEntities = (value: string) => value
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&#(\d+);/g, (match, code) => {
    const point = Number(code)
    return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match
  })
  .replace(/&#x([0-9a-f]+);/gi, (match, code) => {
    const point = parseInt(code, 16)
    return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match
  })
  .replace(/&amp;/gi, '&')

function readHtmlAttribute(tag: string, name: string): string {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = tag.match(re)
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : ''
}

function extractLinkMeta(html: string): { title: string; description: string; site_name: string } {
  const head = html.slice(0, 300_000)
  const metaTags = head.match(/<meta\b[^>]*>/gi) || []
  const values = new Map<string, string>()

  for (const tag of metaTags) {
    const key = (readHtmlAttribute(tag, 'property') || readHtmlAttribute(tag, 'name')).trim().toLowerCase()
    const content = readHtmlAttribute(tag, 'content').trim()
    if (key && content && !values.has(key)) values.set(key, content)
  }

  const title = decodeHtmlEntities(
    values.get('og:title') ||
    head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ||
    ''
  ).replace(/\s+/g, ' ').trim()

  const description = decodeHtmlEntities(
    values.get('og:description') ||
    values.get('twitter:description') ||
    values.get('description') ||
    ''
  ).replace(/\s+/g, ' ').trim()

  const siteName = decodeHtmlEntities(
    values.get('og:site_name') || values.get('application-name') || ''
  ).replace(/\s+/g, ' ').trim()

  return { title, description, site_name: siteName }
}

// 描述抓取：只访问公网 http/https，限制响应体积和超时，结果缓存 7 天
app.get('/api/link-meta', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)

  const url = validatePreviewUrl(c.req.query('url') || '')
  if (!url) return c.json({ error: T(c, '无效的链接地址') }, 400)

  const refresh = c.req.query('refresh') === '1'
  const cacheKey = `${LINK_META_CACHE}/${await sha1Hex(url)}.json`
  if (!refresh) {
    const cached = await c.env.R2.get(cacheKey)
    const createdAt = Number(cached?.customMetadata?.created || 0)
    if (cached && Date.now() - createdAt < 7 * 24 * 3600 * 1000) {
      c.header('Cache-Control', 'private, max-age=3600')
      return c.json(await cached.json())
    }
  }

  try {
    let response: Response | null = null
    let currentUrl = url
    for (let hop = 0; hop < 5; hop++) {
      response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
        headers: {
          'User-Agent': FAVICON_UA,
          'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'Accept-Language': c.req.header('accept-language') || 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      })
      if (response.status < 300 || response.status >= 400) break
      await response.body?.cancel().catch(() => {})
      const location = response.headers.get('location')
      if (!location) break
      const next = validatePreviewUrl(new URL(location, currentUrl).toString())
      if (!next) return c.json({ error: T(c, '无效的链接地址') }, 400)
      currentUrl = next
    }
    if (!response) return c.json({ title: '', description: '', site_name: '' })

    const contentType = (response.headers.get('content-type') || '').toLowerCase()
    const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml') || !contentType
    if (!response.ok || !isHtml) {
      return c.json({ title: '', description: '', site_name: '' })
    }

    const reader = response.body?.getReader()
    if (!reader) return c.json({ title: '', description: '', site_name: '' })

    const chunks: Uint8Array[] = []
    let size = 0
    while (size < 512_000) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      chunks.push(value)
      size += value.byteLength
    }
    await reader.cancel().catch(() => {})

    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const charset = contentType.match(/charset=([^;\s]+)/i)?.[1]?.replace(/["']/g, '')
    let html: string
    try {
      html = new TextDecoder(charset || 'utf-8').decode(bytes)
    } catch {
      html = new TextDecoder('utf-8').decode(bytes)
    }

    const meta = extractLinkMeta(html)
    const result = {
      title: meta.title.slice(0, 300),
      description: meta.description.slice(0, 300),
      site_name: meta.site_name.slice(0, 100),
    }

    if (result.description) {
      await c.env.R2.put(cacheKey, JSON.stringify(result), {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { created: String(Date.now()) },
      })
    }
    c.header('Cache-Control', 'private, max-age=3600')
    return c.json(result)
  } catch (e) {
    console.error('link metadata failed:', url, e)
    return c.json({ title: '', description: '', site_name: '' })
  }
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
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const { results } = await c.env.DB.prepare('SELECT * FROM todos WHERE user_id = ? ORDER BY is_completed ASC, created_at DESC').bind(user.id).all()
  return c.json(results)
})

app.post('/api/todos', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const { content } = await c.req.json() as { content: string }
  if (!content?.trim()) return c.json({ error: T(c, '内容不能为空') }, 400)
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO todos (id, user_id, content) VALUES (?, ?, ?)').bind(id, user.id, content.trim()).run()
  const todo = await c.env.DB.prepare('SELECT * FROM todos WHERE id = ?').bind(id).first()
  return c.json(todo, 201)
})

app.put('/api/todos/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const id = c.req.param('id')
  const todo = await c.env.DB.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!todo) return c.json({ error: T(c, '待办事项不存在') }, 404)
  const { is_completed, content } = await c.req.json() as { is_completed?: number; content?: string }
  if (content !== undefined) await c.env.DB.prepare('UPDATE todos SET content = ? WHERE id = ?').bind(content.trim(), id).run()
  if (is_completed !== undefined) await c.env.DB.prepare('UPDATE todos SET is_completed = ? WHERE id = ?').bind(is_completed, id).run()
  const updated = await c.env.DB.prepare('SELECT * FROM todos WHERE id = ?').bind(id).first()
  return c.json(updated)
})

app.delete('/api/todos/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const id = c.req.param('id')
  const todo = await c.env.DB.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!todo) return c.json({ error: T(c, '待办事项不存在') }, 404)
  await c.env.DB.prepare('DELETE FROM todos WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

 // ==================== Stock Proxy ====================
 
// ---------- 天气（壁纸特效数据源）----------
// 代理 Open-Meteo：无需 key；Cache API 按 0.1° 网格缓存 30 分钟，全站共享限额
const WEATHER_TTL = 1800

function mapWeatherCondition(code: number): 'clear' | 'rain' | 'thunder' | 'snow' | 'cloudy' {
  if (code === 0 || code === 1) return 'clear'
  if (code === 2 || code === 3) return 'cloudy'
  if (code >= 95) return 'thunder'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 51) return 'rain'
  return 'cloudy'
}

app.get('/api/weather', async (c) => {
  const lat = parseFloat(c.req.query('lat') || '')
  const lon = parseFloat(c.req.query('lon') || '')
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return c.json({ error: 'Missing lat/lon' }, 400)
  const gridLat = lat.toFixed(1)
  const gridLon = lon.toFixed(1)
  const upstream = `https://api.open-meteo.com/v1/forecast?latitude=${gridLat}&longitude=${gridLon}&current=weather_code,temperature_2m,apparent_temperature,is_day,wind_speed_10m,precipitation,relative_humidity_2m&hourly=temperature_2m,weather_code,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max&forecast_days=3&timezone=auto`
  // v2：响应结构扩展（hourly/daily），旧缓存无新字段，用版本号区分强制重新拉取
  const cacheKey = new Request(`https://weather-cache.linkpad.site/v2/${gridLat}/${gridLon}`)
  try {
    const cached = await caches.default.match(cacheKey)
    if (cached) return cached
    const res = await fetch(upstream)
    if (!res.ok) return c.json({ error: 'Upstream error' }, 502)
    const data: any = await res.json()
    const cur = data?.current
    if (!cur) return c.json({ error: 'Bad data' }, 502)
    // 未来八小时：从当前小时起切 8 段（timezone=auto，hourly.time 为当地 ISO 串）
    const curHour = String(cur.time || '').slice(0, 13)
    const hTime: string[] = data?.hourly?.time || []
    const hTemp: any[] = data?.hourly?.temperature_2m || []
    const hCode: any[] = data?.hourly?.weather_code || []
    const hPop: any[] = data?.hourly?.precipitation_probability || []
    let startIdx = hTime.findIndex((t) => String(t).slice(0, 13) >= curHour)
    if (startIdx < 0) startIdx = 0
    const hourly = hTime.slice(startIdx, startIdx + 8).map((t, i) => ({
      time: String(t).slice(11, 16),
      temp: Math.round(hTemp[startIdx + i] ?? 0),
      code: hCode[startIdx + i] ?? -1,
      pop: hPop[startIdx + i] ?? 0,
    }))
    const dTime: string[] = data?.daily?.time || []
    const daily = dTime.slice(0, 3).map((d, i) => ({
      date: d,
      code: data?.daily?.weather_code?.[i] ?? -1,
      max: Math.round(data?.daily?.temperature_2m_max?.[i] ?? 0),
      min: Math.round(data?.daily?.temperature_2m_min?.[i] ?? 0),
      pop: data?.daily?.precipitation_probability_max?.[i] ?? 0,
      sunrise: String(data?.daily?.sunrise?.[i] || '').slice(11, 16),
      sunset: String(data?.daily?.sunset?.[i] || '').slice(11, 16),
    }))
    const body = {
      condition: mapWeatherCondition(cur.weather_code ?? -1),
      code: cur.weather_code ?? -1,
      temp: Math.round(cur.temperature_2m ?? 0),
      isDay: cur.is_day === 1,
      wind: cur.wind_speed_10m ?? 0,
      fetchedAt: Date.now(),
      feels: Math.round(cur.apparent_temperature ?? 0),
      humidity: cur.relative_humidity_2m ?? null,
      hourly,
      daily,
    }
    const out = new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${WEATHER_TTL}` },
    })
    c.executionCtx.waitUntil(caches.default.put(cacheKey, out.clone()))
    return out
  } catch {
    return c.json({ error: 'Weather fetch failed' }, 502)
  }
})

// IP 定位兜底：Cloudflare 自带的地理信息（无需第三方服务）
// 注意：request.cf 在 hono 的原始 Request（c.req.raw）上，c.req 上没有
app.get('/api/weather/locate', (c) => {
  const cf: any = (c.req.raw as any).cf
  if (!cf?.latitude || !cf?.longitude) return c.json({ error: 'Unavailable' }, 404)
  return c.json({
    lat: parseFloat(cf.latitude),
    lon: parseFloat(cf.longitude),
    city: cf.city || cf.region || cf.country || '',
  })
})

// 城市搜索：Open-Meteo geocoding（支持中文）
app.get('/api/weather/search', async (c) => {
  const q = (c.req.query('q') || '').trim()
  if (!q) return c.json({ results: [] })
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=zh&format=json`)
    if (!res.ok) return c.json({ results: [] })
    const data: any = await res.json()
    const results = (data?.results || []).map((r: any) => ({
      name: r.name,
      region: [r.admin1, r.country].filter(Boolean).join(' · '),
      lat: r.latitude,
      lon: r.longitude,
    }))
    return c.json({ results })
  } catch {
    return c.json({ results: [] })
  }
})

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
 
// ==================== WeRead 微信读书笔记（官方 Skill API 网关） ====================

const WEREAD_GATEWAY = 'https://i.weread.qq.com/api/agent/gateway'
const WEREAD_SKILL_VERSION = '1.0.4'

async function wereadCall(apiKey: string, apiName: string, params: Record<string, unknown> = {}) {
  const res = await fetch(WEREAD_GATEWAY, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_name: apiName, skill_version: WEREAD_SKILL_VERSION, ...params }),
  })
  if (!res.ok) {
    const err: any = new Error(`微信读书接口异常（HTTP ${res.status}）`)
    err.wereadAuthFail = res.status === 401 || res.status === 403
    throw err
  }
  const data: any = await res.json()
  if (data && typeof data.errcode === 'number' && data.errcode !== 0) {
    const err: any = new Error(data.errmsg || data.errMsg || `微信读书接口错误（${data.errcode}）`)
    err.errcode = data.errcode
    err.wereadAuthFail = [401, 403, -2012, -2013, 40001].includes(data.errcode)
    throw err
  }
  return data
}

// ---------- API Key 加密存储（AES-GCM，密钥从 JWT_SECRET 派生） ----------

async function wereadCipherKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('weread:' + secret))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function encryptApiKey(text: string, secret: string): Promise<string> {
  const key = await wereadCipherKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)))
  const buf = new Uint8Array(iv.length + ct.length)
  buf.set(iv); buf.set(ct, iv.length)
  let bin = ''
  for (const b of buf) bin += String.fromCharCode(b)
  return btoa(bin)
}

async function decryptApiKey(payload: string, secret: string): Promise<string> {
  const buf = Uint8Array.from(atob(payload), ch => ch.charCodeAt(0))
  const key = await wereadCipherKey(secret)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12))
  return new TextDecoder().decode(pt)
}

// 时间桶哈希：同一时间桶内选取稳定，跨桶轮换
function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// 秒/毫秒时间戳统一为秒
const wereadSec = (v: any): number => {
  const n = Number(v) || 0
  return n > 1e12 ? Math.floor(n / 1000) : n
}

// ---------- 增量同步 ----------

async function wereadSync(db: D1Database, secret: string, userId: string, force = false) {
  const settings = await db.prepare('SELECT api_key_enc, last_synced_at FROM weread_settings WHERE user_id = ?').bind(userId).first() as any
  if (!settings) { const e: any = new Error('尚未配置微信读书 API Key'); e.status = 400; throw e }
  const apiKey = await decryptApiKey(settings.api_key_enc, secret)

  // 1. 拉取全部笔记本（有笔记的书，游标分页）
  const notebooks: any[] = []
  let lastSort: number | undefined
  for (let page = 0; page < 10; page++) {
    const params: Record<string, unknown> = { count: 100 }
    if (lastSort !== undefined) params.lastSort = lastSort
    const data = await wereadCall(apiKey, '/user/notebooks', params)
    const list = data.books || []
    notebooks.push(...list)
    if (!data.hasMore || list.length === 0) break
    lastSort = list[list.length - 1].sort
  }

  // 已有书的 last_note_sort，用于增量判断
  const { results: existing } = await db.prepare('SELECT book_id, last_note_sort FROM weread_books WHERE user_id = ?').bind(userId).all() as any
  const prevSort = new Map<string, number>((existing || []).map((r: any) => [r.book_id, r.last_note_sort || 0]))

  const now = Math.floor(Date.now() / 1000)
  const changed: { bookId: string }[] = []
  for (const nb of notebooks) {
    const sort = nb.sort || 0
    await db.prepare(
      `INSERT INTO weread_books (user_id, book_id, title, author, cover, note_count, review_count, last_note_sort, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, book_id) DO UPDATE SET title = excluded.title, author = excluded.author, cover = excluded.cover,
         note_count = excluded.note_count, review_count = excluded.review_count, last_note_sort = excluded.last_note_sort, updated_at = excluded.updated_at`
    ).bind(userId, nb.bookId, nb.book?.title || '', nb.book?.author || '', nb.book?.cover || '', nb.noteCount || 0, nb.reviewCount || 0, sort, now).run()
    if (force || sort > (prevSort.get(nb.bookId) || 0)) changed.push({ bookId: nb.bookId })
  }

  // 2. 对有变化的书并发（每批 5 本）拉取划线 + 想法
  const NOTE_CHUNK = 50
  let syncedNotes = 0
  for (let i = 0; i < changed.length; i += 5) {
    await Promise.all(changed.slice(i, i + 5).map(async ({ bookId }) => {
      const rows: any[] = []
      // 划线（书签已被服务端过滤，type=1）
      try {
        const bm = await wereadCall(apiKey, '/book/bookmarklist', { bookId })
        const chMap = new Map<string, string>((bm.chapters || []).map((ch: any) => [ch.chapterUid, ch.title]))
        for (const u of (bm.updated || [])) {
          if (!u.markText) continue
          rows.push({ id: `h-${u.bookmarkId}`, type: 'highlight', content: u.markText, abstract: '', chapter: chMap.get(u.chapterUid) || '', create_time: wereadSec(u.createTime) })
        }
      } catch {}
      // 想法/点评（划线想法 abstract 有原文）
      try {
        let synckey = 0
        for (let page = 0; page < 5; page++) {
          const rv = await wereadCall(apiKey, '/review/list/mine', { bookid: bookId, synckey, count: 100 })
          for (const it of (rv.reviews || [])) {
            const r = it.review || it
            if (!r.content) continue
            rows.push({ id: `t-${r.reviewId}`, type: 'thought', content: r.content, abstract: r.abstract || '', chapter: r.chapterName || '', create_time: wereadSec(r.createTime) })
          }
          if (!rv.hasMore) break
          synckey = rv.synckey || synckey
        }
      } catch {}
      // 整书替换写入
      const stmts: any[] = [db.prepare('DELETE FROM weread_notes WHERE user_id = ? AND book_id = ?').bind(userId, bookId)]
      for (let j = 0; j < rows.length; j += NOTE_CHUNK) {
        for (const r of rows.slice(j, j + NOTE_CHUNK)) {
          stmts.push(db.prepare('INSERT OR IGNORE INTO weread_notes (id, user_id, book_id, type, content, abstract, chapter, create_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(r.id, userId, bookId, r.type, r.content, r.abstract, r.chapter, r.create_time))
        }
      }
      await db.batch(stmts)
      syncedNotes += rows.length
    }))
  }

  await db.prepare('UPDATE weread_settings SET last_synced_at = ? WHERE user_id = ?').bind(now, userId).run()
  const total = await db.prepare('SELECT COUNT(*) AS n FROM weread_notes WHERE user_id = ?').bind(userId).first() as any
  return { totalBooks: notebooks.length, totalNotes: total?.n || 0, syncedBooks: changed.length, syncedNotes }
}

app.get('/api/weread/config', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const s = await c.env.DB.prepare('SELECT last_synced_at FROM weread_settings WHERE user_id = ?').bind(user.id).first() as any
  const notes = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM weread_notes WHERE user_id = ?').bind(user.id).first() as any
  const books = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM weread_books WHERE user_id = ?').bind(user.id).first() as any
  return c.json({ configured: !!s, lastSyncedAt: s?.last_synced_at || 0, totalNotes: notes?.n || 0, totalBooks: books?.n || 0 })
})

app.post('/api/weread/config', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const { apiKey } = await c.req.json()
  const key = (apiKey || '').trim()
  if (!/^wrk-[A-Za-z0-9]+$/.test(key)) return c.json({ error: T(c, 'API Key 格式不正确（应以 wrk- 开头）') }, 400)
  // 真实调用验证 Key 有效性
  try {
    await wereadCall(key, '/user/notebooks', { count: 1 })
  } catch (e: any) {
    return c.json({ error: e.wereadAuthFail ? T(c, 'API Key 无效或已失效') : (e.message || T(c, '验证失败，请稍后再试')) }, 400)
  }
  const enc = await encryptApiKey(key, c.env.JWT_SECRET)
  await c.env.DB.prepare(
    'INSERT INTO weread_settings (user_id, api_key_enc, last_synced_at) VALUES (?, ?, 0) ON CONFLICT(user_id) DO UPDATE SET api_key_enc = excluded.api_key_enc'
  ).bind(user.id, enc).run()
  return c.json({ success: true })
})

app.delete('/api/weread/config', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM weread_settings WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM weread_books WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM weread_notes WHERE user_id = ?').bind(user.id),
  ])
  return c.json({ success: true })
})

app.post('/api/weread/sync', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const body = await c.req.json().catch(() => ({}))
  try {
    return c.json(await wereadSync(c.env.DB, c.env.JWT_SECRET, user.id, !!body?.force))
  } catch (e: any) {
    if (e.wereadAuthFail) return c.json({ error: T(c, 'API Key 已失效，请重新配置') }, 401)
    return c.json({ error: e.message || T(c, '同步失败') }, e.status || 500)
  }
})

// 当前轮换笔记：时间桶 + 种子哈希确定性随机（同一时段稳定，到点自动切换）
app.get('/api/weread/note', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const hours = Math.max(1, Number(c.req.query('hours')) || 24)
  const widgetId = c.req.query('widgetId') || 'weread'
  const seed = c.req.query('seed') || '' // 「换一批」随机种子：换 seed 即换一批
  const settings = await c.env.DB.prepare('SELECT last_synced_at FROM weread_settings WHERE user_id = ?').bind(user.id).first() as any
  if (!settings) return c.json({ configured: false, note: null, total: 0, stale: false })
  const total = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM weread_notes WHERE user_id = ?').bind(user.id).first() as any)?.n || 0
  if (total === 0) return c.json({ configured: true, note: null, total: 0, stale: false })
  const bucket = Math.floor(Date.now() / (hours * 3600000))
  // 完全随机：对全量笔记做哈希取模（时间桶内稳定，桶/种子变化即随机切换），非按时间排序
  const idx = fnv1a(`${widgetId}:${bucket}:${seed}`) % total
  const note = await c.env.DB.prepare(
    `SELECT n.id, n.book_id, n.type, n.content, n.abstract, n.chapter, n.create_time, b.title AS book_title, b.cover
     FROM weread_notes n LEFT JOIN weread_books b ON b.user_id = n.user_id AND b.book_id = n.book_id
     WHERE n.user_id = ? LIMIT 1 OFFSET ?`
  ).bind(user.id, idx).first()
  const stale = Date.now() / 1000 - (settings.last_synced_at || 0) > 12 * 3600
  return c.json({ configured: true, note, total, stale })
})

app.get('/api/weread/notes', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 30))
  const offset = Math.max(0, Number(c.req.query('offset')) || 0)
  const bookId = c.req.query('bookId') || ''
  const random = c.req.query('random') === '1' // 随机模式：不按时间排序，每次查询随机抽一批
  let sql = `SELECT n.id, n.book_id, n.type, n.content, n.abstract, n.chapter, n.create_time, b.title AS book_title, b.cover
    FROM weread_notes n LEFT JOIN weread_books b ON b.user_id = n.user_id AND b.book_id = n.book_id
    WHERE n.user_id = ?`
  if (bookId) sql += ' AND n.book_id = ?'
  sql += random ? ' ORDER BY RANDOM() LIMIT ?' : ' ORDER BY n.create_time DESC LIMIT ? OFFSET ?'
  const total = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM weread_notes WHERE user_id = ?${bookId ? ' AND book_id = ?' : ''}`)
    .bind(...(bookId ? [user.id, bookId] : [user.id])).first() as any)?.n || 0
  const stmt = random
    ? (bookId
        ? c.env.DB.prepare(sql).bind(user.id, bookId, limit)
        : c.env.DB.prepare(sql).bind(user.id, limit))
    : (bookId
        ? c.env.DB.prepare(sql).bind(user.id, bookId, limit, offset)
        : c.env.DB.prepare(sql).bind(user.id, limit, offset))
  const { results } = await stmt.all()
  return c.json({ notes: results || [], total })
})

app.get('/api/weread/books', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: T(c, '未登录') }, 401)
  const { results } = await c.env.DB.prepare('SELECT book_id, title, author, cover, note_count, review_count, last_note_sort FROM weread_books WHERE user_id = ? ORDER BY last_note_sort DESC').bind(user.id).all()
  return c.json({ books: results || [] })
})

// ==================== Link Preview Screenshots（链接卡片悬停预览） ====================

// 截图长期有效：缓存 key = sha1(url)，URL 变了自然生成新 key 重截；不做按时间过期刷新
const PREVIEW_FAIL_TTL = 3 * 24 * 3600 * 1000 // 截图失败标记有效期（避免反复浪费浏览器会话）
const PREVIEW_PREFIX = 'previews/'

// 同 isolate 内在飞截图任务去重（多用户悬停同一 URL 只触发一次真实截图）
const previewInflight = new Map<string, Promise<Uint8Array | null>>()

async function sha1Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// URL 校验：仅公网 http/https，禁止内网/环回地址（防 SSRF 与滥用）
function validatePreviewUrl(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const h = u.hostname.toLowerCase()
  if (!h || h.includes('localhost') || h.endsWith('.local') || h.endsWith('.internal')) return null
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return null
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return null
  if (h === '0.0.0.0' || h === '[::]' || h === '[::1]') return null
  if (h.includes(':')) {
    // IPv6：环回 / ULA / 链路本地
    const v6 = h.replace(/^\[|\]$/g, '')
    if (/^(::1|::|f[cd]|fe80)/.test(v6)) return null
  }
  return u.toString()
}

async function takeScreenshot(env: Bindings, url: string): Promise<Uint8Array | null> {
  const browser = await launch(env.BROWSER as never)
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 20000 })
    } catch {
      // 超时也继续截当前已渲染画面
    }
    await new Promise((r) => setTimeout(r, 800)) // 等待首屏渲染稳定
    return await page.screenshot({ type: 'jpeg', quality: 60 })
  } catch (e) {
    console.error('preview screenshot failed:', url, e)
    return null
  } finally {
    await browser.close().catch(() => {})
  }
}

// 截图并写入 R2（去重：同 key 在飞时复用同一 Promise）
async function captureAndStore(env: Bindings, url: string, key: string): Promise<Uint8Array | null> {
  const inflight = previewInflight.get(key)
  if (inflight) return inflight
  const p = (async () => {
    const shot = await takeScreenshot(env, url)
    if (shot) {
      await env.R2.put(key, shot, {
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: { url, created: String(Date.now()) },
      })
      await env.R2.delete(key + '.fail') // 成功后清除失败标记（不存在时为空操作）
      return shot
    }
    // 写入失败标记：3 天内悬停/预热不再重复开浏览器
    await env.R2.put(key + '.fail', '', { customMetadata: { url, created: String(Date.now()) } })
    return null
  })()
  previewInflight.set(key, p)
  try {
    return await p
  } finally {
    previewInflight.delete(key)
  }
}

// 预截图串行队列：添加/编辑链接时后台预热，避免批量添加时并发开启过多浏览器会话
let captureQueue: Promise<unknown> = Promise.resolve()

// 添加/编辑链接时后台预热截图：已有缓存则跳过；需配合 executionCtx.waitUntil 注册
function preCapture(env: Bindings, url: string): Promise<void> {
  const u = validatePreviewUrl(url)
  if (!u) return Promise.resolve()
  const task = captureQueue.then(async () => {
    const key = PREVIEW_PREFIX + (await sha1Hex(u))
    const cur = await env.R2.get(key)
    if (cur) return // 已有截图（长期有效），跳过
    const fail = await env.R2.get(key + '.fail')
    const failAt = Number(fail?.customMetadata?.created || 0)
    if (failAt && Date.now() - failAt < PREVIEW_FAIL_TTL) return // 近期失败过，跳过
    await captureAndStore(env, u, key)
  }).catch((e) => console.error('preCapture failed:', u, e))
  captureQueue = task
  return task
}

app.get('/api/preview', async (c) => {
  const url = validatePreviewUrl(c.req.query('url') || '')
  if (!url) return c.json({ error: T(c, '无效的链接地址') }, 400)

  const key = PREVIEW_PREFIX + (await sha1Hex(url))
  const headers = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' }

  const obj = await c.env.R2.get(key)
  if (obj) return c.newResponse(obj.body, 200, headers)

  // 近期截图失败过的地址快速返回，不消耗限流配额、不重复开浏览器
  const fail = await c.env.R2.get(key + '.fail')
  const failAt = Number(fail?.customMetadata?.created || 0)
  if (failAt && Date.now() - failAt < PREVIEW_FAIL_TTL) return c.json({ error: T(c, '预览生成失败') }, 404)

  // 未命中缓存：限流后真实截图
  const { success } = await c.env.PREVIEW_RL.limit({ key: c.req.header('cf-connecting-ip') || 'anon' })
  if (!success) return c.json({ error: T(c, '请求过于频繁，请稍后再试') }, 429)

  const shot = await captureAndStore(c.env, url, key)
  if (!shot) return c.json({ error: T(c, '预览生成失败') }, 404)
  return c.newResponse(shot.buffer as ArrayBuffer, 200, headers)
})

// ==================== 预览截图批量预热（cron 每 15 分钟 + 管理员手动触发） ====================

let warmupRunning = false

// 扫库全部网址（全局默认 + 用户个人 + 仓库链接），校验去重后返回 key -> url
async function listAllPreviewUrls(env: Bindings): Promise<Map<string, string>> {
  const res = await env.DB.prepare(
    'SELECT url FROM tools UNION SELECT url FROM user_tools UNION SELECT url FROM repo_links'
  ).all()
  const map = new Map<string, string>()
  for (const row of res.results as { url: string }[]) {
    const u = validatePreviewUrl(row.url || '')
    if (!u) continue
    const key = PREVIEW_PREFIX + (await sha1Hex(u))
    if (!map.has(key)) map.set(key, u)
  }
  return map
}

// R2 现有缓存清单：key -> created 时间戳（含 .fail 失败标记）
async function listPreviewCache(env: Bindings): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  let cursor: string | undefined
  do {
    const page = await env.R2.list({ prefix: PREVIEW_PREFIX, cursor })
    for (const obj of page.objects) map.set(obj.key, Number(obj.customMetadata?.created || 0))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return map
}

// 预览缓存统计（管理后台用）
async function previewStats(env: Bindings) {
  const [urlMap, cache] = await Promise.all([listAllPreviewUrls(env), listPreviewCache(env)])
  const now = Date.now()
  let cached = 0, missing = 0, failed = 0
  for (const key of urlMap.keys()) {
    const failAt = cache.get(key + '.fail') || 0
    if (failAt && now - failAt < PREVIEW_FAIL_TTL) { failed++; continue }
    if (cache.get(key)) cached++
    else missing++
  }
  return { total: urlMap.size, cached, missing, failed }
}

// 批量预热：补齐缺失截图（截图长期有效，无需按时间刷新）
async function warmupPreviews(env: Bindings, limit: number) {
  if (warmupRunning) return { skipped: true as const, reason: 'warmup already running' }
  warmupRunning = true
  try {
    const [urlMap, cache] = await Promise.all([listAllPreviewUrls(env), listPreviewCache(env)])
    const now = Date.now()
    const todo: { key: string; url: string }[] = []
    for (const [key, url] of urlMap) {
      const failAt = cache.get(key + '.fail') || 0
      if (failAt && now - failAt < PREVIEW_FAIL_TTL) continue // 近期失败过，跳过
      if (!cache.get(key)) todo.push({ key, url })
    }
    const pending = todo.length
    const deadline = Date.now() + 10 * 60 * 1000
    let processed = 0
    for (const { key, url } of todo) {
      if (processed >= limit || Date.now() > deadline) break
      try {
        await captureAndStore(env, url, key)
      } catch (e) {
        console.error('warmup capture failed:', url, e)
      }
      processed++
    }
    return { total: urlMap.size, pending, processed, remaining: Math.max(0, pending - processed) }
  } finally {
    warmupRunning = false
  }
}

// Admin: 预览缓存统计
app.get('/api/admin/preview-stats', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdmin(c, user)) return c.json({ error: T(c, '无权访问') }, 403)
  return c.json(await previewStats(c.env))
})

// Admin: 手动触发一批预热（默认 60，上限 120）
app.post('/api/admin/preview-warmup', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdmin(c, user)) return c.json({ error: T(c, '无权访问') }, 403)
  const limit = Math.min(120, Math.max(1, Number(c.req.query('limit') || 60)))
  return c.json(await warmupPreviews(c.env, limit))
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

// Bing 站长工具验证文件（同上，绕过 assets 层）
app.get('/BingSiteAuth.xml', (c) =>
  c.body('<?xml version="1.0"?>\n<users>\n\t<user>2646D96A640E14D6D009A86DDD6404B9</user>\n</users>\n', 200, {
    'Content-Type': 'application/xml; charset=utf-8',
  })
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

// sitemap：静态页 + 全部公开仓库（动态查询，新建仓库自动进入；每条 URL 附 zh/en hreflang alternates）
app.get('/sitemap.xml', async (c) => {
  const base = 'https://linkpad.site'
  const alt = (loc: string) =>
    `    <xhtml:link rel="alternate" hreflang="zh-CN" href="${escXml(loc)}"/>\n    <xhtml:link rel="alternate" hreflang="en" href="${escXml(loc + '?lang=en')}"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${escXml(loc)}"/>`
  const url = (loc: string, lastmod: string | null, changefreq: string, priority: string) =>
    `  <url>\n    <loc>${escXml(loc)}</loc>\n${alt(loc)}${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`
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
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join('\n')}\n</urlset>`,
    200,
    { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
  )
})

// ==================== SEO：TDK 按语种注入（?lang= > cookie lang > Accept-Language > zh） ====================

const SITE_URL = 'https://linkpad.site'

// 各语种 SEO 文案包
const SEO_TEXT: Record<Lang, {
  homeTitle: string; homeDesc: string; homeKeywords: string
  discoverTitle: string; discoverDesc: string
  userTitle: string; userDesc: string
  repoSuffix: string; repoUntitled: string
  repoDescFallback: (owner: string, name: string, count: number) => string
}> = {
  zh: {
    homeTitle: 'LinkPad - 收藏好链接，分享好品味',
    homeDesc: 'LinkPad 是一个极简导航与链接仓库分享平台：把常用网站整理成专属导航面板，创建公开链接仓库与他人分享好链接。',
    homeKeywords: '导航,书签,链接收藏,链接仓库,网址导航,起始页,LinkPad',
    discoverTitle: '发现优质工具与链接 - LinkPad',
    discoverDesc: '在 LinkPad 发现社区精选的实用工具、AI 应用与优质链接仓库。',
    userTitle: '个人主页 - LinkPad',
    userDesc: 'LinkPad 用户个人主页：查看 TA 收藏整理的公开链接仓库。',
    repoSuffix: ' - LinkPad 链接仓库',
    repoUntitled: '未命名仓库',
    repoDescFallback: (owner, name, count) => `${owner} 收藏整理的链接仓库「${name}」，共 ${count} 个链接。收藏好链接，分享好品味。`,
  },
  en: {
    homeTitle: 'LinkPad - Collect Great Links, Share Great Taste',
    homeDesc: 'LinkPad is a minimalist start page and link-sharing platform: organize your favorite sites into a personal dashboard and share curated link repositories with others.',
    homeKeywords: 'bookmarks,start page,link manager,link repository,speed dial,LinkPad',
    discoverTitle: 'Discover Tools & Links - LinkPad',
    discoverDesc: 'Discover community-picked tools, AI apps and curated link repositories on LinkPad.',
    userTitle: 'Profile - LinkPad',
    userDesc: 'A LinkPad user profile: explore the public link repositories curated by this user.',
    repoSuffix: ' - LinkPad Repository',
    repoUntitled: 'Untitled Repository',
    repoDescFallback: (owner, name, count) => `A link repository "${name}" curated by ${owner}, featuring ${count} links. Collect great links, share great taste.`,
  },
}

function langHtmlAttrs(lang: Lang) {
  return { htmlLang: lang === 'zh' ? 'zh-CN' : 'en', ogLocale: lang === 'zh' ? 'zh_CN' : 'en_US', ogAlt: lang === 'zh' ? 'en_US' : 'zh_CN' }
}

// 用完整 meta 块替换 dist/index.html 的 <title>，并移除静态 description（避免重复）
function injectMeta(html: string, tags: string[]): string {
  html = html.replace(/<html lang="[^"]*"/, `<html lang="${tags[0]}"`)
  // 先删除静态 description 再注入（title 位置在静态 description 之前，顺序反了会误删刚注入的语种版 description）
  html = html.replace(/<meta name="description" content="[^"]*"\s*\/?>/, '')
  html = html.replace(/<title>.*?<\/title>/s, () => tags.slice(1).join('\n    '))
  return html
}

function seoHead(lang: Lang, title: string, desc: string, cleanUrl: string, opts?: { keywords?: string }): string[] {
  const attrs = langHtmlAttrs(lang)
  // en 版自 canonical（?lang=en 自指向），zh/x-default 指向干净 URL
  const canonical = lang === 'en' ? `${cleanUrl}?lang=en` : cleanUrl
  const enUrl = `${cleanUrl}?lang=en`
  return [
    attrs.htmlLang,
    `<title>${escXml(title)}</title>`,
    `<meta name="description" content="${escXml(desc)}" />`,
    opts?.keywords ? `<meta name="keywords" content="${escXml(opts.keywords)}" />` : '',
    `<link rel="canonical" href="${canonical}" />`,
    `<link rel="alternate" hreflang="zh-CN" href="${cleanUrl}" />`,
    `<link rel="alternate" hreflang="en" href="${enUrl}" />`,
    `<link rel="alternate" hreflang="x-default" href="${cleanUrl}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escXml(title)}" />`,
    `<meta property="og:description" content="${escXml(desc)}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:site_name" content="LinkPad" />`,
    `<meta property="og:image" content="${SITE_URL}/logo.png" />`,
    `<meta property="og:locale" content="${attrs.ogLocale}" />`,
    `<meta property="og:locale:alternate" content="${attrs.ogAlt}" />`,
    `<meta name="twitter:card" content="summary" />`,
  ].filter(Boolean)
}

// 首页 / 发现页 / 用户主页：通用 SPA index + 按语种 TDK
async function serveIndexSeo(c: any, build: (lang: Lang) => { title: string; desc: string; keywords?: string; cleanUrl: string }) {
  const url = new URL(c.req.url)
  const lang = htmlLang(url, c.req.header('accept-language'), c.req.header('cookie'))
  const res = await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url).toString()))
  if (res.status !== 200) return c.notFound()
  let html = await res.text()
  const m = build(lang)
  html = injectMeta(html, seoHead(lang, m.title, m.desc, m.cleanUrl, { keywords: m.keywords }))
  // HTML 短缓存 + SWR：新标签页秒开；lang 变体带在 query 上，URL 分键互不污染
  c.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400')
  return c.html(html)
}

app.get('/', (c) => serveIndexSeo(c, (lang) => {
  const tx = SEO_TEXT[lang]
  return { title: tx.homeTitle, desc: tx.homeDesc, keywords: tx.homeKeywords, cleanUrl: `${SITE_URL}/` }
}))

app.get('/discover', (c) => serveIndexSeo(c, (lang) => {
  const tx = SEO_TEXT[lang]
  return { title: tx.discoverTitle, desc: tx.discoverDesc, cleanUrl: `${SITE_URL}/discover` }
}))

app.get('/user/*', (c) => serveIndexSeo(c, (lang) => {
  const tx = SEO_TEXT[lang]
  return { title: tx.userTitle, desc: tx.userDesc, cleanUrl: `${SITE_URL}${c.req.path}` }
}))

// 仓库详情页 SSR meta：AI/GEO 爬虫不执行 JS，meta 必须直接写在 HTML 里（TDK 按语种注入）
app.get('/repo/:id', async (c) => {
  const id = c.req.param('id')
  const lang = htmlLang(new URL(c.req.url), c.req.header('accept-language') ?? null, c.req.header('cookie') ?? null)
  const tx = SEO_TEXT[lang]
  try {
    const repo = await c.env.DB.prepare(
      `SELECT r.name, r.description, r.visibility, r.updated_at, r.link_count, u.nickname AS owner_name
       FROM repositories r LEFT JOIN users u ON u.id = r.user_id WHERE r.id = ?`
    ).bind(id).first() as any

    const indexRes = await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url).toString()))
    if (indexRes.status !== 200) return c.notFound()
    let html = await indexRes.text()

    // 仓库不存在：404 + noindex（浏览器仍渲染 SPA 的错误视图）；no-cache 可存但须回源校验，避免新建仓库后命中 404 缓存
    if (!repo) {
      html = html.replace('</title>', '</title>\n    <meta name="robots" content="noindex, nofollow" />')
      c.header('Cache-Control', 'no-cache')
      return c.html(html, 404)
    }

    // 私有/密码保护仓库：禁止索引（可见性可能随时被改，同样只允许协商缓存）
    if (repo.visibility !== 'public') {
      html = html.replace('</title>', '</title>\n    <meta name="robots" content="noindex, nofollow" />')
      c.header('Cache-Control', 'no-cache')
      return c.html(html)
    }

    const cleanUrl = `https://linkpad.site/repo/${encodeURIComponent(id)}`
    const name = repo.name || tx.repoUntitled
    const owner = repo.owner_name || (lang === 'en' ? 'Someone' : 'TA')
    const desc = (repo.description || tx.repoDescFallback(owner, name, repo.link_count ?? 0)).slice(0, 200)
    const lastmod = toW3c(repo.updated_at)
    const attrs = langHtmlAttrs(lang)
    const meta = [
      `<title>${escXml(name)}${tx.repoSuffix}</title>`,
      `<meta name="description" content="${escXml(desc)}" />`,
      `<link rel="canonical" href="${lang === 'en' ? cleanUrl + '?lang=en' : cleanUrl}" />`,
      `<link rel="alternate" hreflang="zh-CN" href="${cleanUrl}" />`,
      `<link rel="alternate" hreflang="en" href="${cleanUrl}?lang=en" />`,
      `<link rel="alternate" hreflang="x-default" href="${cleanUrl}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:title" content="${escXml(name)}${tx.repoSuffix}" />`,
      `<meta property="og:description" content="${escXml(desc)}" />`,
      `<meta property="og:url" content="${lang === 'en' ? cleanUrl + '?lang=en' : cleanUrl}" />`,
      `<meta property="og:site_name" content="LinkPad" />`,
      `<meta property="og:image" content="https://linkpad.site/logo.png" />`,
      `<meta property="og:locale" content="${attrs.ogLocale}" />`,
      `<meta property="og:locale:alternate" content="${attrs.ogAlt}" />`,
      `<meta name="twitter:card" content="summary" />`,
      lastmod ? `<meta property="og:updated_time" content="${lastmod}" />` : '',
      `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name,
        description: repo.description || undefined,
        url: cleanUrl,
        inLanguage: attrs.htmlLang,
        isPartOf: { '@type': 'WebSite', name: 'LinkPad', url: 'https://linkpad.site/' },
        author: repo.owner_name ? { '@type': 'Person', name: repo.owner_name } : undefined,
        dateModified: lastmod || undefined,
      })}</script>`,
    ].filter(Boolean).join('\n    ')

    // 用函数替换，避免 meta 内容中的 $ 序列被解释为替换模式
    html = html.replace(/<title>.*?<\/title>/s, () => meta)
    html = html.replace(/<html lang="[^"]*"/, `<html lang="${attrs.htmlLang}"`)
    html = html.replace(/<meta name="description" content="[^"]*"\s*\/?>/, '')
    c.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400')
    return c.html(html)
  } catch (e) {
    console.error('[repo-meta] failed:', c.req.path, e)
    // 出错时回退普通 SPA 页面
    const res = await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url).toString()))
    if (res.status === 200) {
      return new Response(res.body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' } })
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
    // HTML 短缓存（5 分钟）+ 后台 SWR：assets 文件名带 hash，新版本最迟 ~5 分钟生效
    if (response.headers.get('content-type')?.includes('text/html')) {
      headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400')
      headers.delete('Pragma')
      headers.delete('Expires')
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

// ==================== Link Check Core ====================

type LinkCheckResult = { status: 'ok' | 'dead' | 'warning' | 'skip'; http_status: number }

/** 检测单个 URL：HEAD 优先（405/403/501 时降级 GET），8s 超时，不下载 body */
async function checkUrl(url: string): Promise<LinkCheckResult> {
  if (!/^https?:\/\//i.test(url)) return { status: 'skip', http_status: 0 }
  const doFetch = (method: string) => fetch(url, {
    method,
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
    // 浏览器 UA：部分反爬站点（如小红书）对 bot UA 返回 404，会造成误判
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  })
  let resp: Response
  try {
    resp = await doFetch('HEAD')
    if ([405, 403, 404, 410, 501].includes(resp.status)) {
      resp = await doFetch('GET') // HEAD 被拒或 404：部分站点 HEAD 行为异常，GET 复核一次
    }
  } catch {
    return { status: 'warning', http_status: 0 } // DNS/连接失败或超时：数据中心访问失败≠链接失效（反爬/地域限制常见误报），永不标死
  }
  try { await resp.body?.cancel() } catch { /* ignore */ }
  if (resp.status >= 200 && resp.status < 400) return { status: 'ok', http_status: resp.status }
  // 530 是 Cloudflare 特有的源站不可达（域名失效/源站挂了），等同死链
  if (resp.status === 404 || resp.status === 410 || resp.status === 530) return { status: 'dead', http_status: resp.status }
  // 401/403/429/5xx：多半是登录墙/防盗链/反爬，标存疑不算死
  return { status: 'warning', http_status: resp.status }
}

/**
 * 批量检测并写回结果（并发 10），返回失效链接列表
 * 判定：ok 重置计数；404/410/530 走双确认（连续 2 次才标死，防偶发抖动误报）；网络错误与 403/412/429/5xx 一律 warning 永不标死
 */
async function checkAndSaveLinks(db: D1Database, table: 'user_tools' | 'repo_links', links: any[]): Promise<any[]> {
  const now = Math.floor(Date.now() / 1000)
  const dead: any[] = []
  const updates: D1PreparedStatement[] = []
  for (let i = 0; i < links.length; i += 10) {
    const batch = links.slice(i, i + 10)
    const settled = await Promise.allSettled(batch.map((l: any) => checkUrl(l.url)))
    settled.forEach((r, j) => {
      if (r.status !== 'fulfilled') return
      const link = batch[j]
      const res = r.value
      if (res.status === 'skip') return
      let linkStatus: string, failCount: number
      if (res.status === 'ok') {
        linkStatus = 'ok'; failCount = 0
      } else if (res.status === 'dead') {
        failCount = (link.fail_count || 0) + 1
        linkStatus = failCount >= 2 ? 'dead' : 'warning'
      } else {
        linkStatus = 'warning'; failCount = link.fail_count || 0
      }
      updates.push(db.prepare(
        `UPDATE ${table} SET link_status = ?, last_checked_at = ?, fail_count = ?, last_http_status = ? WHERE id = ?`
      ).bind(linkStatus, now, failCount, res.http_status, link.id))
      if (linkStatus === 'dead') {
        dead.push({ id: link.id, name: link.name, url: link.url, http_status: res.http_status })
      }
    })
  }
  if (updates.length) await db.batch(updates)
  return dead
}

/** 定时兜底扫描：每轮每表取最久未检测的 250 条（走 last_checked_at 索引），滚动覆盖全量 */
async function runLinkCheckCron(env: Bindings) {
  const since = Math.floor(Date.now() / 1000) - 24 * 3600
  const toolsRes = await env.DB.prepare(
    'SELECT id, name, url, fail_count FROM user_tools WHERE last_checked_at < ? ORDER BY last_checked_at ASC LIMIT 250'
  ).bind(since).all()
  await checkAndSaveLinks(env.DB, 'user_tools', toolsRes.results as any[])
  const linksRes = await env.DB.prepare(
    'SELECT id, name, url, fail_count FROM repo_links WHERE last_checked_at < ? ORDER BY last_checked_at ASC LIMIT 250'
  ).bind(since).all()
  await checkAndSaveLinks(env.DB, 'repo_links', linksRes.results as any[])
}

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: Bindings, _ctx: ExecutionContext) => {
    try {
      await runLinkCheckCron(env)
    } catch (e) {
      console.error('[cron] link check failed:', e)
    }
    try {
      // notifications 清理：已读且超 90 天（走 created_at 索引范围删除，防无界增长）
      await env.DB.prepare("DELETE FROM notifications WHERE is_read = 1 AND created_at < datetime('now', '-90 days')").run()
    } catch (e) {
      console.error('[cron] notifications cleanup failed:', e)
    }
  },
}
