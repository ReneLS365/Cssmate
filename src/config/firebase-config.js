import {
  getFirebaseConfigSummary,
  getFirebaseEnvKeyMap,
  readWindowFirebaseConfig,
  sanitizeFirebaseConfig,
  validateFirebaseConfig,
} from './firebase-utils.js'

const FIREBASE_CONFIG_CACHE_KEY = 'cssmate:firebaseConfig'
const FIREBASE_CONFIG_ENDPOINT = '/.netlify/functions/firebase-config'
const FETCH_TIMEOUT_MS = 8000

let firebaseConfigSnapshot = null
let firebaseConfigStatus = { isValid: false, missingKeys: [], placeholderKeys: [] }
let firebaseConfigSource = 'unknown'
let firebaseConfigPromise = null

function readCachedFirebaseConfig() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage?.getItem(FIREBASE_CONFIG_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return sanitizeFirebaseConfig(parsed)
  } catch (error) {
    console.warn('Kunne ikke læse Firebase config cache', error)
    return null
  }
}

function cacheFirebaseConfig(config) {
  if (typeof window === 'undefined' || !config) return
  try {
    window.sessionStorage?.setItem(FIREBASE_CONFIG_CACHE_KEY, JSON.stringify(config))
  } catch (error) {
    console.warn('Kunne ikke gemme Firebase config cache', error)
  }
}

async function fetchFirebaseConfig() {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timeoutId = setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS)
  let response
  try {
    response = await fetch(FIREBASE_CONFIG_ENDPOINT, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller?.signal,
    })
  } catch (error) {
    error.code = error?.name === 'AbortError' ? 'config-timeout' : 'config-fetch'
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
  if (!response?.ok) {
    const error = new Error(`Firebase config endpoint fejlede (${response?.status || 'ukendt status'}).`)
    error.code = 'config-response'
    throw error
  }
  const data = await response.json()
  return sanitizeFirebaseConfig(data)
}

function buildOfflineConfigError() {
  const error = new Error('Du er offline. Kan ikke hente login-konfiguration.')
  error.code = 'offline-config'
  return error
}

export function reportFirebaseConfigStatus(config) {
  const validation = validateFirebaseConfig(config)
  firebaseConfigStatus = validation
  firebaseConfigSnapshot = config
  return validation
}

export async function loadFirebaseConfig() {
  if (firebaseConfigPromise) return firebaseConfigPromise
  firebaseConfigPromise = (async () => {
    const windowConfig = readWindowFirebaseConfig()
    const cached = windowConfig ? sanitizeFirebaseConfig(windowConfig) : readCachedFirebaseConfig()
    const cachedSource = windowConfig ? 'window' : cached ? 'session-cache' : 'none'
    try {
      const fetched = await fetchFirebaseConfig()
      if (fetched) {
        cacheFirebaseConfig(fetched)
        if (typeof window !== 'undefined') {
          window.FIREBASE_CONFIG = fetched
        }
        firebaseConfigSource = 'runtime-endpoint'
        return fetched
      }
    } catch (error) {
      if (cached) {
        firebaseConfigSource = cachedSource
        return cached
      }
      if (error?.code === 'config-fetch' || error?.code === 'config-timeout') {
        throw buildOfflineConfigError()
      }
      throw error
    }
    if (cached) {
      firebaseConfigSource = cachedSource
      return cached
    }
    throw buildOfflineConfigError()
  })()
  try {
    return await firebaseConfigPromise
  } catch (error) {
    firebaseConfigPromise = null
    throw error
  }
}

export function getFirebaseConfigSnapshot() {
  return firebaseConfigSnapshot ? { ...firebaseConfigSnapshot } : null
}

export function getFirebaseConfigStatus() {
  return { ...firebaseConfigStatus }
}

export function getFirebaseConfigSource() {
  return firebaseConfigSource
}

export function getFirebaseEnvPresence() {
  const envKeyMap = getFirebaseEnvKeyMap()
  const snapshot = firebaseConfigSnapshot || {}
  return Object.fromEntries(
    Object.entries(envKeyMap).map(([configKey, envKey]) => [envKey, Boolean(snapshot?.[configKey])])
  )
}

export function getFirebaseConfigSummarySnapshot() {
  return getFirebaseConfigSummary(firebaseConfigSnapshot || {})
}

export function clearFirebaseConfigCache() {
  firebaseConfigSnapshot = null
  firebaseConfigStatus = { isValid: false, missingKeys: [], placeholderKeys: [] }
  firebaseConfigSource = 'unknown'
  firebaseConfigPromise = null
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage?.removeItem(FIREBASE_CONFIG_CACHE_KEY)
  } catch {}
}
