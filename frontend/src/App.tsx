// VERSION: cache-bust-20260728
 
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { motion } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { categories, tools, discover, repos as reposApi, me as meApi, faviconCache, follows, bookmarks, getToken, todos as todosApi, stocks, userPrefs } from './api'
import { gold } from './api'
import { categories as defaultCategories, tools as defaultTools } from './data'
import AuthModal from './components/AuthModal'
import UserPanel from './components/UserPanel'
import CreateRepoModal from './components/CreateRepoModal'
import WelcomeModal from './components/WelcomeModal'
import { HomeSkeleton } from './components/Skeleton'
import {
 Search, Menu, X, Home, Heart, Compass, ChevronDown, Star, User, Plus, Box, Globe,
 FolderPlus, Layers, Link2, Puzzle, Cpu, Code, PenTool, Coffee, BookOpen, Briefcase, Flame, Sparkles, TrendingUp, TrendingDown,
  Edit3, Trash2, ExternalLink, Camera, MoreVertical, Bell, CheckSquare, Gem, Lock,
} from 'lucide-react'

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
// 打开页面先用本地缓存立即渲染，后台拉最新数据，有变化才更新界面
function readSwr(key: string): any | null {
  try {
    const raw = localStorage.getItem(`swr:${key}`)
    return raw ? JSON.parse(raw).data ?? null : null
  } catch { return null }
}

function writeSwr(key: string, data: any) {
  try { localStorage.setItem(`swr:${key}`, JSON.stringify({ ts: Date.now(), data })) } catch {}
}

// revalidate：总是更新缓存；数据与缓存不同才触发界面更新（避免无意义重渲染）
function swrApply(key: string, cached: any, data: any, apply: (d: any) => void) {
  writeSwr(key, data)
  if (JSON.stringify(data) !== JSON.stringify(cached)) apply(data)
}

// 首页分类数据 → 渲染数据（含本地排序和默认兜底）
function applyCatsData(data: any) {
  const ids = loadOrder('cat_order')
  return data && data.length > 0
    ? (ids.length ? reorderByIds(data, ids) : data)
    : defaultCategories.map(c => ({ id: c.id, name: c.name }))
}

