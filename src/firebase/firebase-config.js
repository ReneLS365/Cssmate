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

function isMissingEnvValue(value) {
  if (value === undefined || value === null) return true
  if (typeof value === 'string' && value.trim() === '') return true
  return false
}

export function getFirebaseConfig() {
  const cfg = {
    apiKey: readEnvValue('VITE_FIREBASE_API_KEY'),
    authDomain: readEnvValue('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: readEnvValue('VITE_FIREBASE_PROJECT_ID'),
    appId: readEnvValue('VITE_FIREBASE_APP_ID'),
    storageBucket: readEnvValue('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: readEnvValue('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  }

  const required = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID',
  ]
  const missing = required.filter((key) => isMissingEnvValue(readEnvValue(key)))

  if (missing.length) {
    throw new Error(`[firebase] Missing env vars: ${missing.join(', ')}`)
  }

  Object.keys(cfg).forEach((key) => {
    if (isMissingEnvValue(cfg[key])) delete cfg[key]
  })

  return cfg
}

export function getFirebaseConfigDiagnostics() {
  return {
    hasApiKey: Boolean(readEnvValue('VITE_FIREBASE_API_KEY')),
    authDomain: readEnvValue('VITE_FIREBASE_AUTH_DOMAIN') || '',
    projectId: readEnvValue('VITE_FIREBASE_PROJECT_ID') || '',
    appIdPresent: Boolean(readEnvValue('VITE_FIREBASE_APP_ID')),
    storageBucket: readEnvValue('VITE_FIREBASE_STORAGE_BUCKET') || '',
    messagingSenderIdPresent: Boolean(readEnvValue('VITE_FIREBASE_MESSAGING_SENDER_ID')),
  }
}
