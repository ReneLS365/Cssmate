const TOKEN_STORAGE_KEY = 'cssmate:authToken'

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
  const token = getAuthToken()
  const headers = new Headers(options.headers || {})
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(path, { ...options, headers })
  if (!response.ok) {
    const errorText = await response.text()
    const error = new Error(errorText || response.statusText || 'API fejl')
    error.status = response.status
    error.payload = errorText
    throw error
  }
  return response
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

