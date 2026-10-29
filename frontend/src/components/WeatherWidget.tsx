import { useEffect, useState } from 'react'
import {
  Sun, Moon, CloudSun, CloudMoon, Cloud, CloudFog, CloudDrizzle, CloudRain,
  CloudRainWind, CloudSnow, CloudLightning,
  Search, MoreVertical, MapPin, Loader2, RefreshCw, X,
} from 'lucide-react'
import { weather as weatherApi, type WeatherData } from '../api'
import { useT } from '../i18n'
import { WidgetResizeHandle } from './CountdownWidget'

// ---------- WMO 天气码 → 文案 / 图标 ----------

export function weatherCodeText(code: number): string {
  if (code === 0 || code === 1) return '晴'
  if (code === 2) return '多云'
  if (code === 3) return '阴'
  if (code === 45 || code === 48) return '雾'
  if (code === 51 || code === 53 || code === 55) return '毛毛雨'
  if (code === 56 || code === 57) return '冻雨'
  if (code === 61) return '小雨'
  if (code === 63) return '中雨'
  if (code === 65) return '大雨'
  if (code === 66 || code === 67) return '冻雨'
  if (code === 71 || code === 77) return '小雪'
  if (code === 73) return '中雪'
  if (code === 75) return '大雪'
  if (code === 80 || code === 81 || code === 82) return '阵雨'
  if (code === 85 || code === 86) return '阵雪'
  if (code >= 95) return '雷雨'
  return '多云'
}

export function WeatherIcon({ code, isDay = true, className, strokeWidth }: { code: number; isDay?: boolean; className?: string; strokeWidth?: number }) {
  const cls = className || 'w-4 h-4'
  const sw = strokeWidth ? { strokeWidth } : {}
  if (code === 0 || code === 1) return isDay ? <Sun className={cls} {...sw} /> : <Moon className={cls} {...sw} />
  if (code === 2) return isDay ? <CloudSun className={cls} {...sw} /> : <CloudMoon className={cls} {...sw} />
  if (code === 45 || code === 48) return <CloudFog className={cls} {...sw} />
  if ((code >= 51 && code <= 57)) return <CloudDrizzle className={cls} {...sw} />
  if (code === 65 || code === 67 || code === 82) return <CloudRainWind className={cls} {...sw} />
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return <CloudRain className={cls} {...sw} />
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return <CloudSnow className={cls} {...sw} />
  if (code >= 95) return <CloudLightning className={cls} {...sw} />
  return <Cloud className={cls} {...sw} />
}

/** 图标颜色：按天气类型着色（晴黄/云灰/雨蓝/雪青/雷紫） */
function iconColor(code: number): string {
  if (code === 0 || code === 1) return 'text-amber-400'
  if (code === 2) return 'text-amber-400/90'
  if (code === 3) return 'text-white/80'
  if (code === 45 || code === 48) return 'text-white/80'
  if (code >= 95) return 'text-violet-500'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'text-cyan-300'
  if (code >= 51) return 'text-blue-300'
  return 'text-white/80'
}

/** 按天气类型给卡片顶部一层淡淡的天空色晕（呼应参考图的环境光） */
function skyTint(code: number, isDay: boolean): string {
  if (code === 0 || code === 1) return isDay ? 'from-sky-300/30' : 'from-indigo-300/25'
  if (code === 2) return 'from-sky-200/25'
  if (code >= 95) return 'from-violet-300/25'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'from-cyan-200/30'
  if (code >= 51) return 'from-blue-300/25'
  return 'from-slate-300/25'
}

// ---------- 日期辅助 ----------

