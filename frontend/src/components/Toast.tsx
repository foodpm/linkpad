import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, XCircle, X } from 'lucide-react'

export interface ToastMessage {
  id: number
  text: string
  type: 'success' | 'error'
}

let toastId = 0
let addToastFn: ((text: string, type?: 'success' | 'error') => void) | null = null

export function showToast(text: string, type: 'success' | 'error' = 'success') {
  addToastFn?.(text, type)
}

export default function Toast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const addToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, text, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 2500)
  }, [])

  useEffect(() => {
    addToastFn = addToast
    return () => { addToastFn = null }
  }, [addToast])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
      {toasts.map(t => (
        <div key={t.id}
          className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-lg border backdrop-blur-xl text-sm font-medium animate-[slideUp_0.2s_ease-out] ${
            t.type === 'success'
              ? 'bg-green-50/90 border-green-200/60 text-green-700'
              : 'bg-red-50/90 border-red-200/60 text-red-700'
          }`}>
          {t.type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
          {t.text}
          <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} className="ml-2 opacity-40 hover:opacity-70"><X className="w-3.5 h-3.5" /></button>
        </div>
      ))}
    </div>
  )
}
