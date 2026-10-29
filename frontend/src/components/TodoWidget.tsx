import { useState } from 'react'
import { CheckSquare, X, Plus } from 'lucide-react'
import { useT } from '../i18n'

// ---------- 待办组件：可放入常用工具/分类（右键全功能菜单），快捷增删改 ----------

interface Props {
  widget: any
  todos: any[]
  incompleteCount: number
  onToggle: (id: string, is_completed: number) => void
  onDelete: (id: string) => void
  onAdd: (content: string) => void
  onRemove: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

export function TodoWidgetCard({ widget, todos, incompleteCount, onToggle, onDelete, onAdd, onRemove, onContextMenu }: Props) {
  const t = useT()
  const [draft, setDraft] = useState('')
  const height = widget.height || 1
  const big = height >= 2

  const add = () => { if (draft.trim()) { onAdd(draft.trim()); setDraft('') } }

  if (!big) {
    // 1 卡：紧凑行（80px 行高内）
    return (
      <div className="relative group h-full min-h-0" onContextMenu={onContextMenu}>
        <div data-widget-card className="h-full flex items-center gap-3 px-4 rounded-2xl bg-white/25 backdrop-blur-xl border border-white/35 ring-1 ring-white/20 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.38)] hover:bg-white/32 hover:border-white/50 transition-all select-none text-white">
          <span className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <CheckSquare className="w-5 h-5 text-white" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{t('待办事项')}</p>
            <p className="text-xs text-white/70 truncate">{t('{n} 项未完成', { n: incompleteCount })}</p>
          </div>
          {incompleteCount > 0 && (
            <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center">{incompleteCount}</span>
          )}
        </div>
      </div>
    )
  }

  // 2/3 卡：完整列表（滚动） + 快捷添加
  return (
    <div className="relative group h-full min-h-0" onContextMenu={onContextMenu}>
      <div data-widget-card className="h-full flex flex-col px-4 py-3.5 rounded-2xl bg-white/25 backdrop-blur-xl border border-white/35 ring-1 ring-white/20 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.38)] hover:bg-white/32 hover:border-white/50 transition-all select-none text-white min-h-0">
        <div className="flex items-center gap-2 mb-2 shrink-0">
          <span className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
            <CheckSquare className="w-4 h-4 text-white" />
          </span>
          <span className="text-sm font-semibold text-white">{t('待办事项')}</span>
          {incompleteCount > 0 && (
            <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center">{incompleteCount}</span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {todos.length === 0 ? (
            <p className="text-xs text-white/65 text-center py-3">{t('暂无待办事项')}</p>
          ) : todos.map((todo: any) => (
            <div key={todo.id} className={`flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-xs ${todo.is_completed ? 'text-white/55' : 'text-white'}`}>
              <button onClick={() => onToggle(todo.id, todo.is_completed)}
                className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${todo.is_completed ? 'bg-blue-500/85 border-white/35' : 'border-white/60 hover:border-white'}`}>
                {todo.is_completed ? <span className="text-white text-[9px] font-bold leading-none">✓</span> : null}
              </button>
              <span className={`flex-1 truncate ${todo.is_completed ? 'line-through' : ''}`}>{todo.content}</span>
              <button onClick={() => onDelete(todo.id)} className="text-white/65 hover:text-white transition-colors shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 mt-2 shrink-0">
          <input value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }}
            placeholder={t('添加待办事项...')}
            className="flex-1 h-8 px-2.5 bg-white/18 border border-white/30 rounded-lg text-xs text-white placeholder:text-white/55 outline-none focus:border-white/60 focus:ring-2 focus:ring-white/20 min-w-0" />
          <button onClick={add} className="w-8 h-8 rounded-lg bg-blue-500/85 text-white flex items-center justify-center hover:bg-blue-500 transition-colors shrink-0">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
