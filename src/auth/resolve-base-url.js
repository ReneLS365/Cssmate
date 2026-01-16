function normalizeUrl (value, errorMessage) {
  const normalized = (value || '').replace(/\/+$/, '')
  if (!normalized || !/^https?:\/\//i.test(normalized)) {
    throw new Error(errorMessage)
  }
  return normalized
}

function resolveFirstValue (values) {
  return values
    .map(value => (value == null ? '' : String(value).trim()))
    .find(value => value.length > 0)
}

function appendCallbackIfNeeded (urlValue) {
  if (!urlValue) return urlValue
  if (urlValue.endsWith('/callback')) return urlValue
  let parsed
  try {
    parsed = new URL(urlValue)
  } catch {
    return urlValue
  }
  const isOriginOnly = parsed.origin === urlValue && (parsed.pathname === '/' || parsed.pathname === '')
  if (isOriginOnly) {
    return `${urlValue}/callback`
  }
  return urlValue
}

export function resolveBaseUrl () {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  const windowEnv = typeof window !== 'undefined' ? window : {}
  const embeddedEnv = windowEnv.__ENV__ || {}
  const resolved = resolveFirstValue([
    metaEnv.VITE_APP_BASE_URL,
    metaEnv.APP_BASE_URL,
    embeddedEnv.VITE_APP_BASE_URL,
    embeddedEnv.APP_BASE_URL,
    windowEnv.APP_BASE_URL,
    windowEnv.location?.origin,
  ])

  return normalizeUrl(resolved, 'Invalid base URL for Auth0 redirect/logout')
}

export function resolveAuthRedirectUri () {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  const windowEnv = typeof window !== 'undefined' ? window : {}
  const embeddedEnv = windowEnv.__ENV__ || {}
  const resolved = resolveFirstValue([
    metaEnv.VITE_AUTH0_REDIRECT_URI,
    embeddedEnv.VITE_AUTH0_REDIRECT_URI,
    windowEnv.VITE_AUTH0_REDIRECT_URI,
  ])

  if (resolved) {
    const normalized = normalizeUrl(resolved, 'Invalid Auth0 redirect URI')
    return appendCallbackIfNeeded(normalized)
  }

  const baseUrl = resolveBaseUrl()
  return `${baseUrl}/callback`
}
