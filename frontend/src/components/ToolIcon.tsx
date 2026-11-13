import { useEffect, useState, type ReactNode } from 'react'
import { proxyIconSrc } from '../image'
import { API_BASE } from '../api'

interface ToolIconProps {
  icon: string
  className: string
  fallback: ReactNode
}

export default function ToolIcon({ icon, className, fallback }: ToolIconProps) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [icon])

  if (failed) return <>{fallback}</>

  return (
    <img
      src={proxyIconSrc(icon, API_BASE)}
      className={className}
      onError={() => setFailed(true)}
      alt=""
    />
  )
}
