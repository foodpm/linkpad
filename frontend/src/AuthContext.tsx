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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (getToken()) {
      auth.me()
        .then(setUser)
        .catch((e: any) => {
          // 仅在 token 确认无效/过期(401)时清除登录态；
          // 网络抖动、部署瞬间等临时故障保留 token，避免误登出
          if (e?.status === 401) { setToken(null); setUser(null) }
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = async (email: string, password: string) => {
    const res = await auth.login({ email, password })
    setToken(res.token)
    setUser(res.user)
  }

  const register = async (email: string, password: string, nickname?: string) => {
    const res = await auth.register({ email, password, nickname })
    setToken(res.token)
    setUser(res.user)
  }

  const logout = () => {
    setToken(null)
    setUser(null)
  }

  const refreshUser = async () => {
    try {
      const u = await auth.me()
      setUser(u)
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