export default function App() {
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
  const [showCreateRepo, setShowCreateRepo] = useState(false)

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
    return cached ? applyCatsData(cached) : []
  })
  const [toolList, setToolList] = useState<any[]>(() => {
    const cached = readSwr('home:tools')
    return cached && cached.length > 0 ? cached : []
  })
  const [homeLoading, setHomeLoading] = useState(() => {
    try {
      return !(localStorage.getItem('swr:home:cats') && localStorage.getItem('swr:home:tools'))
    } catch { return true }
  })
  const [discoverData, setDiscoverData] = useState<any[]>([])
  const [userRepos, setUserRepos] = useState<any[]>([])
  const [followedRepos, setFollowedRepos] = useState<any[]>([])
  const [bookmarkedRepos, setBookmarkedRepos] = useState<any[]>([])
  const [publicRepos, setPublicRepos] = useState<any[]>([])
  const [discoverSort, setDiscoverSort] = useState<string>('followers')

  // Home page editor state
  const [showCreateCat, setShowCreateCat] = useState(false)
  const [parentCatId, setParentCatId] = useState('')
  const [newCatName, setNewCatName] = useState('')
  const [newCatPassword, setNewCatPassword] = useState('')
  const [newCatCats, setNewCatCats] = useState<string[]>([])
 const [newCatInput, setNewCatInput] = useState('')
  // Widget state
  const [widgetList, setWidgetList] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('widgets') || '[]') } catch { return [] }
  })
  const [showWidgetSelector, setShowWidgetSelector] = useState(false)
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
  const [editCatPassword, setEditCatPassword] = useState('')
  const [catContextMenu, setCatContextMenu] = useState<{ x: number; y: number; cat: any } | null>(null)
  // Home page blank area right-click menu
  const [homeContextMenu, setHomeContextMenu] = useState<{ x: number; y: number } | null>(null)

  // Home page tool state
  const [showAddTool, setShowAddTool] = useState(false)
  const [addToolCat, setAddToolCat] = useState('')
  const [addToolName, setAddToolName] = useState('')
  const [addToolUrl, setAddToolUrl] = useState('')
  const [addToolDesc, setAddToolDesc] = useState('')
  const [addToolIcon, setAddToolIcon] = useState('')
  const [addToolTextIcon, setAddToolTextIcon] = useState('')
  const [addToolColor, setAddToolColor] = useState(Math.floor(Math.random() * 16))
  const [addToolPassword, setAddToolPassword] = useState('')
  const [addToolCatError, setAddToolCatError] = useState('')
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

  // Notifications
  const [notifications, setNotifications] = useState<any[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [showNotifications, setShowNotifications] = useState(false)
  const notifPanelRef = useRef<HTMLDivElement>(null)
  const notifBtnRef = useRef<HTMLButtonElement>(null)

  // Todos
  const [todoList, setTodoList] = useState<any[]>([])
  const [showTodos, setShowTodos] = useState(false)
  const todoPanelRef = useRef<HTMLDivElement>(null)
  const todoBtnRef = useRef<HTMLButtonElement>(null)
  const [newTodo, setNewTodo] = useState('')

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
  const todoBadge = incompleteTodoCount > 99 ? '99+' : incompleteTodoCount > 0 ? String(incompleteTodoCount) : ''

  const handleAddTodo = async () => {
    if (!newTodo.trim()) return
    const todo = await todosApi.create(newTodo.trim())
    setTodoList(prev => [todo, ...prev])
   setNewTodo('')
 }
 const confirmAddStock = (result: any, categoryId: string) => {
    const newWidget = {
      id: `stock-${Date.now()}`,
      type: 'stock',
      symbol: result.symbol,
      name: result.shortname || result.symbol,
      category_id: categoryId,
    }
    setWidgetList(prev => [...prev, newWidget])
    setShowStockSearch(false)
    setStockSearchQuery('')
    setStockSearchResults([])
   setPendingStock(null)
}
 const confirmAddGold = (categoryId: string) => {
    const newWidget = {
      id: `gold-${Date.now()}`,
      type: 'gold',
      name: '黄金价格',
      category_id: categoryId,
    }
    setWidgetList(prev => [...prev, newWidget])
    setShowGoldCategorySelect(false)
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

  const loadHomeData = useCallback(() => {
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
    // 后台 revalidate：有变化才更新界面
    const catTask = categories.list().then(data => {
      swrApply('home:cats', cachedCats, data, (d) => setCategoryList(applyCatsData(d)))
    }).catch(() => { if (!cachedCats) setCategoryList(applyCatsData(null)) })
    const toolTask = tools.list().then(data => {
      swrApply('home:tools', cachedTools, data, applyTools)
    }).catch(() => { if (!cachedTools) applyTools(null) })
    Promise.all([catTask, toolTask]).finally(() => setHomeLoading(false))
  }, [])

  useEffect(() => {
    loadHomeData()
    discover.columns().then(setDiscoverData)
    const cachedDisc = readSwr('discover:repos')
    if (cachedDisc) setPublicRepos(cachedDisc)
    discover.repos().then(data => {
      swrApply('discover:repos', cachedDisc, data, setPublicRepos)
    }).catch(() => {})
  }, [loadHomeData])

  // Click outside to close panels
  useEffect(() => {
    if (!showTodos && !showNotifications) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      const inTodo = todoBtnRef.current?.contains(target) || todoPanelRef.current?.contains(target)
      const inNotif = notifBtnRef.current?.contains(target) || notifPanelRef.current?.contains(target)
      if (!inTodo && !inNotif) {
        setShowTodos(false); setShowNotifications(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showTodos, showNotifications])

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
    // 同步到服务端，然后从服务端刷新确保一致
    tools.reorder(reorderedItems.map((t: any, i: number) => ({ id: t.id, sort_order: i })))
      .then(() => loadHomeData())
      .catch(() => loadHomeData())
  }, [loadHomeData])

  const handleReorderCombined = useCallback((reorderedItems: any[]) => {
    // Save combined order so interleaving preserves on re-render
    const catId = reorderedItems[0]?.category_id
    if (catId) {
      itemOrderRef.current[catId] = reorderedItems.map((i: any) => i.id)
      localStorage.setItem('categoryItemOrder', JSON.stringify(itemOrderRef.current))
    }
    // Separate tools from stock widgets
    const reorderedTools = reorderedItems.filter((i: any) => !i.type || i.type !== 'stock')
    const reorderedWidgets = reorderedItems.filter((i: any) => i.type === 'stock')
    
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
        .catch(() => {})
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
    if (catId && user) userPrefs.save({ widgets: widgetList, itemOrder: itemOrderRef.current }).catch(() => {})
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
    tools.update(tool.id, { category_id: toCatId }).catch(() => {})
    tools.reorder(targetItems.filter((i: any) => !isWidgetItem(i)).map((t: any, i: number) => ({ id: t.id, sort_order: i }))).catch(() => {})
    if (user) userPrefs.save({ widgets: widgetList, itemOrder: itemOrderRef.current }).catch(() => {})
  }

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
  useEffect(() => {
    // Skip entirely on first mount — otherwise empty [] from new-browser
    // localStorage would overwrite cloud data before load effect runs.
    if (isFirstWidgetSync.current) {
      isFirstWidgetSync.current = false
      return
    }
    localStorage.setItem('widgets', JSON.stringify(widgetList))
    if (widgetList.length > 0) fetchStockQuotes().catch(() => {})
    if (widgetList.filter((w: any) => w.type === 'gold').length > 0) fetchGoldPrice().catch(() => {})
    // Only save to server after initial load from server has completed.
    // Without this guard, user change triggers save with stale widgetList=[].
    if (initialLoadDone.current && user) userPrefs.save({ widgets: widgetList, itemOrder: itemOrderRef.current }).catch(() => {})
  }, [widgetList, fetchStockQuotes, fetchGoldPrice, user])

  // Load widgets from server when user logs in
  useEffect(() => {
    if (!user) return
    userPrefs.load().then(data => {
      initialLoadDone.current = true
      if (data.widgets?.length > 0) {
        setWidgetList(data.widgets)
      }
      if (data.itemOrder && Object.keys(data.itemOrder).length > 0) {
        itemOrderRef.current = data.itemOrder
      }
    }).catch(() => { initialLoadDone.current = true })
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

 useEffect(() => {
   if (user) {
      const uid = user.id || 'me'
      // 缓存优先：立即用上次数据渲染，后台 revalidate
      const cachedRepos = readSwr(`u:${uid}:repos`)
      if (cachedRepos) {
        const ids = loadOrder('repo_order')
        setUserRepos(ids.length ? reorderByIds(cachedRepos, ids) : cachedRepos)
      }
      reposApi.list().then(data => {
        swrApply(`u:${uid}:repos`, cachedRepos, data, (d) => {
          const ids = loadOrder('repo_order')
          setUserRepos(ids.length ? reorderByIds(d, ids) : d)
        })
      }).catch(() => {})

      const cachedFollows = readSwr(`u:${uid}:follows`)
      if (cachedFollows) {
        const ids = loadOrder('follow_order')
        setFollowedRepos(ids.length ? reorderByIds(cachedFollows, ids) : cachedFollows)
      }
      meApi.followedRepos().then(data => {
        swrApply(`u:${uid}:follows`, cachedFollows, data, (d) => {
          const ids = loadOrder('follow_order')
          setFollowedRepos(ids.length ? reorderByIds(d, ids) : d)
        })
      }).catch(() => {})

      const cachedBookmarks = readSwr(`u:${uid}:bookmarks`)
      if (cachedBookmarks) setBookmarkedRepos(cachedBookmarks)
      meApi.bookmarkedRepos().then(data => {
        swrApply(`u:${uid}:bookmarks`, cachedBookmarks, data, setBookmarkedRepos)
      }).catch(() => {})
      fetchNotifications()
      fetchTodos()
    } else {
      setUserRepos([])
      setFollowedRepos([])
      setBookmarkedRepos([])
      setTodoList([])
      // 退出登录后重置到首页视图并重新加载默认数据
      setActiveNav('home')
      setActiveCategory('all')
      setExpandedSections({ home: true, repos: false, favorites: false, bookmarks: false, discover: false })
      loadHomeData()
    }
  }, [user])

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
    if (user) setShowUserPanel(true)
    else setShowAuth(true)
  }

  // ---------- Home page CRUD ----------
  const refreshHome = () => {
    categories.list().then(setCategoryList)
    tools.list().then(setToolList)
    if (user) {
      meApi.followedRepos().then(setFollowedRepos).catch(() => {})
      meApi.bookmarkedRepos().then(setBookmarkedRepos).catch(() => {})
    }
  }

  const createCategory = async () => {
    if (!newCatName.trim()) return
    const pid = parentCatId === '__select__' ? '' : (parentCatId || '')
    const newCat = await categories.create({ name: newCatName, parent_id: pid || undefined, password: newCatPassword || undefined })
    setNewCatName(''); setNewCatPassword(''); setNewCatCats([]); setParentCatId(''); setShowCreateCat(false)
    if (newCat) setCategoryList(prev => [...prev, newCat])
  }

  const updateCategory = async () => {
    if (!editCatId || !editCatName.trim()) return
    const updated = await categories.update(editCatId, { name: editCatName, password: editCatPassword || undefined })
    setEditCatId(null); setEditCatName(''); setEditCatPassword('')
    if (updated) setCategoryList(prev => prev.map(c => c.id === updated.id ? updated : c))
  }

  const clearCategoryPassword = async () => {
    if (!editCatId) return
    const updated = await categories.update(editCatId, { password: '' })
    setEditCatId(null); setEditCatName(''); setEditCatPassword('')
    if (updated) {
      setCategoryList(prev => prev.map(c => c.id === updated.id ? updated : c))
      setUnlockedCats(prev => { const s = new Set(prev); s.delete(updated.id); return s })
    }
  }

  const deleteCategory = async (id: string) => {
    await categories.delete(id)
    setCatContextMenu(null)
    setCategoryList(prev => prev.filter(c => c.id !== id))
    // Also remove tools under this category
    setToolList(prev => prev.filter(t => t.category_id !== id))
    if (activeCategory === id) setActiveCategory('all')
  }

  const createTool = async () => {
    if (!addToolName.trim() || !addToolUrl.trim()) return
    if (!addToolCat) { setAddToolCatError('请填写分类'); return }
    setAddToolCatError('')
    const colors = toolPalette[addToolColor]
    const icon = isImageIcon(addToolIcon) ? addToolIcon : (addToolTextIcon || addToolName.charAt(0).toUpperCase())
    const newTool = await tools.create({ name: addToolName, url: addToolUrl, desc: addToolDesc, category_id: addToolCat || undefined, icon, bg_color: colors.bg, text_color: colors.text, password: addToolPassword || undefined })
    setShowAddTool(false); setAddToolName(''); setAddToolUrl(''); setAddToolDesc(''); setAddToolIcon(''); setAddToolTextIcon(''); setAddToolPassword(''); setAddToolCatError('')
    setToolList(prev => [...prev, newTool])
  }

  const updateTool = async () => {
    if (!editTool) return
    const updated = await tools.update(editTool.id, { name: editTool.name, url: editTool.url, desc: editTool.desc, category_id: editTool.category_id, icon: editTool.icon, bg_color: editTool.bg_color, text_color: editTool.text_color, password: editTool.password !== undefined ? editTool.password : undefined })
    setEditTool(null)
    if (updated) setToolList(prev => prev.map(t => t.id === updated.id ? updated : t))
  }

  const deleteTool = async (id: string) => {
    await tools.delete(id)
    setToolContextMenu(null)
    setToolList(prev => prev.filter(t => t.id !== id))
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
    if (searchQuery.trim() && searchMode === 'local') return renderSearchResults()
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
        <SectionHeader title={`搜索结果: "${searchQuery}"`} count={results.length} unit="个结果" />
        {results.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-12">未找到匹配的链接</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {results.map((tool: any) => (
              <div key={tool.id} className="relative group"
                onContextMenu={(e) => { e.preventDefault(); setToolContextMenu({ x: e.clientX, y: e.clientY, tool }) }}>
                {viewedTools.has(tool.id) ? null : tool.id.startsWith('follow-') && tool.viewed === 0 && (
                  <div className="absolute -top-1.5 -right-1.5 z-10 px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white bg-red-500 shadow-md">
                    NEW
                  </div>
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
                      {tool.desc && <p className="text-xs text-gray-400 truncate mt-0.5">{tool.desc}</p>}
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

  // 分类内组合项（链接 + 组件），按保存的顺序排列
  const getCatItems = (catId: string) => {
    const catTools = toolList.filter((t: any) => t.category_id === catId)
    const catWidgets = widgetList.filter((w: any) => (w.type === 'stock' || w.type === 'gold') && w.category_id === catId)
    const allItems = [...catTools, ...catWidgets]
    const savedOrder = itemOrderRef.current[catId]
    if (savedOrder && savedOrder.length > 0) {
      const ordered = savedOrder.map((id: string) => allItems.find(i => i.id === id)).filter(Boolean)
      if (ordered.length === allItems.length) return ordered
    }
    return allItems
  }

  const renderHomeContent = () => {
    // 初始加载中 → 显示骨架屏
    if (homeLoading) return <HomeSkeleton />
    // Common tools section — top clicked tools (from all categories)
    const lockedCatIds = new Set(categoryList.filter((c: any) => c.password && !unlockedCats.has(c.id)).map((c: any) => c.id))
    const topTools = toolList.filter((t: any) => (t.click_count || 0) > 0 && !lockedCatIds.has(t.category_id))
      .sort((a: any, b: any) => (b.click_count || 0) - (a.click_count || 0))
      .slice(0, 12)
    
    const cats = activeCategory === 'all' ? categoryList.filter(c => !c.parent_id) : categoryList.filter(c => c.id === activeCategory)
    return (<>
      {topTools.length > 0 && (
        <SectionPanel key="__frequent__">
          <div className="flex items-center gap-3 mb-6">
            <span className="w-1.5 h-5 rounded-full bg-orange-400 inline-block" />
            <h2 className="text-xl font-bold text-gray-800">常用工具</h2>
            <span className="text-xs text-gray-400">点击次数排行</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {topTools.map((tool: any) => (
              <HomeToolCard key={tool.id} tool={tool} viewed={true} onView={() => {}}
                onPasswordRequired={(t) => setLinkPwdDialog({ tool: t, url: t.url })} />
            ))}
          </div>
        </SectionPanel>
      )}
      {cats.map((cat) => {
      // Find sub-categories for this parent
      const subCats = categoryList.filter((c: any) => c.parent_id === cat.id)
     const hasSubCats = subCats.length > 0
    const catStockWidgets = widgetList.filter(w => w.type === 'stock' && w.category_id === cat.id)
    const catGoldWidgets = widgetList.filter(w => w.type === 'gold' && w.category_id === cat.id)

     if (hasSubCats) {
        // Group tools by sub-category
        return (
          <SectionPanel key={cat.id}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <span className="w-1.5 h-5 rounded-full bg-blue-400 inline-block" />
                <h2 className="text-xl font-bold text-gray-800 cursor-context-menu"
                  onContextMenu={(e) => { if (user) { e.preventDefault(); e.stopPropagation(); setCatContextMenu({ x: e.clientX, y: e.clientY, cat }) } }}>{cat.name}</h2>
              </div>
            </div>
            {/* Uncategorized tools directly under parent — show BEFORE sub-categories */}
            {(() => {
              return (
                <div className="mb-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
                  onDragOver={(e) => { if (gridDragState?.item && !isWidgetItem(gridDragState.item) && user) e.preventDefault() }}
                  onDrop={(e) => { const d = gridDragState; if (d?.item && !isWidgetItem(d.item) && user) { e.preventDefault(); handleMoveToolToCategory(d.item, cat.id) } }}>
              <DraggableGrid items={getCatItems(cat.id)} disabled={!user} onReorder={handleReorderCombined}
                gridKey={cat.id} onDropExternal={(item, dropIndex) => handleMoveToolToCategory(item, cat.id, dropIndex)}>
                    {(item: any) => item.type === 'stock' ? (
                      <StockWidgetCard key={item.id} widget={item} quote={stockQuotes[item.symbol]} onRemove={() => setWidgetList(prev => prev.filter(x => x.id !== item.id))} />
                  ) : item.type === 'gold' ? (
                    <GoldPriceCard key={item.id} widget={item} quote={goldPrice} onRemove={() => setWidgetList(prev => prev.filter(x => x.id !== item.id))} />
                  ) : (
                      <HomeToolCard key={item.id} tool={item} viewed={viewedTools.has(item.id)} onView={() => markViewed(item.id)}
                        onPasswordRequired={(t) => setLinkPwdDialog({ tool: t, url: t.url })}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setToolContextMenu({ x: e.clientX, y: e.clientY, tool: item }) }} />
                    )}
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
                      <span className="w-1 h-4 rounded-full bg-blue-300 inline-block" />
                      <h3 className="font-semibold text-gray-700 text-sm cursor-context-menu"
                        onContextMenu={(e) => { if (user) { e.preventDefault(); e.stopPropagation(); setCatContextMenu({ x: e.clientX, y: e.clientY, cat: subCat }) } }}>{subCat.name}</h3>
                      <span className="text-xs text-gray-400">({subTools.length})</span>
                    </div>
                  </div>
                  {subLocked ? (
                    <div className="py-6 flex flex-col items-center justify-center gap-3 bg-white/40 rounded-2xl border border-dashed border-gray-200">
                     <p className="text-xs text-gray-400 text-center">已加密，请输入密码</p>
                      <input type="password"
                        ref={el => { catPwdRefs.current[subCat.id] = el }}
                       onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault()
                          const val = catPwdRefs.current[subCat.id]?.value
                          if (val === subCat.password) {
                            setUnlockedCats(prev => new Set([...prev, subCat.id]))
                            setCatPwdErrors(prev => { const r = { ...prev }; delete r[subCat.id]; return r })
                          } else {
                            setCatPwdErrors(prev => ({ ...prev, [subCat.id]: '密码错误' }))
                          }
                        }}}
                        placeholder="输入密码" className="h-9 px-3 bg-white/60 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-400/50 w-40 text-center" />
                      {catPwdErrors[subCat.id] && <p className="text-xs text-red-500 text-center">{catPwdErrors[subCat.id]}</p>}
                    </div>
                  ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
              onDragOver={(e) => { if (gridDragState?.item && !isWidgetItem(gridDragState.item) && user) e.preventDefault() }}
              onDrop={(e) => { const d = gridDragState; if (d?.item && !isWidgetItem(d.item) && user) { e.preventDefault(); handleMoveToolToCategory(d.item, subCat.id) } }}>
              <DraggableGrid items={getCatItems(subCat.id)} disabled={!user} onReorder={handleReorderCombined}
                gridKey={subCat.id} onDropExternal={(item, dropIndex) => handleMoveToolToCategory(item, subCat.id, dropIndex)}>
                      {(item: any) => item.type === 'stock' ? (
                        <StockWidgetCard key={item.id} widget={item} quote={stockQuotes[item.symbol]} onRemove={() => setWidgetList(prev => prev.filter(x => x.id !== item.id))} />
                  ) : item.type === 'gold' ? (
                    <GoldPriceCard key={item.id} widget={item} quote={goldPrice} onRemove={() => setWidgetList(prev => prev.filter(x => x.id !== item.id))} />
                  ) : (
                        <HomeToolCard key={item.id} tool={item} viewed={viewedTools.has(item.id)} onView={() => markViewed(item.id)}
                          onPasswordRequired={(t) => setLinkPwdDialog({ tool: t, url: t.url })}
                          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setToolContextMenu({ x: e.clientX, y: e.clientY, tool: item }) }} />
                      )}
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
        <SectionPanel key={cat.id}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <span className="w-1.5 h-5 rounded-full bg-blue-400 inline-block" />
              <h2 className="text-xl font-bold text-gray-800 cursor-context-menu"
                onContextMenu={(e) => { if (user) { e.preventDefault(); e.stopPropagation(); setCatContextMenu({ x: e.clientX, y: e.clientY, cat }) } }}>{cat.name}</h2>
              <span className="text-xs text-gray-400">{catTools.length} 个链接</span>
            </div>
          </div>
          {isLocked ? (
            <div className="py-10 flex flex-col items-center justify-center gap-4 bg-white/40 rounded-2xl border border-dashed border-gray-200">
             <p className="text-sm text-gray-400 text-center">此分类已加密，请输入密码查看</p>
              <input type="password"
                ref={el => { catPwdRefs.current[cat.id] = el }}
               onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault()
                  const val = catPwdRefs.current[cat.id]?.value
                  if (val === cat.password) {
                    setUnlockedCats(prev => new Set([...prev, cat.id]))
                    setCatPwdErrors(prev => { const r = { ...prev }; delete r[cat.id]; return r })
                  } else {
                    setCatPwdErrors(prev => ({ ...prev, [cat.id]: '密码错误' }))
                  }
                }}}
                placeholder="输入密码"
                className="h-10 px-4 bg-white/60 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm w-48 text-center" />
              {catPwdErrors[cat.id] && <p className="text-xs text-red-500 text-center">{catPwdErrors[cat.id]}</p>}
            </div>
          ) : catTools.length === 0 ? (
              catStockWidgets.length === 0 && catGoldWidgets.length === 0 ? (
              <div className="text-gray-400 text-sm text-center py-12 rounded-2xl border-2 border-dashed border-transparent transition-colors"
                onDragOver={(e) => { const d = gridDragState; if (d?.item && !isWidgetItem(d.item) && user) { e.preventDefault(); e.currentTarget.classList.add('border-blue-300', 'bg-white/40', 'text-blue-400') } }}
                onDragLeave={(e) => e.currentTarget.classList.remove('border-blue-300', 'bg-white/40', 'text-blue-400')}
                onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-blue-300', 'bg-white/40', 'text-blue-400'); const d = gridDragState; if (d?.item && !isWidgetItem(d.item) && user) handleMoveToolToCategory(d.item, cat.id) }}>
                暂无链接
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
                onDragOver={(e) => { if (gridDragState?.item && !isWidgetItem(gridDragState.item) && user) e.preventDefault() }}
                onDrop={(e) => { const d = gridDragState; if (d?.item && !isWidgetItem(d.item) && user) { e.preventDefault(); handleMoveToolToCategory(d.item, cat.id) } }}>
                <DraggableGrid items={getCatItems(cat.id)} disabled={!user} onReorder={handleReorderCombined}
                  gridKey={cat.id} onDropExternal={(item, dropIndex) => handleMoveToolToCategory(item, cat.id, dropIndex)}>
                  {(item: any) => item.type === 'stock' ? (
                    <StockWidgetCard key={item.id} widget={item} quote={stockQuotes[item.symbol]} onRemove={() => setWidgetList(prev => prev.filter(x => x.id !== item.id))} />
                  ) : item.type === 'gold' ? (
                    <GoldPriceCard key={item.id} widget={item} quote={goldPrice} onRemove={() => setWidgetList(prev => prev.filter(x => x.id !== item.id))} />
                  ) : (
                    <HomeToolCard key={item.id} tool={item} viewed={viewedTools.has(item.id)} onView={() => markViewed(item.id)}
                      onPasswordRequired={(t) => setLinkPwdDialog({ tool: t, url: t.url })}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setToolContextMenu({ x: e.clientX, y: e.clientY, tool: item }) }} />
                  )}
                </DraggableGrid>
              </div>
            )
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
              onDragOver={(e) => { if (gridDragState?.item && !isWidgetItem(gridDragState.item) && user) e.preventDefault() }}
              onDrop={(e) => { const d = gridDragState; if (d?.item && !isWidgetItem(d.item) && user) { e.preventDefault(); handleMoveToolToCategory(d.item, cat.id) } }}>
              <DraggableGrid items={getCatItems(cat.id)} disabled={!user} onReorder={handleReorderCombined}
                gridKey={cat.id} onDropExternal={(item, dropIndex) => handleMoveToolToCategory(item, cat.id, dropIndex)}>
                {(item: any) => item.type === 'stock' ? (
                  <StockWidgetCard key={item.id} widget={item} quote={stockQuotes[item.symbol]} onRemove={() => setWidgetList(prev => prev.filter(x => x.id !== item.id))} />
                  ) : item.type === 'gold' ? (
                    <GoldPriceCard key={item.id} widget={item} quote={goldPrice} onRemove={() => setWidgetList(prev => prev.filter(x => x.id !== item.id))} />
                  ) : (
                  <HomeToolCard key={item.id} tool={item} viewed={viewedTools.has(item.id)} onView={() => markViewed(item.id)}
                    onPasswordRequired={(t) => setLinkPwdDialog({ tool: t, url: t.url })}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setToolContextMenu({ x: e.clientX, y: e.clientY, tool: item }) }} />
                )}
              </DraggableGrid>
            </div>
          )}
        </SectionPanel>
      )
   })}
    </>
  )
}

  const renderReposContent = () => {
    return (
      <SectionPanel>
        <div className="flex items-center gap-3 mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-800">我的仓库</h2>
            <span className="text-xs text-gray-400">{userRepos.length} 个仓库</span>
          </div>
        </div>
        {!user ? (
          <EmptyState icon={Box} text="请先登录" subtext="登录后可查看仓库" />
        ) : userRepos.length === 0 ? (
          <EmptyState icon={Box} text="暂无仓库" subtext='点击左侧菜单中"创建仓库"开始' />
        ) : (
          <RepoGrid repos={userRepos} />
        )}
      </SectionPanel>
    )
  }

  const renderFavoritesContent = () => {
    return (
      <SectionPanel>
        <div className="flex items-center gap-3 mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-800">我的关注</h2>
            <span className="text-xs text-gray-400">{followedRepos.length} 个关注的仓库</span>
          </div>
        </div>
        {!user ? (
          <EmptyState icon={Heart} text="请先登录" subtext="登录后可查看关注的仓库" />
        ) : followedRepos.length === 0 ? (
          <EmptyState icon={Heart} text="暂无关注的仓库" subtext="在仓库页面点击关注按钮" />
        ) : (
          <RepoGrid repos={followedRepos} />
        )}
      </SectionPanel>
    )
  }

  const renderBookmarksContent = () => {
    return (
      <SectionPanel>
        <div className="flex items-center gap-3 mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-800">我的收藏</h2>
            <span className="text-xs text-gray-400">收藏的仓库</span>
          </div>
        </div>
        {!user ? (
          <EmptyState icon={Star} text="请先登录" subtext="登录后可查看收藏的仓库" />
        ) : bookmarkedRepos.length === 0 ? (
          <EmptyState icon={Star} text="暂无收藏的仓库" subtext="在仓库页面点击收藏按钮" />
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
        <SectionPanel>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-800">全部仓库</h2>
              <span className="text-xs text-gray-400">社区发布的公开仓库 · 关注仓库后，您的首页将会同步展示仓库链接</span>
            </div>
            <select value={discoverSort} onChange={e => setDiscoverSort(e.target.value)}
              className="h-9 px-3 bg-white/60 border border-white/80 rounded-xl text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400/50">
              <option value="followers">关注最多</option>
              <option value="bookmarks">收藏最多</option>
              <option value="recent">最近更新</option>
            </select>
          </div>
          <DiscoverRepoGrid repos={sortedRepos} user={user} follows={follows} bookmarks={bookmarks} />
        </SectionPanel>
      )
    }

    const column = discoverData.find((c) => c.id === activeColumn)
    return (
      <SectionPanel>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-white/60 shadow-sm border border-white flex items-center justify-center text-blue-500"><Compass className="w-5 h-5" /></div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">{column?.name || '发现'}</h2>
            <span className="text-xs text-gray-400">{column?.desc}</span>
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

      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-white/20 backdrop-blur-sm z-40 lg:hidden" onClick={() => setIsMobileMenuOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-48 bg-white/40 backdrop-blur-xl border-r border-white/60 shadow-[4px_0_24px_rgba(0,0,0,0.02)] transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:flex-shrink-0 flex flex-col h-screen ${
        isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="h-20 flex items-center justify-center px-2 border-b border-white/50 flex-shrink-0">
          <img src="/logo.png" alt="LinkPad" className="h-full max-h-8 w-auto object-contain" />
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1 relative z-10 min-h-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
          {/* 发现 — 移到最上面 */}
          <div>
            <button onClick={() => toggleSection('discover')} className={sidebarItemClass(activeNav === 'discover')}>
              <div className="flex items-center flex-1">
                <Compass className="w-4 h-4 mr-2.5 text-gray-400" />
                <span>发现</span>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expandedSections.discover ? 'rotate-0' : '-rotate-90'}`} />
            </button>
            {expandedSections.discover && (
              <div className="mt-1 space-y-0.5">
                <button onClick={() => handleColumnClick('repos')}
                  className={`w-full text-left pr-3 pl-[38px] py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                    activeColumn === 'repos' && activeNav === 'discover' ? 'text-blue-600 bg-blue-50/50' : 'text-gray-500 hover:text-gray-800 hover:bg-white/30'
                  }`}>
                  全部仓库
                </button>
              </div>
            )}
          </div>

          {/* 首页 */}
          <div>
            <button onClick={() => toggleSection('home')} className={sidebarItemClass(activeNav === 'home')}>
              <div className="flex items-center flex-1">
                <Home className="w-4 h-4 mr-2.5 text-gray-400" />
                <span>首页</span>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expandedSections.home ? 'rotate-0' : '-rotate-90'}`} />
            </button>
            {expandedSections.home && (
              <div className="mt-1 space-y-0.5">
                <DraggableList items={categoryList.filter((c: any) => !c.parent_id)} onReorder={(list) => {
                  // Merge reordered parents back into full categoryList
                  const newList = [...list, ...categoryList.filter((c: any) => c.parent_id)]
                  setCategoryList(newList); saveOrder('cat_order', newList)
                  categories.reorder(list.map((c: any, i: number) => ({ id: c.id, sort_order: i })))
                }}>
                  {(cat: any) => {
                    return (
                      <div key={cat.id} className="relative">
                        <div onContextMenu={(e) => { e.preventDefault(); setCatContextMenu({ x: e.clientX, y: e.clientY, cat }) }}>
                          <button onClick={() => handleCategoryClick(cat.id)}
                            className={`w-full text-left pr-3 pl-[38px] py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                            activeCategory === cat.id && activeNav === 'home' ? 'text-blue-600 bg-blue-50/50' : 'text-gray-500 hover:text-gray-800 hover:bg-white/30'
                          }`}>{cat.name}</button>
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
                  + 创建菜单
                </button>
              </div>
            )}
          </div>

          {/* 我的仓库 */}
          <div>
            <button onClick={() => toggleSection('repos')} className={sidebarItemClass(activeNav === 'repos')}>
              <div className="flex items-center flex-1">
                <Box className="w-4 h-4 mr-2.5 text-gray-400" />
                <span>我的仓库</span>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expandedSections.repos ? 'rotate-0' : '-rotate-90'}`} />
            </button>
            {expandedSections.repos && (
              <div className="mt-1 space-y-0.5">
                {!user ? (
                  <div className="px-3 py-2 text-xs text-gray-400 italic">请先登录</div>
                ) : userRepos.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-400 italic">暂无仓库</div>
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
                  + 创建仓库
                </button>
              </div>
            )}
          </div>

          {/* 我的关注 */}
          <div>
            <button onClick={() => toggleSection('favorites')} className={sidebarItemClass(activeNav === 'favorites')}>
              <div className="flex items-center flex-1">
                <Heart className="w-4 h-4 mr-2.5 text-gray-400" />
                <span>我的关注</span>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expandedSections.favorites ? 'rotate-0' : '-rotate-90'}`} />
            </button>
            {expandedSections.favorites && (
              <div className="mt-1 space-y-0.5">
                {!user ? (
                  <div className="px-3 py-2 text-xs text-gray-400 italic">请先登录</div>
                ) : followedRepos.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-400 italic">暂无关注的仓库</div>
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
                <span>我的收藏</span>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expandedSections.bookmarks ? 'rotate-0' : '-rotate-90'}`} />
            </button>
            {expandedSections.bookmarks && (
              <div className="mt-1 space-y-0.5">
                {!user ? (
                  <div className="px-3 py-2 text-xs text-gray-400 italic">请先登录</div>
                ) : bookmarkedRepos.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-400 italic">暂无收藏</div>
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
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Header */}
        <header className="h-20 bg-white/10 backdrop-blur-xl border-b border-white/20 flex items-center px-6 sm:px-8 lg:px-10 flex-shrink-0 sticky top-0 z-30 shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
          <button onClick={() => setIsMobileMenuOpen(true)} className="lg:hidden p-2 -ml-2 mr-2 text-gray-500 hover:text-gray-900 hover:bg-white/50 rounded-xl transition-colors flex-shrink-0">
            <Menu className="w-6 h-6" />
          </button>

          <div className="hidden lg:block flex-1" />

          <div className="max-w-xl w-full mx-auto px-2 sm:px-4">
            <div className="w-full relative group flex items-center">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex items-center gap-1">
                <button onClick={() => setSearchMode(searchMode === 'web' ? 'local' : 'web')}
                  className="flex items-center gap-1 text-sm font-medium text-gray-400 hover:text-gray-600 cursor-pointer outline-none">
                  <span>{searchMode === 'web' ? '网络' : '本地'}</span>
                  {searchMode === 'web' ? (
                    <svg className="w-4 h-4 text-gray-400 flex-shrink-0" viewBox="0 0 1024 1024" fill="currentColor">
                      <path d="M533.333333 42.666667C262.346667 42.666667 42.666667 262.346667 42.666667 533.333333s219.68 490.666667 490.666666 490.666667 490.666667-219.68 490.666667-490.666667S804.32 42.666667 533.333333 42.666667z m342.086667 760.253333c-29.266667-16-61.566667-29.633333-96.166667-40.853333 18.713333-63.493333 29.413333-134 31.153334-207.4h170.42a445.853333 445.853333 0 0 1-94.413334 254.446666q-5.4-3.113333-10.993333-6.193333z m-695.166667 6.193333A445.853333 445.853333 0 0 1 85.84 554.666667h170.42c1.74 73.373333 12.44 143.906667 31.153333 207.4-34.6 11.22-66.9 24.886667-96.166666 40.853333q-5.593333 3.08-10.993334 6.193333z m10.993334-545.366666c29.266667 15.966667 61.566667 29.633333 96.166666 40.853333-18.713333 63.493333-29.413333 134-31.153333 207.4H85.84a445.866667 445.866667 0 0 1 94.413333-254.446667q5.4 3.113333 10.993334 6.193334zM554.666667 341.073333c64.34-1.526667 126.5-9.94 183.64-24.606666 17.6 59.6 27.706667 126.106667 29.426666 195.533333H554.666667z m0-42.666666V87.226667c52.386667 9.293333 101.793333 52.666667 140.96 124.453333a502.986667 502.986667 0 0 1 29.153333 64.24c-52.853333 13.313333-110.4 21-170.113333 22.48z m-42.666667-211.18V298.4c-59.713333-1.48-117.26-9.166667-170.113333-22.48a502.986667 502.986667 0 0 1 29.153333-64.24C410.206667 139.886667 459.613333 96.52 512 87.226667z m0 253.846666V512H298.933333c1.72-69.426667 11.826667-135.933333 29.426667-195.533333 57.14 14.666667 119.3 23.08 183.64 24.606666zM298.933333 554.666667H512v170.926666c-64.34 1.526667-126.5 9.94-183.64 24.606667-17.6-59.6-27.693333-126.106667-29.426667-195.533333zM512 768.266667v211.173333c-52.386667-9.293333-101.793333-52.666667-140.96-124.453333a502.986667 502.986667 0 0 1-29.153333-64.24c52.853333-13.313333 110.4-21 170.113333-22.48z m42.666667 211.173333V768.266667c59.713333 1.48 117.26 9.166667 170.113333 22.48a502.986667 502.986667 0 0 1-29.153333 64.24c-39.166667 71.793333-88.573333 115.16-140.96 124.453333z m0-253.846667V554.666667h213.066666c-1.72 69.426667-11.826667 135.933333-29.426666 195.533333-57.14-14.666667-119.3-23.08-183.64-24.606667zM810.406667 512c-1.74-73.373333-12.406667-143.906667-31.153334-207.4 34.6-11.22 66.9-24.886667 96.166667-40.853333q5.586667-3.053333 10.993333-6.193334A445.866667 445.866667 0 0 1 980.826667 512zM858 224.626667c-1 0.553333-2 1.113333-3 1.666666-27.053333 14.753333-56.98 27.413333-89.1 37.826667a546.88 546.88 0 0 0-32.806667-72.873333c-18.113333-33.206667-38.526667-61.333333-60.926666-84A448.106667 448.106667 0 0 1 858 224.626667z m-463.473333-117.333334c-22.4 22.666667-42.813333 50.78-60.926667 84a546 546 0 0 0-32.806667 72.873334c-32.126667-10.46-62.06-23.12-89.113333-37.873334-1.013333-0.553333-2-1.113333-3-1.666666a448.106667 448.106667 0 0 1 185.833333-117.366667zM208.666667 842.04c1-0.553333 2-1.113333 3-1.666667 27.053333-14.753333 56.98-27.413333 89.1-37.826666a546 546 0 0 0 32.806666 72.873333c18.113333 33.206667 38.526667 61.333333 60.926667 84A448.106667 448.106667 0 0 1 208.666667 842.04z m463.473333 117.333333c22.4-22.666667 42.813333-50.78 60.926667-84a546.88 546.88 0 0 0 32.806666-72.873333c32.12 10.413333 62.046667 23.073333 89.1 37.826667 1.013333 0.553333 2 1.113333 3 1.666666a448.106667 448.106667 0 0 1-185.82 117.413334z"></path>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-gray-400 flex-shrink-0" viewBox="0 0 1024 1024" fill="currentColor">
                      <path d="M850.189474 41.229474H180.547368c-78.147368 0-141.473684 63.595789-141.473684 141.473684v410.677895c0 78.147368 63.595789 141.473684 141.473684 141.473684h307.738948v191.056842H249.802105c-14.821053 0-26.947368 12.126316-26.947368 26.947368s12.126316 26.947368 26.947368 26.947369h531.132632c14.821053 0 26.947368-12.126316 26.947368-26.947369s-12.126316-26.947368-26.947368-26.947368h-238.484211v-191.056842h307.738948c78.147368 0 141.473684-63.595789 141.473684-141.473684V182.703158c0-78.147368-63.595789-141.473684-141.473684-141.473684z m87.578947 552.151579c0 48.235789-39.343158 87.578947-87.578947 87.578947H180.547368c-48.235789 0-87.578947-39.343158-87.578947-87.578947V182.703158c0-48.235789 39.343158-87.578947 87.578947-87.578947h669.372632c48.235789 0 87.578947 39.343158 87.578947 87.578947v410.677895z"></path>
                    </svg>
                  )}
                  <ChevronDown className="w-3 h-3 text-gray-400" />
                </button>
              </div>
              <input type="text" placeholder={searchMode === 'web' ? '搜索网络内容...' : '搜索本地工具...'} value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && searchQuery.trim() && searchMode === 'web') { window.open(`https://www.baidu.com/s?wd=${encodeURIComponent(searchQuery.trim())}`, '_blank') } }}
                className="block w-full h-12 pl-[100px] pr-[72px] bg-white/50 backdrop-blur-md border border-white/60 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:bg-white/80 transition-all text-base placeholder-gray-400 text-gray-800 shadow-sm" />
              <div className="absolute right-0 inset-y-0 flex items-center pr-11 pointer-events-none">
                <Search className="w-5 h-5 text-gray-400" />
              </div>
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-1 justify-end min-w-0">
            {/* Todos */}
            {user && (
              <div className="relative flex-shrink-0">
                <button ref={todoBtnRef} onClick={() => { setShowTodos(!showTodos); if (!showTodos) fetchTodos() }}
                  className="relative w-10 h-10 rounded-2xl bg-white/30 backdrop-blur-xl border border-white/40 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:shadow-md transition-all">
                  <CheckSquare className="w-5 h-5" />
                  {todoBadge && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center shadow-md">
                      {todoBadge}
                    </span>
                  )}
                </button>

                {/* Todo Panel */}
                {showTodos && (
                  <div ref={todoPanelRef} className="absolute right-0 top-full mt-2 z-50 w-80 sm:w-96 bg-white/95 backdrop-blur-xl border border-gray-200/60 shadow-xl rounded-2xl p-4 max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between mb-3 px-1">
                        <span className="text-xs font-semibold text-gray-500">待办事项</span>
                        <span className="text-xs text-gray-400">{incompleteTodoCount} 项未完成</span>
                      </div>
                      <div className="flex gap-2 mb-3">
                        <input value={newTodo} onChange={e => setNewTodo(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleAddTodo() }}
                          placeholder="添加待办事项..."
                          className="flex-1 h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
                        <button onClick={handleAddTodo} className="h-10 px-4 rounded-xl bg-blue-500 text-white text-xs font-medium hover:bg-blue-600">添加</button>
                      </div>
                      <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
                        {todoList.length === 0 ? (
                          <p className="text-sm text-gray-400 text-center py-8">暂无待办事项</p>
                        ) : (
                          todoList.map((todo: any) => (
                            <div key={todo.id} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm transition-all ${todo.is_completed === 1 ? 'text-gray-400' : 'text-gray-700'}`}>
                              <button onClick={() => handleToggleTodo(todo.id, todo.is_completed)}
                                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${todo.is_completed === 1 ? 'bg-blue-500 border-blue-500' : 'border-gray-300 hover:border-blue-400'}`}>
                                {todo.is_completed === 1 && <span className="text-white text-xs font-bold">✓</span>}
                              </button>
                              <span className={`flex-1 truncate ${todo.is_completed === 1 ? 'line-through' : ''}`}>{todo.content}</span>
                              <button onClick={() => handleDeleteTodo(todo.id)} className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
              </div>
            )}

            {/* Notifications Bell */}
            {user && (
              <div className="relative flex-shrink-0">
                <button ref={notifBtnRef} onClick={() => { setShowNotifications(!showNotifications); if (!showNotifications) fetchNotifications() }}
                  className="relative w-10 h-10 rounded-2xl bg-white/30 backdrop-blur-xl border border-white/40 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:shadow-md transition-all">
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow-md">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>

                {/* Notification Panel */}
                {showNotifications && (
                  <div ref={notifPanelRef} className="absolute right-0 top-full mt-2 z-50 w-80 sm:w-96 bg-white/95 backdrop-blur-xl border border-gray-200/60 shadow-xl rounded-2xl p-3 max-h-96 overflow-y-auto" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between mb-2 px-1">
                        <span className="text-xs font-semibold text-gray-500">通知</span>
                        {unreadCount > 0 && (
                          <button onClick={markNotificationsRead} className="text-xs text-blue-500 hover:text-blue-600">全部标为已读</button>
                        )}
                      </div>
                      {notifications.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-8">暂无通知</p>
                      ) : (
                        <div className="space-y-1">
                          {notifications.map((n: any) => (
                            <div key={n.id} className={`flex items-start gap-3 px-3 py-2.5 rounded-xl text-sm ${n.is_read ? 'text-gray-500' : 'text-gray-800 bg-blue-50/50'}`}>
                              <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center text-gray-400 font-bold text-xs overflow-hidden shrink-0">
                                {n.actor_avatar ? <img src={n.actor_avatar} className="w-full h-full object-cover" /> : n.actor_name?.charAt(0)?.toUpperCase() || '?'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm leading-relaxed">{n.message}</p>
                                <p className="text-xs text-gray-400 mt-0.5">{new Date(n.created_at + 'Z').toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                              </div>
                              {!n.is_read && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
              </div>
            )}

            {/* Avatar — top-right */}
            <button onClick={handleAvatarClick} className={`flex items-center justify-center font-bold shadow-sm hover:shadow-md transition-all flex-shrink-0 overflow-hidden ${user ? 'w-10 h-10 rounded-2xl bg-white/30 backdrop-blur-xl border border-white/40 text-gray-500 ring-2 ring-gray-200/60' : 'h-10 px-4 rounded-2xl bg-blue-500 text-white hover:bg-blue-600 text-sm'}`}>
              {user?.avatar_url ? <img src={user.avatar_url} className="w-full h-full object-cover" /> : user ? user.nickname?.charAt(0)?.toUpperCase() || <User className="w-5 h-5" /> : '立即登录'}
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pt-4 px-6 sm:px-8 lg:px-10 pb-6 scroll-smooth"
          onContextMenu={(e) => { if (activeNav === 'home' && !searchQuery.trim() && user) { e.preventDefault(); setHomeContextMenu({ x: e.clientX, y: e.clientY }) } }}>
          <div className="max-w-6xl mx-auto space-y-8">{renderContent()}</div>
        </div>

        <footer className="h-14 border-t border-white/20 bg-white/10 backdrop-blur-xl flex items-center justify-center px-6 sm:px-8 flex-shrink-0 z-20">
          <div className="text-xs text-gray-500 font-medium">&copy; 2026 LinkPad 版权所有<span className="hidden sm:inline"> · 关注链接仓库 · 首页同步更新</span></div>
        </footer>
      </main>

      {/* Backdrop for panels */}
      {(showTodos || showNotifications) && (
        <div className="fixed inset-0 z-40 pointer-events-none" />
      )}

      {/* Modals */}
      {showAuth && <AuthModal initialTab={welcomeAuthTab} onClose={() => setShowAuth(false)} />}
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
      {showUserPanel && <UserPanel onClose={() => setShowUserPanel(false)} />}
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
          <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            {parentCatId === '__select__' ? (
              <>
                <h3 className="font-bold text-gray-800 mb-4">创建子分类</h3>
                <select value="" onChange={e => setParentCatId(e.target.value)}
                  className="w-full h-12 px-4 mb-3 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm">
                  <option value="" disabled>请选择父菜单</option>
                  {categoryList.filter((c: any) => !c.parent_id).map((cat: any) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
                <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="子分类名称" autoFocus
                  className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
                <input value={newCatPassword} onChange={e => setNewCatPassword(e.target.value)} type="password" placeholder="密码（选填）"
                  className="w-full h-12 px-4 mt-3 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
                <div className="flex gap-2 mt-3">
                  <button onClick={() => { setShowCreateCat(false); setParentCatId(''); setNewCatPassword('') }} className="flex-1 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">取消</button>
                  <button onClick={createCategory} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600">创建</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-bold text-gray-800 mb-4">创建菜单</h3>
                <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="菜单名称" autoFocus
                  className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
                <input value={newCatPassword} onChange={e => setNewCatPassword(e.target.value)} type="password" placeholder="密码（选填）"
                  className="w-full h-12 px-4 mt-3 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
                <div className="flex gap-2 mt-3">
                  <button onClick={() => { setShowCreateCat(false); setParentCatId(''); setNewCatPassword('') }} className="flex-1 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">取消</button>
                  <button onClick={createCategory} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600">创建</button>
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
          <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            {(() => {
              const cat = categoryList.find(c => c.id === editCatId);
              const isSubCat = cat?.parent_id;
              return (
                <>
                  <h3 className="font-bold text-gray-800 mb-4">{isSubCat ? '编辑子分类' : '编辑菜单'}</h3>
                  {isSubCat && (
                    <p className="text-xs text-blue-600 mb-3 bg-blue-50 px-3 py-1.5 rounded-lg inline-block">父菜单：{categoryList.find(c => c.id === cat?.parent_id)?.name}</p>
                  )}
                  <input value={editCatName} onChange={e => setEditCatName(e.target.value)} placeholder={isSubCat ? '子分类名称' : '菜单名称'} autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') updateCategory() }}
                    className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
                  <input value={editCatPassword} onChange={e => setEditCatPassword(e.target.value)} type="password" placeholder={cat?.password ? '密码（留空不修改）' : '密码（选填）'}
                    className="w-full h-12 px-4 mt-3 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
                  {cat?.password && (
                    <button onClick={clearCategoryPassword} className="mt-2 text-xs text-red-500 hover:text-red-600 flex items-center gap-1 transition-colors">
                      <Lock className="w-3 h-3" /> 此分类已加密，点击取消加密
                    </button>
                  )}
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => { setEditCatId(null); setEditCatPassword('') }} className="flex-1 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">取消</button>
                    <button onClick={updateCategory} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600">保存</button>
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
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => { setShowAddTool(false); setAddToolCatError('') }} />
          <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4 max-h-[80vh] overflow-y-auto [&::-webkit-scrollbar]:hidden">
            <h3 className="font-bold text-gray-800 mb-4">添加链接</h3>
            <div className="space-y-3">
              {/* Icon preview + selector */}
              <div className="flex flex-col items-center gap-2 pb-2">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-bold shadow-md overflow-hidden"
                  style={addToolIcon && isImageIcon(addToolIcon) ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: toolPalette[addToolColor]?.bg || '#3B82F6', color: toolPalette[addToolColor]?.text || '#FFFFFF' }}>
                  {addToolIcon && isImageIcon(addToolIcon) ? (
                    <img src={addToolIcon} className="w-full h-full object-contain p-2" />
                  ) : (
                    <span className={iconFontSize(addToolTextIcon || addToolName)}>{addToolTextIcon || addToolName.charAt(0).toUpperCase() || '?'}</span>
                  )}
                </div>
                <div className="flex gap-1 flex-wrap justify-center">
                  {toolPalette.map((p, i) => (
                    <button key={i} type="button" onClick={() => setAddToolColor(i)}
                      className="w-5 h-5 rounded-full border border-white/60 shadow-sm transition-transform hover:scale-110"
                      style={{ backgroundColor: p.bg, transform: i === addToolColor ? 'scale(1.3)' : undefined }} />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input ref={addToolFileRef} type="file" accept="image/*" className="hidden" onChange={handleAddToolIconUpload} />
                  <button type="button" onClick={() => addToolFileRef.current?.click()} className="px-3 py-1.5 rounded-xl bg-blue-500 text-white text-xs hover:bg-blue-600 transition-all"><Camera className="w-3 h-3 inline mr-1" />上传图标</button>
                  {addToolIcon && isImageIcon(addToolIcon) && <button type="button" onClick={() => { setAddToolIcon(''); if (addToolFileRef.current) addToolFileRef.current.value = '' }} className="text-xs text-red-400 hover:text-red-600">清除</button>}
                </div>
                <input value={addToolTextIcon} onChange={e => setAddToolTextIcon(e.target.value)} placeholder="图标文字（最多4字）" maxLength={4} className="w-full h-10 px-4 bg-white/60 border border-white/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400 text-xs text-center" />
              </div>
              <input value={addToolName} onChange={e => setAddToolName(e.target.value)} placeholder="名称" className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              <input value={addToolUrl} onChange={e => {
                  setAddToolUrl(e.target.value)
                  const u = e.target.value
                  if (!u) return
                  faviconCache.resolve(u).then((r) => {
                    if (r.icon_url) {
                      setAddToolIcon(r.icon_url.startsWith('http') ? r.icon_url : (window.location.origin + r.icon_url))
                    }
                  })
                }} placeholder="地址（https://...）" className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              <input value={addToolDesc} onChange={e => setAddToolDesc(e.target.value)} placeholder="描述（选填）" className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              <input value={addToolPassword} onChange={e => setAddToolPassword(e.target.value)} type="password" placeholder="密码（选填）" className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              {/* Category selector */}
               <select value={addToolCat} onChange={e => { setAddToolCat(e.target.value); setAddToolCatError('') }}
                  className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm">
                  <option value="">选择分类</option>
                  {categoryList.filter((c: any) => !c.parent_id).map((cat: any) => (
                    <optgroup key={cat.id} label={cat.name}>
                      <option value={cat.id}>{cat.name} - 全部</option>
                      {categoryList.filter((sc: any) => sc.parent_id === cat.id).map((sc: any) => (
                        <option key={sc.id} value={sc.id}>{cat.name} &gt; {sc.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {addToolCatError && <p className="text-xs text-red-500">{addToolCatError}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setShowAddTool(false); setAddToolCatError('') }} className="flex-1 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">取消</button>
                <button onClick={createTool} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600">添加</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Tool Modal */}
      {editTool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setEditTool(null)} />
          <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4 max-h-[80vh] overflow-y-auto [&::-webkit-scrollbar]:hidden">
            <h3 className="font-bold text-gray-800 mb-4">编辑链接</h3>
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
                  <button type="button" onClick={() => editToolFileRef.current?.click()} disabled={editToolIconUploading} className="px-3 py-1.5 rounded-xl bg-blue-500 text-white text-xs hover:bg-blue-600"><Camera className="w-3 h-3 inline mr-1" />上传图标</button>
                  {editTool.icon && isImageIcon(editTool.icon) && <button type="button" onClick={() => { setEditTool({ ...editTool, icon: '' }); if (editToolFileRef.current) editToolFileRef.current.value = '' }} className="text-xs text-red-400 hover:text-red-600">清除</button>}
                </div>
                {(!editTool.icon || !isImageIcon(editTool.icon)) && (
                  <input value={editTool.icon || ''} onChange={e => setEditTool({ ...editTool, icon: e.target.value })} placeholder="图标文字（最多4字）" maxLength={4} className="w-full h-10 px-4 bg-white/60 border border-white/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400 text-xs text-center" />
                )}
              </div>
              <input value={editTool.name} onChange={e => setEditTool({ ...editTool, name: e.target.value })} placeholder="名称" className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              <input value={editTool.url} onChange={e => {
                  setEditTool({ ...editTool, url: e.target.value })
                  const u = e.target.value
                  if (!u) return
                  faviconCache.resolve(u).then((r) => {
                    if (r.icon_url) {
                      setEditTool((prev: any) => ({ ...prev, icon: r.icon_url.startsWith('http') ? r.icon_url : (window.location.origin + r.icon_url) }))
                    }
                  })
                }} placeholder="地址" className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              <input value={editTool.desc || ''} onChange={e => setEditTool({ ...editTool, desc: e.target.value })} placeholder="描述" className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              <input value={editTool.password || ''} onChange={e => setEditTool({ ...editTool, password: e.target.value })} type="password" placeholder="密码（选填）" className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              {/* Category selector */}
              <select value={editTool.category_id || ''} onChange={e => setEditTool({ ...editTool, category_id: e.target.value })}
                className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm">
                <option value="">选择分类</option>
                {categoryList.filter((c: any) => !c.parent_id).map((cat: any) => (
                  <optgroup key={cat.id} label={cat.name}>
                    <option value={cat.id}>{cat.name} - 全部</option>
                    {categoryList.filter((sc: any) => sc.parent_id === cat.id).map((sc: any) => (
                      <option key={sc.id} value={sc.id}>{cat.name} &gt; {sc.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <div className="flex gap-2">
                <button onClick={() => setEditTool(null)} className="flex-1 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">取消</button>
                <button onClick={updateTool} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600">保存</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Category Context Menu */}
      {catContextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCatContextMenu(null)} />
          <div className="fixed z-50 bg-white/90 backdrop-blur-xl border border-white/60 shadow-xl rounded-2xl p-2 w-44" style={{ left: catContextMenu.x, top: catContextMenu.y }}>
           {!catContextMenu.cat.parent_id && (
             <button onClick={() => { setParentCatId(catContextMenu.cat.id); setNewCatName(''); setShowCreateCat(true); setCatContextMenu(null) }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-blue-600 hover:bg-blue-50"><FolderPlus className="w-4 h-4" /> 添加子分类</button>
           )}
           <button onClick={() => { setAddToolCat(catContextMenu.cat.id); setAddToolCatError(''); setShowAddTool(true); setCatContextMenu(null) }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-blue-600 hover:bg-blue-50"><Link2 className="w-4 h-4" /> 创建链接</button>
            <button onClick={() => { setEditCatId(catContextMenu.cat.id); setEditCatName(catContextMenu.cat.name); setCatContextMenu(null) }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-700 hover:bg-white/60"><Edit3 className="w-4 h-4" /> 编辑</button>
            <button onClick={() => setConfirmAction({ message: '确定删除该分类及其所有链接？', onConfirm: () => deleteCategory(catContextMenu.cat.id) })}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /> 删除</button>
          </div>
        </>
      )}

      {/* Repo Context Menu */}
      {repoContextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setRepoContextMenu(null)} />
          <div className="fixed z-50 bg-white/90 backdrop-blur-xl border border-white/60 shadow-xl rounded-2xl p-2 w-40" style={{ left: repoContextMenu.x, top: repoContextMenu.y }}>
            <button onClick={() => setConfirmAction({ message: '确定删除该仓库？取消关注后该仓库的链接将从首页同步删除', onConfirm: () => deleteRepo(repoContextMenu.repo.id) })}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /> 删除</button>
          </div>
        </>
      )}

      {/* Tool Context Menu */}
      {toolContextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setToolContextMenu(null)} />
          <div className="fixed z-50 bg-white/90 backdrop-blur-xl border border-white/60 shadow-xl rounded-2xl p-2 w-40" style={{ left: toolContextMenu.x, top: toolContextMenu.y }}>
            <button onClick={() => { setEditTool({ ...toolContextMenu.tool }); setToolContextMenu(null) }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-700 hover:bg-white/60"><Edit3 className="w-4 h-4" /> 编辑</button>
            <button onClick={() => setConfirmAction({ message: '确定删除该链接？', onConfirm: () => deleteTool(toolContextMenu.tool.id) })}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /> 删除</button>
          </div>
        </>
      )}

      {/* Confirm Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setConfirmAction(null)} />
          <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <p className="text-sm text-gray-700 mb-6 leading-relaxed">{confirmAction.message}</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmAction(null)} className="flex-1 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">取消</button>
              <button onClick={() => { confirmAction.onConfirm(); setConfirmAction(null) }} className="flex-1 h-11 rounded-2xl bg-red-500 text-white hover:bg-red-600">确认</button>
            </div>
          </div>
        </div>
      )}

      {/* Link Password Dialog */}
      {linkPwdDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => { setLinkPwdDialog(null); setLinkPwdInput(''); setLinkPwdError('') }} />
          <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 mb-4">此链接需要密码</h3>
            <input type="password" value={linkPwdInput} onChange={e => { setLinkPwdInput(e.target.value); setLinkPwdError('') }}
              onKeyDown={e => { if (e.key === 'Enter') {
                if (linkPwdInput === linkPwdDialog.tool.password) {
                  window.open(linkPwdDialog.url, '_blank')
                  setLinkPwdDialog(null); setLinkPwdInput(''); setLinkPwdError('')
                } else {
                  setLinkPwdError('密码错误')
                }
              }}}
              placeholder="请输入密码" autoFocus
              className="w-full h-12 px-4 mb-3 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
            {linkPwdError && <p className="text-xs text-red-500 mb-3">{linkPwdError}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setLinkPwdDialog(null); setLinkPwdInput(''); setLinkPwdError('') }} className="flex-1 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">取消</button>
              <button onClick={() => {
                if (linkPwdInput === linkPwdDialog.tool.password) {
                  window.open(linkPwdDialog.url, '_blank')
                  setLinkPwdDialog(null); setLinkPwdInput(''); setLinkPwdError('')
                } else {
                  setLinkPwdError('密码错误')
                }
              }} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600">确认</button>
            </div>
          </div>
        </div>
      )}

      {/* Home Page Blank Area Context Menu */}
      {homeContextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setHomeContextMenu(null)} />
          <div className="fixed z-50 bg-white/90 backdrop-blur-xl border border-white/60 shadow-xl rounded-2xl p-2 w-48 space-y-0.5" style={{ left: homeContextMenu.x, top: homeContextMenu.y }}>
           <button onClick={() => { setHomeContextMenu(null); setParentCatId(''); setShowCreateCat(true) }}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-blue-600 hover:bg-blue-50"><FolderPlus className="w-4 h-4" /> 创建菜单</button>
           <button onClick={() => { setHomeContextMenu(null); setParentCatId('__select__'); setShowCreateCat(true) }}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-blue-600 hover:bg-blue-50"><Layers className="w-4 h-4" /> 创建子分类</button>
            <div className="border-t border-white/60" />
           <button onClick={() => { setHomeContextMenu(null); setAddToolCat(''); setAddToolCatError(''); setShowAddTool(true) }}
             className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-blue-600 hover:bg-blue-50"><Link2 className="w-4 h-4" /> 创建链接</button>
            <div className="border-t border-white/60" />
           <button onClick={() => { setHomeContextMenu(null); setShowWidgetSelector(true) }}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-purple-600 hover:bg-purple-50"><Puzzle className="w-4 h-4" /> 添加组件</button>
          </div>
        </>
      )}

      {/* Add to Home Modal */}
      {showAddToHome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowAddToHome(false)} />
          <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 mb-4">添加到首页</h3>
            <p className="text-sm text-gray-500 mb-3">选择目标分类：</p>
            <div className="space-y-1 max-h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden">
              {categoryList.map((cat: any) => (
                <button key={cat.id} onClick={() => addToolToHome(cat.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-all">{cat.name}</button>
              ))}
            </div>
            <button onClick={() => setShowAddToHome(false)} className="w-full mt-3 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">取消</button>
          </div>
       </div>
     )}
      {/* Widget Selector Modal */}
      {showWidgetSelector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowWidgetSelector(false)} />
          <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 mb-4">添加组件</h3>
            <div className="space-y-1">
              <button onClick={() => { setShowWidgetSelector(false); setShowStockSearch(true) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-all">
               <TrendingUp className="w-5 h-5 text-blue-500" />
               <span>股票行情</span>
             </button>
              <button onClick={() => { setShowWidgetSelector(false); setShowGoldCategorySelect(true) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-gray-700 hover:bg-amber-50 hover:text-amber-600 transition-all">
                <Gem className="w-5 h-5 text-amber-500" />
                <span>黄金价格</span>
              </button>
            </div>
            <button onClick={() => setShowWidgetSelector(false)} className="w-full mt-3 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">取消</button>
          </div>
        </div>
      )}

      {/* Stock Search Modal */}
      {showStockSearch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => { setShowStockSearch(false); setPendingStock(null) }} />
          <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            {!pendingStock ? (
              <>
                <h3 className="font-bold text-gray-800 mb-4">选择股票</h3>
                <input type="text" value={stockSearchQuery} onChange={e => setStockSearchQuery(e.target.value)}
                  placeholder="输入股票代码或名称，如 AAPL" autoFocus
                  className="w-full h-11 px-4 mb-3 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm" />
                {stockSearchLoading && <p className="text-xs text-gray-400 text-center py-4">搜索中...</p>}
                {!stockSearchLoading && stockSearchResults.length === 0 && stockSearchQuery.trim() && (
                  <p className="text-xs text-gray-400 text-center py-4">未找到结果</p>
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
                  className="w-full mt-3 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">取消</button>
              </>
            ) : (
              <>
                <h3 className="font-bold text-gray-800 mb-4">选择分类</h3>
                <p className="text-sm text-gray-500 mb-3">将 <span className="font-semibold text-gray-700">{pendingStock.symbol}</span> 添加到：</p>
                <div className="space-y-1 max-h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden">
                  {categoryList.map((cat: any) => (
                    <button key={cat.id} onClick={() => confirmAddStock(pendingStock, cat.id)}
                      className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-all">{cat.name}</button>
                  ))}
                </div>
                <button onClick={() => setPendingStock(null)}
                  className="w-full mt-3 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">返回</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Gold Category Select Modal */}
      {showGoldCategorySelect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowGoldCategorySelect(false)} />
          <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 mb-4">选择分类</h3>
            <p className="text-sm text-gray-500 mb-3">将黄金价格添加到：</p>
            <div className="space-y-1 max-h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden">
              {categoryList.map((cat: any) => (
                <button key={cat.id} onClick={() => confirmAddGold(cat.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-amber-50 hover:text-amber-600 transition-all">{cat.name}</button>
              ))}
            </div>
            <button onClick={() => setShowGoldCategorySelect(false)}
              className="w-full mt-3 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50">取消</button>
          </div>
        </div>
      )}

    </div>
  )
}

// ---- 以下组件必须定义在 App 外部（模块级） ----
// 否则每次 App 重渲染都会创建新的组件类型，导致 React 整棵卸载重建（页面闪烁）。

function SectionPanel({ children }: { children: React.ReactNode }) {
  return <div className="bg-white/60 backdrop-blur-md rounded-3xl border border-white/70 shadow-[0_4px_16px_-6px_rgba(0,0,0,0.06)] p-6 sm:p-8">{children}</div>
}

function SectionHeader({ title, count, unit }: { title: string; count: number; unit: string }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <h2 className="text-xl font-bold text-gray-800">{title}</h2>
      <span className="text-sm font-medium text-blue-600 bg-blue-50/50 px-3 py-1 rounded-full border border-blue-100/50 backdrop-blur-sm">{count} {unit}</span>
    </div>
  )
}

function EmptyState({ icon: Icon, text, subtext }: { icon: any; text: string; subtext: string }) {
  return (
    <div className="text-center py-20 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20">
      <div className="inline-flex items-center justify-center w-16 h-16 bg-white/40 shadow-sm text-gray-300 mb-4 rounded-full"><Icon className="w-8 h-8" /></div>
      <h3 className="text-lg font-medium text-gray-800 mb-2">{text}</h3>
      <p className="text-sm text-gray-500">{subtext}</p>
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
  const initials = tool.name?.charAt(0)?.toUpperCase() || '?'
  return (
    <motion.a href={tool.url} target="_blank" rel="noopener noreferrer"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      className="group relative overflow-hidden flex flex-col bg-white/20 backdrop-blur-md border border-white/30 p-5 rounded-2xl hover:bg-white/40 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-white/50 transition-all duration-300">
      <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      <div className="relative z-20 flex flex-col h-full">
        <div className="flex items-start justify-between mb-4">
          <div className="w-12 h-12 rounded-2xl bg-white/80 border border-white shadow-sm flex items-center justify-center text-lg font-bold text-transparent bg-clip-text bg-gradient-to-br from-blue-500 to-purple-600 group-hover:scale-105 transition-transform duration-300">
            {initials}
          </div>
        </div>
        <h3 className="font-semibold text-gray-800 text-base mb-1.5 truncate group-hover:text-blue-600 transition-colors">{tool.name}</h3>
        <p className="text-sm text-gray-500 line-clamp-2 leading-relaxed flex-1">{tool.desc}</p>
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

const isWidgetItem = (item: any) => item?.type === 'stock' || item?.type === 'gold'

function DraggableGrid({ items, onReorder, children, disabled, gridKey, onDropExternal }: {
  items: any[]; onReorder: (list: any[]) => void; children: (item: any, idx: number) => React.ReactNode; disabled?: boolean
  gridKey?: string; onDropExternal?: (item: any, dropIndex: number) => void
}) {
  const dragIdx = useRef<number | null>(null)
  return (
    <>
      {items.map((item: any, idx: number) => (
        <div key={item.id} draggable={!disabled} className="select-none"
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
           {children(item, idx)}
         </div>
       ))}
     </>
   )
 }

 function HomeToolCard({ tool, onContextMenu, viewed, onView, onPasswordRequired }: { tool: any; onContextMenu?: (e: React.MouseEvent) => void; viewed: boolean; onView: () => void; onPasswordRequired?: (tool: any) => void }) {
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
    <div className="relative group" onContextMenu={onContextMenu}>
      {showNew && (
        <div className="absolute -top-1.5 -right-1.5 z-10 px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white bg-red-500 shadow-md">
          NEW
        </div>
      )}
      <a href={tool.url} target="_blank" rel="noopener noreferrer" draggable={false} onClick={handleClick}
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
            {tool.desc && <p className="text-xs text-gray-400 truncate mt-0.5">{tool.desc}</p>}
          </div>
        </div>
      </a>
    </div>
  )
}

function RepoGrid({ repos }: { repos: any[] }) {
  if (!repos?.length) return <EmptyState icon={Box} text="暂无仓库" subtext="" />
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {repos.map((repo: any) => (
        <RepoCard key={repo.id} repo={repo} />
      ))}
    </div>
  )
}

function RepoCard({ repo }: { repo: any }) {
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
              <h3 className="font-semibold text-gray-800 text-sm truncate">{repo.name}</h3>
            </div>
          <p className="text-xs text-gray-400">{repo.link_count || 0} 个链接 · {repo.visibility === 'public' ? '共享' : repo.visibility === 'password' ? '密码访问' : '私密'}</p>
        </div>
      </div>
      {repo.description && <p className="text-sm text-gray-500 line-clamp-2 mb-3">{repo.description}</p>}
      <div className="flex items-center gap-4 mt-auto pt-3 border-t border-white/20">
        <span className="flex items-center gap-1 text-xs font-semibold text-gray-400">
          <Heart className="w-3.5 h-3.5" /> {repo.follower_count || 0}
        </span>
        <span className="flex items-center gap-1 text-xs font-semibold text-gray-400">
          <Star className="w-3.5 h-3.5" /> {repo.bookmark_count || 0}
        </span>
      </div>
    </motion.div>
  )
}

function DiscoverRepoGrid({ repos, user, follows, bookmarks }: { repos: any[]; user: any; follows: any; bookmarks: any }) {
  if (!repos?.length) return <EmptyState icon={Box} text="暂无仓库" subtext="" />
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {repos.map((repo: any) => (
        <DiscoverRepoCard key={repo.id} repo={repo} user={user} follows={follows} bookmarks={bookmarks} />
      ))}
    </div>
  )
}

function DiscoverRepoCard({ repo, user, follows, bookmarks }: { repo: any; user: any; follows: any; bookmarks: any }) {
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
      className="group text-left flex flex-col bg-white/20 backdrop-blur-md border border-gray-200/40 rounded-2xl p-4 hover:bg-white/40 hover:border-gray-300/60 transition-all duration-200 ring-1 ring-black/[0.06] cursor-pointer">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold shadow-sm flex-shrink-0 overflow-hidden"
          style={repo.icon_key ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: repo.bg_color || '#3B82F6', color: repo.text_color || '#FFFFFF' }}>
          {repo.icon_key ? <img src={repo.icon_key} className="w-full h-full object-contain p-1" /> : (repo.icon || repo.name?.charAt(0)?.toUpperCase() || '?')}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-800 text-sm truncate leading-tight">{repo.name}</h3>
          <p className="text-xs text-gray-400 truncate">{repo.link_count || 0} 个链接</p>
        </div>
      </div>
      {repo.description && <p className="text-xs text-gray-400 line-clamp-2 mb-2.5">{repo.description}</p>}
      <div className="flex items-center justify-between mt-auto pt-2.5 border-t border-gray-200/30">
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" /> {followerCount}</span>
          <span className="flex items-center gap-1"><Star className="w-3.5 h-3.5" /> {bookmarkCount}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {user && (
            <button onClick={handleFollow}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isFollowing
                  ? 'bg-red-50 text-red-500 hover:bg-red-100'
                  : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
              }`}>
              <Heart className={`w-3 h-3 ${isFollowing ? 'fill-red-400' : ''}`} />
              {isFollowing ? '已关注' : '关注'}
            </button>
          )}
          {user && (
            <button onClick={handleBookmark}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isBookmarked
                  ? 'bg-amber-50 text-amber-500 hover:bg-amber-100'
                  : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
              }`}>
              <Star className={`w-3 h-3 ${isBookmarked ? 'fill-amber-400' : ''}`} />
              {isBookmarked ? '已收藏' : '收藏'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
 

function StockWidgetCard({ widget, quote, onRemove }: { widget: any; quote: any; onRemove: () => void }) {
  const isUp = quote && quote.regularMarketChange >= 0
  const price = quote?.regularMarketPrice
  const isLoaded = !!quote

  return (
    <div className="relative group">
      <button onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-red-400 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500">
        <X className="w-3 h-3" />
      </button>
      <div className="block p-3 rounded-2xl bg-white/70 border border-white/80 hover:bg-white/90 hover:shadow-md transition-all ring-1 ring-black/[0.03] cursor-default">
        <div className="flex items-center gap-3">
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
    </div>
  )
}

function GoldPriceCard({ widget, quote, onRemove }: { widget: any; quote: any; onRemove: () => void }) {
  const isLoaded = !!quote

  return (
    <div className="relative group">
      <button onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-red-400 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500">
        <X className="w-3 h-3" />
      </button>
      <div className="block p-3 rounded-2xl bg-white/70 border border-white/80 hover:bg-white/90 hover:shadow-md transition-all ring-1 ring-black/[0.03] cursor-default">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-amber-100">
              <Gem className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-gray-800 text-sm truncate">{widget.name || '黄金价格'}</h4>
            {isLoaded && (
              <p className="text-xs text-gray-400 truncate mt-0.5">¥{quote?.cnyPerGram?.toFixed(2)}/克</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

