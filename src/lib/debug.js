const DEBUG_STORAGE_KEY = 'cssmate_debug'

function readMetaEnvValue (key) {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      return import.meta.env[key]
    }
  } catch {
    // ignore
  }
  return ''
}

function readQueryDebugFlag () {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search || '')
    return params.get('debug') === '1'
  } catch {
    return false
  }
}

function readStorageDebugFlag () {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage?.getItem(DEBUG_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function isDebugEnabled () {
  const envFlag = String(readMetaEnvValue('VITE_DEBUG') || '').toLowerCase()
  if (envFlag === '1' || envFlag === 'true') return true
  if (readQueryDebugFlag()) return true
  return readStorageDebugFlag()
}

export function debugLog (...args) {
  if (!isDebugEnabled()) return
  try {
    console.debug('[debug]', ...args)
  } catch {
    // ignore logging errors
  }
}

export function debugWarn (...args) {
  if (!isDebugEnabled()) return
  try {
    console.warn('[debug]', ...args)
  } catch {
    // ignore logging errors
  }
}

export function debugGroup (label, fn) {
  if (!isDebugEnabled()) return fn?.()
  const hasGroup = typeof console.groupCollapsed === 'function'
  if (hasGroup) {
    console.groupCollapsed(`[debug] ${label}`)
  }
  try {
    return fn?.()
  } finally {
    if (hasGroup) {
      console.groupEnd()
    }
  }
}

export async function debugMeasure (label, fn) {
  if (!isDebugEnabled()) return fn()
  const start = (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now()
  try {
    const result = await fn()
    const end = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now()
    debugLog(`${label} in ${(end - start).toFixed(1)}ms`)
    return result
  } catch (error) {
    const end = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now()
    debugWarn(`${label} failed after ${(end - start).toFixed(1)}ms`, error)
    throw error
  }
}
