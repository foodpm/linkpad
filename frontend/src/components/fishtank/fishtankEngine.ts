// 仿真鱼缸：共享常量 / 物种表 / 加鱼弹窗用的 2D 预览绘制（无 WebGL）
// 实时渲染已迁移到 fishtank3dEngine.ts（three.js）

export type TankStyle = 'classic' | 'eco' | 'sea'
export type FishSpecies = 'koi' | 'goldfish' | 'guppy' | 'angelfish' | 'zebrafish' | 'betta' | 'clownfish' | 'neon'

export interface FishConfig {
  id: string
  species: FishSpecies
  size?: number // 0.85-1.15 体型缩放
}

export const MAX_FISH = 12
export const TANK_STYLE_ORDER: TankStyle[] = ['classic', 'eco', 'sea']
export const TANK_STYLE_NAMES: Record<TankStyle, string> = {
  classic: '经典玻璃缸',
  eco: '生态草缸',
  sea: '海水缸',
}

// ---------- 工具 ----------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

// ---------- 物种定义（预览绘制用） ----------

type TailType = 'fan' | 'fork' | 'veil' | 'triangle'

interface SpeciesDef {
  len: [number, number]      // 体长 px 区间
  ratio: number              // 长:高
  tail: TailType
  speed: [number, number]    // 巡游速度 px/s
  dorsal: number             // 背鳍高度系数（相对体高）
  pattern: 'patches' | 'vstripes' | 'hstripes' | 'neon' | 'plain'
  body: string[][]           // 颜色变体：[顶色, 底色] 渐变
  patch?: string[]           // 花纹色（patches/vstripes/hstripes/neon）
  tailColor?: string[][]     // 尾鳍渐变（随变体）
}

export const SPECIES: Record<FishSpecies, SpeciesDef> = {
  koi: {
    len: [34, 44], ratio: 3.2, tail: 'fan', speed: [18, 30], dorsal: 0.22,
    pattern: 'patches',
    body: [['#fdfdf8', '#e9e9e0'], ['#f6c26b', '#f0983c']],
    patch: ['#e8482f', '#f2801f', '#33322f'],
    tailColor: [['#fdfdf8', '#efe6da'], ['#f6c26b', '#f0983c']],
  },
  goldfish: {
    len: [26, 36], ratio: 2.2, tail: 'fan', speed: [12, 22], dorsal: 0.3,
    pattern: 'plain',
    body: [['#ffb15e', '#ff7a1a'], ['#ff8d5c', '#f4581f']],
    tailColor: [['#ffc37e', '#ff9b3d'], ['#ffab7e', '#ff7a4d']],
  },
  guppy: {
    len: [14, 20], ratio: 2.8, tail: 'veil', speed: [25, 45], dorsal: 0.25,
    pattern: 'plain',
    body: [['#cfd8e6', '#93a8c4'], ['#b8cfe0', '#7fa3c9']],
    tailColor: [['#ff6fa5', '#8f5cff'], ['#ffb84d', '#ff5c8a'], ['#5cd6ff', '#4d7bff']],
  },
  angelfish: {
    len: [22, 30], ratio: 1.35, tail: 'triangle', speed: [10, 18], dorsal: 1.15,
    pattern: 'vstripes',
    body: [['#eef3f6', '#c2ced8'], ['#f2ece2', '#d4c8b8']],
    patch: ['#2a3238'],
    tailColor: [['#eef3f6', '#c2ced8'], ['#f2ece2', '#d4c8b8']],
  },
  zebrafish: {
    len: [12, 18], ratio: 3.8, tail: 'fork', speed: [35, 55], dorsal: 0.2,
    pattern: 'hstripes',
    body: [['#dfe9f2', '#b8c8d8'], ['#e8d8c0', '#d0b890']],
    patch: ['#3a6ea8'],
    tailColor: [['#dfe9f2', '#b8c8d8'], ['#e8d8c0', '#d0b890']],
  },
  betta: {
    len: [18, 24], ratio: 2.6, tail: 'veil', speed: [8, 15], dorsal: 0.5,
    pattern: 'plain',
    body: [['#c2334d', '#8c1f33'], ['#4d5cc8', '#2f3a8c'], ['#2f8c6b', '#1f6b52']],
    tailColor: [['#d94f66', '#a1243c'], ['#6b7ae0', '#4450b8'], ['#4db891', '#2f8c6b']],
  },
  clownfish: {
    len: [16, 22], ratio: 2.6, tail: 'fan', speed: [15, 28], dorsal: 0.28,
    pattern: 'vstripes',
    body: [['#ff8c33', '#f2661f'], ['#ff9d4d', '#f2761f']],
    patch: ['#ffffff', '#1a1a1a'],
    tailColor: [['#ff9d55', '#f27030'], ['#ffab66', '#f28040']],
  },
  neon: {
    len: [10, 14], ratio: 3.5, tail: 'fork', speed: [30, 50], dorsal: 0.18,
    pattern: 'neon',
    body: [['#d8e8f0', '#a8c4d4']],
    patch: ['#3ee6ff', '#ff3b52'],
    tailColor: [['#d8e8f0', '#c4d4de']],
  },
}

