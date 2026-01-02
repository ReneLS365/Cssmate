const ENV_TO_CONFIG_KEY = {
  VITE_FIREBASE_API_KEY: 'apiKey',
  VITE_FIREBASE_AUTH_DOMAIN: 'authDomain',
  VITE_FIREBASE_PROJECT_ID: 'projectId',
  VITE_FIREBASE_APP_ID: 'appId',
  VITE_FIREBASE_STORAGE_BUCKET: 'storageBucket',
  VITE_FIREBASE_MESSAGING_SENDER_ID: 'messagingSenderId',
  VITE_FIREBASE_MEASUREMENT_ID: 'measurementId',
}

const STORAGE_KEY = 'cssmate:firebaseConfig'

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readEnvValue(key) {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && typeof import.meta.env[key] !== 'undefined') {
      return import.meta.env[key]
    }
  } catch {}

  if (typeof process !== 'undefined' && process?.env && typeof process.env[key] !== 'undefined') {
    return process.env[key]
  }

  return undefined
}

function getBrowserConfigResult() {
  if (typeof window === 'undefined') return { config: null, source: null }
  if (isPlainObject(window.FIREBASE_CONFIG)) {
    return { config: window.FIREBASE_CONFIG, source: 'window' }
  }
  const storageCandidates = [window.sessionStorage, window.localStorage]
  for (const storage of storageCandidates) {
    if (!storage || typeof storage.getItem !== 'function') continue
    const stored = storage.getItem(STORAGE_KEY)
    if (!stored) continue
    try {
      const parsed = JSON.parse(stored)
      if (isPlainObject(parsed)) {
        return {
          config: parsed,
          source: storage === window.sessionStorage ? 'sessionStorage' : 'localStorage',
        }
      }
    } catch {}
  }
  return { config: null, source: null }
}

function readConfigValue(envKey, browserConfig) {
  const configKey = ENV_TO_CONFIG_KEY[envKey]
  if (browserConfig && configKey && typeof browserConfig[configKey] !== 'undefined') {
    return browserConfig[configKey]
  }
  return readEnvValue(envKey)
}

function isMissingEnvValue(value) {
  if (value === undefined || value === null) return true
  if (typeof value === 'string' && value.trim() === '') return true
  return false
}

export function getFirebaseConfig() {
  const { config: browserConfig } = getBrowserConfigResult()
  const cfg = {
    apiKey: readConfigValue('VITE_FIREBASE_API_KEY', browserConfig),
    authDomain: readConfigValue('VITE_FIREBASE_AUTH_DOMAIN', browserConfig),
    projectId: readConfigValue('VITE_FIREBASE_PROJECT_ID', browserConfig),
    appId: readConfigValue('VITE_FIREBASE_APP_ID', browserConfig),
    storageBucket: readConfigValue('VITE_FIREBASE_STORAGE_BUCKET', browserConfig),
    messagingSenderId: readConfigValue('VITE_FIREBASE_MESSAGING_SENDER_ID', browserConfig),
  }

  const required = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID',
  ]
  const missing = required.filter((key) => {
    const configKey = ENV_TO_CONFIG_KEY[key]
    return isMissingEnvValue(cfg[configKey])
  })

  if (missing.length) {
    throw new Error(`[firebase] Missing env vars: ${missing.join(', ')}`)
  }

  Object.keys(cfg).forEach((key) => {
    if (isMissingEnvValue(cfg[key])) delete cfg[key]
  })

  return cfg
}

export function getFirebaseConfigDiagnostics() {
  const { config: browserConfig } = getBrowserConfigResult()
  return {
    hasApiKey: Boolean(readConfigValue('VITE_FIREBASE_API_KEY', browserConfig)),
    authDomain: readConfigValue('VITE_FIREBASE_AUTH_DOMAIN', browserConfig) || '',
    projectId: readConfigValue('VITE_FIREBASE_PROJECT_ID', browserConfig) || '',
    appIdPresent: Boolean(readConfigValue('VITE_FIREBASE_APP_ID', browserConfig)),
    storageBucket: readConfigValue('VITE_FIREBASE_STORAGE_BUCKET', browserConfig) || '',
    messagingSenderIdPresent: Boolean(readConfigValue('VITE_FIREBASE_MESSAGING_SENDER_ID', browserConfig)),
  }
}

export function getFirebaseConfigRuntimeSource() {
  const browserResult = getBrowserConfigResult()
  if (browserResult.source) return browserResult.source
  const anyEnvValue = Object.keys(ENV_TO_CONFIG_KEY).some((key) => !isMissingEnvValue(readEnvValue(key)))
  return anyEnvValue ? 'env' : 'unknown'
}
