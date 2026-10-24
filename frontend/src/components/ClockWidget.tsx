import { useEffect, useState } from 'react'
import solarLunar from 'solarlunar'
import { useLang } from '../i18n'

const WEEK_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
const pad = (n: number) => String(n).padStart(2, '0')

/** 当天农历文案，如「八月廿七」；异常时回退空串 */
function lunarLabel(d: Date): string {
  try {
    const l: any = solarLunar.solar2lunar(d.getFullYear(), d.getMonth() + 1, d.getDate())
    return l ? `${l.monthCn}${l.dayCn}` : ''
  } catch { return '' }
}

// ---------- 时间组件：整幅数字时钟（独立占一个区域，不支持分类/尺寸调整） ----------

interface ClockCardProps {
  onContextMenu?: (e: React.MouseEvent) => void
}

export function ClockWidgetCard({ onContextMenu }: ClockCardProps) {
  const { lang } = useLang()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    // 对齐到下一秒边界再启动每秒跳动，避免秒数变化滞后于真实时间
    let timer: ReturnType<typeof setInterval> | null = null
    const boot = setTimeout(() => {
      setNow(new Date())
      timer = setInterval(() => setNow(new Date()), 1000)
    }, 1000 - (Date.now() % 1000))
    return () => { clearTimeout(boot); if (timer) clearInterval(timer) }
  }, [])

  // 冒号用独立固定宽度 span：DSEG7 冒号字形 advance 仅 200/1000em（数字为 816），直接拼串会显得间距不均
  const hh = pad(now.getHours())
  const mm = pad(now.getMinutes())
  const ss = pad(now.getSeconds())
  // 中文：X月X日 星期X + 农历；英文：Friday, September 5（农历仅中文显示）
  const dateStr = lang === 'zh'
    ? `${now.getMonth() + 1}月${now.getDate()}日 ${WEEK_CN[now.getDay()]} ${lunarLabel(now)}`
    : now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="relative group h-full min-h-0" onContextMenu={onContextMenu}>
      <div data-widget-card
        className="h-full flex flex-col items-center justify-center select-none px-4 py-8 sm:py-10">
        <div className="font-dseg text-white tabular-nums leading-none whitespace-nowrap
          drop-shadow-[0_2px_14px_rgba(0,0,0,0.45)]
          text-4xl sm:text-6xl md:text-7xl lg:text-8xl">
          <span>{hh}</span>
          <span className="inline-block w-[0.45em] text-center">:</span>
          <span>{mm}</span>
          <span className="inline-block w-[0.45em] text-center">:</span>
          <span>{ss}</span>
        </div>
        <div className="mt-4 sm:mt-5 text-white/90 text-base sm:text-lg tracking-wide drop-shadow-[0_1px_8px_rgba(0,0,0,0.45)]">
          {dateStr}
        </div>
      </div>
    </div>
  )
}
