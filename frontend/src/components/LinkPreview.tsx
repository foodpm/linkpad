import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../i18n'

// 链接卡片悬停预览：模块级单例（与 Toast 同模式），所有页面共用一个弹出层
// 用法：卡片 onMouseEnter 调 scheduleLinkPreview(data, anchorEl)，onMouseLeave/onMouseDown/onClick 调 cancelLinkPreview()
// 页面根节点挂载一次 <LinkPreviewHost />
// 交互：弹簧缩放入场（从锚卡片方向长出）→ 流光渐变边框 + 截图高光扫过 → 内容错落浮现
//       鼠标移动时 3D 倾斜跟随；移开时缩放淡出退场

export interface LinkPreviewData {
  url: string
  name: string
  desc?: string // 创建卡片时填写的描述
  icon?: string // 图片图标 URL（文本图标不传）
}

type PreviewView = {
  data: LinkPreviewData
  rect: { left: number; top: number; right: number; bottom: number; width: number }
}

let hostSetter: ((v: PreviewView | null) => void) | null = null
let showTimer: ReturnType<typeof setTimeout> | null = null

// 悬停 300ms 防误触后弹出（触屏设备不启用）
export function scheduleLinkPreview(data: LinkPreviewData, anchor: HTMLElement) {
  if (typeof window === 'undefined' || !window.matchMedia('(hover: hover)').matches) return
  cancelLinkPreview()
  showTimer = setTimeout(() => {
    showTimer = null
    if (!anchor.isConnected) return
    const r = anchor.getBoundingClientRect()
    hostSetter?.({ data, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width } })
  }, 300)
}

export function cancelLinkPreview() {
  if (showTimer) {
    clearTimeout(showTimer)
    showTimer = null
  }
  hostSetter?.(null)
}

const POPUP_W = 340
const POPUP_GAP = 8
const EXIT_MS = 180

