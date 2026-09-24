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
    ...(options.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }))
    const e = new Error(err.error || `HTTP ${res.status}`)
    ;(e as any).status = res.status
    throw e
  }
  try {
    return await res.json()
  } catch {
    // 响应不是合法 JSON（如网关/故障页返回了 HTML）
    const e = new Error('响应格式错误')
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
    create: (id: string, data: { name: string; url: string; icon?: string; category_id?: string; desc?: string }) =>
      request(`/api/repos/${id}/links`, { method: 'POST', body: JSON.stringify(data) }),
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
    if (!res.ok) throw new Error((await res.json()).error || '上传失败')
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
    const err = await res.json().catch(() => ({ error: '上传失败' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  const data = await res.json()
  return data.avatar_url
}

// Links
export const links = {
  update: (id: string, data: { name?: string; url?: string; icon?: string; category_id?: string; bg_color?: string; text_color?: string; desc?: string }) =>
    request(`/api/links/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => request(`/api/links/${id}`, { method: 'DELETE' }),
  reorder: (repoId: string, order: { id: string; sort_order: number }[]) =>
    request(`/api/repos/${repoId}/links/reorder`, { method: 'PUT', body: JSON.stringify({ order }) }),
}

// Follows
export const follows = {
  user: {
    follow: (userId: string) => request(`/api/follows/user/${userId}`, { method: 'POST' }),
    unfollow: (userId: string) => request(`/api/follows/user/${userId}`, { method: 'DELETE' }),
  },
  repo: {
    follow: (repoId: string, category_id?: string) => request(`/api/follows/repo/${repoId}`, { method: 'POST', body: JSON.stringify({ category_id }) }),
    unfollow: (repoId: string) => request(`/api/follows/repo/${repoId}`, { method: 'DELETE' }),
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
  create: (data: { name: string; url: string; desc?: string; category_id?: string; icon?: string; bg_color?: string; text_color?: string; password?: string }, params?: { admin?: boolean }) => {
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
}

// Favicon cache
export const faviconCache = {
  resolve: (url: string) =>
    request('/api/favicon', { method: 'POST', body: JSON.stringify({ url }) }) as Promise<{ icon_url: string }>,
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
  load: async () => {
    try {
      return await request('/api/user/widgets') as { widgets: any[]; itemOrder: Record<string, string[]> }
    } catch { return { widgets: [], itemOrder: {} } }
  },
  save: async (data: { widgets: any[]; itemOrder?: Record<string, string[]> }) => {
    try {
      return await request('/api/user/widgets', { method: 'POST', body: JSON.stringify(data) })
    } catch {}
  },
}

// Admin
export const admin = {
  check: () => request('/api/admin/check') as Promise<{ isAdmin: boolean }>,
  users: {
    list: (params?: { nickname?: string; email?: string; status?: string }) => {
      const q = new URLSearchParams()
      if (params?.nickname) q.set('nickname', params.nickname)
      if (params?.email) q.set('email', params.email)
      if (params?.status) q.set('status', params.status)
      return request(`/api/admin/users?${q}`) as Promise<any[]>
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
      return request(`/api/admin/repos?${q}`) as Promise<any[]>
    },
    setVisibility: (id: string, visibility: string) =>
      request(`/api/admin/repos/${id}/visibility`, { method: 'PUT', body: JSON.stringify({ visibility }) }),
    delete: (id: string) =>
      request(`/api/admin/repos/${id}`, { method: 'DELETE' }),
  },
}
