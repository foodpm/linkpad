import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, ExternalLink, KeyRound, Loader2, Maximize2, Quote, RefreshCw, Shuffle, X } from 'lucide-react'
import { weread, type WereadNote } from '../api'
import { WidgetResizeHandle } from './CountdownWidget'
import { useT } from '../i18n'

// ---------- 类型 ----------

export interface WereadWidgetData {
  id: string
  type: 'weread'
  name?: string
  category_id?: string
  height?: number // 1 | 2 | 3 个卡片
  inFrequent?: boolean // 放入常用工具
  rotateHours?: number // 轮换频率（小时），默认 24 = 每天
}

// ---------- 工具 ----------

const ROTATE_OPTIONS: { hours: number; label: string }[] = [
  { hours: 1, label: '每小时' },
  { hours: 4, label: '每 4 小时' },
  { hours: 12, label: '每 12 小时' },
  { hours: 24, label: '每天' },
  { hours: 72, label: '每 3 天' },
  { hours: 168, label: '每 7 天' },
]

const fmtDate = (sec?: number) => {
  if (!sec) return ''
  const d = new Date(sec * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 多卡片实例共享的自动同步去重：进行中共享同一个 Promise
let autoSyncAt = 0
let autoSyncPromise: Promise<unknown> | null = null

// 自动同步调度：严格按组件设定的轮换间隔执行，调度时间持久化在 localStorage，
// 跨页面刷新也不会重复触发（不再每次进入都同步）
const AUTO_SYNC_KEY = 'weread_last_autosync'
function maybeAutoSync(intervalHours: number, after?: () => void) {
  if (autoSyncPromise) return
  if (Date.now() - autoSyncAt < 10 * 60 * 1000) return
  let last = 0
  try { last = Number(localStorage.getItem(AUTO_SYNC_KEY) || 0) } catch {}
  if (Date.now() - last < intervalHours * 3600 * 1000) return
  autoSyncAt = Date.now()
  try { localStorage.setItem(AUTO_SYNC_KEY, String(Date.now())) } catch {}
  autoSyncPromise = weread.sync().catch(() => null).finally(() => { autoSyncPromise = null; after?.() })
}

// 时间桶：轮换周期的唯一键，桶内展示稳定、跨桶自动轮换
const bucketOf = (hours: number) => Math.floor(Date.now() / (hours * 3600000))

// ---------- 卡片 ----------

interface CardProps {
  widget: WereadWidgetData
  onUpdate: (patch: Partial<WereadWidgetData>) => void
  onRemove: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

export function WereadWidgetCard({ widget, onUpdate, onRemove, onContextMenu }: CardProps) {
  const t = useT()
  const height = widget.height || 1
  const isBig = height >= 2
  const rotateHours = widget.rotateHours || 24

  const [configured, setConfigured] = useState<boolean | null>(null) // null = 加载中
  const [currentNote, setCurrentNote] = useState<WereadNote | null>(null)
  const [notes, setNotes] = useState<WereadNote[]>([])
  const [total, setTotal] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [showFullModal, setShowFullModal] = useState(false)
  const [showSetup, setShowSetup] = useState(false)

  const hours = rotateHours // 依赖项简写
  const widgetId = widget.id

  // 轮换种子：默认取时间桶号（同一时段稳定，到点自动轮换）；「换一批」写覆盖值并持久化到本时间桶结束
  const seedFor = (h: number) => {
    const bucket = bucketOf(h)
    try {
      const o = JSON.parse(localStorage.getItem(`weread_seed_${widgetId}`) || 'null')
      if (o && o.bucket === bucket) return String(o.seed)
    } catch {}
    return String(bucket)
  }
  const [noteSeed, setNoteSeed] = useState(() => seedFor(rotateHours))
  const bucketRef = useRef(0)

  const loadCurrentNote = useCallback(async () => {
    try {
      const data = await weread.note(hours, widgetId, noteSeed)
      setConfigured(data.configured)
      setCurrentNote(data.note)
      setTotal(data.total)
      // 自动同步：按设定的轮换间隔严格执行（不每次进入都触发）
      if (data.configured) maybeAutoSync(hours, () => loadCurrentNote())
    } catch { setConfigured(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, widgetId, noteSeed])

  const loadList = useCallback(async (force = false) => {
    const batchKey = `weread_batch_${widgetId}`
    const bucket = bucketOf(hours)
    // 时间桶内直接用缓存批次，不重新随机拉取（严格按设定的间隔轮换）
    if (!force) {
      try {
        const cached = JSON.parse(localStorage.getItem(batchKey) || 'null')
        if (cached && cached.bucket === bucket && Array.isArray(cached.notes) && cached.notes.length > 0) {
          setConfigured(true)
          setNotes(cached.notes)
          setTotal(cached.total || cached.notes.length)
          return
        }
      } catch {}
    }
    try {
      const [cfg, list] = await Promise.all([weread.config.get(), weread.notes({ limit: 30, random: true })])
      setConfigured(cfg.configured)
      setNotes(list.notes || [])
      setTotal(list.total ?? (cfg.totalNotes || 0))
      if (cfg.configured && (list.notes || []).length > 0) {
        try { localStorage.setItem(batchKey, JSON.stringify({ bucket, notes: list.notes, total: list.total ?? cfg.totalNotes })) } catch {}
      }
      // 自动同步：按设定的轮换间隔严格执行
      if (cfg.configured) maybeAutoSync(hours, () => loadList(true))
    } catch { setConfigured(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, widgetId])

  // 挂载 / 高度或轮换频率变化时加载数据
  useEffect(() => {
    if (isBig) loadList()
    else loadCurrentNote()
  }, [isBig, loadCurrentNote, loadList])

  // 轮换频率变化时按新周期重算种子
  useEffect(() => { setNoteSeed(seedFor(hours)) }, [hours]) // eslint-disable-line react-hooks/exhaustive-deps

  // 每分钟检查时间桶变化（仅单卡轮换展示需要）：桶切换 = 种子回到时间桶号，笔记自动轮换
  useEffect(() => {
    if (isBig) return
    bucketRef.current = bucketOf(rotateHours)
    const timer = setInterval(() => {
      const b = bucketOf(rotateHours)
      if (b !== bucketRef.current) {
        bucketRef.current = b
        setNoteSeed(String(b))
      }
    }, 60 * 1000)
    return () => clearInterval(timer)
  }, [isBig, rotateHours])

  const manualSync = async () => {
    if (syncing) return
    setSyncing(true)
    try { await weread.sync() } catch {}
    setSyncing(false)
    if (isBig) loadList(true)
    else loadCurrentNote()
  }

  const openSetup = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    setShowSetup(true)
  }
  const onSetupSaved = () => {
    setShowSetup(false)
    setConfigured(true)
    // 首次配置成功后立即同步
    setSyncing(true)
    weread.sync().catch(() => {}).finally(() => {
      setSyncing(false)
      if (isBig) loadList(true)
      else loadCurrentNote()
    })
  }

  const noteText = (n: WereadNote) => n.type === 'thought' && n.abstract ? n.abstract : n.content

  return (
    <div className="relative group h-full min-h-0">
      {/* 删除组件按钮 */}
      <button onClick={onRemove} title={t('移除组件')}
        className="absolute -top-1.5 -right-1.5 z-30 w-5 h-5 rounded-full bg-red-400 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500">
        <X className="w-3 h-3" />
      </button>
      <div data-widget-card onContextMenu={onContextMenu} onClick={isBig ? undefined : () => setShowFullModal(true)}
        className={`h-full flex flex-col rounded-2xl overflow-hidden ring-1 ring-black/[0.04] shadow-sm hover:shadow-md transition-all select-none ${isBig ? '' : 'cursor-pointer'}`}>
        {/* 头部：多卡=标题+数量+同步/放大；单卡=当前笔记书名（磨砂材质，透出壁纸） */}
        {isBig ? (
          <div className="bg-gradient-to-b from-blue-400/80 to-blue-500/70 backdrop-blur-xl text-white flex-shrink-0 flex items-center gap-1.5 px-3 py-2 min-h-[38px]">
            <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
            <p className="text-[13px] font-semibold flex-1 truncate">{t('微信读书')}</p>
            {total > 0 && (
              <span className="text-[10px] font-medium bg-white/20 px-1.5 py-0.5 rounded-full flex-shrink-0">{total}</span>
            )}
            <button onClick={(e) => { e.stopPropagation(); loadList(true) }} title={t('换一批笔记')}
              className="w-5 h-5 rounded-md hover:bg-white/20 flex items-center justify-center flex-shrink-0">
              <Shuffle className="w-3 h-3" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); manualSync() }} title={t('同步笔记')}
              className="w-5 h-5 rounded-md hover:bg-white/20 flex items-center justify-center flex-shrink-0">
              {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </button>
            <button onClick={(e) => { e.stopPropagation(); setShowFullModal(true) }} title={t('查看全部')}
              className="w-5 h-5 rounded-md hover:bg-white/20 flex items-center justify-center flex-shrink-0">
              <Maximize2 className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="relative bg-gradient-to-b from-blue-400/80 to-blue-500/70 backdrop-blur-xl text-white flex-shrink-0 flex items-center justify-center px-2 py-2 min-h-[38px]">
            <p className="text-[13px] font-semibold truncate text-center w-full px-9">
              {currentNote?.book_title ? t('《{title}》', { title: currentNote.book_title }) : t('微信读书')}
            </p>
            <div className="absolute right-1.5 flex items-center gap-0.5 flex-shrink-0">
              <button onClick={(e) => { e.stopPropagation(); const s = String(Math.floor(Math.random() * 1e9)); try { localStorage.setItem(`weread_seed_${widgetId}`, JSON.stringify({ bucket: bucketOf(hours), seed: s })) } catch {}; setNoteSeed(s) }} title={t('换一批笔记')}
                className="w-5 h-5 rounded-md hover:bg-white/20 flex items-center justify-center opacity-70 hover:opacity-100">
                <Shuffle className="w-3 h-3" />
              </button>
              <div className="w-5 h-5 rounded-md flex items-center justify-center opacity-70">
                <Maximize2 className="w-3 h-3" />
              </div>
            </div>
          </div>
        )}
        {/* 主体：多卡=最新笔记列表（溢出滚动）；单卡=当前轮换笔记 */}
        {isBig ? (
          <div className="flex-1 min-h-0 overflow-y-auto bg-white [&::-webkit-scrollbar]:hidden px-1.5 py-1 space-y-0.5">
            {configured === false ? (
              <button onClick={openSetup}
                className="w-full h-full min-h-[60px] flex flex-col items-center justify-center gap-1 text-gray-300 hover:text-blue-400 transition-colors">
                <KeyRound className="w-5 h-5" />
                <span className="text-[10px]">{t('配置 API Key')}</span>
              </button>
            ) : notes.length === 0 ? (
              <button onClick={(e) => { e.stopPropagation(); manualSync() }}
                className="w-full h-full min-h-[60px] flex flex-col items-center justify-center gap-1 text-gray-300 hover:text-blue-400 transition-colors">
                {syncing ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                <span className="text-[10px]">{configured === null ? t('加载中...') : t('同步笔记')}</span>
              </button>
            ) : notes.map(n => (
              <div key={n.id} onClick={(e) => { e.stopPropagation(); setShowFullModal(true) }}
                className="flex items-start gap-2 px-2 py-1.5 rounded-xl hover:bg-blue-50/70 transition-colors cursor-pointer">
                {n.type === 'thought'
                  ? <Quote className="w-3 h-3 mt-0.5 flex-shrink-0 text-amber-400" />
                  : <span className="w-3 h-3 mt-0.5 flex-shrink-0 rounded-sm bg-blue-200" title={t('划线')} />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 leading-snug whitespace-pre-wrap break-words">{noteText(n)}</p>
                  <p className="text-[10px] text-gray-400 truncate mt-0.5">
                    {n.type === 'thought' && <span className="text-amber-400 mr-1">{t('想法')}</span>}
                    {n.book_title && t('《{title}》', { title: n.book_title })}
                    {n.chapter && ` · ${n.chapter}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto bg-white [&::-webkit-scrollbar]:hidden flex flex-col px-2.5 py-1.5 text-center">
            {configured === false ? (
              <button onClick={openSetup}
                className="m-auto flex flex-col items-center gap-1 text-gray-300 hover:text-blue-400 transition-colors">
                <KeyRound className="w-5 h-5" />
                <span className="text-[10px]">{t('配置 API Key')}</span>
              </button>
            ) : currentNote ? (
              <div className="m-auto w-full">
                <p className="text-[12px] leading-snug text-gray-700 w-full whitespace-pre-wrap break-words">{noteText(currentNote)}</p>
                <p className="text-[10px] text-gray-400 truncate w-full mt-1">
                  {currentNote.type === 'thought' && <span className="text-amber-400 mr-1">{t('想法')}</span>}
                  {currentNote.chapter || fmtDate(currentNote.create_time)}
                </p>
              </div>
            ) : (
              <button onClick={(e) => { e.stopPropagation(); manualSync() }}
                className="m-auto flex flex-col items-center gap-1 text-gray-300 hover:text-blue-400 transition-colors">
                {syncing ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                <span className="text-[10px]">{configured === null ? t('加载中...') : t('同步笔记')}</span>
              </button>
            )}
          </div>
        )}
      </div>
      <WidgetResizeHandle height={height} onChange={(h) => onUpdate({ height: h })} />
      {showFullModal && (
        <WereadFullModal widget={widget} onUpdate={onUpdate} initialNotes={notes} onClose={() => setShowFullModal(false)} onChanged={() => {
          if (isBig) loadList(true)
          else loadCurrentNote()
        }} />
      )}
      {showSetup && (
        <WereadSetupModal onClose={() => setShowSetup(false)} onSaved={onSetupSaved} />
      )}
    </div>
  )
}

// ---------- 放大弹窗：设置 + 全部笔记 ----------

export function WereadFullModal({ widget, onUpdate, onClose, onChanged, initialNotes }: {
  widget: WereadWidgetData
  onUpdate: (patch: Partial<WereadWidgetData>) => void
  onClose: () => void
  onChanged: () => void
  initialNotes?: WereadNote[]
}) {
  const t = useT()
  const rotateHours = widget.rotateHours || 24
  // 放大弹窗与卡片显示同一批随机数据：有 initialNotes 直接复用（不重新拉取）
  const seedNotes = initialNotes && initialNotes.length > 0
  const [notes, setNotes] = useState<WereadNote[]>(seedNotes ? initialNotes! : [])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [confirmUnbind, setConfirmUnbind] = useState(false)
  const zeroGainsRef = useRef(0)

  const PAGE = 30

  // 随机模式无 offset 分页：每次随机抽一批，按 id 去重追加；连续两批无新数据则认为已覆盖全部
  const loadRandomBatch = useCallback(async (append: boolean) => {
    setLoading(true)
    try {
      const list = await weread.notes({ limit: PAGE, random: true })
      const batch = list.notes || []
      if (append) {
        setNotes(prev => {
          const seen = new Set(prev.map(p => p.id))
          const fresh = batch.filter(n => !seen.has(n.id))
          zeroGainsRef.current = fresh.length === 0 ? zeroGainsRef.current + 1 : 0
          return [...prev, ...fresh]
        })
        setOffset(prev => prev + batch.length)
      } else {
        zeroGainsRef.current = 0
        setNotes(batch)
        setOffset(batch.length)
      }
      setTotal(list.total ?? 0)
      setHasMore(batch.length >= PAGE && zeroGainsRef.current < 2)
    } catch {}
    setLoading(false)
  }, [])

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await weread.config.get()
      setConfigured(cfg.configured)
      setLastSyncedAt(cfg.lastSyncedAt || 0)
      if (!cfg.configured) { setNotes([]); setTotal(0); setHasMore(false) }
    } catch {}
  }, [])

  useEffect(() => {
    if (seedNotes) {
      // 复用卡片随机批：仅补拉配置与总数
      weread.config.get().then(cfg => {
        setConfigured(cfg.configured)
        setLastSyncedAt(cfg.lastSyncedAt || 0)
        setTotal(cfg.totalNotes || notes.length)
        if (!cfg.configured) { setNotes([]); setTotal(0); setHasMore(false) }
      }).catch(() => {}).finally(() => setLoading(false))
    } else {
      loadConfig()
      loadRandomBatch(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConfig, loadRandomBatch])

  const sync = async () => {
    if (syncing) return
    setSyncing(true)
    try { await weread.sync() } catch {}
    setSyncing(false)
    await Promise.all([loadConfig(), loadRandomBatch(false)])
    onChanged()
  }

  const unbind = async () => {
    try { await weread.config.remove() } catch {}
    try { localStorage.removeItem(`weread_seed_${widget.id}`); localStorage.removeItem(`weread_batch_${widget.id}`) } catch {}
    setConfirmUnbind(false)
    setConfigured(false)
    setNotes([]); setTotal(0); setHasMore(false)
    onChanged()
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-500" /> {t('微信读书笔记')}
            {total > 0 && <span className="text-xs font-medium text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">{total}</span>}
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={() => loadRandomBatch(false)} disabled={!configured} title={t('换一批')}
              className="w-8 h-8 rounded-xl bg-white/60 text-blue-500 hover:bg-blue-50 disabled:opacity-40 flex items-center justify-center">
              <Shuffle className="w-4 h-4" />
            </button>
            <button onClick={sync} disabled={!configured} title={t('同步笔记')}
              className="w-8 h-8 rounded-xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 flex items-center justify-center">
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>
            <button onClick={onClose} title={t('关闭')}
              className="w-8 h-8 rounded-xl text-gray-400 hover:bg-black/5 flex items-center justify-center">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 设置区 */}
        <div className="flex-shrink-0 bg-white/60 rounded-2xl border border-white/80 px-3 py-2.5 mb-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 flex-shrink-0">{t('轮换频率')}</span>
            <select value={String(rotateHours)} disabled={!configured}
              onChange={(e) => { onUpdate({ rotateHours: Number(e.target.value) }); onChanged() }}
              className="flex-1 h-8 px-2 bg-white border border-gray-100 rounded-lg text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400/50">
              {ROTATE_OPTIONS.map(o => <option key={o.hours} value={o.hours}>{t(o.label)}{t('换一条')}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500 flex-shrink-0">API Key</span>
            <span className={`flex-1 ${configured ? 'text-gray-400' : 'text-gray-300'}`}>
              {configured ? t('已配置{synced}', { synced: lastSyncedAt ? t(' · 上次同步 {d}', { d: fmtDate(lastSyncedAt) }) : '' }) : t('未配置')}
            </span>
            <button onClick={() => setShowSetup(true)} className="text-blue-500 hover:text-blue-600 flex-shrink-0">
              {configured ? t('重新配置') : t('去配置')}
            </button>
            {configured && (
              <button onClick={() => (confirmUnbind ? unbind() : setConfirmUnbind(true))}
                onBlur={() => setConfirmUnbind(false)}
                className={`flex-shrink-0 ${confirmUnbind ? 'text-red-500 font-medium' : 'text-gray-400 hover:text-red-500'}`}>
                {confirmUnbind ? t('确认解绑？') : t('解绑')}
              </button>
            )}
          </div>
        </div>

        {/* 笔记列表（随机批次，与非放大查看一致） */}
        <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden space-y-1">
          {!configured ? (
            <div className="py-10 flex flex-col items-center gap-2 text-gray-300">
              <BookOpen className="w-8 h-8" />
              <button onClick={() => setShowSetup(true)} className="text-xs text-blue-400 hover:text-blue-500">{t('配置 API Key 后同步笔记')}</button>
            </div>
          ) : notes.length === 0 && !loading ? (
            <div className="py-10 flex flex-col items-center gap-2 text-gray-300">
              <BookOpen className="w-8 h-8" />
              <p className="text-xs">{t('还没有笔记数据，点击右上角同步')}</p>
            </div>
          ) : notes.map(n => (
            <div key={n.id} className="px-3 py-2.5 rounded-2xl hover:bg-blue-50/70 transition-colors">
              {(n.type === 'thought' && n.abstract) && (
                <p className="text-[11px] text-gray-400 leading-snug whitespace-pre-wrap break-words mb-1">{t('「{text}」', { text: n.abstract })}</p>
              )}
              <p className="text-sm text-gray-700 leading-snug whitespace-pre-wrap break-words">
                {n.type === 'thought' && <span className="text-amber-400 text-xs mr-1.5">{t('想法')}</span>}
                {n.content}
              </p>
              <p className="text-[11px] text-gray-400 truncate mt-1">
                {n.book_title && t('《{title}》', { title: n.book_title })}
                {n.chapter && ` · ${n.chapter}`}
                {n.create_time ? ` · ${fmtDate(n.create_time)}` : ''}
              </p>
            </div>
          ))}
          {loading && <p className="text-xs text-gray-400 text-center py-3">{t('加载中...')}</p>}
          {hasMore && !loading && (
            <button onClick={() => loadRandomBatch(true)}
              className="w-full py-2 text-xs text-blue-500 hover:text-blue-600">{t('加载更多')}</button>
          )}
        </div>
        <p className="text-[10px] text-gray-300 mt-3 text-center">
          {t('数据来自微信读书官方接口 · ')}<a href="https://weread.qq.com/r/weread-skills" target="_blank" rel="noreferrer" className="underline hover:text-blue-400">{t('获取 API Key')}</a>
        </p>
      </div>
      {showSetup && (
        <WereadSetupModal onClose={() => setShowSetup(false)}
          onSaved={async () => { setShowSetup(false); setConfigured(true); await sync() }} />
      )}
    </div>,
    document.body
  )
}

// ---------- API Key 配置弹窗 ----------

export function WereadSetupModal({ onClose, onSaved }: {
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    const key = apiKey.trim()
    if (!key) { setError(t('请输入 API Key')); return }
    setSaving(true)
    setError('')
    try {
      await weread.config.save(key)
      onSaved()
    } catch (e: any) {
      setError(e.message || t('保存失败，请稍后再试'))
    }
    setSaving(false)
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4"
        onKeyDown={e => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') submit() }}>
        <h3 className="font-bold text-gray-800 mb-1 flex items-center gap-2"><BookOpen className="w-4 h-4 text-blue-500" /> {t('配置微信读书')}</h3>
        <p className="text-xs text-gray-400 leading-relaxed mb-4">
          {t('1. 打开微信读书官方 Skill 页面')}{' '}
          <a href="https://weread.qq.com/r/weread-skills" target="_blank" rel="noreferrer" className="text-blue-500 underline inline-flex items-center gap-0.5">
            weread.qq.com/r/weread-skills <ExternalLink className="w-3 h-3" />
          </a>{' '}{t('（或 App「设置 → 微信读书 Skill」）')}<br />
          {t('2. 扫码登录后，在「获取 API Key」处创建并复制（wrk- 开头）')}<br />
          {t('3. 粘贴到下方。Key 仅保存在服务端，用于同步你的划线与想法')}
        </p>
        <input type="text" value={apiKey} onChange={e => { setApiKey(e.target.value); setError('') }}
          placeholder="wrk-xxxxxxxx" autoFocus
          className="w-full h-11 px-4 mb-2 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm" />
        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-11 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200">{t('取消')}</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60 flex items-center justify-center gap-1.5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}{t('验证并保存')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
