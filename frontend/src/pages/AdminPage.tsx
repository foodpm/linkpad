import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { admin, categories, tools, faviconCache } from '../api'
import { useT } from '../i18n'
import { AdminPageSkeleton } from '../components/Skeleton'

type Section = 'menus' | 'users' | 'repos'

// SVG icons as components
function IconHome() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> }
function IconMenu() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg> }
function IconUsers() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> }
function IconBox() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg> }
function IconBack() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg> }
function IconPlus() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> }
function IconEdit() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> }
function IconDelete() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> }
function IconDisable() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> }
function IconEnable() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> }
function IconEye() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> }
function IconEyeOff() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg> }
function IconSearch() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> }
function IconMail() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> }
function IconFolder() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> }
function IconLock() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> }
function IconGlobe() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> }
function IconLogout() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> }
function IconClock() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> }
function IconHeart() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> }
function IconStar() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> }
function IconRefresh() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> }

const NAV_ITEMS = [
  { id: 'menus' as Section, label: '默认菜单/链接', icon: IconMenu },
  { id: 'users' as Section, label: '用户管理', icon: IconUsers },
  { id: 'repos' as Section, label: '仓库管理', icon: IconBox },
]

function isImageIcon(icon: string): boolean {
  return icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('data:image') || icon.startsWith('/api/')
}

const toolPalette = [
  { bg: '#3B82F6', text: '#FFFFFF' }, { bg: '#8B5CF6', text: '#FFFFFF' },
  { bg: '#EC4899', text: '#FFFFFF' }, { bg: '#10B981', text: '#FFFFFF' },
  { bg: '#F59E0B', text: '#FFFFFF' }, { bg: '#6366F1', text: '#FFFFFF' },
  { bg: '#EF4444', text: '#FFFFFF' }, { bg: '#14B8A6', text: '#FFFFFF' },
  { bg: '#F97316', text: '#FFFFFF' }, { bg: '#0EA5E9', text: '#FFFFFF' },
  { bg: '#E11D48', text: '#FFFFFF' }, { bg: '#7C3AED', text: '#FFFFFF' },
  { bg: '#059669', text: '#FFFFFF' }, { bg: '#DC2626', text: '#FFFFFF' },
  { bg: '#2563EB', text: '#FFFFFF' }, { bg: '#D946EF', text: '#FFFFFF' },
]

