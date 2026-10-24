// 仿真鱼缸 3D 引擎（three.js）：程序化拟真鱼类 + 玻璃缸/水体/焦散/水草/气泡
// 保持与旧 2D 引擎一致的公开 API：constructor(container, style, fish, lastFed) / setStyle / setFish / setLastFed / feed(x?) / destroy
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { TankStyle, FishSpecies, FishConfig } from './fishtankEngine'
import { MAX_FISH, TANK_STYLE_NAMES } from './fishtankEngine'

export { MAX_FISH, TANK_STYLE_NAMES }

// ---------- 常量 ----------

const HUNGER_S = 3 * 3600 // 饥饿度 0→1 需要 3 小时
const DEEP = 0.55 // 缸体纵深 / 缸体高
const MAX_ACTIVE_RENDERERS = 8 // 单页 WebGL 上下文预算
const REF_TANK_W = 250 // 2D 速度基准缸宽(px)：把物种表里的 px/s 归一化为「缸宽/秒」

let activeRenderers = 0 // 模块级 WebGL 上下文计数

// ---------- 通用工具 ----------

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

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

/** 一维 Catmull-Rom 采样：keys 为 [x, y] 升序数组 */
function sampleKeys(keys: [number, number][], s: number): number {
  const n = keys.length
  if (s <= keys[0][0]) return keys[0][1]
  if (s >= keys[n - 1][0]) return keys[n - 1][1]
  let i = 0
  while (i < n - 2 && s > keys[i + 1][0]) i++
  const p0 = keys[Math.max(0, i - 1)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(n - 1, i + 2)]
  const t = (s - p1[0]) / (p2[0] - p1[0] || 1)
  const t2 = t * t, t3 = t2 * t
  return 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
}

// ---------- 程序化纹理 ----------

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  return [c, ctx]
}