export default function LinkPreviewHost() {
  const t = useT()
  const [view, setView] = useState<PreviewView | null>(null)
  const [closing, setClosing] = useState(false)
  const [entered, setEntered] = useState(false) // 双 rAF 后置 true，触发弹簧入场过渡
  const [imgState, setImgState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const boxRef = useRef<HTMLDivElement | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    hostSetter = (v) => {
      if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
      if (v) {
        setClosing(false)
        setEntered(false)
        setImgState('loading')
        setPos(null)
        setTilt({ x: 0, y: 0 })
        setView(v)
        // 两帧后开启过渡，确保初始状态先完成绘制
        requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)))
      } else {
        setClosing(true)
        closeTimer.current = setTimeout(() => {
          closeTimer.current = null
          setView(null)
          setClosing(false)
        }, EXIT_MS)
      }
    }
    return () => { hostSetter = null }
  }, [])

  // 滚动 / 窗口尺寸变化 / 开始拖拽卡片时立即关闭（无退场动画，避免弹窗脱离锚点）
  useEffect(() => {
    if (!view) return
    const close = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }; setClosing(false); setView(null) }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    document.addEventListener('dragstart', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('dragstart', close)
    }
  }, [view])

  // 3D 倾斜：全局 mousemove，按光标相对弹窗中心的偏移轻微翻转（卡片朝向光标）
  useEffect(() => {
    if (!view || !pos || closing) return
    const onMove = (e: MouseEvent) => {
      const r = boxRef.current?.getBoundingClientRect()
      if (!r) return
      const cl = (v: number) => Math.max(-1.2, Math.min(1.2, v))
      const nx = cl((e.clientX - (r.left + r.width / 2)) / (r.width / 2))
      const ny = cl((e.clientY - (r.top + r.height / 2)) / (r.height / 2))
      setTilt({ x: ny * 4.5, y: -nx * 4.5 })
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [view, pos, closing])

  // 定位：优先显示在卡片下方，空间不足放上方，均不足则取空间大的一侧并收进视口
  useLayoutEffect(() => {
    if (!view || !boxRef.current) return
    const h = boxRef.current.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const { rect } = view
    const left = Math.min(Math.max(rect.left + rect.width / 2 - POPUP_W / 2, 8), Math.max(8, vw - POPUP_W - 8))
    const below = rect.bottom + POPUP_GAP
    const aboveY = rect.top - POPUP_GAP - h
    let top: number
    let isAbove = false
    if (below + h <= vh - 8) { top = below } else if (aboveY >= 8) { top = aboveY; isAbove = true } else { top = Math.max(8, Math.min(below, vh - h - 8)) }
    setPos({ left, top, above: isAbove })
  }, [view])

  // view 为 null（包括"未显示却收到关闭调用"的情况）一律渲染空样式壳，绝不能解构 view
  if (!view) {
    return (
      <style>{`
        @keyframes lp-shine { 0% { transform: translateX(-130%) skewX(-18deg) } 100% { transform: translateX(260%) skewX(-18deg) } }
        @keyframes lp-border { 0% { background-position: 0% 50% } 100% { background-position: 200% 50% } }
        @keyframes lp-rise { 0% { opacity: 0; transform: translateY(8px) } 100% { opacity: 1; transform: none } }
      `}</style>
    )
  }
  const { data } = view!
  let host = ''
  try {
    host = new URL(data.url).hostname.replace(/^www\./, '')
  } catch { /* ignore */ }

  // 小箭头水平位置：指向锚卡片中心，收进弹窗范围内
  const arrowLeft = pos ? Math.max(24, Math.min(POPUP_W - 24, view!.rect.left + view!.rect.width / 2 - pos.left)) : POPUP_W / 2
  const entranceCls = closing
    ? 'duration-150 ease-in opacity-0 scale-[0.94]'
    : entered
      ? 'duration-[320ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] opacity-100 scale-100 translate-y-0'
      : 'duration-0 opacity-0 scale-[0.82] translate-y-3'

  return (
    <>
      <style>{`
        @keyframes lp-shine { 0% { transform: translateX(-130%) skewX(-18deg) } 100% { transform: translateX(260%) skewX(-18deg) } }
        @keyframes lp-border { 0% { background-position: 0% 50% } 100% { background-position: 200% 50% } }
        @keyframes lp-rise { 0% { opacity: 0; transform: translateY(8px) } 100% { opacity: 1; transform: none } }
      `}</style>
      <div ref={boxRef}
        className={`fixed z-[90] w-[340px] pointer-events-none select-none transition-all ${entranceCls}`}
        style={{
          left: pos?.left ?? -9999, top: pos?.top ?? -9999,
          transformOrigin: pos?.above ? 'bottom center' : 'top center',
        }}
        aria-hidden="true">
        {/* 3D 倾斜层 */}
        <div style={{ transform: `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`, transition: 'transform 120ms ease-out' }}>
          {/* 流光渐变边框 */}
          <div className="rounded-[18px] p-[1.5px] shadow-2xl"
            style={{ background: 'linear-gradient(115deg, rgba(59,130,246,.75), rgba(168,85,247,.6), rgba(34,211,238,.75), rgba(59,130,246,.75))', backgroundSize: '200% 100%', animation: 'lp-border 6s linear infinite' }}>
            <div className="relative rounded-2xl bg-white p-2">
              {/* 指向锚卡片的小箭头 */}
              {pos && (
                <div className={`absolute w-3 h-3 rotate-45 bg-white ring-1 ring-black/[0.06] ${pos.above ? '-bottom-[7px] rounded-br-md' : '-top-[7px] rounded-tl-md'}`}
                  style={{ left: arrowLeft - 6 }} />
              )}
              {/* 网页截图 + 高光扫过 */}
              <div className="relative w-full overflow-hidden rounded-xl bg-gray-100" style={{ aspectRatio: '8/5' }}>
                {imgState === 'loading' && (
                  <div className="absolute inset-0 flex items-center justify-center animate-pulse bg-gradient-to-br from-gray-100 via-gray-50 to-gray-200">
                    <span className="text-xs text-gray-400">{t('截图生成中…')}</span>
                  </div>
                )}
                {imgState !== 'error' && (
                  <img src={`/api/preview?url=${encodeURIComponent(data.url)}`}
                    onLoad={() => setImgState('ok')}
                    onError={() => setImgState('error')}
                    className="absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-200"
                    style={{ opacity: imgState === 'ok' ? 1 : 0 }}
                    alt="" />
                )}
                {imgState === 'error' && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xs text-gray-400">{t('预览暂不可用')}</span>
                  </div>
                )}
                {imgState === 'ok' && (
                  <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
                    <div style={{ animation: 'lp-shine 0.9s ease 0.25s 1 both' }}
                      className="absolute top-[-20%] bottom-[-20%] left-0 w-[45%]"
                      // 高光带
                      data-shine="true">
                      <div className="w-full h-full" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)' }} />
                    </div>
                  </div>
                )}
              </div>
              {/* 名称 + 域名（错落浮现） */}
              <div className="px-1.5 pt-2" style={{ animation: entered ? 'lp-rise 0.45s cubic-bezier(0.22,1,0.36,1) 0.1s both' : undefined }}>
                <div className="text-sm font-semibold text-gray-800 truncate" title={data.name}>{data.name}</div>
                <div className="text-xs text-gray-400 truncate mt-0.5">{host}</div>
              </div>
              {/* 描述（创建卡片时填写）：背景包裹，完整展示 */}
              {data.desc && (
                <div className="mx-1.5 mt-2 mb-1 rounded-xl bg-black/[0.04] px-2.5 py-2 text-xs leading-relaxed text-gray-600 whitespace-pre-wrap break-words max-h-40 overflow-y-auto"
                  style={{ animation: entered ? 'lp-rise 0.45s cubic-bezier(0.22,1,0.36,1) 0.18s both' : undefined }}>
                  {t(data.desc)}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
