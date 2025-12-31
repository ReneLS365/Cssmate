import { logoutUser } from '../../js/shared-auth.js'
import { getFirestoreDb, getFirestoreHelpers } from '../../js/shared-firestore.js'
import { clearFirebaseConfigCache } from '../config/firebase-config.js'
import { clearTeamAccessCache } from '../services/team-access.js'

function shouldUseBrowserApis () {
  return typeof window !== 'undefined'
}

async function clearServiceWorkers () {
  if (!shouldUseBrowserApis() || !('serviceWorker' in navigator)) return
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map(reg => reg.unregister()))
  } catch (error) {
    console.warn('Kunne ikke afregistrere service workers', error)
  }
}

async function clearCaches () {
  if (!shouldUseBrowserApis() || !window.caches) return
  try {
    const keys = await caches.keys()
    await Promise.all(keys.map(key => caches.delete(key)))
  } catch (error) {
    console.warn('Kunne ikke rydde cache storage', error)
  }
}

async function clearIndexedDb () {
  if (!shouldUseBrowserApis() || !window.indexedDB) return
  const knownDbNames = ['csmate_projects', 'firebaseLocalStorageDb']
  if (typeof indexedDB.databases !== 'function') {
    knownDbNames.forEach(name => {
      try { indexedDB.deleteDatabase(name) } catch {}
    })
    return
  }
  try {
    const databases = await indexedDB.databases()
    const dbNames = databases.map(db => db?.name).filter(Boolean)
    const targets = dbNames.length ? dbNames : knownDbNames
    await Promise.all(targets.map(name => new Promise(resolve => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = request.onerror = request.onblocked = () => resolve()
    })))
  } catch (error) {
    console.warn('Kunne ikke rydde IndexedDB', error)
  }
}

async function clearOfflineCaches () {
  await clearServiceWorkers()
  await clearCaches()
}

export async function resetServiceWorkerAndCaches () {
  if (!shouldUseBrowserApis()) return
  try {
    clearFirebaseConfigCache()
  } catch {}
  await clearServiceWorkers()
  await clearCaches()
  window.location?.reload()
}

export async function hardRepairClient () {
  if (!shouldUseBrowserApis()) return
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(reg => reg.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(key => caches.delete(key)))
    }
  } catch {}
  try { window.sessionStorage?.clear() } catch {}
  try { window.localStorage?.removeItem('cssmate:firebaseConfig') } catch {}
  window.location?.replace?.(`${window.location.pathname}?repaired=1`)
}

async function clearFirestorePersistence () {
  try {
    const db = await getFirestoreDb()
    const sdk = await getFirestoreHelpers()
    if (typeof sdk.terminate === 'function') {
      await sdk.terminate(db)
    }
    if (typeof sdk.clearIndexedDbPersistence === 'function') {
      await sdk.clearIndexedDbPersistence(db)
    }
  } catch (error) {
    console.warn('Kunne ikke nulstille Firestore persistence', error)
  }
}

function clearStorage () {
  if (!shouldUseBrowserApis()) return
  try { window.localStorage?.clear() } catch {}
  try { window.sessionStorage?.clear() } catch {}
}

function reloadWithCacheBust () {
  if (!shouldUseBrowserApis()) return
  const nextUrl = new URL(window.location.href)
  nextUrl.searchParams.set('reset', Date.now().toString())
  window.location.replace(nextUrl.toString())
}

export async function resetAppState ({ reload = true } = {}) {
  if (!shouldUseBrowserApis()) return

  try {
    await logoutUser()
  } catch (error) {
    console.warn('Logout fejlede under reset', error)
  }

  await clearFirestorePersistence()
  await clearOfflineCaches()
  await clearIndexedDb()
  clearTeamAccessCache()
  clearStorage()

  if (reload) {
    reloadWithCacheBust()
  }
}

export async function resetOfflineCache ({ reload = true, clearIndexedDb: shouldClearIndexedDb = false } = {}) {
  if (!shouldUseBrowserApis()) return

  await clearOfflineCaches()
  if (shouldClearIndexedDb) {
    await clearIndexedDb()
  }

  if (reload) {
    reloadWithCacheBust()
  }
}
