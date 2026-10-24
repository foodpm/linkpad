// ---------- 壁纸天气粒子引擎 ----------
// 全屏 fixed canvas：雨/雪/闪电特效，支持雨雪粒子落到指定 DOM 元素顶边并溅开。
// 生命周期与 fishtankEngine 同模式：ResizeObserver + visibility + rAF，destroy 释放。

export type WeatherFxCondition = 'clear' | 'cloudy' | 'rain' | 'thunder' | 'snow'

interface Splash {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
}

interface Drop {
  x: number
  y: number
  len: number
  speed: number
  alpha: number
  width: number
  layer: number // 0 远 1 中 2 近
}

interface Flake {
  x: number
  y: number
  r: number
  speed: number
  drift: number
  phase: number
  alpha: number
  blur: boolean
  layer: number
}

interface Bolt {
  segments: { x1: number; y1: number; x2: number; y2: number }[]
  life: number // 0..1 递减
  flashes: number[] // 关键帧亮度序列
}

const TAU = Math.PI * 2

export class WeatherFxEngine {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private raf = 0
  private destroyed = false
  private running = false
  private lastT = 0
  private W = 0
  private H = 0
  private dpr = 1

  private condition: WeatherFxCondition = 'clear'
  private wind = 0
  private drops: Drop[] = []
  private flakes: Flake[] = []
  private splashes: Splash[] = []
  private bolts: Bolt[] = []
  private nextBoltAt = 0
  private fade = 0 // 全局淡入 0..1
  private fadeDir = 1 // 1 淡入，-1 切换天气时先淡出
  private pendingCondition: WeatherFxCondition | null = null

