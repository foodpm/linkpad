// 仿真鱼缸组件：固定 3 卡高度（1 列宽 × 3 行），支持换缸 / 加鱼 / 喂食
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Cookie, Fish, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useT } from '../../i18n'
import {
  SPECIES, TANK_STYLE_ORDER, drawFishPreview,
  MAX_FISH, type FishSpecies, type TankStyle,
} from './fishtankEngine'
import { FishTankEngine } from './fishtank3dEngine'

export interface FishTankFish {
  id: string
  species: FishSpecies
  size?: number
}

export interface FishTankWidgetData {
  id: string
  type: 'fishtank'
  name?: string
  category_id?: string
  /** 固定 3（1 列宽 × 3 行），不可调整 */
  height?: number
  inFrequent?: boolean
  tankStyle?: TankStyle
  fish?: FishTankFish[]
  /** 上次喂食时间戳，驱动饥饿度 */
  lastFed?: number
}

const SPECIES_LIST: FishSpecies[] = ['koi', 'goldfish', 'guppy', 'angelfish', 'zebrafish', 'betta', 'clownfish', 'neon']
const SPECIES_NAMES: Record<FishSpecies, string> = {
  koi: '锦鲤', goldfish: '金鱼', guppy: '孔雀鱼', angelfish: '神仙鱼',
  zebrafish: '斑马鱼', betta: '斗鱼', clownfish: '小丑鱼', neon: '霓虹灯鱼',
}