/** 高度图 → 法线贴图（Sobel） */
function heightToNormal(height: HTMLCanvasElement, strength = 1.6): THREE.CanvasTexture {
  const w = height.width, h = height.height
  const src = height.getContext('2d')!.getImageData(0, 0, w, h).data
  const [cv, ctx] = makeCanvas(w, h)
  const out = ctx.createImageData(w, h)
  const at = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) / 255 * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) / 255 * strength
      const nx = -dx, ny = -dy, nz = 1
      const len = Math.hypot(nx, ny, nz) || 1
      const o = (y * w + x) * 4
      out.data[o] = (nx / len * 0.5 + 0.5) * 255
      out.data[o + 1] = (ny / len * 0.5 + 0.5) * 255
      out.data[o + 2] = (nz / len * 0.5 + 0.5) * 255
      out.data[o + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

/** 鳞片高度图（叠瓦状半圆，行错位） */
function scaleHeightCanvas(size = 256, rows = 10): HTMLCanvasElement {
  const [cv, ctx] = makeCanvas(size, size)
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, size, size)
  const tw = size / rows, th = size / rows
  for (let r = -1; r <= rows; r++) {
    const off = (r % 2 === 0) ? 0 : tw * 0.5
    for (let c = -1; c <= rows; c++) {
      const x = c * tw + off, y = r * th
      const g = ctx.createRadialGradient(x, y - th * 0.35, 1, x, y, th * 0.95)
      g.addColorStop(0, 'rgba(235,235,235,1)')
      g.addColorStop(0.55, 'rgba(150,150,150,1)')
      g.addColorStop(1, 'rgba(70,70,70,1)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, th * 0.78, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  return cv
}

/** 身体颜色贴图：u=体长方向(0尾→1头)，v=环向(0.25背 / 0.75腹) */
function bodyColorTexture(col: { top: string; mid: string; belly: string }, pattern: string, seed: number, vein?: string): THREE.CanvasTexture {
  const w = 256, h = 256
  const [cv, ctx] = makeCanvas(w, h)
  // 环向渐变（无缝：0 与 1 对齐，0.25=背暗 / 0.75=腹亮）
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0.0, col.mid)
  g.addColorStop(0.25, col.top)
  g.addColorStop(0.5, col.mid)
  g.addColorStop(0.75, col.belly)
  g.addColorStop(1.0, col.mid)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  // 多倍频斑驳：三档尺度叠加，消除"平涂/塑料"感
  const rnd = mulberry32(seed)
  const mottle = (n: number, rMin: number, rMax: number, alpha: number) => {
    ctx.globalAlpha = alpha
    for (let i = 0; i < n; i++) {
      const x = rnd() * w, y = rnd() * h, r = rMin + rnd() * (rMax - rMin)
      const mg = ctx.createRadialGradient(x, y, 0, x, y, r)
      mg.addColorStop(0, rnd() < 0.5 ? '#ffffff' : '#000000')
      mg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = mg
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
  }
  mottle(60, 8, 30, 0.05)
  mottle(160, 2, 8, 0.05)
  mottle(420, 0.5, 1.8, 0.28)
  // 体侧中段极淡的冷色虹彩带，压一压纯橙的塑料感
  const ir = ctx.createLinearGradient(w * 0.28, 0, w * 0.62, 0)
  ir.addColorStop(0, 'rgba(120,225,205,0)')
  ir.addColorStop(0.5, 'rgba(130,235,215,0.10)')
  ir.addColorStop(1, 'rgba(120,225,205,0)')
  ctx.fillStyle = ir
  ctx.fillRect(0, h * 0.08, w, h * 0.36)
  // 花纹
  if (pattern === 'patches') {
    ctx.globalAlpha = 0.85
    for (let i = 0; i < 5; i++) {
      const px = 30 + rnd() * (w - 60), py = h * 0.18 + rnd() * h * 0.64
      const pr = 14 + rnd() * 30
      ctx.fillStyle = vein || '#e8482f'
      ctx.beginPath()
      ctx.ellipse(px, py, pr * (1 + rnd() * 0.5), pr, rnd() * 1.2, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (pattern === 'clown') {
    ctx.globalAlpha = 0.95
    ctx.fillStyle = '#ffffff'
    for (let i = 0; i < 3; i++) {
      const cx = 46 + i * 78
      ctx.fillRect(cx - 13, 0, 26, h)
    }
  } else if (pattern === 'vstripe') {
    ctx.globalAlpha = 0.75
    ctx.fillStyle = vein || '#2a3238'
    for (let i = 0; i < 4; i++) {
      const cx = 52 + i * 56
      ctx.fillRect(cx - 6, 0, 12, h)
    }
  } else if (pattern === 'hstripe') {
    ctx.globalAlpha = 0.8
    ctx.fillStyle = vein || '#3a6ea8'
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(0, h * 0.2 + i * h * 0.13, w, 7)
    }
  } else if (pattern === 'neon') {
    ctx.globalAlpha = 0.95
    ctx.fillStyle = vein || '#3ee6ff'
    ctx.fillRect(0, h * 0.2, w, h * 0.06)
  }
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  return tex
}

/** 鳍膜贴图：uv.x=离根部距离(0根→1缘)，uv.y=角度。径向鳍条脉络 + 边缘透明 */
function finTexture(base: string, veinColor: string, seed: number): THREE.CanvasTexture {
  const w = 256, h = 256
  const [cv, ctx] = makeCanvas(w, h)
  // 基底不透明，边缘淡出用 alpha 蒙版在后面统一处理
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)
  // 鳍条脉络
  const rnd = mulberry32(seed)
  const n = 11
  for (let i = 0; i < n; i++) {
    const y = (i + 0.5) / n * h
    ctx.strokeStyle = veinColor
    ctx.globalAlpha = 0.22 + rnd() * 0.14
    ctx.lineWidth = 1.1
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.quadraticCurveTo(w * 0.5, y + (rnd() - 0.5) * 10, w, y + (rnd() - 0.5) * 20)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  // 根→缘 alpha 淡出：destination-in 只削透明度、不改颜色
  ctx.globalCompositeOperation = 'destination-in'
  const ag = ctx.createLinearGradient(0, 0, w, 0)
  ag.addColorStop(0, 'rgba(0,0,0,1)')
  ag.addColorStop(0.3, 'rgba(0,0,0,1)')
  ag.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = ag
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'source-over'
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

/** 沙底颗粒贴图 */
function sandTexture(top: string, bottom: string, seed: number): THREE.CanvasTexture {
  const w = 128, h = 128
  const [cv, ctx] = makeCanvas(w, h)
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, top)
  g.addColorStop(1, bottom)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  const rnd = mulberry32(seed)
  for (let i = 0; i < 900; i++) {
    ctx.globalAlpha = 0.25
    ctx.fillStyle = rnd() > 0.5 ? '#ffffff' : '#000000'
    ctx.beginPath()
    ctx.arc(rnd() * w, rnd() * h, 0.4 + rnd() * 0.9, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

/** 焦散光斑贴图（柔和斑块，可平铺动画） */
function causticsTexture(seed: number): THREE.CanvasTexture {
  const size = 256
  const [cv, ctx] = makeCanvas(size, size)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size, size)
  const rnd = mulberry32(seed)
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 42; i++) {
    const x = rnd() * size, y = rnd() * size, r = 10 + rnd() * 30
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(255,255,255,0.9)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(x, y, r * (1 + rnd() * 0.6), r, rnd() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

/** 水体渐变背景贴图：竖向渐变 + 水平光带 + 底部浑浊 + 细微颗粒 */
function waterBackgroundTexture(t: TankDef): THREE.CanvasTexture {
  const size = 256
  const [cv, ctx] = makeCanvas(size, size)
  const g = ctx.createLinearGradient(0, 0, 0, size)
  g.addColorStop(0, t.waterTop)
  g.addColorStop(0.42, t.waterMid)
  g.addColorStop(0.8, t.waterBottom)
  g.addColorStop(1, t.waterBottom)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  const rnd = mulberry32(hashStr(t.waterTop))
  // 水平方向的"水层"微光带，破掉纯渐变的平涂感
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 7; i++) {
    const y = rnd() * size * 0.75
    const hgt = 6 + rnd() * 26
    const bg = ctx.createLinearGradient(0, y - hgt, 0, y + hgt)
    bg.addColorStop(0, 'rgba(255,255,255,0)')
    bg.addColorStop(0.5, `rgba(210,240,255,${0.05 + rnd() * 0.05})`)
    bg.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = bg
    ctx.fillRect(0, y - hgt, size, hgt * 2)
  }
  ctx.globalCompositeOperation = 'source-over'
  // 底部浑浊（悬浮颗粒聚集）+ 四角压暗
  const murk = ctx.createRadialGradient(size * 0.5, size * 1.05, size * 0.2, size * 0.5, size * 1.02, size * 0.75)
  murk.addColorStop(0, 'rgba(0,0,0,0.30)')
  murk.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = murk
  ctx.fillRect(0, 0, size, size)
  // 细微颗粒（水中悬浮物）
  for (let i = 0; i < 700; i++) {
    ctx.globalAlpha = 0.05 + rnd() * 0.07
    ctx.fillStyle = rnd() > 0.4 ? '#ffffff' : '#0a1a22'
    ctx.beginPath()
    ctx.arc(rnd() * size, rnd() * size, 0.3 + rnd() * 0.9, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 背景幕布贴图：径向压暗（中心亮、四角暗），铺满画布以消除缸体外的纯色边框 */
function backdropTexture(t: TankDef): THREE.CanvasTexture {
  const size = 256
  const [cv, ctx] = makeCanvas(size, size)
  const g = ctx.createRadialGradient(size * 0.5, size * 0.42, size * 0.05, size * 0.5, size * 0.5, size * 0.72)
  g.addColorStop(0, t.waterMid)
  g.addColorStop(0.55, t.waterBottom)
  g.addColorStop(1, t.waterBottom)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  // 竖向再加一层暗，让上亮下暗
  const vg = ctx.createLinearGradient(0, 0, 0, size)
  vg.addColorStop(0, 'rgba(255,255,255,0.10)')
  vg.addColorStop(0.55, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.42)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 后期：暗角 + 胶片颗粒 + 轻微色差 + 冷暗部/暖高光分级 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.62 },
    uGrain: { value: 0.020 },
    uAberration: { value: 0.0022 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      // 径向色差：镜头边缘 RGB 分光
      vec2 off = d * uAberration * (0.4 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv - off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + off).b;
      // 暗角
      float vig = smoothstep(1.05, 0.18, r2 * 2.4);
      col *= mix(1.0, vig, uVignette);
      // 胶片颗粒
      float n = fract(sin(dot(uv * uRes, vec2(12.9898, 78.233)) + uTime * 41.37) * 43758.5453);
      col += (n - 0.5) * uGrain;
      // 分级：暗部偏青、亮部偏暖
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 shadowTint = vec3(0.92, 0.98, 1.06);
      vec3 highTint = vec3(1.05, 1.01, 0.95);
      col = mix(col * shadowTint, col * highTint, smoothstep(0.15, 0.75, l));
      gl_FragColor = vec4(col, 1.0);
    }`,
}

/** 极简环境贴图（供玻璃/鱼体反射） */
function envTexture(): THREE.CanvasTexture {
  const [cv, ctx] = makeCanvas(256, 128)
  const g = ctx.createLinearGradient(0, 0, 0, 128)
  g.addColorStop(0, '#eaf6ff')
  g.addColorStop(0.45, '#cfe6f5')
  g.addColorStop(0.55, '#7fb8d8')
  g.addColorStop(1, '#274b63')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 128)
  const tex = new THREE.CanvasTexture(cv)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 径向柔光贴图（光柱用） */
function rayTexture(): THREE.CanvasTexture {
  const [cv, ctx] = makeCanvas(64, 256)
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.7, 'rgba(255,255,255,0.15)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 256)
  // 两侧羽化
  const hg = ctx.createLinearGradient(0, 0, 64, 0)
  hg.addColorStop(0, 'rgba(0,0,0,1)')
  hg.addColorStop(0.5, 'rgba(0,0,0,0)')
  hg.addColorStop(1, 'rgba(0,0,0,1)')
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = hg
  ctx.fillRect(0, 0, 64, 256)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// ---------- 缸体样式 ----------

interface TankDef {
  waterTop: string
  waterMid: string
  waterBottom: string
  rayColor: string
  rayOpacity: number
  rays: number
  sandTop: string
  sandBottom: string
  plantColors: string[]
  plantClusters: number[]
  rockColor: string
  decor: 'stone' | 'eco' | 'sea'
  causticStrength: number
}

const TANKS: Record<TankStyle, TankDef> = {
  classic: {
    waterTop: '#9ecbe2', waterMid: '#4d8fb4', waterBottom: '#123c56',
    rayColor: '#fff8e6', rayOpacity: 0.14, rays: 3,
    sandTop: '#e8d9b4', sandBottom: '#a89068',
    plantColors: ['#3a8f47', '#4fa45e', '#2a7a3f'],
    plantClusters: [0.2, 0.31], rockColor: '#8e979c', decor: 'stone', causticStrength: 0.5,
  },
  eco: {
    waterTop: '#a8c6ae', waterMid: '#4d8068', waterBottom: '#143a30',
    rayColor: '#fff3cf', rayOpacity: 0.15, rays: 3,
    sandTop: '#5c4a38', sandBottom: '#2c231a',
    plantColors: ['#2a7a3f', '#3f9351', '#63b463', '#a5523a'],
    plantClusters: [0.12, 0.24, 0.82], rockColor: '#5c636b', decor: 'eco', causticStrength: 0.38,
  },
  sea: {
    waterTop: '#74b6d6', waterMid: '#1e6c98', waterBottom: '#052e47',
    rayColor: '#d6f6ff', rayOpacity: 0.2, rays: 4,
    sandTop: '#ece5d4', sandBottom: '#c3b79c',
    plantColors: ['#6b4f80', '#4f8070', '#80606c'],
    plantClusters: [0.18, 0.3], rockColor: '#c2baa8', decor: 'sea', causticStrength: 0.62,
  },
}

// ---------- 物种 3D 参数 ----------

type TailKind = 'veil' | 'fan' | 'fork' | 'triangle'

interface Species3D {
  size: number
  top: [number, number][]
  bot: [number, number][]
  wid: [number, number][]
  tail: TailKind
  tailScale: number
  dorsal: number
  pattern: string
  vein?: string
  colors: { top: string; mid: string; belly: string; fin: string; finVein: string; iris: string }
  speed: [number, number]
}

export const SPECIES3D: Record<FishSpecies, Species3D> = {
  // 金鱼：蛋形圆腹、深橙背浅黄腹、飘逸蝶尾
  goldfish: {
    size: 1.0,
    top: [[0, 0.02], [0.08, 0.08], [0.18, 0.15], [0.32, 0.23], [0.45, 0.29], [0.58, 0.28], [0.7, 0.24], [0.82, 0.18], [0.9, 0.12], [1, 0.05]],
    bot: [[0, 0.02], [0.08, 0.11], [0.18, 0.22], [0.32, 0.33], [0.45, 0.41], [0.58, 0.39], [0.7, 0.33], [0.82, 0.23], [0.9, 0.12], [1, 0.05]],
    wid: [[0, 0.02], [0.1, 0.10], [0.3, 0.21], [0.5, 0.25], [0.7, 0.21], [0.9, 0.10], [1, 0.05]],
    tail: 'veil', tailScale: 0.9, dorsal: 0.30,
    pattern: 'plain',
    colors: { top: '#f2791f', mid: '#ff9a3c', belly: '#ffe6b0', fin: '#ffb45e', finVein: '#e06a20', iris: '#2a1a10' },
    speed: [10, 20],
  },
  koi: {
    size: 1.15,
    top: [[0, 0.02], [0.1, 0.10], [0.25, 0.18], [0.45, 0.24], [0.6, 0.24], [0.78, 0.18], [0.92, 0.09], [1, 0.02]],
    bot: [[0, 0.02], [0.1, 0.11], [0.25, 0.20], [0.45, 0.27], [0.6, 0.27], [0.78, 0.20], [0.92, 0.10], [1, 0.02]],
    wid: [[0, 0.02], [0.12, 0.13], [0.4, 0.20], [0.7, 0.18], [0.92, 0.08], [1, 0.02]],
    tail: 'fan', tailScale: 0.95, dorsal: 0.2,
    pattern: 'patches', vein: '#e8482f',
    colors: { top: '#efe9dc', mid: '#fbf7ee', belly: '#ffffff', fin: '#f4ded0', finVein: '#d8a878', iris: '#2a1a10' },
    speed: [16, 28],
  },
  guppy: {
    size: 0.6,
    top: [[0, 0.02], [0.12, 0.12], [0.35, 0.22], [0.6, 0.22], [0.85, 0.12], [1, 0.02]],
    bot: [[0, 0.02], [0.12, 0.13], [0.35, 0.24], [0.6, 0.24], [0.85, 0.13], [1, 0.02]],
    wid: [[0, 0.02], [0.15, 0.12], [0.5, 0.18], [0.85, 0.10], [1, 0.02]],
    tail: 'fan', tailScale: 0.85, dorsal: 0.28,
    pattern: 'hstripe', vein: '#8f5cff',
    colors: { top: '#8fa4c4', mid: '#cfd8e6', belly: '#eef2f7', fin: '#ff6fa5', finVein: '#8f5cff', iris: '#2a1a10' },
    speed: [26, 46],
  },
  angelfish: {
    size: 0.9,
    top: [[0, 0.03], [0.12, 0.20], [0.3, 0.34], [0.5, 0.36], [0.68, 0.30], [0.82, 0.20], [0.93, 0.09], [1, 0.03]],
    bot: [[0, 0.03], [0.12, 0.24], [0.3, 0.40], [0.5, 0.44], [0.68, 0.38], [0.82, 0.24], [0.93, 0.10], [1, 0.03]],
    wid: [[0, 0.02], [0.15, 0.08], [0.5, 0.12], [0.85, 0.06], [1, 0.02]],
    tail: 'triangle', tailScale: 0.9, dorsal: 1.15,
    pattern: 'vstripe', vein: '#2a3238',
    colors: { top: '#d7e0e8', mid: '#eef3f6', belly: '#fbfdfe', fin: '#dbe4ea', finVein: '#8a97a3', iris: '#2a1a10' },
    speed: [9, 16],
  },
  zebrafish: {
    size: 0.5,
    top: [[0, 0.02], [0.15, 0.10], [0.4, 0.16], [0.65, 0.15], [0.88, 0.09], [1, 0.02]],
    bot: [[0, 0.02], [0.15, 0.11], [0.4, 0.17], [0.65, 0.16], [0.88, 0.10], [1, 0.02]],
    wid: [[0, 0.02], [0.2, 0.10], [0.5, 0.13], [0.88, 0.07], [1, 0.02]],
    tail: 'fork', tailScale: 0.9, dorsal: 0.18,
    pattern: 'hstripe', vein: '#3a6ea8',
    colors: { top: '#b8c8d8', mid: '#dfe9f2', belly: '#f2f7fb', fin: '#cfdbe6', finVein: '#7f9ab5', iris: '#2a1a10' },
    speed: [32, 52],
  },
  betta: {
    size: 0.75,
    top: [[0, 0.02], [0.12, 0.14], [0.35, 0.24], [0.55, 0.24], [0.78, 0.17], [0.92, 0.08], [1, 0.02]],
    bot: [[0, 0.02], [0.12, 0.16], [0.35, 0.28], [0.55, 0.28], [0.78, 0.19], [0.92, 0.09], [1, 0.02]],
    wid: [[0, 0.02], [0.15, 0.10], [0.5, 0.16], [0.85, 0.09], [1, 0.02]],
    tail: 'veil', tailScale: 1.0, dorsal: 0.5,
    pattern: 'plain',
    colors: { top: '#a8243c', mid: '#c2334d', belly: '#d95f70', fin: '#d94f66', finVein: '#8c1f33', iris: '#2a1a10' },
    speed: [7, 13],
  },
  clownfish: {
    size: 0.65,
    top: [[0, 0.02], [0.12, 0.14], [0.4, 0.22], [0.62, 0.22], [0.85, 0.12], [1, 0.02]],
    bot: [[0, 0.02], [0.12, 0.15], [0.4, 0.24], [0.62, 0.24], [0.85, 0.13], [1, 0.02]],
    wid: [[0, 0.02], [0.15, 0.12], [0.5, 0.18], [0.85, 0.10], [1, 0.02]],
    tail: 'fan', tailScale: 0.85, dorsal: 0.26,
    pattern: 'clown',
    colors: { top: '#ee7222', mid: '#ff8c33', belly: '#ffa356', fin: '#f28040', finVein: '#c05515', iris: '#2a1a10' },
    speed: [14, 26],
  },
  neon: {
    size: 0.45,
    top: [[0, 0.02], [0.15, 0.09], [0.4, 0.15], [0.65, 0.14], [0.88, 0.08], [1, 0.02]],
    bot: [[0, 0.02], [0.15, 0.10], [0.4, 0.16], [0.65, 0.15], [0.88, 0.09], [1, 0.02]],
    wid: [[0, 0.02], [0.2, 0.09], [0.5, 0.12], [0.88, 0.06], [1, 0.02]],
    tail: 'fork', tailScale: 0.8, dorsal: 0.16,
    pattern: 'neon', vein: '#3ee6ff',
    colors: { top: '#a8c4d4', mid: '#d8e8f0', belly: '#f0f7fb', fin: '#c8d8e2', finVein: '#6f97b0', iris: '#2a1a10' },
    speed: [28, 46],
  },
}

// ---------- 波形着色器注入 ----------

interface WaveOpts {
  amp: number   // 位移幅度
  freq: number  // 时间频率
  k: number     // 沿轴波长
  axis: 'x' | 'y' | 'z'
  driveU: number // 1=幅度随 uv.x 增长；-1=随 1-uv.x（尾强）；0=恒定 ampBase
  ampBase: number
}

const U_TIME = { value: 0 }

function makeWaveMaterial(base: THREE.Material, opts: WaveOpts, phase: number): THREE.Material {
  const mat = base as THREE.Material & { userData: any }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U_TIME
    shader.uniforms.uWave = { value: new THREE.Vector4(opts.amp, opts.freq, opts.k, phase) }
    shader.uniforms.uWaveCfg = { value: new THREE.Vector2(opts.ampBase, opts.driveU) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform vec4 uWave;
        uniform vec2 uWaveCfg;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float travel = uWave.z * transformed.x;
          float ph = uTime * uWave.y + travel + uWave.w;
          // 三频叠加的非周期摆动，避免完美正弦的机械感
          float w = sin(ph) * 0.6 + sin(ph * 1.8 + 1.3) * 0.3 + sin(ph * 0.53 + 2.7) * 0.15;
          float grow = uv.x;
          if (uWaveCfg.y < -0.5) grow = 1.0 - uv.x;
          else if (uWaveCfg.y < 0.5) grow = 1.0;
          grow = max(grow, uWaveCfg.x);
          transformed.${opts.axis} += w * uWave.x * grow;
        }`)
    mat.userData.shader = shader
  }
  mat.customProgramCacheKey = () => `wave-${opts.axis}-${opts.driveU}`
  return mat
}

// ---------- 几何构建 ----------

/** 参数化身体：沿脊柱放样椭圆截面 */
function buildBodyGeometry(sp: Species3D, len: number): THREE.BufferGeometry {
  const NA = 44, NR = 22
  const pos: number[] = []
  const uv: number[] = []
  const index: number[] = []
  for (let i = 0; i <= NA; i++) {
    const s = i / NA
    const x = -len * 0.5 + len * s
    const hTop = sampleKeys(sp.top, s) * len
    const hBot = sampleKeys(sp.bot, s) * len
    const hw = sampleKeys(sp.wid, s) * len
    for (let j = 0; j <= NR; j++) {
      const a = (j / NR) * Math.PI * 2
      const sa = Math.sin(a)
      const r = sa >= 0 ? hTop : hBot
      pos.push(x, sa * r, Math.cos(a) * hw)
      uv.push(s, j / NR)
    }
  }
  for (let i = 0; i < NA; i++) {
    for (let j = 0; j < NR; j++) {
      const a = i * (NR + 1) + j
      const b = a + NR + 1
      index.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

/** 鳍几何：从 2D 轮廓生成，UV.x 为离根距离、UV.y 为角度 */
function buildFinGeometry(points: [number, number][], root: [number, number]): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p[0], p[1])))
  const geo = new THREE.ShapeGeometry(shape, 6)
  const p = geo.attributes.position
  const uv: number[] = []
  let maxD = 0.0001
  for (let i = 0; i < p.count; i++) {
    const dx = p.getX(i) - root[0], dy = p.getY(i) - root[1]
    maxD = Math.max(maxD, Math.hypot(dx, dy))
  }
  for (let i = 0; i < p.count; i++) {
    const dx = p.getX(i) - root[0], dy = p.getY(i) - root[1]
    const d = Math.hypot(dx, dy)
    const ang = Math.atan2(dy, dx) / (Math.PI * 2) + 0.5
    uv.push(clamp(d / maxD, 0, 1), ang)
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  return geo
}

/** 尾部轮廓（以尾柄为原点，向后延伸） */
function tailPoints(kind: TailKind, len: number, scale: number): { pts: [number, number][]; root: [number, number] } {
  const L = len * scale
  const root: [number, number] = [0, 0]
  if (kind === 'veil') {
    // 蝶尾/纱尾：双叶飘逸
    const pts: [number, number][] = [
      [0, 0.03 * L], [-0.35 * L, 0.22 * L], [-0.82 * L, 0.42 * L], [-1.15 * L, 0.30 * L],
      [-0.9 * L, 0.10 * L], [-0.78 * L, 0.02 * L], [-1.02 * L, -0.16 * L], [-0.9 * L, -0.36 * L],
      [-0.5 * L, -0.26 * L], [-0.2 * L, -0.08 * L], [0, -0.03 * L],
    ]
    return { pts, root }
  }
  if (kind === 'fan') {
    const pts: [number, number][] = [
      [0, 0.05 * L], [-0.4 * L, 0.34 * L], [-0.72 * L, 0.30 * L], [-0.5 * L, 0.02 * L],
      [-0.72 * L, -0.30 * L], [-0.4 * L, -0.34 * L], [0, -0.05 * L],
    ]
    return { pts, root }
  }
  if (kind === 'fork') {
    const pts: [number, number][] = [
      [0, 0.03 * L], [-0.55 * L, 0.26 * L], [-0.75 * L, 0.22 * L], [-0.4 * L, 0.02 * L],
      [-0.75 * L, -0.22 * L], [-0.55 * L, -0.26 * L], [0, -0.03 * L],
    ]
    return { pts, root }
  }
  // triangle（神仙鱼）
  const pts: [number, number][] = [
    [0, 0.16 * L], [-0.85 * L, 0.06 * L], [-1.0 * L, 0], [-0.85 * L, -0.06 * L], [0, -0.16 * L],
  ]
  return { pts, root }
}

// ---------- 鱼对象 ----------

interface FishRuntime {
  id: string
  species: FishSpecies
  variant: number
  seed: number
  len: number
  group: THREE.Group
  materials: THREE.Material[]
  finMats: { mat: THREE.Material; phase: number }[]
  vmax: number
  cruise: number
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  tx: number; ty: number; tz: number
  retarget: number
  pulse: number
  /** 个体食欲 0.15~1.0，决定它是否会主动抢食（避免全体同步涌上） */
  appetite: number
  /** 发现食物后的反应时刻（0=未锁定），形成错峰取食 */
  reactAt: number
}

export class FishTankEngine {
  private container: HTMLElement
  private renderer: THREE.WebGLRenderer | null = null
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(32, 1, 0.05, 40)
  private envGroup = new THREE.Group()
  private fishGroup = new THREE.Group()
  private fish: FishRuntime[] = []
  private food: { mesh: THREE.Mesh; vy: number; settledAt: number | null }[] = []
  private foodPool: THREE.Mesh[] = []
  private bubbles: { mesh: THREE.Mesh; vy: number; phase: number; born: number }[] = []
  private bubblePool: THREE.Mesh[] = []
  private caustics: THREE.Mesh | null = null
  private causticTex: THREE.CanvasTexture | null = null
  private rays: { mesh: THREE.Mesh; phase: number; baseX: number }[] = []
  private plants: { mesh: THREE.Mesh; phase: number }[] = []
  private waterSurface: THREE.Mesh | null = null
  private style: TankStyle = 'classic'
  private hunger = 0
  private t = 0
  private raf = 0
  private lastTs = 0
  private running = false
  private destroyed = false
  private inView = true
  private docHidden = false
  private bubbleAcc = 0
  private ambientAcc = 0
  private io: IntersectionObserver | null = null
  private ro: ResizeObserver | null = null
  private W = 1; private H = 1
  private tankW = 1.2; private tankH = 1; private tankD = 0.55
  private foodMesh: THREE.SphereGeometry | null = null
  private bubbleGeo: THREE.SphereGeometry | null = null
  private ownEnvMap: THREE.Texture | null = null
  private backgroundTex: THREE.CanvasTexture | null = null
  private motes: THREE.Points | null = null
  private composer: EffectComposer | null = null
  private bloomPass: UnrealBloomPass | null = null
  private gradePass: ShaderPass | null = null

  constructor(container: HTMLElement, style: TankStyle, fish: FishConfig[], lastFed: number) {
    this.container = container
    activeRenderers++
    if (activeRenderers > MAX_ACTIVE_RENDERERS) { activeRenderers--; this.destroyed = true; return }
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' })
    } catch {
      activeRenderers--; this.destroyed = true; return
    }
    const r = this.renderer
    r.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1))
    r.toneMapping = THREE.ACESFilmicToneMapping
    r.toneMappingExposure = 1.12
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap
    r.domElement.style.width = '100%'
    r.domElement.style.height = '100%'
    r.domElement.style.display = 'block'
    container.appendChild(r.domElement)

    this.setupEnv()
    this.scene.add(this.envGroup, this.fishGroup)

    this.docHidden = document.hidden
    this.setLastFed(lastFed)
    this.style = style
    this.buildEnv()
    this.setFish(fish)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.io = new IntersectionObserver(es => {
      this.inView = es[0]?.isIntersecting ?? true
      this.syncRun()
    }, { threshold: 0.01 })
    this.io.observe(container)
    document.addEventListener('visibilitychange', this.onVis)
    this.resize()
    this.syncRun()
  }

  private onVis = () => { this.docHidden = document.hidden; this.syncRun() }

  // ---- 公开 API ----

  setStyle(style: TankStyle): void {
    if (this.destroyed) return
    if (style === this.style && this.envGroup.children.length) return
    this.style = style
    this.buildEnv()
  }

  setFish(cfgs: FishConfig[]): void {
    if (this.destroyed) return
    const byId = new Map(this.fish.map(f => [f.id, f]))
    const next: FishRuntime[] = []
    for (const c of cfgs.slice(0, MAX_FISH)) {
      const ex = byId.get(c.id)
      if (ex) { next.push(ex); continue }
      next.push(this.makeFish(c))
    }
    // 移除不在列表中的
    for (const f of this.fish) {
      if (!next.includes(f)) {
        this.fishGroup.remove(f.group)
        this.disposeFish(f)
      }
    }
    this.fish = next
    this.placeFish()
  }

  setLastFed(ts: number): void {
    if (!ts) return
    this.hunger = Math.max(this.hunger, clamp((Date.now() - ts) / 1000 / HUNGER_S, 0, 1))
  }

  feed(x?: number): void {
    if (this.destroyed || !this.renderer) return
    if (this.food.length > 60) return
    const worldX = x != null ? clamp((x / this.W - 0.5) * this.tankW, -this.tankW * 0.46, this.tankW * 0.46) : (Math.random() - 0.5) * this.tankW * 0.7
    const n = 6 + Math.floor(Math.random() * 4)
    for (let i = 0; i < n; i++) {
      const mesh = this.foodPool.pop() || this.acquireFood()
      mesh.position.set(
        worldX + (Math.random() - 0.5) * 0.05,
        this.tankH * 0.5 - 0.02,
        (Math.random() - 0.5) * this.tankD * 0.6,
      )
      mesh.visible = true
      mesh.scale.setScalar(0.8 + Math.random() * 0.7)
      this.scene.add(mesh)
      this.food.push({ mesh, vy: 0.05 + Math.random() * 0.06, settledAt: null })
    }
    this.hunger = Math.max(this.hunger, 0.7)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.syncRun()
    try { this.ro?.disconnect() } catch { /* noop */ }
    try { this.io?.disconnect() } catch { /* noop */ }
    document.removeEventListener('visibilitychange', this.onVis)
    for (const f of this.fish) this.disposeFish(f)
    this.fish = []
    for (const m of [...this.foodPool, ...this.bubblePool, ...this.food.map(f => f.mesh), ...this.bubbles.map(b => b.mesh)]) {
      if (m.parent) m.parent.remove(m)
    }
    this.foodPool = []; this.bubblePool = []; this.food = []; this.bubbles = []
    this.disposeEnv()
    this.ownEnvMap?.dispose()
    this.scene.environment = null
    this.composer?.dispose()
    this.bloomPass?.dispose()
    this.gradePass?.dispose()
    this.composer = null; this.bloomPass = null; this.gradePass = null
    this.backgroundTex?.dispose()
    this.backgroundTex = null
    this.scene.background = null
    if (this.renderer) {
      this.renderer.dispose()
      this.renderer.domElement.remove()
      this.renderer = null
    }
    activeRenderers--
  }

  // ---- 内部：生命周期 ----

  private syncRun(): void {
    const should = this.inView && !this.docHidden && !this.destroyed
    if (should && !this.running) {
      this.running = true
      this.lastTs = 0
      this.raf = requestAnimationFrame(this.loop)
    } else if (!should && this.running) {
      this.running = false
      cancelAnimationFrame(this.raf)
    }
  }

  private loop = (ts: number): void => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.loop)
    if (!this.lastTs) { this.lastTs = ts; return }
    let dt = (ts - this.lastTs) / 1000
    this.lastTs = ts
    if (dt > 0.05) dt = 0.05
    if (dt <= 0) return
    this.t += dt
    this.update(dt)
    if (this.gradePass) this.gradePass.uniforms.uTime.value = this.t
    if (this.composer) this.composer.render()
    else if (this.renderer) this.renderer.render(this.scene, this.camera)
  }

  private resize(): void {
    if (this.destroyed || !this.renderer) return
    const rect = this.container.getBoundingClientRect()
    if (rect.width < 4 || rect.height < 4) return
    this.W = rect.width; this.H = rect.height
    const aspect = rect.width / rect.height
    this.tankH = 1
    this.tankW = aspect
    this.tankD = DEEP * this.tankH
    this.renderer.setSize(rect.width, rect.height, false)
    this.camera.aspect = aspect
    const fov = THREE.MathUtils.degToRad(this.camera.fov)
    // 让前玻璃刚好铺满画面：相机到原点距离 = 贴合半高/tan(fov/2) + 缸体半深
    const dist = Math.max(this.tankH / 2 / Math.tan(fov / 2), this.tankW / 2 / (Math.tan(fov / 2) * aspect))
    this.camera.position.set(0, 0.02, this.tankD / 2 + dist)
    this.camera.lookAt(0, 0, 0)
    this.camera.updateProjectionMatrix()
    if (!this.composer) this.setupComposer()
    this.composer?.setSize(rect.width, rect.height)
    if (this.gradePass) this.gradePass.uniforms.uRes.value.set(rect.width, rect.height)
    this.buildEnv()
    this.placeFish()
  }

  /** 后期处理链：渲染 → 泛光 → 暗角/颗粒/色差/分级 → 色调映射输出 */
  private setupComposer(): void {
    if (!this.renderer) return
    const composer = new EffectComposer(this.renderer)
    composer.addPass(new RenderPass(this.scene, this.camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(this.W, this.H), 0.32, 0.6, 0.85)
    composer.addPass(bloom)
    const grade = new ShaderPass(GradeShader)
    grade.uniforms.uRes.value.set(this.W, this.H)
    composer.addPass(grade)
    composer.addPass(new OutputPass())
    this.composer = composer
    this.bloomPass = bloom
    this.gradePass = grade
  }

  private setupEnv(): void {
    const env = envTexture()
    const pmrem = new THREE.PMREMGenerator(this.renderer!)
    const rt = pmrem.fromEquirectangular(env)
    this.ownEnvMap = rt.texture
    this.scene.environment = rt.texture
    env.dispose()
    pmrem.dispose()

    this.scene.fog = new THREE.FogExp2(new THREE.Color(TANKS.classic.waterBottom), 0.10)
    const hemi = new THREE.HemisphereLight(0xdff2ff, 0x24404f, 0.85)
    this.scene.add(hemi)
    const dir = new THREE.DirectionalLight(0xfff4e0, 1.5)
    dir.position.set(0.5, 1.6, 1.1)
    dir.castShadow = true
    dir.shadow.mapSize.set(1024, 1024)
    const sc = dir.shadow.camera
    sc.left = -1.2; sc.right = 1.2; sc.top = 1.2; sc.bottom = -1.2; sc.near = 0.1; sc.far = 6
    this.scene.add(dir)
    const fill = new THREE.PointLight(0x9fd6ff, 0.6, 4, 2)
    fill.position.set(-0.6, 0.3, 0.8)
    this.scene.add(fill)
    this.foodMesh = new THREE.SphereGeometry(0.008, 6, 5)
    this.bubbleGeo = new THREE.SphereGeometry(1, 8, 6)
  }

  // ---- 内部：环境构建 ----

  private disposeEnv(): void {
    this.envGroup.traverse(o => {
      const m = o as THREE.Mesh & { material?: THREE.Material | THREE.Material[] }
      if (m.geometry) m.geometry.dispose()
      if (m.material) {
        const arr = Array.isArray(m.material) ? m.material : [m.material]
        for (const mat of arr) {
          const anym = mat as THREE.Material & { map?: THREE.Texture; normalMap?: THREE.Texture }
          anym.map?.dispose()
          anym.normalMap?.dispose()
          mat.dispose()
        }
      }
    })
    this.envGroup.clear()
    this.plants = []
    this.rays = []
    this.caustics = null
    this.causticTex = null
    this.waterSurface = null
    this.motes = null
  }

  private buildEnv(): void {
    if (!this.renderer) return
    this.disposeEnv()
    const def = TANKS[this.style]
    const W = this.tankW, H = this.tankH, D = this.tankD
    const rnd = mulberry32(hashStr(this.style + ':env'))
    ;(this.scene.fog as THREE.FogExp2).color = new THREE.Color(def.waterBottom)
    ;(this.scene.fog as THREE.FogExp2).density = this.style === 'sea' ? 0.16 : 0.13
    // 背景幕布：径向压暗的水色渐变，铺满整屏，消除"纯色相框"边框
    this.backgroundTex?.dispose()
    this.backgroundTex = backdropTexture(def)
    this.scene.background = this.backgroundTex

    // 后壁（水体背景）：放大到覆盖整个视锥，使水色充满画面
    const backTex = waterBackgroundTexture(def)
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 1.5, H * 1.5),
      new THREE.MeshBasicMaterial({ map: backTex, fog: false }),
    )
    back.position.set(0, 0, -D / 2)
    this.envGroup.add(back)

    // 底砂
    const sandTex = sandTexture(def.sandTop, def.sandBottom, hashStr(this.style + ':sand'))
    sandTex.repeat.set(3, 2)
    const sandGeo = new THREE.PlaneGeometry(W * 1.5, D * 1.4, 24, 16)
    const sandPos = sandGeo.attributes.position
    for (let i = 0; i < sandPos.count; i++) {
      sandPos.setZ(i, Math.sin(sandPos.getX(i) * 9 + 1.3) * 0.006 + (rnd() - 0.5) * 0.004)
    }
    sandGeo.computeVertexNormals()
    const sand = new THREE.Mesh(sandGeo, new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.98, metalness: 0, color: def.sandTop }))
    sand.rotation.x = -Math.PI / 2
    sand.position.set(0, -H / 2, 0)
    sand.receiveShadow = true
    this.envGroup.add(sand)

    // 前玻璃（含反射高光/眩光条纹）
    const front = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 1.5, H * 1.5),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff, transparent: true, opacity: 0.05, roughness: 0.03, metalness: 0,
        clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4, side: THREE.FrontSide, depthWrite: false,
      }),
    )
    front.position.set(0, 0, D / 2)
    this.envGroup.add(front)
    this.buildGlassGlare(rnd)

    // 焦散（沙面上方，叠加混合）
    this.causticTex = causticsTexture(hashStr(this.style + ':caus'))
    this.causticTex.repeat.set(3, 2)
    const cm = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 1.5, D * 1.4),
      new THREE.MeshBasicMaterial({ map: this.causticTex, transparent: true, opacity: def.causticStrength, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    )
    cm.rotation.x = -Math.PI / 2
    cm.position.set(0, -H / 2 + 0.012, 0)
    this.caustics = cm
    this.envGroup.add(cm)

    // 水面
    this.waterSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 1.5, D * 1.6, 1, 1),
      new THREE.MeshPhysicalMaterial({
        color: 0xdff4ff, transparent: true, opacity: 0.30, roughness: 0.06, metalness: 0,
        clearcoat: 1, clearcoatRoughness: 0.04, side: THREE.DoubleSide, depthWrite: false,
      }),
    )
    this.waterSurface.rotation.x = -Math.PI / 2
    this.waterSurface.position.set(0, H / 2 - 0.015, 0)
    this.envGroup.add(this.waterSurface)

    // 悬浮微粒（视差，增强水深与真实感）
    this.buildMotes(rnd)

    // 装饰：石/沉木/珊瑚
    this.buildDecor(rnd)

    // 水草
    this.buildPlants(def, rnd)

    // 光柱
    const rayTex = rayTexture()
    for (let i = 0; i < def.rays; i++) {
      const bx = W * (0.16 + 0.68 * (def.rays > 1 ? i / (def.rays - 1) : 0.5))
      const w = 0.12 + i * 0.03
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, H * 0.92),
        new THREE.MeshBasicMaterial({ map: rayTex, color: def.rayColor, transparent: true, opacity: def.rayOpacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }),
      )
      mesh.position.set(bx, -H * 0.02, -D / 2 + 0.02)
      mesh.rotation.z = -0.12 + i * 0.03
      this.envGroup.add(mesh)
      this.rays.push({ mesh, phase: i * 1.7, baseX: bx })
    }
  }

  /** 前玻璃上的斜向眩光条纹（真实鱼缸摄影常见的反光） */
  private buildGlassGlare(rnd: () => number): void {
    const W = this.tankW, H = this.tankH
    for (let i = 0; i < 2; i++) {
      const [cv, ctx] = makeCanvas(256, 256)
      const g = ctx.createLinearGradient(0, 0, 128, 256)
      g.addColorStop(0.0, 'rgba(255,255,255,0)')
      g.addColorStop(0.45, 'rgba(255,255,255,0.5)')
      g.addColorStop(0.55, 'rgba(255,255,255,0.5)')
      g.addColorStop(1.0, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 256, 256)
      const tex = new THREE.CanvasTexture(cv)
      tex.colorSpace = THREE.SRGBColorSpace
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(W * 0.5, H * 1.7),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.055 + rnd() * 0.02, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      )
      mesh.position.set((-0.22 + i * 0.42) * W, 0, this.tankD / 2 + 0.002)
      mesh.rotation.z = 0.42 - i * 0.12
      this.envGroup.add(mesh)
    }
  }

  /** 水中悬浮微粒：轻微视差，制造体积感 */
  private buildMotes(rnd: () => number): void {
    const W = this.tankW, H = this.tankH, D = this.tankD
    const n = 260
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() - 0.5) * W * 1.1
      pos[i * 3 + 1] = (rnd() - 0.5) * H * 0.95
      pos[i * 3 + 2] = (rnd() - 0.5) * D * 0.9
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const [cv, ctx] = makeCanvas(32, 32)
    const rg = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
    rg.addColorStop(0, 'rgba(255,255,255,0.85)')
    rg.addColorStop(0.5, 'rgba(220,240,255,0.28)')
    rg.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = rg
    ctx.fillRect(0, 0, 32, 32)
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.PointsMaterial({ map: tex, size: 0.012, transparent: true, opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })
    const pts = new THREE.Points(geo, mat)
    pts.userData.motes = true
    this.motes = pts
    this.envGroup.add(pts)
  }

  private buildDecor(rnd: () => number): void {
    const def = TANKS[this.style]
    const W = this.tankW, H = this.tankH
    const floorY = -H / 2
    const rockMat = new THREE.MeshStandardMaterial({ color: def.rockColor, roughness: 0.95, metalness: 0 })
    const addRock = (fx: number, r: number, squash: number) => {
      const g = new THREE.IcosahedronGeometry(r, 2)
      const p = g.attributes.position
      for (let i = 0; i < p.count; i++) {
        const nx = p.getX(i), ny = p.getY(i), nz = p.getZ(i)
        const n = Math.sin(nx * 12 + ny * 7) * 0.06 + Math.sin(nz * 15) * 0.05
        const k = 1 + n
        p.setXYZ(i, nx * k, ny * k * squash, nz * k)
      }
      g.computeVertexNormals()
      const m = new THREE.Mesh(g, rockMat)
      m.position.set(fx * W, floorY + r * squash * 0.65, (rnd() - 0.5) * 0.1)
      m.castShadow = true; m.receiveShadow = true
      this.envGroup.add(m)
    }
    if (def.decor === 'stone') {
      addRock(0.34, 0.055, 0.7); addRock(0.23, 0.032, 0.7)
      this.addDriftwood(-0.05, 0.5)
    } else if (def.decor === 'eco') {
      this.addDriftwood(0.1, 0.75); addRock(-0.34, 0.05, 0.8); addRock(0.38, 0.045, 0.8)
    } else {
      this.addCoral(0.3, 0.9, '#e87a9a'); this.addCoral(0.4, 0.65, '#9a6fd0')
      addRock(-0.3, 0.05, 0.7)
    }
  }

  private addDriftwood(fx: number, scale: number): void {
    const W = this.tankW, H = this.tankH
    const floorY = -H / 2
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(fx * W, floorY, 0.03 * (0.5 - scale)),
      new THREE.Vector3(fx * W + 0.12 * scale, floorY + 0.16 * scale, 0.02),
      new THREE.Vector3(fx * W + 0.05 * scale, floorY + 0.34 * scale, 0),
      new THREE.Vector3(fx * W + 0.16 * scale, floorY + 0.5 * scale, -0.02),
    ])
    const geo = new THREE.TubeGeometry(curve, 20, 0.018 * scale, 6, false)
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5c4128, roughness: 0.9, metalness: 0 }))
    mesh.castShadow = true
    this.envGroup.add(mesh)
  }

  private addCoral(fx: number, scale: number, color: string): void {
    const W = this.tankW, H = this.tankH
    const floorY = -H / 2
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0 })
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.38
      const l = (0.1 + Math.random() * 0.06) * scale
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(fx * W, floorY, 0),
        new THREE.Vector3(fx * W + Math.cos(a) * l * 0.5, floorY + l * 0.5, Math.sin(a) * l * 0.2),
        new THREE.Vector3(fx * W + Math.cos(a) * l, floorY + l, Math.sin(a) * l * 0.3),
      ])
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.012 * scale, 5, false), mat)
      mesh.castShadow = true
      this.envGroup.add(mesh)
    }
  }

  private buildPlants(def: TankDef, rnd: () => number): void {
    const W = this.tankW, H = this.tankH
    const floorY = -H / 2
    for (const cx of def.plantClusters) {
      const n = 3 + Math.floor(rnd() * 4)
      for (let i = 0; i < n; i++) {
        const h = H * (0.28 + rnd() * 0.34)
        const w = 0.012 + rnd() * 0.012
        const color = def.plantColors[Math.floor(rnd() * def.plantColors.length)]
        const mesh = this.makeBlade(h, w, color)
        mesh.position.set(W * cx + (rnd() - 0.5) * W * 0.08, floorY, (rnd() - 0.5) * 0.12)
        this.envGroup.add(mesh)
        this.plants.push({ mesh, phase: rnd() * Math.PI * 2 })
      }
    }
  }

  private makeBlade(h: number, w: number, color: string): THREE.Mesh {
    const SEG = 7
    const pos: number[] = []
    const uv: number[] = []
    const index: number[] = []
    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG
      const wid = w * (1 - s * 0.85)
      pos.push(-wid, h * s, 0, wid, h * s, 0)
      uv.push(0, s, 1, s)
    }
    for (let i = 0; i < SEG; i++) {
      const a = i * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex(index)
    geo.computeVertexNormals()
    const hi = new THREE.Color(color).offsetHSL(0, 0, 0.12)
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, side: THREE.DoubleSide, emissive: hi, emissiveIntensity: 0.05 })
    const mesh = new THREE.Mesh(geo, mat)
    const phase = Math.random() * Math.PI * 2
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = U_TIME
      shader.uniforms.uPhase = { value: phase }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uPhase;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          { float s = uv.y; transformed.x += sin(uTime * 1.2 + uPhase + s * 2.2) * 0.045 * pow(s, 1.5); }`)
    }
    mat.customProgramCacheKey = () => 'blade'
    return mesh
  }

  // ---- 内部：鱼 ----

  private makeFish(cfg: FishConfig): FishRuntime {
    const sp = SPECIES3D[cfg.species]
    const variant = 0
    const seed = Math.floor(Math.random() * 1e9)
    const len = this.tankW * 0.135 * sp.size * (cfg.size || 1)
    const speedScale = this.tankW / REF_TANK_W
    const group = new THREE.Group()
    const materials: THREE.Material[] = []
    const finMats: { mat: THREE.Material; phase: number }[] = []

    // 身体
    const bodyGeo = buildBodyGeometry(sp, len)
    const colorMap = bodyColorTexture(sp.colors, sp.pattern, seed, sp.vein)
    const normalTex = heightToNormal(scaleHeightCanvas(256, 11), 1.4)
    normalTex.repeat.set(3, 2)
    const bodyMat = new THREE.MeshPhysicalMaterial({
      map: colorMap, normalMap: normalTex, normalScale: new THREE.Vector2(0.38, 0.38),
      roughness: 0.45, metalness: 0.0, clearcoat: 0.25, clearcoatRoughness: 0.55,
      sheen: 0.8, sheenColor: new THREE.Color(sp.colors.mid), envMapIntensity: 0.9,
      iridescence: 0.3, iridescenceIOR: 1.3,
    })
    makeWaveMaterial(bodyMat, { amp: 0.012 * len, freq: 9, k: 7 / len, axis: 'z', driveU: -1, ampBase: 0.12 }, 0)
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.castShadow = true
    materials.push(bodyMat)
    group.add(body)

    // 眼睛
    const eyeGeo = new THREE.SphereGeometry(len * 0.052, 12, 10)
    const eyeMat = new THREE.MeshPhysicalMaterial({ color: sp.colors.iris, roughness: 0.15, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1 })
    const pupilGeo = new THREE.SphereGeometry(len * 0.03, 10, 8)
    const pupilMat = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05 })
    const eyeX = len * 0.36
    const eyeY = sampleKeys(sp.top, 0.86) * len * 0.55
    const eyeZ = sampleKeys(sp.wid, 0.86) * len * 0.82
    for (const sgn of [1, -1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat)
      eye.position.set(eyeX, eyeY, sgn * eyeZ)
      const pupil = new THREE.Mesh(pupilGeo, pupilMat)
      pupil.position.set(len * 0.028, len * 0.004, sgn * len * 0.03)
      eye.add(pupil)
      group.add(eye)
      materials.push(eyeMat, pupilMat)
    }

    // 背鳍
    const dorsalTop = sampleKeys(sp.top, 0.55) * len
    const dorsalH = sp.dorsal * len
    if (dorsalH > 0.01) {
      const bd = [
        [len * 0.16, dorsalTop - len * 0.02], [len * 0.02, dorsalTop + dorsalH * 0.85],
        [-len * 0.12, dorsalTop + dorsalH * 0.6], [-len * 0.3, dorsalTop - len * 0.01],
      ] as [number, number][]
      const finGeoTex = finTexture(sp.colors.fin, sp.colors.finVein, seed)
      const m = makeWaveMaterial(
        new THREE.MeshPhysicalMaterial({ map: finGeoTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.6, metalness: 0, opacity: 0.62, sheen: 0.8, sheenColor: new THREE.Color(sp.colors.fin) }),
        { amp: len * 0.014, freq: 7, k: 6 / len, axis: 'z', driveU: 1, ampBase: 0.08 }, 1.3,
      )
      const mesh = new THREE.Mesh(buildFinGeometry(bd, [len * 0.02, dorsalTop]), m)
      group.add(mesh)
      materials.push(m); finMats.push({ mat: m, phase: 1.3 })
    }

    // 臀鳍
    const analBot = -sampleKeys(sp.bot, 0.28) * len
    if (dorsalH > 0.01) {
      const pts = [
        [-len * 0.05, analBot], [-len * 0.22, analBot - dorsalH * 0.5], [-len * 0.34, analBot + len * 0.01],
      ] as [number, number][]
      const tex = finTexture(sp.colors.fin, sp.colors.finVein, seed + 1)
      const m = makeWaveMaterial(
        new THREE.MeshPhysicalMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.6, opacity: 0.6 }),
        { amp: len * 0.011, freq: 7, k: 6 / len, axis: 'z', driveU: 1, ampBase: 0.1 }, 2.1,
      )
      const mesh = new THREE.Mesh(buildFinGeometry(pts, [-len * 0.15, analBot]), m)
      group.add(mesh)
      materials.push(m)
    }

    // 胸鳍（左右，快速摆动）
    const pecTop = sampleKeys(sp.top, 0.72) * len
    const pecW = sampleKeys(sp.wid, 0.72) * len
    for (const sgn of [1, -1]) {
      const pts = [
        [0, 0], [len * 0.06, -len * 0.05], [len * 0.11, -len * 0.02], [len * 0.1, len * 0.03],
      ] as [number, number][]
      const tex = finTexture(sp.colors.fin, sp.colors.finVein, seed + 2)
      const m = makeWaveMaterial(
        new THREE.MeshPhysicalMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.6, opacity: 0.58 }),
        { amp: len * 0.016, freq: 2.2, k: 12 / len, axis: 'y', driveU: 1, ampBase: 0.2 }, 0.6 * sgn,
      )
      const mesh = new THREE.Mesh(buildFinGeometry(pts, [0, 0]), m)
      mesh.position.set(len * 0.22, pecTop * 0.2, sgn * pecW * 0.9)
      mesh.rotation.z = -0.2 * sgn
      group.add(mesh)
      materials.push(m)
    }

    // 尾鳍
    const tailBuilt = tailPoints(sp.tail, len, sp.tailScale)
    const tailBase = new THREE.Group()
    tailBase.position.set(-len * 0.46, 0, 0)
    const tailTex = finTexture(sp.colors.fin, sp.colors.finVein, seed + 3)
    const tailMat = makeWaveMaterial(
      new THREE.MeshPhysicalMaterial({ map: tailTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.55, metalness: 0, opacity: 0.65, sheen: 0.9, sheenColor: new THREE.Color(sp.colors.fin) }),
      { amp: len * 0.035, freq: 6, k: 4 / len, axis: 'z', driveU: -1, ampBase: 0.15 }, 0,
    )
    const tailMesh = new THREE.Mesh(buildFinGeometry(tailBuilt.pts, tailBuilt.root), tailMat)
    tailBase.add(tailMesh)
    // 蝶尾：再叠一层带相位差，形成飘逸双尾
    if (sp.tail === 'veil') {
      const second = new THREE.Mesh(buildFinGeometry(tailBuilt.pts, tailBuilt.root), tailMat.clone())
      makeWaveMaterial(second.material as THREE.Material, { amp: len * 0.04, freq: 5.4, k: 4 / len, axis: 'z', driveU: -1, ampBase: 0.15 }, 1.1)
      second.position.z = 0.004
      second.scale.set(1, 0.92, 1)
      tailBase.add(second)
      materials.push(second.material as THREE.Material)
      finMats.push({ mat: second.material as THREE.Material, phase: 1.1 })
    }
    group.add(tailBase)
    materials.push(tailMat)
    finMats.push({ mat: tailMat, phase: 0 })
    group.userData.tailBase = tailBase

    this.fishGroup.add(group)
    const rt: FishRuntime = {
      id: cfg.id, species: cfg.species, variant, seed, len, group, materials, finMats,
      vmax: sp.speed[1] * speedScale * (0.9 + Math.random() * 0.3),
      cruise: (sp.speed[0] + Math.random() * (sp.speed[1] - sp.speed[0]) * 0.5) * speedScale,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      tx: 0, ty: 0, tz: 0, retarget: 0, pulse: 0,
      appetite: 0.15 + Math.random() * 0.85, reactAt: 0,
    }
    return rt
  }

  private disposeFish(f: FishRuntime): void {
    f.group.traverse(o => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = (m as THREE.Mesh).material
      if (mat) {
        const arr = Array.isArray(mat) ? mat : [mat]
        for (const mm of arr) {
          const anym = mm as THREE.Material & { map?: THREE.Texture; normalMap?: THREE.Texture; alphaMap?: THREE.Texture }
          anym.map?.dispose(); anym.normalMap?.dispose(); anym.alphaMap?.dispose()
          mm.dispose()
        }
      }
    })
    f.group.clear()
  }

  private placeFish(): void {
    const W = this.tankW, H = this.tankH, D = this.tankD
    for (const f of this.fish) {
      if (!f.group.parent) this.fishGroup.add(f.group)
      f.group.scale.setScalar(1)
      f.x = clamp(f.x || (Math.random() - 0.5) * W * 0.6, -W * 0.4, W * 0.4)
      f.y = clamp(f.y || (Math.random() - 0.5) * H * 0.4, -H * 0.35, H * 0.4)
      f.z = clamp(f.z || (Math.random() - 0.5) * D * 0.6, -D * 0.35, D * 0.35)
      f.tx = f.x; f.ty = f.y; f.tz = f.z
    }
  }

  // ---- 内部：更新 ----

  private update(dt: number): void {
    U_TIME.value = this.t
    this.hunger = Math.min(1, this.hunger + dt / HUNGER_S)
    const def = TANKS[this.style]

    // 焦散动画
    if (this.caustics && this.causticTex) {
      this.causticTex.offset.x = this.t * 0.02
      this.causticTex.offset.y = this.t * 0.013
      const m = this.caustics.material as THREE.MeshBasicMaterial
      m.opacity = def.causticStrength * (0.75 + 0.25 * Math.sin(this.t * 1.4))
    }
    // 光柱摆动
    for (const r of this.rays) {
      r.mesh.position.x = r.baseX + Math.sin(this.t * 0.25 + r.phase) * 0.03
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = def.rayOpacity * (0.7 + 0.3 * Math.sin(this.t * 0.4 + r.phase))
    }
    // 水面波动
    if (this.waterSurface) {
      this.waterSurface.position.y = this.tankH / 2 - 0.015 + Math.sin(this.t * 1.6) * 0.003
    }

    // 鱼食
    for (let i = this.food.length - 1; i >= 0; i--) {
      const p = this.food[i]
      const floor = -this.tankH / 2 + 0.03
      if (p.mesh.position.y > floor) {
        p.vy = Math.min(0.28, p.vy + 0.12 * dt)
        p.mesh.position.y -= p.vy * dt
        p.mesh.position.x += Math.sin(this.t * 2 + i) * 0.01 * dt
      } else if (p.settledAt == null) {
        p.settledAt = this.t
      }
      if (p.settledAt != null && this.t - p.settledAt > 11) {
        p.mesh.removeFromParent()
        p.mesh.visible = false
        this.foodPool.push(p.mesh)
        this.food.splice(i, 1)
      }
    }

    for (const f of this.fish) this.updateFish(f, dt)

    // 悬浮微粒缓慢漂移（体积感）
    if (this.motes) {
      this.motes.position.y = Math.sin(this.t * 0.18) * 0.012
      this.motes.position.x = Math.sin(this.t * 0.11 + 1.7) * 0.010
      this.motes.rotation.y = Math.sin(this.t * 0.07) * 0.02
    }

    // 气泡
    this.bubbleAcc += dt * def.rays * 0.45
    while (this.bubbleAcc > 1 && this.bubbles.length < 14) {
      this.bubbleAcc -= 1
      this.spawnBubble((Math.random() - 0.5) * this.tankW * 0.9)
    }
    this.ambientAcc += dt
    if (this.ambientAcc > 5 && this.bubbles.length < 14) {
      this.ambientAcc = 0
      this.spawnBubble((Math.random() - 0.5) * this.tankW * 0.95)
    }
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]
      b.mesh.position.y += b.vy * dt
      b.mesh.position.x += Math.sin(this.t * 2.5 + b.phase) * 0.02 * dt
      const age = this.t - b.born
      b.mesh.scale.setScalar(Math.min(0.016, 0.006 + age * 0.012))
      if (b.mesh.position.y > this.tankH / 2 - 0.02) {
        b.mesh.removeFromParent()
        this.bubblePool.push(b.mesh)
        this.bubbles.splice(i, 1)
      }
    }
  }

  private get foodMat(): THREE.Material {
    if (!this._foodMat) this._foodMat = new THREE.MeshStandardMaterial({ color: 0xb98a4a, roughness: 0.85, metalness: 0 })
    return this._foodMat
  }
  private _foodMat: THREE.Material | null = null
  private get bubbleMat(): THREE.Material {
    if (!this._bubbleMat) this._bubbleMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.22, clearcoat: 1, envMapIntensity: 2 })
    return this._bubbleMat
  }
  private _bubbleMat: THREE.Material | null = null

  private acquireFood(): THREE.Mesh {
    const m = new THREE.Mesh(this.foodMesh!, this.foodMat)
    m.scale.setScalar(1)
    return m
  }

  private spawnBubble(x: number): void {
    const mesh = this.bubblePool.pop() || new THREE.Mesh(this.bubbleGeo!, this.bubbleMat)
    mesh.position.set(x, -this.tankH / 2 + 0.03, (Math.random() - 0.5) * this.tankD * 0.6)
    mesh.scale.setScalar(0.012)
    this.scene.add(mesh)
    this.bubbles.push({ mesh, vy: 0.09 + Math.random() * 0.12, phase: Math.random() * Math.PI * 2, born: this.t })
  }

  private updateFish(f: FishRuntime, dt: number): void {
    const W = this.tankW, H = this.tankH, D = this.tankD
    const yTop = H / 2 - 0.06
    const yBot = -H / 2 + 0.05
    let dx = 0, dy = 0, dz = 0, spd = f.cruise

    // 觅食：视野范围 + 个体食欲 + 反应延迟，避免全体瞬间同步涌上
    let target: { mesh: THREE.Mesh } | null = null
    if (this.food.length > 0) {
      let bd = Infinity
      for (const p of this.food) {
        const d = (p.mesh.position.x - f.x) ** 2 + (p.mesh.position.y - f.y) ** 2 + (p.mesh.position.z - f.z) ** 2
        if (d < bd) { bd = d; target = p }
      }
      const visionR = Math.max(W, H) * 0.5
      const aware = bd < visionR * visionR && this.hunger * f.appetite > 0.5
      if (!aware) {
        f.reactAt = 0
        target = null
      } else if (f.reactAt === 0) {
        // 首次看到食物：随机延迟后再动身，令反应错峰
        f.reactAt = this.t + 0.3 + Math.random() * 1.5
        target = null
      } else if (this.t < f.reactAt) {
        target = null
      }
      if (target) {
        const px = target.mesh.position.x, py = target.mesh.position.y, pz = target.mesh.position.z
        const d = Math.sqrt(bd) || 1
        dx = px - f.x; dy = py - f.y; dz = pz - f.z
        spd = f.vmax * (1.0 + this.hunger * 0.4)
        if (d < f.len * 0.3) {
          target.mesh.removeFromParent(); target.mesh.visible = false
          this.foodPool.push(target.mesh)
          this.food.splice(this.food.indexOf(target as any), 1)
          this.hunger = Math.max(0, this.hunger - 0.12)
          f.pulse = 1
          f.reactAt = 0
          target = null
        }
      }
    } else {
      f.reactAt = 0
    }

    if (!target) {
      f.retarget -= dt
      if (f.retarget <= 0) {
        f.retarget = 2 + Math.random() * 3
        f.tx = (Math.random() - 0.5) * (W - f.len * 1.4)
        f.ty = yBot + Math.random() * (yTop - yBot)
        f.tz = (Math.random() - 0.5) * (D - 0.15)
        if (this.hunger > 0.6 && this.food.length === 0) f.ty = yBot + Math.random() * 0.05
      }
      dx = f.tx - f.x; dy = f.ty - f.y; dz = f.tz - f.z
      spd = f.cruise * (this.hunger > 0.35 && this.food.length === 0 ? 0.8 : 1)
    }

    const dl = Math.hypot(dx, dy, dz) || 1
    let ndx = dx / dl, ndy = dy / dl, ndz = dz / dl

    // 软边界
    const m = f.len * 0.6
    if (f.x < -W / 2 + m) ndx += ((-W / 2 + m) - f.x) * 2
    if (f.x > W / 2 - m) ndx -= (f.x - (W / 2 - m)) * 2
    if (f.y < yBot + m * 0.5) ndy += ((yBot + m * 0.5) - f.y) * 3
    if (f.y > yTop - m * 0.5) ndy -= (f.y - (yTop - m * 0.5)) * 3
    if (f.z < -D / 2 + m) ndz += ((-D / 2 + m) - f.z) * 2
    if (f.z > D / 2 - m) ndz -= (f.z - (D / 2 - m)) * 2

    // 分离
    for (const o of this.fish) {
      if (o === f) continue
      const ex = f.x - o.x, ey = f.y - o.y, ez = f.z - o.z
      const d2 = ex * ex + ey * ey + ez * ez
      const rr = (f.len + o.len) * 0.42
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = 1.2 * (1 - d / rr)
        ndx += ex / d * push; ndy += ey / d * push; ndz += ez / d * push
      }
    }

    const nl = Math.hypot(ndx, ndy, ndz) || 1
    const k = 1 - Math.exp(-2.5 * dt)
    f.vx += (ndx / nl * spd - f.vx) * k
    f.vy += (ndy / nl * spd - f.vy) * k
    f.vz += (ndz / nl * spd - f.vz) * k
    f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt
    f.x = clamp(f.x, -W / 2 + f.len * 0.2, W / 2 - f.len * 0.2)
    f.y = clamp(f.y, yBot, yTop)
    f.z = clamp(f.z, -D / 2 + f.len * 0.2, D / 2 - f.len * 0.2)

    // 姿态：局部 +X 为前进方向
    const v = Math.hypot(f.vx, f.vy, f.vz) || 0.001
    const fwd = new THREE.Vector3(f.vx / v, f.vy / v, f.vz / v)
    const up = new THREE.Vector3(0, 1, 0)
    const right = new THREE.Vector3().crossVectors(fwd, up)
    if (right.lengthSq() < 1e-5) right.set(0, 0, 1)
    right.normalize()
    const up2 = new THREE.Vector3().crossVectors(right, fwd).normalize()
    const basis = new THREE.Matrix4().makeBasis(fwd, up2, right)
    f.group.quaternion.setFromRotationMatrix(basis)
    // 侧倾（转弯时）
    const turn = f.vx * f.vz
    f.group.rotateZ(clamp(turn * 0.02, -0.25, 0.25))
    f.group.position.set(f.x, f.y, f.z)

    // 摆动相位随速度
    f.pulse = Math.max(0, f.pulse - dt * 3)
    const tailBase = f.group.userData.tailBase as THREE.Group | undefined
    const beat = Math.sin(this.t * (3 + v * 0.6)) * 0.28 * (0.6 + 0.4 * Math.min(1, v / f.vmax))
    if (tailBase) tailBase.rotation.y = beat
  }
}