// ---------- 鱼的绘制（程序化，朝 +x，中心在原点） ----------

interface FishDrawOpts {
  species: FishSpecies
  variant: number
  len: number
  phase: number  // 摆尾相位
  amp: number    // 摆尾幅度 px
  pulse: number  // 吃食身体脉冲 0..1
  seed: number
}

/** 身体轮廓：s∈[0,1]，0=鼻尖 1=尾柄 */
function bodyProfile(s: number): number {
  return Math.pow(Math.sin(Math.PI * Math.pow(s, 0.75)), 0.8)
}

function renderFish(ctx: CanvasRenderingContext2D, o: FishDrawOpts): void {
  const def = SPECIES[o.species]
  const L = o.len
  const H = L / def.ratio
  const noseX = L * 0.5
  const tailX = -L * 0.5
  const segY = (s: number) => Math.sin(o.phase - 2.4 * s) * o.amp * s
  const topAt = (s: number) => segY(s) - bodyProfile(s) * H * 0.5

  if (o.pulse > 0) ctx.scale(1 + o.pulse * 0.1, 1 - o.pulse * 0.06)

  const bodyColors = def.body[o.variant % def.body.length]
  const tailColors = def.tailColor ? def.tailColor[o.variant % def.tailColor.length] : bodyColors

  // --- 尾鳍（画在身体后面） ---
  const tailSwing = Math.sin(o.phase - 2.4 * 1.15) * o.amp * 0.9
  ctx.save()
  ctx.translate(tailX, segY(1))
  ctx.rotate(tailSwing / Math.max(4, L * 0.5))
  const tg = ctx.createLinearGradient(0, 0, -L * 0.6, 0)
  tg.addColorStop(0, tailColors[0])
  tg.addColorStop(1, tailColors[1] || tailColors[0])
  ctx.fillStyle = tg
  if (def.tail === 'fan') {
    const tl = L * 0.42, sp = H * 0.55
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(-tl * 0.5, -sp, -tl, -sp * 0.9)
    ctx.quadraticCurveTo(-tl * 0.72, 0, -tl, sp * 0.9)
    ctx.quadraticCurveTo(-tl * 0.5, sp, 0, 0)
    ctx.fill()
  } else if (def.tail === 'veil') {
    const tl = L * (o.species === 'betta' ? 0.95 : 0.55), sp = H * 0.8
    const wv = Math.sin(o.phase * 0.7) * 1.5
    ctx.globalAlpha = 0.72
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(-tl * 0.45, -sp * 0.9 + wv, -tl, -sp * 0.55)
    ctx.quadraticCurveTo(-tl * 0.6, 0, -tl, sp * 0.55)
    ctx.quadraticCurveTo(-tl * 0.45, sp * 0.9 - wv, 0, 0)
    ctx.fill()
  } else if (def.tail === 'fork') {
    const tl = L * 0.34, sp = H * 0.5
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(-tl * 0.6, -sp * 0.7, -tl, -sp)
    ctx.quadraticCurveTo(-tl * 0.35, 0, -tl, sp)
    ctx.quadraticCurveTo(-tl * 0.6, sp * 0.7, 0, 0)
    ctx.fill()
  } else { // triangle（神仙鱼）
    const tl = L * 0.4
    ctx.globalAlpha = 0.85
    ctx.beginPath()
    ctx.moveTo(0, -H * 0.15)
    ctx.lineTo(-tl, 0)
    ctx.lineTo(0, H * 0.15)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
  ctx.globalAlpha = 1

  // --- 背鳍 / 臀鳍（神仙鱼加臀鳍） ---
  const dh = H * def.dorsal
  if (dh > 0.5) {
    ctx.globalAlpha = 0.7
    ctx.fillStyle = tailColors[0]
    ctx.beginPath()
    ctx.moveTo(noseX - L * 0.22, topAt(0.16) + 1)
    ctx.quadraticCurveTo(noseX - L * 0.02, topAt(0.3) - dh, noseX - L * 0.4, topAt(0.55) - dh * 0.55)
    ctx.lineTo(noseX - L * 0.5, topAt(0.62))
    ctx.closePath()
    ctx.fill()
    if (def.dorsal > 0.8) {
      ctx.beginPath()
      ctx.moveTo(noseX - L * 0.2, segY(0.2) + H * 0.5 * bodyProfile(0.2) - 1)
      ctx.quadraticCurveTo(noseX - L * 0.05, segY(0.32) + H * 0.5 * bodyProfile(0.32) + dh * 0.9, noseX - L * 0.42, segY(0.6) + H * 0.5 * bodyProfile(0.6) + dh * 0.45)
      ctx.closePath()
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  // --- 身体路径 ---
  const M = 12
  const top: number[][] = [], bot: number[][] = []
  for (let i = 0; i <= M; i++) {
    const s = i / M
    const x = noseX + (tailX - noseX) * s
    const w = bodyProfile(s) * H * 0.5
    const y = segY(s)
    top.push([x, y - w])
    bot.push([x, y + w])
  }
  const bodyPath = () => {
    ctx.beginPath()
    ctx.moveTo(top[0][0], top[0][1])
    for (let i = 1; i <= M; i++) ctx.lineTo(top[i][0], top[i][1])
    for (let i = M; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1])
    ctx.closePath()
  }

  bodyPath()
  const bg = ctx.createLinearGradient(0, -H * 0.5, 0, H * 0.5)
  bg.addColorStop(0, bodyColors[0])
  bg.addColorStop(1, bodyColors[1] || bodyColors[0])
  ctx.fillStyle = bg
  ctx.fill()

  // --- 花纹（clip 到身体内） ---
  ctx.save()
  bodyPath()
  ctx.clip()
  const rnd = mulberry32(o.seed)
  if (def.pattern === 'patches' && def.patch) {
    const n = 2 + Math.floor(rnd() * 2)
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = def.patch[i % def.patch.length]
      ctx.globalAlpha = 0.92
      const px = tailX + rnd() * L * 0.78
      const py = (rnd() - 0.5) * H * 0.7
      const pr = H * (0.25 + rnd() * 0.3)
      ctx.beginPath()
      ctx.ellipse(px, py, pr * (1.1 + rnd()), pr, rnd() * 1.2, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (def.pattern === 'vstripes' && def.patch) {
    const isClown = o.species === 'clownfish'
    for (let i = 0; i < 3; i++) {
      const cx = noseX - L * (0.14 + i * 0.3)
      const bw = isClown ? H * 0.16 : H * 0.11
      ctx.fillStyle = def.patch[0]
      ctx.globalAlpha = isClown ? 0.95 : 0.8
      ctx.fillRect(cx - bw / 2, -H, bw, H * 2)
      if (isClown && def.patch[1]) {
        ctx.strokeStyle = def.patch[1]
        ctx.globalAlpha = 0.55
        ctx.lineWidth = 1
        ctx.strokeRect(cx - bw / 2, -H, bw, H * 2)
      }
    }
  } else if (def.pattern === 'hstripes' && def.patch) {
    ctx.fillStyle = def.patch[0]
    ctx.globalAlpha = 0.85
    for (let i = 0; i < 4; i++) {
      const yy = -H * 0.36 + i * H * 0.24
      ctx.fillRect(tailX, yy - H * 0.045, L, H * 0.09)
    }
  } else if (def.pattern === 'neon' && def.patch) {
    ctx.fillStyle = def.patch[0]
    ctx.globalAlpha = 0.95
    ctx.fillRect(tailX + L * 0.05, -H * 0.16, L * 0.72, H * 0.2)
    ctx.fillStyle = def.patch[1]
    ctx.globalAlpha = 0.9
    ctx.fillRect(noseX - L * 0.42, 0, L * 0.4, H * 0.34)
  }
  ctx.restore()
  ctx.globalAlpha = 1

  // --- 描边 ---
  bodyPath()
  ctx.strokeStyle = 'rgba(0,0,0,0.16)'
  ctx.lineWidth = 0.75
  ctx.stroke()

  // --- 眼睛 ---
  const er = Math.max(1.1, H * 0.1)
  const ex = noseX - L * 0.14, ey = segY(0.1) - H * 0.06
  ctx.fillStyle = '#1a1a1a'
  ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.beginPath(); ctx.arc(ex - er * 0.3, ey - er * 0.3, er * 0.35, 0, Math.PI * 2); ctx.fill()

  // --- 胸鳍（快速摆动） ---
  ctx.globalAlpha = 0.6
  ctx.fillStyle = tailColors[0]
  ctx.save()
  ctx.translate(noseX - L * 0.22, segY(0.22) + H * 0.08)
  ctx.rotate(0.5 + Math.sin(o.phase * 1.7) * 0.35)
  ctx.beginPath()
  ctx.ellipse(-H * 0.16, H * 0.1, H * 0.22, H * 0.1, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.globalAlpha = 1
}

/** 物种预览图（加鱼弹窗用），time 秒驱动摆尾动画 */
export function drawFishPreview(canvas: HTMLCanvasElement, species: FishSpecies, time: number): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const cw = canvas.clientWidth || 72
  const ch = canvas.clientHeight || 48
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr)
    canvas.height = Math.round(ch * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  const def = SPECIES[species]
  // 保证高身鱼（神仙鱼）连同背鳍不超出
  const len = Math.min(cw * 0.55, (ch * 0.82) * def.ratio / (1.5 + def.dorsal))
  ctx.save()
  ctx.translate(cw / 2, ch / 2)
  renderFish(ctx, {
    species, variant: 0, len,
    phase: time * 5, amp: 2.2, pulse: 0,
    seed: hashStr(species),
  })
  ctx.restore()
}
