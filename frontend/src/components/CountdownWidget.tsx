import React, { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, Maximize2, Plus, Trash2, X } from 'lucide-react'
import solarLunar from 'solarlunar'
import { useT, getLang } from '../i18n'

// ---------- 类型 ----------

export type RepeatMode = 'none' | 'week' | 'month' | 'year'
export type CalType = 'solar' | 'lunar'

export interface CountdownEvent {
  id: string
  title: string
  cal: CalType
  /** solar: 'YYYY-MM-DD'（任意一次实际发生的日期，作为重复锚点） */
  date?: string
  /** lunar: 农历年（repeat=none 时用于确定唯一日期） */
  lYear?: number
  lMonth?: number
  lDay?: number
  lLeap?: boolean
  repeat: RepeatMode
}

export interface CountdownWidgetData {
  id: string
  type: 'countdown'
  name?: string
  category_id?: string
  height?: number // 1 | 2 | 3 个卡片
  inFrequent?: boolean // 放入常用工具
  events?: CountdownEvent[]
}

const DAY = 86400000
const GAP = 12 // grid gap-3

function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------- 倒计时计算 ----------

/** 某事项的下一次发生日期与剩余天数；不重复且已过期 → null（自动隐藏） */
export function nextOccurrence(ev: CountdownEvent, now = new Date()): { date: Date; days: number } | null {
  const today = startOfToday(now)
  const t0 = today.getTime()
  if (ev.cal === 'solar') {
    const [y, m, d] = (ev.date || '').split('-').map(Number)
    if (!y || !m || !d) return null
    if (ev.repeat === 'none') {
      const t = new Date(y, m - 1, d)
      const days = Math.round((t.getTime() - t0) / DAY)
      return days >= 0 ? { date: t, days } : null
    }
    const wd = new Date(y, m - 1, d).getDay()
    const lim = ev.repeat === 'week' ? 7 : ev.repeat === 'month' ? 62 : 366
    for (let i = 0; i <= lim; i++) {
      const t = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
      const ok = ev.repeat === 'week' ? t.getDay() === wd
        : ev.repeat === 'month' ? t.getDate() === d
        // 每年：同月同日；2/29 等不存在的日期平年退化为当月最后一天（2/28），保证重复事项一直展示
        : (t.getMonth() === m - 1 && t.getDate() === Math.min(d, new Date(t.getFullYear(), m, 0).getDate()))
      if (ok) return { date: t, days: i }
    }
    return null
  }
  // 农历
  if (!ev.lMonth || !ev.lDay) return null
  if (ev.repeat === 'none') {
    if (!ev.lYear) return null
    const r: any = solarLunar.lunar2solar(ev.lYear, ev.lMonth, ev.lDay, !!ev.lLeap)
    if (!r || r === -1) return null
    const t = new Date(r.cYear, r.cMonth - 1, r.cDay)
    const days = Math.round((t.getTime() - t0) / DAY)
    return days >= 0 ? { date: t, days } : null
  }
  const lim = ev.repeat === 'month' ? 800 : 400
  for (let i = 0; i <= lim; i++) {
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
    const l: any = solarLunar.solar2lunar(t.getFullYear(), t.getMonth() + 1, t.getDate())
    if (!l || l === -1) continue
    if (ev.repeat === 'month') {
      // 农历每月同一天；勾选了闰月则只匹配闰月
      const leapOk = ev.lLeap ? !!l.isLeap : !l.isLeap
      if (leapOk && l.lDay === ev.lDay) return { date: t, days: i }
    } else {
      // 每年：同月同日（含闰月标记）
      if (!!ev.lLeap === !!l.isLeap && l.lMonth === ev.lMonth && l.lDay === ev.lDay) return { date: t, days: i }
    }
  }
  return null
}

