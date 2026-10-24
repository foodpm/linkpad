import { X, Palette, Check } from 'lucide-react'
import { useState } from 'react'
import { useT } from '../i18n'

// 界面字体选项（自托管 Google 变量字体 latin 子集，@font-face 见 index.css；family 为空 = 默认系统字体栈）
export const UI_FONTS: { id: string; label: string; family: string }[] = [
  { id: '', label: '默认', family: '' },
  { id: 'open-sans', label: 'Open Sans', family: 'Open Sans' },
  { id: 'geist', label: 'Geist', family: 'Geist' },
  { id: 'jetbrains-mono', label: 'JetBrains Mono', family: 'JetBrains Mono' },
  { id: 'bricolage', label: 'Bricolage Grotesque', family: 'Bricolage Grotesque' },
  { id: 'unbounded', label: 'Unbounded', family: 'Unbounded' },
  { id: 'bitcount', label: 'Bitcount', family: 'Bitcount' },
]

// 预览用真实站点图标：走自家 favicon 缓存接口（key = 域名逐字符 hex + @2 版本，与 Worker domainKey/FAVICON_VERSION 一致）
const siteIconUrl = (domain: string) => `/api/favicon-img/${[...domain].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}@2.png`

function SiteIcon({ domain, letter, className }: { domain: string; letter: string; className: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className={`${className} flex items-center justify-center bg-[#2932E1]`}>
        <span className="text-white text-xs font-bold">{letter}</span>
      </div>
    )
  }
  return <img src={siteIconUrl(domain)} onError={() => setFailed(true)} alt={domain} className={className} />
}

interface Props {
  onClose: () => void
  sidebarCollapsed: boolean
  onToggleSidebar: (v: boolean) => void
  freqRows: number
  onSetFreqRows: (n: number) => void
  cardStyle: 'standard' | 'minimal'
  onSetCardStyle: (v: 'standard' | 'minimal') => void
  stickyTop: boolean
  onToggleStickyTop: (v: boolean) => void
  crtEffect: boolean
  onToggleCrtEffect: (v: boolean) => void
  uiFont: string
  onSetUiFont: (id: string) => void
}

