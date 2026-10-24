import { useEffect, useRef, useState } from 'react'
import { WeatherFxEngine, type WeatherFxCondition } from './weatherFxEngine'

interface Props {
  condition: WeatherFxCondition
  wind: number
}

// 壁纸天气效果层：壁纸之上、内容之下（fixed z-[5]，pointer-events-none）
// - 雨/雪/雷：canvas 粒子
// - 晴：左上角太阳光晕（CSS）
// - 恶劣天气：壁纸调暗遮罩；雷时全屏短促白闪模拟光照
export default function WeatherLayer({ condition, wind }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<WeatherFxEngine | null>(null)
  const [flash, setFlash] = useState(0)

  useEffect(() => {
    if (!canvasRef.current) return
    const engine = new WeatherFxEngine(canvasRef.current, condition, wind)
    engine.onFlash = () => {
      setFlash(1)
      setTimeout(() => setFlash(0), 90)
      setTimeout(() => setFlash(0.6), 140)
      setTimeout(() => setFlash(0), 240)
    }
    engineRef.current = engine
    return () => { engine.destroy(); engineRef.current = null }
    // condition/wind 变化走 setWeather 平滑过渡，不重建引擎
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    engineRef.current?.setWeather(condition, wind)
  }, [condition, wind])

  // 壁纸调暗程度：晴/多云 0，雪 0.15，雨 0.28，雷 0.42（闪电时短暂提亮由 flash 层承担）
  const dim = condition === 'thunder' ? 0.42 : condition === 'rain' ? 0.28 : condition === 'snow' ? 0.15 : 0

  return (
    <div className="fixed inset-0 z-[5] pointer-events-none" aria-hidden>
      {/* 壁纸调暗遮罩 */}
      <div
        className="absolute inset-0 bg-black transition-opacity duration-[1500ms] ease-in-out"
        style={{ opacity: dim }}
      />
      {/* 晴：左上角太阳（iOS 天气风格：亮核 + 放射光芒 + 柔光 + 镜头光晕） */}
      {condition === 'clear' && (
        <div className="absolute -top-8 -left-8 transition-opacity duration-[1500ms]">
          <div className="relative w-64 h-64">
            {/* 放射光芒：重复扇形条纹，径向 mask 向外淡出（静态） */}
            <div className="absolute inset-0 sun-rays" />
            {/* 大范围柔光 */}
            <div className="absolute inset-2 sun-glow sun-breathe-slow" />
            {/* 横向镜头光带（anamorphic streak，穿过亮核） */}
            <div className="absolute top-[7rem] -left-6 w-72 h-2.5 sun-streak" />
            {/* 亮核球体 */}
            <div className="absolute top-[5.5rem] left-[5.5rem] w-14 h-14 sun-ball sun-breathe" />
            {/* 镜头光斑（沿光轴对角线分布的 ghost flare） */}
            <div className="absolute top-[9.5rem] left-[8.5rem] w-9 h-9 rounded-full sun-ghost-1" />
            <div className="absolute top-48 left-44 w-5 h-5 rounded-full bg-white/25 blur-sm" />
            <div className="absolute top-[13.5rem] left-[11rem] w-12 h-12 rounded-full sun-ghost-2" />
          </div>
        </div>
      )}
      {/* 雨/雪/雷 canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      {/* 闪电白闪层 */}
      <div
        className="absolute inset-0 bg-white transition-opacity duration-75"
        style={{ opacity: flash * 0.22 }}
      />
      <style>{`
        @keyframes sun-breathe { 0%,100% { transform: scale(1); opacity: .85 } 50% { transform: scale(1.08); opacity: 1 } }
        .sun-breathe { animation: sun-breathe 5s ease-in-out infinite }
        .sun-breathe-slow { animation: sun-breathe 8s ease-in-out infinite }
        /* 放射光芒：长短相间的扇形亮条，径向 mask 让光芒向外淡出（静态） */
        .sun-rays {
          background: repeating-conic-gradient(from 3deg,
            rgba(255, 255, 255, 0.55) 0deg 1.6deg,
            transparent 1.6deg 9deg,
            rgba(255, 253, 244, 0.3) 9deg 10.2deg,
            transparent 10.2deg 24deg);
          -webkit-mask-image: radial-gradient(circle, rgba(0,0,0,0.9) 8%, rgba(0,0,0,0.45) 30%, transparent 66%);
          mask-image: radial-gradient(circle, rgba(0,0,0,0.9) 8%, rgba(0,0,0,0.45) 30%, transparent 66%);
          filter: blur(1.2px);
        }
        /* 环境柔光：暖白宽幅衰减 */
        .sun-glow { background: radial-gradient(circle closest-side, rgba(255, 249, 225, 0.6) 0%, rgba(255, 240, 190, 0.3) 35%, rgba(253, 230, 138, 0.12) 60%, transparent 100%) }
        /* 亮核：太阳球体（必须圆形，否则 shadow 是方形轮廓） */
        .sun-ball {
          border-radius: 50%;
          background: radial-gradient(circle, #ffffff 0%, #fffdf4 40%, rgba(255, 243, 200, 0.55) 72%, transparent 100%);
          box-shadow: 0 0 26px 10px rgba(255, 255, 255, 0.95), 0 0 70px 26px rgba(255, 240, 190, 0.55);
        }
        /* 横向镜头光带：中心亮向两端淡出，轻微色散 */
        .sun-streak {
          border-radius: 9999px;
          background: linear-gradient(90deg, transparent 0%, rgba(200, 225, 255, 0.28) 22%, rgba(255, 252, 235, 0.7) 46%, rgba(255, 255, 255, 0.85) 50%, rgba(255, 252, 235, 0.7) 54%, rgba(200, 225, 255, 0.28) 78%, transparent 100%);
          filter: blur(2.5px);
        }
        /* ghost 光斑：镜头内反射的淡圆 */
        .sun-ghost-1 { background: radial-gradient(circle, rgba(255, 244, 210, 0.4) 0%, rgba(255, 230, 170, 0.15) 60%, transparent 100%) }
        .sun-ghost-2 { background: radial-gradient(circle, rgba(190, 220, 255, 0.32) 0%, rgba(190, 220, 255, 0.1) 60%, transparent 100%) }
      `}</style>
    </div>
  )
}
