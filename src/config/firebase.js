const CONFIG_KEY_MAP = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  appId: 'VITE_FIREBASE_APP_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  measurementId: 'VITE_FIREBASE_MEASUREMENT_ID',
}

const REQUIRED_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId']
const OPTIONAL_KEYS = ['storageBucket', 'messagingSenderId', 'measurementId']

const PLACEHOLDER_PATTERNS = [
  /\*{3,}/,
  /changeme/i,
  /replace/i,
  /your[_-]?/i,
]

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isPlaceholderValue(value) {
  if (typeof value !== 'string') return false
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(value))
}

function normalizeConfigValue(value) {
  if (typeof value === 'string') return value.trim()
  return value
}

export function readWindowFirebaseConfig() {
  if (typeof window === 'undefined') return null
  const config = window.FIREBASE_CONFIG
  if (!isPlainObject(config)) return null
  return config
}

export function sanitizeFirebaseConfig(config) {
  if (!isPlainObject(config)) return null
  const next = {}
  ;[...REQUIRED_KEYS, ...OPTIONAL_KEYS].forEach(key => {
    const value = normalizeConfigValue(config[key])
    if (value) next[key] = value
  })
  return Object.keys(next).length ? next : null
}

export function validateFirebaseConfig(config) {
  const missingKeys = []
  const placeholderKeys = []
  REQUIRED_KEYS.forEach(key => {
    const value = config?.[key]
    if (!value || (typeof value === 'string' && !value.trim())) {
      missingKeys.push(CONFIG_KEY_MAP[key] || key)
      return
    }
    if (isPlaceholderValue(String(value))) {
      placeholderKeys.push(CONFIG_KEY_MAP[key] || key)
    }
  })
  return {
    isValid: missingKeys.length === 0 && placeholderKeys.length === 0,
    missingKeys,
    placeholderKeys,
  }
}

export async function fetchFirebaseConfig({ timeoutMs = 8000 } = {}) {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  let timeoutId
  if (controller && timeoutMs) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    timeoutId?.unref?.()
  }
  try {
    const response = await fetch('/.netlify/functions/firebase-config', {
      cache: 'no-store',
      signal: controller?.signal,
    })
    if (!response.ok) return null
    const config = await response.json()
    if (!isPlainObject(config)) return null
    return config
  } catch {
    return null
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export function getFirebaseConfigSummary(config) {
  const safeConfig = config || {}
  return {
    projectId: safeConfig.projectId || '',
    authDomain: safeConfig.authDomain || '',
  }
}

export function getFirebaseEnvKeyMap() {
  return { ...CONFIG_KEY_MAP }
}
