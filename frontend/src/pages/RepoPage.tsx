import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { repos, links, follows, bookmarks, categories as homeCats, tools, faviconCache, pdfLinks, openLinkUrl } from '../api'
import { Plus, ExternalLink, Star, Heart, Edit3, Trash2, Tag, Lock as LockIcon, Settings, UserPlus, Users, Save, Camera, X, Home, MoreVertical, Loader2, AlertTriangle, Link2Off, RefreshCw, FileText } from 'lucide-react'
import { showToast } from '../components/Toast'
import Toast from '../components/Toast'
import AuthModal from '../components/AuthModal'
import DeadLinksModal from '../components/DeadLinksModal'
import LinkPreviewHost, { scheduleLinkPreview, cancelLinkPreview } from '../components/LinkPreview'
import LinkDescriptionInput from '../components/LinkDescriptionInput'
import CategoryMultiSelect from '../components/CategoryMultiSelect'
import ModalTitle from '../components/ModalTitle'
import { RepoPageSkeleton } from '../components/Skeleton'
import { useT } from '../i18n'
import { useAutoLinkDescription } from '../hooks/useAutoLinkDescription'

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

const linkPalette = [
  { bg: '#3B82F6', text: '#FFFFFF' }, { bg: '#EF4444', text: '#FFFFFF' },
  { bg: '#10B981', text: '#FFFFFF' }, { bg: '#F59E0B', text: '#FFFFFF' },
  { bg: '#8B5CF6', text: '#FFFFFF' }, { bg: '#EC4899', text: '#FFFFFF' },
  { bg: '#06B6D4', text: '#FFFFFF' }, { bg: '#F97316', text: '#FFFFFF' },
  { bg: '#6366F1', text: '#FFFFFF' }, { bg: '#14B8A6', text: '#FFFFFF' },
  { bg: '#84CC16', text: '#FFFFFF' }, { bg: '#D946EF', text: '#FFFFFF' },
  { bg: '#0EA5E9', text: '#FFFFFF' }, { bg: '#E11D48', text: '#FFFFFF' },
  { bg: '#7C3AED', text: '#FFFFFF' }, { bg: '#059669', text: '#FFFFFF' },
]

