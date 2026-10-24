import { useCallback, useEffect, useRef, useState } from 'react'
import { linkMeta } from '../api'

function normalizeUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`
  try {
    const url = new URL(withProtocol)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

/**
 * 自动抓取网页描述。用户手动改过描述后，后续 URL 变化不会覆盖用户输入；
 * 点击“重新抓取”时会显式覆盖。
 */
export function useAutoLinkDescription() {
  const [description, setDescriptionState] = useState('')
  const [loading, setLoading] = useState(false)
  const descriptionRef = useRef('')
  const autoDescriptionRef = useRef('')
  const touchedRef = useRef(false)
  const urlRef = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sequenceRef = useRef(0)

  const applyDescription = useCallback((value: string) => {
    descriptionRef.current = value
    setDescriptionState(value)
  }, [])

  const setDescription = useCallback((value: string) => {
    touchedRef.current = true
    applyDescription(value)
  }, [applyDescription])

  const reset = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    sequenceRef.current++
    setLoading(false)
    touchedRef.current = false
    autoDescriptionRef.current = ''
    applyDescription('')
  }, [applyDescription])

  const fetchDescription = useCallback(async (rawUrl: string, force = false) => {
    const url = normalizeUrl(rawUrl)
    if (!url) {
      setLoading(false)
      return
    }

    const current = descriptionRef.current
    // 用户已经手动填写时，自动抓取不覆盖；显式点击重新抓取时除外。
    if (!force && touchedRef.current && current !== autoDescriptionRef.current) {
      setLoading(false)
      return
    }

    const sequence = ++sequenceRef.current
    setLoading(true)
    try {
      const meta = await linkMeta.resolve(url, force)
      if (sequence !== sequenceRef.current || normalizeUrl(urlRef.current) !== url) return

      const next = (meta?.description || '').trim().replace(/\s+/g, ' ').slice(0, 300)
      if (!next) return

      const latest = descriptionRef.current
      const canReplace = force || !touchedRef.current || latest === autoDescriptionRef.current
      if (!canReplace) return

      autoDescriptionRef.current = next
      touchedRef.current = false
      applyDescription(next)
    } catch {
      // 抓取失败时保留用户输入，也不打断添加流程。
    } finally {
      if (sequence === sequenceRef.current) setLoading(false)
    }
  }, [applyDescription])

  const scheduleFetch = useCallback((rawUrl: string) => {
    urlRef.current = rawUrl
    // 取消上一次尚未返回的请求，避免旧网址的描述覆盖新网址。
    sequenceRef.current++
    setLoading(false)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    const url = normalizeUrl(rawUrl)
    if (!url) {
      setLoading(false)
      // 只清理由上一次自动抓取填入的内容，不清理用户手写内容。
      if (!touchedRef.current || descriptionRef.current === autoDescriptionRef.current) {
        autoDescriptionRef.current = ''
        applyDescription('')
      }
      return
    }

    // 网址变化时先清掉上一次自动抓取的内容，等待新描述返回。
    if (!touchedRef.current || descriptionRef.current === autoDescriptionRef.current) {
      autoDescriptionRef.current = ''
      applyDescription('')
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void fetchDescription(rawUrl)
    }, 700)
  }, [applyDescription, fetchDescription])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    sequenceRef.current++
  }, [])

  return {
    description,
    setDescription,
    loading,
    fetchDescription,
    scheduleFetch,
    reset,
  }
}
