// Admin afgøres via Auth0 roles (sscaff_owner eller sscaff_admin).
// Fallback: hvis nogen stadig har VITE_ADMIN_EMAIL sat, kan den stadig virke.
export function isAdmin (userOrEmail) {
  const user = (userOrEmail && typeof userOrEmail === 'object') ? userOrEmail : null
  const email = user ? user.email : String(userOrEmail || '')

  const roles = Array.isArray(user?.roles) ? user.roles : []
  if (roles.includes('sscaff_owner') || roles.includes('sscaff_admin')) return true

  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  const configEmail = metaEnv.VITE_ADMIN_EMAIL || (typeof window !== 'undefined' ? window.VITE_ADMIN_EMAIL : '')
  if (!configEmail || !email) return false
  return configEmail.trim().toLowerCase() === String(email).trim().toLowerCase()
}