/** 目标日期的展示文案（公历：中文 M月D日 / 英文 September 27, 2026；农历：五月初五 / 5/5） */
export function eventDateLabel(ev: CountdownEvent, target: Date): string {
  if (ev.cal === 'solar') {
    if (getLang() === 'en') {
      return target.toLocaleDateString('en-US', ev.repeat === 'none' ? { year: 'numeric', month: 'long', day: 'numeric' } : { month: 'long', day: 'numeric' })
    }
    const sameYear = target.getFullYear() === new Date().getFullYear()
    const base = `${target.getMonth() + 1}月${target.getDate()}日`
    return sameYear ? base : `${target.getFullYear()}年${base}`
  }
  const l: any = solarLunar.solar2lunar(target.getFullYear(), target.getMonth() + 1, target.getDate())
  if (!l || l === -1) return ''
  // 英文下农历用数字表示（前缀「Lunar 」由渲染处 t('农历 ') 提供）
  if (getLang() === 'en') return `${l.isLeap ? 'Leap ' : ''}${l.lMonth}/${l.lDay}`
  return `${l.isLeap ? '闰' : ''}${l.monthCn}${l.dayCn}`
}

const repeatTag = (r: RepeatMode) => r === 'week' ? '每周' : r === 'month' ? '每月' : r === 'year' ? '每年' : ''

// ---------- 拖拽调高把手 ----------

export function WidgetResizeHandle({ height, onChange }: { height: number; onChange: (h: number) => void }) {
  const t = useT()
  const start = useRef<{ y: number; h: number; unit: number } | null>(null)
  return (
    <div className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize flex items-end justify-center z-20 opacity-0 group-hover:opacity-100 transition-opacity"
      title={t('拖动调整高度')}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.preventDefault(); e.stopPropagation()
        const card = (e.currentTarget as HTMLElement).closest('[data-widget-card]') as HTMLElement | null
        const rect = card?.getBoundingClientRect()
        if (!rect) return
        start.current = { y: e.clientY, h: height, unit: (rect.height + GAP) / height }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        document.body.style.cursor = 'ns-resize'
      }}
      onPointerMove={(e) => {
        const s = start.current
        if (!s) return
        const units = Math.round((e.clientY - s.y) / s.unit)
        const next = Math.min(3, Math.max(1, s.h + units))
        if (next !== s.h) { s.h = next; onChange(next) }
      }}
      onPointerUp={(e) => {
        start.current = null
        document.body.style.cursor = ''
        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
      }}>
      <div className="w-10 h-1 rounded-full bg-blue-300/80 mb-0.5" />
    </div>
  )
}

// ---------- 倒计时卡片 ----------