interface CardProps {
  widget: FishTankWidgetData
  onUpdate: (patch: Partial<FishTankWidgetData>) => void
  onRemove: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

export function FishTankWidgetCard({ widget, onUpdate, onRemove, onContextMenu }: CardProps) {
  const t = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<FishTankEngine | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const fish = widget.fish || []
  const style: TankStyle = widget.tankStyle || 'classic'

  // 引擎生命周期：只创建一次，后续状态经 setter 同步
  useEffect(() => {
    if (!containerRef.current) return
    const eng = new FishTankEngine(containerRef.current, widget.tankStyle || 'classic', widget.fish || [], widget.lastFed || 0)
    engineRef.current = eng
    return () => { eng.destroy(); engineRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { engineRef.current?.setFish(widget.fish || []) }, [widget.fish])
  useEffect(() => { engineRef.current?.setStyle(widget.tankStyle || 'classic') }, [widget.tankStyle])
  useEffect(() => { engineRef.current?.setLastFed(widget.lastFed || 0) }, [widget.lastFed])

  const dropFood = (x?: number) => {
    engineRef.current?.feed(x)
    onUpdate({ lastFed: Date.now() })
  }

  const cycleTank = () => {
    const i = TANK_STYLE_ORDER.indexOf(style)
    onUpdate({ tankStyle: TANK_STYLE_ORDER[(i + 1) % TANK_STYLE_ORDER.length] })
  }

  const addFish = (species: FishSpecies) => {
    if (fish.length >= MAX_FISH) return
    onUpdate({
      fish: [...fish, {
        id: `fk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        species,
        size: 0.85 + Math.random() * 0.3,
      }],
    })
  }

  const removeFish = (id: string) => onUpdate({ fish: fish.filter(f => f.id !== id) })

  const iconBtn = 'w-5 h-5 rounded-md hover:bg-white/20 flex items-center justify-center flex-shrink-0'

  return (
    <div className="relative group h-full min-h-0">
      {/* 删除组件按钮 */}
      <button onClick={onRemove} title={t('移除组件')}
        className="absolute -top-1.5 -right-1.5 z-30 w-5 h-5 rounded-full bg-red-400 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500">
        <X className="w-3 h-3" />
      </button>
      <div data-widget-card onContextMenu={onContextMenu}
        className="h-full flex flex-col rounded-2xl overflow-hidden ring-1 ring-black/[0.04] shadow-sm hover:shadow-md transition-all select-none">
        {/* 头部（磨砂材质，透出壁纸） */}
        <div className="bg-gradient-to-b from-cyan-400/80 to-cyan-600/70 backdrop-blur-xl text-white flex-shrink-0 flex items-center gap-1.5 px-3 py-2 min-h-[38px]">
          <Fish className="w-3.5 h-3.5 flex-shrink-0" />
          <p className="text-[13px] font-semibold flex-1 truncate">{t('仿真鱼缸')}</p>
          <span className="text-[10px] font-medium bg-white/20 px-1.5 py-0.5 rounded-full flex-shrink-0">{fish.length}/{MAX_FISH}</span>
          <button onClick={(e) => { e.stopPropagation(); cycleTank() }} title={t('换鱼缸')} className={iconBtn}>
            <RefreshCw className="w-3 h-3" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); setShowAddModal(true) }} title={t('添加鱼')} className={iconBtn}>
            <Plus className="w-3 h-3" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); dropFood() }} title={t('喂食')} className={iconBtn}>
            <Cookie className="w-3 h-3" />
          </button>
        </div>
        {/* 鱼缸主体（点击投食） */}
        <div className="flex-1 min-h-0 relative bg-white">
          <div className="absolute inset-0 bg-cyan-900/10 pointer-events-none" />
          <div ref={containerRef} title={t('轻点水面投食')}
            className="absolute inset-0 w-full h-full cursor-pointer overflow-hidden"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              dropFood(e.clientX - r.left)
            }} />
          {fish.length === 0 && (
            <button onClick={(e) => { e.stopPropagation(); setShowAddModal(true) }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-white/90 hover:text-white transition-colors">
              <Fish className="w-6 h-6 drop-shadow" />
              <span className="text-[11px] font-medium drop-shadow">{t('点击添加鱼')}</span>
            </button>
          )}
        </div>
      </div>
      {showAddModal && (
        <AddFishModal fish={fish} onAdd={addFish} onRemove={removeFish} onClose={() => setShowAddModal(false)} />
      )}
    </div>
  )
}

// ---------- 加鱼弹窗：物种选择 + 已养列表 ----------

function AddFishModal({ fish, onAdd, onRemove, onClose }: {
  fish: FishTankFish[]
  onAdd: (species: FishSpecies) => void
  onRemove: (id: string) => void
  onClose: () => void
}) {
  const t = useT()
  const full = fish.length >= MAX_FISH
  const previewRefs = useRef<(HTMLCanvasElement | null)[]>([])

  // 预览小动画：一个 rAF 驱动所有物种预览
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop)
      const time = (ts - start) / 1000
      for (let i = 0; i < SPECIES_LIST.length; i++) {
        const cv = previewRefs.current[i]
        if (cv) drawFishPreview(cv, SPECIES_LIST[i], time)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Fish className="w-5 h-5 text-cyan-500" /> {t('添加鱼')}
            <span className="text-xs font-medium text-cyan-600 bg-cyan-50 px-2 py-0.5 rounded-full">{fish.length}/{MAX_FISH}</span>
          </h3>
          <button onClick={onClose} title={t('关闭')}
            className="w-8 h-8 rounded-xl text-gray-400 hover:bg-black/5 flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* 物种网格 */}
        <div className="grid grid-cols-4 gap-2">
          {SPECIES_LIST.map((sp, i) => (
            <button key={sp} disabled={full} onClick={() => onAdd(sp)}
              title={t(SPECIES_NAMES[sp])}
              className={`flex flex-col items-center gap-0.5 p-2 rounded-2xl transition-all ${full
                ? 'opacity-40 cursor-not-allowed bg-black/[0.03]'
                : 'bg-white/70 ring-1 ring-black/[0.05] hover:ring-cyan-300 hover:bg-cyan-50/70'}`}>
              <canvas ref={el => { previewRefs.current[i] = el }} className="w-[72px] h-[48px]" />
              <span className="text-[10px] text-gray-600 truncate w-full text-center">{t(SPECIES_NAMES[sp])}</span>
            </button>
          ))}
        </div>
        {full && <p className="text-[11px] text-amber-500 mt-2 text-center">{t('鱼缸已满（最多 {n} 条）', { n: MAX_FISH })}</p>}
        {/* 已养的鱼 */}
        {fish.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] text-gray-400 mb-1.5">{t('已养')}</p>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto [&::-webkit-scrollbar]:hidden">
              {fish.map(f => (
                <span key={f.id}
                  className="group/chip inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-full bg-cyan-50 text-cyan-700 text-[11px] font-medium">
                  {t(SPECIES_NAMES[f.species])}
                  <button onClick={() => onRemove(f.id)} title={t('移除这条鱼')}
                    className="w-4 h-4 rounded-full flex items-center justify-center text-cyan-400 hover:text-white hover:bg-red-400 transition-colors">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        <p className="text-[10px] text-gray-300 mt-4 text-center">{t('轻点水面投食')}</p>
      </div>
    </div>,
    document.body
  )
}
