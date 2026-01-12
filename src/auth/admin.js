export function isAdmin (userEmail) {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  const configEmail = metaEnv.VITE_ADMIN_EMAIL || (typeof window !== 'undefined' ? window.VITE_ADMIN_EMAIL : '')
  if (!configEmail || !userEmail) return false
  return configEmail.trim().toLowerCase() === String(userEmail).trim().toLowerCase()
}
