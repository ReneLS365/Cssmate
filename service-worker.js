/* global self */

const swBaseUrl = typeof self !== 'undefined' && self.location ? new URL(self.location.href) : null
const versionScriptUrl = swBaseUrl ? new URL('./js/version.js', swBaseUrl) : null

if (versionScriptUrl) {
  importScripts(versionScriptUrl.href)
} else {
importScripts('/js/version.js')
}

const BUILD_META = (typeof self !== 'undefined' && self.CSSMATE_BUILD_META) ? self.CSSMATE_BUILD_META : {}
const APP_VERSION = BUILD_META.cacheKey || self.CSSMATE_APP_VERSION || BUILD_META.appVersion || 'dev'
// Replaced at build time by scripts/bump-sw-version.js
const SW_BUILD_ID = "202601212003-712ddf7"
const CACHE_VERSION = `sscaff-${APP_VERSION}-${SW_BUILD_ID}`
const CACHE_NAME = CACHE_VERSION
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/admin.html',
  '/main.js',
  '/main.min.js',
  '/auth0-config.js',
  '/app-main.js',
  '/js/importmap.json',
  '/boot-inline.js',
  '/style.css',
  '/print.css',
  '/css/a9-calc.css',
  '/css/numpad.css',
  '/css/pwa.css',
  '/src/styles/fixes.css',
  '/src/debug/tools.js',
  '/src/state/debug.js',
  '/src/state/user-store.js',
  '/src/api/client.js',
  '/src/auth/auth0.js',
  '/src/auth/auth0-client.js',
  '/src/auth/auth0-ui.js',
  '/src/auth/admin.js',
  '/src/auth/admin-page.js',
  '/src/auth/auth-callback.js',
  '/src/auth/force-login.js',
  '/src/auth/org-store.js',
  '/src/auth/skip-auth-gate.js',
  '/src/auth/ui-locks.js',
  '/src/auth/resolve-base-url.js',
  '/src/ui/debug-overlay.js',
  '/src/ui/login-overlay.js',
  '/src/ui/app-guard.js',
  '/src/ui/guards/ui-unlock.js',
  '/src/ui/team-admin-page.js',
  '/src/ui/toast.js',
  '/src/services/team-ids.js',
  '/src/services/team-access.js',
  '/src/services/teams.js',
  '/src/version.js',
  '/src/utils/reset-app.js',
  '/js/akkord-export.js',
  '/js/akkord-export-ui.js',
  '/js/shared-ledger.js',
  '/js/shared-cases-panel.js',
  '/js/storageDraft.js',
  '/js/storageHistory.js',
  '/js/history-normalizer.js',
  '/js/utils/downloadBlob.js',
  '/src/features/export/lazy-libs.js',
  '/js/akkord-converter.js',
  '/js/export-meta.js',
  '/js/numpad.js',
  '/js/version.js',
  '/js/vendor/html2canvas.esm.js',
  '/js/vendor/auth0-spa-js.js',
  '/js/vendor/jspdf.es.min.js',
  '/js/vendor/jspdf-esm-wrapper.js',
  '/js/vendor/jspdf.umd.min.js',
  '/js/vendor/jszip-esm-wrapper.js',
  '/js/vendor/jszip.min.js',
  '/dataset.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-192-maskable.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  '/icons/favicon.svg',
  '/placeholders/placeholder-akkordseddel.json',
  '/placeholders/placeholder-akkordseddel.pdf'
]

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response && response.ok) {
    cache.put(request, response.clone())
  }
  return response
}

async function handleNavigation(request) {
  const url = new URL(request.url)
  if (url.pathname === '/reset' || url.pathname === '/reset.html') {
    return fetch(request, { cache: 'no-store' })
  }
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(request)
    cache.put(request, response.clone())
    return response
  } catch (error) {
    const cached = await cache.match(request)
    if (cached) return cached
    return cache.match('/index.html')
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    await cache.addAll(PRECACHE_URLS)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('sscaff-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then(clients => {
        clients.forEach(client => client.postMessage({ type: 'SSCaff_NEW_VERSION' }))
      })
  )
})

self.addEventListener('message', event => {
  if (event?.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  const bypassRemoteOrigins = []
  if (url.origin !== self.location.origin) {
    if (bypassRemoteOrigins.includes(url.origin)) {
      event.respondWith(fetch(request))
    }
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }

  const bypassPaths = []
  const bypass = bypassPaths.includes(url.pathname)
  if (bypass) {
    event.respondWith(fetch(request))
    return
  }

  event.respondWith(cacheFirst(request))
})
