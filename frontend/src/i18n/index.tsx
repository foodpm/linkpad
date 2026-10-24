import { createContext, useContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { en } from './en'
import { userPrefs, getToken } from '../api'
// 支持的语言
export type Lang = 'zh' | 'en'

// 模块级当前语言：供非组件环境使用（如 api.ts 的错误消息）
let currentLang: Lang = 'zh'

export function getLang(): Lang {
  return currentLang
}

// {name} 占位符插值
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
}

// 翻译函数：中文原文即 key（zh 直接返回 key 本身），en 查字典、缺失时回退中文原文
export function t(key: string, params?: Record<string, string | number>): string {
  if (currentLang === 'en') return interpolate(en[key] ?? key, params)
  return interpolate(key, params)
}

// 首页标题（跟随语言；repo 页标题由 Worker SSR meta 注入，不在此覆盖）
export function homeTitle(lang: Lang): string {
  return lang === 'zh' ? 'LinkPad - 收藏好链接，分享好品味' : 'LinkPad - Collect Great Links, Share Great Taste'
}

function resolveInitialLang(): Lang {
  // 1. URL ?lang= 显式指定（分享链接 / SEO alternate 入口）
  try {
    const q = new URLSearchParams(window.location.search).get('lang')
    if (q === 'en') return 'en'
    if (q === 'zh' || q === 'zh-CN' || q === 'zh-CN') return 'zh'
  } catch { /* ignore */ }
  // 2. 用户显式选择（localStorage）
  const saved = localStorage.getItem('lang')
  if (saved === 'zh' || saved === 'en') return saved
  // 3. 浏览器语言
  const nav = (navigator.language || '').toLowerCase()
  return nav.startsWith('zh') ? 'zh' : 'en'
}

function applyDocMeta(lang: Lang) {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  if (window.location.pathname === '/') {
    document.title = homeTitle(lang)
  }
  // 写入 cookie，Worker SSR 按 cookie 输出匹配语种的 TDK，避免刷新闪回
  document.cookie = `lang=${lang};max-age=31536000;path=/;samesite=lax`
}

interface I18nContextType {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextType | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(resolveInitialLang)

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem('lang', l)
    setLangState(l)
    // 登录用户同步服务端偏好（多设备一致）
    if (getToken()) userPrefs.saveLang(l)
  }, [])

  useEffect(() => {
    currentLang = lang
    applyDocMeta(lang)
  }, [lang])

  // 未显式选择过语言时，登录用户采纳服务端保存的偏好
  useEffect(() => {
    if (localStorage.getItem('lang')) return
    if (!getToken()) return
    userPrefs.load().then(p => {
      if ((p as any)?.lang === 'en' || (p as any)?.lang === 'zh') {
        if (!localStorage.getItem('lang')) setLangState((p as any).lang)
      }
    }).catch(() => {})
  }, [])

  const value = useMemo(() => ({
    lang,
    setLang,
    t: (key: string, params?: Record<string, string | number>) => t(key, params),
  }), [lang, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// 组件内使用：const t = useT()
export function useT() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useT must be used within I18nProvider')
  return ctx.t
}

// 组件内需要读写语言本身时使用
export function useLang() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useLang must be used within I18nProvider')
  return ctx
}
