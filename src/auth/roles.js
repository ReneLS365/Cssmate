const DEFAULT_ADMIN_EMAILS = ['mr.lion1995@gmail.com']

function normalizeEmail (email) {
  return (email || '').toString().trim().toLowerCase()
}

function parseAdminEmails (input) {
  if (Array.isArray(input)) return input.map(normalizeEmail).filter(Boolean)
  if (!input) return []
  return input.split(',').map(normalizeEmail).filter(Boolean)
}

function getAdminEmails () {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  const windowEnv = typeof window !== 'undefined' ? window : {}
  const env = (windowEnv && windowEnv.__ENV__) ? windowEnv.__ENV__ : {}

  const candidates = metaEnv.VITE_ADMIN_EMAILS
    || env.VITE_ADMIN_EMAILS
    || windowEnv.VITE_ADMIN_EMAILS
    || env.SHARED_ADMIN_EMAILS
    || windowEnv.SHARED_ADMIN_EMAILS
    || metaEnv.SHARED_ADMIN_EMAILS
    || ''
  const legacy = metaEnv.VITE_ADMIN_EMAIL || env.VITE_ADMIN_EMAIL || windowEnv.VITE_ADMIN_EMAIL || ''
  const defaultList = DEFAULT_ADMIN_EMAILS.map(normalizeEmail)
  const parsed = parseAdminEmails(candidates)
  const legacyParsed = parseAdminEmails(legacy)
  const combined = [...parsed, ...legacyParsed].filter(Boolean)
  return combined.length ? combined : defaultList
}

function isAdminEmail (email) {
  const normalized = normalizeEmail(email)
  return getAdminEmails().includes(normalized)
}

function isAdminUser (user) {
  if (!user) return false
  const permissions = Array.isArray(user.permissions) ? user.permissions : []
  if (permissions.includes('admin:app') || permissions.includes('admin:all')) return true
  const roles = Array.isArray(user.roles) ? user.roles : []
  if (roles.includes('sscaff_admin')) return true
  return isAdminEmail(user.email)
}

export {
  DEFAULT_ADMIN_EMAILS,
  getAdminEmails,
  isAdminEmail,
  isAdminUser,
  normalizeEmail,
  parseAdminEmails,
}
