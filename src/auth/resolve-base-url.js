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

  if (!resolved) {
    throw new Error('Base URL mangler. Sæt VITE_APP_BASE_URL eller APP_BASE_URL til en fuld https:// URL.')
  }

  const normalized = resolved.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error('Base URL er ugyldig. Brug http:// eller https:// i VITE_APP_BASE_URL / APP_BASE_URL.')
  }

  return normalized
}
