import { t, getLang } from './i18n'

const API_BASE = 'https://linkpad.site'

function getToken(): string | null {
  return localStorage.getItem('linkpad_token')
}

function setToken(token: string | null) {
  if (token) localStorage.setItem('linkpad_token', token)
  else localStorage.removeItem('linkpad_token')
}

export { getToken, setToken, API_BASE }

async function request(path: string, options: RequestInit = {}) {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Lang': getLang(),
    ...(options.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: t('请求失败') }))
    const e = new Error(err.error || `HTTP ${res.status}`)
    ;(e as any).status = res.status
    throw e
  }
  try {
    return await res.json()
  } catch {
    // 响应不是合法 JSON（如网关/故障页返回了 HTML）
    const e = new Error(t('响应格式错误'))
    ;(e as any).status = res.status
    throw e
  }
}

// Auth
export const auth = {
  register: (data: { email: string; password: string; nickname?: string }) =>
    request('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data: { email: string; password: string }) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request('/api/auth/me'),
  sendResetCode: (email: string) =>
    request('/api/auth/reset-code', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (data: { email: string; code: string; password: string }) =>
    request('/api/auth/reset-password', { method: 'POST', body: JSON.stringify(data) }),
}

// Activity / browser extension tracking
export const activity = {
  heartbeat: () => request('/api/activity/heartbeat', { method: 'POST', body: '{}' }),
  events: (events: Partial<Record<'page_view' | 'scroll' | 'click' | 'search' | 'auth', number>>) =>
    request('/api/activity/events', { method: 'POST', body: JSON.stringify({ events }) }),
}

export const extensionTracking = {
  link: (data: { install_id: string; version?: string }) =>
    request('/api/extension/track', {
      method: 'POST',
      body: JSON.stringify({ ...data, event: 'link' }),
    }),
}

// User
export const users = {
  get: (id: string) => request(`/api/users/${id}`),
  followers: (id: string) => request(`/api/users/${id}/followers`),
  following: (id: string) => request(`/api/users/${id}/following`),
  repos: (id: string) => request(`/api/users/${id}/repos`),
  update: (data: { nickname?: string; avatar_url?: string }) =>
    request('/api/users/me', { method: 'PUT', body: JSON.stringify(data) }),
}

// Repos
export const repos = {
  list: () => request('/api/repos'),
  create: (data: { name: string; description?: string; visibility?: string; password?: string; categories?: string[] }) =>
    request('/api/repos', { method: 'POST', body: JSON.stringify(data) }),
  get: (id: string, password?: string) =>
    request(`/api/repos/${id}${password ? `?password=${encodeURIComponent(password)}` : ''}`),
  update: (id: string, data: any) =>
    request(`/api/repos/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request(`/api/repos/${id}`, { method: 'DELETE' }),
  links: {
    list: (id: string) => request(`/api/repos/${id}/links`),
    create: (id: string, data: { name: string; url: string; icon?: string; category_id?: string; category_ids?: string[]; desc?: string }) =>
      request(`/api/repos/${id}/links`, { method: 'POST', body: JSON.stringify(data) }),
    duplicates: (id: string, url: string, exclude?: string) =>
      request(`/api/repos/${id}/links/duplicates?url=${encodeURIComponent(url)}${exclude ? `&exclude=${encodeURIComponent(exclude)}` : ''}`),
  },
  categories: {
    add: (id: string, name: string) =>
      request(`/api/repos/${id}/categories`, { method: 'POST', body: JSON.stringify({ name }) }),
    remove: (id: string, name: string) =>
      request(`/api/repos/${id}/categories/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    rename: (id: string, oldName: string, newName: string) =>
      request(`/api/repos/${id}/categories/${encodeURIComponent(oldName)}`, { method: 'PUT', body: JSON.stringify({ name: newName }) }),
    reorder: (id: string, order: { name: string; sort_order: number }[]) =>
      request(`/api/repos/${id}/categories/reorder`, { method: 'PUT', body: JSON.stringify({ order }) }),
  },
  members: {
    list: (id: string) => request(`/api/repos/${id}/members`),
    add: (id: string, data: { nickname?: string; email?: string }) =>
      request(`/api/repos/${id}/members`, { method: 'POST', body: JSON.stringify(data) }),
    remove: (id: string, userId: string) =>
      request(`/api/repos/${id}/members/${userId}`, { method: 'DELETE' }),
  },
  uploadIcon: async (id: string, file: File): Promise<string> => {
    const token = getToken()
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${API_BASE}/api/repos/${id}/icon`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData,
    })
    if (!res.ok) throw new Error((await res.json()).error || t('上传失败'))
    return (await res.json()).icon_key
  },
}

// Upload
export async function uploadAvatar(file: File): Promise<string> {
  const token = getToken()
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${API_BASE}/api/upload/avatar`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: t('上传失败') }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  const data = await res.json()
  return data.avatar_url
}

// User Wallpapers（图片走带鉴权的 blob URL，保证仅本人可用）
export const wallpapers = {
  list: () => request('/api/wallpapers'),
  upload: async (file: File): Promise<any> => {
    const token = getToken()
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${API_BASE}/api/wallpapers`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: t('上传失败') }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    return res.json()
  },
  remove: (id: string) => request(`/api/wallpapers/${id}`, { method: 'DELETE' }),
}

const wallpaperBlobUrls = new Map<string, Promise<string>>()

// 壁纸图片持久缓存（Cache Storage）：blob URL 不跨页面，避免每次新标签页都重新下载
const WALLPAPER_CACHE = 'linkpad-wallpapers-v1'

async function fetchWallpaperBlob(id: string): Promise<Blob> {
  const token = getToken()
  const url = `${API_BASE}/api/wallpapers/${id}/image`
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {}
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(WALLPAPER_CACHE)
      const hit = await cache.match(url)
      if (hit) return await hit.blob()
      const res = await fetch(url, { headers })
      if (!res.ok) throw new Error('加载失败')
      const blob = await res.blob()
      // 存纯净 Response，剥离 Vary/Authorization 语义，后续无鉴权头也能命中
      await cache.put(url, new Response(blob))
      return blob
    }
  } catch {}
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error('加载失败')
  return res.blob()
}

export function getWallpaperUrl(id: string): Promise<string> {
  if (!wallpaperBlobUrls.has(id)) {
    const p = fetchWallpaperBlob(id)
      .then(b => URL.createObjectURL(b)).catch(() => {
        wallpaperBlobUrls.delete(id)
        return ''
      })
    wallpaperBlobUrls.set(id, p)
  }
  return wallpaperBlobUrls.get(id)!
}

export function invalidateWallpaperUrl(id: string) {
  const p = wallpaperBlobUrls.get(id)
  if (p) p.then(url => { if (url) URL.revokeObjectURL(url) }).catch(() => {})
  wallpaperBlobUrls.delete(id)
  if (typeof caches !== 'undefined') {
    caches.open(WALLPAPER_CACHE)
      .then(c => c.delete(`${API_BASE}/api/wallpapers/${id}/image`)).catch(() => {})
  }
}

// Links
export const links = {
  update: (id: string, data: { name?: string; url?: string; icon?: string; category_id?: string; bg_color?: string; text_color?: string; desc?: string }) =>
    request(`/api/links/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => request(`/api/links/${id}`, { method: 'DELETE' }),
  reorder: (repoId: string, order: { id: string; sort_order: number }[]) =>
    request(`/api/repos/${repoId}/links/reorder`, { method: 'PUT', body: JSON.stringify({ order }) }),
  checkDead: (repoId: string) => request(`/api/repos/${repoId}/links/check`, { method: 'POST' }),
}

// Follows
export const follows = {
  user: {
    follow: (userId: string) => request(`/api/follows/user/${userId}`, { method: 'POST' }),
    unfollow: (userId: string) => request(`/api/follows/user/${userId}`, { method: 'DELETE' }),
  },
  repo: {
    follow: (repoId: string, category_id?: string, skip_link_ids?: string[]) =>
      request(`/api/follows/repo/${repoId}`, { method: 'POST', body: JSON.stringify({ category_id, skip_link_ids }) }),
    unfollow: (repoId: string) => request(`/api/follows/repo/${repoId}`, { method: 'DELETE' }),
    duplicates: (repoId: string) => request(`/api/follows/repo/${repoId}/duplicates`),
    view: (repoId: string) => request(`/api/follows/repo/${repoId}/view`, { method: 'POST' }),
  },
}

// Bookmarks
export const bookmarks = {
  repo: {
    add: (repoId: string) => request(`/api/bookmarks/repo/${repoId}`, { method: 'POST' }),
    remove: (repoId: string) => request(`/api/bookmarks/repo/${repoId}`, { method: 'DELETE' }),
  },
  tool: {
    add: (toolId: string) => request(`/api/bookmarks/tool/${toolId}`, { method: 'POST' }),
    remove: (toolId: string) => request(`/api/bookmarks/tool/${toolId}`, { method: 'DELETE' }),
    list: () => request('/api/bookmarks'),
  },
}

// Me
export const me = {
  followedRepos: () => request('/api/me/followed-repos'),
  bookmarkedRepos: () => request('/api/me/bookmarked-repos'),
}

// Discover
export const discover = {
  repos: () => request('/api/discover/repos'),
  columns: () => request('/api/discover'),
}

// Categories & Tools
export const categories = {
  list: (params?: { admin?: boolean }) => {
    const q = new URLSearchParams()
    if (params?.admin) q.set('admin', 'true')
    return request(`/api/categories?${q}`)
  },
  create: (data: { name: string; icon?: string; parent_id?: string; password?: string }, params?: { admin?: boolean }) => {
    const q = new URLSearchParams()
    if (params?.admin) q.set('admin', 'true')
    const query = q.toString()
    return request(`/api/categories${query ? '?' + query : ''}`, { method: 'POST', body: JSON.stringify(data) })
  },
  update: (id: string, data: { name?: string; icon?: string; parent_id?: string; password?: string }, params?: { admin?: boolean }) => {
    const q = new URLSearchParams()
    if (params?.admin) q.set('admin', 'true')
    const query = q.toString()
    return request(`/api/categories/${id}${query ? '?' + query : ''}`, { method: 'PUT', body: JSON.stringify(data) })
  },
  delete: (id: string, params?: { admin?: boolean }) => {
    const q = new URLSearchParams()
    if (params?.admin) q.set('admin', 'true')
    const query = q.toString()
    return request(`/api/categories/${id}${query ? '?' + query : ''}`, { method: 'DELETE' })
  },
  reorder: (order: { id: string; sort_order: number }[], params?: { admin?: boolean }) => {
    const q = new URLSearchParams()
    if (params?.admin) q.set('admin', 'true')
    const query = q.toString()
    return request(`/api/categories/reorder${query ? '?' + query : ''}`, { method: 'PUT', body: JSON.stringify({ order }) })
  },
}

export const tools = {
  list: (params?: { categoryId?: string; search?: string; admin?: boolean }) => {
    const q = new URLSearchParams()
    if (params?.categoryId) q.set('categoryId', params.categoryId)
    if (params?.search) q.set('search', params.search)
    if (params?.admin) q.set('admin', 'true')
    return request(`/api/tools?${q}`)
  },
  duplicates: (url: string) => request(`/api/tools/duplicates?url=${encodeURIComponent(url)}`),
  create: (data: { name: string; url: string; desc?: string; category_id?: string; category_ids?: string[]; icon?: string; bg_color?: string; text_color?: string; password?: string }, params?: { admin?: boolean }) => {
    const q = new URLSearchParams()
    if (params?.admin) q.set('admin', 'true')
    const query = q.toString()
    return request(`/api/tools${query ? '?' + query : ''}`, { method: 'POST', body: JSON.stringify(data) })
  },
  update: (id: string, data: { name?: string; url?: string; desc?: string; category_id?: string; icon?: string; bg_color?: string; text_color?: string; password?: string }, params?: { admin?: boolean }) => {
    const q = new URLSearchParams()
    if (params?.admin) q.set('admin', 'true')
    const query = q.toString()
    return request(`/api/tools/${id}${query ? '?' + query : ''}`, { method: 'PUT', body: JSON.stringify(data) })
  },
  delete: (id: string, params?: { force?: boolean; admin?: boolean }) => {
    const q = new URLSearchParams()
    if (params?.force) q.set('force', 'true')
    if (params?.admin) q.set('admin', 'true')
    const query = q.toString()
    return request(`/api/tools/${id}${query ? '?' + query : ''}`, { method: 'DELETE' })
  },
  view: (id: string) => request(`/api/tools/${id}/view`, { method: 'POST' }),
  reorder: (order: { id: string; sort_order: number }[], params?: { admin?: boolean }) => {
    const q = new URLSearchParams()
    if (params?.admin) q.set('admin', 'true')
    const query = q.toString()
    return request(`/api/tools/reorder${query ? '?' + query : ''}`, { method: 'PUT', body: JSON.stringify({ order }) })
  },
  checkDead: () => request('/api/tools/check', { method: 'POST' }) as Promise<{ checked: number; dead: any[] }>,
}

// Favicon cache
export const faviconCache = {
  resolve: (url: string) =>
    request('/api/favicon', { method: 'POST', body: JSON.stringify({ url }) }) as Promise<{ icon_url: string }>,
}

// 链接网页元信息（自动填写描述）
export const linkMeta = {
  resolve: (url: string, refresh = false) =>
    request(`/api/link-meta?url=${encodeURIComponent(url)}${refresh ? '&refresh=1' : ''}`) as Promise<{
      title?: string
      description?: string
      site_name?: string
    }>,
}

// Todos
export const todos = {
  list: () => request('/api/todos') as Promise<any[]>,
  create: (content: string) =>
    request('/api/todos', { method: 'POST', body: JSON.stringify({ content }) }) as Promise<any>,
  update: (id: string, data: { is_completed?: number; content?: string }) =>
    request(`/api/todos/${id}`, { method: 'PUT', body: JSON.stringify(data) }) as Promise<any>,
  delete: (id: string) =>
    request(`/api/todos/${id}`, { method: 'DELETE' }) as Promise<any>,
}

// Weather（壁纸天气特效 / 天气卡片组件）
export interface WeatherData {
  condition: 'clear' | 'cloudy' | 'rain' | 'thunder' | 'snow'
  code: number
  temp: number
  isDay: boolean
  wind: number
  fetchedAt: number
  feels?: number
  humidity?: number | null
  hourly?: { time: string; temp: number; code: number; pop: number }[]
  daily?: { date: string; code: number; max: number; min: number; pop: number; sunrise: string; sunset: string }[]
}

export const weather = {
  // v=2：绕开边缘缓存的旧 schema 响应（hourly/daily 扩展字段）
  get: (lat: number, lon: number) =>
    request(`/api/weather?lat=${lat}&lon=${lon}&v=2`) as Promise<WeatherData>,
  locate: () => request('/api/weather/locate') as Promise<{ lat: number; lon: number; city: string }>,
  search: (q: string) => request(`/api/weather/search?q=${encodeURIComponent(q)}`) as Promise<{ results: { name: string; region: string; lat: number; lon: number }[] }>,
}

// Stocks
export const stocks = {
   quote: async (symbols: string[]): Promise<any[]> => {
     if (!symbols.length) return []
     try {
       const res = await fetch(`${API_BASE}/api/stock/quote?symbols=${encodeURIComponent(symbols.join(','))}`)
       if (!res.ok) return []
       const data = await res.json()
       return data?.quoteResponse?.result || []
     } catch { return [] }
   },
   search: async (query: string): Promise<any[]> => {
     if (!query.trim()) return []
     try {
       const res = await fetch(`${API_BASE}/api/stock/search?q=${encodeURIComponent(query)}`)
       if (!res.ok) return []
       const data = await res.json()
       return data?.quotes || []
    } catch { return [] }
  },
}

export const gold = {
  price: async (): Promise<any> => {
    try {
      const res = await fetch(`${API_BASE}/api/gold/price`)
      if (!res.ok) return null
      const data = await res.json()
      return data?.quoteResponse?.result?.[0] || null
    } catch { return null }
  },
}

// User Preferences (widgets + order synced to cloud)
export const userPrefs = {
  // 失败时向上抛出，调用方不能把「请求失败」误当成「用户没有组件」
  load: () => request('/api/user/widgets') as Promise<{ widgets: any[]; itemOrder: Record<string, string[]>; countdownEvents?: any[] }>,
  save: async (data: { widgets: any[]; itemOrder?: Record<string, string[]>; countdownEvents?: any[] }) => {
    try {
      return await request('/api/user/widgets', { method: 'POST', body: JSON.stringify(data) })
    } catch {}
  },
  saveLang: async (lang: string) => {
    try {
      return await request('/api/user/lang', { method: 'POST', body: JSON.stringify({ lang }) })
    } catch {}
  },
}

// WeRead 微信读书笔记
export const weread = {
  config: {
    get: () => request('/api/weread/config') as Promise<{ configured: boolean; lastSyncedAt: number; totalNotes: number; totalBooks: number }>,
    save: (apiKey: string) => request('/api/weread/config', { method: 'POST', body: JSON.stringify({ apiKey }) }),
    remove: () => request('/api/weread/config', { method: 'DELETE' }),
  },
  sync: (force = false) => request('/api/weread/sync', { method: 'POST', body: JSON.stringify({ force }) }) as Promise<{ totalBooks: number; totalNotes: number; syncedBooks: number; syncedNotes: number }>,
  note: (hours: number, widgetId: string, seed = '') =>
    request(`/api/weread/note?hours=${hours}&widgetId=${encodeURIComponent(widgetId)}&seed=${encodeURIComponent(seed)}`) as Promise<{ configured: boolean; note: WereadNote | null; total: number; stale: boolean }>,
  notes: (params?: { limit?: number; offset?: number; bookId?: string; random?: boolean }) => {
    const q = new URLSearchParams()
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.offset) q.set('offset', String(params.offset))
    if (params?.bookId) q.set('bookId', params.bookId)
    if (params?.random) q.set('random', '1')
    return request(`/api/weread/notes?${q}`) as Promise<{ notes: WereadNote[]; total?: number }>
  },
  books: () => request('/api/weread/books') as Promise<{ books: any[] }>,
}

export interface WereadNote {
  id: string
  book_id: string
  type: 'highlight' | 'thought'
  content: string
  abstract?: string
  chapter?: string
  create_time?: number
  book_title?: string
  cover?: string
}

// Admin
export const admin = {
  check: () => request('/api/admin/check') as Promise<{ isAdmin: boolean }>,
  overview: () => request('/api/admin/overview') as Promise<{
    users: number
    extensionUsers: number
    extensionInstalls: number
    today: { uv: number; pv: number }
    trend: Array<{ date: string; uv: number; pv: number }>
  }>,
  users: {
    list: (params?: { nickname?: string; email?: string; status?: string }) => {
      const q = new URLSearchParams()
      if (params?.nickname) q.set('nickname', params.nickname)
      if (params?.email) q.set('email', params.email)
      if (params?.status) q.set('status', params.status)
      return request(`/api/admin/users?${q}`) as Promise<{ items: any[]; nextCursor: string | null }>
    },
    setStatus: (id: string, status: string) =>
      request(`/api/admin/users/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    delete: (id: string) =>
      request(`/api/admin/users/${id}`, { method: 'DELETE' }),
  },
  repos: {
    list: (params?: { search?: string; visibility?: string; ownerEmail?: string }) => {
      const q = new URLSearchParams()
      if (params?.search) q.set('search', params.search)
      if (params?.visibility) q.set('visibility', params.visibility)
      if (params?.ownerEmail) q.set('ownerEmail', params.ownerEmail)
      return request(`/api/admin/repos?${q}`) as Promise<{ items: any[]; nextCursor: string | null }>
    },
    setVisibility: (id: string, visibility: string) =>
      request(`/api/admin/repos/${id}/visibility`, { method: 'PUT', body: JSON.stringify({ visibility }) }),
    delete: (id: string) =>
      request(`/api/admin/repos/${id}`, { method: 'DELETE' }),
  },
}
