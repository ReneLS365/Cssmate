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
const API_KEY_MIN_LENGTH = 20

const PLACEHOLDER_PATTERNS = [
  /\*{3,}/,
  /changeme/i,
  /replace/i,
  /your[_-]?/i,
  /^undefined$/i,
  /^null$/i,
]

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isPlaceholderValue(value) {
  if (typeof value !== 'string') return false
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(value))
}

function isTooShortApiKey(value) {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length < API_KEY_MIN_LENGTH
}

function normalizeConfigValue(value) {
  if (typeof value === 'string') return value.trim()
  return value
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
    if (key === 'apiKey' && isTooShortApiKey(String(value))) {
      placeholderKeys.push(CONFIG_KEY_MAP[key] || key)
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

export function maskFirebaseApiKey(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) return ''
  const trimmed = apiKey.trim()
  if (trimmed.length <= 10) return `${trimmed.slice(0, 2)}...${trimmed.slice(-2)}`
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`
}

export function getFirebaseConfigSummary(config) {
  const safeConfig = config || {}
  return {
    projectId: safeConfig.projectId || '',
    authDomain: safeConfig.authDomain || '',
    apiKeyMasked: maskFirebaseApiKey(safeConfig.apiKey || ''),
  }
}

export function getFirebaseEnvKeyMap() {
  return { ...CONFIG_KEY_MAP }
}
