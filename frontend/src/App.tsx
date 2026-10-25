// VERSION: cache-bust-20260728
 
import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { motion } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { useT } from './i18n'
import { categories, tools, discover, repos as reposApi, me as meApi, faviconCache, follows, bookmarks, getToken, todos as todosApi, stocks, userPrefs, weread, wallpapers as wallpapersApi, getWallpaperUrl, weather as weatherApi, type WeatherData } from './api'
import { gold } from './api'
import { categories as defaultCategories, tools as defaultTools } from './data'
import { useAutoLinkDescription } from './hooks/useAutoLinkDescription'
import AuthModal from './components/AuthModal'
import UserPanel from './components/UserPanel'
import LinkPreviewHost, { scheduleLinkPreview, cancelLinkPreview } from './components/LinkPreview'
import LinkDescriptionInput from './components/LinkDescriptionInput'
import WallpaperManagerModal, { BUILTIN_WALLPAPERS } from './components/WallpaperManagerModal'
import PanelStyleModal, { UI_FONTS } from './components/PanelStyleModal'
import CreateRepoModal from './components/CreateRepoModal'
import WelcomeModal from './components/WelcomeModal'
import CategoryMultiSelect from './components/CategoryMultiSelect'
import { HomeSkeleton } from './components/Skeleton'
import {
 Search, Menu, X, Home, Heart, Compass, ChevronDown, Star, User, Plus, Box, Globe,
 FolderPlus, Layers, Link2, Puzzle, Cpu, Code, PenTool, Coffee, BookOpen, Briefcase, Flame, Sparkles, TrendingUp, TrendingDown,
  Edit3, Trash2, ExternalLink, Camera, MoreVertical, CheckSquare, Gem, Lock, AlertTriangle, CalendarDays, Image as ImageIcon,
  PanelLeftClose, PanelLeftOpen, Clock, Link2Off, Fish, Loader2, RefreshCw, Eye, EyeOff, CloudSun, MapPin, LogIn,
  Folder, Bookmark, Grid3x3, LayoutGrid, Terminal, Database, Cloud, Server, Smartphone, HardDrive, Wifi, Rocket,
  Wrench, Cog, Hammer, Package, Archive, ShoppingBag, ShoppingCart, CreditCard, Wallet, Coins, PieChart, Calculator,
  Banknote, PiggyBank, Gamepad2, Music, Film, Tv, Headphones, Mic, Palette, Brush, GraduationCap, Newspaper, Mail,
  MessageCircle, Users, Smile, Gift, Key, Fingerprint, Shield, Lightbulb, Zap, Leaf, TreePine, Sun, Moon, Plane,
  Car, Bike, Map as MapIcon, Building2, Anchor, Utensils, Pill, Stethoscope, Dumbbell, Trophy, Medal, Target, Microscope,
  Atom, Brain, Cat, Dog,
} from 'lucide-react'
import { CountdownWidgetCard, WidgetResizeHandle } from './components/CountdownWidget'
import { WereadWidgetCard, WereadSetupModal } from './components/WereadWidget'
import { ClockWidgetCard } from './components/ClockWidget'
import { SearchWidgetCard } from './components/SearchWidget'
import WeatherLayer from './components/weather/WeatherLayer'
import { TodoWidgetCard } from './components/TodoWidget'
import { WeatherWidgetCard } from './components/WeatherWidget'
// 鱼缸懒加载：three.js 体积大，拆成独立 chunk，仅首次渲染鱼缸卡片时才下载（开关关闭时用户不会加载这段代码）
const FishTankWidgetCard = lazy(() => import('./components/fishtank/FishTankWidget').then(m => ({ default: m.FishTankWidgetCard })))
import DeadLinksModal from './components/DeadLinksModal'

// ---------- 实验性组件开关（暂时下线：置 true 恢复） ----------
const WEATHER_FX_ENABLED = false
const FISHTANK_ENABLED = false

type NavSection = 'home' | 'repos' | 'favorites' | 'bookmarks' | 'discover'

const iconMap: Record<string, any> = {
  Search, Cpu, Code, PenTool, Coffee, BookOpen, Briefcase, Flame, Sparkles, TrendingUp, Compass,
}

function getIcon(name: string) { return iconMap[name] || Compass }

function faviconUrl(url: string): string {
  // Return empty - favicon is resolved via faviconCache when adding/editing
  // and stored as the tool's icon field. Google S2 requires proxy.
  return ''
}

function isImageIcon(icon: string): boolean {
  return icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('//') || icon.startsWith('data:image') || icon.startsWith('/api/')
}

// 自动识别名称：GitHub 链接取最后一个路径段（仓库名），其余取域名（去 www、去 .xx 后缀）
function guessNameFromUrl(u: string): string {
  try {
    const url = new URL(u)
    if (/^(www\.)?github\.com$/i.test(url.hostname)) {
      const seg = url.pathname.split('/').filter(Boolean).pop()
      if (seg) return seg.replace(/\.git$/i, '')
    }
    return url.hostname.replace(/^www\./, '').replace(/\.[^.]+$/, '')
  } catch { return '' }
}

function iconFontSize(text: string | undefined, size: 'large' | 'small' = 'large'): string {
  const len = (text || '').length
  if (size === 'small') {
    if (len <= 1) return 'text-sm'
    if (len === 2) return 'text-xs'
    return 'text-[10px]'
  }
  if (len <= 1) return 'text-2xl'
  if (len === 2) return 'text-lg'
  if (len === 3) return 'text-sm'
  return 'text-xs'
}

/** Split text into groups of 2 chars each for multi-line icon display */
function iconTextLines(text: string | undefined): string[] {
  const s = text || ''
  const lines: string[] = []
  for (let i = 0; i < s.length && i < 4; i += 2) {
    lines.push(s.substring(i, i + 2))
  }
  return lines
}

const toolPalette = [
  { bg: '#3B82F6', text: '#FFFFFF' }, { bg: '#EF4444', text: '#FFFFFF' },
  { bg: '#10B981', text: '#FFFFFF' }, { bg: '#F59E0B', text: '#FFFFFF' },
  { bg: '#8B5CF6', text: '#FFFFFF' }, { bg: '#EC4899', text: '#FFFFFF' },
  { bg: '#06B6D4', text: '#FFFFFF' }, { bg: '#F97316', text: '#FFFFFF' },
  { bg: '#6366F1', text: '#FFFFFF' }, { bg: '#14B8A6', text: '#FFFFFF' },
  { bg: '#84CC16', text: '#FFFFFF' }, { bg: '#D946EF', text: '#FFFFFF' },
  { bg: '#0EA5E9', text: '#FFFFFF' }, { bg: '#E11D48', text: '#FFFFFF' },
  { bg: '#7C3AED', text: '#FFFFFF' }, { bg: '#059669', text: '#FFFFFF' },
]

/** Reorder a list by preserving a stored ID order */
function reorderByIds(list: any[], ids: string[]): any[] {
  const map = new Map(list.map((i: any) => [i.id, i]))
  const ordered: any[] = []
  const used = new Set<string>()
  for (const id of ids) {
    if (map.has(id)) { ordered.push(map.get(id)); used.add(id) }
  }
  for (const item of list) { if (!used.has(item.id)) ordered.push(item) }
  return ordered
}

function loadOrder(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
}

function saveOrder(key: string, list: any[]) {
  localStorage.setItem(key, JSON.stringify(list.map((i: any) => i.id)))
}

// ---------- stale-while-revalidate 数据缓存 ----------
// 打开页面先用本地缓存立即渲染；TTL 内视为新鲜、不再发请求，超时后台拉最新，有变化才更新界面
const SWR_TTL = 5 * 60 * 1000

// 缓存按登录态隔离：token 变化（登录/登出/换号）后旧缓存自动失效
function swrUid(): string {
  const tk = getToken()
  if (!tk) return 'anon'
  let h = 5381
  for (let i = 0; i < tk.length; i++) h = ((h << 5) + h + tk.charCodeAt(i)) | 0
  return 'u' + String(h)
}