export default function RepoPage() {
  const t = useT()
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [repo, setRepo] = useState<any>(null)
  const [linkList, setLinkList] = useState<any[]>([])
  const [password, setPassword] = useState('')
  const [needPassword, setNeedPassword] = useState(false)
  const [loading, setLoading] = useState(true)

  // Add link — same fields as home page
  const [showAddLink, setShowAddLink] = useState(false)
  const [linkName, setLinkName] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const {
    description: linkDesc,
    setDescription: setLinkDesc,
    loading: linkDescLoading,
    fetchDescription: fetchLinkDesc,
    scheduleFetch: scheduleLinkDesc,
    reset: resetLinkDesc,
  } = useAutoLinkDescription()
  const [linkCategory, setLinkCategory] = useState<string[]>([])
  const [linkIcon, setLinkIcon] = useState('')
  const [linkTextIcon, setLinkTextIcon] = useState('')
  const [linkColor, setLinkColor] = useState(Math.floor(Math.random() * 16))
  const linkFileRef = useRef<HTMLInputElement>(null)
  const linkPdfRef = useRef<HTMLInputElement>(null)

  // 仓库内重复链接检测（与首页添加行为一致：仅提示不阻止）
  const [addLinkDups, setAddLinkDups] = useState<any[]>([])
  const [addLinkDupType, setAddLinkDupType] = useState<'exact' | 'domain'>('exact')
  const [editLinkDups, setEditLinkDups] = useState<any[]>([])
  const [editLinkDupType, setEditLinkDupType] = useState<'exact' | 'domain'>('exact')
  const addLinkDupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editLinkDupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; link: any } | null>(null)
  const [editLink, setEditLink] = useState<any>(null)
  const editLinkFileRef = useRef<HTMLInputElement>(null)

  // Add to home
  const [showAddToHome, setShowAddToHome] = useState(false)
  const [addToHomeLink, setAddToHomeLink] = useState<any>(null)
  const [homeCategories, setHomeCategories] = useState<any[]>([])

  // Follow modal
  const [showFollowModal, setShowFollowModal] = useState(false)
  const [followCatId, setFollowCatId] = useState('')
  const [followResync, setFollowResync] = useState(false)
  const [dismissBanner, setDismissBanner] = useState(false)
  // 与首页重复的链接（关注/同步时可勾选排除）
  const [duplicateLinks, setDuplicateLinks] = useState<any[]>([])
  const [skipLinkIds, setSkipLinkIds] = useState<Set<string>>(new Set())
  const [duplicatesLoading, setDuplicatesLoading] = useState(false)

  // Confirm dialog
  const [confirmAction, setConfirmAction] = useState<{ message: string; onConfirm: () => void } | null>(null)

  // 链接失效检测（仓库创建者打开时触发，后端 24h 内查过的自动跳过）
  const [deadLinks, setDeadLinks] = useState<any[]>([])
  const [showDeadLinks, setShowDeadLinks] = useState(false)
  const [removingDead, setRemovingDead] = useState(false)

  // Categories
  const [newCategory, setNewCategory] = useState('')
  const [categoryAdding, setCategoryAdding] = useState(false)
  const [editingCatName, setEditingCatName] = useState<string | null>(null)
  const [editCatNewName, setEditCatNewName] = useState('')

  // Favicon loading + adding state
  const [faviconLoading, setFaviconLoading] = useState(false)
  const [linkIconSrc, setLinkIconSrc] = useState<'auto' | 'upload' | 'text'>('auto')
  const [linkAdding, setLinkAdding] = useState(false)
  const [linkPdf, setLinkPdf] = useState<File | null>(null)
  const [linkType, setLinkType] = useState<'url' | 'pdf'>('url')
  const [linkPdfUploading, setLinkPdfUploading] = useState(false)
  const [linkPdfError, setLinkPdfError] = useState('')
  const [following, setFollowing] = useState(false)

  // Auth modal
  const [showAuth, setShowAuth] = useState(false)

  // Members
  const [showMemberAdd, setShowMemberAdd] = useState(false)
  const [memberInput, setMemberInput] = useState('')
  const [memberByEmail, setMemberByEmail] = useState(false)

  // Edit repo
  const [showEditRepo, setShowEditRepo] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editVisibility, setEditVisibility] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editBg, setEditBg] = useState('#3B82F6')
  const [editIconKey, setEditIconKey] = useState('')

  // Upload icon
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [iconUploading, setIconUploading] = useState(false)

  // Real-time GitHub stars
  const [githubStars, setGithubStars] = useState<Record<string, number>>({})

  /** Parse GitHub URL and fetch star count directly from GitHub API */
  const githubStarCache = useRef<Map<string, number>>(new Map())

  const fetchGithubStars = async (links: any[]) => {
    const updates: Record<string, number> = {}
    const pending: Promise<void>[] = []
    for (const link of links) {
      const match = link.url?.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/)
      if (!match) continue
      const fullName = `${match[1]}/${match[2]}`
      // Check in-memory cache
      if (githubStarCache.current.has(fullName)) {
        updates[link.id] = githubStarCache.current.get(fullName)!
        continue
      }
      pending.push(
        fetch(`https://api.github.com/repos/${fullName}`, {
          headers: { 'Accept': 'application/vnd.github.v3+json' }
        })
          .then(r => r.ok ? r.json() : null)
          .then((data: any) => {
            if (data?.stargazers_count !== undefined) {
              githubStarCache.current.set(fullName, data.stargazers_count)
              updates[link.id] = data.stargazers_count
            }
          })
          .catch(() => { /* silently ignore */ })
      )
    }
    if (pending.length > 0) {
      await Promise.allSettled(pending)
      setGithubStars(prev => ({ ...prev, ...updates }))
    } else if (Object.keys(updates).length > 0) {
      setGithubStars(prev => ({ ...prev, ...updates }))
    }
  }

  const loadRepo = async (pw?: string) => {
    if (!id) return
    setLoading(true)
    try {
      const r = await repos.get(id, pw)
      setRepo(r)
      setNeedPassword(false)
      const l = await repos.links.list(id)
      setLinkList(l)
      fetchGithubStars(l) // Fetch real-time GitHub stars
    } catch (err: any) {
      if (err.message.includes('need_password') || err.message.includes('401')) setNeedPassword(true)
    } finally { setLoading(false) }
  }

  useEffect(() => { loadRepo() }, [id])

  const handlePasswordSubmit = () => loadRepo(password)

  const linkCategories: string[] = repo?.categories || []
  const canManage = repo?.can_manage || false
  const isOwner = user?.id === repo?.user_id

  // 仓库创建者打开时触发失效检测（后台静默，发现失效才弹窗）
  useEffect(() => {
    if (!user || !repo || repo.user_id !== user.id) return
    links.checkDead(repo.id).then((res: any) => {
      if (res?.dead?.length) {
        // 每天最多自动弹 1 次（与首页共用同一标记）
        const today = new Date().toDateString()
        if (localStorage.getItem('dead_links_alerted') !== today) {
          localStorage.setItem('dead_links_alerted', today)
          setDeadLinks(res.dead)
          setShowDeadLinks(true)
        }
      }
    }).catch(() => {})
  }, [user?.id, repo?.id, repo?.user_id])

  // 一键移除勾选的失效仓库链接
  const removeDeadLinks = async (ids: string[]) => {
    setRemovingDead(true)
    try {
      await Promise.all(ids.map(lid => links.delete(lid)))
      setLinkList(await repos.links.list(id!))
      setShowDeadLinks(false)
      setDeadLinks([])
      showToast(t('已移除 {n} 个失效链接', { n: ids.length }), 'success')
    } catch {
      showToast(t('移除失败，请重试'), 'error')
    } finally { setRemovingDead(false) }
  }

  const groupedLinks = () => {
    const groups: Record<string, any[]> = { '': [] }
    linkCategories.forEach((c: string) => { groups[c] = [] })
    linkList.forEach(l => {
      const cat = l.category_id || ''
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(l)
    })
    return groups
  }

  const handleLinkIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setLinkIcon(reader.result as string)
    reader.readAsDataURL(file)
  }

  // 切换图标来源：清空当前图标，auto 模式下按网址重新抓取
  const switchLinkIconSrc = (m: 'auto' | 'upload' | 'text') => {
    setLinkIconSrc(m)
    setLinkIcon('')
    if (linkFileRef.current) linkFileRef.current.value = ''
    if (m === 'auto') {
      const u = linkUrl.trim()
      if (!u) return
      const fixed = /^https?:\/\//i.test(u) ? u : 'https://' + u
      setFaviconLoading(true)
      faviconCache.resolve(fixed).then((r) => {
        if (r.icon_url) setLinkIcon(r.icon_url.startsWith('http') ? r.icon_url : (window.location.origin + r.icon_url))
      }).finally(() => setFaviconLoading(false))
    }
  }

  // 关闭添加链接弹窗：未完成添加不保留，清空全部输入状态
  const closeAddLink = () => {
    setShowAddLink(false)
    setLinkName(''); setLinkUrl(''); setLinkCategory([])
    setLinkType('url')
    resetLinkDesc()
    setLinkIcon(''); setLinkTextIcon(''); setLinkIconSrc('auto')
    setAddLinkDups([]); setAddLinkDupType('exact')
    setLinkColor(Math.floor(Math.random() * linkPalette.length))
    setFaviconLoading(false)
    setLinkPdf(null); setLinkPdfUploading(false)
    setLinkPdfError('')
    if (addLinkDupTimer.current) clearTimeout(addLinkDupTimer.current)
    if (linkFileRef.current) linkFileRef.current.value = ''
    if (linkPdfRef.current) linkPdfRef.current.value = ''
  }

  const addLink = async () => {
    if (!id || !linkName || !linkUrl || linkAdding) return
    setLinkAdding(true)
    try {
      // 图标获取失败时兜底：截取名称前 4 个字符作为文字图标
      const icon = isImageIcon(linkIcon) ? linkIcon : (linkTextIcon || linkName.slice(0, 4))
      const pdfMatch = /\/api\/pdfs\/([0-9a-f-]{36})/.exec(linkUrl || '')
      if (pdfMatch) await pdfLinks.claim(pdfMatch[1]).catch(() => {})
      await repos.links.create(id, { name: linkName, url: linkUrl, icon, category_ids: linkCategory, desc: linkDesc })
      setLinkList(await repos.links.list(id))
      closeAddLink()
      showToast(t('链接添加成功'))
    } catch { showToast(t('添加失败'), 'error') }
    finally { setLinkAdding(false) }
  }

  const handleLinkPdfSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLinkPdfError('')
    if (file.type !== 'application/pdf') { setLinkPdfError(t('仅支持 PDF 文件')); return }
    setLinkPdfUploading(true)
    try {
      const uploaded = await pdfLinks.upload(file)
      setLinkPdf(file)
      setLinkName(linkName || uploaded.filename.replace(/\.pdf$/i, ''))
      setLinkUrl(`/api/pdfs/${uploaded.id}`)
    } catch (err: any) {
      setLinkPdfError(err.message || t('上传失败'))
    } finally {
      setLinkPdfUploading(false)
      if (linkPdfRef.current) linkPdfRef.current.value = ''
    }
  }

  const deleteLink = async (linkId: string) => {
    await links.delete(linkId)
    setLinkList(await repos.links.list(id!))
    setContextMenu(null); loadRepo()
  }

  const handleEditLinkIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setEditLink((prev: any) => ({ ...prev, icon: reader.result as string }))
    reader.readAsDataURL(file)
  }

  const updateLink = async () => {
    if (!editLink) return
    await links.update(editLink.id, { ...editLink, category_ids: editLink.category_ids || [editLink.category_id].filter(Boolean) })
    setLinkList(await repos.links.list(id!))
    setEditLink(null); setEditLinkDups([])
  }

  const addLinkToHome = async (catId: string) => {
    if (!addToHomeLink) return
    const colors = linkPalette[0]
    await tools.create({
      name: addToHomeLink.name, url: addToHomeLink.url,
      icon: isImageIcon(addToHomeLink.icon) ? addToHomeLink.icon : (addToHomeLink.icon || addToHomeLink.name.charAt(0).toUpperCase()),
      category_id: catId || undefined,
      bg_color: colors.bg, text_color: colors.text,
    })
    setShowAddToHome(false); setAddToHomeLink(null)
  }

  const addCategory = async () => {
    if (!id || !newCategory.trim() || categoryAdding) return
    setCategoryAdding(true)
    try {
      await repos.categories.add(id, newCategory.trim())
      const r = await repos.get(id)
      setRepo(r); setNewCategory(''); showToast(t('分类添加成功'))
    } catch { showToast(t('分类添加失败'), 'error') }
    finally { setCategoryAdding(false) }
  }

  const renameCategory = async () => {
    if (!id || editingCatName === null || !editCatNewName.trim()) return
    try {
      await repos.categories.rename(id, editingCatName, editCatNewName.trim())
      const r = await repos.get(id)
      setRepo(r)
      setLinkList(await repos.links.list(id))
      setEditingCatName(null); showToast(t('分类重命名成功'))
    } catch { showToast(t('分类重命名失败'), 'error') }
  }

  const removeCategory = async (cat: string) => {
    if (!id) return
    try {
      await repos.categories.remove(id, cat)
      const r = await repos.get(id)
      setRepo(r); showToast(t('分类已删除'))
    } catch { showToast(t('删除失败'), 'error') }
  }

  const addMember = async () => {
    if (!id || !memberInput.trim()) return
    try {
      const data = memberByEmail ? { email: memberInput } : { nickname: memberInput }
      await repos.members.add(id, data)
      const r = await repos.get(id)
      setRepo(r); setMemberInput(''); setShowMemberAdd(false)
    } catch (err: any) {
      alert(err.message)
    }
  }

  const removeMember = async (userId: string) => {
    if (!id) return
    await repos.members.remove(id, userId)
    const r = await repos.get(id)
    setRepo(r)
  }

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !id) return
    setIconUploading(true)
    try {
      await repos.uploadIcon(id, file)
      const r = await repos.get(id)
      setRepo(r)
      setEditIconKey(r.icon_key || '')
    } catch (err: any) {
      alert(err.message)
    } finally { setIconUploading(false) }
  }

  const saveEditRepo = async () => {
    if (!id) return
    await repos.update(id, { name: editName, description: editDesc, visibility: editVisibility, password: editPassword, bg_color: editBg })
    const r = await repos.get(id)
    setRepo(r); setShowEditRepo(false)
  }

  const toggleFollow = async () => {
    if (!id) return
    if (!repo.is_following) return
    try {
      await follows.repo.unfollow(id)
      setRepo({ ...repo, is_following: false, follower_count: repo.follower_count - 1 })
    } catch { showToast(t('取消失败，请重试'), 'error') }
  }

  const openFollowModal = (resync: boolean) => {
    setFollowResync(resync)
    setFollowCatId(resync ? (repo.follow_target_category_id || '') : '')
    homeCats.list().then(setHomeCategories).catch(() => {})
    setShowFollowModal(true)
    // 扫描首页与本仓库重复的链接
    if (user && id) {
      setDuplicatesLoading(true)
      follows.repo.duplicates(id)
        .then((r: any) => {
          const dups = r?.duplicates || []
          setDuplicateLinks(dups)
          setSkipLinkIds(new Set(dups.map((d: any) => d.link_id)))
        })
        .catch(() => { setDuplicateLinks([]); setSkipLinkIds(new Set()) })
        .finally(() => setDuplicatesLoading(false))
    }
  }

  const followWithCategory = async () => {
    if (!id) return
    setFollowing(true)
    try {
      const wasFollowing = repo.is_following
      await follows.repo.follow(id, followCatId || undefined, skipLinkIds.size > 0 ? Array.from(skipLinkIds) : undefined)
      setRepo({ ...repo, is_following: true, follower_count: wasFollowing ? repo.follower_count : repo.follower_count + 1 })
      setShowFollowModal(false)
      showToast(wasFollowing ? t('已重新同步，首页链接已按仓库当前状态刷新') : t('关注成功，链接已同步到首页'))
    } catch { showToast(t('操作失败，请重试'), 'error') }
    finally { setFollowing(false) }
  }

  const toggleBookmark = async () => {
    if (!id) return
    try {
      if (repo.is_bookmarked) {
        await bookmarks.repo.remove(id)
        setRepo({ ...repo, is_bookmarked: false, bookmark_count: repo.bookmark_count - 1 })
      } else {
        await bookmarks.repo.add(id)
        setRepo({ ...repo, is_bookmarked: true, bookmark_count: repo.bookmark_count + 1 })
      }
    } catch { showToast(t('操作失败，请重试'), 'error') }
  }

  if (loading) return <RepoPageSkeleton />

  if (needPassword) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-blue-50 flex items-center justify-center">
        <div className="bg-white/30 backdrop-blur-xl rounded-3xl border border-white/60 p-8 w-full max-w-sm mx-4">
          <div className="text-center mb-6"><LockIcon className="w-12 h-12 text-blue-400 mx-auto mb-3" /><h2 className="text-xl font-bold text-gray-800">{t('需要密码')}</h2><p className="text-sm text-gray-500 mt-1">{t('此仓库需要密码才能访问')}</p></div>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={t('输入访问密码')} className="w-full h-12 px-4 mb-4 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
          <button onClick={handlePasswordSubmit} className="w-full h-12 bg-blue-500 text-white rounded-2xl hover:bg-blue-600 transition-all font-medium">{t('确认')}</button>
        </div>
      </div>
    )
  }

  if (!repo) return <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-blue-50 flex items-center justify-center text-gray-500">{t('仓库不存在')}</div>

  const groups = groupedLinks()

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50/80 via-white to-blue-50/80">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Back button */}
        <button onClick={() => navigate('/')}
          className="flex items-center gap-2 text-gray-400 hover:text-blue-500 mb-6 transition-colors text-sm group">
          <Home className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" />
          {t('首页')}
        </button>

        {/* Repo Header - Card */}
        <div className="bg-white/60 backdrop-blur-xl rounded-3xl border border-white/70 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.08)] p-6 sm:p-8 mb-8">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
            <div className="flex items-start gap-4 sm:gap-5 min-w-0">
              {/* Icon */}
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center text-3xl sm:text-4xl font-bold flex-shrink-0 overflow-hidden ring-2 ring-gray-200/60"
                style={repo.icon_key ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: repo.bg_color || '#3B82F6', color: repo.text_color || '#FFFFFF' }}>
                {repo.icon_key ? (
                  <img src={repo.icon_key} className="w-full h-full object-contain p-2" />
                ) : (
                  repo.icon || repo.name?.charAt(0) || '?'
                )}
              </div>
              {/* Info */}
              <div className="min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">{repo.name}</h1>
                {repo.description && (
                  <p className="text-sm text-gray-500 mt-1.5 line-clamp-2">{repo.description}</p>
                )}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-gray-400">
                  {/* Creator + Members stacked avatars */}
                  <div className="flex items-center">
                    <div className="flex -space-x-2">
                      {[
                        { id: repo.user_id, nickname: repo.owner_name, avatar_url: repo.owner_avatar },
                        ...(repo.members || []).slice(0, 4)
                      ].map((p: any) => (
                        <button key={p.id} onClick={() => navigate(`/user/${p.id}`)}
                          className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-[9px] text-white font-bold ring-2 ring-gray-200/60 overflow-hidden hover:ring-blue-300 transition-all hover:z-10 relative"
                          title={p.nickname}>
                          {p.avatar_url ? (
                            <img src={p.avatar_url} className="w-full h-full object-cover" />
                          ) : (
                            p.nickname?.charAt(0)?.toUpperCase() || '?'
                          )}
                        </button>
                      ))}
                    </div>
                    {(repo.members?.length || 0) > 4 && (
                      <span className="ml-1.5 text-xs text-gray-400">+{repo.members.length - 4}</span>
                    )}
                    <span className="ml-2 text-xs text-gray-400">
                      {repo.owner_name}{repo.members?.length > 0 && t(' 等 {n} 人', { n: 1 + repo.members.length })}
                    </span>
                  </div>
                  <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" /> {repo.follower_count || 0}</span>
                  <span className="flex items-center gap-1"><Star className="w-3.5 h-3.5" /> {repo.bookmark_count || 0}</span>
                  <span className="flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> {t('{n} 个链接', { n: linkList.length })}</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {canManage && (
                <button onClick={() => { setShowEditRepo(true); setEditName(repo.name); setEditDesc(repo.description || ''); setEditVisibility(repo.visibility); setEditPassword(repo.password || ''); setEditBg(repo.bg_color || '#3B82F6'); setEditIconKey(repo.icon_key || '') }}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/70 border border-white/80 text-gray-500 hover:text-gray-700 hover:bg-white/90 transition-all text-sm shadow-sm">
                  <Settings className="w-4 h-4" /> {t('编辑')}
                </button>
              )}
              <div className="flex items-center gap-2 flex-shrink-0">
                  {user ? (repo.is_following ? (
                    <button onClick={() => openFollowModal(true)}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all shadow-sm bg-white/70 border border-white/80 text-gray-500 hover:bg-white/90">
                      <Heart className="w-4 h-4 fill-red-400 text-red-400" /> {t('已关注')}
                    </button>
                  ) : (
                    <button onClick={() => openFollowModal(false)}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all shadow-sm bg-blue-500 text-white hover:bg-blue-600">
                      <Heart className="w-4 h-4" /> {t('关注')}
                    </button>
                  )) : (
                    <button onClick={() => setShowAuth(true)}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all shadow-sm bg-blue-500 text-white hover:bg-blue-600">
                      <Heart className="w-4 h-4" /> {t('关注')}
                    </button>
                  )}
                  {user ? (
                  <button onClick={toggleBookmark}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all shadow-sm ${
                      repo.is_bookmarked
                        ? 'bg-amber-50 border border-amber-200 text-amber-500'
                        : 'bg-white/70 border border-white/80 text-gray-500 hover:bg-white/90'
                    }`}>
                    <Star className={`w-4 h-4 ${repo.is_bookmarked ? 'fill-amber-400' : ''}`} />
                    {repo.is_bookmarked ? t('已收藏') : t('收藏')}
                  </button>
                  ) : (
                    <button onClick={() => setShowAuth(true)}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all shadow-sm bg-white/70 border border-white/80 text-gray-500 hover:bg-white/90">
                      <Star className="w-4 h-4" /> {t('收藏')}
                    </button>
                  )}
                </div>
            </div>
          </div>

          {/* Categories + Tags row — only for managers */}
          {canManage && (
          <div className="flex flex-wrap items-center gap-2 mt-5 pt-5 border-t border-white/50">
            {linkCategories.map((c: string, ci: number) => (
              <span key={c}
                onClick={() => { if (isOwner) { setEditingCatName(c); setEditCatNewName(c) } }}
                draggable={isOwner}
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', c); (e.currentTarget as HTMLElement).classList.add('opacity-40') }}
                onDragEnd={(e) => { (e.currentTarget as HTMLElement).classList.remove('opacity-40') }}
                onDragOver={(e) => { e.preventDefault() }}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = e.dataTransfer.getData('text/plain')
                  if (!from || from === c || !id) return
                  const list = [...linkCategories]
                  const fromIdx = list.indexOf(from)
                  const toIdx = ci
                  list.splice(fromIdx, 1)
                  list.splice(toIdx, 0, from)
                  setRepo({ ...repo, categories: list })
                  repos.categories.reorder(id, list.map((n, i) => ({ name: n, sort_order: i })))
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/60 text-blue-600 text-xs font-medium border border-blue-100/60 shadow-sm cursor-default hover:bg-white/80 transition-colors">
                <Tag className="w-3 h-3" /> {c}
                {isOwner && (
                  <button onClick={(e) => { e.stopPropagation(); setConfirmAction({ message: t('确定删除分类「{c}」？该分类下的链接将变为未分类', { c }), onConfirm: () => removeCategory(c) }) }}
                    className="hover:bg-red-100 hover:text-red-500 rounded-full p-0.5 -mr-0.5 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            ))}
            {isOwner && (
              <div className="flex items-center">
                <input value={newCategory} onChange={e => setNewCategory(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addCategory() }}
                  placeholder={t('+ 分类')}
                  className="h-8 w-24 px-3 bg-white/40 border border-dashed border-gray-300 rounded-full text-xs focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-solid focus:border-blue-300 placeholder-gray-400" />
              </div>
            )}
          </div>)}

          {/* Members list */}
          {canManage && (
            <div className="flex flex-wrap items-center gap-2 mt-3 text-sm">
              <Users className="w-4 h-4 text-gray-300" />
              {repo.members?.map((m: any) => (
                <div key={m.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/40 text-gray-500 text-xs border border-white/50">
                  <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-[7px] text-white font-bold overflow-hidden">
                    {m.avatar_url ? (
                      <img src={m.avatar_url} className="w-full h-full object-cover" />
                    ) : (
                      m.nickname?.charAt(0)?.toUpperCase() || '?'
                    )}
                  </div>
                  {m.nickname}
                  {isOwner && (
                    <button onClick={() => removeMember(m.id)}
                      className="text-gray-300 hover:text-red-500 ml-0.5 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
              <button onClick={() => setShowMemberAdd(true)}
                className="flex items-center gap-1 px-3 py-1 rounded-full bg-blue-50/60 text-blue-500 text-xs hover:bg-blue-100/60 transition-all border border-blue-100/40">
                <UserPlus className="w-3 h-3" /> {t('添加成员')}
              </button>
            </div>
          )}
        </div>

        {/* Links content */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-bold text-gray-800 flex items-center gap-2 text-lg">
            <ExternalLink className="w-5 h-5 text-blue-400" /> {t('链接')}
          </h2>
          {canManage && (
            <button onClick={() => { setShowAddLink(true); setAddLinkDups([]); setLinkIconSrc('auto'); if (!linkCategory.length && linkCategories.length > 0) setLinkCategory([linkCategories[0]]) }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-500 text-white hover:bg-blue-600 transition-all text-sm font-medium shadow-sm">
              <Plus className="w-4 h-4" /> {t('添加链接')}
            </button>
          )}
        </div>
        {linkCategories.length === 0 && (!groups[''] || groups[''].length === 0) ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 bg-white/40 backdrop-blur-xl rounded-3xl border border-white/50">
            <ExternalLink className="w-12 h-12 mb-3 text-gray-200" />
            <p className="text-sm">{t('暂无链接，点击上方添加')}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups[''] && groups[''].length > 0 && (
              <LinkSection title={t('未分类')} links={groups['']} canManage={canManage}
                githubStars={githubStars}
                onContextMenu={setContextMenu}
                onReorder={(list) => {
                  if (!id) return
                  const oldIds = new Set(groups['']?.map((l: any) => l.id) || [])
                  const merged = [...linkList.filter(l => !oldIds.has(l.id)), ...list]
                  setLinkList(merged)
                  links.reorder(id, list.map((l: any, i: number) => ({ id: l.id, sort_order: i })))
                }} />
            )}
            {linkCategories.map((cat: string) => {
              const catLinks = groups[cat] || []
              return (
                <LinkSection key={cat} title={cat} links={catLinks} canManage={canManage}
                  githubStars={githubStars}
                  onContextMenu={setContextMenu}
                  onReorder={(list) => {
                    if (!id) return
                    const oldIds = new Set(catLinks.map((l: any) => l.id))
                    const merged = [...linkList.filter(l => !oldIds.has(l.id)), ...list]
                    setLinkList(merged)
                    links.reorder(id, list.map((l: any, i: number) => ({ id: l.id, sort_order: i })))
                  }} />
              )
            })}
          </div>
        )}

      {/* Add Link Modal — same as home page */}
      {showAddLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={closeAddLink} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto [&::-webkit-scrollbar]:hidden">
            <ModalTitle icon={ExternalLink} title={t('添加链接')} />
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('名称')}</label>
                <input value={linkName} onChange={e => setLinkName(e.target.value)} placeholder={t('名称')} className="w-full h-12 px-4 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('链接类型')}</label>
                <select
                  value={linkType}
                  onChange={e => {
                    const next = e.target.value as 'url' | 'pdf'
                    setLinkType(next)
                    if (next === 'url') {
                      setLinkPdf(null)
                      if (linkPdfRef.current) linkPdfRef.current.value = ''
                    } else {
                      setLinkUrl('')
                    }
                  }}
                  className="w-full h-12 px-3 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm"
                >
                  <option value="url">{t('网站')}</option>
                  <option value="pdf">{t('PDF')}</option>
                </select>
              </div>
              {linkType === 'pdf' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('PDF 文件')}</label>
                <div className="flex items-center gap-3">
                  <input ref={linkPdfRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleLinkPdfSelect} />
                  <button type="button" onClick={() => linkPdfRef.current?.click()} disabled={linkPdfUploading}
                    className="inline-flex items-center gap-2 h-12 px-4 rounded-2xl bg-white/60 border border-gray-200 text-sm text-gray-700 hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed transition-all">
                    {linkPdfUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} {linkPdfUploading ? t('上传中...') : (linkPdf ? t('重新选择 PDF') : t('选择 PDF'))}
                  </button>
                  {linkPdf && (
                    <>
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-600" title={linkPdf.name}>{linkPdf.name}</span>
                      <button type="button" onClick={() => { setLinkPdf(null); setLinkUrl(''); if (linkPdfRef.current) linkPdfRef.current.value = '' }}
                        className="shrink-0 rounded-xl px-2 py-1.5 text-xs text-red-500 hover:bg-red-50">{t('删除')}</button>
                    </>
                  )}
                </div>
                {linkPdfError && <p className="mt-1 text-xs text-red-500">{linkPdfError}</p>}
              </div>
              ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('地址')}</label>
                <input value={linkUrl} onChange={e => {
                  setLinkUrl(e.target.value)
                  scheduleLinkDesc(e.target.value)
                  if (!linkName) { const n = guessNameFromUrl(e.target.value); if (n) setLinkName(n) }
                  const u = e.target.value
                  if (!u) { setAddLinkDups([]); return }
                  // 重复检测：输入停止 500ms 后查询仓库内是否已存在相同链接
                  if (addLinkDupTimer.current) clearTimeout(addLinkDupTimer.current)
                  setAddLinkDups([])
                  if (u.trim().length > 3 && id) {
                    addLinkDupTimer.current = setTimeout(() => {
                      repos.links.duplicates(id, u.trim()).then((r: any) => { setAddLinkDups(r.duplicates || []); setAddLinkDupType(r.matchType === 'domain' ? 'domain' : 'exact') }).catch(() => {})
                    }, 500)
                  }
                  setFaviconLoading(true)
                  if (linkIconSrc === 'auto') faviconCache.resolve(u).then((r) => {
                    if (r.icon_url) {
                      setLinkIcon(r.icon_url.startsWith('http') ? r.icon_url : (window.location.origin + r.icon_url))
                    }
                  }).finally(() => setFaviconLoading(false))
                }} onBlur={() => {
                  // 失焦自动补全协议：未输入 http(s):// 时补 https://，并重新识别名称与图标
                  const u = linkUrl.trim()
                  if (u && !/^https?:\/\//i.test(u)) {
                    const fixed = 'https://' + u
                    setLinkUrl(fixed)
                    scheduleLinkDesc(fixed)
                    if (!linkName) { const n = guessNameFromUrl(fixed); if (n) setLinkName(n) }
                    setFaviconLoading(true)
                    if (linkIconSrc === 'auto') faviconCache.resolve(fixed).then((r) => {
                      if (r.icon_url) {
                        setLinkIcon(r.icon_url.startsWith('http') ? r.icon_url : (window.location.origin + r.icon_url))
                      }
                    }).finally(() => setFaviconLoading(false))
                  }
                }} placeholder={t('地址（https://...）')} className="w-full h-12 px-4 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              </div>
              )}
              {addLinkDups.length > 0 && (
                <div className="rounded-2xl bg-amber-50/80 border border-amber-200/60 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-amber-600 font-medium text-xs mb-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {t('仓库已存在 {n} 个', { n: addLinkDups.length })}{addLinkDupType === 'domain' ? t('相同域名的链接') : t('相同链接')}
                  </div>
                  <div className="space-y-1">
                    {addLinkDups.map((d: any) => (
                      <div key={d.id} className="flex items-center justify-between gap-2 text-xs text-gray-600">
                        <span className="flex items-center gap-1.5 truncate">
                          {d.icon && isImageIcon(d.icon)
                            ? <img src={d.icon} className="w-4 h-4 rounded object-contain shrink-0 bg-white border border-gray-200" />
                            : <span className="w-4 h-4 rounded shrink-0 inline-flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: d.bg_color || '#94a3b8' }}>{(d.name || '?').charAt(0).toUpperCase()}</span>}
                          <span className="truncate">{d.name}</span>
                        </span>
                        <span className="shrink-0 text-gray-400">{d.category_id || t('未分类')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <LinkDescriptionInput
                value={linkDesc}
                url={linkUrl}
                loading={linkDescLoading}
                onChange={setLinkDesc}
                onFetch={() => fetchLinkDesc(linkUrl, true)}
              />
              {linkCategories.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('分类（可多选）')}</label>
                  <CategoryMultiSelect
                    options={linkCategories.map((c: string) => ({ id: c, label: c }))}
                    selected={linkCategory}
                    onToggle={(cat) => setLinkCategory(linkCategory.includes(cat)
                      ? linkCategory.filter(x => x !== cat)
                      : [...linkCategory, cat])}
                  />
                </div>
              )}
              {/* 图标来源 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('图标来源')}</label>
                <select value={linkIconSrc} onChange={e => switchLinkIconSrc(e.target.value as 'auto' | 'upload' | 'text')}
                  className="w-full h-12 px-4 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm">
                  <option value="auto">{t('自动获取')}</option>
                  <option value="upload">{t('上传图标')}</option>
                  <option value="text">{t('文字图标')}</option>
                </select>
                <p className="text-xs text-gray-400 mt-1.5">
                  {linkIconSrc === 'auto' ? t('根据网址自动抓取网站图标') : linkIconSrc === 'upload' ? t('上传本地图片作为图标') : t('使用文字生成图标，最多 4 个字')}
                </p>
              </div>
              {/* 当前图标 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('当前图标')}</label>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-bold shadow-md overflow-hidden shrink-0"
                    style={linkIcon && isImageIcon(linkIcon) ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: linkPalette[linkColor]?.bg || '#3B82F6', color: linkPalette[linkColor]?.text || '#FFFFFF' }}>
                    {faviconLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-current/60" />
                    ) : linkIcon && isImageIcon(linkIcon) ? (
                      <img src={linkIcon} className="w-full h-full object-contain p-2" />
                    ) : (
                      <span className={iconFontSize(linkTextIcon || linkName)}>{linkTextIcon || linkName.slice(0, 4) || '?'}</span>
                    )}
                  </div>
                  {linkIconSrc === 'auto' && (
                    <button type="button" onClick={() => switchLinkIconSrc('auto')} disabled={faviconLoading || !linkUrl.trim()}
                      className="px-3 py-1.5 rounded-xl bg-white/60 border border-white/80 text-xs text-gray-600 hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1 transition-all">
                      <RefreshCw className={`w-3 h-3 ${faviconLoading ? 'animate-spin' : ''}`} />{t('刷新')}
                    </button>
                  )}
                  {linkIconSrc === 'upload' && (
                    <>
                      <input ref={linkFileRef} type="file" accept="image/*" className="hidden" onChange={handleLinkIconUpload} />
                      <button type="button" onClick={() => linkFileRef.current?.click()} className="px-3 py-1.5 rounded-xl bg-blue-500 text-white text-xs hover:bg-blue-600 transition-all"><Camera className="w-3 h-3 inline mr-1" />{t('上传图标')}</button>
                      {linkIcon && isImageIcon(linkIcon) && <button type="button" onClick={() => { setLinkIcon(''); if (linkFileRef.current) linkFileRef.current.value = '' }} className="text-xs text-red-400 hover:text-red-600">{t('清除')}</button>}
                    </>
                  )}
                  {linkIconSrc === 'text' && (
                    <input value={linkTextIcon} onChange={e => setLinkTextIcon(e.target.value)} placeholder={t('图标文字（最多4字）')} maxLength={4}
                      className="flex-1 h-11 px-4 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400 text-sm text-center" />
                  )}
                </div>
                {linkIconSrc === 'text' && (
                  <div className="flex gap-1 flex-wrap mt-2">
                    {linkPalette.map((p, i) => (
                      <button key={i} type="button" onClick={() => setLinkColor(i)}
                        className="w-5 h-5 rounded-full border border-white/60 shadow-sm transition-transform hover:scale-110"
                        style={{ backgroundColor: p.bg, transform: i === linkColor ? 'scale(1.3)' : undefined }} />
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={closeAddLink} className="flex-1 h-11 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200">{t('取消')}</button>
                <button onClick={addLink} disabled={linkAdding} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed">{linkAdding ? t('正在保存...') : t('添加')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Link Modal — with icon */}
      {editLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => { setEditLink(null); setEditLinkDups([]) }} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4 max-h-[80vh] overflow-y-auto [&::-webkit-scrollbar]:hidden">
            <ModalTitle icon={Edit3} title={t('编辑链接')} />
            <div className="space-y-5">
              {/* Icon preview + editor */}
              <div className="flex flex-col items-center gap-2 pb-2">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-bold shadow-md overflow-hidden"
                  style={editLink.icon && isImageIcon(editLink.icon) ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: editLink.bg_color || '#3B82F6', color: editLink.text_color || '#FFFFFF' }}>
                  {faviconLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-current/60" />
                  ) : editLink.icon && isImageIcon(editLink.icon) ? (
                    <img src={editLink.icon} className="w-full h-full object-contain p-2" />
                  ) : (
                    <span className={iconFontSize(editLink.icon || editLink.name)}>{editLink.icon || editLink.name?.charAt(0)?.toUpperCase() || '?'}</span>
                  )}
                </div>
                {(!editLink.icon || !isImageIcon(editLink.icon)) && (
                  <div className="flex gap-1 flex-wrap justify-center">
                    {linkPalette.map((p, i) => (
                      <button key={i} type="button" onClick={() => setEditLink({ ...editLink, bg_color: p.bg, text_color: p.text })}
                        className="w-5 h-5 rounded-full border border-white/60 shadow-sm transition-transform hover:scale-110"
                        style={{ backgroundColor: p.bg, transform: (editLink.bg_color || '#3B82F6') === p.bg ? 'scale(1.3)' : undefined }} />
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input ref={editLinkFileRef} type="file" accept="image/*" className="hidden" onChange={handleEditLinkIconUpload} />
                  <button type="button" onClick={() => editLinkFileRef.current?.click()} className="px-3 py-1.5 rounded-xl bg-blue-500 text-white text-xs hover:bg-blue-600"><Camera className="w-3 h-3 inline mr-1" />{t('上传图标')}</button>
                  {editLink.icon && isImageIcon(editLink.icon) && <button type="button" onClick={() => { setEditLink({ ...editLink, icon: '' }); if (editLinkFileRef.current) editLinkFileRef.current.value = '' }} className="text-xs text-red-400 hover:text-red-600">{t('清除')}</button>}
                </div>
                {(!editLink.icon || !isImageIcon(editLink.icon)) && (
                  <input value={editLink.icon || ''} onChange={e => setEditLink({ ...editLink, icon: e.target.value })} placeholder={t('图标文字（最多4字）')} maxLength={4} className="w-full h-10 px-4 bg-white/60 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400 text-xs text-center" />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('名称')}</label>
                <input value={editLink.name} onChange={e => setEditLink({ ...editLink, name: e.target.value })} placeholder={t('名称')} className="w-full h-12 px-4 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('地址')}</label>
                <input value={editLink.url} onChange={e => {
                  setEditLink({ ...editLink, url: e.target.value })
                  const u = e.target.value
                  if (!u) { setEditLinkDups([]); return }
                  // 重复检测：输入停止 500ms 后查询仓库内是否已存在相同链接（排除自身）
                  if (editLinkDupTimer.current) clearTimeout(editLinkDupTimer.current)
                  setEditLinkDups([])
                  if (u.trim().length > 3 && id) {
                    editLinkDupTimer.current = setTimeout(() => {
                      repos.links.duplicates(id, u.trim(), editLink.id).then((r: any) => { setEditLinkDups(r.duplicates || []); setEditLinkDupType(r.matchType === 'domain' ? 'domain' : 'exact') }).catch(() => {})
                    }, 500)
                  }
                  setFaviconLoading(true)
                  faviconCache.resolve(u).then((r) => {
                    if (r.icon_url) {
                      setEditLink((prev: any) => ({ ...prev, icon: r.icon_url.startsWith('http') ? r.icon_url : (window.location.origin + r.icon_url) }))
                    }
                  }).finally(() => setFaviconLoading(false))
                }} placeholder={t('地址')} className="w-full h-12 px-4 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              </div>
              {editLinkDups.length > 0 && (
                <div className="rounded-2xl bg-amber-50/80 border border-amber-200/60 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-amber-600 font-medium text-xs mb-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {t('仓库已存在 {n} 个', { n: editLinkDups.length })}{editLinkDupType === 'domain' ? t('相同域名的链接') : t('相同链接')}
                  </div>
                  <div className="space-y-1">
                    {editLinkDups.map((d: any) => (
                      <div key={d.id} className="flex items-center justify-between gap-2 text-xs text-gray-600">
                        <span className="flex items-center gap-1.5 truncate">
                          {d.icon && isImageIcon(d.icon)
                            ? <img src={d.icon} className="w-4 h-4 rounded object-contain shrink-0 bg-white border border-gray-200" />
                            : <span className="w-4 h-4 rounded shrink-0 inline-flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: d.bg_color || '#94a3b8' }}>{(d.name || '?').charAt(0).toUpperCase()}</span>}
                          <span className="truncate">{d.name}</span>
                        </span>
                        <span className="shrink-0 text-gray-400">{d.category_id || t('未分类')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('描述')}</label>
                <input value={editLink.desc || ''} onChange={e => setEditLink({ ...editLink, desc: e.target.value })} placeholder={t('描述')} className="w-full h-12 px-4 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              </div>
              {linkCategories.length > 0 && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">{t('分类（可多选）')}</label>
                  <CategoryMultiSelect
                    options={linkCategories.map((c: string) => ({ id: c, label: c }))}
                    selected={editLink.category_ids || [editLink.category_id].filter(Boolean)}
                    onToggle={(cat) => {
                      const selected = editLink.category_ids || [editLink.category_id].filter(Boolean)
                      setEditLink({
                        ...editLink,
                        category_ids: selected.includes(cat)
                          ? selected.filter((x: string) => x !== cat)
                          : [...selected, cat],
                      })
                    }}
                  />
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => { setEditLink(null); setEditLinkDups([]) }} className="flex-1 h-11 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200">{t('取消')}</button>
                <button onClick={updateLink} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600">{t('保存')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {showMemberAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowMemberAdd(false)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <ModalTitle icon={UserPlus} title={t('添加团队成员')} />
            <div className="flex gap-2 mb-3">
              <button onClick={() => { setMemberByEmail(false); setMemberInput('') }} className={`px-3 py-1.5 rounded-xl text-xs font-medium ${!memberByEmail ? 'bg-blue-500 text-white' : 'bg-white/50 text-gray-600'}`}>{t('按昵称')}</button>
              <button onClick={() => { setMemberByEmail(true); setMemberInput('') }} className={`px-3 py-1.5 rounded-xl text-xs font-medium ${memberByEmail ? 'bg-blue-500 text-white' : 'bg-white/50 text-gray-600'}`}>{t('按邮箱')}</button>
            </div>
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('成员')}</label>
              <input value={memberInput} onChange={e => setMemberInput(e.target.value)} placeholder={memberByEmail ? t('输入用户邮箱') : t('输入用户昵称')} className="w-full h-12 px-4 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowMemberAdd(false)} className="flex-1 h-11 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200">{t('取消')}</button>
              <button onClick={addMember} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600">{t('添加')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Repo Modal */}
      {showEditRepo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowEditRepo(false)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4 max-h-[80vh] overflow-y-auto [&::-webkit-scrollbar]:hidden">
            <ModalTitle icon={Settings} title={t('编辑仓库')} />
            <div className="space-y-5">
              <div className="flex items-center gap-4 mb-2">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold shadow-md flex-shrink-0 overflow-hidden" style={editIconKey ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: editBg, color: '#FFFFFF' }}>
                  {editIconKey ? <img src={editIconKey} className="w-full h-full object-contain p-2" /> : (editName ? editName.charAt(0).toUpperCase() : '?')}
                </div>
                <div>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleIconUpload} />
                  <button onClick={() => fileInputRef.current?.click()} disabled={iconUploading} className="px-3 py-2 rounded-xl bg-white/60 border border-white/80 text-sm text-gray-600 hover:bg-white/90"><Camera className="w-4 h-4 inline mr-1" />{iconUploading ? t('上传中...') : t('上传图标')}</button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('名称')}</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} placeholder={t('名称')} className="w-full h-12 px-4 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('简介')}</label>
                <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder={t('简介')} className="w-full h-20 px-4 py-3 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('可见性')}</label>
                <select value={editVisibility} onChange={e => setEditVisibility(e.target.value)} className="w-full h-12 px-4 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm">
                  <option value="private">{t('私密')}</option>
                  <option value="public">{t('共享')}</option>
                  <option value="password">{t('密码访问')}</option>
                </select>
              </div>
              {editVisibility === 'password' && (
                <input value={editPassword} onChange={e => setEditPassword(e.target.value)} placeholder={t('访问密码')} className="w-full h-12 px-4 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              )}
              <div className="flex gap-2">
                <button onClick={() => setShowEditRepo(false)} className="flex-1 h-11 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200">{t('取消')}</button>
                <button onClick={saveEditRepo} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600"><Save className="w-4 h-4 inline mr-1" />{t('保存')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Category Modal */}
      {editingCatName !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setEditingCatName(null)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <ModalTitle icon={Tag} title={t('编辑分类')} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('分类名称')}</label>
              <input value={editCatNewName} onChange={e => setEditCatNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') renameCategory() }}
                placeholder={t('分类名称')} autoFocus className="w-full h-12 px-4 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditingCatName(null)} className="flex-1 h-11 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200">{t('取消')}</button>
              <button onClick={renameCategory} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600">{t('保存')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div className="fixed z-50 bg-white border border-white/60 shadow-xl rounded-2xl p-2 w-44" style={{ left: contextMenu.x, top: contextMenu.y }}>
            {canManage && <button onClick={() => { setEditLink({ ...contextMenu.link }); setEditLinkDups([]); setContextMenu(null) }} className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-gray-800 hover:bg-black/5 transition-all"><span>{t('编辑')}</span><Edit3 className="w-4 h-4" /></button>}
            <button onClick={() => { setAddToHomeLink(contextMenu.link); setContextMenu(null); homeCats.list().then(setHomeCategories); setShowAddToHome(true) }} className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-gray-800 hover:bg-black/5 transition-all"><span>{t('添加到首页')}</span><Plus className="w-4 h-4" /></button>
            {canManage && <button onClick={() => { setContextMenu(null); setConfirmAction({ message: t('确定删除此链接？'), onConfirm: () => deleteLink(contextMenu.link.id) }) }} className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-gray-800 hover:bg-black/5 transition-all"><span>{t('删除')}</span><Trash2 className="w-4 h-4" /></button>}
          </div>
        </>
      )}

      {/* Add to Home Modal */}
      {showAddToHome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowAddToHome(false)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <ModalTitle icon={Plus} title={t('添加到首页')} />
            <p className="text-sm text-gray-500 mb-3">{t('选择目标分类：')}</p>
            <div className="space-y-1 max-h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden">
              {homeCategories.map((cat: any) => (
                <button key={cat.id} onClick={() => addLinkToHome(cat.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-all">{cat.name}</button>
              ))}
            </div>
            <button onClick={() => setShowAddToHome(false)} className="w-full mt-3 h-11 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200">{t('取消')}</button>
          </div>
        </div>
      )}
      {/* Follow Modal */}
      {showFollowModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowFollowModal(false)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <ModalTitle icon={Star} title={followResync ? t('同步设置') : t('关注仓库')} />
            <p className="text-sm text-gray-500 mb-4">{followResync ? t('重新同步会清掉首页中来自该仓库的旧链接，按仓库当前的分类与顺序重新复制一份。') : t('关注后，仓库链接更新会同步更新到您选择的首页菜单。')}</p>
            <p className="text-sm font-medium text-gray-700 mb-2">{t('选择首页分类同步链接：')}</p>
            <select value={followCatId} onChange={e => setFollowCatId(e.target.value)} className="w-full h-12 px-4 mb-4 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm">
              <option value="">{t('不同步')}</option>
              {homeCategories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {followCatId && duplicateLinks.length > 0 && (
              <div className="mb-4">
                <p className="text-xs text-gray-500 mb-2 leading-relaxed">
                  {t('检测到 {n} 个链接与您首页的链接重复，勾选后将不同步到首页：', { n: duplicateLinks.length })}
                </p>
                <div className="max-h-40 overflow-y-auto rounded-2xl border border-white/80 bg-white/50 divide-y divide-white/60">
                  {duplicateLinks.map(d => (
                    <label key={d.link_id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-white/50 transition-colors">
                      <input
                        type="checkbox"
                        checked={skipLinkIds.has(d.link_id)}
                        onChange={e => {
                          const next = new Set(skipLinkIds)
                          if (e.target.checked) next.add(d.link_id)
                          else next.delete(d.link_id)
                          setSkipLinkIds(next)
                        }}
                        className="w-4 h-4 accent-blue-500 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-gray-800 truncate">{d.name}</span>
                        <span className="block text-xs text-gray-400 truncate">{d.url}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              {followResync ? (
                <>
                  <button onClick={() => { setShowFollowModal(false); setConfirmAction({ message: t('取消关注后，首页的该仓库链接将同步删除'), onConfirm: toggleFollow }) }} disabled={following} className="flex-1 h-11 rounded-2xl border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-60">{t('取消关注')}</button>
                  <button onClick={followWithCategory} disabled={following || !followCatId} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60">{following ? t('正在同步...') : t('重新同步')}</button>
                </>
              ) : (
                <>
                  <button onClick={() => setShowFollowModal(false)} className="flex-1 h-11 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200">{t('取消')}</button>
                  <button onClick={followWithCategory} disabled={following} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60">{following ? t('正在关注...') : t('确认关注')}</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      <DeadLinksModal open={showDeadLinks} links={deadLinks} busy={removingDead}
        onClose={() => setShowDeadLinks(false)} onRemove={removeDeadLinks} />

      {/* Confirm Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setConfirmAction(null)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <p className="text-sm text-gray-700 mb-6 leading-relaxed">{confirmAction.message}</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmAction(null)} className="flex-1 h-11 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200">{t('取消')}</button>
              <button onClick={() => { confirmAction.onConfirm(); setConfirmAction(null) }} className="flex-1 h-11 rounded-2xl bg-red-500 text-white hover:bg-red-600">{t('确认')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Follow prompt banner */}
      {repo && !repo.is_following && !dismissBanner && !repo.can_manage && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200/60 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] px-4 sm:px-6 py-3.5">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
            <p className="text-sm text-gray-600 leading-relaxed">
              {t('关注仓库后，仓库链接将自动同步到您的首页，仓库每次更新链接，您的首页都会同步更新。')}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => user ? openFollowModal(false) : setShowAuth(true)}
                className="px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-all shadow-sm whitespace-nowrap">
                {t('关注')}
              </button>
              <button onClick={() => setDismissBanner(true)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-white/60 transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast />
      <LinkPreviewHost />
    </div>
    </div>
  )
}

function LinkSection({ title, links: linkList, canManage, githubStars, onContextMenu, onReorder }: {
  title: string; links: any[]; canManage: boolean; githubStars: Record<string, number>; onContextMenu: (m: any) => void; onReorder?: (list: any[]) => void
}) {
  const t = useT()
  const dragIdx = useRef<number | null>(null)

  return (
    <div className="bg-white/60 backdrop-blur-xl rounded-3xl border border-white/70 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.06)] p-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2">
          <span className="w-1.5 h-5 rounded-full bg-blue-400 inline-block" />
          {title}
          <span className="text-gray-400 font-normal text-xs ml-1">({linkList.length})</span>
        </h3>
      </div>
      {linkList.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-gray-400">
          <ExternalLink className="w-8 h-8 mb-2 text-gray-200" />
          <p className="text-xs">{t('暂无链接')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {linkList.map((link: any, idx: number) => (
            <div key={link.id} className="relative group"
              draggable={canManage}
              onDragStart={(e) => { dragIdx.current = idx; e.dataTransfer.setData('text/plain', link.id); e.currentTarget.classList.add('opacity-50') }}
              onDragEnd={(e) => { e.currentTarget.classList.remove('opacity-50') }}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('scale-[1.02]') }}
              onDragLeave={(e) => { e.currentTarget.classList.remove('scale-[1.02]') }}
              onDrop={(e) => {
                e.preventDefault(); e.currentTarget.classList.remove('scale-[1.02]')
                if (dragIdx.current === null || dragIdx.current === idx) return
                const list = [...linkList]
                const [moved] = list.splice(dragIdx.current, 1)
                const targetIdx = dragIdx.current < idx ? idx - 1 : idx
                list.splice(targetIdx, 0, moved)
                dragIdx.current = null
                onReorder?.(list)
              }}
              onContextMenu={(e) => { e.preventDefault(); onContextMenu({ x: e.clientX, y: e.clientY, link }) }}>
              <a href={link.url} target="_blank" rel="noopener noreferrer"
                onMouseEnter={(e) => scheduleLinkPreview(
                  { url: link.url, name: link.name, desc: link.desc || undefined, icon: link.icon && isImageIcon(link.icon) ? link.icon : undefined },
                  e.currentTarget)}
                onMouseLeave={cancelLinkPreview}
                onMouseDown={cancelLinkPreview}
                onClick={(e) => { cancelLinkPreview(); if (/\/api\/pdfs\/[0-9a-f-]{36}/.test(link.url || '')) { e.preventDefault(); openLinkUrl(link.url) } }}
                className="block p-3.5 rounded-2xl bg-white/70 border border-white/80 hover:bg-white/90 hover:shadow-md hover:border-white/90 transition-all duration-200 ring-1 ring-black/[0.03]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0 overflow-hidden shadow-sm"
                    style={link.icon && isImageIcon(link.icon) ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: link.bg_color || '#3B82F6', color: link.text_color || '#FFFFFF' }}>
                    {link.icon && isImageIcon(link.icon) ? (
                      <img src={link.icon} className="w-full h-full object-contain p-2" />
                    ) : (
                      <div className={`${iconFontSize((link.icon || link.name), 'small')} leading-[1.1] text-center flex flex-col items-center`}>
                        {iconTextLines(link.icon || link.name).map((line: string, i: number) => <span key={i}>{line}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-800 text-sm truncate leading-tight flex items-center gap-1" title={link.name}>
                      <span className="truncate">{link.name}</span>
                      {link.link_status === 'dead' && (
                        <span className="flex-shrink-0 inline-flex" title={link.last_http_status ? t('链接已失效（HTTP {status}）', { status: link.last_http_status }) : t('链接已失效')}>
                          <Link2Off className="w-3.5 h-3.5 text-red-500" />
                        </span>
                      )}
                    </h4>
                    <div className="flex items-center gap-2 mt-0.5">
                      {link.desc ? (
                        <p className="text-xs text-gray-400 truncate flex-1 min-w-0" title={link.desc}>{link.desc}</p>
                      ) : (
                        <p className="text-xs text-gray-400 truncate flex-1 min-w-0" title={link.url}>{link.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</p>
                      )}
                      {githubStars[link.id] !== undefined && (
                        <span className="flex items-center gap-0.5 text-xs text-amber-500 shrink-0">
                          <Star className="w-3 h-3 fill-amber-400" />
                          {githubStars[link.id] >= 1000 ? (githubStars[link.id] / 1000).toFixed(1) + 'k' : githubStars[link.id]}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </a>
              <div className="absolute right-1.5 inset-y-0 flex items-center">
                {canManage && (
                  <button onClick={(e) => { e.stopPropagation(); onContextMenu({ x: e.clientX, y: e.clientY, link }) }}
                    className="w-7 h-7 rounded-lg bg-white/70 border border-white/80 flex items-center justify-center text-gray-400 hover:text-blue-500 hover:bg-white shadow-sm transition-all">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
