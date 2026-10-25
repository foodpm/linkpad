import { useEffect, useState } from 'react'
import { openLinkUrl } from '../api'
import { ExternalLink, Link2Off, Trash2 } from 'lucide-react'
import { useT } from '../i18n'

interface DeadLink {
  id: string
  name: string
  url: string
  http_status: number
}

interface Props {
  open: boolean
  links: DeadLink[]
  busy: boolean
  onClose: () => void
  onRemove: (ids: string[]) => void
}

/** 失效链接弹窗：勾选后一键移除（首页 / 仓库页共用） */
export default function DeadLinksModal({ open, links, busy, onClose, onRemove }: Props) {
  const t = useT()
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => { if (open) setSelected(new Set()) }, [open, links])

  if (!open || links.length === 0) return null

  const allChecked = selected.size === links.length
  const toggle = (id: string) => setSelected(prev => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(links.map(l => l.id)))

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center gap-2 mb-1">
          <Link2Off className="w-5 h-5 text-red-500 flex-shrink-0" />
          <h3 className="font-bold text-gray-800">{t('检测到 {n} 个失效链接', { n: links.length })}</h3>
        </div>
        <p className="text-xs text-gray-400 mb-3">{t('这些链接已无法访问，可勾选后一键移除')}</p>
        <label className="flex items-center gap-2 mb-2 cursor-pointer w-fit">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} className="w-3.5 h-3.5 accent-blue-500" />
          <span className="text-xs text-gray-500">{t('全选')}</span>
        </label>
        <div className="flex-1 overflow-y-auto space-y-2 mb-4 -mx-1 px-1 [&::-webkit-scrollbar]:hidden">
          {links.map(l => (
            <label key={l.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-white/60 border border-white/80 cursor-pointer hover:bg-white/90">
              <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} className="w-4 h-4 accent-blue-500 flex-shrink-0" />
              {/* 点击名称/地址在新标签页打开链接目标页面；stopPropagation 避免触发勾选 */}
              <a href={l.url} target="_blank" rel="noopener noreferrer" onClick={e => { e.stopPropagation(); if (/\/api\/pdfs\/[0-9a-f-]{36}/.test(l.url || '')) { e.preventDefault(); openLinkUrl(l.url) } }} className="flex-1 min-w-0 group">
                <div className="text-sm text-gray-800 truncate group-hover:text-blue-600 transition-colors" title={l.name}>{l.name}</div>
                <div className="flex items-center gap-1 text-xs text-gray-400 group-hover:text-blue-500 transition-colors">
                  <span className="truncate" title={l.url}>{l.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                  <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </div>
              </a>
              <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded flex-shrink-0">
                {`HTTP ${l.http_status}`}
              </span>
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-11 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200">{t('暂不处理')}</button>
          <button disabled={busy || selected.size === 0} onClick={() => onRemove([...selected])}
            className="flex-1 h-11 rounded-2xl bg-red-500 text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5">
            <Trash2 className="w-4 h-4" />{busy ? t('移除中...') : t('移除所选 ({n})', { n: selected.size })}
          </button>
        </div>
      </div>
    </div>
  )
}
