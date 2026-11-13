export function isImageIcon(icon: string): boolean {
  return icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('//') || icon.startsWith('data:image') || icon.startsWith('/api/')
}

export function proxyIconSrc(icon: string, apiBase: string): string {
  if (!icon || icon.startsWith('data:image')) return icon
  if (icon.startsWith('/api/')) return new URL(icon, apiBase).toString()
  if (icon.startsWith('//')) icon = `https:${icon}`
  if (!/^https?:\/\//i.test(icon)) return icon

  const absolute = new URL(icon, apiBase)
  const proxy = new URL('/api/icon-proxy', apiBase)
  proxy.searchParams.set('url', absolute.toString())
  return proxy.toString()
}
