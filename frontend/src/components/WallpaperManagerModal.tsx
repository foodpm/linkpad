import { useEffect, useState } from 'react'
import { X, Upload, Loader, Trash2, Timer, Check } from 'lucide-react'
import { wallpapers, getWallpaperUrl, invalidateWallpaperUrl } from '../api'
import { useT } from '../i18n'

// 内置壁纸池（'' = 默认渐变背景），App.tsx 引用同一份
export const BUILTIN_WALLPAPERS = ['', '/wallpapers/w1.jpg', '/wallpapers/w2.jpg', '/wallpapers/w3.jpg', '/wallpapers/w4.jpg', '/wallpapers/w5.jpg', '/wallpapers/w6.jpg', '/wallpapers/w7.jpg', '/wallpapers/w8.jpg', '/wallpapers/w9.jpg', '/wallpapers/w10.jpg', '/wallpapers/w11.jpg', '/wallpapers/w12.jpg', '/wallpapers/w13.jpg', '/wallpapers/w14.jpg', '/wallpapers/w15.jpg', '/wallpapers/w16.jpg']

const AUTO_OPTIONS = [
  { v: 0, label: '不自动切换' },
  { v: 60, label: '每 1 分钟' },
  { v: 300, label: '每 5 分钟' },
  { v: 900, label: '每 15 分钟' },
  { v: 1800, label: '每 30 分钟' },
  { v: 3600, label: '每 1 小时' },
]

interface Props {
  onClose: () => void
  list: { id: string; filename: string; size: number; created_at: string }[]
  current: string
  onSelect: (key: string) => void
  onChanged: () => void
  autoSeconds: number
  onAutoChange: (s: number) => void
}

// 上传前压缩：最长边 2560px、JPEG 0.85，自动适配大小
async function compressImage(file: File): Promise<Blob> {
  try {
    const img = await createImageBitmap(file)
    const MAX = 2560
    const scale = Math.min(1, MAX / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    img.close()
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.85))
    if (blob && blob.size < file.size) return blob
    return file
  } catch {
    return file
  }
}

// 用户壁纸缩略图（走鉴权 blob URL，与 App 共用缓存）
function UserWallThumb({ id, className }: { id: string; className?: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let cancelled = false
    getWallpaperUrl(id).then(u => { if (!cancelled) setUrl(u) })
    return () => { cancelled = true }
  }, [id])
  if (!url) return <div className={`${className} flex items-center justify-center`}><Loader className="w-4 h-4 text-gray-300 animate-spin" /></div>
  return <img src={url} className={className} />
}

export default function WallpaperManagerModal({ onClose, list, current, onSelect, onChanged, autoSeconds, onAutoChange }: Props) {
  const t = useT()
  const [uploading, setUploading] = useState(false)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    try {
      for (const f of files) {
        const blob = await compressImage(f)
        const ext = blob.type === 'image/png' ? '.png' : blob.type === 'image/webp' ? '.webp' : '.jpg'
        const name = f.name.replace(/\.[^.]+$/, '') + ext
        await wallpapers.upload(new File([blob], name, { type: blob.type || 'image/jpeg' }))
      }
      onChanged()
    } catch (err: any) {
      alert(err.message || t('上传失败'))
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('确定删除这张壁纸吗？'))) return
    try {
      await wallpapers.remove(id)
      invalidateWallpaperUrl(id)
      if (current === `user:${id}`) onSelect('')
      onChanged()
    } catch (err: any) {
      alert(err.message || t('删除失败'))
    }
  }

  const fmtSize = (n: number) => n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-gray-800">{t('壁纸管理')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {/* 自动切换设置 */}
        <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-white/50 border border-white/60 mb-5">
          <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
            <Timer className="w-4 h-4 text-blue-500" /> {t('自动切换壁纸')}
          </label>
          <select value={autoSeconds} onChange={e => onAutoChange(Number(e.target.value))}
            className="h-9 px-3 bg-white/80 border border-white/80 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400/50 cursor-pointer">
            {AUTO_OPTIONS.map(o => <option key={o.v} value={o.v}>{t(o.label)}</option>)}
          </select>
        </div>

        {/* 上传入口 */}
        <div className="mb-5">
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" id="wallpaper-upload-input" onChange={handleUpload} />
          <label htmlFor="wallpaper-upload-input"
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-blue-500 text-white text-sm hover:bg-blue-600 transition-all cursor-pointer ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
            {uploading ? <Loader className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? t('上传中...') : t('上传壁纸')}
          </label>
          <p className="text-xs text-gray-400 mt-2">{t('支持 JPG / PNG / WebP，可多选；系统会自动压缩适配大小（最长边 2560px）。最多 30 张，仅自己可见。')}</p>
        </div>

        {/* 我的壁纸 */}
        <div className="mb-2 text-sm font-medium text-gray-600">{t('我的壁纸（{n}）', { n: list.length })}</div>
        {list.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6 mb-4">{t('还没有上传壁纸')}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            {list.map(w => {
              const key = `user:${w.id}`
              const selected = current === key
              return (
                <div key={w.id} className="relative group">
                  <button onClick={() => onSelect(key)}
                    className={`block w-full aspect-video rounded-2xl overflow-hidden border-2 transition-all ${selected ? 'border-blue-500 ring-2 ring-blue-300' : 'border-white/60 hover:border-blue-300'}`}>
                    <UserWallThumb id={w.id} className="w-full h-full object-cover" />
                  </button>
                  {selected && (
                    <span className="absolute top-1.5 left-1.5 flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white"><Check className="w-3 h-3" /></span>
                  )}
                  <button onClick={() => handleDelete(w.id)} title={t('删除')}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-white/90 text-red-500 hover:bg-red-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <p className="text-xs text-gray-400 mt-1 truncate px-0.5">{w.filename} · {fmtSize(w.size)}</p>
                </div>
              )
            })}
          </div>
        )}

        {/* 内置壁纸 */}
        <div className="mb-2 text-sm font-medium text-gray-600">{t('内置壁纸')}</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {BUILTIN_WALLPAPERS.map(w => {
            const selected = current === w
            return (
              <button key={w || 'default'} onClick={() => onSelect(w)}
                className={`relative block w-full aspect-video rounded-2xl overflow-hidden border-2 transition-all ${selected ? 'border-blue-500 ring-2 ring-blue-300' : 'border-white/60 hover:border-blue-300'}`}>
                {w ? <img src={w} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gradient-to-br from-blue-50 via-white to-sky-50" />}
                {selected && <span className="absolute top-1.5 left-1.5 flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white"><Check className="w-3 h-3" /></span>}
                {selected && <span className="absolute bottom-0 inset-x-0 bg-blue-500/90 text-white text-[10px] py-0.5">{t('当前壁纸')}</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