export default function AdminPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const navigate = useNavigate()
  const [isAdmin, setIsAdmin] = useState(false)
  const [checking, setChecking] = useState(true)
  const [section, setSection] = useState<Section>('menus')
  const [mobileOpen, setMobileOpen] = useState(false)

  // Categories & Tools state
  const [catList, setCatList] = useState<any[]>([])
  const [toolList, setToolList] = useState<any[]>([])
  const [catSearch, setCatSearch] = useState('')
  const [toolSearch, setToolSearch] = useState('')
  const [toolCatFilter, setToolCatFilter] = useState('')

  // Modals
  const [showAddCat, setShowAddCat] = useState(false)
  const [editCat, setEditCat] = useState<any>(null)
  const [catName, setCatName] = useState('')
  const [showAddTool, setShowAddTool] = useState(false)
  const [editTool, setEditTool] = useState<any>(null)
  const [toolName, setToolName] = useState('')
  const [toolUrl, setToolUrl] = useState('')
  const [toolDesc, setToolDesc] = useState('')
  const [toolIcon, setToolIcon] = useState('')
  const [toolCatId, setToolCatId] = useState('')
  const [toolColor, setToolColor] = useState(Math.floor(Math.random() * 16))
  const [faviconLoading, setFaviconLoading] = useState(false)
  const addToolFileRef = useRef<HTMLInputElement>(null)
  const editToolFileRef = useRef<HTMLInputElement>(null)

  // User management
  const [userList, setUserList] = useState<any[]>([])
  const [userFilter, setUserFilter] = useState({ nickname: '', email: '', status: '' })
  const [usersCursor, setUsersCursor] = useState<string | null>(null)
  const [usersLoading, setUsersLoading] = useState(false)

  // Repo management
  const [repoList, setRepoList] = useState<any[]>([])
  const [repoFilter, setRepoFilter] = useState({ search: '', visibility: '', ownerEmail: '' })
  const [reposCursor, setReposCursor] = useState<string | null>(null)
  const [reposLoading, setReposLoading] = useState(false)

  // User metrics: total users + extension usage (independent of the paginated list)
  const [overview, setOverview] = useState<{
    users: number
    extensionUsers: number
    extensionInstalls: number
    today: { uv: number; pv: number }
    trend: Array<{ date: string; uv: number; pv: number }>
  } | null>(null)

  // Confirm dialog
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)

  useEffect(() => {
    if (!authLoading && !user) { navigate('/', { replace: true }); return }
    if (!authLoading && user) {
      admin.check().then(res => {
        if (!res.isAdmin) { navigate('/', { replace: true }); return }
        setIsAdmin(true); setChecking(false)
        loadCatsAndTools()
      })
    }
  }, [user, authLoading])

  const loadCatsAndTools = () => {
    categories.list({ admin: true }).then(setCatList)
    tools.list({ admin: true }).then(setToolList)
  }

  const loadUsers = (cursor = '') => {
    const p: any = {}
    if (userFilter.nickname) p.nickname = userFilter.nickname
    if (userFilter.email) p.email = userFilter.email
    if (userFilter.status) p.status = userFilter.status
    if (cursor) p.cursor = cursor
    setUsersLoading(true)
    admin.users.list(p).then((res: any) => {
      setUserList((prev: any[]) => (cursor ? [...prev, ...res.items] : res.items))
      setUsersCursor(res.nextCursor)
    }).catch(() => {}).finally(() => setUsersLoading(false))
  }

  const loadOverview = () => {
    admin.overview().then(setOverview).catch(() => {})
  }

  const loadRepos = (cursor = '') => {
    const p: any = {}
    if (repoFilter.search) p.search = repoFilter.search
    if (repoFilter.visibility) p.visibility = repoFilter.visibility
    if (repoFilter.ownerEmail) p.ownerEmail = repoFilter.ownerEmail
    if (cursor) p.cursor = cursor
    setReposLoading(true)
    admin.repos.list(p).then((res: any) => {
      setRepoList((prev: any[]) => (cursor ? [...prev, ...res.items] : res.items))
      setReposCursor(res.nextCursor)
    }).catch(() => {}).finally(() => setReposLoading(false))
  }

  useEffect(() => { if (isAdmin && section === 'users') { loadUsers(); loadOverview() } }, [isAdmin, section])
  useEffect(() => { if (isAdmin && section === 'repos') loadRepos() }, [isAdmin, section])

  // Category handlers
  const handleAddCategory = async () => {
    if (!catName.trim()) return
    await categories.create({ name: catName.trim() }, { admin: true })
    setCatName(''); setShowAddCat(false); loadCatsAndTools()
  }
  const handleUpdateCategory = async () => {
    if (!editCat || !catName.trim()) return
    await categories.update(editCat.id, { name: catName.trim() }, { admin: true })
    setEditCat(null); setCatName(''); loadCatsAndTools()
  }
  const handleDeleteCategory = (id: string) => {
    setConfirm({
      message: t('确定删除此分类？所有属于此分类的链接将被一并删除。'),
      onConfirm: async () => { await categories.delete(id, { admin: true }); loadCatsAndTools() }
    })
  }

  // Tool handlers
  const handleAddTool = async () => {
    if (!toolName.trim() || !toolUrl.trim()) return
    const c = toolPalette[toolColor]
    const icon = isImageIcon(toolIcon) ? toolIcon : toolName.charAt(0).toUpperCase()
    await tools.create({ name: toolName.trim(), url: toolUrl.trim(), desc: toolDesc.trim(), icon, category_id: toolCatId || undefined, bg_color: c.bg, text_color: c.text }, { admin: true })
    setToolName(''); setToolUrl(''); setToolDesc(''); setToolIcon(''); setToolCatId(''); setToolColor(Math.floor(Math.random() * 16))
    setShowAddTool(false); loadCatsAndTools()
  }
  const handleUpdateTool = async () => {
    if (!editTool || !toolName.trim() || !toolUrl.trim()) return
    const icon = isImageIcon(toolIcon) ? toolIcon : toolName.charAt(0).toUpperCase()
    await tools.update(editTool.id, { name: toolName.trim(), url: toolUrl.trim(), desc: toolDesc.trim(), icon, category_id: toolCatId || undefined, bg_color: editTool.bg_color, text_color: editTool.text_color }, { admin: true })
    setEditTool(null); setToolName(''); setToolUrl(''); setToolDesc(''); setToolIcon(''); setToolCatId(''); loadCatsAndTools()
  }
  const handleDeleteTool = (id: string) => {
    setConfirm({ message: t('确定删除此链接？'), onConfirm: async () => { await tools.delete(id, { admin: true, force: true }); loadCatsAndTools() } })
  }

  // User handlers
  const toggleUserStatus = (u: any) => {
    const newStatus = u.status === 'disabled' ? 'active' : 'disabled'
    setConfirm({
      message: t(newStatus === 'disabled' ? '确定禁用用户「{nickname}」？禁用后该用户将无法登录系统。' : '确定启用用户「{nickname}」？', { nickname: u.nickname }),
      onConfirm: async () => { await admin.users.setStatus(u.id, newStatus); loadUsers() }
    })
  }
  const handleDeleteUser = (u: any) => {
    setConfirm({ message: t('确定删除用户「{nickname}」？此操作不可恢复。', { nickname: u.nickname }), onConfirm: async () => { await admin.users.delete(u.id); loadUsers() } })
  }

  // Repo handlers
  const toggleRepoVisibility = (r: any) => {
    if (r.visibility === 'hidden') {
      setConfirm({ message: t('确定显示仓库「{name}」？', { name: r.name }), onConfirm: async () => { await admin.repos.setVisibility(r.id, 'public'); loadRepos() } })
    } else {
      setConfirm({ message: t('确定隐藏仓库「{name}」？隐藏后其他用户将无法查看。', { name: r.name }), onConfirm: async () => { await admin.repos.setVisibility(r.id, 'hidden'); loadRepos() } })
    }
  }
  const handleDeleteRepo = (r: any) => {
    setConfirm({ message: t('确定删除仓库「{name}」？此操作不可恢复。', { name: r.name }), onConfirm: async () => { await admin.repos.delete(r.id); loadRepos() } })
  }

  if (checking || authLoading) return <AdminPageSkeleton />
  if (!user || !isAdmin) return null

  const filteredCats = catList.filter((c: any) => !catSearch || c.name.toLowerCase().includes(catSearch.toLowerCase()))
  const filteredTools = toolList.filter((t: any) => {
    if (toolSearch && !t.name.toLowerCase().includes(toolSearch.toLowerCase()) && !t.url.toLowerCase().includes(toolSearch.toLowerCase())) return false
    if (toolCatFilter && t.category_id !== toolCatFilter) return false
    return true
  })
  const getCatName = (id: string) => catList.find(c => c.id === id)?.name || t('未分类')

  return (
    <div className="min-h-screen bg-[#f5f6f8] flex">
      {/* Mobile overlay */}
      {mobileOpen && <div className="fixed inset-0 bg-black/20 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-56 bg-[#1a1d23] text-white flex flex-col transform transition-transform duration-200 lg:translate-x-0 lg:static lg:z-auto ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-16 flex items-center px-5 border-b border-[#2a2d33]">
          <span className="text-sm font-semibold text-[#888] tracking-widest uppercase">{t('LinkPad 管理')}</span>
        </div>
        <nav className="flex-1 py-3">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon
            return (
              <button key={item.id} onClick={() => { setSection(item.id); setMobileOpen(false) }}
                className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-all border-l-3 ${section === item.id ? 'bg-[#24272e] text-white border-l-[#4f8cff]' : 'text-[#aaa] hover:text-white hover:bg-[#24272e] border-l-transparent'}`}>
                <Icon />
                <span>{t(item.label)}</span>
              </button>
            )
          })}
        </nav>
        <div className="p-4 border-t border-[#2a2d33]">
          <button onClick={() => navigate('/')} className="flex items-center gap-2.5 px-3 py-2 text-sm text-[#888] hover:text-white rounded-lg hover:bg-[#24272e] transition-all w-full">
            <IconBack /> {t('返回前台')}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {/* Top bar */}
        <header className="h-16 bg-white border-b border-[#e5e7eb] flex items-center px-5 sticky top-0 z-30">
          <button onClick={() => setMobileOpen(true)} className="lg:hidden mr-4 p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg">
            <IconMenu />
          </button>
          <h1 className="text-lg font-bold text-gray-900">{t(NAV_ITEMS.find(i => i.id === section)?.label || '')}</h1>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => { if (section === 'users') { loadUsers(); loadOverview() } else if (section === 'repos') loadRepos(); else loadCatsAndTools() }}
              className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all" title={t('刷新')}>
              <IconRefresh />
            </button>
            <button onClick={() => { logout(); navigate('/', { replace: true }) }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-all">
              <IconLogout /> {t('退出')}
            </button>
          </div>
        </header>

        <div className="p-6">
          {/* ==================== MENUS SECTION ==================== */}
          {section === 'menus' && (
            <div>
              {/* Categories */}
              <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden mb-6">
                <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f0f0]">
                  <h2 className="font-semibold text-gray-800">{t('默认分类')}</h2>
                  <button onClick={() => { setEditCat(null); setCatName(''); setShowAddCat(true) }}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-all">
                    <IconPlus /> {t('新增')}
                  </button>
                </div>
                {/* Filter */}
                <div className="flex items-center gap-2 px-5 py-3 border-b border-[#f0f0f0] bg-[#fafbfc]">
                  <div className="relative flex-1 max-w-xs">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><IconSearch /></span>
                    <input value={catSearch} onChange={e => setCatSearch(e.target.value)} placeholder={t('搜索分类名称...')}
                      className="w-full h-9 pl-9 pr-3 bg-white border border-[#e0e0e0] rounded-lg text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
                  </div>
                </div>
                {/* Table */}
                <div className="overflow-x-auto overscroll-x-contain">
                  <table className="admin-table w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="bg-[#f8f9fb] text-[#666] text-xs uppercase tracking-wider">
                        <th className="text-left py-3 px-5 font-semibold">{t('名称')}</th>
                        <th className="text-left py-3 px-5 font-semibold">{t('图标')}</th>
                        <th className="text-left py-3 px-5 font-semibold">{t('排序')}</th>
                        <th className="text-left py-3 px-5 font-semibold">{t('链接数')}</th>
                        <th className="text-left py-3 px-5 font-semibold">{t('创建时间')}</th>
                        <th className="text-left py-3 px-5 font-semibold">{t('操作')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCats.length === 0 ? (
                        <tr><td colSpan={6} className="text-center py-10 text-gray-400">{t('暂无数据')}</td></tr>
                      ) : filteredCats.map((cat: any) => (
                        <tr key={cat.id} className="border-t border-[#f0f0f0] hover:bg-[#fafbfc]">
                          <td className="py-3 px-5 font-medium text-gray-800">{cat.name}</td>
                          <td className="py-3 px-5 text-gray-400"><span className="inline-block px-2 py-0.5 bg-gray-100 rounded text-xs">{cat.icon || '-'}</span></td>
                          <td className="py-3 px-5 text-gray-500">{cat.sort_order ?? '-'}</td>
                          <td className="py-3 px-5 text-gray-500">{toolList.filter((t: any) => t.category_id === cat.id).length}</td>
                          <td className="py-3 px-5 text-gray-400 text-xs">{cat.created_at ? new Date(cat.created_at).toLocaleDateString('zh-CN') : '-'}</td>
                          <td className="py-3 px-5">
                            <div className="flex gap-1.5">
                              <button onClick={() => { setEditCat(cat); setCatName(cat.name) }} className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 text-[#3050F0] rounded text-xs hover:bg-blue-100 transition-all"><IconEdit /> {t('编辑')}</button>
                              <button onClick={() => handleDeleteCategory(cat.id)} className="flex items-center gap-1 px-2.5 py-1.5 bg-[#fef2f2] text-[#e44040] rounded text-xs hover:bg-[#fde8e8] transition-all"><IconDelete /> {t('删除')}</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Tools */}
              <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f0f0]">
                  <h2 className="font-semibold text-gray-800">{t('默认链接')}</h2>
                  <button onClick={() => { setEditTool(null); setToolName(''); setToolUrl(''); setToolDesc(''); setToolIcon(''); setToolCatId(''); setShowAddTool(true) }}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-all">
                    <IconPlus /> {t('新增')}
                  </button>
                </div>
                {/* Filter */}
                <div className="flex items-center gap-2 px-5 py-3 border-b border-[#f0f0f0] bg-[#fafbfc] flex-wrap">
                  <div className="relative flex-1 min-w-[160px] max-w-xs">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><IconSearch /></span>
                    <input value={toolSearch} onChange={e => setToolSearch(e.target.value)} placeholder={t('搜索名称或地址...')}
                      className="w-full h-9 pl-9 pr-3 bg-white border border-[#e0e0e0] rounded-lg text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
                  </div>
                  <select value={toolCatFilter} onChange={e => setToolCatFilter(e.target.value)}
                    className="h-9 px-3 bg-white border border-[#e0e0e0] rounded-lg text-sm outline-none focus:border-blue-400">
                    <option value="">{t('全部分类')}</option>
                    {catList.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                {/* Table */}
                <div className="overflow-x-auto overscroll-x-contain">
                  <table className="admin-table w-full min-w-[900px] text-sm">
                    <thead>
                      <tr className="bg-[#f8f9fb] text-[#666] text-xs uppercase tracking-wider">
                        <th className="text-left py-3 px-5 font-semibold">{t('名称')}</th>
                        <th className="text-left py-3 px-5 font-semibold">{t('地址')}</th>
                        <th className="text-left py-3 px-5 font-semibold">{t('分类')}</th>
                        <th className="text-left py-3 px-5 font-semibold">{t('创建时间')}</th>
                        <th className="text-left py-3 px-5 font-semibold">{t('操作')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTools.length === 0 ? (
                        <tr><td colSpan={5} className="text-center py-10 text-gray-400">{t('暂无数据')}</td></tr>
                      ) : filteredTools.map((tool: any) => (
                        <tr key={tool.id} className="border-t border-[#f0f0f0] hover:bg-[#fafbfc]">
                          <td className="py-3 px-5">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 overflow-hidden"
                                style={tool.icon && isImageIcon(tool.icon) ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : (tool.bg_color ? { backgroundColor: tool.bg_color } : { background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)' })}>
                                {tool.icon && isImageIcon(tool.icon) ? <img src={tool.icon} className="w-full h-full object-contain p-0.5" /> : (tool.name?.charAt(0)?.toUpperCase() || '?')}
                              </div>
                              <span className="font-medium text-gray-800">{tool.name}</span>
                            </div>
                          </td>
                          <td className="py-3 px-5 text-gray-400 text-xs max-w-[220px] truncate">{tool.url}</td>
                          <td className="py-3 px-5"><span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">{getCatName(tool.category_id)}</span></td>
                          <td className="py-3 px-5 text-gray-400 text-xs">{tool.created_at ? new Date(tool.created_at).toLocaleDateString('zh-CN') : '-'}</td>
                          <td className="py-3 px-5">
                            <div className="flex gap-1.5">
                              <button onClick={() => { setEditTool(tool); setToolName(tool.name); setToolUrl(tool.url); setToolDesc(tool.desc || ''); setToolIcon(tool.icon || ''); setToolCatId(tool.category_id || '') }}
                                className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 text-[#3050F0] rounded text-xs hover:bg-blue-100 transition-all"><IconEdit /> {t('编辑')}</button>
                              <button onClick={() => handleDeleteTool(tool.id)} className="flex items-center gap-1 px-2.5 py-1.5 bg-[#fef2f2] text-[#e44040] rounded text-xs hover:bg-[#fde8e8] transition-all"><IconDelete /> {t('删除')}</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ==================== USERS SECTION ==================== */}
          {section === 'users' && (
            <div>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
                <div className="bg-white rounded-xl border border-[#e5e7eb] px-5 py-4">
                  <p className="text-xs text-gray-400">{t('用户总数')}</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-800">{overview?.users ?? '-'}</p>
                </div>
                <div className="bg-white rounded-xl border border-[#e5e7eb] px-5 py-4">
                  <p className="text-xs text-gray-400">{t('今日活跃用户 UV')}</p>
                  <p className="mt-1 text-2xl font-semibold text-blue-600">{overview?.today.uv ?? '-'}</p>
                </div>
                <div className="bg-white rounded-xl border border-[#e5e7eb] px-5 py-4">
                  <p className="text-xs text-gray-400">{t('今日活跃 PV')}</p>
                  <p className="mt-1 text-2xl font-semibold text-blue-600">{overview?.today.pv ?? '-'}</p>
                </div>
                <div className="bg-white rounded-xl border border-[#e5e7eb] px-5 py-4">
                  <p className="text-xs text-gray-400">{t('使用插件的用户')}</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-800">{overview?.extensionUsers ?? '-'}</p>
                </div>
                <div className="bg-white rounded-xl border border-[#e5e7eb] px-5 py-4">
                  <p className="text-xs text-gray-400">{t('插件安装次数')}</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-800">{overview?.extensionInstalls ?? '-'}</p>
                </div>
              </div>
              {overview?.trend.length ? (
                <div className="bg-white rounded-xl border border-[#e5e7eb] px-5 py-4 mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-gray-800">{t('近 7 天活跃趋势')}</h2>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />{t('UV')}</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-300" />{t('PV')}</span>
                    </div>
                  </div>
                  <div className="flex items-end gap-2 h-28">
                    {overview.trend.map(day => {
                      const max = Math.max(1, ...overview.trend.flatMap(d => [d.uv, d.pv]))
                      return (
                        <div key={day.date} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full gap-1" title={`${day.date} · UV ${day.uv} · PV ${day.pv}`}>
                          <div className="w-full flex items-end justify-center gap-0.5 flex-1">
                            <div className="w-2.5 bg-blue-500 rounded-t" style={{ height: `${Math.max(day.uv ? 4 : 0, day.uv / max * 100)}%` }} />
                            <div className="w-2.5 bg-sky-300 rounded-t" style={{ height: `${Math.max(day.pv ? 4 : 0, day.pv / max * 100)}%` }} />
                          </div>
                          <span className="text-[10px] text-gray-400 whitespace-nowrap">{day.date.slice(5)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
              <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f0f0]">
                <h2 className="font-semibold text-gray-800">{t('用户列表')} <span className="text-gray-400 font-normal text-sm ml-1">({userList.length})</span></h2>
              </div>
              {/* Filter */}
              <div className="flex items-center gap-2 px-5 py-3 border-b border-[#f0f0f0] bg-[#fafbfc] flex-wrap">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><IconSearch /></span>
                  <input value={userFilter.nickname} onChange={e => setUserFilter(p => ({ ...p, nickname: e.target.value }))} placeholder={t('昵称...')}
                    className="w-32 h-9 pl-9 pr-3 bg-white border border-[#e0e0e0] rounded-lg text-sm outline-none focus:border-blue-400" />
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><IconMail /></span>
                  <input value={userFilter.email} onChange={e => setUserFilter(p => ({ ...p, email: e.target.value }))} placeholder={t('邮箱...')}
                    className="w-44 h-9 pl-9 pr-3 bg-white border border-[#e0e0e0] rounded-lg text-sm outline-none focus:border-blue-400" />
                </div>
                <select value={userFilter.status} onChange={e => setUserFilter(p => ({ ...p, status: e.target.value }))}
                  className="h-9 px-3 bg-white border border-[#e0e0e0] rounded-lg text-sm outline-none focus:border-blue-400">
                  <option value="">{t('全部状态')}</option>
                  <option value="active">{t('正常')}</option>
                  <option value="disabled">{t('已禁用')}</option>
                </select>
                <button onClick={() => loadUsers()} className="h-9 px-4 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-all">{t('查询')}</button>
                <button onClick={() => { setUserFilter({ nickname: '', email: '', status: '' }); setTimeout(loadUsers, 50) }} className="h-9 px-4 border border-[#e0e0e0] text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-all">{t('重置')}</button>
              </div>
              {/* Table */}
              <div className="overflow-x-auto overscroll-x-contain">
                <table className="admin-table w-full min-w-[1400px] text-sm">
                  <thead>
                    <tr className="bg-[#f8f9fb] text-[#666] text-xs uppercase tracking-wider">
                      <th className="text-left py-3 px-5 font-semibold">{t('用户')}</th>
                      <th className="text-left py-3 px-5 font-semibold">{t('邮箱')}</th>
                      <th className="text-left py-3 px-5 font-semibold">{t('注册时间')}</th>
                      <th className="text-left py-3 px-5 font-semibold">{t('首次活跃')}</th>
                      <th className="text-center py-3 px-5 font-semibold">{t('插件')}</th>
                      <th className="text-center py-3 px-5 font-semibold">{t('首页链接')}</th>
                      <th className="text-center py-3 px-5 font-semibold">{t('首页分类')}</th>
                      <th className="text-center py-3 px-5 font-semibold">{t('关注数')}</th>
                      <th className="text-center py-3 px-5 font-semibold">{t('收藏数')}</th>
                      <th className="text-center py-3 px-5 font-semibold">{t('仓库数')}</th>
                      <th className="text-left py-3 px-5 font-semibold">{t('状态')}</th>
                      <th className="text-left py-3 px-5 font-semibold">{t('操作')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userList.length === 0 ? (
                      <tr><td colSpan={12} className="text-center py-10 text-gray-400">{t('暂无数据')}</td></tr>
                    ) : userList.map((u: any) => (
                      <tr key={u.id} className="border-t border-[#f0f0f0] hover:bg-[#fafbfc]">
                        <td className="py-3 px-5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0">{u.nickname?.charAt(0)?.toUpperCase() || '?'}</div>
                            <span className="font-medium text-gray-800">{u.nickname}</span>
                          </div>
                        </td>
                        <td className="py-3 px-5 text-gray-400 text-xs">{u.email}</td>
                        <td className="py-3 px-5 text-gray-500 text-xs">{u.created_at ? new Date(u.created_at).toLocaleDateString('zh-CN') : '-'}</td>
                        <td className="py-3 px-5 text-gray-500 text-xs">
                          {u.first_active_at ? new Date(u.first_active_at).toLocaleString('zh-CN') : '-'}
                          {u.first_active_at && u.first_active_at === u.created_at && (
                            <span className="ml-1 text-gray-400" title={t('历史用户按注册时间回填，后续按真实首次操作记录')}>*</span>
                          )}
                        </td>
                        <td className="py-3 px-5 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${u.extension_install_count ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                            {u.extension_install_count ? t('已使用') : t('未使用')}
                          </span>
                        </td>
                        <td className="py-3 px-5 text-center text-gray-500 font-medium">{u.home_link_count || 0}</td>
                        <td className="py-3 px-5 text-center text-gray-500 font-medium">{u.home_category_count || 0}</td>
                        <td className="py-3 px-5 text-center text-gray-500 font-medium">{u.followed_repos_count || 0}</td>
                        <td className="py-3 px-5 text-center text-gray-500 font-medium">{u.bookmark_count || 0}</td>
                        <td className="py-3 px-5 text-center text-gray-500 font-medium">{u.repo_count || 0}</td>
                        <td className="py-3 px-5">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${u.status === 'disabled' ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-600'}`}>
                            {u.status === 'disabled' ? t('已禁用') : t('正常')}
                          </span>
                        </td>
                        <td className="py-3 px-5">
                          <div className="flex gap-1.5">
                            {u.status === 'disabled' ? (
                              <button onClick={() => toggleUserStatus(u)} className="flex items-center gap-1 px-2.5 py-1.5 bg-[#ecfdf5] text-[#059669] rounded text-xs hover:bg-[#d1fae5] transition-all"><IconEnable /> {t('启用')}</button>
                            ) : (
                              <button onClick={() => toggleUserStatus(u)} className="flex items-center gap-1 px-2.5 py-1.5 bg-[#fff7ed] text-[#d97a00] rounded text-xs hover:bg-[#ffedd5] transition-all"><IconDisable /> {t('禁用')}</button>
                            )}
                            <button onClick={() => handleDeleteUser(u)} className="flex items-center gap-1 px-2.5 py-1.5 bg-[#fef2f2] text-[#e44040] rounded text-xs hover:bg-[#fde8e8] transition-all"><IconDelete /> {t('删除')}</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {usersCursor && (
                <div className="px-5 py-3 border-t border-[#f0f0f0] text-center">
                  <button onClick={() => loadUsers(usersCursor)} disabled={usersLoading} className="h-8 px-4 text-sm text-blue-500 hover:bg-blue-50 rounded-lg transition-all disabled:opacity-50">{usersLoading ? t('加载中…') : t('加载更多')}</button>
                </div>
              )}
              </div>
            </div>
          )}

          {/* ==================== REPOS SECTION ==================== */}
          {section === 'repos' && (
            <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f0f0]">
                <h2 className="font-semibold text-gray-800">{t('仓库列表')} <span className="text-gray-400 font-normal text-sm ml-1">({repoList.length})</span></h2>
              </div>
              {/* Filter */}
              <div className="flex items-center gap-2 px-5 py-3 border-b border-[#f0f0f0] bg-[#fafbfc] flex-wrap">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><IconSearch /></span>
                  <input value={repoFilter.search} onChange={e => setRepoFilter(p => ({ ...p, search: e.target.value }))} placeholder={t('仓库名称...')}
                    className="w-36 h-9 pl-9 pr-3 bg-white border border-[#e0e0e0] rounded-lg text-sm outline-none focus:border-blue-400" />
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><IconMail /></span>
                  <input value={repoFilter.ownerEmail} onChange={e => setRepoFilter(p => ({ ...p, ownerEmail: e.target.value }))} placeholder={t('创建人邮箱...')}
                    className="w-44 h-9 pl-9 pr-3 bg-white border border-[#e0e0e0] rounded-lg text-sm outline-none focus:border-blue-400" />
                </div>
                <select value={repoFilter.visibility} onChange={e => setRepoFilter(p => ({ ...p, visibility: e.target.value }))}
                  className="h-9 px-3 bg-white border border-[#e0e0e0] rounded-lg text-sm outline-none focus:border-blue-400">
                  <option value="">{t('全部类型')}</option>
                  <option value="public">{t('公开')}</option>
                  <option value="private">{t('私密')}</option>
                  <option value="password">{t('密码访问')}</option>
                  <option value="hidden">{t('已隐藏')}</option>
                </select>
                <button onClick={() => loadRepos()} className="h-9 px-4 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-all">{t('查询')}</button>
                <button onClick={() => { setRepoFilter({ search: '', visibility: '', ownerEmail: '' }); setTimeout(loadRepos, 50) }} className="h-9 px-4 border border-[#e0e0e0] text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-all">{t('重置')}</button>
              </div>
              {/* Table */}
              <div className="overflow-x-auto overscroll-x-contain">
                <table className="admin-table w-full min-w-[1120px] text-sm">
                  <thead>
                    <tr className="bg-[#f8f9fb] text-[#666] text-xs uppercase tracking-wider">
                      <th className="text-left py-3 px-5 font-semibold">{t('仓库名称')}</th>
                      <th className="text-left py-3 px-5 font-semibold">{t('类型')}</th>
                      <th className="text-left py-3 px-5 font-semibold">{t('创建人')}</th>
                      <th className="text-left py-3 px-5 font-semibold">{t('创建时间')}</th>
                      <th className="text-center py-3 px-5 font-semibold">{t('关注')}</th>
                      <th className="text-center py-3 px-5 font-semibold">{t('收藏')}</th>
                      <th className="text-center py-3 px-5 font-semibold">{t('链接')}</th>
                      <th className="text-left py-3 px-5 font-semibold">{t('操作')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repoList.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-10 text-gray-400">{t('暂无数据')}</td></tr>
                    ) : repoList.map((r: any) => (
                      <tr key={r.id} className="border-t border-[#f0f0f0] hover:bg-[#fafbfc]">
                        <td className="py-3 px-5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 overflow-hidden"
                              style={r.icon_key ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: r.bg_color || '#3B82F6' }}>
                              {r.icon_key ? <img src={r.icon_key} alt="" className="w-full h-full object-contain p-0.5" /> : (r.icon || r.name?.charAt(0) || '?')}
                            </div>
                            <div>
                              <span className="font-medium text-gray-800">{r.name}</span>
                              {r.description && <p className="text-xs text-gray-400 truncate max-w-[180px]">{r.description}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                            r.visibility === 'public' ? 'bg-green-50 text-green-600' :
                            r.visibility === 'password' ? 'bg-amber-50 text-amber-600' :
                            r.visibility === 'hidden' ? 'bg-red-50 text-red-500' :
                            'bg-gray-100 text-gray-500'
                          }`}>
                            {r.visibility === 'public' ? <><IconGlobe /> {t('公开')}</> :
                             r.visibility === 'password' ? <><IconLock /> {t('密码')}</> :
                             r.visibility === 'hidden' ? <><IconEyeOff /> {t('隐藏')}</> :
                             <><IconLock /> {t('私密')}</>}
                            {r.visibility === 'password' && r.password && <span className="ml-1 opacity-60">({r.password})</span>}
                          </span>
                        </td>
                        <td className="py-3 px-5 text-xs text-gray-500">
                          <span className="font-medium text-gray-700">{r.owner_name}</span>
                          <span className="text-gray-400 ml-1">({r.owner_email})</span>
                        </td>
                        <td className="py-3 px-5 text-xs text-gray-400">{r.created_at ? new Date(r.created_at).toLocaleDateString('zh-CN') : '-'}</td>
                        <td className="py-3 px-5 text-center text-gray-500 font-medium">{r.follower_count || 0}</td>
                        <td className="py-3 px-5 text-center text-gray-500 font-medium">{r.bookmark_count || 0}</td>
                        <td className="py-3 px-5 text-center text-gray-500 font-medium">{r.link_count || 0}</td>
                        <td className="py-3 px-5">
                          <div className="flex gap-1.5">
                            <button onClick={() => toggleRepoVisibility(r)}
                              className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-xs transition-all ${
                                r.visibility === 'hidden'
                                  ? 'bg-[#ecfdf5] text-[#059669] hover:bg-[#d1fae5]'
                                  : 'bg-[#fff7ed] text-[#d97a00] hover:bg-[#ffedd5]'
                              }`}>
                              {r.visibility === 'hidden' ? <><IconEye /> {t('显示')}</> : <><IconEyeOff /> {t('隐藏')}</>}
                            </button>
                            <button onClick={() => handleDeleteRepo(r)} className="flex items-center gap-1 px-2.5 py-1.5 bg-[#fef2f2] text-[#e44040] rounded text-xs hover:bg-[#fde8e8] transition-all"><IconDelete /> {t('删除')}</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {reposCursor && (
                <div className="px-5 py-3 border-t border-[#f0f0f0] text-center">
                  <button onClick={() => loadRepos(reposCursor)} disabled={reposLoading} className="h-8 px-4 text-sm text-blue-500 hover:bg-blue-50 rounded-lg transition-all disabled:opacity-50">{reposLoading ? t('加载中…') : t('加载更多')}</button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Confirm Dialog */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20" onClick={() => setConfirm(null)} />
          <div className="relative bg-white rounded-xl shadow-xl border border-gray-200 p-6 w-full max-w-sm mx-4">
            <p className="text-sm text-gray-700 mb-6 leading-relaxed">{confirm.message}</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirm(null)} className="flex-1 h-10 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 transition-all">{t('取消')}</button>
              <button onClick={() => { confirm.onConfirm(); setConfirm(null) }} className="flex-1 h-10 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-all">{t('确认')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Category Modal */}
      {(showAddCat || editCat) && !showAddCat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20" onClick={() => { setShowAddCat(false); setEditCat(null); setCatName('') }} />
          <div className="relative bg-white rounded-xl shadow-xl border border-gray-200 p-6 w-full max-w-sm mx-4">
            <h3 className="font-semibold text-gray-800 mb-4">{editCat ? t('编辑分类') : t('添加分类')}</h3>
            <input value={catName} onChange={e => setCatName(e.target.value)} placeholder={t('分类名称')} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') editCat ? handleUpdateCategory() : handleAddCategory() }}
              className="w-full h-11 px-4 mb-4 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
            <div className="flex gap-2">
              <button onClick={() => { setShowAddCat(false); setEditCat(null); setCatName('') }} className="flex-1 h-10 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">{t('取消')}</button>
              <button onClick={editCat ? handleUpdateCategory : handleAddCategory} className="flex-1 h-10 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600">{t('确定')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Tool Modal */}
      {showAddTool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20" onClick={() => setShowAddTool(false)} />
          <div className="relative bg-white rounded-xl shadow-xl border border-gray-200 p-6 w-full max-w-sm mx-4 max-h-[85vh] overflow-y-auto">
            <h3 className="font-semibold text-gray-800 mb-4">{t('添加链接')}</h3>
            <div className="space-y-3">
              <div className="flex flex-col items-center gap-2 pb-2">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-bold shadow-sm overflow-hidden"
                  style={toolIcon && isImageIcon(toolIcon) ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: toolPalette[toolColor]?.bg || '#3B82F6', color: toolPalette[toolColor]?.text || '#FFFFFF' }}>
                  {faviconLoading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : toolIcon && isImageIcon(toolIcon) ? (
                    <img src={toolIcon} className="w-full h-full object-contain p-2" />
                  ) : (
                    <span className="text-lg font-bold">{toolName.charAt(0).toUpperCase() || '?'}</span>
                  )}
                </div>
                <div className="flex gap-1 flex-wrap justify-center">
                  {toolPalette.map((p, i) => (
                    <button key={i} type="button" onClick={() => setToolColor(i)}
                      className="w-5 h-5 rounded-full border border-gray-200 shadow-sm transition-transform hover:scale-110"
                      style={{ backgroundColor: p.bg, transform: i === toolColor ? 'scale(1.3)' : undefined }} />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input ref={addToolFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
                    const file = e.target.files?.[0]; if (!file) return
                    const reader = new FileReader(); reader.onload = () => setToolIcon(reader.result as string); reader.readAsDataURL(file)
                  }} />
                  <button type="button" onClick={() => addToolFileRef.current?.click()} className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs hover:bg-blue-600">{t('上传图标')}</button>
                  {toolIcon && isImageIcon(toolIcon) && <button type="button" onClick={() => setToolIcon('')} className="text-xs text-red-400 hover:text-red-600">{t('清除')}</button>}
                </div>
              </div>
              <input value={toolName} onChange={e => setToolName(e.target.value)} placeholder={t('名称')} autoFocus
                className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
              <input value={toolUrl} onChange={e => {
                setToolUrl(e.target.value); const u = e.target.value
                if (!u) return; setFaviconLoading(true)
                faviconCache.resolve(u).then(r => { if (r.icon_url) setToolIcon(r.icon_url.startsWith('http') ? r.icon_url : window.location.origin + r.icon_url) }).finally(() => setFaviconLoading(false))
              }} placeholder={t('地址 (https://...)')}
                className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
              <input value={toolDesc} onChange={e => setToolDesc(e.target.value)} placeholder={t('描述（选填）')}
                className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
              <select value={toolCatId} onChange={e => setToolCatId(e.target.value)}
                className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400">
                <option value="">{t('选择分类')}</option>
                {catList.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowAddTool(false)} className="flex-1 h-10 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">{t('取消')}</button>
              <button onClick={handleAddTool} className="flex-1 h-10 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600">{t('添加')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Tool Modal */}
      {editTool && !showAddTool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20" onClick={() => { setEditTool(null); setToolName(''); setToolUrl(''); setToolDesc(''); setToolIcon(''); setToolCatId('') }} />
          <div className="relative bg-white rounded-xl shadow-xl border border-gray-200 p-6 w-full max-w-sm mx-4 max-h-[85vh] overflow-y-auto">
            <h3 className="font-semibold text-gray-800 mb-4">{t('编辑链接')}</h3>
            <div className="space-y-3">
              <div className="flex flex-col items-center gap-2 pb-2">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-bold shadow-sm overflow-hidden"
                  style={toolIcon && isImageIcon(toolIcon) ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: editTool.bg_color || '#3B82F6', color: editTool.text_color || '#FFFFFF' }}>
                  {faviconLoading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : toolIcon && isImageIcon(toolIcon) ? (
                    <img src={toolIcon} className="w-full h-full object-contain p-2" />
                  ) : (
                    <span className="text-lg font-bold">{(toolName || editTool.name || '?').charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input ref={editToolFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
                    const file = e.target.files?.[0]; if (!file) return
                    const reader = new FileReader(); reader.onload = () => { setEditTool((prev: any) => ({ ...prev, icon: reader.result as string })); setToolIcon(reader.result as string) }; reader.readAsDataURL(file)
                  }} />
                  <button type="button" onClick={() => editToolFileRef.current?.click()} className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs hover:bg-blue-600">{t('上传图标')}</button>
                  {toolIcon && isImageIcon(toolIcon) && <button type="button" onClick={() => setToolIcon('')} className="text-xs text-red-400 hover:text-red-600">{t('清除')}</button>}
                </div>
              </div>
              <input value={toolName} onChange={e => setToolName(e.target.value)} placeholder={t('名称')} autoFocus
                className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
              <input value={toolUrl} onChange={e => {
                setToolUrl(e.target.value); const u = e.target.value
                if (!u) return; setFaviconLoading(true)
                faviconCache.resolve(u).then(r => { if (r.icon_url) setToolIcon(r.icon_url.startsWith('http') ? r.icon_url : window.location.origin + r.icon_url) }).finally(() => setFaviconLoading(false))
              }} placeholder={t('地址')}
                className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
              <input value={toolDesc} onChange={e => setToolDesc(e.target.value)} placeholder={t('描述')}
                className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
              <select value={toolCatId} onChange={e => setToolCatId(e.target.value)}
                className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400">
                <option value="">{t('选择分类')}</option>
                {catList.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setEditTool(null); setToolName(''); setToolUrl(''); setToolDesc(''); setToolIcon(''); setToolCatId('') }} className="flex-1 h-10 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">{t('取消')}</button>
              <button onClick={handleUpdateTool} className="flex-1 h-10 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600">{t('保存')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
