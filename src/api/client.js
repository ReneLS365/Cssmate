import { getToken } from '../auth/auth0-client.js'
import { debugLog, debugMeasure, isDebugEnabled } from '../lib/debug.js'

const TOKEN_STORAGE_KEY = 'cssmate:authToken'

let requestCounter = 0

function formatRequestLabel (path, method) {
  const normalizedMethod = (method || 'GET').toUpperCase()
  try {
    const url = new URL(path, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
    return `${normalizedMethod} ${url.pathname}${url.search}`
  } catch {
    return `${normalizedMethod} ${path}`
  }
}

async function resolveAuthToken () {
  if (typeof window === 'undefined') return getAuthToken()
  try {
    return await getToken()
  } catch {
    return getAuthToken()
  }
}

export function getAuthToken () {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage?.getItem(TOKEN_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function setAuthToken (token) {
  if (typeof window === 'undefined') return
  try {
    if (token) {
      window.localStorage?.setItem(TOKEN_STORAGE_KEY, token)
    } else {
      window.localStorage?.removeItem(TOKEN_STORAGE_KEY)
    }
  } catch {
    // ignore storage errors
  }
}

export function clearAuthToken () {
  setAuthToken('')
}

export async function apiFetch (path, options = {}) {
  const debugEnabled = isDebugEnabled()
  const requestId = debugEnabled ? `${++requestCounter}` : ''
  const label = debugEnabled ? formatRequestLabel(path, options.method) : ''
  const runner = async () => {
    const token = await resolveAuthToken()
    const headers = new Headers(options.headers || {})
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    if (!headers.has('Content-Type') && options.body) {
      headers.set('Content-Type', 'application/json')
    }
    const response = await fetch(path, { ...options, headers })
    if (debugEnabled) {
      const contentLength = response.headers.get('content-length')
      debugLog(`${label} response`, {
        requestId,
        status: response.status,
        ok: response.ok,
        contentLength,
      })
    }
    if (!response.ok) {
      const errorText = await response.text()
      let payload = null
      try {
        payload = errorText ? JSON.parse(errorText) : null
      } catch {
        payload = null
      }
      const message = payload?.error || errorText || response.statusText || 'API fejl'
      const error = new Error(message)
      error.status = response.status
      error.payload = payload || errorText
      error.code = payload?.code || ''
      if (debugEnabled) {
        debugLog(`${label} error`, { requestId, status: response.status, code: error.code })
      }
      throw error
    }
    return response
  }
  if (!debugEnabled) {
    return runner()
  }
  return debugMeasure(`${label} #${requestId}`, runner)
}

export async function apiJson (path, options = {}) {
  const response = await apiFetch(path, options)
  if (response.status === 204) return null
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