interface CardProps {
  widget: CountdownWidgetData
  onUpdate: (patch: Partial<CountdownWidgetData>) => void
  onRemove: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

export function CountdownWidgetCard({ widget, onUpdate, onRemove, onContextMenu }: CardProps) {
  const t = useT()
  const height = widget.height || 1
  const todayKey = new Date().toDateString()
  const [showEventModal, setShowEventModal] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CountdownEvent | null>(null)
  const [showFullModal, setShowFullModal] = useState(false)

  const upcoming = useMemo(() => {
    return (widget.events || [])
      .map(ev => ({ ev, occ: nextOccurrence(ev) }))
      .filter((x): x is { ev: CountdownEvent; occ: { date: Date; days: number } } => !!x.occ)
      .sort((a, b) => a.occ.days - b.occ.days)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.events, todayKey])

  const nearest = upcoming[0]
  // 多卡（2/3卡）：固定为用户设置的尺寸，溢出内容滚动查看；单卡：紧凑大数字
  const isBig = height >= 2

  const removeEvent = (id: string) => {
    onUpdate({ events: (widget.events || []).filter(e => e.id !== id) })
  }

  // 编辑：打开事项弹窗并回填，保存时按 id 替换
  const openEdit = (ev: CountdownEvent) => { setEditingEvent(ev); setShowEventModal(true) }
  const openAdd = () => { setEditingEvent(null); setShowEventModal(true) }
  const saveEvent = (ev: CountdownEvent) => {
    const list = widget.events || []
    onUpdate({ events: editingEvent ? list.map(e => e.id === ev.id ? ev : e) : [...list, ev] })
    setShowEventModal(false)
    setEditingEvent(null)
  }

  return (
    <div className="relative group h-full min-h-0">
      {/* 删除组件按钮 */}
      <button onClick={onRemove} title={t('移除组件')}
        className="absolute -top-1.5 -right-1.5 z-30 w-5 h-5 rounded-full bg-red-400 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500">
        <X className="w-3 h-3" />
      </button>
      <div data-widget-card onContextMenu={onContextMenu} onClick={isBig ? undefined : () => setShowFullModal(true)}
        className={`h-full flex flex-col rounded-2xl overflow-hidden bg-white/25 backdrop-blur-xl border border-white/35 ring-1 ring-white/20 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.38)] hover:bg-white/32 hover:border-white/50 hover:shadow-[0_14px_36px_-14px_rgba(0,0,0,0.45)] transition-all select-none text-white ${isBig ? '' : 'cursor-pointer'}`}>
        {/* 头部：多卡=标题+数量+放大/添加按钮；单卡=最近事项紧凑头部（磨砂材质，透出壁纸） */}
        {isBig ? (
          <div className="flex items-center gap-1.5 px-3 py-2 min-h-[38px] border-b border-white/25 text-white">
            <CalendarDays className="w-3.5 h-3.5 flex-shrink-0" />
            <p className="text-[13px] font-semibold flex-1 truncate">{t('倒计时')}</p>
            {upcoming.length > 0 && (
              <span className="text-[10px] font-medium bg-white/20 text-white px-1.5 py-0.5 rounded-full flex-shrink-0">{upcoming.length}</span>
            )}
            <button onClick={(e) => { e.stopPropagation(); setShowFullModal(true) }} title={t('查看全部')}
              className="w-5 h-5 rounded-md hover:bg-white/20 flex items-center justify-center flex-shrink-0">
              <Maximize2 className="w-3 h-3" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); openAdd() }} title={t('添加事项')}
              className="w-5 h-5 rounded-md hover:bg-white/20 flex items-center justify-center flex-shrink-0">
              <Plus className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="relative flex items-center justify-center px-2 py-2 min-h-[38px] border-b border-white/25 text-white">
            <p className="text-[13px] font-semibold truncate text-center w-full px-4">
              {nearest ? t('{title}还有', { title: nearest.ev.title }) : t('倒计时')}
            </p>
            <Maximize2 className="w-3 h-3 absolute right-1.5 opacity-70 flex-shrink-0" />
          </div>
        )}
        {/* 主体：多卡=全部事项列表（溢出滚动）；单卡=最近事项大数字 */}
        {isBig ? (
          <div className="flex-1 min-h-0 overflow-y-auto text-white [&::-webkit-scrollbar]:hidden px-1.5 py-1 space-y-0.5">
            {upcoming.length === 0 ? (
              <button onClick={(e) => { e.stopPropagation(); openAdd() }}
                className="w-full h-full min-h-[60px] flex flex-col items-center justify-center gap-1 text-white/55 hover:text-white transition-colors">
                <Plus className="w-5 h-5" />
                <span className="text-[10px]">{t('添加事项')}</span>
              </button>
            ) : upcoming.map(({ ev, occ }) => (
              <div key={ev.id} onClick={(e) => { e.stopPropagation(); openEdit(ev) }}
                className="group/row flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-white/12 transition-colors cursor-pointer">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{ev.title}</p>
                  <p className="text-[10px] text-white/70 truncate">
                    {ev.cal === 'lunar' && t('农历 ')}{eventDateLabel(ev, occ.date)}
                    {repeatTag(ev.repeat) && <span className="ml-1 text-white/90">{t(repeatTag(ev.repeat))}</span>}
                  </p>
                </div>
                <div className="text-right flex-shrink-0 flex items-baseline">
                  <span className={`font-bold text-white leading-none ${occ.days === 0 ? 'text-sm' : 'text-lg'}`}>
                    {occ.days === 0 ? t('今天') : occ.days}
                  </span>
                  {occ.days !== 0 && <span className="text-[9px] text-white/70 ml-0.5">{t('天')}</span>}
                </div>
                <button onClick={(e) => { e.stopPropagation(); removeEvent(ev.id) }} title={t('删除事项')}
                  className="opacity-0 group-hover/row:opacity-100 w-5 h-5 rounded-md bg-white/15 border border-white/25 text-white/75 hover:text-white hover:bg-white/25 hover:border-white/45 flex items-center justify-center flex-shrink-0 transition-all">
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex items-center justify-center text-white">
            {nearest ? (
              <span className={`font-bold text-white leading-none ${nearest.occ.days === 0 ? 'text-2xl' : nearest.occ.days > 99 ? 'text-2xl' : 'text-4xl'}`}>
                {nearest.occ.days === 0 ? t('今天') : nearest.occ.days}
              </span>
            ) : (
              <button onClick={(e) => { e.stopPropagation(); openAdd() }}
                className="flex flex-col items-center gap-1 text-white/55 hover:text-white transition-colors">
                <Plus className="w-5 h-5" />
                <span className="text-[10px]">{t('添加事项')}</span>
              </button>
            )}
          </div>
        )}
      </div>
      {showEventModal && (
        <CountdownEventModal initial={editingEvent}
          onClose={() => { setShowEventModal(false); setEditingEvent(null) }}
          onSubmit={saveEvent} />
      )}
      {showFullModal && (
        <CountdownFullModal widget={widget} onClose={() => setShowFullModal(false)}
          onAdd={openAdd} onEdit={openEdit} onRemoveEvent={removeEvent} />
      )}
    </div>
  )
}

// ---------- 放大弹窗：查看 / 管理全部事项 ----------

/** 不重复已过期事项的原始日期（用于弹窗展示） */
function eventStaticDate(ev: CountdownEvent): Date | null {
  if (ev.cal === 'solar' && ev.date) {
    const [y, m, d] = ev.date.split('-').map(Number)
    if (y && m && d) return new Date(y, m - 1, d)
  }
  if (ev.cal === 'lunar' && ev.lYear && ev.lMonth && ev.lDay) {
    const r: any = solarLunar.lunar2solar(ev.lYear, ev.lMonth, ev.lDay, !!ev.lLeap)
    if (r && r !== -1) return new Date(r.cYear, r.cMonth - 1, r.cDay)
  }
  return null
}

export function CountdownFullModal({ widget, onClose, onAdd, onEdit, onRemoveEvent }: {
  widget: CountdownWidgetData
  onClose: () => void
  onAdd: () => void
  onEdit: (ev: CountdownEvent) => void
  onRemoveEvent: (id: string) => void
}) {
  const t = useT()
  const todayKey = new Date().toDateString()
  const rows = useMemo(() => {
    return (widget.events || [])
      .map(ev => ({ ev, occ: nextOccurrence(ev) }))
      .sort((a, b) => (a.occ?.days ?? 99999) - (b.occ?.days ?? 99999))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.events, todayKey])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-blue-500" /> {t('倒计时')}
            {rows.length > 0 && <span className="text-xs font-medium text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">{rows.length}</span>}
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={onAdd} title={t('添加事项')}
              className="w-8 h-8 rounded-xl bg-blue-500 text-white hover:bg-blue-600 flex items-center justify-center">
              <Plus className="w-4 h-4" />
            </button>
            <button onClick={onClose} title={t('关闭')}
              className="w-8 h-8 rounded-xl text-gray-400 hover:bg-black/5 flex items-center justify-center">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* 全部事项列表（垂直滚动，含已过期） */}
        <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden space-y-1">
          {rows.length === 0 ? (
            <div className="py-10 flex flex-col items-center gap-2 text-gray-300">
              <CalendarDays className="w-8 h-8" />
              <button onClick={onAdd} className="text-xs text-blue-400 hover:text-blue-500">{t('添加事项')}</button>
            </div>
          ) : rows.map(({ ev, occ }) => {
            const labelDate = occ ? occ.date : eventStaticDate(ev)
            return (
              <div key={ev.id} onClick={() => onEdit(ev)}
                className="group/row flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-blue-50/70 transition-colors cursor-pointer">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate">{ev.title}</p>
                  <p className="text-[11px] text-gray-400 truncate mt-0.5">
                    {ev.cal === 'lunar' && t('农历 ')}{labelDate && eventDateLabel(ev, labelDate)}
                    {repeatTag(ev.repeat) && <span className="ml-1.5 text-blue-400">{t(repeatTag(ev.repeat))}</span>}
                    {!occ && <span className="ml-1.5 text-gray-300">{t('已过期')}</span>}
                  </p>
                </div>
                <div className="text-right flex-shrink-0 flex items-baseline">
                  {occ ? (
                    <>
                      <span className={`font-bold text-blue-500 leading-none ${occ.days === 0 ? 'text-base' : 'text-xl'}`}>
                        {occ.days === 0 ? t('今天') : occ.days}
                      </span>
                      {occ.days !== 0 && <span className="text-[10px] text-gray-400 ml-0.5">{t('天')}</span>}
                    </>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </div>
                <button onClick={(e) => { e.stopPropagation(); onRemoveEvent(ev.id) }} title={t('删除事项')}
                  className="opacity-0 group-hover/row:opacity-100 w-6 h-6 rounded-lg bg-white border border-gray-200 text-gray-300 hover:text-red-500 hover:border-red-200 flex items-center justify-center flex-shrink-0 transition-all">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )
          })}
        </div>
        <p className="text-[10px] text-gray-300 mt-3 text-center">{t('点击事项可编辑')}</p>
      </div>
    </div>,
    document.body
  )
}

// ---------- 事项编辑弹窗 ----------

const CN_MONTHS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月']

export function CountdownEventModal({ initial, onClose, onSubmit }: {
  initial?: CountdownEvent | null
  onClose: () => void
  onSubmit: (ev: CountdownEvent) => void
}) {
  const t = useT()
  const now = new Date()
  const todayLunar: any = solarLunar.solar2lunar(now.getFullYear(), now.getMonth() + 1, now.getDate())
  const [title, setTitle] = useState(initial?.title || '')
  const [cal, setCal] = useState<CalType>(initial?.cal || 'solar')
  const [repeat, setRepeat] = useState<RepeatMode>(initial?.repeat || 'none')
  const [date, setDate] = useState(initial?.date || toLocalISO(now))
  const [lYear, setLYear] = useState(initial?.lYear || todayLunar?.lYear || now.getFullYear())
  const [lMonth, setLMonth] = useState(initial?.lMonth || 1)
  const [lLeap, setLLeap] = useState(!!initial?.lLeap)
  const [lDay, setLDay] = useState(initial?.lDay || 1)
  const [error, setError] = useState('')

  const leapMonth = solarLunar.leapMonth(lYear)
  const daysInLunarMonth = lLeap
    ? (leapMonth === lMonth ? solarLunar.leapDays(lYear) : 0)
    : solarLunar.monthDays(lYear, lMonth)
  const yearOptions = useMemo(() => {
    const arr: number[] = []
    // 支持选择过去的日期（如生日）：往前 100 年，往后 60 年
    const base = todayLunar?.lYear || now.getFullYear()
    for (let y = base - 100; y <= base + 60; y++) arr.push(y)
    return arr
  }, [])

  const pickCal = (c: CalType) => {
    setCal(c)
    // 农历没有"每周"的概念
    if (c === 'lunar' && repeat === 'week') setRepeat('none')
  }

  const submit = () => {
    if (!title.trim()) { setError(t('请输入事项名称')); return }
    if (cal === 'solar' && !date) { setError(t('请选择日期')); return }
    if (cal === 'lunar' && (!lMonth || !lDay || (lLeap && leapMonth !== lMonth))) { setError(t('请选择有效的农历日期')); return }
    onSubmit({
      id: initial?.id || `ce-${Date.now()}`,
      title: title.trim(),
      cal,
      repeat,
      ...(cal === 'solar'
        ? { date }
        : { lYear, lMonth, lDay, lLeap: lLeap && leapMonth === lMonth }),
    })
  }

  const segBtn = (active: boolean) =>
    `flex-1 h-8 rounded-lg text-xs transition-all ${active ? 'bg-blue-500 text-white font-medium shadow-sm' : 'text-gray-500 hover:bg-black/5'}`

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4"
        onKeyDown={e => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON' && (e.target as HTMLElement).tagName !== 'SELECT') { e.preventDefault(); submit() } }}>
        <h3 className="font-bold text-gray-800 mb-4">{t('倒计时事项')}</h3>
        <input type="text" value={title} onChange={e => { setTitle(e.target.value); setError('') }}
          placeholder={t('事项名称，如：发工资')} autoFocus
          className="w-full h-11 px-4 mb-3 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm" />
        {/* 日历类型 */}
        <div className="flex gap-1 p-1 bg-black/[0.04] rounded-xl mb-2">
          <button onClick={() => pickCal('solar')} className={segBtn(cal === 'solar')}>{t('公历')}</button>
          <button onClick={() => pickCal('lunar')} className={segBtn(cal === 'lunar')}>{t('农历')}</button>
        </div>
        {/* 日期输入 */}
        {cal === 'solar' ? (
          <input type="date" value={date} onChange={e => { setDate(e.target.value); setError('') }}
            className="w-full h-11 px-4 mb-2 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm" />
        ) : (
          <div className="mb-2 space-y-2">
            <select value={lYear} onChange={e => setLYear(Number(e.target.value))}
              className="w-full h-10 px-3 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm">
              {yearOptions.map(y => (
                <option key={y} value={y}>{t('{y}年{a}年', { y, a: t(solarLunar.getAnimal(y)) })}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <select value={lLeap ? `L${lMonth}` : String(lMonth)}
                onChange={e => { const v = e.target.value; if (v.startsWith('L')) { setLLeap(true); setLMonth(Number(v.slice(1))) } else { setLLeap(false); setLMonth(Number(v)) }; setError('') }}
                className="flex-1 h-10 px-3 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <React.Fragment key={m}>
                    <option value={String(m)}>{t(CN_MONTHS[m - 1])}</option>
                    {leapMonth === m && <option value={`L${m}`}>{t('闰{m}', { m: t(CN_MONTHS[m - 1]) })}</option>}
                  </React.Fragment>
                ))}
              </select>
              <select value={lDay} onChange={e => { setLDay(Number(e.target.value)); setError('') }}
                className="flex-1 h-10 px-3 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 text-sm">
                {Array.from({ length: daysInLunarMonth || 30 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={d}>{t(solarLunar.toChinaDay(d))}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        {/* 重复 */}
        <div className="flex gap-1 p-1 bg-black/[0.04] rounded-xl mb-3">
          {(['none', 'week', 'month', 'year'] as RepeatMode[])
            .filter(r => !(cal === 'lunar' && r === 'week'))
            .map(r => (
              <button key={r} onClick={() => setRepeat(r)} className={segBtn(repeat === r)}>
                {r === 'none' ? t('不重复') : r === 'week' ? t('每周') : r === 'month' ? t('每月') : t('每年')}
              </button>
            ))}
        </div>
        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-11 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200">{t('取消')}</button>
          <button onClick={submit} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600">{t('确定')}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
