import {
  getFirebaseConfigSummary,
  getFirebaseEnvKeyMap,
  sanitizeFirebaseConfig,
  validateFirebaseConfig,
} from './firebase-utils.js'
import { getFirebaseConfig, getFirebaseConfigDiagnostics } from '../firebase/firebase-config.js'

let firebaseConfigSnapshot = null
let firebaseConfigStatus = { isValid: false, missingKeys: [], placeholderKeys: [] }
let firebaseConfigSource = 'unknown'
let firebaseConfigPromise = null

export function reportFirebaseConfigStatus(config) {
  const validation = validateFirebaseConfig(config)
  firebaseConfigStatus = validation
  firebaseConfigSnapshot = config
  return validation
}

export async function loadFirebaseConfig() {
  if (firebaseConfigPromise) return firebaseConfigPromise
  firebaseConfigPromise = (async () => {
    const config = sanitizeFirebaseConfig(getFirebaseConfig())
    firebaseConfigSnapshot = config
    firebaseConfigSource = 'env'
    if (typeof window !== 'undefined' && config) {
      window.FIREBASE_CONFIG = config
    }
    return config
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

export function getFirebaseConfigDiagnosticsSnapshot() {
  return getFirebaseConfigDiagnostics()
}

export function clearFirebaseConfigCache() {
  firebaseConfigSnapshot = null
  firebaseConfigStatus = { isValid: false, missingKeys: [], placeholderKeys: [] }
  firebaseConfigSource = 'unknown'
  firebaseConfigPromise = null
  if (typeof window === 'undefined') return
  try {
    delete window.FIREBASE_CONFIG
  } catch {}
}
