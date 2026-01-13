export function resolveBaseUrl () {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  const windowEnv = typeof window !== 'undefined' ? window : {}
  const embeddedEnv = windowEnv.__ENV__ || {}
  const candidates = [
    metaEnv.VITE_AUTH0_REDIRECT_URI,
    embeddedEnv.VITE_AUTH0_REDIRECT_URI,
    windowEnv.VITE_AUTH0_REDIRECT_URI,
    metaEnv.VITE_APP_BASE_URL,
    metaEnv.APP_BASE_URL,
    windowEnv.APP_BASE_URL,
    windowEnv.location?.origin,
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
