export function resolveBaseUrl () {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  const candidates = [
    metaEnv.VITE_APP_BASE_URL,
    metaEnv.APP_BASE_URL,
    typeof window !== 'undefined' ? window.APP_BASE_URL : undefined,
    typeof window !== 'undefined' ? window.location.origin : undefined,
  ]

  const resolved = candidates
    .map(value => (value == null ? '' : String(value).trim()))
    .find(value => value.length > 0)

  const normalized = (resolved || '').replace(/\/+$/, '')
  if (!normalized || !/^https?:\/\//i.test(normalized)) {
    throw new Error('Invalid base URL for Auth0 redirect/logout')
  }

  return normalized
}