export default function PanelStyleModal({ onClose, sidebarCollapsed, onToggleSidebar, freqRows, onSetFreqRows, cardStyle, onSetCardStyle, stickyTop, onToggleStickyTop, crtEffect, onToggleCrtEffect, uiFont, onSetUiFont }: Props) {
  const t = useT()

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-md bg-white rounded-3xl border border-white/60 shadow-xl p-6 max-h-[85vh] overflow-y-auto [&::-webkit-scrollbar]:hidden"
        onClick={e => e.stopPropagation()}>
        <button onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-black/5 transition-all">
          <X className="w-4 h-4" />
        </button>
        <h3 className="font-bold text-gray-800 mb-5 flex items-center gap-2">
          <Palette className="w-5 h-5" />{t('面板样式')}
        </h3>
        <div className="space-y-5">
          {/* 滚动设置：勾选=时间/搜索框 sticky 置顶；不勾=随其他卡片一起滚动 */}
          <label className="flex items-center justify-between cursor-pointer select-none">
            <span className="text-sm text-gray-700">{t('滚动时固定时间/搜索框')}</span>
            <input type="checkbox" checked={stickyTop} onChange={e => onToggleStickyTop(e.target.checked)}
              className="w-4 h-4 accent-blue-500 cursor-pointer" />
          </label>
          <label className="flex items-center justify-between cursor-pointer select-none">
            <span className="text-sm text-gray-700">{t('展开侧边栏')}</span>
            <input type="checkbox" checked={!sidebarCollapsed} onChange={e => onToggleSidebar(!e.target.checked)}
              className="w-4 h-4 accent-blue-500 cursor-pointer" />
          </label>
          {/* CRT 壁纸效果：默认关闭，开启后壁纸呈现扫描线/暗角/闪烁的老式显示器质感 */}
          <label className="flex items-center justify-between cursor-pointer select-none">
            <span className="text-sm text-gray-700">{t('CRT 壁纸效果')}</span>
            <input type="checkbox" checked={crtEffect} onChange={e => onToggleCrtEffect(e.target.checked)}
              className="w-4 h-4 accent-blue-500 cursor-pointer" />
          </label>
          {/* 常用工具行数：仅允许 3 的倍数 */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">{t('常用工具行数')}</span>
            <div className="flex items-center gap-1">
              {[3, 6, 9, 12].map(n => (
                <button key={n} onClick={() => onSetFreqRows(n)}
                  className={`w-9 h-7 rounded-lg text-xs transition-all ${freqRows === n ? 'bg-blue-500 text-white font-medium' : 'bg-white/60 text-gray-600 hover:bg-white/90'}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          {/* 卡片展示样式：带可视化预览 */}
          <div>
            <div className="text-sm text-gray-700 mb-2">{t('卡片展示')}</div>
            <div className="grid grid-cols-2 gap-3">
              {/* 标准模式：icon + 名称 + 描述 */}
              <button onClick={() => onSetCardStyle('standard')}
                className={`relative rounded-2xl p-2 transition-all text-left ${cardStyle === 'standard' ? 'ring-2 ring-blue-500 bg-blue-50/50' : 'ring-1 ring-black/5 hover:ring-blue-300 bg-white/60'}`}>
                {cardStyle === 'standard' && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center shadow-md z-10">
                    <Check className="w-3 h-3 text-white" />
                  </span>
                )}
                <div className="h-20 rounded-xl bg-white border border-black/5 shadow-sm p-2.5 flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-white border border-gray-200 overflow-hidden">
                    <SiteIcon domain="baidu.com" letter="百" className="w-full h-full object-contain p-1" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-gray-800 truncate">百度</div>
                    <div className="text-[10px] text-gray-400 truncate mt-0.5">百度一下，你就知道</div>
                  </div>
                </div>
                <div className="mt-2 px-1">
                  <div className="text-xs font-medium text-gray-800">{t('标准模式')}</div>
                  <div className="text-[10px] text-gray-400">{t('图标 + 名称 + 描述')}</div>
                </div>
              </button>
              {/* 极简模式：仅圆角图标 */}
              <button onClick={() => onSetCardStyle('minimal')}
                className={`relative rounded-2xl p-2 transition-all text-left ${cardStyle === 'minimal' ? 'ring-2 ring-blue-500 bg-blue-50/50' : 'ring-1 ring-black/5 hover:ring-blue-300 bg-white/60'}`}>
                {cardStyle === 'minimal' && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center shadow-md z-10">
                    <Check className="w-3 h-3 text-white" />
                  </span>
                )}
                <div className="h-20 rounded-xl bg-white border border-black/5 shadow-sm p-2 flex items-center justify-center gap-1.5">
                  <div className="w-12 h-12 rounded-lg bg-white border border-gray-200 overflow-hidden flex-shrink-0">
                    <SiteIcon domain="baidu.com" letter="百" className="w-full h-full object-contain p-1.5" />
                  </div>
                  <div className="w-12 h-12 rounded-lg bg-white border border-gray-200 overflow-hidden flex-shrink-0">
                    <SiteIcon domain="github.com" letter="G" className="w-full h-full object-contain p-1.5" />
                  </div>
                  <div className="w-12 h-12 rounded-lg bg-white border border-gray-200 overflow-hidden flex-shrink-0">
                    <SiteIcon domain="zhihu.com" letter="知" className="w-full h-full object-contain p-1.5" />
                  </div>
                </div>
                <div className="mt-2 px-1">
                  <div className="text-xs font-medium text-gray-800">{t('极简模式')}</div>
                  <div className="text-[10px] text-gray-400">{t('仅展示圆角图标')}</div>
                </div>
              </button>
            </div>
          </div>
          {/* 界面字体：每个选项用各自字体渲染预览（拉丁字符生效，中文回退系统字体） */}
          <div>
            <div className="text-sm text-gray-700 mb-2">{t('界面字体')}</div>
            <div className="grid grid-cols-2 gap-2">
              {UI_FONTS.map(f => (
                <button key={f.id || 'default'} onClick={() => onSetUiFont(f.id)}
                  style={f.family ? { fontFamily: `'${f.family}', sans-serif` } : undefined}
                  className={`relative h-10 px-3 rounded-xl text-sm truncate transition-all ${uiFont === f.id ? 'ring-2 ring-blue-500 bg-blue-50/50 text-blue-700 font-semibold' : 'bg-white/60 text-gray-600 hover:bg-white/90 ring-1 ring-black/5'}`}>
                  {uiFont === f.id && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center shadow-md z-10">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </span>
                  )}
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
