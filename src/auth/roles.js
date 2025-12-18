const DEFAULT_ADMIN_EMAILS = ['mr.lion1995@gmail.com']

function normalizeEmail (email) {
  return (email || '').toString().trim().toLowerCase()
}

function parseAdminEmails (input) {
  if (!input) return []
  if (Array.isArray(input)) return input.map(normalizeEmail).filter(Boolean)
  if (typeof input === 'string') {
    return input.split(',').map(normalizeEmail).filter(Boolean)
  }
  return []
}

function getAdminEmails () {
  const defaultList = DEFAULT_ADMIN_EMAILS.map(normalizeEmail)
  if (typeof window === 'undefined') return defaultList
  const candidates = window.SHARED_ADMIN_EMAILS
    || window.ADMIN_EMAILS
    || window.VITE_ADMIN_EMAILS
    || []
  const parsed = parseAdminEmails(candidates)
  if (!parsed.length) return defaultList
  return Array.from(new Set(parsed))
}

function isAdminEmail (email) {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  return getAdminEmails().includes(normalized)
}

export {
  DEFAULT_ADMIN_EMAILS,
  getAdminEmails,
  isAdminEmail,
  normalizeEmail,
  parseAdminEmails,
}
