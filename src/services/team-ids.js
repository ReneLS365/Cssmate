import { normalizeEmail } from '../auth/roles.js'

const LEDGER_TEAM_PREFIX = 'sscaff-team-'
const DEFAULT_TEAM_SLUG = 'hulmose'
const DEFAULT_TEAM_ID = `${LEDGER_TEAM_PREFIX}${DEFAULT_TEAM_SLUG}`
const TEAM_STORAGE_KEY = 'sscaff.teamId'
const BOOTSTRAP_ADMIN_EMAIL = 'mr.lion1995@gmail.com'

function normalizeTeamId (rawTeamId) {
  const cleaned = (rawTeamId || '').toString().trim().toLowerCase()
  const stripped = cleaned.replace(new RegExp(`^${LEDGER_TEAM_PREFIX}`, 'i'), '')
  const normalized = stripped
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || DEFAULT_TEAM_SLUG
}

function formatTeamId (rawTeamId) {
  const normalized = normalizeTeamId(rawTeamId)
  return normalized.startsWith(LEDGER_TEAM_PREFIX)
    ? normalized
    : `${LEDGER_TEAM_PREFIX}${normalized}`
}

function getDisplayTeamId (rawTeamId) {
  const normalized = (rawTeamId || '').toString().trim()
  if (!normalized) return DEFAULT_TEAM_SLUG
  return normalizeTeamId(normalized.replace(new RegExp(`^${LEDGER_TEAM_PREFIX}`, 'i'), '')) || DEFAULT_TEAM_SLUG
}

function getStoredTeamId () {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage?.getItem(TEAM_STORAGE_KEY) || ''
  } catch (error) {
    console.warn('Kunne ikke læse gemt team ID', error)
    return ''
  }
}

function persistTeamId (value) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage?.setItem(TEAM_STORAGE_KEY, normalizeTeamId(value))
  } catch (error) {
    console.warn('Kunne ikke gemme team ID', error)
  }
}

function resolvePreferredTeamId (rawTeamId) {
  const stored = normalizeTeamId(rawTeamId || getStoredTeamId() || DEFAULT_TEAM_SLUG)
  return formatTeamId(stored)
}

function isBootstrapAdminEmail (emailLower) {
  return normalizeEmail(emailLower) === normalizeEmail(BOOTSTRAP_ADMIN_EMAIL)
}

export {
  BOOTSTRAP_ADMIN_EMAIL,
  DEFAULT_TEAM_ID,
  DEFAULT_TEAM_SLUG,
  LEDGER_TEAM_PREFIX,
  TEAM_STORAGE_KEY,
  formatTeamId,
  getDisplayTeamId,
  getStoredTeamId,
  isBootstrapAdminEmail,
  normalizeTeamId,
  persistTeamId,
  resolvePreferredTeamId,
}
