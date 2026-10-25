import { Loader2, RefreshCw } from 'lucide-react'
import { useT } from '../i18n'

interface LinkDescriptionInputProps {
  value: string
  url: string
  loading?: boolean
  onChange: (value: string) => void
  onFetch: () => void
}

export default function LinkDescriptionInput({ value, url, loading = false, onChange, onFetch }: LinkDescriptionInputProps) {
  const t = useT()
  const disabled = loading || !url.trim()

  return (
    <div className="relative">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={t('描述（自动抓取，可修改）')}
        className="w-full h-12 pl-4 pr-24 bg-white/60 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800"
      />
      <button
        type="button"
        onClick={onFetch}
        disabled={disabled}
        title={t('自动抓取网站描述')}
        className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/70 border border-gray-200 text-xs text-gray-500 hover:text-blue-500 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        <span className="hidden sm:inline">{loading ? t('抓取中') : t('抓取')}</span>
      </button>
    </div>
  )
}