function readSwr(key: string): { data: any, fresh: boolean } | null {
  try {
    const raw = localStorage.getItem(`swr:${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed.uid !== swrUid()) return null
    return { data: parsed.data ?? null, fresh: Date.now() - (parsed.ts || 0) < SWR_TTL }
  } catch { return null }
}

function writeSwr(key: string, data: any) {
  try { localStorage.setItem(`swr:${key}`, JSON.stringify({ ts: Date.now(), uid: swrUid(), data })) } catch {}
}

// revalidate：总是更新缓存；数据与缓存不同才触发界面更新（避免无意义重渲染）
function swrApply(key: string, cached: { data: any } | null, data: any, apply: (d: any) => void) {
  writeSwr(key, data)
  if (JSON.stringify(data) !== JSON.stringify(cached?.data)) apply(data)
}

// 首页分类数据 → 渲染数据（含本地排序和默认兜底）
function applyCatsData(data: any) {
  const ids = loadOrder('cat_order')
  return data && data.length > 0
    ? (ids.length ? reorderByIds(data, ids) : data)
    : defaultCategories.map(c => ({ id: c.id, name: c.name }))
}

export default function App() {
  const t = useT()
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  // Navigate repo page — break out of extension iframe if needed
  const openRepo = (id: string) => {
    try {
      if (window !== window.top) {
        window.top.location.href = `/repo/${id}`
        return
      }
    } catch {}
    navigate(`/repo/${id}`)
  }
  const toolListRef = useRef<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMode, setSearchMode] = useState<'web' | 'local'>('web')
  const [activeNav, setActiveNav] = useState<NavSection>('home')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [activeColumn, setActiveColumn] = useState<string>('trending')
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    home: true, repos: false, favorites: false, bookmarks: false, discover: false,
  })

  // Auth modals
  const [showAuth, setShowAuth] = useState(false)
  const [showUserPanel, setShowUserPanel] = useState(false)
  const [showWallpaperManager, setShowWallpaperManager] = useState(false)
  const [showPanelStyle, setShowPanelStyle] = useState(false)
  const [showCreateRepo, setShowCreateRepo] = useState(false)
  const [authErrorMsg, setAuthErrorMsg] = useState('')

  // Google 登录失败回跳：URL 带 auth_error，弹出登录框并展示错误
  useEffect(() => {
    const url = new URL(window.location.href)
    const err = url.searchParams.get('auth_error')
    if (err) {
      url.searchParams.delete('auth_error')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
      setAuthErrorMsg(err)
      setShowAuth(true)
    }
  }, [])

  // Welcome modal — 未登录用户首次进入网站 3 秒后展示，仅展示 1 次；已登录用户不展示
  const [showWelcome, setShowWelcome] = useState(false)
  const [welcomeAuthTab, setWelcomeAuthTab] = useState<'login' | 'register'>('login')
  useEffect(() => {
    if (authLoading || user) return
    try {
      if (localStorage.getItem('linkpad_welcome_shown')) return
      const timer = setTimeout(() => setShowWelcome(true), 3000)
      return () => clearTimeout(timer)
    } catch { return }
  }, [authLoading, user])
  const closeWelcome = (markShown = true) => {
    setShowWelcome(false)
    if (markShown) {
      try { localStorage.setItem('linkpad_welcome_shown', '1') } catch {}
    }
  }

  // Data — 缓存优先：首帧直接用上次缓存渲染，后台再校验更新
  const [categoryList, setCategoryList] = useState<any[]>(() => {
    const cached = readSwr('home:cats')
    return cached ? applyCatsData(cached.data) : []
  })
  const [toolList, setToolList] = useState<any[]>(() => {
    const cached = readSwr('home:tools')
    return (cached?.data?.length ?? 0) > 0 ? cached.data : []
  })
  // 链接失效检测（首页打开时触发，后端 24h 内查过的自动跳过）
  const [deadLinks, setDeadLinks] = useState<any[]>([])
  const [showDeadLinks, setShowDeadLinks] = useState(false)
  const [removingDead, setRemovingDead] = useState(false)
  const [homeLoading, setHomeLoading] = useState(() => !(readSwr('home:cats') && readSwr('home:tools')))
  const [discoverData, setDiscoverData] = useState<any[]>(() => readSwr('discover:columns')?.data || [])
  const [userRepos, setUserRepos] = useState<any[]>([])
  const [followedRepos, setFollowedRepos] = useState<any[]>([])
  const [bookmarkedRepos, setBookmarkedRepos] = useState<any[]>([])
  const [publicRepos, setPublicRepos] = useState<any[]>(() => readSwr('discover:repos')?.data || [])
  const [discoverSort, setDiscoverSort] = useState<string>('followers')

  // Home page editor state
  const [showCreateCat, setShowCreateCat] = useState(false)
  const [parentCatId, setParentCatId] = useState('')
  const [newCatName, setNewCatName] = useState('')
  const [newCatIcon, setNewCatIcon] = useState('')
  const [newCatPassword, setNewCatPassword] = useState('')
  const [newCatCats, setNewCatCats] = useState<string[]>([])
 const [newCatInput, setNewCatInput] = useState('')
  // Widget state
  const [widgetList, setWidgetList] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('widgets') || '[]') as any[] } catch { return [] }
  })
  // 倒计时共享事项池：所有倒计时组件实例共用一套数据（删除组件不影响数据，重新添加即恢复展示）
  const [countdownEvents, setCountdownEvents] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('countdown_events') || '[]') as any[] } catch { return [] }
  })
  // 最新共享池引用：供不带 countdownEvents 依赖的保存点使用，防止漏带字段被服务端整列清空
  const countdownEventsRef = useRef<any[]>([])
  countdownEventsRef.current = countdownEvents
  const freqDragIdx = useRef<number | null>(null)
  const [showWidgetSelector, setShowWidgetSelector] = useState(false)
  // 倒计时组件：直接选分类创建空组件（事项后续在卡片内添加）
  const [showCountdownCategorySelect, setShowCountdownCategorySelect] = useState(false)
  const [showTodoCategorySelect, setShowTodoCategorySelect] = useState(false)
  // 仿真鱼缸组件：选分类创建（预置 3 条鱼，后续在卡片内添加）
  const [showFishtankCategorySelect, setShowFishtankCategorySelect] = useState(false)
  // 天气卡片组件：选分类创建（默认 3 卡，创建后先选城市/自动定位）
  const [showWeatherCardCategorySelect, setShowWeatherCardCategorySelect] = useState(false)
  const [widgetEditTarget, setWidgetEditTarget] = useState<any>(null)
  // 微信读书组件：新建流程先配置 Key（已配置则跳过）再选分类
  const [showWereadSetup, setShowWereadSetup] = useState(false)
  const [pendingWeread, setPendingWeread] = useState(false)
  const [widgetContextMenu, setWidgetContextMenu] = useState<{ x: number; y: number; widget: any } | null>(null)
  const [showStockSearch, setShowStockSearch] = useState(false)
  const [stockSearchQuery, setStockSearchQuery] = useState('')
  const [stockSearchResults, setStockSearchResults] = useState<any[]>([])
 const [stockSearchLoading, setStockSearchLoading] = useState(false)
 const [stockQuotes, setStockQuotes] = useState<Record<string, any>>({})
 const [pendingStock, setPendingStock] = useState<any>(null)
 const [goldPrice, setGoldPrice] = useState<any>(null)
 const [showGoldCategorySelect, setShowGoldCategorySelect] = useState(false)
 const [editCatId, setEditCatId] = useState<string | null>(null)
  const [editCatName, setEditCatName] = useState('')
  const [editCatIcon, setEditCatIcon] = useState('')
  const [editCatPassword, setEditCatPassword] = useState('')
  const [catContextMenu, setCatContextMenu] = useState<{ x: number; y: number; cat: any } | null>(null)
  // Home page blank area right-click menu
  const [homeContextMenu, setHomeContextMenu] = useState<{ x: number; y: number } | null>(null)

  // 壁纸：'' = 默认渐变背景；'/wallpapers/wN.jpg' = 内置；'user:<id>' = 用户上传（走鉴权 blob URL）
  const [wallpaper, setWallpaper] = useState(() => localStorage.getItem('wallpaper') || '')
  const [wallpaperHidden, setWallpaperHidden] = useState(false)
  const wallpaperTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // user:<id> 需要鉴权取回 blob URL 后才能真正显示
  const [resolvedUrl, setResolvedUrl] = useState(() => {
    const w = localStorage.getItem('wallpaper') || ''
    return w.startsWith('user:') ? '' : w
  })
  useEffect(() => {
    let cancelled = false
    if (!wallpaper || !wallpaper.startsWith('user:')) { setResolvedUrl(wallpaper); return }
    getWallpaperUrl(wallpaper.slice(5)).then(url => { if (!cancelled) setResolvedUrl(url) })
    return () => { cancelled = true }
  }, [wallpaper])
  // 切换壁纸（统一入口：淡出 400ms → 预加载 → 淡入），选择或随机都走这里
  const applyWallpaper = (next: string) => {
    setWallpaperHidden(true)
    if (wallpaperTimer.current) clearTimeout(wallpaperTimer.current)
    wallpaperTimer.current = setTimeout(async () => {
      if (!next) {
        setWallpaper(''); localStorage.setItem('wallpaper', '')
        setResolvedUrl(''); setWallpaperHidden(false)
        return
      }
      let url = next
      if (next.startsWith('user:')) {
        url = await getWallpaperUrl(next.slice(5))
        if (!url) { setWallpaperHidden(false); return }
      }
      const img = new Image() // 预加载完成后再淡入，避免闪半张图
      img.onload = () => { setWallpaper(next); localStorage.setItem('wallpaper', next); setWallpaperHidden(false) }
      img.onerror = () => setWallpaperHidden(false)
      img.src = url
    }, 400)
  }
  // 用户上传的壁纸列表（登录后加载；右键随机切换的池子 = 内置 + 我的）
  const [userWallpapers, setUserWallpapers] = useState<any[]>([])
  const loadUserWallpapers = useCallback(() => {
    wallpapersApi.list().then((rows: any[]) => setUserWallpapers(rows || [])).catch(() => {})
  }, [])
  useEffect(() => { if (user) loadUserWallpapers() }, [user?.id, loadUserWallpapers])
  const changeWallpaper = () => {
    const pool = [...BUILTIN_WALLPAPERS, ...userWallpapers.map((w: any) => `user:${w.id}`)].filter(w => w !== wallpaper)
    if (pool.length) applyWallpaper(pool[Math.floor(Math.random() * pool.length)])
  }
  // 自动切换壁纸：wallpaperAuto 为间隔秒数（0 = 关闭），localStorage 持久化
  const [wallpaperAuto, setWallpaperAuto] = useState(() => parseInt(localStorage.getItem('wallpaper_auto') || '0', 10) || 0)
  const setAutoSeconds = (s: number) => { setWallpaperAuto(s); localStorage.setItem('wallpaper_auto', String(s)) }
  useEffect(() => {
    if (!wallpaperAuto) return
    const t = setInterval(changeWallpaper, wallpaperAuto * 1000)
    return () => clearInterval(t)
  }, [wallpaperAuto, wallpaper, userWallpapers])

  // 面板样式：侧边栏展开/收起（localStorage 持久化）；磨砂大背景已下线，分类内容默认直接平铺
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === '1')
  const toggleSidebar = (v: boolean) => {
    setSidebarCollapsed(v); localStorage.setItem('sidebar_collapsed', v ? '1' : '0')
    // 展开侧边栏时卡片默认展示（联动退出专注模式）
    if (!v) { setFocusMode(false); localStorage.setItem('focus_mode', '0') }
  }
  // 常用工具行数（必须是 3 的倍数，默认 3 行）
  const [freqRows, setFreqRows] = useState(() => {
    const n = parseInt(localStorage.getItem('freq_rows') || '3', 10)
    return Number.isFinite(n) && n >= 3 && n % 3 === 0 ? n : 3
  })
  const setFreqRowsPersist = (n: number) => { if (n % 3 !== 0 || n < 3) return; setFreqRows(n); localStorage.setItem('freq_rows', String(n)) }
  // 卡片展示样式：standard = icon+名称+描述；minimal = 仅圆角图标
  const [cardStyle, setCardStyle] = useState<'standard' | 'minimal'>(() => (localStorage.getItem('card_style') === 'minimal' ? 'minimal' : 'standard'))
  const setCardStylePersist = (v: 'standard' | 'minimal') => { setCardStyle(v); localStorage.setItem('card_style', v) }
  // 滚动时固定时间/搜索框（sticky 置顶，默认开）
  const [stickyTop, setStickyTop] = useState(() => localStorage.getItem('sticky_top_widgets') !== '0')
  const setStickyTopPersist = (v: boolean) => { setStickyTop(v); localStorage.setItem('sticky_top_widgets', v ? '1' : '0') }
  // CRT 壁纸效果（扫描线 + 暗角 + 轻微闪烁，默认关）
  const [crtEffect, setCrtEffect] = useState(() => localStorage.getItem('crt_effect') === '1')
  const setCrtEffectPersist = (v: boolean) => { setCrtEffect(v); localStorage.setItem('crt_effect', v ? '1' : '0') }
  // 界面字体（面板样式切换，localStorage 持久化；空 = 默认系统字体栈）
  const [uiFont, setUiFont] = useState(() => localStorage.getItem('ui_font') || '')
  useLayoutEffect(() => {
    const f = UI_FONTS.find(f => f.id === uiFont)
    if (f?.family) document.documentElement.style.setProperty('--app-font', `'${f.family}'`)
    else document.documentElement.style.removeProperty('--app-font')
  }, [uiFont])
  const setUiFontPersist = (id: string) => { setUiFont(id); localStorage.setItem('ui_font', id) }
  // 链接卡片网格：极简模式用固定 80px 轨道（auto-fill），任何屏宽都是严格 1:1 方块；justify-between 把排不满一轨的余量摊进横向间距（行始终撑满容器）；标准模式列数/间距不变
  const toolGridCols = cardStyle === 'minimal' ? 'grid-cols-[repeat(auto-fill,80px)] gap-x-5 gap-y-3 justify-between' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3'

  // Home page tool state
  const [showAddTool, setShowAddTool] = useState(false)
  const [addToolCats, setAddToolCats] = useState<string[]>([])
  const [addToolName, setAddToolName] = useState('')
  const [addToolUrl, setAddToolUrl] = useState('')
  const {
    description: addToolDesc,
    setDescription: setAddToolDesc,
    loading: addToolDescLoading,
    fetchDescription: fetchAddToolDesc,
    scheduleFetch: scheduleAddToolDesc,
    reset: resetAddToolDesc,
  } = useAutoLinkDescription()
  const [addToolIcon, setAddToolIcon] = useState('')
  const [addToolTextIcon, setAddToolTextIcon] = useState('')
  const [addToolColor, setAddToolColor] = useState(Math.floor(Math.random() * 16))
  const [addToolPassword, setAddToolPassword] = useState('')
  const [addToolCatError, setAddToolCatError] = useState('')
  const [addToolDups, setAddToolDups] = useState<any[]>([])
  const [addToolDupType, setAddToolDupType] = useState<'exact' | 'domain'>('exact')
  const [addToolIconSrc, setAddToolIconSrc] = useState<'auto' | 'upload' | 'text'>('auto')
  const [addToolRefreshing, setAddToolRefreshing] = useState(false)
  const addToolDupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addToolFileRef = useRef<HTMLInputElement>(null)
  const [editTool, setEditTool] = useState<any>(null)
  const [editToolTextIcon, setEditToolTextIcon] = useState('')
  const editToolFileRef = useRef<HTMLInputElement>(null)
  const [editToolIconUploading, setEditToolIconUploading] = useState(false)
  const [toolContextMenu, setToolContextMenu] = useState<{ x: number; y: number; tool: any } | null>(null)
  const [repoContextMenu, setRepoContextMenu] = useState<{ x: number; y: number; repo: any } | null>(null)

  // Add to home
  const [showAddToHome, setShowAddToHome] = useState(false)
  const [addToHomeTool, setAddToHomeTool] = useState<any>(null)

  // Confirm dialog
  const [confirmAction, setConfirmAction] = useState<{ message: string; onConfirm: () => void } | null>(null)

  // Combined item order ref (tools + stock widgets per category), persisted in localStorage
  const itemOrderRef = useRef<Record<string, string[]>>({})
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('categoryItemOrder') || '{}')
      if (Object.keys(saved).length > 0) itemOrderRef.current = saved
    } catch {}
  }, [])

  // Password protection
  const [unlockedCats, setUnlockedCats] = useState<Set<string>>(new Set())
 const [catPwdErrors, setCatPwdErrors] = useState<Record<string, string>>({})
 const [linkPwdDialog, setLinkPwdDialog] = useState<{ tool: any; url: string } | null>(null)
  const [linkPwdInput, setLinkPwdInput] = useState('')
  const catPwdRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [linkPwdError, setLinkPwdError] = useState('')

  // Notifications（通知 UI 已移入 UserPanel，这里仅保留数据与未读数）
  const [notifications, setNotifications] = useState<any[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  // Todos
  const [todoList, setTodoList] = useState<any[]>([])

  const fetchNotifications = useCallback(() => {
    if (!user) return
    const headers: Record<string, string> = {}
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    fetch('/api/notifications', { headers })
      .then(r => r.json())
      .then(data => { setNotifications(data.notifications || []); setUnreadCount(data.unread_count || 0) })
      .catch(() => {})
  }, [user])

  const markNotificationsRead = () => {
    const headers: Record<string, string> = {}
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    fetch('/api/notifications/read', { method: 'POST', headers }).catch(() => {})
    setUnreadCount(0)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })))
  }

  // Todos
  const fetchTodos = useCallback(() => {
    if (!user) { setTodoList([]); return }
    todosApi.list().then(setTodoList).catch(() => {})
  }, [user])

  const incompleteTodoCount = useMemo(() => todoList.filter(t => !t.is_completed).length, [todoList])

  // 搜索框默认展示：无真实搜索组件且未手动删除时渲染虚拟组件（右键删除写标记）；渠道本地记忆
  const [searchWidgetRemoved, setSearchWidgetRemoved] = useState(() => localStorage.getItem('search_widget_removed') === '1')
  // 未登录虚拟时钟的删除标记（登录后不影响用户自己的组件配置）
  const [clockWidgetRemoved, setClockWidgetRemoved] = useState(() => localStorage.getItem('clock_widget_removed') === '1')
  // 专注模式：只展示时间+搜索框+壁纸（localStorage 持久化）
  const [focusMode, setFocusMode] = useState(() => localStorage.getItem('focus_mode') === '1' && localStorage.getItem('sidebar_collapsed') === '1')
  // 退出专注模式的入场动画标记：卡片自底部上推、时间/搜索框上移（短暂挂类后移除）
  const [cardsEnter, setCardsEnter] = useState(false)
  const toggleFocusMode = () => {
    const next = !focusMode
    setFocusMode(next)
    localStorage.setItem('focus_mode', next ? '1' : '0')
    if (next) {
      // 隐藏卡片必须配合收起侧边栏（展开侧边栏时卡片默认展示）
      setSidebarCollapsed(true); localStorage.setItem('sidebar_collapsed', '1')
    } else {
      setCardsEnter(true)
      setTimeout(() => setCardsEnter(false), 800)
    }
  }
  // 首页「滚动固定」模式：时间/搜索框为固定顶区，卡片仅在下方独立滚动区内滚动（不会进入顶区）
  const homeSticky = stickyTop && activeNav === 'home' && !focusMode && !homeLoading

 // 待办组件添加：选择分类或常用工具
 const confirmAddTodo = (target: string) => {
   const isFreq = target === '__frequent__'
   void appendWidget({ id: `todo-${Date.now()}`, type: 'todo', name: '待办事项', height: 2, ...(isFreq ? { inFrequent: true } : { category_id: target }) })
   setShowTodoCategorySelect(false)
 }
 // 添加组件：先拉取服务端最新列表按 id 合并（多页面/设备同时使用时防整表覆盖丢组件），再追加新组件
 const appendWidget = async (newWidget: any) => {
   let base = widgetList
   try {
     const remote = await userPrefs.load()
     const remoteWidgets: any[] = remote.widgets || []
     if (remoteWidgets.length > 0) {
       const ids = new Set(base.map((w: any) => w.id))
       base = [...remoteWidgets.filter((w: any) => !ids.has(w.id)), ...base]
     }
   } catch {}
   setWidgetList([...base, newWidget])
 }
 // ---------- 壁纸天气特效 ----------
 // weather widget 条目（type:'weather'）不渲染卡片，只驱动全屏天气效果层
 const weatherWidget = widgetList.find((w: any) => w.type === 'weather')
 const weatherCity = weatherWidget?.city as { name: string; lat: number; lon: number } | undefined
 const [weatherData, setWeatherData] = useState<WeatherData | null>(null)
 const [weatherBusy, setWeatherBusy] = useState(false)

 // 自动定位：浏览器 Geolocation（需授权）→ Cloudflare IP 定位兜底
 const locateWeather = async (): Promise<{ name: string; lat: number; lon: number } | null> => {
   setWeatherBusy(true)
   const fromGeo = await new Promise<any>((resolve) => {
     if (!navigator.geolocation) return resolve(null)
     navigator.geolocation.getCurrentPosition(
       (p) => resolve({ name: '当前位置', lat: p.coords.latitude, lon: p.coords.longitude }),
       () => resolve(null),
       { timeout: 8000, maximumAge: 600000 },
     )
   })
   let loc = fromGeo
   if (!loc) {
     try {
       const r = await weatherApi.locate()
       loc = { name: r.city || '当前位置', lat: r.lat, lon: r.lon }
     } catch {}
   }
   setWeatherBusy(false)
   return loc
 }

 const addWeatherFx = async () => {
   const loc = await locateWeather()
   if (!loc) { alert(t('无法获取位置，请检查定位权限')); return }
   void appendWidget({ id: 'weather', type: 'weather', name: '天气', city: loc })
 }
 const reLocateWeather = async () => {
   if (!weatherWidget) return
   const loc = await locateWeather()
   if (!loc) { alert(t('无法获取位置，请检查定位权限')); return }
   updateWidget(weatherWidget.id, { city: loc })
 }
 const removeWeatherFx = () => {
   setWidgetList((list: any[]) => list.filter((w) => w.type !== 'weather'))
 }

 // 手动更换地区：防抖搜索城市 → 选择后写回目标（'fx'=天气特效 widget，其他=天气卡片 widget id）
 const [showWeatherCitySearch, setShowWeatherCitySearch] = useState(false)
 const [weatherCityTarget, setWeatherCityTarget] = useState<string>('fx')
 const [weatherQuery, setWeatherQuery] = useState('')
 const [weatherResults, setWeatherResults] = useState<{ name: string; region: string; lat: number; lon: number }[]>([])
 const [weatherSearching, setWeatherSearching] = useState(false)

 useEffect(() => {
   if (!showWeatherCitySearch) return
   const q = weatherQuery.trim()
   if (!q) { setWeatherResults([]); return }
   const timer = setTimeout(() => {
     setWeatherSearching(true)
     weatherApi.search(q)
       .then((r) => setWeatherResults(r.results || []))
       .catch(() => setWeatherResults([]))
       .finally(() => setWeatherSearching(false))
   }, 350)
   return () => clearTimeout(timer)
 }, [weatherQuery, showWeatherCitySearch])

 const pickWeatherCity = (c: { name: string; lat: number; lon: number }) => {
   if (weatherCityTarget && weatherCityTarget !== 'fx') {
     // 天气卡片组件：写回卡片实例
     updateWidget(weatherCityTarget, { city: { name: c.name, lat: c.lat, lon: c.lon } })
   } else if (weatherWidget) {
     updateWidget(weatherWidget.id, { city: { name: c.name, lat: c.lat, lon: c.lon } })
   }
   setShowWeatherCitySearch(false)
   setWeatherQuery('')
   setWeatherResults([])
 }

 // 30 分钟轮询天气；回到前台立即刷新
 useEffect(() => {
   if (!WEATHER_FX_ENABLED || !weatherCity || !user) { setWeatherData(null); return }
   let alive = true
   const fetchWx = () => {
     weatherApi.get(weatherCity.lat, weatherCity.lon)
       .then((d) => { if (alive) setWeatherData(d) })
       .catch(() => {})
   }
   fetchWx()
   const timer = setInterval(fetchWx, 30 * 60 * 1000)
   const onVis = () => { if (!document.hidden) fetchWx() }
   document.addEventListener('visibilitychange', onVis)
   return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVis) }
 }, [weatherCity?.lat, weatherCity?.lon, user])
 // ---------- 天气特效 end ----------
 const confirmAddStock = (result: any, target: string) => {
    const isFreq = target === '__frequent__'
    const newWidget = {
      id: `stock-${Date.now()}`,
      type: 'stock',
      symbol: result.symbol,
      name: result.shortname || result.symbol,
      ...(isFreq ? { inFrequent: true } : { category_id: target }),
    }
    void appendWidget(newWidget)
    setShowStockSearch(false)
    setStockSearchQuery('')
    setStockSearchResults([])
   setPendingStock(null)
}
 const confirmAddGold = (target: string) => {
    const isFreq = target === '__frequent__'
    const newWidget = {
      id: `gold-${Date.now()}`,
      type: 'gold',
      name: '黄金价格',
      ...(isFreq ? { inFrequent: true } : { category_id: target }),
    }
    void appendWidget(newWidget)
    setShowGoldCategorySelect(false)
 }
 // 倒计时组件：直接创建空组件（事项后续在卡片内添加）
 const confirmAddCountdown = (target: string) => {
   const isFreq = target === '__frequent__'
   const newWidget = {
     id: `countdown-${Date.now()}`,
     type: 'countdown',
     name: '倒计时',
     height: 1,
     ...(isFreq ? { inFrequent: true } : { category_id: target }),
   }
   void appendWidget(newWidget)
   setShowCountdownCategorySelect(false)
 }

 // 仿真鱼缸组件：预置 1 条锦鲤 + 2 条斑马鱼，后续在卡片内加鱼/换缸/喂食
 const confirmAddFishtank = (target: string) => {
   const isFreq = target === '__frequent__'
   const mkFish = (species: string) => ({
     id: `fk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
     species,
     size: 0.85 + Math.random() * 0.3,
   })
   const newWidget = {
     id: `fishtank-${Date.now()}`,
     type: 'fishtank',
     name: '仿真鱼缸',
     height: 3,
     tankStyle: 'classic',
     fish: [mkFish('koi'), mkFish('zebrafish'), mkFish('zebrafish')],
     ...(isFreq ? { inFrequent: true } : { category_id: target }),
   }
   void appendWidget(newWidget)
   setShowFishtankCategorySelect(false)
 }

 // 天气卡片组件：默认 3 卡，创建后卡片内选城市/自动定位
 const confirmAddWeatherCard = (target: string) => {
   const isFreq = target === '__frequent__'
   const newWidget = {
     id: `weathercard-${Date.now()}`,
     type: 'weathercard',
     name: '天气',
     height: 3,
     ...(isFreq ? { inFrequent: true } : { category_id: target }),
   }
   void appendWidget(newWidget)
   setShowWeatherCardCategorySelect(false)
 }

 // 右键「修改分类」：移动组件到其他分类或常用工具
 const applyWidgetMove = (target: string) => {
   if (!widgetEditTarget) return
   const isFreq = target === '__frequent__'
   updateWidget(widgetEditTarget.id, isFreq
     ? { inFrequent: true, category_id: undefined }
     : { inFrequent: false, category_id: target })
   setWidgetEditTarget(null)
 }

 // 微信读书组件：已配置 Key 直接选分类，否则先配置
 const startAddWeread = async () => {
   setShowWidgetSelector(false)
   try {
     const cfg = await weread.config.get()
     if (cfg.configured) { setPendingWeread(true); return }
   } catch {}
   setShowWereadSetup(true)
 }

 // 微信读书组件：选分类创建（数据在服务端按账号共享，删除组件不影响已同步笔记）
 const confirmAddWeread = (target: string) => {
   const isFreq = target === '__frequent__'
   const newWidget = {
     id: `weread-${Date.now()}`,
     type: 'weread',
     name: '微信读书笔记',
     height: 1,
     rotateHours: 24,
     ...(isFreq ? { inFrequent: true } : { category_id: target }),
   }
   void appendWidget(newWidget)
   setPendingWeread(false)
   weread.sync().catch(() => {})
 }

 // 通用组件更新（高度 / 事项列表 / 常用工具标记等）
 const updateWidget = (id: string, patch: any) => {
   setWidgetList(prev => prev.map((w: any) => w.id === id ? { ...w, ...patch } : w))
 }

 const toggleWidgetFrequent = (id: string) => {
   setWidgetList(prev => prev.map((w: any) => w.id === id ? { ...w, inFrequent: !w.inFrequent } : w))
 }

 // 常用工具内小组件拖动排序：把重排后的组件序列写回 widgetList（保持在原首个组件之前的位置）
 const handleReorderFreqWidgets = (orderedFreq: any[]) => {
   setWidgetList(prev => {
     const freqIds = new Set(orderedFreq.map(w => w.id))
     const firstIdx = prev.findIndex((w: any) => freqIds.has(w.id))
     const rest = prev.filter((w: any) => !freqIds.has(w.id))
     rest.splice(firstIdx === -1 ? rest.length : Math.min(firstIdx, rest.length), 0, ...orderedFreq)
     return rest
   })
 }