  constructor(canvas: HTMLCanvasElement, condition: WeatherFxCondition, wind = 0) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d unavailable')
    this.ctx = ctx
    this.condition = condition
    this.wind = wind
    this.resize()
    this.populate()
    window.addEventListener('resize', this.onResize)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.nextBoltAt = performance.now() + 2000 + Math.random() * 6000
    this.start()
  }

  setWeather(condition: WeatherFxCondition, wind = 0) {
    if (condition === this.condition && wind === this.wind) return
    // 平滑切换：先整体淡出，再换粒子重新淡入
    this.pendingCondition = condition
    this.wind = wind
    this.fadeDir = -1
  }

  destroy() {
    this.destroyed = true
    this.running = false
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  private onResize = () => this.resize()

  private onVisibility = () => {
    if (document.hidden) {
      this.running = false
      cancelAnimationFrame(this.raf)
    } else {
      this.start()
    }
  }

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.W = window.innerWidth
    this.H = window.innerHeight
    this.canvas.width = Math.round(this.W * this.dpr)
    this.canvas.height = Math.round(this.H * this.dpr)
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
  }

  private isMobile() { return this.W < 640 }

  // 按 condition 填充粒子（手机端减半）
  private populate() {
    const scale = this.isMobile() ? 0.5 : 1
    const area = (this.W * this.H) / (1280 * 800)
    if (this.condition === 'rain' || this.condition === 'thunder') {
      const n = Math.round(260 * Math.max(0.6, Math.min(1.4, area)) * scale)
      this.drops = Array.from({ length: n }, () => this.makeDrop(true))
      this.flakes = []
    } else if (this.condition === 'snow') {
      const n = Math.round(180 * Math.max(0.6, Math.min(1.4, area)) * scale)
      this.flakes = Array.from({ length: n }, () => this.makeFlake(true))
      this.drops = []
    } else {
      this.drops = []
      this.flakes = []
    }
  }

  private makeDrop(anywhere: boolean): Drop {
    const layer = Math.random() < 0.6 ? 0 : Math.random() < 0.75 ? 1 : 2
    const speed = (layer === 2 ? 1400 : layer === 1 ? 1000 : 700) + Math.random() * 260
    return {
      x: Math.random() * (this.W + 200) - 100,
      y: anywhere ? Math.random() * this.H : -40 - Math.random() * 120,
      len: (layer === 2 ? 26 : layer === 1 ? 18 : 12) * (0.7 + Math.random() * 0.6),
      speed: speed * (0.85 + Math.random() * 0.3),
      alpha: (layer === 2 ? 0.5 : layer === 1 ? 0.38 : 0.26) * (0.7 + Math.random() * 0.5),
      width: layer === 2 ? 1.6 : layer === 1 ? 1.1 : 0.8,
      layer,
    }
  }

  private makeFlake(anywhere: boolean): Flake {
    const layer = Math.random() < 0.65 ? 0 : Math.random() < 0.8 ? 1 : 2
    const r = (layer === 2 ? 3.4 : layer === 1 ? 2.4 : 1.6) * (0.75 + Math.random() * 0.6)
    return {
      x: Math.random() * this.W,
      y: anywhere ? Math.random() * this.H : -10 - Math.random() * 60,
      r,
      speed: (layer === 2 ? 90 : layer === 1 ? 60 : 40) * (0.8 + Math.random() * 0.5),
      drift: 12 + Math.random() * 26,
      phase: Math.random() * TAU,
      alpha: (layer === 2 ? 0.95 : layer === 1 ? 0.8 : 0.6) * (0.8 + Math.random() * 0.3),
      blur: layer === 2 && Math.random() < 0.3,
      layer,
    }
  }

  // 雨雪落点目标：搜索框顶边 → 常用工具第一行顶边 → 视口底
  private targetTop(): number {
    const el = document.querySelector('[data-weather-target="search"]') || document.querySelector('[data-weather-target="tools"]')
    if (el) {
      const r = el.getBoundingClientRect()
      if (r.top > 40 && r.top < this.H) return r.top + 2
    }
    return this.H - 4
  }

  private start() {
    if (this.destroyed || this.running || document.hidden) return
    this.running = true
    this.lastT = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (t: number) => {
    if (this.destroyed || !this.running) return
    const dt = Math.min(0.05, (t - this.lastT) / 1000)
    this.lastT = t

    // 淡入淡出调度
    if (this.fadeDir === 1 && this.fade < 1) this.fade = Math.min(1, this.fade + dt * 1.6)
    if (this.fadeDir === -1) {
      this.fade = Math.max(0, this.fade - dt * 2.2)
      if (this.fade === 0 && this.pendingCondition) {
        this.condition = this.pendingCondition
        this.pendingCondition = null
        this.fadeDir = 1
        this.bolts = []
        this.splashes = []
        this.populate()
      }
    }

    const ctx = this.ctx
    ctx.clearRect(0, 0, this.W, this.H)

    if (this.condition === 'rain' || this.condition === 'thunder') this.stepRain(dt)
    else if (this.condition === 'snow') this.stepSnow(dt)
    if (this.condition === 'thunder') this.stepBolts(t)

    if (this.condition !== 'clear' && this.condition !== 'cloudy') this.drawSplashes(dt)

    this.raf = requestAnimationFrame(this.frame)
  }

  private stepRain(dt: number) {
    const ctx = this.ctx
    const targetY = this.targetTop()
    const windPx = this.wind * 6 // wind km/h → 水平偏移
    ctx.lineCap = 'round'
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i]
      const vy = d.speed * dt
      const vx = windPx * dt * (d.layer === 2 ? 1.4 : d.layer === 1 ? 1 : 0.7)
      d.x += vx
      d.y += vy
      const landed = d.y >= targetY
      if (landed || d.y > this.H + 30) {
        if (landed && d.x >= -20 && d.x <= this.W + 20 && Math.random() < 0.5) {
          this.spawnSplash(d.x, targetY, d.layer)
        }
        this.drops[i] = this.makeDrop(false)
        continue
      }
      const k = vy / Math.max(1, Math.hypot(vx, vy))
      const dx = vx / Math.max(1, Math.hypot(vx, vy))
      ctx.strokeStyle = `rgba(200, 220, 245, ${(d.alpha * this.fade).toFixed(3)})`
      ctx.lineWidth = d.width
      ctx.beginPath()
      ctx.moveTo(d.x, d.y)
      ctx.lineTo(d.x - d.len * dx, d.y - d.len * k)
      ctx.stroke()
    }
  }

  private spawnSplash(x: number, y: number, layer: number) {
    const n = layer === 2 ? 5 : 3
    for (let i = 0; i < n; i++) {
      this.splashes.push({
        x, y,
        vx: (Math.random() - 0.5) * 130,
        vy: -(60 + Math.random() * 130) * (layer === 2 ? 1 : 0.7),
        life: 0,
        maxLife: 0.24 + Math.random() * 0.18,
      })
    }
  }

  private drawSplashes(dt: number) {
    const ctx = this.ctx
    const g = 900 * dt
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i]
      s.life += dt
      if (s.life >= s.maxLife) { this.splashes.splice(i, 1); continue }
      s.vy += g
      s.x += s.vx * dt
      s.y += s.vy * dt
      const p = 1 - s.life / s.maxLife
      ctx.fillStyle = `rgba(210, 228, 248, ${(0.55 * p * this.fade).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(s.x, s.y, 1.1 + p * 0.9, 0, TAU)
      ctx.fill()
    }
  }

  private stepSnow(dt: number) {
    const ctx = this.ctx
    const targetY = this.targetTop()
    const windPx = this.wind * 2.2
    for (let i = 0; i < this.flakes.length; i++) {
      const f = this.flakes[i]
      f.phase += dt * (0.6 + f.r * 0.18)
      f.y += f.speed * dt
      f.x += (Math.sin(f.phase) * f.drift + windPx * (f.layer === 2 ? 1.2 : 0.8)) * dt
      const landed = f.y >= targetY
      if (landed || f.y > this.H + 12 || f.x < -20 || f.x > this.W + 20) {
        this.flakes[i] = this.makeFlake(false)
        continue
      }
      ctx.save()
      if (f.blur) ctx.filter = 'blur(1.6px)'
      ctx.fillStyle = `rgba(255, 255, 255, ${(f.alpha * this.fade).toFixed(3)})`
      ctx.shadowColor = 'rgba(255,255,255,0.8)'
      ctx.shadowBlur = f.layer === 2 ? 6 : 3
      ctx.beginPath()
      ctx.arc(f.x, f.y, f.r, 0, TAU)
      ctx.fill()
      ctx.restore()
    }
  }

  // 闪电：中点位移折线主干 + 随机分支，快闪衰减
  private stepBolts(t: number) {
    if (t >= this.nextBoltAt && this.bolts.length < 2) {
      this.bolts.push(this.makeBolt())
      this.nextBoltAt = t + 6000 + Math.random() * 14000
      this.onFlash?.()
    }
    const ctx = this.ctx
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]
      b.life -= 0.028
      if (b.life <= 0) { this.bolts.splice(i, 1); continue }
      // 亮度包络：前 15% 极亮，随后抖动衰减
      const env = b.life > 0.85 ? 1 : Math.max(0, b.life) * (0.55 + 0.45 * Math.abs(Math.sin(b.life * 42)))
      const alpha = env * this.fade
      if (alpha < 0.02) continue
      ctx.save()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.shadowColor = 'rgba(190, 210, 255, 0.9)'
      ctx.shadowBlur = 18
      // 外发光主干
      ctx.strokeStyle = `rgba(150, 180, 255, ${(alpha * 0.55).toFixed(3)})`
      ctx.lineWidth = 5.5
      this.strokeSegments(b.segments)
      // 亮芯
      ctx.shadowBlur = 8
      ctx.strokeStyle = `rgba(245, 248, 255, ${alpha.toFixed(3)})`
      ctx.lineWidth = 1.8
      this.strokeSegments(b.segments)
      ctx.restore()
    }
  }

  private strokeSegments(segs: { x1: number; y1: number; x2: number; y2: number }[]) {
    const ctx = this.ctx
    ctx.beginPath()
    for (const s of segs) {
      ctx.moveTo(s.x1, s.y1)
      ctx.lineTo(s.x2, s.y2)
    }
    ctx.stroke()
  }

  private makeBolt(): Bolt {
    const startX = this.W * (0.15 + Math.random() * 0.7)
    const endY = this.H * (0.45 + Math.random() * 0.3)
    const segs: { x1: number; y1: number; x2: number; y2: number }[] = []
    // 递归中点位移
    const build = (x1: number, y1: number, x2: number, y2: number, disp: number, depth: number) => {
      if (depth <= 0 || Math.abs(y2 - y1) < 14) {
        segs.push({ x1, y1, x2, y2 })
        // 概率长出分支
        if (depth < 5 && Math.random() < 0.3) {
          const bx = x2 + (Math.random() - 0.7) * this.W * 0.16
          const by = y2 + (endY - y1) * (0.18 + Math.random() * 0.2)
          build(x2, y2, bx, by, disp * 0.45, depth + 2)
        }
        return
      }
      const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * disp
      const my = (y1 + y2) / 2
      build(x1, y1, mx, my, disp * 0.55, depth - 1)
      build(mx, my, x2, y2, disp * 0.55, depth - 1)
    }
    build(startX, -20, startX + (Math.random() - 0.5) * 120, endY, this.W * 0.09, 6)
    return { segments: segs, life: 1, flashes: [] }
  }

  // 闪电瞬间回调（供遮罩层做全屏白闪/增亮）
  onFlash: (() => void) | null = null
}
