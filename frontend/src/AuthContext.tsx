import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { auth, getToken, setToken } from './api'

export interface User {
  id: string
  email: string
  nickname: string
  avatar_url: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, nickname?: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

// 登录态本地快照：新标签页先同步读缓存的 user 秒渲染（时间组件等依赖 user），后台再 revalidate
const USER_KEY = 'linkpad_user_cache'

function readCachedUser(): User | null {
  try {
    if (!getToken()) return null
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    const u = JSON.parse(raw)
    return u?.id ? u : null
  } catch { return null }
}

function cacheUser(u: User | null) {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u))
    else localStorage.removeItem(USER_KEY)
  } catch {}
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readCachedUser())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Google 登录回跳：URL 上带 google_token，落库到 localStorage 并清理 URL
    const url = new URL(window.location.href)
    const googleToken = url.searchParams.get('google_token')
    if (googleToken) {
      setToken(googleToken)
      url.searchParams.delete('google_token')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }

    if (getToken()) {
      auth.me()
        .then((u: User) => { setUser(u); cacheUser(u) })
        .catch((e: any) => {
          // 仅在 token 确认无效/过期(401)时清除登录态；
          // 网络抖动、部署瞬间等临时故障保留 token，避免误登出
          if (e?.status === 401) { setToken(null); setUser(null); cacheUser(null) }
        })
        .finally(() => setLoading(false))
    } else {
      setUser(null); cacheUser(null)
      setLoading(false)
    }
  }, [])

  const login = async (email: string, password: string) => {
    const res = await auth.login({ email, password })
    setToken(res.token)
    setUser(res.user)
    cacheUser(res.user)
  }

  const register = async (email: string, password: string, nickname?: string) => {
    const res = await auth.register({ email, password, nickname })
    setToken(res.token)
    setUser(res.user)
    cacheUser(res.user)
  }

  const logout = () => {
    setToken(null)
    setUser(null)
    cacheUser(null)
  }

  const refreshUser = async () => {
    try {
      const u = await auth.me()
      setUser(u)
      cacheUser(u)
    } catch { /* ignore */ }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
