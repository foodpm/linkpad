import { useMemo, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { t } from '../i18n'

type Option = { id: string; label: string; group?: string }

type Props = {
  options: Option[]
  selected: string[]
  onToggle: (id: string) => void
  placeholder?: string
  searchPlaceholder?: string
  searchable?: boolean
}

export default function CategoryMultiSelect({
  options,
  selected,
  onToggle,
  placeholder,
  searchPlaceholder,
  searchable = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setSearchQuery] = useState('')

  const filtered = useMemo(() => {
    if (!searchable) return options
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => o.label.toLowerCase().includes(q))
  }, [options, query, searchable])

  const selectedLabels = options
    .filter(o => selected.includes(o.id))
    .map(o => t(o.label))

  return (
    <div className="w-full">
      {searchable ? (
        <div>
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="flex min-h-12 w-full items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white/60 px-3 py-2 text-left text-sm text-gray-800 transition-colors hover:bg-white/90"
          >
            <span className="truncate">
              {selectedLabels.length > 0 ? selectedLabels.join(', ') : t(placeholder || '选择分类')}
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <div className="mt-2 rounded-2xl border border-gray-200 bg-white/95 p-2 shadow-lg">
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={t(searchPlaceholder || '搜索分类名称...')}
                  className="h-9 w-full rounded-xl bg-white/70 pl-9 pr-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                />
              </div>
              <div className="max-h-44 space-y-1 overflow-y-auto">
                {filtered.map(option => {
                  const selectedNow = selected.includes(option.id)
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => onToggle(option.id)}
                      className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm text-gray-800 hover:bg-blue-50"
                    >
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selectedNow ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-300 bg-white'}`}>
                        {selectedNow && <Check className="h-2.5 w-2.5" />}
                      </span>
                      <span className="truncate">{t(option.label)}</span>
                    </button>
                  )
                })}
                {filtered.length === 0 && (
                  <p className="px-2 py-3 text-center text-xs text-gray-400">{t('未找到匹配的分类')}</p>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-12 flex-wrap gap-2 rounded-2xl border border-gray-200 bg-white/60 px-2 py-2">
          {options.map(option => {
            const selectedNow = selected.includes(option.id)
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onToggle(option.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${selectedNow ? 'bg-blue-500 text-white' : 'border border-gray-200 bg-white/60 text-gray-600 hover:bg-white/90'}`}
              >
                {t(option.label)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
