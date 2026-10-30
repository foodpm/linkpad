import { useEffect, useRef, useState } from 'react'
import { Search, X, HardDrive } from 'lucide-react'
import { useT } from '../i18n'

// 渠道 favicon：复用项目 favicon 缓存接口（R2 全局缓存，高清原图）
const siteIconUrl = (domain: string) => `/api/favicon-img/${[...domain].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}.png`

export interface SearchChannel {
  key: string
  name: string
  domain?: string
  color?: string
  local?: boolean
  url?: (q: string) => string
}

// 搜索渠道：本地 + 主流搜索引擎/站内搜索
export const SEARCH_CHANNELS: SearchChannel[] = [
  { key: 'local', name: '本地', local: true, color: '#3b82f6' },
  { key: 'baidu', name: '百度', domain: 'baidu.com', url: q => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}` },
  { key: 'google', name: 'Google', domain: 'google.com', url: q => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  { key: 'bing', name: '必应', domain: 'bing.com', url: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  { key: 'douyin', name: '抖音', domain: 'douyin.com', url: q => `https://www.douyin.com/search/${encodeURIComponent(q)}` },
  { key: 'zhihu', name: '知乎', domain: 'zhihu.com', url: q => `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(q)}` },
  { key: 'github', name: 'GitHub', domain: 'github.com', url: q => `https://github.com/search?q=${encodeURIComponent(q)}` },
  { key: 'bilibili', name: 'B站', domain: 'bilibili.com', url: q => `https://search.bilibili.com/all?keyword=${encodeURIComponent(q)}` },
]

// 渠道图标：favicon 加载失败回退品牌色字母块
function ChanIcon({ ch, size }: { ch: SearchChannel; size: string }) {
  const [failed, setFailed] = useState(false)
  if (ch.local) {
    return (
      <span className={`${size} rounded-lg flex items-center justify-center shrink-0`} style={{ background: `${ch.color}18` }}>
        <HardDrive className="w-3.5 h-3.5" style={{ color: ch.color }} />
      </span>
    )
  }
  if (failed || !ch.domain) {
    return (
      <span className={`${size} rounded-lg flex items-center justify-center text-white text-[10px] font-bold shrink-0`} style={{ background: ch.color || '#64748b' }}>
        {ch.name.charAt(0)}
      </span>
    )
  }
  return <img src={siteIconUrl(ch.domain)} onError={() => setFailed(true)} alt={ch.name} className={`${size} rounded-lg object-contain bg-white shrink-0`} />
}

// 实心三角形下拉箭头（▼，展开时翻转）
function Caret({ open }: { open: boolean }) {
  return (
    <span className={`inline-block w-0 h-0 border-l-[4px] border-r-[4px] border-t-[5px] border-l-transparent border-r-transparent border-t-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
  )
}

// ---------- 搜索框组件：左侧渠道图标下拉选择（单行渠道面板），独立占一个区域，右键删除 ----------

interface Props {
  channel: string
  onChannelChange: (key: string) => void
  value: string
  onChange: (v: string) => void
}

export function SearchWidgetCard({ channel, onChannelChange, value, onChange }: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const cur = SEARCH_CHANNELS.find(c => c.key === channel) || SEARCH_CHANNELS[1]

  // 点击外部/Escape 关闭下拉
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [open])

  const submit = () => {
    if (!value.trim() || cur.local || !cur.url) return
    window.open(cur.url(value.trim()), '_blank', 'noopener,noreferrer')
  }

  return (
    <div ref={wrapRef} data-widget-card className="relative select-none py-2 max-w-2xl mx-auto">
      <div className="relative flex items-center w-full">
        {/* 渠道选择按钮：当前渠道图标 + 实心三角箭头 */}
        <button onClick={() => setOpen(o => !o)} title={t('切换搜索渠道')}
          className="absolute left-5 z-10 flex items-center gap-1.5 cursor-pointer outline-none">
          <ChanIcon ch={cur} size="w-8 h-8 border border-black/5 shadow-sm" />
          <Caret open={open} />
        </button>
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder={cur.local ? t('搜索本地工具...') : t('搜索网络内容...')}
          className="block w-full h-14 sm:h-16 pl-[88px] pr-[72px] bg-white/50 backdrop-blur-md border border-white/60 rounded-full focus:outline-none focus:bg-white/80 focus-visible:border-blue-400/70 focus-visible:ring-2 focus-visible:ring-[#3050F0]/25 focus:shadow-[0_10px_32px_rgba(0,0,0,0.16)] transition-all text-base sm:text-lg placeholder-gray-400 text-gray-800 shadow-sm" />
        {!value ? (
          <button onClick={submit} title={t('搜索')}
            className="absolute right-0 inset-y-0 flex items-center pr-8 text-gray-400 hover:text-gray-600 transition-colors">
            <Search className="w-5 h-5" />
          </button>
        ) : (
          <button onClick={() => onChange('')} title={t('清除')}
            className="absolute right-0 inset-y-0 flex items-center pr-[30px] text-gray-400 hover:text-gray-600 transition-colors">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 渠道下拉面板：单行紧凑靠左（图标略大、无选中态，右侧留空没关系） */}
      {open && (
        <div className="absolute top-full mt-1.5 z-30 bg-white border border-gray-200/60 shadow-xl rounded-2xl px-2 py-2 flex items-center gap-1 overflow-x-auto left-0 right-0">
          {SEARCH_CHANNELS.map(c => (
            <button key={c.key} onClick={() => { onChannelChange(c.key); setOpen(false) }}
              className="flex flex-col items-center gap-1.5 px-2 py-2 rounded-xl transition-all shrink-0 hover:bg-black/5">
              <ChanIcon ch={c} size="w-10 h-10 border border-black/5 shadow-sm" />
              <span className="text-[11px] leading-none text-gray-600">{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
