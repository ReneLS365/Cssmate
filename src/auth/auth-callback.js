export function isAuthCallbackUrl () {
  if (typeof window === 'undefined') return false
  const path = window.location?.pathname || ''
  if (!path.endsWith('/callback')) return false
  const params = new URLSearchParams(window.location?.search || '')
  return params.has('code') && params.has('state')
}
