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
        <div data-widget-card className="h-full flex items-center gap-3 px-4 bg-white/70 rounded-2xl border border-white/60 shadow-sm select-none">
          <span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
            <CheckSquare className="w-5 h-5 text-blue-500" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{t('待办事项')}</p>
            <p className="text-xs text-gray-400 truncate">{t('{n} 项未完成', { n: incompleteCount })}</p>
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
      <div data-widget-card className="h-full flex flex-col px-4 py-3.5 bg-white/70 rounded-2xl border border-white/60 shadow-sm select-none min-h-0">
        <div className="flex items-center gap-2 mb-2 shrink-0">
          <span className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
            <CheckSquare className="w-4 h-4 text-blue-500" />
          </span>
          <span className="text-sm font-semibold text-gray-800">{t('待办事项')}</span>
          {incompleteCount > 0 && (
            <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center">{incompleteCount}</span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {todos.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">{t('暂无待办事项')}</p>
          ) : todos.map((todo: any) => (
            <div key={todo.id} className={`flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-xs ${todo.is_completed ? 'text-gray-400' : 'text-gray-700'}`}>
              <button onClick={() => onToggle(todo.id, todo.is_completed)}
                className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${todo.is_completed ? 'bg-blue-500 border-blue-500' : 'border-gray-300 hover:border-blue-400'}`}>
                {todo.is_completed ? <span className="text-white text-[9px] font-bold leading-none">✓</span> : null}
              </button>
              <span className={`flex-1 truncate ${todo.is_completed ? 'line-through' : ''}`}>{todo.content}</span>
              <button onClick={() => onDelete(todo.id)} className="text-gray-300 hover:text-red-400 transition-colors shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 mt-2 shrink-0">
          <input value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }}
            placeholder={t('添加待办事项...')}
            className="flex-1 h-8 px-2.5 bg-gray-50/80 border border-gray-200/80 rounded-lg text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 min-w-0" />
          <button onClick={add} className="w-8 h-8 rounded-lg bg-blue-500 text-white flex items-center justify-center hover:bg-blue-600 transition-colors shrink-0">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