const handleToggleTodo = async (id: string, is_completed: number) => {
    await todosApi.update(id, { is_completed: is_completed ? 0 : 1 })
    setTodoList(prev => prev.map(t => t.id === id ? { ...t, is_completed: is_completed ? 0 : 1 } : t))
  }

  const handleDeleteTodo = async (id: string) => {
    await todosApi.delete(id)
    setTodoList(prev => prev.filter(t => t.id !== id))
  }

  // Track viewed tools locally (persisted in localStorage so NEW badge stays gone after refresh)
  const [viewedTools, setViewedTools] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('viewedTools')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch { return new Set() }
  })
  const markViewed = (id: string) => {
    setViewedTools(prev => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      localStorage.setItem('viewedTools', JSON.stringify([...next]))
      return next
    })
  }

  const handleAddToolIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setAddToolIcon(reader.result as string)
    reader.readAsDataURL(file)
  }

  // 切换图标来源：清空当前图标，auto 模式下按网址重新抓取
  const switchAddToolIconSrc = (m: 'auto' | 'upload' | 'text') => {
    setAddToolIconSrc(m)
    setAddToolIcon('')
    if (addToolFileRef.current) addToolFileRef.current.value = ''
    if (m === 'auto') {
      const u = addToolUrl.trim()
      if (!u) return
      const fixed = /^https?:\/\//i.test(u) ? u : 'https://' + u
      setAddToolRefreshing(true)
      faviconCache.resolve(fixed).then((r) => {
        if (r.icon_url) setAddToolIcon(r.icon_url.startsWith('http') ? r.icon_url : (window.location.origin + r.icon_url))
      }).finally(() => setAddToolRefreshing(false))
    }
  }

  const loadHomeData = useCallback((force = false) => {
    const cachedCats = readSwr('home:cats')
    const cachedTools = readSwr('home:tools')
    const applyTools = (data: any) => {
      setToolList(data && data.length > 0 ? data : defaultTools.map(t => ({
        id: t.id, name: t.name, url: t.url, desc: t.desc,
        category_id: t.categoryId,
        icon: t.name.charAt(0).toUpperCase(),
        bg_color: toolPalette[Math.floor(Math.random() * toolPalette.length)].bg,
        text_color: '#FFFFFF',
      })))
    }
    // TTL 内视为新鲜：跳过请求，避免每次打开首页都重新加载；写操作后 force=true 强制拉取最新并同步缓存
    // 后台 revalidate：有变化才更新界面
    const catTask = (!force && cachedCats?.fresh) ? Promise.resolve() : categories.list().then(data => {
      swrApply('home:cats', cachedCats, data, (d) => setCategoryList(applyCatsData(d)))
    }).catch(() => { if (!cachedCats) setCategoryList(applyCatsData(null)) })
    const toolTask = (!force && cachedTools?.fresh) ? Promise.resolve() : tools.list().then(data => {
      swrApply('home:tools', cachedTools, data, (d) => applyTools((d || []).map((tool: any) => ({
        ...tool,
        category_ids: Array.isArray(tool.category_ids)
          ? tool.category_ids.filter(Boolean)
          : [tool.category_id].filter(Boolean),
      }))))
    }).catch(() => { if (!cachedTools) applyTools(null) })
    Promise.all([catTask, toolTask]).finally(() => setHomeLoading(false))
  }, [])

  const homeCategoryOptions = useMemo(() => categoryList.map((cat: any) => {
    const parent = categoryList.find((c: any) => c.id === cat.parent_id)
    return { id: cat.id, label: parent ? `${t(parent.name)} > ${t(cat.name)}` : t(cat.name) }
  }), [categoryList])

  useEffect(() => {
    loadHomeData()
    const cachedCols = readSwr('discover:columns')
    if (cachedCols) setDiscoverData(cachedCols.data)
    const cachedDisc = readSwr('discover:repos')
    if (cachedDisc) setPublicRepos(cachedDisc.data)
    // TTL 内不重新请求
    if (!cachedCols?.fresh) discover.columns().then(data => {
      swrApply('discover:columns', cachedCols, data, setDiscoverData)
    }).catch(() => {})
    if (!cachedDisc?.fresh) discover.repos().then(data => {
      swrApply('discover:repos', cachedDisc, data, setPublicRepos)
    }).catch(() => {})
  }, [loadHomeData])

  // 搜索框渠道 ↔ 本地搜索模式同步（真实组件 channel / 虚拟组件 localStorage，刷新后恢复）
  useEffect(() => {
    const sw = widgetList.find((w: any) => w.type === 'search')
    const ch = sw ? (sw.channel as string) : (searchWidgetRemoved ? null : (localStorage.getItem('search_channel') || 'baidu'))
    setSearchMode(ch === 'local' ? 'local' : 'web')
  }, [widgetList, searchWidgetRemoved])

  // 拖拽排序后保存并刷新
  const handleReorderTools = useCallback((reorderedItems: any[]) => {
    // 乐观更新 — 在 DraggableGrid 的 items 中交换位置
    const prev = toolListRef.current
    const ids = new Set(reorderedItems.map(t => t.id))
    const firstIdx = prev.findIndex(t => t.id === reorderedItems[0]?.id)
    if (firstIdx !== -1) {
      const rest = prev.filter(t => !ids.has(t.id))
      rest.splice(firstIdx, 0, ...reorderedItems)
      setToolList(rest)
    }
    // 同步到服务端，然后从服务端刷新确保一致（force 同步缓存）
    tools.reorder(reorderedItems.map((t: any, i: number) => ({ id: t.id, sort_order: i })))
      .then(() => loadHomeData(true))
      .catch(() => loadHomeData(true))
  }, [loadHomeData])

  const handleReorderCombined = useCallback((reorderedItems: any[]) => {
    // Save combined order so interleaving preserves on re-render
    const catId = reorderedItems[0]?.category_id
    if (catId) {
      itemOrderRef.current[catId] = reorderedItems.map((i: any) => i.id)
      localStorage.setItem('categoryItemOrder', JSON.stringify(itemOrderRef.current))
    }
    // Separate tools from widgets (stock / gold / countdown)
    const reorderedTools = reorderedItems.filter((i: any) => !isWidgetItem(i))
    const reorderedWidgets = reorderedItems.filter((i: any) => isWidgetItem(i))
    
    // Update tools
    if (reorderedTools.length > 0) {
      const prev = toolListRef.current
      const ids = new Set(reorderedTools.map((t: any) => t.id))
      const firstIdx = prev.findIndex((t: any) => t.id === reorderedTools[0]?.id)
      if (firstIdx !== -1) {
        const rest = prev.filter((t: any) => !ids.has(t.id))
        rest.splice(firstIdx, 0, ...reorderedTools)
        setToolList(rest)
      }
      tools.reorder(reorderedTools.map((t: any, i: number) => ({ id: t.id, sort_order: i })))
        .finally(() => loadHomeData(true))
    }
    
    // Update widgets: reorder in widgetList based on position in combined grid
    if (reorderedWidgets.length > 0) {
      setWidgetList(prev => {
        const widgetIds = new Set(reorderedWidgets.map((w: any) => w.id))
        const nonWidgets = prev.filter((w: any) => !widgetIds.has(w.id))
        // Build reordered widgets from the combined list's order
        const widgetMap = new Map(prev.filter((w: any) => widgetIds.has(w.id)).map((w: any) => [w.id, w]))
        const reordered = reorderedWidgets.map((w: any) => widgetMap.get(w.id)).filter(Boolean)
        // Find insertion position: before the first non-widget item that comes after
        const prevWidgets = prev.filter((w: any) => widgetIds.has(w.id))
        if (prevWidgets.length === 0) return [...reordered, ...nonWidgets]
        const firstWidgetIdx = prev.findIndex((w: any) => widgetIds.has(w.id))
        nonWidgets.splice(firstWidgetIdx, 0, ...reordered)
        return nonWidgets
      })
    }
    // Always sync itemOrder to server after any combined reorder
    if (catId && user) userPrefs.save({ widgets: widgetList, itemOrder: itemOrderRef.current, countdownEvents: countdownEventsRef.current }).catch(() => {})
  }, [user, widgetList])

  // 跨分类移动链接卡片
  const handleMoveToolToCategory = (tool: any, toCatId: string, dropIndex?: number) => {
    if (!user || !tool || isWidgetItem(tool) || !toCatId || tool.category_id === toCatId) return
    const fromCatId = tool.category_id || ''
    const updatedTool = { ...tool, category_id: toCatId }
    const targetItems = getCatItems(toCatId).filter((i: any) => i.id !== tool.id)
    const insertAt = dropIndex === undefined ? targetItems.length : Math.max(0, Math.min(dropIndex, targetItems.length))
    targetItems.splice(insertAt, 0, updatedTool)
    // 更新目标分类的显示顺序，并清理来源分类的残留顺序
    itemOrderRef.current[toCatId] = targetItems.map((i: any) => i.id)
    if (fromCatId && itemOrderRef.current[fromCatId]) {
      itemOrderRef.current[fromCatId] = itemOrderRef.current[fromCatId].filter((id: string) => id !== tool.id)
    }
    localStorage.setItem('categoryItemOrder', JSON.stringify(itemOrderRef.current))
    setToolList(prev => prev.map((t: any) => t.id === tool.id ? updatedTool : t))
    // 同步到服务端
    Promise.allSettled([
      tools.update(tool.id, { category_id: toCatId }),
      tools.reorder(targetItems.filter((i: any) => !isWidgetItem(i)).map((t: any, i: number) => ({ id: t.id, sort_order: i }))),
    ]).then(() => loadHomeData(true))
    if (user) userPrefs.save({ widgets: widgetList, itemOrder: itemOrderRef.current, countdownEvents: countdownEventsRef.current }).catch(() => {})
  }

  // 分类网格容器级拖放（拖到空白格、未落在任何卡片上时触发）：
  // 同分类内拖拽 → 移到序列末尾；跨分类拖链接 → 移入该分类
  const gridContainerHandlers = (catId: string) => ({
    onDragOver: (e: React.DragEvent) => {
      const d = gridDragState
      if (user && d?.item && (d.sourceKey === catId || !isWidgetItem(d.item))) e.preventDefault()
    },
    onDrop: (e: React.DragEvent) => {
      if (!user) return
      const d = gridDragState
      if (!d?.item) return
      e.preventDefault()
      if (d.sourceKey === catId) {
        const list = getCatItems(catId).filter((i: any) => i.id !== d.item.id)
        list.push(d.item)
        handleReorderCombined(list)
      } else if (!isWidgetItem(d.item)) {
        handleMoveToolToCategory(d.item, catId)
      }
    },
  })

  // toolList 变化时同步 ref
  useEffect(() => { toolListRef.current = toolList }, [toolList])

  // 从其他 tab 切回时刷新数据（关注仓库后同步的链接可见）
  const refreshHomeData = useCallback(() => {
    loadHomeData()
    if (user) {
      meApi.followedRepos().then(setFollowedRepos).catch(() => {})
      meApi.bookmarkedRepos().then(setBookmarkedRepos).catch(() => {})
      fetchNotifications()
      fetchTodos()
    }
  }, [loadHomeData, user])

  // 切换到首页时刷新数据
  useEffect(() => {
    if (activeNav === 'home') {
      refreshHomeData()
    }
  }, [activeNav, refreshHomeData])

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible' && activeNav === 'home') {
        refreshHomeData()
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
 }, [activeNav, refreshHomeData])

  // Widget stock: save to localStorage & fetch quotes
  const fetchStockQuotes = useCallback(async () => {
    const symbols = widgetList.filter(w => w.type === 'stock').map(w => w.symbol)
    if (!symbols.length) return
    const quotes = await stocks.quote(symbols)
    const map: Record<string, any> = {}
    quotes.forEach((q: any) => { if (q.symbol) map[q.symbol] = q })
    setStockQuotes(prev => ({ ...prev, ...map }))
  }, [widgetList])

 const fetchGoldPrice = useCallback(async () => {
    const quote = await gold.price()
    if (quote) setGoldPrice(quote)
 }, [])

 const isFirstWidgetSync = useRef(true)
 const initialLoadDone = useRef(false)
 // 当前 widgetList 是从哪个账号加载的；防止账号切换时把上一个账号的组件写进新账号
 const loadedWidgetsUserIdRef = useRef<string | null>(null)
  useEffect(() => {
    // Skip entirely on first mount — otherwise empty [] from new-browser
    // localStorage would overwrite cloud data before load effect runs.
    if (isFirstWidgetSync.current) {
      isFirstWidgetSync.current = false
      return
    }
    localStorage.setItem('widgets', JSON.stringify(widgetList))
    localStorage.setItem('countdown_events', JSON.stringify(countdownEvents))
    if (widgetList.length > 0) fetchStockQuotes().catch(() => {})
    if (widgetList.filter((w: any) => w.type === 'gold').length > 0) fetchGoldPrice().catch(() => {})
    // Only save to server after initial load from server has completed.
    // Without this guard, user change triggers save with stale widgetList=[].
    if (initialLoadDone.current && user && loadedWidgetsUserIdRef.current === user.id) {
      userPrefs.save({ widgets: widgetList, itemOrder: itemOrderRef.current, countdownEvents }).catch(() => {})
    }
  }, [widgetList, countdownEvents, fetchStockQuotes, fetchGoldPrice, user])

  // 退出登录/401 时清空本地组件缓存，避免串到同浏览器下一个登录的账号
  useEffect(() => {
    if (!user) {
      // 下次登录必须重新从服务端拉取，不能沿用上一个账号的加载状态
      initialLoadDone.current = false
      loadedWidgetsUserIdRef.current = null
      itemOrderRef.current = {}
      setWidgetList([])
      setCountdownEvents([])
      localStorage.removeItem('widgets')
      localStorage.removeItem('countdown_events')
      localStorage.removeItem('categoryItemOrder')
    }
  }, [user])

  // Load widgets from server when user logs in
  useEffect(() => {
    if (!user) return
    let cancelled = false
    const userId = user.id
    initialLoadDone.current = false
    userPrefs.load().then(data => {
      if (cancelled) return
      // 以服务器数据为准：为空也覆盖，避免本地残留组件串到新账号
      setWidgetList(data.widgets || [])
      if (data.itemOrder && Object.keys(data.itemOrder).length > 0) {
        itemOrderRef.current = data.itemOrder
      }
      // 倒计时共享事项池：优先取服务端；为空则从旧版各组件实例的 events 一次性合并迁移（按 id 去重）
      const serverEvents = data.countdownEvents || []
      if (serverEvents.length > 0) {
        setCountdownEvents(serverEvents)
      } else {
        const legacy = (data.widgets || []).filter((w: any) => w.type === 'countdown').flatMap((w: any) => w.events || [])
        if (legacy.length > 0) {
          const seen = new Set<string>()
          const merged = legacy.filter((ev: any) => ev?.id && !seen.has(ev.id) && seen.add(ev.id))
          setCountdownEvents(merged)
        }
      }
      loadedWidgetsUserIdRef.current = userId
      initialLoadDone.current = true
    }).catch(() => {
      // 请求失败时保持未加载状态，避免随后把空列表写回服务端覆盖真实组件
    })
    return () => { cancelled = true }
  }, [user])

  // Auto-refresh stock quotes every 30s when visible
  useEffect(() => {
    const hasStock = widgetList.filter((w: any) => w.type === 'stock').length > 0
    const hasGold = widgetList.filter((w: any) => w.type === 'gold').length > 0
    if (!hasStock && !hasGold) return
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        if (hasStock) fetchStockQuotes().catch(() => {})
        if (hasGold) fetchGoldPrice().catch(() => {})
      }
    }, 15000)
    return () => clearInterval(interval)
  }, [widgetList, fetchStockQuotes, fetchGoldPrice])

  // Stock search debounce
  useEffect(() => {
    if (!stockSearchQuery.trim()) { setStockSearchResults([]); return }
    const timer = setTimeout(async () => {
      setStockSearchLoading(true)
      const results = await stocks.search(stockSearchQuery)
      setStockSearchResults(results.filter((r: any) => r.quoteType === 'EQUITY' || r.quoteType === 'ETF'))
      setStockSearchLoading(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [stockSearchQuery])

 // 记录上一次登录态：仅在「已登录 → 未登录」时做界面重置（首次访客不强制展开侧边栏）
 const prevUserRef = useRef(user)
 useEffect(() => {
   const wasLoggedIn = !!prevUserRef.current
   prevUserRef.current = user
   if (user) {
      const uid = user.id || 'me'
      // 缓存优先：立即用上次数据渲染，后台 revalidate
      const cachedRepos = readSwr(`u:${uid}:repos`)
      if (cachedRepos) {
        const ids = loadOrder('repo_order')
        setUserRepos(ids.length ? reorderByIds(cachedRepos.data, ids) : cachedRepos.data)
      }
      // TTL 内不重新请求
      if (!cachedRepos?.fresh) reposApi.list().then(data => {
        swrApply(`u:${uid}:repos`, cachedRepos, data, (d) => {
          const ids = loadOrder('repo_order')
          setUserRepos(ids.length ? reorderByIds(d, ids) : d)
        })
      }).catch(() => {})

      const cachedFollows = readSwr(`u:${uid}:follows`)
      if (cachedFollows) {
        const ids = loadOrder('follow_order')
        setFollowedRepos(ids.length ? reorderByIds(cachedFollows.data, ids) : cachedFollows.data)
      }
      if (!cachedFollows?.fresh) meApi.followedRepos().then(data => {
        swrApply(`u:${uid}:follows`, cachedFollows, data, (d) => {
          const ids = loadOrder('follow_order')
          setFollowedRepos(ids.length ? reorderByIds(d, ids) : d)
        })
      }).catch(() => {})

      const cachedBookmarks = readSwr(`u:${uid}:bookmarks`)
      if (cachedBookmarks) setBookmarkedRepos(cachedBookmarks.data)
      if (!cachedBookmarks?.fresh) meApi.bookmarkedRepos().then(data => {
        swrApply(`u:${uid}:bookmarks`, cachedBookmarks, data, setBookmarkedRepos)
      }).catch(() => {})
      fetchNotifications()
      fetchTodos()
      // 打开首页时触发失效检测（后台静默，发现失效才弹窗；每天最多自动弹 1 次）
      tools.checkDead().then((res: any) => {
        if (res?.dead?.length) {
          const today = new Date().toDateString()
          if (localStorage.getItem('dead_links_alerted') !== today) {
            localStorage.setItem('dead_links_alerted', today)
            setDeadLinks(res.dead)
            setShowDeadLinks(true)
          }
        }
      }).catch(() => {})
    } else {
      setUserRepos([])
      setFollowedRepos([])
      setBookmarkedRepos([])
      setTodoList([])
      if (wasLoggedIn) {
        // 登出（手动或 401 自动）：关个人中心、展开侧边栏，保证始终有登录入口可用
        setShowUserPanel(false)
        toggleSidebar(false)
      }
      // 退出登录后重置到首页视图并重新加载默认数据
      setActiveNav('home')
      setActiveCategory('all')
      setExpandedSections({ home: true, repos: false, favorites: false, bookmarks: false, discover: false })
      loadHomeData()
    }
  }, [user])

  // 一键移除勾选的失效首页链接
  const removeDeadLinks = async (ids: string[]) => {
    setRemovingDead(true)
    try {
      await Promise.all(ids.map(tid => tools.delete(tid)))
      setToolList(prev => prev.filter((t: any) => !ids.includes(t.id)))
      loadHomeData(true)
      setShowDeadLinks(false)
      setDeadLinks([])
    } catch { /* 弹窗保持打开，用户可重试 */ }
    finally { setRemovingDead(false) }
  }

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = { ...prev, [section]: !prev[section] }
      if (next[section]) {
        if (section === 'home') { setActiveNav('home'); setActiveCategory('all') }
        else if (section === 'repos') setActiveNav('repos')
        else if (section === 'discover') { setActiveNav('discover'); setActiveColumn('repos') }
        else if (section === 'favorites') setActiveNav('favorites')
        else if (section === 'bookmarks') { setActiveNav('bookmarks') }
      }
      return next
    })
  }

  const handleCategoryClick = (id: string) => {
    setActiveCategory(id); setActiveNav('home'); setSearchQuery('')
    setIsMobileMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleColumnClick = (id: string) => {
    setActiveColumn(id); setActiveNav('discover'); setSearchQuery('')
    setIsMobileMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleAvatarClick = () => {
    if (authLoading) return
    if (user) {
      // 个人中心与侧边栏互斥：打开个人中心时侧边栏向左收回
      setShowUserPanel(true)
      toggleSidebar(true)
    } else setShowAuth(true)
  }

  // ---------- Home page CRUD ----------
  const refreshHome = () => {
    // 强制重新拉取并同步缓存（TTL 内刷新页面不丢最近改动）
    loadHomeData(true)
    if (user) {
      meApi.followedRepos().then(setFollowedRepos).catch(() => {})
      meApi.bookmarkedRepos().then(setBookmarkedRepos).catch(() => {})
    }
  }

  const createCategory = async () => {
    if (!newCatName.trim()) return
    const pid = parentCatId === '__select__' ? '' : (parentCatId || '')
    // 一级菜单必须选图标：未选时按名称随机挑一个；子分类保持后端默认 Folder
    const icon = pid ? undefined : (newCatIcon || pickCategoryIconName(newCatName.trim() + ':' + Date.now()))
    const newCat = await categories.create({ name: newCatName, icon, parent_id: pid || undefined, password: newCatPassword || undefined })
    setNewCatName(''); setNewCatPassword(''); setNewCatCats([]); setNewCatIcon(''); setParentCatId(''); setShowCreateCat(false)
    if (newCat) { setCategoryList(prev => [...prev, newCat]); loadHomeData(true) }
  }

  const updateCategory = async () => {
    if (!editCatId || !editCatName.trim()) return
    const cat = categoryList.find((c: any) => c.id === editCatId)
    const icon = cat?.parent_id ? undefined : (editCatIcon || undefined) // 子分类不改图标；一级未改动则不传
    const updated = await categories.update(editCatId, { name: editCatName, icon, password: editCatPassword || undefined })
    setEditCatId(null); setEditCatName(''); setEditCatPassword(''); setEditCatIcon('')
    if (updated) { setCategoryList(prev => prev.map(c => c.id === updated.id ? updated : c)); loadHomeData(true) }
  }

  const clearCategoryPassword = async () => {
    if (!editCatId) return
    const updated = await categories.update(editCatId, { password: '' })
    setEditCatId(null); setEditCatName(''); setEditCatPassword('')
    if (updated) {
      setCategoryList(prev => prev.map(c => c.id === updated.id ? updated : c))
      setUnlockedCats(prev => { const s = new Set(prev); s.delete(updated.id); return s })
      loadHomeData(true)
    }
  }

  const deleteCategory = async (id: string) => {
    await categories.delete(id)
    setCatContextMenu(null)
    setCategoryList(prev => prev.filter(c => c.id !== id))
    // Also remove tools under this category
    setToolList(prev => prev.filter(t => t.category_id !== id))
    loadHomeData(true)
    if (activeCategory === id) setActiveCategory('all')
  }

  const normalizeToolCategories = (tool: any) => {
    if (!tool) return tool
    return {
      ...tool,
      category_ids: Array.isArray(tool.category_ids)
        ? tool.category_ids.filter(Boolean)
        : [tool.category_id].filter(Boolean),
    }
  }

  // 关闭添加链接弹窗：未完成添加不保留，清空全部输入状态
  const closeAddTool = () => {
    setShowAddTool(false)
    setAddToolName(''); setAddToolUrl(''); setAddToolPassword(''); setAddToolCats([])
    resetAddToolDesc()
    setAddToolIcon(''); setAddToolTextIcon(''); setAddToolIconSrc('auto')
    setAddToolCatError(''); setAddToolDups([]); setAddToolDupType('exact')
    setAddToolColor(Math.floor(Math.random() * toolPalette.length))
    setAddToolRefreshing(false)
    if (addToolDupTimer.current) clearTimeout(addToolDupTimer.current)
    if (addToolFileRef.current) addToolFileRef.current.value = ''
  }

  const createTool = async () => {
    if (!addToolName.trim() || !addToolUrl.trim()) return
    if (addToolCats.length === 0) { setAddToolCatError(t('请填写分类')); return }
    setAddToolCatError('')
    const colors = toolPalette[addToolColor]
    // 图标获取失败时兜底：截取名称前 4 个字符作为文字图标
    const icon = isImageIcon(addToolIcon) ? addToolIcon : (addToolTextIcon || addToolName.slice(0, 4))
    const newTool = normalizeToolCategories(await tools.create({ name: addToolName, url: addToolUrl, desc: addToolDesc, category_ids: addToolCats, icon, bg_color: colors.bg, text_color: colors.text, password: addToolPassword || undefined }))
    closeAddTool()
    setToolList(prev => [...prev, newTool])
    loadHomeData(true)
  }

  const updateTool = async () => {
    if (!editTool) return
    const updated = await tools.update(editTool.id, { name: editTool.name, url: editTool.url, desc: editTool.desc, category_ids: editTool.category_ids, icon: editTool.icon, bg_color: editTool.bg_color, text_color: editTool.text_color, password: editTool.password !== undefined ? editTool.password : undefined })
    setEditTool(null)
    if (updated) { setToolList(prev => prev.map(t => t.id === updated.id ? normalizeToolCategories(updated) : t)); loadHomeData(true) }
  }

  const deleteTool = async (id: string) => {
    await tools.delete(id)
    setToolContextMenu(null)
    setToolList(prev => prev.filter(t => t.id !== id))
    loadHomeData(true)
  }

  const addToolToHome = async (catId: string) => {
    if (!addToHomeTool) return
    await tools.create({
      name: addToHomeTool.name, url: addToHomeTool.url, desc: addToHomeTool.desc || '',
      category_id: catId || undefined,
      icon: addToHomeTool.icon || addToHomeTool.name.charAt(0).toUpperCase(),
      bg_color: addToHomeTool.bg_color, text_color: addToHomeTool.text_color,
    })
    setShowAddToHome(false); setAddToHomeTool(null); refreshHome()
  }

  const handleEditToolIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setEditToolIconUploading(true)
    const reader = new FileReader()
    reader.onload = () => { setEditTool((prev: any) => ({ ...prev, icon: reader.result as string })); setEditToolIconUploading(false) }
    reader.readAsDataURL(file)
  }

  const deleteRepo = async (id: string) => {
    await reposApi.delete(id)
    setRepoContextMenu(null)
    setUserRepos((prev) => prev.filter((r: any) => r.id !== id))
  }

  // ---------- Filtered tools ----------
  const filteredTools = useMemo(() => {
    let result = toolList
    if (searchQuery.trim() && searchMode === 'local') {
      const q = searchQuery.toLowerCase()
      result = result.filter((t) => t.name.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q))
    } else if (activeNav === 'home' && activeCategory !== 'all') {
      // Include tools under the parent category OR any sub-category of this parent
      const subCatIds = categoryList.filter((c: any) => c.parent_id === activeCategory).map((c: any) => c.id)
      result = result.filter((t) => t.category_id === activeCategory || subCatIds.includes(t.category_id))
    }
    return result
  }, [searchMode, searchQuery, activeNav, activeCategory, toolList, categoryList])

  // ---------- Grouped categories ----------
  const renderContent = () => {
    switch (activeNav) {
      case 'home': return renderHomeContent()
      case 'repos': return renderReposContent()
      case 'favorites': return renderFavoritesContent()
      case 'bookmarks': return renderBookmarksContent()
      case 'discover': return renderDiscoverContent()
      default: return renderHomeContent()
    }
  }

  const renderSearchResults = () => {
    const results = filteredTools
    return (
      <SectionPanel>
        <SectionHeader title={t('搜索结果: "{q}"', { q: searchQuery })} count={results.length} unit={t('个结果')} />
        {results.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-12">{t('未找到匹配的链接')}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {results.map((tool: any) => (
              <div key={tool.id} className="relative group"
                onContextMenu={(e) => { e.preventDefault(); setToolContextMenu({ x: e.clientX, y: e.clientY, tool }) }}>
                {!viewedTools.has(tool.id) && tool.id.startsWith('follow-') && tool.viewed === 0 && (
                  <NewBadge id={tool.id} onSeen={() => navigator.sendBeacon(`/api/tools/${tool.id}/view`, '')} onDone={() => markViewed(tool.id)} />
                )}
                <a href={tool.url} target="_blank" rel="noopener noreferrer"
                  onClick={() => { if (!viewedTools.has(tool.id) && tool.id.startsWith('follow-') && tool.viewed === 0) { navigator.sendBeacon(`/api/tools/${tool.id}/view`, ''); markViewed(tool.id) } }}
                  className="block p-3 rounded-2xl bg-white/70 border border-white/80 hover:bg-white/90 hover:shadow-md transition-all ring-1 ring-black/[0.03]">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0 overflow-hidden"
                      style={tool.icon && isImageIcon(tool.icon) ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: tool.bg_color || '#3B82F6', color: tool.text_color || '#FFFFFF' }}>
                      {tool.icon && isImageIcon(tool.icon) ? (
                        <img src={tool.icon} className="w-full h-full object-contain p-1.5" />
                      ) : (
                        <div className={`${iconFontSize((tool.icon || tool.name), 'small')} leading-[1.1] text-center flex flex-col items-center`}>
                          {iconTextLines(tool.icon || tool.name).map((line: string, i: number) => <span key={i}>{line}</span>)}
                        </div>
     )}
    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-800 text-sm truncate">{tool.name}</h4>
                      {tool.desc && <p className="text-xs text-gray-400 truncate mt-0.5">{t(tool.desc)}</p>}
                    </div>
                  </div>
                </a>
                <div className="absolute right-1.5 inset-y-0 flex items-center">
                  {user && (
                    <button onClick={(e) => { e.preventDefault(); setToolContextMenu({ x: e.clientX, y: e.clientY, tool }) }}
                      className="w-7 h-7 rounded-lg bg-white/70 border border-white/80 flex items-center justify-center text-gray-400 hover:text-blue-500 hover:bg-white shadow-sm transition-all">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionPanel>
    )
  }

  // 分类内组合项（链接 + 组件），按保存的顺序排列（放入常用工具的组件不显示在分类里）
  const getCatItems = (catId: string) => {
    const catTools = toolList.filter((t: any) => t.category_id === catId)
    const catWidgets = (user ? widgetList : []).filter((w: any) => (w.type === 'stock' || w.type === 'gold' || w.type === 'countdown' || w.type === 'weread' || w.type === 'fishtank' || w.type === 'todo' || w.type === 'weathercard') && w.category_id === catId && !w.inFrequent && (FISHTANK_ENABLED || w.type !== 'fishtank'))
    const allItems = [...catTools, ...catWidgets]
    const savedOrder = itemOrderRef.current[catId]
    if (savedOrder && savedOrder.length > 0) {
      const ordered = savedOrder.map((id: string) => allItems.find(i => i.id === id)).filter(Boolean)
      if (ordered.length === allItems.length) return ordered
    }
    return allItems
  }

  // 网格内单张卡片渲染（股票 / 黄金 / 倒计时 / 链接），供分类网格与常用工具网格共用
  const renderWidgetItem = (item: any) => {
    const onWidgetCtx = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setWidgetContextMenu({ x: e.clientX, y: e.clientY, widget: item }) }
    if (item.type === 'stock') {
      return <StockWidgetCard key={item.id} widget={item} quote={stockQuotes[item.symbol]}
        onRemove={() => setWidgetList(prev => prev.filter(x => x.id !== item.id))}
        onHeightChange={(h: number) => updateWidget(item.id, { height: h })} onContextMenu={onWidgetCtx} />
    }
    if (item.type === 'gold') {
      return <GoldPriceCard key={item.id} widget={item} quote={goldPrice}
        onRemove={() => setWidgetList(prev => prev.filter(x => x.id !== item.id))}
        onHeightChange={(h: number) => updateWidget(item.id, { height: h })} onContextMenu={onWidgetCtx} />
    }
    if (item.type === 'countdown') {
      // 事项来自共享池：渲染时注入，更新时路由回共享池（其余设置仍存组件实例）
      return <CountdownWidgetCard key={item.id} widget={{ ...item, events: countdownEvents }}
        onUpdate={(patch: any) => {
          if ('events' in patch) {
            setCountdownEvents(patch.events || [])
            const rest = { ...patch }; delete rest.events
            if (Object.keys(rest).length) updateWidget(item.id, rest)
          } else updateWidget(item.id, patch)
        }}
        onRemove={() => setWidgetList(prev => prev.filter(x => x.id !== item.id))} onContextMenu={onWidgetCtx} />
    }
    if (item.type === 'weread') {
      return <WereadWidgetCard key={item.id} widget={item}
        onUpdate={(patch: any) => updateWidget(item.id, patch)}
        onRemove={() => setWidgetList(prev => prev.filter(x => x.id !== item.id))} onContextMenu={onWidgetCtx} />
    }
    if (item.type === 'fishtank') {
      return <Suspense key={item.id} fallback={null}>
        <FishTankWidgetCard widget={item}
          onUpdate={(patch: any) => updateWidget(item.id, patch)}
          onRemove={() => setWidgetList(prev => prev.filter(x => x.id !== item.id))} onContextMenu={onWidgetCtx} />
      </Suspense>
    }
    if (item.type === 'todo') {
      return <TodoWidgetCard key={item.id} widget={item} todos={todoList} incompleteCount={incompleteTodoCount}
        onToggle={handleToggleTodo} onDelete={handleDeleteTodo} onAdd={(content: string) => { if (content.trim()) void todosApi.create(content.trim()).then(td => setTodoList(prev => [td, ...prev])) }}
        onRemove={() => setWidgetList(prev => prev.filter(x => x.id !== item.id))} onContextMenu={onWidgetCtx} />
    }
    if (item.type === 'weathercard') {
      return <WeatherWidgetCard key={item.id} widget={item}
        onRemove={() => setWidgetList(prev => prev.filter(x => x.id !== item.id))}
        onHeightChange={(h: number) => updateWidget(item.id, { height: h })}
        onPickCity={() => { setWeatherCityTarget(item.id); setWeatherQuery(''); setWeatherResults([]); setShowWeatherCitySearch(true) }}
        onRelocate={async () => {
          const loc = await locateWeather()
          if (!loc) return false
          updateWidget(item.id, { city: loc })
          return true
        }}
        onContextMenu={onWidgetCtx} />
    }
    return <HomeToolCard key={item.id} tool={item} viewed={viewedTools.has(item.id)} onView={() => markViewed(item.id)} minimal={cardStyle === 'minimal'}
      onPasswordRequired={(t) => setLinkPwdDialog({ tool: t, url: t.url })}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setToolContextMenu({ x: e.clientX, y: e.clientY, tool: item }) }} />
  }

  const renderHomeContent = () => {
    // 初始加载中 → 显示骨架屏
    if (homeLoading) return <HomeSkeleton />
    // 时间/搜索组件区块（虚拟搜索框：无真实组件且未手动删除时默认展示；右键 stopPropagation 防止冒泡出添加菜单）
    // 时间组件未登录时展示虚拟时钟（登录与否时间都可见）；clock-virtual 的删除走 localStorage 标记
    const clockWidgets = user
      ? widgetList.filter((w: any) => w.type === 'clock')
      : (clockWidgetRemoved ? [] : [{ id: 'clock-virtual', type: 'clock', name: '时间' }])
    const realSearch = (user ? widgetList : []).filter((w: any) => w.type === 'search')
    const searchWidgets = realSearch.length > 0 ? realSearch : (searchWidgetRemoved ? [] : [{ id: 'search-virtual', type: 'search', name: '搜索框', channel: localStorage.getItem('search_channel') || 'baidu' }])
    const renderClockSection = (w: any) => (
      <SectionPanel key={w.id} >
        <ClockWidgetCard onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setWidgetContextMenu({ x: e.clientX, y: e.clientY, widget: w }) }} />
      </SectionPanel>
    )
    const renderSearchSection = (w: any) => (
      <SectionPanel key={w.id} >
        <div data-weather-target="search" onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setWidgetContextMenu({ x: e.clientX, y: e.clientY, widget: w }) }}>
          <SearchWidgetCard channel={(w.channel as string) || 'baidu'}
            onChannelChange={(ch) => { if (w.id === 'search-virtual') { localStorage.setItem('search_channel', ch) } else { updateWidget(w.id, { channel: ch }) }; setSearchMode(ch === 'local' ? 'local' : 'web') }}
            value={searchQuery} onChange={setSearchQuery} />
        </div>
      </SectionPanel>
    )
    // 时间+搜索框统一区块：homeSticky 时为固定顶区（flex-shrink-0），卡片在下方独立滚动区内滚动
    const topSections = (
      <div className={`space-y-8 flex-shrink-0 ${cardsEnter ? 'lp-rise-top' : ''}`}>
        {clockWidgets.map(renderClockSection)}
        {searchWidgets.map(renderSearchSection)}
      </div>
    )
    // 专注模式：只展示时间+搜索框（保持原宽度，整体垂直居中略下移），其余全部隐藏，壁纸照常
    if (focusMode) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-4 pt-24">
          {clockWidgets.map(renderClockSection)}
          {searchWidgets.map(w => <div key={w.id} className="w-full">{renderSearchSection(w)}</div>)}
          {searchQuery.trim() && searchMode === 'local' && <div className="w-full">{renderSearchResults()}</div>}
        </div>
      )
    }
    // 本地搜索：结果直接展示在搜索框下方（时间/搜索组件保持不消失），隐藏常用工具与分类
    if (searchQuery.trim() && searchMode === 'local') {
      if (homeSticky) {
        return (<>
          {topSections}
          <div className="flex-1 min-h-0 overflow-y-auto scroll-smooth pt-6 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">{renderSearchResults()}</div>
        </>)
      }
      return (<>
        {topSections}
        {renderSearchResults()}
      </>)
    }
    // Common tools section — top clicked tools (from all categories)
    const lockedCatIds = new Set(categoryList.filter((c: any) => c.password && !unlockedCats.has(c.id)).map((c: any) => c.id))
    // 固定前排的小组件（股票/黄金/倒计时），占用常用工具名额
    // 组件属于用户私人数据：未登录不展示（避免 localStorage 缓存泄露）
    const freqWidgets = (user ? widgetList : []).filter((w: any) => w.inFrequent && (FISHTANK_ENABLED || w.type !== 'fishtank'))
    // 常用工具行数可在个人中心设置（3 的倍数，桌面 4 列 × N 行）：组件按跨行数占格，剩余格子给链接
    const usedCells = freqWidgets.reduce((s: number, w: any) => s + (w.height || 1), 0)
    const topTools = toolList.filter((t: any) => (t.click_count || 0) > 0 && !lockedCatIds.has(t.category_id))
      .sort((a: any, b: any) => (b.click_count || 0) - (a.click_count || 0) || String(a.id).localeCompare(String(b.id)))
      .slice(0, Math.max(0, freqRows * (cardStyle === 'minimal' ? 11 : 4) - (cardStyle === 'minimal' ? 3 * usedCells : usedCells)))

    const cats = activeCategory === 'all' ? categoryList.filter(c => !c.parent_id) : categoryList.filter(c => c.id === activeCategory)
    // 卡片主体（常用工具 + 分类）
    const homeCards = (<>
      {(freqWidgets.length > 0 || topTools.length > 0) && (
        <SectionPanel key="__frequent__" >
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-xl font-bold text-white/80 flex items-center gap-2"><Star className="w-6 h-6 flex-shrink-0" />{t('常用工具')}</h2>
            <span className="text-xs text-gray-400">{t('点击次数排行')}</span>
          </div>
          <div data-weather-target="tools" className={`grid ${toolGridCols} auto-rows-[80px] grid-flow-row-dense`}
            onDragOver={(e) => { if (user && freqDragIdx.current !== null) e.preventDefault() }}
            onDrop={(e) => {
              // 拖到网格空白格（未落在任何卡片上）→ 移到常用工具组件序列末尾
              if (!user || freqDragIdx.current === null) return
              e.preventDefault()
              const from = freqDragIdx.current
              freqDragIdx.current = null
              const list = [...freqWidgets]
              const [moved] = list.splice(from, 1)
              list.push(moved)
              handleReorderFreqWidgets(list)
            }}>
            {freqWidgets.map((w: any, idx: number) => (
              <div key={w.id} draggable={!!user} style={{ gridRow: `span ${w.height || 1}` }}
                className={`h-full min-h-0 select-none ${cardStyle === 'minimal' ? 'col-span-3' : ''}`}
                onDragStart={(e) => {
                  if (!user) return
                  freqDragIdx.current = idx
                  e.dataTransfer.setData('text/plain', String(idx))
                  e.dataTransfer.effectAllowed = 'move'
                  e.currentTarget.classList.add('opacity-50')
                }}
                onDragEnd={(e) => { e.currentTarget.classList.remove('opacity-50'); freqDragIdx.current = null }}
                onDragOver={(e) => { if (user && freqDragIdx.current !== null && freqDragIdx.current !== idx) e.preventDefault() }}
                onDrop={(e) => {
                  if (!user) return
                  e.preventDefault(); e.stopPropagation()
                  e.currentTarget.classList.remove('opacity-50')
                  const from = freqDragIdx.current
                  freqDragIdx.current = null
                  if (from === null || from === idx) return
                  const list = [...freqWidgets]
                  const [moved] = list.splice(from, 1)
                  list.splice(from < idx ? idx - 1 : idx, 0, moved)
                  handleReorderFreqWidgets(list)
                }}>
                {/* 跨行组件：wrapper 已 span N 行（行高固定 98px），卡片 h-full 填满 */}
                {renderWidgetItem(w)}
              </div>
            ))}
            {topTools.map((tool: any) => (
              <HomeToolCard key={tool.id} tool={tool} viewed={true} onView={() => {}} minimal={cardStyle === 'minimal'}
                onPasswordRequired={(t) => setLinkPwdDialog({ tool: t, url: t.url })} />
            ))}
          </div>
        </SectionPanel>
      )}
      {cats.map((cat) => {
      // Find sub-categories for this parent
      const subCats = categoryList.filter((c: any) => c.parent_id === cat.id)
     const hasSubCats = subCats.length > 0
    const catStockWidgets = (user ? widgetList : []).filter(w => w.type === 'stock' && w.category_id === cat.id)
    const catGoldWidgets = (user ? widgetList : []).filter(w => w.type === 'gold' && w.category_id === cat.id)
    const catCountdownWidgets = (user ? widgetList : []).filter(w => w.type === 'countdown' && w.category_id === cat.id && !w.inFrequent)
    // 其余组件类型（待办/微信读书/天气卡片）：空分类判断需一并计入，否则仅有组件的分类会误显示「暂无链接」
    const catOtherWidgets = (user ? widgetList : []).filter(w => (w.type === 'todo' || w.type === 'weread' || w.type === 'weathercard') && w.category_id === cat.id && !w.inFrequent)

     if (hasSubCats) {
        // Group tools by sub-category
        return (
          <SectionPanel key={cat.id}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <CategoryIcon cat={cat} className="w-6 h-6 text-white/80 flex-shrink-0" />
                <h2 className="text-xl font-bold text-white/80 cursor-context-menu"
                  onContextMenu={(e) => { if (user) { e.preventDefault(); e.stopPropagation(); setCatContextMenu({ x: e.clientX, y: e.clientY, cat }) } }}>{t(cat.name)}</h2>
              </div>
            </div>
            {/* Uncategorized tools directly under parent — show BEFORE sub-categories */}
            {(() => {
              return (
                <div className={`mb-6 grid ${toolGridCols} auto-rows-[80px]`} {...gridContainerHandlers(cat.id)}>
              <DraggableGrid items={getCatItems(cat.id)} disabled={!user} onReorder={handleReorderCombined}
                gridKey={cat.id} onDropExternal={(item, dropIndex) => handleMoveToolToCategory(item, cat.id, dropIndex)}
                spanOf={(item) => isWidgetItem(item) ? (item.height || 1) : 1} clsOf={(item) => cardStyle === 'minimal' && isWidgetItem(item) ? 'col-span-3' : ''}>
                    {(item: any) => renderWidgetItem(item)}
                  </DraggableGrid>
                </div>
              )
            })()}
            {subCats.map((subCat: any) => {
              const subTools = filteredTools.filter((t: any) => t.category_id === subCat.id)
              const subLocked = subCat.password && !unlockedCats.has(subCat.id)
              return (
                <div key={subCat.id} className="mb-6 last:mb-0">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="lp-subcat-bar w-1 h-4 rounded-full inline-block" />
                      <h3 className="font-semibold text-white text-sm cursor-context-menu"
                        onContextMenu={(e) => { if (user) { e.preventDefault(); e.stopPropagation(); setCatContextMenu({ x: e.clientX, y: e.clientY, cat: subCat }) } }}>{t(subCat.name)}</h3>
                      <span className="text-xs text-gray-400">({subTools.length})</span>
                    </div>
                  </div>
                  {subLocked ? (
                    <div className="py-6 flex flex-col items-center justify-center gap-3 bg-white/40 rounded-2xl border border-dashed border-gray-200">
                     <p className="text-xs text-gray-400 text-center">{t('已加密，请输入密码')}</p>
                      <input type="password"
                        ref={el => { catPwdRefs.current[subCat.id] = el }}
                       onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault()
                          const val = catPwdRefs.current[subCat.id]?.value
                          if (val === subCat.password) {
                            setUnlockedCats(prev => new Set([...prev, subCat.id]))
                            setCatPwdErrors(prev => { const r = { ...prev }; delete r[subCat.id]; return r })
                          } else {
                            setCatPwdErrors(prev => ({ ...prev, [subCat.id]: t('密码错误') }))
                          }
                        }}}
                        placeholder={t('输入密码')} className="h-9 px-3 bg-white/60 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-400/50 w-40 text-center" />
                      {catPwdErrors[subCat.id] && <p className="text-xs text-red-500 text-center">{catPwdErrors[subCat.id]}</p>}
                    </div>
                  ) : (
            <div className={`grid ${toolGridCols} auto-rows-[80px]`} {...gridContainerHandlers(subCat.id)}>
              <DraggableGrid items={getCatItems(subCat.id)} disabled={!user} onReorder={handleReorderCombined}
                gridKey={subCat.id} onDropExternal={(item, dropIndex) => handleMoveToolToCategory(item, subCat.id, dropIndex)}
                spanOf={(item) => isWidgetItem(item) ? (item.height || 1) : 1} clsOf={(item) => cardStyle === 'minimal' && isWidgetItem(item) ? 'col-span-3' : ''}>
                      {(item: any) => renderWidgetItem(item)}
                    </DraggableGrid>
                  </div>
                  )}
                </div>
              )
            })}
          </SectionPanel>
        )
      }

      // No sub-categories — flat rendering
     const catTools = filteredTools.filter((t: any) => t.category_id === cat.id)
     const isLocked = cat.password && !unlockedCats.has(cat.id)
     return (
        <SectionPanel key={cat.id} >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <CategoryIcon cat={cat} className="w-6 h-6 text-white/80 flex-shrink-0" />
              <h2 className="text-xl font-bold text-white/80 cursor-context-menu"
                onContextMenu={(e) => { if (user) { e.preventDefault(); e.stopPropagation(); setCatContextMenu({ x: e.clientX, y: e.clientY, cat }) } }}>{t(cat.name)}</h2>
              <span className="text-xs text-gray-400">{t('{n} 个链接', { n: catTools.length })}</span>
            </div>
          </div>
          {isLocked ? (
            <div className="py-10 flex flex-col items-center justify-center gap-4 bg-white/40 rounded-2xl border border-dashed border-gray-200">
             <p className="text-sm text-gray-400 text-center">{t('此分类已加密，请输入密码查看')}</p>
              <input type="password"
                ref={el => { catPwdRefs.current[cat.id] = el }}
               onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault()
                  const val = catPwdRefs.current[cat.id]?.value
                  if (val === cat.password) {
                    setUnlockedCats(prev => new Set([...prev, cat.id]))
                    setCatPwdErrors(prev => { const r = { ...prev }; delete r[cat.id]; return r })
                  } else {
                    setCatPwdErrors(prev => ({ ...prev, [cat.id]: t('密码错误') }))
                  }
                }}}
                placeholder={t('输入密码')}
                className="h-10 px-4 bg-white/60 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm w-48 text-center" />
              {catPwdErrors[cat.id] && <p className="text-xs text-red-500 text-center">{catPwdErrors[cat.id]}</p>}
            </div>
          ) : catTools.length === 0 ? (
              catStockWidgets.length === 0 && catGoldWidgets.length === 0 && catCountdownWidgets.length === 0 && catOtherWidgets.length === 0 ? (
              <div className="text-gray-400 text-sm text-center py-12 rounded-2xl border-2 border-dashed border-transparent transition-colors"
                onDragOver={(e) => { const d = gridDragState; if (d?.item && !isWidgetItem(d.item) && user) { e.preventDefault(); e.currentTarget.classList.add('border-blue-300', 'bg-white/40', 'text-blue-400') } }}
                onDragLeave={(e) => e.currentTarget.classList.remove('border-blue-300', 'bg-white/40', 'text-blue-400')}
                onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-blue-300', 'bg-white/40', 'text-blue-400'); const d = gridDragState; if (d?.item && !isWidgetItem(d.item) && user) handleMoveToolToCategory(d.item, cat.id) }}>
                {t('暂无链接')}
              </div>
            ) : (
              <div className={`grid ${toolGridCols} auto-rows-[80px]`} {...gridContainerHandlers(cat.id)}>
                <DraggableGrid items={getCatItems(cat.id)} disabled={!user} onReorder={handleReorderCombined}
                  gridKey={cat.id} onDropExternal={(item, dropIndex) => handleMoveToolToCategory(item, cat.id, dropIndex)}
                  spanOf={(item) => isWidgetItem(item) ? (item.height || 1) : 1} clsOf={(item) => cardStyle === 'minimal' && isWidgetItem(item) ? 'col-span-3' : ''}>
                  {(item: any) => renderWidgetItem(item)}
                </DraggableGrid>
              </div>
            )
          ) : (
            <div className={`grid ${toolGridCols} auto-rows-[80px]`} {...gridContainerHandlers(cat.id)}>
              <DraggableGrid items={getCatItems(cat.id)} disabled={!user} onReorder={handleReorderCombined}
                gridKey={cat.id} onDropExternal={(item, dropIndex) => handleMoveToolToCategory(item, cat.id, dropIndex)}
                spanOf={(item) => isWidgetItem(item) ? (item.height || 1) : 1} clsOf={(item) => cardStyle === 'minimal' && isWidgetItem(item) ? 'col-span-3' : ''}>
                {(item: any) => renderWidgetItem(item)}
              </DraggableGrid>
            </div>
          )}
        </SectionPanel>
      )
   })}
    </>
    )

    if (homeSticky) {
      // 固定顶区 + 独立滚动区：卡片只在搜索框下方区域滚动，不会出现在时间/搜索框区域
      return (<>
        {topSections}
        <div className="flex-1 min-h-0 overflow-y-auto scroll-smooth pt-8 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
          <div className={`space-y-8 ${cardsEnter ? 'lp-rise-cards' : ''}`}>{homeCards}</div>
        </div>
      </>)
    }
    return (<>
      {topSections}
      <div className={`space-y-8 ${cardsEnter ? 'lp-rise-cards' : ''}`}>{homeCards}</div>
    </>)
  }

  const renderReposContent = () => {
    return (
      <SectionPanel >
        <div className="flex items-center gap-3 mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">{t('我的仓库')}</h2>
            <span className="text-xs text-gray-400">{t('{n} 个仓库', { n: userRepos.length })}</span>
          </div>
        </div>
        {!user ? (
          <EmptyState icon={Box} text={t('请先登录')} subtext={t('登录后可查看仓库')} />
        ) : userRepos.length === 0 ? (
          <EmptyState icon={Box} text={t('暂无仓库')} subtext={t('点击左侧菜单中"创建仓库"开始')} />
        ) : (
          <RepoGrid repos={userRepos} />
        )}
      </SectionPanel>
    )
  }

  const renderFavoritesContent = () => {
    return (
      <SectionPanel >
        <div className="flex items-center gap-3 mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">{t('我的关注')}</h2>
            <span className="text-xs text-gray-400">{t('{n} 个关注的仓库', { n: followedRepos.length })}</span>
          </div>
        </div>
        {!user ? (
          <EmptyState icon={Heart} text={t('请先登录')} subtext={t('登录后可查看关注的仓库')} />
        ) : followedRepos.length === 0 ? (
          <EmptyState icon={Heart} text={t('暂无关注的仓库')} subtext={t('在仓库页面点击关注按钮')} />
        ) : (
          <RepoGrid repos={followedRepos} />
        )}
      </SectionPanel>
    )
  }

  const renderBookmarksContent = () => {
    return (
      <SectionPanel >
        <div className="flex items-center gap-3 mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">{t('我的收藏')}</h2>
            <span className="text-xs text-gray-400">{t('收藏的仓库')}</span>
          </div>
        </div>
        {!user ? (
          <EmptyState icon={Star} text={t('请先登录')} subtext={t('登录后可查看收藏的仓库')} />
        ) : bookmarkedRepos.length === 0 ? (
          <EmptyState icon={Star} text={t('暂无收藏的仓库')} subtext={t('在仓库页面点击收藏按钮')} />
        ) : (
          <RepoGrid repos={bookmarkedRepos} />
        )}
      </SectionPanel>
    )
  }

  const renderDiscoverContent = () => {
    if (activeColumn === 'repos') {
      const sortedRepos = [...publicRepos].sort((a: any, b: any) => {
        if (discoverSort === 'followers') return (b.follower_count || 0) - (a.follower_count || 0)
        if (discoverSort === 'bookmarks') return (b.bookmark_count || 0) - (a.bookmark_count || 0)
        return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime()
      })
      return (
        <SectionPanel >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-white">{t('全部仓库')}</h2>
              <span className="text-xs text-white">{t('社区发布的公开仓库 · 关注仓库后，您的首页将会同步展示仓库链接')}</span>
            </div>
            <select value={discoverSort} onChange={e => setDiscoverSort(e.target.value)}
              className="h-9 pl-3.5 pr-8 bg-slate-900/50 border border-white/30 rounded-xl text-xs text-white [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-blue-400/50">
              <option value="followers" className="bg-slate-900 text-white">{t('关注最多')}</option>
              <option value="bookmarks" className="bg-slate-900 text-white">{t('收藏最多')}</option>
              <option value="recent" className="bg-slate-900 text-white">{t('最近更新')}</option>
            </select>
          </div>
          <DiscoverRepoGrid repos={sortedRepos} user={user} follows={follows} bookmarks={bookmarks} />
        </SectionPanel>
      )
    }

    const column = discoverData.find((c) => c.id === activeColumn)
    return (
      <SectionPanel >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-white/60 shadow-sm border border-white flex items-center justify-center text-blue-500"><Compass className="w-5 h-5" /></div>
          <div>
            <h2 className="text-xl font-bold text-white">{column?.name ? t(column.name) : t('发现')}</h2>
            <span className="text-xs text-white">{column?.desc ? t(column.desc) : null}</span>
          </div>
        </div>
        <ToolGrid tools={toolList} />
      </SectionPanel>
    )
  }

  const sidebarItemClass = (active: boolean) =>
    `w-full flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
      active ? 'bg-white/60 shadow-sm text-blue-700' : 'text-gray-600 hover:bg-white/30 hover:text-gray-900'
    }`

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-blue-50 flex font-sans text-gray-800 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-blue-400/20 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-400/20 blur-[120px] pointer-events-none" />
      <div className="absolute top-[40%] left-[60%] w-[30%] h-[30%] rounded-full bg-teal-300/20 blur-[80px] pointer-events-none" />
      {/* 壁纸层（盖在渐变背景/光斑之上、内容之下；resolvedUrl 为空时不显示即默认背景） */}
      <div className={`absolute inset-0 bg-cover bg-center pointer-events-none transition-opacity duration-500 ${resolvedUrl && !wallpaperHidden ? 'opacity-100' : 'opacity-0'}`}
        style={{ backgroundImage: resolvedUrl ? `url(${resolvedUrl})` : undefined }}>
        {resolvedUrl && <div className="absolute inset-0 bg-white/10" />}
        {/* CRT 壁纸效果：扫描线 + RGB 荫罩 + 暗角 + 轻微闪烁（面板样式开关控制） */}
        {resolvedUrl && crtEffect && !wallpaperHidden && <div className="lp-crt" aria-hidden="true" />}
      </div>

      {/* 壁纸天气效果层（雨/雪/雷/太阳 + 调暗遮罩）：位于壁纸之上、内容之下 */}
      {WEATHER_FX_ENABLED && weatherWidget && weatherData && (
        <WeatherLayer condition={weatherData.condition} wind={weatherData.wind || 0} />
      )}

      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-white/20 backdrop-blur-sm z-40 lg:hidden" onClick={() => setIsMobileMenuOpen(false)} />
      )}

      {/* Sidebar：展开向右推出 / 收起向左收回（桌面端用负 margin 平移，动画后 invisible 释放交互） */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-48 bg-white/70 backdrop-blur-2xl border-r border-white/60 shadow-[4px_0_24px_rgba(0,0,0,0.02)] transition-all duration-300 ease-in-out lg:translate-x-0 lg:static lg:flex-shrink-0 flex flex-col h-screen ${
        isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      } ${sidebarCollapsed ? 'lg:-ml-48 lg:invisible' : ''}`}>
        <div className="h-20 flex items-center justify-center px-2 border-b border-white/50 flex-shrink-0">
          <img src="/logo.png" alt="LinkPad" className="h-full max-h-8 w-auto object-contain" />
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1 relative z-10 min-h-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
          {/* 发现 — 移到最上面 */}
          <div>
            <button onClick={() => toggleSection('discover')} className={sidebarItemClass(activeNav === 'discover')}>
              <div className="flex items-center flex-1">
                <Compass className="w-4 h-4 mr-2.5 text-gray-400" />
                <span>{t('发现')}</span>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expandedSections.discover ? 'rotate-0' : '-rotate-90'}`} />
            </button>
            {expandedSections.discover && (
              <div className="mt-1 space-y-0.5">
                <button onClick={() => handleColumnClick('repos')}
                  className={`w-full text-left pr-3 pl-[38px] py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                    activeColumn === 'repos' && activeNav === 'discover' ? 'text-blue-600 bg-blue-50/50' : 'text-gray-500 hover:text-gray-800 hover:bg-white/30'
                  }`}>
                  {t('全部仓库')}
                </button>
              </div>
            )}
          </div>

          {/* 首页 */}
          <div>
            <button onClick={() => toggleSection('home')} className={sidebarItemClass(activeNav === 'home')}>
              <div className="flex items-center flex-1">
                <Home className="w-4 h-4 mr-2.5 text-gray-400" />
                <span>{t('首页')}</span>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expandedSections.home ? 'rotate-0' : '-rotate-90'}`} />
            </button>
            {expandedSections.home && (
              <div className="mt-1 space-y-0.5">
                <DraggableList items={categoryList.filter((c: any) => !c.parent_id)} onReorder={(list) => {
                  // Merge reordered parents back into full categoryList
                  const newList = [...list, ...categoryList.filter((c: any) => c.parent_id)]
                  setCategoryList(newList); saveOrder('cat_order', newList)
                  categories.reorder(list.map((c: any, i: number) => ({ id: c.id, sort_order: i }))).finally(() => loadHomeData(true))
                }}>
                  {(cat: any) => {
                    return (
                      <div key={cat.id} className="relative">
                        <div onContextMenu={(e) => { e.preventDefault(); setCatContextMenu({ x: e.clientX, y: e.clientY, cat }) }}>
                          <button onClick={() => handleCategoryClick(cat.id)}
                            className={`w-full text-left pr-3 pl-[38px] py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                            activeCategory === cat.id && activeNav === 'home' ? 'text-blue-600 bg-blue-50/50' : 'text-gray-500 hover:text-gray-800 hover:bg-white/30'
                          }`}>
                            <CategoryIcon cat={cat} className="w-3.5 h-3.5 inline-block mr-1.5 align-[-2px] flex-shrink-0 text-gray-400" />
                            {t(cat.name)}
                          </button>
                        </div>
                      </div>
                    );
                  }}
                </DraggableList>
              </div>
            )}
            {expandedSections.home && (
              <div className="mt-1 space-y-0.5">
                <button onClick={() => { setParentCatId(''); setShowCreateCat(true) }}
                  className="w-full text-left pr-3 pl-[38px] py-2 rounded-lg text-xs font-medium text-blue-500 hover:bg-blue-50/30 transition-all duration-200">
                  + {t('创建菜单')}
                </button>
              </div>
            )}
          </div>

          {/* 我的仓库 */}
          <div>
            <button onClick={() => toggleSection('repos')} className={sidebarItemClass(activeNav === 'repos')}>
              <div className="flex items-center flex-1">
                <Box className="w-4 h-4 mr-2.5 text-gray-400" />
                <span>{t('我的仓库')}</span>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expandedSections.repos ? 'rotate-0' : '-rotate-90'}`} />
            </button>
            {expandedSections.repos && (
              <div className="mt-1 space-y-0.5">
                {!user ? (
                  <div className="px-3 py-2 text-xs text-gray-400 italic">{t('请先登录')}</div>
                ) : userRepos.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-400 italic">{t('暂无仓库')}</div>
                ) : (
                  <DraggableList items={userRepos} onReorder={(list) => { setUserRepos(list); saveOrder('repo_order', list) }}>
                    {(repo: any) => (
                      <div key={repo.id} onContextMenu={(e) => { e.preventDefault(); setRepoContextMenu({ x: e.clientX, y: e.clientY, repo }) }}>
                        <button onClick={() => { openRepo(repo.id); setIsMobileMenuOpen(false) }}
                          className="w-full text-left pr-3 pl-[38px] py-2 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-white/30 transition-all duration-200">
                          {repo.name}
                        </button>
                      </div>
                    )}
                  </DraggableList>
                )}
                <button onClick={() => { setShowCreateRepo(true); setIsMobileMenuOpen(false) }}
                  className="w-full text-left pr-3 pl-[38px] py-2 rounded-lg text-xs font-medium text-blue-500 hover:bg-blue-50/30 transition-all duration-200 mt-1">
                  + {t('创建仓库')}
                </button>
              </div>
            )}
          </div>

          {/* 我的关注 */}
          <div>
            <button onClick={() => toggleSection('favorites')} className={sidebarItemClass(activeNav === 'favorites')}>
              <div className="flex items-center flex-1">
                <Heart className="w-4 h-4 mr-2.5 text-gray-400" />
                <span>{t('我的关注')}</span>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expandedSections.favorites ? 'rotate-0' : '-rotate-90'}`} />
            </button>
            {expandedSections.favorites && (
              <div className="mt-1 space-y-0.5">
                {!user ? (
                  <div className="px-3 py-2 text-xs text-gray-400 italic">{t('请先登录')}</div>
                ) : followedRepos.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-400 italic">{t('暂无关注的仓库')}</div>
                ) : (
                  <DraggableList items={followedRepos} onReorder={(list) => { setFollowedRepos(list); saveOrder('follow_order', list) }}>
                    {(repo: any) => (
                      <button key={repo.id} onClick={() => { openRepo(repo.id); setIsMobileMenuOpen(false) }}
                        className="w-full text-left pr-3 pl-[38px] py-2 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-white/30 transition-all duration-200">
                        {repo.name}
                      </button>
                    )}
                  </DraggableList>
                )}
              </div>
            )}
          </div>

          {/* 我的收藏 */}
          <div>
            <button onClick={() => toggleSection('bookmarks')} className={sidebarItemClass(activeNav === 'bookmarks')}>
              <div className="flex items-center flex-1">
                <Star className="w-4 h-4 mr-2.5 text-gray-400" />
                <span>{t('我的收藏')}</span>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expandedSections.bookmarks ? 'rotate-0' : '-rotate-90'}`} />
            </button>
            {expandedSections.bookmarks && (
              <div className="mt-1 space-y-0.5">
                {!user ? (
                  <div className="px-3 py-2 text-xs text-gray-400 italic">{t('请先登录')}</div>
                ) : bookmarkedRepos.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-400 italic">{t('暂无收藏')}</div>
                ) : (
                  <DraggableList items={bookmarkedRepos} onReorder={(list) => { setBookmarkedRepos(list); saveOrder('bookmark_order', list) }}>
                    {(repo: any) => (
                      <button key={repo.id} onClick={() => { openRepo(repo.id); setIsMobileMenuOpen(false) }}
                        className="w-full text-left pr-3 pl-[38px] py-2 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-white/30 transition-all duration-200">
                        {repo.name}
                      </button>
                    )}
                  </DraggableList>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 底部：头像 / 收起侧边栏（收起钮仅桌面） */}
        <div className="flex-shrink-0 border-t border-white/50 p-3 relative z-20">
          <div className="flex items-center gap-2">
            {user ? (
              <button onClick={handleAvatarClick} title={t('个人中心')}
                className="flex items-center gap-2.5 flex-1 min-w-0 rounded-2xl hover:bg-white/40 transition-all group">
                <span className="w-10 h-10 rounded-2xl bg-white/40 border border-white/60 flex items-center justify-center font-bold text-gray-500 overflow-hidden ring-2 ring-gray-200/60 shadow-sm group-hover:shadow-md transition-all flex-shrink-0">
                  {user.avatar_url ? <img src={user.avatar_url} className="w-full h-full object-cover" /> : user.nickname?.charAt(0)?.toUpperCase() || <User className="w-5 h-5" />}
                </span>
                <span className="flex-1 min-w-0 text-left text-sm font-medium text-gray-700 truncate">{user.nickname}</span>
              </button>
            ) : (
              <button onClick={handleAvatarClick} title={t('登录 / 注册')}
                className="flex items-center gap-2.5 flex-1 min-w-0 rounded-2xl hover:bg-white/40 transition-all group">
                <span className="w-10 h-10 rounded-2xl bg-blue-500/10 border border-blue-200/60 flex items-center justify-center flex-shrink-0">
                  <LogIn className="w-5 h-5 text-blue-500" />
                </span>
                <span className="flex-1 min-w-0 text-left text-sm font-medium text-gray-700 truncate">{t('登录 / 注册')}</span>
              </button>
            )}
            <button onClick={() => toggleSidebar(true)} title={t('收起侧边栏')}
              className="hidden lg:inline-flex ml-auto w-8 h-8 rounded-lg items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-white/30 transition-all">
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* 顶栏已移除：浮动按钮替代 —— 移动端菜单 / 侧边栏展开（灰色半透明无背景）/ 专注模式切换；天气特效开启时默认隐藏，悬停显现避免与太阳重叠 */}
        <button onClick={() => setIsMobileMenuOpen(true)}
          className={`lg:hidden fixed top-4 left-4 z-40 w-11 h-11 rounded-2xl bg-white/60 backdrop-blur-xl border border-white/60 shadow-md flex items-center justify-center text-gray-600 hover:text-gray-900 transition-all ${weatherWidget && weatherData ? 'opacity-0 hover:opacity-100 focus-visible:opacity-100' : ''}`}>
          <Menu className="w-5 h-5" />
        </button>
        {sidebarCollapsed && (
          <button onClick={() => toggleSidebar(false)} title={t('展开侧边栏')}
            className={`hidden lg:flex fixed top-4 left-4 z-40 w-10 h-10 items-center justify-center text-gray-400/80 hover:text-gray-700 transition-all ${weatherWidget && weatherData ? 'opacity-0 hover:opacity-100 focus-visible:opacity-100' : ''}`}>
            <PanelLeftOpen className="w-5 h-5" />
          </button>
        )}
        {(sidebarCollapsed || focusMode) && (
          <button onClick={toggleFocusMode} title={focusMode ? t('展示链接卡片') : t('隐藏链接卡片')}
            className={`hidden lg:flex fixed top-4 z-40 w-10 h-10 items-center justify-center text-gray-400/80 hover:text-gray-700 transition-all ${weatherWidget && weatherData ? 'opacity-0 hover:opacity-100 focus-visible:opacity-100' : ''} ${sidebarCollapsed ? 'left-14' : 'left-4'}`}>
            {focusMode ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
          </button>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pt-6 px-6 sm:px-8 lg:px-10 pb-6 scroll-smooth [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
          onContextMenu={(e) => { if (activeNav === 'home' && !searchQuery.trim() && user) { e.preventDefault(); setHomeContextMenu({ x: e.clientX, y: e.clientY }) } }}>
          <div className={`max-w-6xl mx-auto ${homeSticky ? 'h-full flex flex-col' : 'space-y-8'}`}>{renderContent()}</div>
        </div>

      </main>

      {/* Modals */}
      <DeadLinksModal open={showDeadLinks} links={deadLinks} busy={removingDead}
        onClose={() => setShowDeadLinks(false)} onRemove={removeDeadLinks} />
      {showAuth && <AuthModal initialTab={welcomeAuthTab} initialError={authErrorMsg} onClose={() => { setShowAuth(false); setAuthErrorMsg('') }} />}
      {showWelcome && (
        <WelcomeModal
          onClose={() => closeWelcome()}
          onRegister={() => {
            setWelcomeAuthTab('register')
            setShowAuth(true)
            closeWelcome()
          }}
        />
      )}
      {showUserPanel && (
        <UserPanel onClose={() => { setShowUserPanel(false); toggleSidebar(false) }}
          onOpenPanelStyleModal={() => { setShowUserPanel(false); setShowPanelStyle(true) }}
          onOpenWallpaperManager={() => { setShowUserPanel(false); setShowWallpaperManager(true) }}
          notifications={notifications} unreadCount={unreadCount}
          onFetchNotifications={fetchNotifications} onMarkNotificationsRead={markNotificationsRead} />
      )}
      {showPanelStyle && (
        <PanelStyleModal onClose={() => setShowPanelStyle(false)}
          sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}
          freqRows={freqRows} onSetFreqRows={setFreqRowsPersist}
          cardStyle={cardStyle} onSetCardStyle={setCardStylePersist}
          stickyTop={stickyTop} onToggleStickyTop={setStickyTopPersist}
          crtEffect={crtEffect} onToggleCrtEffect={setCrtEffectPersist}
          uiFont={uiFont} onSetUiFont={setUiFontPersist} />
      )}
      {showWallpaperManager && (
        <WallpaperManagerModal
          onClose={() => setShowWallpaperManager(false)}
          list={userWallpapers}
          current={wallpaper}
          onSelect={applyWallpaper}
          onChanged={loadUserWallpapers}
          autoSeconds={wallpaperAuto}
          onAutoChange={setAutoSeconds}
        />
      )}
      {showCreateRepo && (
        <CreateRepoModal
          onClose={() => setShowCreateRepo(false)}
          onCreated={(repo) => {
            setUserRepos((prev) => [repo, ...prev])
            setActiveCategory('all')
            setActiveNav('home')
          }}
        />
      )}

      {/* Create Category Modal */}
      {showCreateCat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => { setShowCreateCat(false); setParentCatId(''); setNewCatPassword('') }} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            {parentCatId === '__select__' ? (
              <>
                <h3 className="font-bold text-gray-800 mb-4">{t('创建子分类')}</h3>
                <select value="" onChange={e => setParentCatId(e.target.value)}
                  className="w-full h-12 px-4 mb-3 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm">
                  <option value="" disabled>{t('请选择父菜单')}</option>
                  {categoryList.filter((c: any) => !c.parent_id).map((cat: any) => (
                    <option key={cat.id} value={cat.id}>{t(cat.name)}</option>
                  ))}
                </select>
                <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder={t('子分类名称')} autoFocus
                  className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
                <input value={newCatPassword} onChange={e => setNewCatPassword(e.target.value)} type="password" placeholder={t('密码（选填）')}
                  className="w-full h-12 px-4 mt-3 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
                <div className="flex gap-2 mt-3">
                  <button onClick={() => { setShowCreateCat(false); setParentCatId(''); setNewCatPassword('') }} className="flex-1 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('取消')}</button>
                  <button onClick={createCategory} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600">{t('创建')}</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-bold text-gray-800 mb-4">{t('创建菜单')}</h3>
                <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder={t('菜单名称')} autoFocus
                  className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
                <input value={newCatPassword} onChange={e => setNewCatPassword(e.target.value)} type="password" placeholder={t('密码（选填）')}
                  className="w-full h-12 px-4 mt-3 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
                <IconPicker value={newCatIcon} onChange={setNewCatIcon} />
                <div className="flex gap-2 mt-3">
                  <button onClick={() => { setShowCreateCat(false); setParentCatId(''); setNewCatPassword(''); setNewCatIcon('') }} className="flex-1 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('取消')}</button>
                  <button onClick={createCategory} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600">{t('创建')}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Edit Category Modal */}
      {editCatId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => { setEditCatId(null); setEditCatPassword('') }} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            {(() => {
              const cat = categoryList.find(c => c.id === editCatId);
              const isSubCat = cat?.parent_id;
              return (
                <>
                  <h3 className="font-bold text-gray-800 mb-4">{isSubCat ? t('编辑子分类') : t('编辑菜单')}</h3>
                  {isSubCat && (
                    <p className="text-xs text-blue-600 mb-3 bg-blue-50 px-3 py-1.5 rounded-lg inline-block">{t('父菜单：')}{t(categoryList.find(c => c.id === cat?.parent_id)?.name || '')}</p>
                  )}
                  <input value={editCatName} onChange={e => setEditCatName(e.target.value)} placeholder={isSubCat ? t('子分类名称') : t('菜单名称')} autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') updateCategory() }}
                    className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
                  <input value={editCatPassword} onChange={e => setEditCatPassword(e.target.value)} type="password" placeholder={cat?.password ? t('密码（留空不修改）') : t('密码（选填）')}
                    className="w-full h-12 px-4 mt-3 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
                  {cat?.password && (
                    <button onClick={clearCategoryPassword} className="mt-2 text-xs text-red-500 hover:text-red-600 flex items-center gap-1 transition-colors">
                      <Lock className="w-3 h-3" /> {t('此分类已加密，点击取消加密')}
                    </button>
                  )}
                  {!isSubCat && <IconPicker value={editCatIcon} onChange={setEditCatIcon} />}
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => { setEditCatId(null); setEditCatPassword(''); setEditCatIcon('') }} className="flex-1 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('取消')}</button>
                    <button onClick={updateCategory} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600">{t('保存')}</button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Add Tool Modal */}
      {showAddTool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={closeAddTool} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto [&::-webkit-scrollbar]:hidden">
            <h3 className="font-bold text-gray-800 mb-4">{t('添加链接')}</h3>
            <div className="space-y-3">
              <input value={addToolName} onChange={e => setAddToolName(e.target.value)} placeholder={t('名称')} className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              <input value={addToolUrl} onChange={e => {
                  setAddToolUrl(e.target.value)
                  const u = e.target.value
                  scheduleAddToolDesc(u)
                  if (!u) return
                  // 自动识别名称：名称为空时取域名（GitHub 取最后路径段），与仓库添加行为一致
                  if (!addToolName) { const n = guessNameFromUrl(u); if (n) setAddToolName(n) }
                  if (addToolIconSrc === 'auto') faviconCache.resolve(u).then((r) => {
                    if (r.icon_url) {
                      setAddToolIcon(r.icon_url.startsWith('http') ? r.icon_url : (window.location.origin + r.icon_url))
                    }
                  })
                  // 重复检测：输入停止 500ms 后查询首页是否已存在相同链接
                  if (addToolDupTimer.current) clearTimeout(addToolDupTimer.current)
                  setAddToolDups([])
                  if (u.trim().length > 3) {
                    addToolDupTimer.current = setTimeout(() => {
                      tools.duplicates(u.trim()).then((r: any) => { setAddToolDups(r.duplicates || []); setAddToolDupType(r.matchType === 'domain' ? 'domain' : 'exact') }).catch(() => {})
                    }, 500)
                  }
                }} onBlur={() => {
                  // 失焦自动补全协议：未输入 http(s):// 时补 https://，并重新识别名称与图标
                  const u = addToolUrl.trim()
                  if (u && !/^https?:\/\//i.test(u)) {
                    const fixed = 'https://' + u
                    setAddToolUrl(fixed)
                    scheduleAddToolDesc(fixed)
                    if (!addToolName) { const n = guessNameFromUrl(fixed); if (n) setAddToolName(n) }
                    if (addToolIconSrc === 'auto') faviconCache.resolve(fixed).then((r) => {
                      if (r.icon_url) {
                        setAddToolIcon(r.icon_url.startsWith('http') ? r.icon_url : (window.location.origin + r.icon_url))
                      }
                    })
                  }
                }} placeholder={t('地址（https://...）')} className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              {addToolDups.length > 0 && (
                <div className="rounded-2xl bg-amber-50/80 border border-amber-200/60 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-amber-600 font-medium text-xs mb-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {addToolDupType === 'domain' ? t('首页已存在 {n} 个相同域名的链接', { n: addToolDups.length }) : t('首页已存在 {n} 个相同链接', { n: addToolDups.length })}
                  </div>
                  <div className="space-y-1">
                    {addToolDups.map((d: any) => (
                      <div key={d.id} className="flex items-center justify-between gap-2 text-xs text-gray-600">
                        <span className="flex items-center gap-1.5 truncate">
                          {d.icon && isImageIcon(d.icon)
                            ? <img src={d.icon} className="w-4 h-4 rounded object-contain shrink-0 bg-white border border-gray-200" />
                            : <span className="w-4 h-4 rounded shrink-0 inline-flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: d.bg_color || '#94a3b8' }}>{(d.name || '?').charAt(0).toUpperCase()}</span>}
                          <span className="truncate">{d.name}</span>
                        </span>
                        <span className="shrink-0 text-gray-400">{d.category_name ? t(d.category_name) : t('未分类')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <LinkDescriptionInput
                value={addToolDesc}
                url={addToolUrl}
                loading={addToolDescLoading}
                onChange={setAddToolDesc}
                onFetch={() => fetchAddToolDesc(addToolUrl, true)}
              />
              <input value={addToolPassword} onChange={e => setAddToolPassword(e.target.value)} type="password" placeholder={t('密码（选填）')} className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              {/* Category selector */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500">{t('分类（可多选）')}</label>
                <CategoryMultiSelect
                  searchable
                  options={homeCategoryOptions}
                  selected={addToolCats}
                  onToggle={(catId) => {
                    setAddToolCats(prev => prev.includes(catId)
                      ? prev.filter(x => x !== catId)
                      : [...prev, catId])
                    setAddToolCatError('')
                  }}
                />
                {addToolCatError && <p className="mt-1 text-xs text-red-500">{addToolCatError}</p>}
              </div>
              {/* 图标来源 */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">{t('图标来源')}</label>
                <select value={addToolIconSrc} onChange={e => switchAddToolIconSrc(e.target.value as 'auto' | 'upload' | 'text')}
                  className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm">
                  <option value="auto">{t('自动获取')}</option>
                  <option value="upload">{t('上传图标')}</option>
                  <option value="text">{t('文字图标')}</option>
                </select>
                <p className="text-xs text-gray-400 mt-1.5">
                  {addToolIconSrc === 'auto' ? t('根据网址自动抓取网站图标') : addToolIconSrc === 'upload' ? t('上传本地图片作为图标') : t('使用文字生成图标，最多 4 个字')}
                </p>
              </div>
              {/* 当前图标 */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">{t('当前图标')}</label>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-bold shadow-md overflow-hidden shrink-0"
                    style={addToolIcon && isImageIcon(addToolIcon) ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: toolPalette[addToolColor]?.bg || '#3B82F6', color: toolPalette[addToolColor]?.text || '#FFFFFF' }}>
                    {addToolRefreshing ? (
                      <Loader2 className="w-5 h-5 animate-spin text-current/60" />
                    ) : addToolIcon && isImageIcon(addToolIcon) ? (
                      <img src={addToolIcon} className="w-full h-full object-contain p-2" />
                    ) : (
                      <span className={iconFontSize(addToolTextIcon || addToolName)}>{addToolTextIcon || addToolName.slice(0, 4) || '?'}</span>
                    )}
                  </div>
                  {addToolIconSrc === 'auto' && (
                    <button type="button" onClick={() => switchAddToolIconSrc('auto')} disabled={addToolRefreshing || !addToolUrl.trim()}
                      className="px-3 py-1.5 rounded-xl bg-white/60 border border-white/80 text-xs text-gray-600 hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1 transition-all">
                      <RefreshCw className={`w-3 h-3 ${addToolRefreshing ? 'animate-spin' : ''}`} />{t('刷新')}
                    </button>
                  )}
                  {addToolIconSrc === 'upload' && (
                    <>
                      <input ref={addToolFileRef} type="file" accept="image/*" className="hidden" onChange={handleAddToolIconUpload} />
                      <button type="button" onClick={() => addToolFileRef.current?.click()} className="px-3 py-1.5 rounded-xl bg-blue-500 text-white text-xs hover:bg-blue-600 transition-all"><Camera className="w-3 h-3 inline mr-1" />{t('上传图标')}</button>
                      {addToolIcon && isImageIcon(addToolIcon) && <button type="button" onClick={() => { setAddToolIcon(''); if (addToolFileRef.current) addToolFileRef.current.value = '' }} className="text-xs text-red-400 hover:text-red-600">{t('清除')}</button>}
                    </>
                  )}
                  {addToolIconSrc === 'text' && (
                    <input value={addToolTextIcon} onChange={e => setAddToolTextIcon(e.target.value)} placeholder={t('图标文字（最多4字）')} maxLength={4}
                      className="flex-1 h-11 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400 text-sm text-center" />
                  )}
                </div>
                {addToolIconSrc === 'text' && (
                  <div className="flex gap-1 flex-wrap mt-2">
                    {toolPalette.map((p, i) => (
                      <button key={i} type="button" onClick={() => setAddToolColor(i)}
                        className="w-5 h-5 rounded-full border border-white/60 shadow-sm transition-transform hover:scale-110"
                        style={{ backgroundColor: p.bg, transform: i === addToolColor ? 'scale(1.3)' : undefined }} />
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={closeAddTool} className="flex-1 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('取消')}</button>
                <button onClick={createTool} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600">{t('添加')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Tool Modal */}
      {editTool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setEditTool(null)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4 max-h-[80vh] overflow-y-auto [&::-webkit-scrollbar]:hidden">
            <h3 className="font-bold text-gray-800 mb-4">{t('编辑链接')}</h3>
            <div className="space-y-3">
              {/* Icon preview + editor */}
              <div className="flex flex-col items-center gap-2 pb-2">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-bold shadow-md overflow-hidden"
                  style={editTool.icon && isImageIcon(editTool.icon) ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: editTool.bg_color || '#3B82F6', color: editTool.text_color || '#FFFFFF' }}>
                  {editTool.icon && isImageIcon(editTool.icon) ? (
                    <img src={editTool.icon} className="w-full h-full object-contain p-2" />
                  ) : (
                    <span className={iconFontSize(editTool.icon || editTool.name)}>{editTool.icon || editTool.name?.charAt(0)?.toUpperCase() || '?'}</span>
                  )}
                </div>
                {(!editTool.icon || !isImageIcon(editTool.icon)) && (
                  <div className="flex gap-1 flex-wrap justify-center">
                    {toolPalette.map((p, i) => (
                      <button key={i} type="button" onClick={() => setEditTool({ ...editTool, bg_color: p.bg, text_color: p.text })}
                        className="w-5 h-5 rounded-full border border-white/60 shadow-sm transition-transform hover:scale-110"
                        style={{ backgroundColor: p.bg, transform: (editTool.bg_color || '#3B82F6') === p.bg ? 'scale(1.3)' : undefined }} />
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input ref={editToolFileRef} type="file" accept="image/*" className="hidden" onChange={handleEditToolIconUpload} />
                  <button type="button" onClick={() => editToolFileRef.current?.click()} disabled={editToolIconUploading} className="px-3 py-1.5 rounded-xl bg-blue-500 text-white text-xs hover:bg-blue-600"><Camera className="w-3 h-3 inline mr-1" />{t('上传图标')}</button>
                  {editTool.icon && isImageIcon(editTool.icon) && <button type="button" onClick={() => { setEditTool({ ...editTool, icon: '' }); if (editToolFileRef.current) editToolFileRef.current.value = '' }} className="text-xs text-red-400 hover:text-red-600">{t('清除')}</button>}
                </div>
                {(!editTool.icon || !isImageIcon(editTool.icon)) && (
                  <input value={editTool.icon || ''} onChange={e => setEditTool({ ...editTool, icon: e.target.value })} placeholder={t('图标文字（最多4字）')} maxLength={4} className="w-full h-10 px-4 bg-white/60 border border-white/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400 text-xs text-center" />
                )}
              </div>
              <input value={editTool.name} onChange={e => setEditTool({ ...editTool, name: e.target.value })} placeholder={t('名称')} className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              <input value={editTool.url} onChange={e => {
                  setEditTool({ ...editTool, url: e.target.value })
                  const u = e.target.value
                  if (!u) return
                  faviconCache.resolve(u).then((r) => {
                    if (r.icon_url) {
                      setEditTool((prev: any) => ({ ...prev, icon: r.icon_url.startsWith('http') ? r.icon_url : (window.location.origin + r.icon_url) }))
                    }
                  })
                }} placeholder={t('地址')} className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              <input value={editTool.desc || ''} onChange={e => setEditTool({ ...editTool, desc: e.target.value })} placeholder={t('描述')} className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              <input value={editTool.password || ''} onChange={e => setEditTool({ ...editTool, password: e.target.value })} type="password" placeholder={t('密码（选填）')} className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              {/* Category selector */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500">{t('分类（可多选）')}</label>
                <CategoryMultiSelect
                  searchable
                  options={homeCategoryOptions}
                  selected={editTool.category_ids || [editTool.category_id].filter(Boolean)}
                  onToggle={(catId) => {
                    const selected = editTool.category_ids || [editTool.category_id].filter(Boolean)
                    setEditTool({
                      ...editTool,
                      category_ids: selected.includes(catId)
                        ? selected.filter((x: string) => x !== catId)
                        : [...selected, catId],
                    })
                  }}
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditTool(null)} className="flex-1 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('取消')}</button>
                <button onClick={updateTool} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600">{t('保存')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Category Context Menu */}
      {catContextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCatContextMenu(null)} />
          <div className="fixed z-50 bg-white border border-white/60 shadow-xl rounded-2xl p-2 w-44" style={{ left: catContextMenu.x, top: catContextMenu.y }}>
           {!catContextMenu.cat.parent_id && (
             <button onClick={() => { setParentCatId(catContextMenu.cat.id); setNewCatName(''); setShowCreateCat(true); setCatContextMenu(null) }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-gray-800 hover:bg-black/5"><span>{t('添加子分类')}</span><FolderPlus className="w-4 h-4" /></button>
           )}
           <button onClick={() => { setAddToolCats([catContextMenu.cat.id]); setAddToolCatError(''); setAddToolDups([]); setAddToolIconSrc('auto'); setShowAddTool(true); setCatContextMenu(null) }}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-gray-800 hover:bg-black/5"><span>{t('创建链接')}</span><Link2 className="w-4 h-4" /></button>
            <button onClick={() => { setEditCatId(catContextMenu.cat.id); setEditCatName(catContextMenu.cat.name); setEditCatIcon(catContextMenu.cat.icon || ''); setCatContextMenu(null) }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-gray-800 hover:bg-black/5"><span>{t('编辑')}</span><Edit3 className="w-4 h-4" /></button>
            <button onClick={() => setConfirmAction({ message: t('确定删除该分类及其所有链接？'), onConfirm: () => deleteCategory(catContextMenu.cat.id) })}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-gray-800 hover:bg-black/5"><span>{t('删除')}</span><Trash2 className="w-4 h-4" /></button>
          </div>
        </>
      )}

      {/* Repo Context Menu */}
      {repoContextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setRepoContextMenu(null)} />
          <div className="fixed z-50 bg-white border border-white/60 shadow-xl rounded-2xl p-2 w-40" style={{ left: repoContextMenu.x, top: repoContextMenu.y }}>
            <button onClick={() => setConfirmAction({ message: t('确定删除该仓库？取消关注后该仓库的链接将从首页同步删除'), onConfirm: () => deleteRepo(repoContextMenu.repo.id) })}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-gray-800 hover:bg-black/5"><span>{t('删除')}</span><Trash2 className="w-4 h-4" /></button>
          </div>
        </>
      )}

      {/* Tool Context Menu */}
      {toolContextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setToolContextMenu(null)} />
          <div className="fixed z-50 bg-white border border-white/60 shadow-xl rounded-2xl p-2 w-40" style={{ left: toolContextMenu.x, top: toolContextMenu.y }}>
            <button onClick={() => { setEditTool({ ...toolContextMenu.tool }); setToolContextMenu(null) }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-gray-800 hover:bg-black/5"><span>{t('编辑')}</span><Edit3 className="w-4 h-4" /></button>
            <button onClick={() => setConfirmAction({ message: t('确定删除该链接？'), onConfirm: () => deleteTool(toolContextMenu.tool.id) })}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-gray-800 hover:bg-black/5"><span>{t('删除')}</span><Trash2 className="w-4 h-4" /></button>
          </div>
        </>
      )}

      {/* Widget Context Menu */}
      {widgetContextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setWidgetContextMenu(null)} />
          <div className="fixed z-50 bg-white border border-white/60 shadow-xl rounded-2xl p-2 w-40" style={{ left: widgetContextMenu.x, top: widgetContextMenu.y }}>
            {/* 时间/搜索框：不支持尺寸与分类，仅可删除 */}
            {widgetContextMenu.widget.type !== 'clock' && widgetContextMenu.widget.type !== 'search' && (
              <>
                <div className="px-3 py-1.5 text-[11px] text-gray-400">{t('组件尺寸')}</div>
                <div className="flex gap-1 px-2 pb-1.5">
                  {[1, 2, 3].map(n => (
                    <button key={n} onClick={() => { updateWidget(widgetContextMenu.widget.id, { height: n }); setWidgetContextMenu(null) }}
                      className={`flex-1 h-7 rounded-lg text-xs transition-all ${(widgetContextMenu.widget.height || 1) === n ? 'bg-blue-500 text-white font-medium' : 'text-gray-500 hover:bg-black/5'}`}>
                      {t('{n}卡', { n })}
                    </button>
                  ))}
                </div>
                <button onClick={() => { setWidgetEditTarget(widgetContextMenu.widget); setWidgetContextMenu(null) }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-gray-800 hover:bg-black/5">
                  <span>{t('修改分类')}</span><FolderPlus className="w-4 h-4" />
                </button>
                <button onClick={() => { toggleWidgetFrequent(widgetContextMenu.widget.id); setWidgetContextMenu(null) }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-gray-800 hover:bg-black/5">
                  {widgetContextMenu.widget.inFrequent ? <><span>{t('移出常用工具')}</span><CheckSquare className="w-4 h-4" /></> : <><span>{t('放入常用工具')}</span><Star className="w-4 h-4" /></>}
                </button>
              </>
            )}
            <button onClick={() => {
              if (widgetContextMenu.widget.id === 'search-virtual') {
                // 虚拟搜索框：写删除标记（不再默认展示）
                localStorage.setItem('search_widget_removed', '1'); setSearchWidgetRemoved(true); setWidgetContextMenu(null)
              } else if (widgetContextMenu.widget.id === 'clock-virtual') {
                // 虚拟时钟（未登录）：写删除标记（不再默认展示）
                localStorage.setItem('clock_widget_removed', '1'); setClockWidgetRemoved(true); setWidgetContextMenu(null)
              } else {
                setConfirmAction({ message: t('确定删除该组件？'), onConfirm: () => setWidgetList(prev => prev.filter(x => x.id !== widgetContextMenu.widget.id)) })
              }
            }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-gray-800 hover:bg-black/5"><span>{t('删除')}</span><Trash2 className="w-4 h-4" /></button>
          </div>
        </>
      )}

      {/* Confirm Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setConfirmAction(null)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <p className="text-sm text-gray-700 mb-6 leading-relaxed">{confirmAction.message}</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmAction(null)} className="flex-1 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('取消')}</button>
              <button onClick={() => { confirmAction.onConfirm(); setConfirmAction(null) }} className="flex-1 h-11 rounded-2xl bg-red-500 text-white hover:bg-red-600">{t('确认')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Link Password Dialog */}
      {linkPwdDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => { setLinkPwdDialog(null); setLinkPwdInput(''); setLinkPwdError('') }} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 mb-4">{t('此链接需要密码')}</h3>
            <input type="password" value={linkPwdInput} onChange={e => { setLinkPwdInput(e.target.value); setLinkPwdError('') }}
              onKeyDown={e => { if (e.key === 'Enter') {
                if (linkPwdInput === linkPwdDialog.tool.password) {
                  window.open(linkPwdDialog.url, '_blank')
                  setLinkPwdDialog(null); setLinkPwdInput(''); setLinkPwdError('')
                } else {
                  setLinkPwdError(t('密码错误'))
                }
              }}}
              placeholder={t('请输入密码')} autoFocus
              className="w-full h-12 px-4 mb-3 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
            {linkPwdError && <p className="text-xs text-red-500 mb-3">{linkPwdError}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setLinkPwdDialog(null); setLinkPwdInput(''); setLinkPwdError('') }} className="flex-1 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('取消')}</button>
              <button onClick={() => {
                if (linkPwdInput === linkPwdDialog.tool.password) {
                  window.open(linkPwdDialog.url, '_blank')
                  setLinkPwdDialog(null); setLinkPwdInput(''); setLinkPwdError('')
                } else {
                  setLinkPwdError(t('密码错误'))
                }
              }} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600">{t('确认')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Home Page Blank Area Context Menu */}
      {homeContextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setHomeContextMenu(null)} />
          <div className="fixed z-50 bg-white border border-white/60 shadow-xl rounded-2xl p-2 w-48 space-y-0.5" style={{ left: homeContextMenu.x, top: homeContextMenu.y }}>
           <button onClick={() => { setHomeContextMenu(null); setParentCatId(''); setShowCreateCat(true) }}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-gray-800 hover:bg-black/5"><span>{t('创建菜单')}</span><FolderPlus className="w-4 h-4" /></button>
           <button onClick={() => { setHomeContextMenu(null); setParentCatId('__select__'); setShowCreateCat(true) }}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-gray-800 hover:bg-black/5"><span>{t('创建子分类')}</span><Layers className="w-4 h-4" /></button>
            <div className="border-t border-white/60" />
           <button onClick={() => { setHomeContextMenu(null); setAddToolCats([]); setAddToolCatError(''); setAddToolDups([]); setAddToolIconSrc('auto'); setShowAddTool(true) }}
             className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-gray-800 hover:bg-black/5"><span>{t('创建链接')}</span><Link2 className="w-4 h-4" /></button>
            <div className="border-t border-white/60" />
           <button onClick={() => { setHomeContextMenu(null); setShowWidgetSelector(true) }}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-gray-800 hover:bg-black/5"><span>{t('添加组件')}</span><Puzzle className="w-4 h-4" /></button>
            <div className="border-t border-white/60" />
           <button onClick={() => { setHomeContextMenu(null); changeWallpaper() }}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-gray-800 hover:bg-black/5"><span>{t('更换壁纸')}</span><ImageIcon className="w-4 h-4" /></button>
          </div>
        </>
      )}

      {/* Add to Home Modal */}
      {showAddToHome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowAddToHome(false)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 mb-4">{t('添加到首页')}</h3>
            <p className="text-sm text-gray-500 mb-3">{t('选择目标分类：')}</p>
            <div className="space-y-1 max-h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden">
              {categoryList.map((cat: any) => (
                <button key={cat.id} onClick={() => addToolToHome(cat.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-all">{t(cat.name)}</button>
              ))}
            </div>
            <button onClick={() => setShowAddToHome(false)} className="w-full mt-3 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('取消')}</button>
          </div>
       </div>
     )}
      {/* Widget Selector Modal */}
      {showWidgetSelector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowWidgetSelector(false)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 mb-4">{t('添加组件')}</h3>
            <div className="space-y-1">
              <button onClick={() => { setShowWidgetSelector(false); setShowStockSearch(true) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-all">
               <TrendingUp className="w-5 h-5 text-gray-800" />
               <span>{t('股票行情')}</span>
             </button>
              <button onClick={() => { setShowWidgetSelector(false); setShowGoldCategorySelect(true) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-gray-700 hover:bg-amber-50 hover:text-amber-600 transition-all">
                <Gem className="w-5 h-5 text-gray-800" />
                <span>{t('黄金价格')}</span>
              </button>
              <button onClick={() => { setShowWidgetSelector(false); setShowCountdownCategorySelect(true) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-all">
                <CalendarDays className="w-5 h-5 text-gray-800" />
                <span>{t('倒计时')}</span>
              </button>
              {FISHTANK_ENABLED && (
              <button onClick={() => { setShowWidgetSelector(false); setShowFishtankCategorySelect(true) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-gray-700 hover:bg-cyan-50 hover:text-cyan-600 transition-all">
                <Fish className="w-5 h-5 text-gray-800" />
                <span>{t('仿真鱼缸')}</span>
              </button>
              )}
              <button onClick={startAddWeread}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-all">
                <BookOpen className="w-5 h-5 text-gray-800" />
                <span>{t('微信读书笔记')}</span>
              </button>
              {widgetList.some((w: any) => w.type === 'weathercard') ? (
                <button disabled
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-gray-400 cursor-not-allowed">
                  <CloudSun className="w-5 h-5 text-slate-400" />
                  <span>{t('天气')}</span>
                  <span className="ml-auto text-xs text-gray-300">{t('已添加')}</span>
                </button>
              ) : (
                <button onClick={() => { setShowWidgetSelector(false); setShowWeatherCardCategorySelect(true) }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-gray-700 hover:bg-sky-50 hover:text-sky-600 transition-all">
                  <CloudSun className="w-5 h-5 text-gray-800" />
                  <span>{t('天气')}</span>
                  <span className="ml-auto text-xs text-gray-400">{t('天气预报')}</span>
                </button>
              )}
              {(widgetList.some((w: any) => w.type === 'search') || !searchWidgetRemoved) ? (
                <button disabled
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-gray-400 cursor-not-allowed">
                  <Search className="w-5 h-5 text-slate-400" />
                  <span>{t('搜索框')}</span>
                  <span className="ml-auto text-xs text-gray-300">{t('已添加')}</span>
                </button>
              ) : (
                <button onClick={() => { setShowWidgetSelector(false); void appendWidget({ id: `search-${Date.now()}`, type: 'search', name: '搜索框' }) }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-all">
                  <Search className="w-5 h-5 text-gray-800" />
                  <span>{t('搜索框')}</span>
                </button>
              )}
              {widgetList.some((w: any) => w.type === 'todo') ? (
                <button disabled
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-gray-400 cursor-not-allowed">
                  <CheckSquare className="w-5 h-5 text-slate-400" />
                  <span>{t('待办事项')}</span>
                  <span className="ml-auto text-xs text-gray-300">{t('已添加')}</span>
                </button>
              ) : (
                <button onClick={() => { setShowWidgetSelector(false); setShowTodoCategorySelect(true) }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-all">
                  <CheckSquare className="w-5 h-5 text-gray-800" />
                  <span>{t('待办事项')}</span>
                </button>
              )}
              {widgetList.some((w: any) => w.type === 'clock') ? (
                <button disabled
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-gray-400 cursor-not-allowed">
                  <Clock className="w-5 h-5 text-slate-400" />
                  <span>{t('时间')}</span>
                  <span className="ml-auto text-xs text-gray-300">{t('已添加')}</span>
                </button>
              ) : (
                <button onClick={() => { setShowWidgetSelector(false); void appendWidget({ id: `clock-${Date.now()}`, type: 'clock', name: '时间' }) }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-gray-700 hover:bg-slate-100 hover:text-slate-700 transition-all">
                  <Clock className="w-5 h-5 text-gray-800" />
                  <span>{t('时间')}</span>
                </button>
              )}
              {WEATHER_FX_ENABLED && (widgetList.some((w: any) => w.type === 'weather') ? (
                <div className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-emerald-700 bg-emerald-50/60">
                  <CloudSun className="w-5 h-5 text-emerald-600" />
                  <span className="flex-1 truncate">{t('天气特效')}{weatherCity?.name && weatherCity.name !== '当前位置' ? ` · ${weatherCity.name}` : ''}</span>
                  {weatherBusy ? (
                    <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                  ) : (
                    <>
                      <button title={t('搜索城市')} onClick={(e) => { e.stopPropagation(); setWeatherCityTarget('fx'); setShowWeatherCitySearch(true); setWeatherQuery(''); setWeatherResults([]) }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-white transition-all"><Search className="w-4 h-4" /></button>
                      <button title={t('重新定位')} onClick={(e) => { e.stopPropagation(); void reLocateWeather() }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-white transition-all"><MapPin className="w-4 h-4" /></button>
                      <button title={t('移除')} onClick={(e) => { e.stopPropagation(); removeWeatherFx() }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-white transition-all"><X className="w-4 h-4" /></button>
                    </>
                  )}
                </div>
              ) : (
                <button onClick={() => { void addWeatherFx() }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-600 transition-all">
                  <CloudSun className="w-5 h-5 text-gray-800" />
                  <span>{t('天气特效')}</span>
                  <span className="ml-auto text-xs text-gray-400">{t('壁纸天气模拟')}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setShowWidgetSelector(false)} className="w-full mt-3 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('取消')}</button>
          </div>
        </div>
      )}

      {/* 天气城市搜索 */}
      {showWeatherCitySearch && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowWeatherCitySearch(false)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 mb-3">{t('选择天气地区')}</h3>
            <input autoFocus value={weatherQuery} onChange={(e) => setWeatherQuery(e.target.value)}
              placeholder={t('输入城市名，如：上海 / Tokyo')}
              className="w-full h-11 px-4 rounded-2xl bg-gray-50 border border-gray-100 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-emerald-300 transition-all" />
            <div className="mt-3 max-h-64 overflow-y-auto space-y-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
              {weatherSearching && <div className="px-3 py-2.5 text-sm text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t('搜索中…')}</div>}
              {!weatherSearching && weatherQuery.trim() && weatherResults.length === 0 && (
                <div className="px-3 py-2.5 text-sm text-gray-400">{t('未找到匹配的城市')}</div>
              )}
              {weatherResults.map((r, i) => (
                <button key={`${r.name}-${r.lat}-${i}`} onClick={() => pickWeatherCity(r)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm hover:bg-emerald-50 hover:text-emerald-700 transition-all text-left">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-gray-400 truncate ml-3">{r.region}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setShowWeatherCitySearch(false)} className="w-full mt-3 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('取消')}</button>
          </div>
        </div>
      )}

      {/* Stock Search Modal */}
      {showStockSearch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => { setShowStockSearch(false); setPendingStock(null) }} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            {!pendingStock ? (
              <>
                <h3 className="font-bold text-gray-800 mb-4">{t('选择股票')}</h3>
                <input type="text" value={stockSearchQuery} onChange={e => setStockSearchQuery(e.target.value)}
                  placeholder={t('输入股票代码或名称，如 AAPL')} autoFocus
                  className="w-full h-11 px-4 mb-3 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm" />
                {stockSearchLoading && <p className="text-xs text-gray-400 text-center py-4">{t('搜索中...')}</p>}
                {!stockSearchLoading && stockSearchResults.length === 0 && stockSearchQuery.trim() && (
                  <p className="text-xs text-gray-400 text-center py-4">{t('未找到结果')}</p>
                )}
                <div className="space-y-1 max-h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden">
                  {stockSearchResults.map((r: any) => (
                    <button key={r.symbol} onClick={() => { setPendingStock(r) }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm hover:bg-blue-50 transition-all text-left">
                      <span className="font-semibold text-gray-800 text-sm truncate">{r.shortname || r.longname || r.symbol}</span>
                      <span className="text-xs text-gray-400">· {r.symbol}</span>
                      <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{r.exchange}</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => { setShowStockSearch(false); setStockSearchQuery(''); setStockSearchResults([]) }}
                  className="w-full mt-3 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('取消')}</button>
              </>
            ) : (
              <>
                <h3 className="font-bold text-gray-800 mb-4">{t('选择分类')}</h3>
                <p className="text-sm text-gray-500 mb-3">{t('将')} <span className="font-semibold text-gray-700">{pendingStock.symbol}</span> {t('添加到：')}</p>
                <div className="space-y-1 max-h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden">
                  <button onClick={() => confirmAddStock(pendingStock, '__frequent__')}
                    className="w-full flex items-center gap-2 px-3 py-2.5 mb-1 rounded-xl text-sm font-medium text-orange-500 hover:bg-orange-50 transition-all">
                    <Star className="w-4 h-4" /> {t('常用工具')}
                  </button>
                  {categoryList.map((cat: any) => (
                    <button key={cat.id} onClick={() => confirmAddStock(pendingStock, cat.id)}
                      className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-all">{t(cat.name)}</button>
                  ))}
                </div>
                <button onClick={() => setPendingStock(null)}
                  className="w-full mt-3 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('返回')}</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Gold Category Select Modal */}
      {showGoldCategorySelect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowGoldCategorySelect(false)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 mb-4">{t('选择分类')}</h3>
            <p className="text-sm text-gray-500 mb-3">{t('将黄金价格添加到：')}</p>
            <div className="space-y-1 max-h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden">
              <button onClick={() => confirmAddGold('__frequent__')}
                className="w-full flex items-center gap-2 px-3 py-2.5 mb-1 rounded-xl text-sm font-medium text-orange-500 hover:bg-orange-50 transition-all">
                <Star className="w-4 h-4" /> {t('常用工具')}
              </button>
              {categoryList.map((cat: any) => (
                <button key={cat.id} onClick={() => confirmAddGold(cat.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-amber-50 hover:text-amber-600 transition-all">{t(cat.name)}</button>
              ))}
            </div>
            <button onClick={() => setShowGoldCategorySelect(false)}
              className="w-full mt-3 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('取消')}</button>
          </div>
        </div>
      )}

      {/* Countdown Category Select Modal（直接创建空组件，不强制新建事项） */}
      {showCountdownCategorySelect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowCountdownCategorySelect(false)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 mb-4">{t('选择分类')}</h3>
            <p className="text-sm text-gray-500 mb-3">{t('将')} <span className="font-semibold text-gray-700">{t('倒计时')}</span> {t('添加到：')}</p>
            <div className="space-y-1 max-h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden">
              <button onClick={() => confirmAddCountdown('__frequent__')}
                className="w-full flex items-center gap-2 px-3 py-2.5 mb-1 rounded-xl text-sm font-medium text-orange-500 hover:bg-orange-50 transition-all">
                <Star className="w-4 h-4" /> {t('常用工具')}
              </button>
              {categoryList.map((cat: any) => (
                <button key={cat.id} onClick={() => confirmAddCountdown(cat.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-all">{t(cat.name)}</button>
              ))}
            </div>
            <button onClick={() => setShowCountdownCategorySelect(false)}
              className="w-full mt-3 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('返回')}</button>
          </div>
        </div>
      )}

      {/* Todo Category Select Modal（默认 2 卡完整列表） */}
      {showTodoCategorySelect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowTodoCategorySelect(false)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 mb-4">{t('选择分类')}</h3>
            <p className="text-sm text-gray-500 mb-3">{t('将')} <span className="font-semibold text-gray-700">{t('待办事项')}</span> {t('添加到：')}</p>
            <div className="space-y-1 max-h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden">
              <button onClick={() => confirmAddTodo('__frequent__')}
                className="w-full flex items-center gap-2 px-3 py-2.5 mb-1 rounded-xl text-sm font-medium text-orange-500 hover:bg-orange-50 transition-all">
                <Star className="w-4 h-4" /> {t('常用工具')}
              </button>
              {categoryList.map((cat: any) => (
                <button key={cat.id} onClick={() => confirmAddTodo(cat.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-all">{t(cat.name)}</button>
              ))}
            </div>
            <button onClick={() => setShowTodoCategorySelect(false)}
              className="w-full mt-3 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('取消')}</button>
          </div>
        </div>
      )}

      {/* Fish Tank Category Select Modal（预置 3 条鱼创建，后续在卡片内添加） */}
      {showFishtankCategorySelect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowFishtankCategorySelect(false)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 mb-4">{t('选择分类')}</h3>
            <p className="text-sm text-gray-500 mb-3">{t('将')} <span className="font-semibold text-gray-700">{t('仿真鱼缸')}</span> {t('添加到：')}</p>
            <div className="space-y-1 max-h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden">
              <button onClick={() => confirmAddFishtank('__frequent__')}
                className="w-full flex items-center gap-2 px-3 py-2.5 mb-1 rounded-xl text-sm font-medium text-orange-500 hover:bg-orange-50 transition-all">
                <Star className="w-4 h-4" /> {t('常用工具')}
              </button>
              {categoryList.map((cat: any) => (
                <button key={cat.id} onClick={() => confirmAddFishtank(cat.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-cyan-50 hover:text-cyan-600 transition-all">{t(cat.name)}</button>
              ))}
            </div>
            <button onClick={() => setShowFishtankCategorySelect(false)}
              className="w-full mt-3 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('返回')}</button>
          </div>
        </div>
      )}

      {/* Weather Card Category Select Modal（默认 3 卡，创建后卡片内选城市） */}
      {showWeatherCardCategorySelect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowWeatherCardCategorySelect(false)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 mb-4">{t('选择分类')}</h3>
            <p className="text-sm text-gray-500 mb-3">{t('将')} <span className="font-semibold text-gray-700">{t('天气')}</span> {t('添加到：')}</p>
            <div className="space-y-1 max-h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden">
              <button onClick={() => confirmAddWeatherCard('__frequent__')}
                className="w-full flex items-center gap-2 px-3 py-2.5 mb-1 rounded-xl text-sm font-medium text-orange-500 hover:bg-orange-50 transition-all">
                <Star className="w-4 h-4" /> {t('常用工具')}
              </button>
              {categoryList.map((cat: any) => (
                <button key={cat.id} onClick={() => confirmAddWeatherCard(cat.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-sky-50 hover:text-sky-600 transition-all">{t(cat.name)}</button>
              ))}
            </div>
            <button onClick={() => setShowWeatherCardCategorySelect(false)}
              className="w-full mt-3 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('取消')}</button>
          </div>
        </div>
      )}

      {/* Widget Move Modal（右键修改组件所在分类） */}
      {widgetEditTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setWidgetEditTarget(null)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 mb-4">{t('修改分类')}</h3>
            <p className="text-sm text-gray-500 mb-3">{t('将')} <span className="font-semibold text-gray-700">{widgetEditTarget.name || t('组件')}</span> {t('移动到：')}</p>
            <div className="space-y-1 max-h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden">
              <button onClick={() => applyWidgetMove('__frequent__')}
                className="w-full flex items-center gap-2 px-3 py-2.5 mb-1 rounded-xl text-sm font-medium text-orange-500 hover:bg-orange-50 transition-all">
                <Star className="w-4 h-4" /> {t('常用工具')}
              </button>
              {categoryList.map((cat: any) => (
                <button key={cat.id} onClick={() => applyWidgetMove(cat.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-all">{t(cat.name)}</button>
              ))}
            </div>
            <button onClick={() => setWidgetEditTarget(null)}
              className="w-full mt-3 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('取消')}</button>
          </div>
        </div>
      )}

      {/* Weread Category Select Modal（新建组件第二步：选分类） */}
      {pendingWeread && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setPendingWeread(false)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 mb-4">{t('选择分类')}</h3>
            <p className="text-sm text-gray-500 mb-3">{t('将')} <span className="font-semibold text-gray-700">{t('微信读书笔记')}</span> {t('添加到：')}</p>
            <div className="space-y-1 max-h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden">
              <button onClick={() => confirmAddWeread('__frequent__')}
                className="w-full flex items-center gap-2 px-3 py-2.5 mb-1 rounded-xl text-sm font-medium text-orange-500 hover:bg-orange-50 transition-all">
                <Star className="w-4 h-4" /> {t('常用工具')}
              </button>
              {categoryList.map((cat: any) => (
                <button key={cat.id} onClick={() => confirmAddWeread(cat.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-all">{t(cat.name)}</button>
              ))}
            </div>
            <button onClick={() => setPendingWeread(false)}
              className="w-full mt-3 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">{t('返回')}</button>
          </div>
        </div>
      )}

      {/* Weread Setup Modal（新建流程第一步：配置 API Key） */}
      {showWereadSetup && (
        <WereadSetupModal onClose={() => setShowWereadSetup(false)}
          onSaved={() => { setShowWereadSetup(false); setPendingWeread(true) }} />
      )}

      {/* 链接卡片悬停预览弹出层（全局唯一） */}
      <LinkPreviewHost />

    </div>
  )
}

// ---- 以下组件必须定义在 App 外部（模块级） ----
// 否则每次 App 重渲染都会创建新的组件类型，导致 React 整棵卸载重建（页面闪烁）。

function SectionPanel({ children }: { children: React.ReactNode }) {
  return <div>{children}</div> // 磨砂大背景已下线：内容直接平铺在页面上
}

// ---------- 分类图标（首页一级菜单）：categories.icon 存 lucide 图标名；无图标的旧数据按 id 稳定随机展示 ----------
const CATEGORY_ICONS: Record<string, any> = {
  Sparkles, Folder, Bookmark, Star, Globe, Compass, Search, Layers, Grid3x3, LayoutGrid,
  Terminal, Code, Database, Cloud, Server, Cpu, Smartphone, HardDrive, Wifi, Rocket,
  Briefcase, Wrench, Cog, Hammer, Package, Archive, ShoppingBag, ShoppingCart, CreditCard, Wallet,
  Coins, TrendingUp, PieChart, Calculator, Banknote, PiggyBank, Gamepad2, Music, Film, Tv,
  Headphones, Mic, Camera, Image: ImageIcon, Palette, Brush, PenTool, BookOpen, GraduationCap, Newspaper,
  Mail, MessageCircle, Users, User, Heart, Smile, Gift, Key, Fingerprint, Shield,
  Lock, Lightbulb, Zap, Flame, Leaf, TreePine, Sun, Moon, Plane, Car,
  Bike, Map: MapIcon, Home, Building2, Anchor, Utensils, Coffee, Pill, Stethoscope, Dumbbell,
  Trophy, Medal, Target, Microscope, Atom, Brain, Cat, Dog, Fish, Puzzle, Gem,
}
// 按 id/name 哈希稳定取模——同一分类每次渲染拿到同一个"随机"图标
function pickCategoryIconName(seed?: string): string {
  const names = Object.keys(CATEGORY_ICONS)
  const s = String(seed || Math.random())
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return names[h % names.length]
}
function CategoryIcon({ cat, className }: { cat: any; className?: string }) {
  const Icon = CATEGORY_ICONS[cat?.icon] || CATEGORY_ICONS[pickCategoryIconName(cat?.id || cat?.name)]
  return <Icon className={className} />
}
// 图标选择器（创建/编辑一级菜单）：8 列网格，点击选中再点取消
function IconPicker({ value, onChange }: { value: string; onChange: (n: string) => void }) {
  const t = useT()
  return (
    <div className="mt-3">
      <div className="text-xs text-gray-500 mb-1.5">{t('选择图标')}</div>
      <div className="grid grid-cols-8 gap-1.5 max-h-28 overflow-y-auto pr-1 [&::-webkit-scrollbar]:hidden">
        {Object.entries(CATEGORY_ICONS).map(([name, Icon]: any) => (
          <button key={name} type="button" title={name} onClick={() => onChange(name === value ? '' : name)}
            className={`h-8 rounded-lg flex items-center justify-center transition-colors ${value === name ? 'bg-blue-500 text-white' : 'bg-white/60 text-gray-500 hover:bg-blue-50'}`}>
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </div>
    </div>
  )
}

function SectionHeader({ title, count, unit }: { title: string; count: number; unit: string }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <h2 className="text-xl font-bold text-white">{title}</h2>
      <span className="text-sm font-medium text-blue-600 bg-blue-50/50 px-3 py-1 rounded-full border border-blue-100/50 backdrop-blur-sm">{count} {unit}</span>
    </div>
  )
}

function EmptyState({ icon: Icon, text, subtext, lightText = false }: { icon: any; text: string; subtext: string; lightText?: boolean }) {
  return (
    <div className="text-center py-20 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20">
      <div className={`inline-flex items-center justify-center w-16 h-16 bg-white/40 shadow-sm mb-4 rounded-full ${lightText ? 'text-white' : 'text-gray-300'}`}><Icon className="w-8 h-8" /></div>
      <h3 className={`text-lg font-medium mb-2 ${lightText ? 'text-white' : 'text-gray-800'}`}>{text}</h3>
      <p className={`text-sm ${lightText ? 'text-white' : 'text-gray-500'}`}>{subtext}</p>
    </div>
  )
}

function ToolGrid({ tools }: { tools: any[] }) {
  if (!tools?.length) return null
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {tools.map((tool) => (
        <ToolCard key={tool.id || tool.name} tool={tool} />
      ))}
    </div>
  )
}

function ToolCard({ tool }: { tool: any }) {
  const t = useT()
  const initials = tool.name?.charAt(0)?.toUpperCase() || '?'
  return (
    <motion.a href={tool.url} target="_blank" rel="noopener noreferrer"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      className="group relative overflow-hidden flex flex-col bg-slate-900/20 backdrop-blur-md border border-white/30 p-5 rounded-2xl hover:bg-slate-900/35 hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)] hover:border-white/50 transition-all duration-300">
      <div className="absolute inset-0 bg-gradient-to-br from-white/15 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      <div className="relative z-20 flex flex-col h-full">
        <div className="flex items-start justify-between mb-4">
          <div className="w-12 h-12 rounded-2xl bg-slate-900/30 border border-white/40 shadow-sm flex items-center justify-center text-lg font-bold text-white group-hover:scale-105 transition-transform duration-300">
            {initials}
          </div>
        </div>
        <h3 className="font-semibold text-white text-base mb-1.5 truncate transition-colors">{tool.name}</h3>
        <p className="text-sm text-white line-clamp-2 leading-relaxed flex-1">{tool.desc ? t(tool.desc) : null}</p>
      </div>
    </motion.a>
  )
}

/** A sortable list where items can be dragged to reorder */
function DraggableList({ items, onReorder, children }: {
  items: any[]; onReorder: (list: any[]) => void; children: (item: any, idx: number) => React.ReactNode
}) {
  const dragIdx = useRef<number | null>(null)
  return (
    <div className="mt-1 space-y-0.5">
      {items.map((item: any, idx: number) => (
        <div key={item.id} draggable className="select-none"
          onDragStart={(e) => { dragIdx.current = idx; e.dataTransfer.setData('text/plain', String(idx)); e.currentTarget.classList.add('opacity-50') }}
          onDragEnd={(e) => { e.currentTarget.classList.remove('opacity-50') }}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('scale-[1.02]') }}
          onDragLeave={(e) => { e.currentTarget.classList.remove('scale-[1.02]') }}
          onDrop={(e) => {
            e.preventDefault(); e.currentTarget.classList.remove('scale-[1.02]')
            if (dragIdx.current === null || dragIdx.current === idx) return
            const list = [...items]
            const [moved] = list.splice(dragIdx.current, 1)
            const targetIdx = dragIdx.current < idx ? idx - 1 : idx
            list.splice(targetIdx, 0, moved)
            dragIdx.current = null
            onReorder(list)
          }}>
          {children(item, idx)}
        </div>
      ))}
    </div>
  )
}

/** A sortable grid where items can be dragged to reorder; also supports cross-grid (category) moves */
/** Shared drag state so cards can be dragged across category grids */
let gridDragState: { item: any; sourceKey: string } | null = null

const isWidgetItem = (item: any) => item?.type === 'stock' || item?.type === 'gold' || item?.type === 'countdown' || item?.type === 'weread' || item?.type === 'fishtank' || item?.type === 'todo' || item?.type === 'weathercard'

function DraggableGrid({ items, onReorder, children, disabled, gridKey, onDropExternal, spanOf, clsOf }: {
  items: any[]; onReorder: (list: any[]) => void; children: (item: any, idx: number) => React.ReactNode; disabled?: boolean
  gridKey?: string; onDropExternal?: (item: any, dropIndex: number) => void
  spanOf?: (item: any) => number // 组件纵向跨几行（1-3）
  clsOf?: (item: any) => string // 附加网格类（如极简模式下组件跨 3 列保持宽度）
}) {
  const dragIdx = useRef<number | null>(null)
  return (
    <>
      {items.map((item: any, idx: number) => (
        <div key={item.id} draggable={!disabled} className={`h-full min-h-0 select-none ${clsOf?.(item) || ''}`}
           style={spanOf && spanOf(item) > 1 ? { gridRow: `span ${spanOf(item)}` } : undefined}
           onDragStart={(e) => { if (disabled) return; dragIdx.current = idx; gridDragState = { item, sourceKey: gridKey || '' }; e.dataTransfer.setData('text/plain', String(idx)); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('opacity-50') }}
           onDragEnd={(e) => { e.currentTarget.classList.remove('opacity-50'); gridDragState = null; dragIdx.current = null }}
           onDragOver={(e) => { if (disabled) return; e.preventDefault(); e.currentTarget.classList.add('scale-[1.02]') }}
           onDragLeave={(e) => { e.currentTarget.classList.remove('scale-[1.02]') }}
           onDrop={(e) => {
             if (disabled) return
             e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('scale-[1.02]')
             const drag = gridDragState
             gridDragState = null
             // 来自其他分类的卡片 → 移动到当前分类
             if (drag && gridKey && drag.sourceKey !== gridKey) {
               onDropExternal?.(drag.item, idx)
               dragIdx.current = null
               return
             }
             if (dragIdx.current === null || dragIdx.current === idx) return
             const list = [...items]
             const [moved] = list.splice(dragIdx.current, 1)
             const targetIdx = dragIdx.current < idx ? idx - 1 : idx
             list.splice(targetIdx, 0, moved)
             dragIdx.current = null
             onReorder(list)
           }}>
           {/* 跨行组件：wrapper 已 span N 行（行高固定 98px），卡片 h-full 填满 */}
           {children(item, idx)}
         </div>
       ))}
     </>
   )
 }

 // NEW 角标两段式动画（IntersectionObserver 每阶段只触发一次）：
 // 首次进入视口 → 斜向高光扫过，角标保留（localStorage newBadgeShined 记录已扫过）
 // 刷新后再次进入视口 → 沙化成粒子被风吹散，结束时 onSeen（服务端计数）+ onDone（本地记已读，角标永久消失）
 function NewBadge({ id, onSeen, onDone }: { id: string; onSeen: () => void; onDone: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [phase, setPhase] = useState<'idle' | 'shine' | 'burst' | 'done'>('idle')
  const fired = useRef(false)
  const [wasShined] = useState(() => {
    try { return (JSON.parse(localStorage.getItem('newBadgeShined') || '[]') as string[]).includes(id) } catch { return false }
  })
  const parts = useMemo(() => Array.from({ length: 44 }, () => ({
    x: Math.random() * 38, y: Math.random() * 20,
    dx: 26 + Math.random() * 84, dy: -34 + Math.random() * 52,
    s: 1.5 + Math.random() * 2.2, rot: (Math.random() * 540) | 0,
    dur: 520 + Math.random() * 680, delay: Math.random() * 280,
    c: ['#ef4444', '#dc2626', '#f87171', '#fb7185', '#fca5a5', '#fde68a'][Math.floor(Math.random() * 6)],
  })), [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((es) => {
      if (fired.current || !es.some(e => e.isIntersecting)) return
      fired.current = true
      io.disconnect()
      if (wasShined) {
        // 二次进入视口（刷新后）：直接沙化飞走并标记已读
        onSeen()
        setPhase('burst')
        setTimeout(() => { setPhase('done'); onDone() }, 1500)
      } else {
        // 首次进入视口：只扫高光，角标保留到下次刷新才飞走
        try {
          const arr = JSON.parse(localStorage.getItem('newBadgeShined') || '[]') as string[]
          if (!arr.includes(id)) { arr.push(id); localStorage.setItem('newBadgeShined', JSON.stringify(arr)) }
        } catch { /* ignore */ }
        setPhase('shine')
        setTimeout(() => setPhase('idle'), 520)
      }
    }, { threshold: 0.6 })
    io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // 沙化粒子：Web Animations API 逐粒随机飞散（风向右偏上 + 旋转 + 缩小淡出）
  useEffect(() => {
    if (phase !== 'burst' || !hostRef.current) return
    hostRef.current.querySelectorAll('span').forEach((el, i) => {
      const p = parts[i]
      if (!p) return
      el.animate([
        { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate(${p.dx}px, ${p.dy}px) rotate(${p.rot}deg) scale(0.6)`, opacity: 0 },
      ], { duration: p.dur, delay: p.delay, easing: 'cubic-bezier(0.2,0.6,0.3,1)', fill: 'forwards' })
    })
  }, [phase])
  if (phase === 'done') return null
  return (
    <div ref={ref} className="absolute -top-1.5 -right-1.5 z-10 pointer-events-none">
      <style>{`
        @keyframes lp-badge-shine { 0% { transform: translateX(-120%) skewX(-20deg) } 100% { transform: translateX(320%) skewX(-20deg) } }
        @keyframes lp-badge-fade { 0% { opacity: 1 } 100% { opacity: 0 } }
      `}</style>
      <div ref={hostRef} className="relative">
        {phase !== 'burst' ? (
          <div className="relative px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white bg-red-500 shadow-md overflow-hidden">
            NEW
            {phase === 'shine' && (
              <span className="absolute top-0 bottom-0 left-0 w-1/2"
                style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)', animation: 'lp-badge-shine 0.48s ease-in-out both' }} />
            )}
          </div>
        ) : (
          <>
            <div className="px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white bg-red-500 shadow-md" style={{ animation: 'lp-badge-fade 0.25s ease-out both' }}>NEW</div>
            {parts.map((p, i) => (
              <span key={i} className="absolute rounded-[1px]" style={{ left: p.x, top: p.y, width: p.s, height: p.s, background: p.c }} />
            ))}
          </>
        )}
      </div>
    </div>
  )
 }

 function HomeToolCard({ tool, onContextMenu, viewed, onView, onPasswordRequired, minimal }: { tool: any; onContextMenu?: (e: React.MouseEvent) => void; viewed: boolean; onView: () => void; onPasswordRequired?: (tool: any) => void; minimal?: boolean }) {
  const t = useT()
  const handleClick = (e: React.MouseEvent) => {
    // If tool has password, intercept click
    if (tool.password) {
      e.preventDefault()
      onPasswordRequired?.(tool)
      return
    }
    // Track click count
    const token = getToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    fetch(`/api/tools/${tool.id}/click`, { method: 'POST', headers }).catch(() => {})
    if (!viewed && tool.id.startsWith('follow-')) {
      fetch(`/api/tools/${tool.id}/view`, { method: 'POST', headers }).catch(() => {})
      onView()
    }
  }

  const showNew = !viewed && tool.id.startsWith('follow-') && tool.viewed === 0

  return (
    <div className="relative group h-full" onContextMenu={onContextMenu}>
      {showNew && (
        <NewBadge id={tool.id} onSeen={() => navigator.sendBeacon(`/api/tools/${tool.id}/view`, '')} onDone={onView} />
      )}
      <a href={tool.url} target="_blank" rel="noopener noreferrer" draggable={false}
        onMouseEnter={(e) => scheduleLinkPreview(
          { url: tool.url, name: tool.name, desc: tool.desc || undefined, icon: tool.icon && isImageIcon(tool.icon) ? tool.icon : undefined },
          e.currentTarget)
        }
        onMouseLeave={cancelLinkPreview}
        onMouseDown={cancelLinkPreview}
        onClick={(e) => { cancelLinkPreview(); handleClick(e) }}
        onAuxClick={(e) => { if (e.button === 1) { cancelLinkPreview(); handleClick(e) } }}
        className={minimal
          ? "relative flex h-full w-full items-center justify-center rounded-2xl transition-all hover:shadow-md hover:opacity-90 overflow-hidden"
          : "block h-full p-3 rounded-2xl bg-white/70 border border-white/80 hover:bg-white/90 hover:shadow-md transition-all ring-1 ring-black/[0.03]"}
        style={minimal ? (tool.icon && isImageIcon(tool.icon) ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: tool.bg_color || '#3B82F6' }) : undefined}>
        {minimal ? (
          tool.icon && isImageIcon(tool.icon) ? (
            <img src={tool.icon} className="w-full h-full object-contain p-3" />
          ) : (
            <span className={`${iconFontSize(tool.icon || tool.name)} leading-[1.1] text-center flex flex-col items-center font-bold`}
              style={{ color: tool.text_color || '#FFFFFF' }}>
              {iconTextLines(tool.icon || tool.name).map((line: string, i: number) => <span key={i}>{line}</span>)}
            </span>
          )
        ) : (
          <div className="flex items-center gap-3 h-full">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0 overflow-hidden"
              style={tool.icon && isImageIcon(tool.icon) ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: tool.bg_color || '#3B82F6', color: tool.text_color || '#FFFFFF' }}>
              {tool.icon && isImageIcon(tool.icon) ? (
                <img src={tool.icon} className="w-full h-full object-contain p-1.5" />
              ) : (
                <div className={`${iconFontSize((tool.icon || tool.name), 'small')} leading-[1.1] text-center flex flex-col items-center`}>
                  {iconTextLines(tool.icon || tool.name).map((line: string, i: number) => <span key={i}>{line}</span>)}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-gray-800 text-sm truncate flex items-center gap-1" title={tool.name}>
                <span className="truncate">{tool.name}</span>
                {tool.link_status === 'dead' && (
                  <span className="flex-shrink-0 inline-flex" title={tool.last_http_status ? t('链接已失效（HTTP {status}）', { status: tool.last_http_status }) : t('链接已失效')}>
                    <Link2Off className="w-3.5 h-3.5 text-red-500" />
                  </span>
                )}
              </h4>
              {tool.desc && <p className="text-xs text-gray-400 truncate mt-0.5">{t(tool.desc)}</p>}
            </div>
          </div>
        )}
        {minimal && tool.link_status === 'dead' && (
          <span className="absolute top-1.5 right-1.5 bg-white rounded-full p-0.5 shadow" title={tool.last_http_status ? t('链接已失效（HTTP {status}）', { status: tool.last_http_status }) : t('链接已失效')}>
            <Link2Off className="w-3 h-3 text-red-500" />
          </span>
        )}
      </a>
    </div>
  )
}

function RepoGrid({ repos }: { repos: any[] }) {
  const t = useT()
  if (!repos?.length) return <EmptyState icon={Box} text={t('暂无仓库')} subtext="" />
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {repos.map((repo: any) => (
        <RepoCard key={repo.id} repo={repo} />
      ))}
    </div>
  )
}

function RepoCard({ repo }: { repo: any }) {
  const t = useT()
  const handleClick = (e: React.MouseEvent) => {
    if (repo.has_updates) {
      fetch(`/api/follows/repo/${repo.id}/view`, { method: 'POST', credentials: 'include' }).catch(() => {})
    }
    window.open(`/repo/${repo.id}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <motion.div onClick={handleClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleClick(e as any)}
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      className="group text-left flex flex-col bg-white/20 backdrop-blur-md border border-white/30 p-5 rounded-2xl hover:bg-white/40 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-white/50 transition-all duration-300 ring-1 ring-black/[0.03] cursor-pointer">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold shadow-sm overflow-hidden" style={repo.icon_key ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: repo.bg_color || '#3B82F6', color: repo.text_color || '#FFFFFF' }}>
          {repo.icon_key ? <img src={repo.icon_key} className="w-full h-full object-contain p-1" /> : (repo.icon || repo.name?.charAt(0)?.toUpperCase() || '?')}
        </div>
        <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white text-sm truncate">{repo.name}</h3>
            </div>
          <p className="text-xs text-white/70">{t('{n} 个链接', { n: repo.link_count || 0 })} · {repo.visibility === 'public' ? t('共享') : repo.visibility === 'password' ? t('密码访问') : t('私密')}</p>
        </div>
      </div>
      {repo.description && <p className="text-sm text-white/80 line-clamp-2 mb-3">{repo.description}</p>}
      <div className="flex items-center gap-4 mt-auto pt-3 border-t border-white/20">
        <span className="flex items-center gap-1 text-xs font-semibold text-white/70">
          <Heart className="w-3.5 h-3.5" /> {repo.follower_count || 0}
        </span>
        <span className="flex items-center gap-1 text-xs font-semibold text-white/70">
          <Star className="w-3.5 h-3.5" /> {repo.bookmark_count || 0}
        </span>
      </div>
    </motion.div>
  )
}

function DiscoverRepoGrid({ repos, user, follows, bookmarks }: { repos: any[]; user: any; follows: any; bookmarks: any }) {
  const t = useT()
  if (!repos?.length) return <EmptyState icon={Box} text={t('暂无仓库')} subtext="" lightText />
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {repos.map((repo: any) => (
        <DiscoverRepoCard key={repo.id} repo={repo} user={user} follows={follows} bookmarks={bookmarks} />
      ))}
    </div>
  )
}

function DiscoverRepoCard({ repo, user, follows, bookmarks }: { repo: any; user: any; follows: any; bookmarks: any }) {
  const t = useT()
  const [isFollowing, setIsFollowing] = useState(repo.is_following || false)
  const [isBookmarked, setIsBookmarked] = useState(repo.is_bookmarked || false)
  const [followerCount, setFollowerCount] = useState(repo.follower_count || 0)
  const [bookmarkCount, setBookmarkCount] = useState(repo.bookmark_count || 0)

  const handleClick = () => {
    window.open(`/repo/${repo.id}`, '_blank', 'noopener,noreferrer')
  }

  const handleFollow = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!user) return
    try {
      if (isFollowing) {
        await follows.repo.unfollow(repo.id)
        setIsFollowing(false)
        setFollowerCount(c => Math.max(0, c - 1))
      } else {
        await follows.repo.follow(repo.id)
        setIsFollowing(true)
        setFollowerCount(c => c + 1)
      }
    } catch {}
  }

  const handleBookmark = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!user) return
    try {
      if (isBookmarked) {
        await bookmarks.repo.remove(repo.id)
        setIsBookmarked(false)
        setBookmarkCount(c => Math.max(0, c - 1))
      } else {
        await bookmarks.repo.add(repo.id)
        setIsBookmarked(true)
        setBookmarkCount(c => c + 1)
      }
    } catch {}
  }

  return (
    <div onClick={handleClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      className="group text-left flex flex-col bg-slate-900/20 backdrop-blur-md border border-white/30 rounded-2xl p-4 hover:bg-slate-900/35 hover:border-white/50 transition-all duration-200 ring-1 ring-black/[0.06] cursor-pointer">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold shadow-sm flex-shrink-0 overflow-hidden"
          style={repo.icon_key ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: repo.bg_color || '#3B82F6', color: repo.text_color || '#FFFFFF' }}>
          {repo.icon_key ? <img src={repo.icon_key} className="w-full h-full object-contain p-1" /> : (repo.icon || repo.name?.charAt(0)?.toUpperCase() || '?')}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white text-sm truncate leading-tight">{repo.name}</h3>
          <p className="text-xs text-white truncate">{t('{n} 个链接', { n: repo.link_count || 0 })}</p>
        </div>
      </div>
      {repo.description && <p className="text-xs text-white line-clamp-2 mb-2.5">{repo.description}</p>}
      <div className="flex items-center justify-between mt-auto pt-2.5 border-t border-white/20">
        <div className="flex items-center gap-3 text-xs text-white">
          <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" /> {followerCount}</span>
          <span className="flex items-center gap-1"><Star className="w-3.5 h-3.5" /> {bookmarkCount}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {user && (
            <button onClick={handleFollow}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isFollowing
                  ? 'bg-red-500/30 text-white hover:bg-red-500/45'
                  : 'bg-blue-500/30 text-white hover:bg-blue-500/45'
              }`}>
              <Heart className={`w-3 h-3 ${isFollowing ? 'fill-red-400' : ''}`} />
              {isFollowing ? t('已关注') : t('关注')}
            </button>
          )}
          {user && (
            <button onClick={handleBookmark}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isBookmarked
                  ? 'bg-amber-500/30 text-white hover:bg-amber-500/45'
                  : 'bg-white/15 text-white hover:bg-white/25'
              }`}>
              <Star className={`w-3 h-3 ${isBookmarked ? 'fill-amber-400' : ''}`} />
              {isBookmarked ? t('已收藏') : t('收藏')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
 

function StockWidgetCard({ widget, quote, onRemove, onHeightChange, onContextMenu }: { widget: any; quote: any; onRemove: () => void; onHeightChange?: (h: number) => void; onContextMenu?: (e: React.MouseEvent) => void }) {
  const isUp = quote && quote.regularMarketChange >= 0
  const price = quote?.regularMarketPrice
  const isLoaded = !!quote
  const height = widget.height || 1

  return (
    <div className="relative group h-full min-h-0">
      <button onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-red-400 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500">
        <X className="w-3 h-3" />
      </button>
      <div data-widget-card onContextMenu={onContextMenu}
        className={`h-full p-3 rounded-2xl bg-white/70 border border-white/80 hover:bg-white/90 hover:shadow-md transition-all ring-1 ring-black/[0.03] cursor-default select-none ${height > 1 ? 'flex items-center' : ''}`}>
        <div className={`flex items-center gap-3 ${height > 1 ? 'w-full' : ''}`}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-purple-100">
              <TrendingUp className="w-5 h-5 text-purple-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-gray-800 text-sm truncate">{quote?.shortName || widget.name || widget.symbol}</h4>
            {isLoaded && (
              <p className="text-xs text-gray-400 truncate mt-0.5">{quote.currency === 'HKD' ? 'HK$' : quote.currency === 'GBP' ? '£' : quote.currency === 'EUR' ? '€' : '$'}{price?.toFixed(2)}</p>
            )}
          </div>
        </div>
      </div>
      {onHeightChange && <WidgetResizeHandle height={height} onChange={onHeightChange} />}
    </div>
  )
}

function GoldPriceCard({ widget, quote, onRemove, onHeightChange, onContextMenu }: { widget: any; quote: any; onRemove: () => void; onHeightChange?: (h: number) => void; onContextMenu?: (e: React.MouseEvent) => void }) {
  const t = useT()
  const isLoaded = !!quote
  const height = widget.height || 1

  return (
    <div className="relative group h-full min-h-0">
      <button onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-red-400 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500">
        <X className="w-3 h-3" />
      </button>
      <div data-widget-card onContextMenu={onContextMenu}
        className={`h-full p-3 rounded-2xl bg-white/70 border border-white/80 hover:bg-white/90 hover:shadow-md transition-all ring-1 ring-black/[0.03] cursor-default select-none ${height > 1 ? 'flex items-center' : ''}`}>
        <div className={`flex items-center gap-3 ${height > 1 ? 'w-full' : ''}`}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-amber-100">
              <Gem className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-gray-800 text-sm truncate">{widget.name || t('黄金价格')}</h4>
            {isLoaded && (
              <p className="text-xs text-gray-400 truncate mt-0.5">¥{quote?.cnyPerGram?.toFixed(2)}{t('/克')}</p>
            )}
          </div>
        </div>
      </div>
      {onHeightChange && <WidgetResizeHandle height={height} onChange={onHeightChange} />}
    </div>
  )
}

