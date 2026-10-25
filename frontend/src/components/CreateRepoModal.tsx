import { useState, useRef } from 'react'
import { X, Tag, Globe, Lock, KeyRound, Palette, Camera, Loader } from 'lucide-react'
import { repos } from '../api'
import { useT } from '../i18n'
import ModalTitle from './ModalTitle'

const palette = [
  { bg: '#3B82F6', text: '#FFFFFF' }, { bg: '#EF4444', text: '#FFFFFF' },
  { bg: '#10B981', text: '#FFFFFF' }, { bg: '#F59E0B', text: '#FFFFFF' },
  { bg: '#8B5CF6', text: '#FFFFFF' }, { bg: '#EC4899', text: '#FFFFFF' },
  { bg: '#06B6D4', text: '#FFFFFF' }, { bg: '#F97316', text: '#FFFFFF' },
  { bg: '#6366F1', text: '#FFFFFF' }, { bg: '#14B8A6', text: '#FFFFFF' },
  { bg: '#84CC16', text: '#FFFFFF' }, { bg: '#D946EF', text: '#FFFFFF' },
  { bg: '#0EA5E9', text: '#FFFFFF' }, { bg: '#E11D48', text: '#FFFFFF' },
  { bg: '#7C3AED', text: '#FFFFFF' }, { bg: '#059669', text: '#FFFFFF' },
]

interface Props {
  onClose: () => void
  onCreated: (repo: any) => void
}

export default function CreateRepoModal({ onClose, onCreated }: Props) {
  const t = useT()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [catInput, setCatInput] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public' | 'password'>('private')
  const [password, setPassword] = useState('')
  const [selectedColor, setSelectedColor] = useState(Math.floor(Math.random() * palette.length))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [iconPreview, setIconPreview] = useState('')
  const [iconUploading, setIconUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleIconSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIconFile(file)
    const reader = new FileReader()
    reader.onload = () => setIconPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const addCategory = () => {
    const t = catInput.trim()
    if (t && !categories.includes(t) && categories.length < 20) {
      setCategories([...categories, t])
      setCatInput('')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) return setError(t('请输入仓库名称'))

    setLoading(true)
    try {
      const repo = await repos.create({
        name,
        description,
        categories,
        visibility,
        password: visibility === 'password' ? password : '',
      })
      // Upload icon if selected
      if (iconFile && repo.id) {
        await repos.uploadIcon(repo.id, iconFile)
      }
      onCreated(repo)
      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const visibilityOptions = [
    { value: 'private', label: t('私密'), icon: Lock, desc: t('仅自己可见') },
    { value: 'public', label: t('共享'), icon: Globe, desc: t('发布到发现页') },
    { value: 'password', label: t('密码访问'), icon: KeyRound, desc: t('输入密码才能查看') },
  ] as const

  const color = palette[selectedColor]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-8 w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto [&::-webkit-scrollbar]:hidden">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>

        <ModalTitle icon={Globe} title={t('创建仓库')} />

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Icon row - separate */}
          <div className="flex flex-col items-center gap-3 py-2">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center text-3xl font-bold shadow-md overflow-hidden"
              style={iconPreview ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: color.bg, color: color.text }}
            >
              {iconPreview ? (
                <img src={iconPreview} className="w-full h-full object-contain p-2" />
              ) : (
                name ? name.charAt(0).toUpperCase() : '?'
              )}
            </div>
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleIconSelect} />
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/60 border border-white/80 text-sm text-gray-600 hover:bg-white/90 transition-all">
                <Camera className="w-4 h-4" /> {t('上传图标')}
              </button>
              {iconPreview && (
                <button type="button" onClick={() => { setIconFile(null); setIconPreview(''); if (fileInputRef.current) fileInputRef.current.value = '' }} className="text-xs text-red-400 hover:text-red-600">{t('清除')}</button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Palette className="w-3 h-3 text-gray-400" />
              <span className="text-xs text-gray-400">{t('背景颜色')}</span>
              <div className="flex gap-1 flex-wrap">
                {palette.map((p, i) => (
                  <button key={i} type="button" onClick={() => setSelectedColor(i)}
                    className="w-5 h-5 rounded-full border border-white/60 shadow-sm transition-transform hover:scale-110"
                    style={{ backgroundColor: p.bg, transform: i === selectedColor ? 'scale(1.3)' : undefined }} />
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">{t('仓库名称 *')}</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={t('输入仓库名称')}
              className="w-full h-12 px-4 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400" />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">{t('简介（选填）')}</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={t('简要描述仓库')}
              className="w-full h-20 px-4 py-3 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400 resize-none" />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">{t('分类（输入后回车添加）')}</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {categories.map(c => (
                <span key={c} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-xs font-medium border border-blue-100">
                  <Tag className="w-3 h-3" /> {c}
                  <button type="button" onClick={() => setCategories(categories.filter(x => x !== c))} className="hover:text-blue-800">&times;</button>
                </span>
              ))}
            </div>
            <input value={catInput} onChange={e => setCatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory() } }}
              placeholder={t('输入分类名称')} className="w-full h-11 px-4 bg-white/60 border border-white/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400 text-sm" />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-2 block">{t('分享模式')}</label>
            <div className="grid grid-cols-3 gap-2">
              {visibilityOptions.map(opt => {
                const Icon = opt.icon
                const selected = visibility === opt.value
                return (
                  <button key={opt.value} type="button" onClick={() => setVisibility(opt.value)}
                    className={`p-3 rounded-2xl border text-left transition-all ${selected ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white/40 border-white/60 text-gray-600 hover:bg-white/60'}`}>
                    <Icon className={`w-4 h-4 mb-1 ${selected ? 'text-blue-500' : 'text-gray-400'}`} />
                    <div className="text-xs font-medium">{opt.label}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {visibility === 'password' && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">{t('访问密码 *')}</label>
              <input type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder={t('设置访问密码')}
                className="w-full h-12 px-4 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400" />
            </div>
          )}

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-12 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all">{t('取消')}</button>
            <button type="submit" disabled={loading} className="flex-1 h-12 rounded-2xl bg-blue-500 text-white hover:bg-blue-600 transition-all disabled:opacity-50">
              {loading ? t('创建中...') : t('创建')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