function dayLabel(date: string, t: (k: string) => string): string {
  const d = new Date(`${date}T12:00:00`)
  const today = new Date()
  const norm = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
  if (norm(d) === norm(today)) return t('今天')
  const tmr = new Date(today.getTime() + 86400000)
  if (norm(d) === norm(tmr)) return t('明天')
  return t(['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()])
}

// ---------- 组件 ----------

export function WeatherWidgetCard({ widget, onUpdate, onRemove, onHeightChange, onPickCity, onRelocate, onContextMenu }: {
  widget: any
  onUpdate?: (patch: any) => void
  onRemove: () => void
  onHeightChange?: (h: number) => void
  onPickCity: () => void
  onRelocate: () => Promise<boolean>
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  const t = useT()
  const height = widget.height || 3
  const city = widget.city as { name: string; lat: number; lon: number } | undefined
  const [data, setData] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // 30 分钟轮询 + 回到前台立即刷新（与天气特效同模式）
  useEffect(() => {
    if (!city?.lat || !city?.lon) { setData(null); return }
    let alive = true
    const fetchWx = () => {
      setLoading(true)
      weatherApi.get(city.lat, city.lon)
        .then((d) => { if (alive) { setData(d); setFailed(false) } })
        .catch(() => { if (alive) setFailed(true) })
        .finally(() => { if (alive) setLoading(false) })
    }
    fetchWx()
    const timer = setInterval(fetchWx, 30 * 60 * 1000)
    const onVis = () => { if (!document.hidden) fetchWx() }
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVis) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city?.lat, city?.lon])

  const retry = () => {
    if (!city?.lat || !city?.lon) return
    setLoading(true)
    weatherApi.get(city.lat, city.lon)
      .then((d) => { setData(d); setFailed(false) })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }

  const doRelocate = async () => {
    setMenuOpen(false)
    setBusy(true)
    const ok = await onRelocate()
    setBusy(false)
    if (!ok) alert(t('无法获取位置，请检查定位权限'))
  }

  // 磨砂玻璃卡身（参考图：白调磨砂 + 顶部天光晕 + 大圆角 + 柔和投影）
  const cardCls = 'relative h-full rounded-3xl border border-white/35 bg-white/25 backdrop-blur-xl shadow-[0_12px_40px_-12px_rgba(0,0,0,0.42)] overflow-hidden cursor-default select-none text-white'

  // 未选城市：空状态（搜索胶囊 + 自动定位）
  if (!city) {
    return (
      <div className="relative group h-full min-h-0">
        <button onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-red-400 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500">
          <X className="w-3 h-3" />
        </button>
        <div data-widget-card onContextMenu={onContextMenu} className={cardCls}>
          <div className={`absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-white/18 to-transparent pointer-events-none`} />
          <div className="relative h-full p-2.5 flex flex-col">
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex-1 h-8 rounded-full bg-white/18 border border-white/30 flex items-center gap-2 px-3 min-w-0">
                <Search className="w-3.5 h-3.5 text-white/70 flex-shrink-0" />
                <span className="text-xs text-white/70 truncate">{t('搜索城市')}</span>
              </div>
              <button onClick={onPickCity}
                className="w-8 h-8 rounded-full bg-white/18 border border-white/30 grid place-items-center flex-shrink-0 hover:bg-white/28 transition-all">
                <Search className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center gap-1.5 min-h-0">
              <CloudSun className="w-6 h-6 text-white/70" />
              <span className="text-[11px] text-white/70">{t('选择城市查看天气')}</span>
              <button onClick={doRelocate} disabled={busy}
                className="flex items-center gap-1 text-[11px] text-white/70 hover:text-white transition-all disabled:opacity-60">
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}{t('自动定位')}
              </button>
            </div>
          </div>
        </div>
        {onHeightChange && <WidgetResizeHandle height={height} onChange={onHeightChange} />}
      </div>
    )
  }

  return (
    <div className="relative group h-full min-h-0">
      <button onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-red-400 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500">
        <X className="w-3 h-3" />
      </button>
      <div data-widget-card onContextMenu={onContextMenu} className={cardCls}>
        {data && <div className={`absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-white/18 to-transparent pointer-events-none`} />}
        <div className="relative h-full p-2.5 flex flex-col min-h-0">

          {/* 顶部：城市搜索胶囊 + 圆形操作按钮 */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={onPickCity} title={t('更换城市')}
              className="flex-1 h-8 rounded-full bg-white/18 border border-white/30 flex items-center gap-2 px-3 min-w-0 hover:bg-white/28 transition-all">
              <Search className="w-3.5 h-3.5 text-white/70 flex-shrink-0" />
              <span className="text-xs font-medium text-white truncate">{city.name}</span>
            </button>
            <button onClick={(e) => { e.stopPropagation(); if (failed) { retry(); return } setMenuOpen(v => !v) }}
              className="w-8 h-8 rounded-full bg-white/18 border border-white/30 grid place-items-center flex-shrink-0 text-white hover:bg-white/28 transition-all">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : failed ? <RefreshCw className="w-3.5 h-3.5" />
                : <MoreVertical className="w-3.5 h-3.5" />}
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-2.5 top-11 z-30 w-28 rounded-xl shadow-lg border border-white/30 bg-slate-900/55 backdrop-blur-xl p-1 ctx-menu-in">
                  <button onClick={() => { setMenuOpen(false); onPickCity() }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-white hover:bg-white/12">
                    <span>{t('更换城市')}</span><MapPin className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={doRelocate} disabled={busy}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-white hover:bg-white/12 disabled:opacity-60">
                    <span>{t('重新定位')}</span>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </>
            )}
          </div>

          {!data ? (
            <div className="flex-1 flex items-center justify-center min-h-0">
              {failed ? <span className="text-[11px] text-white/70">{t('天气数据获取失败')}</span>
                : <Loader2 className="w-4 h-4 text-white/70 animate-spin" />}
            </div>
          ) : height <= 1 ? (
            /* 1 卡：紧凑单行（与股票/黄金卡同构） */
            <div className="flex-1 flex items-center gap-2.5 min-h-0">
              <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-white/18 border border-white/30">
                <span className={iconColor(data.code)}><WeatherIcon code={data.code} isDay={data.isDay} className="w-5 h-5" /></span>
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-white text-sm truncate">{city.name}</h4>
                <p className="text-xs text-white/70 truncate mt-0.5">{t(weatherCodeText(data.code))} {data.temp}°{data.feels != null ? ` · ${t('体感')} ${data.feels}°` : ''}</p>
              </div>
            </div>
          ) : (
            <>
              {/* 温度主区：线性图标 + 大号细体温度 */}
              <div className="flex items-center gap-3 mt-2 flex-shrink-0 min-w-0">
                <span className={iconColor(data.code)}><WeatherIcon code={data.code} isDay={data.isDay} className="w-9 h-9" strokeWidth={1.5} /></span>
                <span className="text-[34px] leading-none font-light text-white tracking-tight">{data.temp}°</span>
                <span className="text-xs text-white/70 self-end mb-1">C</span>
              </div>

              {/* 信息行（参考图式两行小字） */}
              <div className="mt-1.5 space-y-0.5 flex-shrink-0 min-w-0">
                <div className="text-[10px] text-white/75 truncate">
                  {t(weatherCodeText(data.code))} · {t('体感')} {data.feels != null ? `${data.feels}°` : '—'} · {t('湿度')} {data.humidity != null ? `${data.humidity}%` : '—'}
                </div>
                <div className="text-[10px] text-white/65 truncate">
                  {t('风速')} {Math.round(data.wind)} km/h{data.daily?.[0]?.sunrise ? ` · ${t('日出')} ${data.daily[0].sunrise} / ${t('日落')} ${data.daily[0].sunset}` : ''}
                </div>
              </div>

              {/* 2 卡到此为止；3 卡追加逐小时 + 每日 */}
              {height >= 3 && (
                <div className="flex-1 min-h-0 flex flex-col mt-2">
                  {data.hourly && data.hourly.length > 0 && (
                    <>
                      <div className="text-[9px] text-white/65 mb-1 flex-shrink-0">{t('未来八小时')}</div>
                      <div className="grid grid-cols-8 gap-px flex-shrink-0">
                        {data.hourly.map((h, i) => (
                          <div key={i} className="flex flex-col items-center gap-0.5 min-w-0">
                            <span className="text-[8px] text-white/65 leading-none">{h.time}</span>
                            <span className={iconColor(h.code)}><WeatherIcon code={h.code} isDay={true} className="w-3.5 h-3.5" /></span>
                            <span className="text-[9px] text-white font-medium leading-none">{h.temp}°</span>
                            <span className={`text-[8px] leading-none ${h.pop > 0 ? 'text-blue-300' : 'text-white/45'}`}>{h.pop}%</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {data.daily && data.daily.length > 0 && (
                    <div className="mt-auto pt-2 border-t border-white/25 space-y-1">
                      {data.daily.map((d, i) => (
                        <div key={i} className="flex items-center gap-1.5 min-w-0">
                          <span className="w-6 flex-shrink-0 text-[10px] text-white/80 font-medium">{dayLabel(d.date, t)}</span>
                          <span className={`${iconColor(d.code)} flex-shrink-0`}><WeatherIcon code={d.code} isDay={true} className="w-3.5 h-3.5" /></span>
                          <span className="text-[10px] text-white/80 truncate flex-1">{t(weatherCodeText(d.code))}</span>
                          <span className="text-[10px] text-white/70 flex-shrink-0">{d.min}° / {d.max}°</span>
                          <span className={`text-[9px] flex-shrink-0 w-7 text-right ${d.pop > 0 ? 'text-blue-300' : 'text-white/45'}`}>{d.pop}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {onHeightChange && <WidgetResizeHandle height={height} onChange={onHeightChange} />}
    </div>
  )
}
