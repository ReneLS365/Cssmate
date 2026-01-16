export function isAuthCallbackUrl () {
  if (typeof window === 'undefined') return false
  const path = window.location?.pathname || ''
  if (!path.endsWith('/callback')) return false
  const params = new URLSearchParams(window.location?.search || '')
  return params.has('code') && params.has('state')
}

export function getAuthCallbackError () {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location?.search || '')
  const error = params.get('error')
  if (!error) return null
  const description = params.get('error_description') || ''
  return {
    error,
    description,
  }
}
