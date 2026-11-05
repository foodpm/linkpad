// LinkPad Service Worker — stale-while-revalidate caching
const CACHE = 'linkpad-v1'
const HOST = 'linkpad.site'

// Pre-cache critical pages on install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => {
      return cache.addAll([
        `https://${HOST}/`,
        `https://${HOST}/api/health`,
      ]).catch(() => {
        // Pre-cache is best-effort; don't block install
      })
    })
  )
  self.skipWaiting()
})

// Activate immediately & clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Stale-while-revalidate: serve from cache instantly, refresh in background.
// Only top-level navigations to the site root are intercepted; every other
// request (subresources, non-GET, other paths) passes through untouched.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  const isRootNavigation =
    event.request.mode === 'navigate' &&
    event.request.method === 'GET' &&
    url.pathname === '/'
  if (!isRootNavigation || url.hostname !== HOST) return

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request)

      const updateCache = fetch(event.request)
        .then((response) => {
          const contentType = response.headers.get('content-type') || ''
          if (response.ok && contentType.startsWith('text/html')) {
            const clone = response.clone()
            cache.put(event.request, clone)
          }
          return response
        })
        .catch(() => cached)

      // Return cached immediately if available, else wait for network
      return cached || updateCache
    })
  )
})
