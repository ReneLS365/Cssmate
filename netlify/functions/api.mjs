import { db, ensureDbReady } from './_db.mjs'
import { getTeamCase, listTeamCasesDelta, listTeamCasesPage, softDeleteTeamCase, upsertTeamCase } from './_team-cases.mjs'
import { generateToken, getAuth0Config, hashToken, secureCompare, verifyToken } from './_auth.mjs'
import { safeError } from './_log.mjs'
import { getDeployContext, isProd } from './_context.mjs'
import { assertTeamIdUuid, getTeamById, resolveTeamId } from './_team.mjs'
import { guardTeamCasesSql, TEAM_CASES_SCHEMA_INFO } from './_team-cases-guard.mjs'

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }
const DEFAULT_TEAM_SLUG = process.env.DEFAULT_TEAM_SLUG || 'hulmose'
const EMAIL_FROM = process.env.EMAIL_FROM || ''
const EMAIL_PROVIDER_API_KEY = process.env.EMAIL_PROVIDER_API_KEY || ''
const APP_ORIGIN = process.env.APP_ORIGIN || ''
const INVITE_TTL_DAYS = 7
const INVITE_RATE_LIMIT = 20
const INVITE_RATE_WINDOW_MS = 60 * 60 * 1000
const ACCEPT_RATE_LIMIT = 30
const ACCEPT_RATE_WINDOW_MS = 60 * 60 * 1000
const DEFAULT_CASES_LIMIT = 100
const MAX_CASES_LIMIT = 500
const ROLE_CLAIM = 'https://sscaff.app/roles'
const ORG_CLAIM = 'https://sscaff.app/org_id'
const ALLOWED_ROLES = new Set(['sscaff_owner', 'sscaff_admin', 'sscaff_user'])
const CASE_STATUS = {
  DRAFT: 'kladde',
  READY: 'klar_til_deling',
  APPROVED: 'godkendt',
  DEMONTAGE: 'demontage_i_gang',
  DONE: 'afsluttet',
}
const CASE_PHASE = {
  DRAFT: 'draft',
  READY_FOR_DEMONTAGE: 'ready_for_demontage',
  COMPLETED: 'completed',
}
const DB_NOT_MIGRATED_MESSAGE = 'DB er ikke migreret. Kør netlify/functions/migrations/001_init.sql, netlify/functions/migrations/002_add_team_slug.sql, netlify/functions/migrations/003_auth0_invites.sql, netlify/functions/migrations/004_add_team_member_login.sql, netlify/functions/migrations/005_cases_indexes.sql, netlify/functions/migrations/006_cases_defaults.sql, netlify/functions/migrations/007_cases_workflow.sql, netlify/functions/migrations/008_auth0_member_profile.sql og netlify/functions/migrations/009_cases_attachments.sql mod Neon.'
let cachedMgmtToken = ''
let cachedMgmtTokenExpiry = 0

function jsonResponse (statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...JSON_HEADERS, ...extraHeaders },
    body: JSON.stringify(payload ?? {}),
  }
}

function recordTiming (event, name, startMs) {
  if (!event?.__timings) return
  const duration = Math.max(0, Date.now() - startMs)
  event.__timings.push({ name, duration })
}

function applyServerTiming (event, response, handlerStart) {
  if (!event?.__timings || !response) return response
  const timings = [...event.__timings]
  if (handlerStart) {
    timings.push({ name: 'handler', duration: Math.max(0, Date.now() - handlerStart) })
  }
  if (!timings.length) return response
  const headerValue = timings
    .map(entry => `${entry.name};dur=${Math.round(entry.duration)}`)
    .join(', ')
  response.headers = { ...(response.headers || {}), 'Server-Timing': headerValue }
  return response
}

async function requireDbReady (event) {
  const start = Date.now()
  try {
    const ready = await ensureDbReady()
    if (!ready) {
      throw createError(DB_NOT_MIGRATED_MESSAGE, 503, {}, 'DB_NOT_MIGRATED')
    }
  } finally {
    recordTiming(event, 'db', start)
  }
}

function emptyResponse (statusCode = 204) {
  return { statusCode, headers: JSON_HEADERS, body: '' }
}

function parseBody (event) {
  if (!event.body) return {}
  try {
    return JSON.parse(event.body)
  } catch {
    return {}
  }
}

function parseBooleanParam (value) {
  if (value === undefined || value === null) return false
  const normalized = String(value).trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

function clampCasesLimit (value) {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_CASES_LIMIT
  return Math.min(parsed, MAX_CASES_LIMIT)
}

function parseDateKey (value) {
  const normalized = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return ''
  return normalized
}

function parseIfMatchUpdatedAt (value) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) {
    throw createError('Ugyldig ifMatchUpdatedAt.', 400)
  }
  return parsed
}

function parseSinceParam (value) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) {
    throw createError('Ugyldig since.', 400)
  }
  return parsed
}

function normalizePhaseHint (value) {
  const normalized = (value || '').toString().trim().toLowerCase()
  if (normalized === 'demontage') return 'demontage'
  if (normalized === 'montage') return 'montage'
  return ''
}

function normalizeCasePhase (value, fallback = '') {
  const normalized = (value || '').toString().trim().toLowerCase()
  if (normalized === 'demontage') return 'demontage'
  if (normalized === 'montage') return 'montage'
  return fallback
}

function normalizeWorkflowPhase (value, status = '') {
  const normalized = (value || '').toString().trim().toLowerCase()
  if (normalized === CASE_PHASE.DRAFT) return CASE_PHASE.DRAFT
  if (normalized === CASE_PHASE.READY_FOR_DEMONTAGE) return CASE_PHASE.READY_FOR_DEMONTAGE
  if (normalized === CASE_PHASE.COMPLETED) return CASE_PHASE.COMPLETED
  const statusValue = (status || '').toString().trim().toLowerCase()
  if ([CASE_STATUS.DONE, 'done', 'completed'].includes(statusValue)) return CASE_PHASE.COMPLETED
  if ([CASE_STATUS.APPROVED, CASE_STATUS.DEMONTAGE, 'klar_til_demontage'].includes(statusValue)) return CASE_PHASE.READY_FOR_DEMONTAGE
  if ([CASE_STATUS.DRAFT, CASE_STATUS.READY, 'klar', 'ready'].includes(statusValue)) return CASE_PHASE.DRAFT
  return CASE_PHASE.DRAFT
}

function normalizeJobNumber (value) {
  return (value || '').toString().trim() || 'UKENDT'
}

function resolveExportAction ({ phaseHint, caseKind }) {
  const hint = normalizePhaseHint(phaseHint)
  if (hint) return hint === 'demontage' ? 'EXPORT_DEMONTAGE' : 'EXPORT_MONTAGE'
  const kind = normalizePhaseHint(caseKind)
  if (kind) return kind === 'demontage' ? 'EXPORT_DEMONTAGE' : 'EXPORT_MONTAGE'
  return 'EXPORT_MONTAGE'
}

function canAccessCase () {
  return true
}

function resolveSheetPhase ({ caseKind, status, attachments }) {
  const normalized = normalizePhaseHint(caseKind)
  if (normalized) return normalized
  if (attachments?.demontage && !attachments?.montage) return 'demontage'
  if (status === CASE_STATUS.DEMONTAGE) return 'demontage'
  return 'montage'
}

function resolveWorkflowPhase ({ action, nextStatus, currentPhase }) {
  if (action === 'EXPORT_MONTAGE') {
    return nextStatus === CASE_STATUS.DRAFT ? CASE_PHASE.DRAFT : CASE_PHASE.READY_FOR_DEMONTAGE
  }
  if (action === 'EXPORT_DEMONTAGE') return CASE_PHASE.COMPLETED
  if (action === 'APPROVE') {
    return nextStatus === CASE_STATUS.DONE ? CASE_PHASE.COMPLETED : CASE_PHASE.READY_FOR_DEMONTAGE
  }
  if (nextStatus === CASE_STATUS.DONE) return CASE_PHASE.COMPLETED
  if (nextStatus === CASE_STATUS.DEMONTAGE || nextStatus === CASE_STATUS.APPROVED) return CASE_PHASE.READY_FOR_DEMONTAGE
  if (nextStatus === CASE_STATUS.DRAFT) return CASE_PHASE.DRAFT
  return normalizeWorkflowPhase(currentPhase, nextStatus)
}

function resolveCaseTransition ({ action, currentStatus, sheetPhase, isCreator }) {
  const normalizedPhase = normalizeCasePhase(
    sheetPhase,
    currentStatus === CASE_STATUS.DEMONTAGE ? 'demontage' : 'montage'
  )

  if (action === 'EXPORT_MONTAGE') {
    if (!isCreator) {
      throw createError('Kun opretter kan ændre denne kladde.', 403)
    }
    if ([CASE_STATUS.DRAFT, CASE_STATUS.READY].includes(currentStatus)) {
      return { status: CASE_STATUS.DRAFT, phase: normalizedPhase || 'montage' }
    }
    return { status: currentStatus, phase: normalizedPhase || 'montage' }
  }

  if (action === 'EXPORT_DEMONTAGE') {
    if (currentStatus === CASE_STATUS.DONE) {
      throw createError('Sagen er allerede afsluttet.', 409)
    }
    if ([CASE_STATUS.DRAFT, CASE_STATUS.READY].includes(currentStatus)) {
      if (normalizedPhase === 'demontage') {
        return { status: CASE_STATUS.DONE, phase: 'demontage' }
      }
      throw createError('Montage skal godkendes før demontage kan påbegyndes.', 403)
    }
    if ([CASE_STATUS.APPROVED, CASE_STATUS.DEMONTAGE].includes(currentStatus)) {
      return { status: CASE_STATUS.DONE, phase: 'demontage' }
    }
    throw createError('Ugyldig status for demontage.', 409)
  }

  if (action === 'APPROVE') {
    if ([CASE_STATUS.DRAFT, CASE_STATUS.READY].includes(currentStatus)) {
      if (!isCreator) {
        throw createError('Kun opretter kan godkende kladden.', 403)
      }
      return { status: CASE_STATUS.APPROVED, phase: 'montage' }
    }
    if (currentStatus === CASE_STATUS.DEMONTAGE && normalizedPhase === 'demontage') {
      return { status: CASE_STATUS.DONE, phase: 'demontage' }
    }
    if (currentStatus === CASE_STATUS.APPROVED && normalizedPhase === 'montage') {
      throw createError('Montage er allerede godkendt.', 409)
    }
    if (currentStatus === CASE_STATUS.DONE) {
      throw createError('Sagen er allerede afsluttet.', 409)
    }
    if (currentStatus === CASE_STATUS.DEMONTAGE) {
      throw createError('Demontage er allerede i gang.', 409)
    }
    throw createError('Ugyldig status for godkendelse.', 409)
  }

  throw createError('Ukendt handling.', 400)
}

function safeNumber (value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function extractTotalsFromSheet (sheet) {
  const totals = sheet?.totals || sheet?.summary?.totals || sheet?.result?.totals
  if (!totals) return { materials: 0, montage: 0, demontage: 0, total: 0, hours: 0 }
  return {
    materials: safeNumber(totals.materials),
    montage: safeNumber(totals.montage),
    demontage: safeNumber(totals.demontage),
    total: safeNumber(totals.total),
    hours: safeNumber(totals.hours || totals.timer || totals.time),
  }
}

function computeReceipt ({ montageSheet, demontageSheet }) {
  const montageTotals = extractTotalsFromSheet(montageSheet)
  const demontageTotals = extractTotalsFromSheet(demontageSheet)
  const receiptTotals = {
    materials: montageTotals.materials + demontageTotals.materials,
    montage: montageTotals.total > 0 ? montageTotals.total : montageTotals.montage,
    demontage: demontageTotals.total > 0 ? demontageTotals.total : demontageTotals.demontage,
    total: montageTotals.total + demontageTotals.total,
    hours: montageTotals.hours + demontageTotals.hours,
  }
  return {
    createdAt: new Date().toISOString(),
    totals: receiptTotals,
    hasMontage: Boolean(montageSheet),
    hasDemontage: Boolean(demontageSheet),
  }
}

function decodeCursor (value) {
  if (!value) return null
  try {
    const raw = Buffer.from(String(value), 'base64url').toString('utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const lastUpdatedAt = parsed.lastUpdatedAt ? new Date(parsed.lastUpdatedAt) : new Date(0)
    const updatedAt = parsed.updatedAt ? new Date(parsed.updatedAt) : new Date(0)
    const createdAt = parsed.createdAt ? new Date(parsed.createdAt) : new Date(0)
    if ([lastUpdatedAt, updatedAt, createdAt].some(date => Number.isNaN(date.valueOf()))) return null
    const caseId = parsed.caseId ? String(parsed.caseId).trim() : ''
    if (!caseId) return null
    return {
      lastUpdatedAt,
      updatedAt,
      createdAt,
      caseId,
    }
  } catch {
    return null
  }
}

function isWriteRequest (event) {
  const method = (event.httpMethod || 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return false
  const path = getRoutePath(event)
  const writeRoutes = [
    { method: 'POST', pattern: /^\/teams\/[^/]+\/cases$/ },
    { method: 'DELETE', pattern: /^\/teams\/[^/]+\/cases\/[^/]+$/ },
    { method: 'PATCH', pattern: /^\/teams\/[^/]+\/cases\/[^/]+\/status$/ },
    { method: 'POST', pattern: /^\/teams\/[^/]+\/cases\/[^/]+\/approve$/ },
    { method: 'POST', pattern: /^\/teams\/[^/]+\/backup$/ },
    { method: 'POST', pattern: /^\/teams\/[^/]+\/members\/self$/ },
    { method: 'POST', pattern: /^\/teams\/[^/]+\/bootstrap$/ },
    { method: 'PATCH', pattern: /^\/teams\/[^/]+\/members\/[^/]+$/ },
    { method: 'DELETE', pattern: /^\/teams\/[^/]+\/members\/[^/]+$/ },
    { method: 'PATCH', pattern: /^\/team\/members\/[^/]+$/ },
    { method: 'DELETE', pattern: /^\/team\/members\/[^/]+$/ },
    { method: 'POST', pattern: /^\/invites/ },
    { method: 'PATCH', pattern: /^\/invites/ },
    { method: 'DELETE', pattern: /^\/invites/ },
  ]
  return writeRoutes.some(route => route.method === method && route.pattern.test(path))
}

function normalizeEmail (email) {
  return (email || '').toString().trim().toLowerCase()
}

function isValidEmail (email) {
  if (!email) return false
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
}

function isValidUuid (value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((value || '').toString())
}

function normalizeTeamSlug (value) {
  const cleaned = (value || '').toString().trim().toLowerCase()
  const normalized = cleaned
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || DEFAULT_TEAM_SLUG
}

function sanitizeDisplayName (value) {
  const trimmed = (value || '').toString().trim()
  if (!trimmed) return ''
  return trimmed.slice(0, 160)
}

function deriveMemberRole (user) {
  return user.isOwner ? 'owner' : (user.isAdmin ? 'admin' : 'member')
}

function buildEphemeralMember (teamId, user) {
  return {
    team_id: teamId,
    user_sub: user.id,
    email: user.email || '',
    display_name: sanitizeDisplayName(user.name),
    role: deriveMemberRole(user),
    status: 'active',
    joined_at: null,
    last_login_at: null,
    last_seen_at: null,
  }
}

function getRoutePath (event) {
  const rawPath = event.path || ''
  if (rawPath.startsWith('/.netlify/functions/api')) {
    return rawPath.replace('/.netlify/functions/api', '') || '/'
  }
  if (rawPath.startsWith('/api')) {
    return rawPath.replace('/api', '') || '/'
  }
  return rawPath || '/'
}

function getAuthHeader (event) {
  const headers = event.headers || {}
  return headers.authorization || headers.Authorization || ''
}

async function readJsonSafe (response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function normalizeClaimList (value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function extractRoles (payload) {
  return normalizeClaimList(payload?.[ROLE_CLAIM])
}

function resolveRoleFlags (roles) {
  const isOwner = roles.includes('sscaff_owner')
  const isAdmin = isOwner || roles.includes('sscaff_admin')
  const isUser = roles.includes('sscaff_user') || isAdmin
  return { isOwner, isAdmin, isUser }
}

function extractOrgId (payload) {
  return (payload?.[ORG_CLAIM] || '').toString().trim()
}

function resolveAuth0Domain () {
  return getAuth0Config().domain || ''
}

function resolveManagementAudience (domain) {
  const explicit = String(process.env.AUTH0_MGMT_AUDIENCE || '').trim()
  if (explicit) return explicit
  return `https://${domain}/api/v2/`
}

async function getManagementToken () {
  const now = Date.now()
  if (cachedMgmtToken && cachedMgmtTokenExpiry > now + 60_000) {
    return cachedMgmtToken
  }
  const domain = resolveAuth0Domain()
  const clientId = process.env.AUTH0_MGMT_CLIENT_ID || ''
  const clientSecret = process.env.AUTH0_MGMT_CLIENT_SECRET || ''
  if (!domain || !clientId || !clientSecret) {
    throw createError('Auth0 management API er ikke konfigureret.', 501, {}, 'auth0_mgmt_unconfigured')
  }
  const audience = resolveManagementAudience(domain)
  const response = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      audience,
    }),
  })
  if (!response.ok) {
    throw createError('Kunne ikke hente Auth0 management token.', 501, {}, 'auth0_mgmt_failed')
  }
  const payload = await readJsonSafe(response)
  if (!payload) {
    throw createError('Kunne ikke læse Auth0 management token.', 502, {}, 'auth0_mgmt_invalid_json')
  }
  cachedMgmtToken = payload?.access_token || ''
  const expiresIn = Number(payload?.expires_in || 0)
  cachedMgmtTokenExpiry = now + expiresIn * 1000
  return cachedMgmtToken
}

async function listOrganizationMembers (orgId) {
  const domain = resolveAuth0Domain()
  if (!domain) throw createError('Auth0 domain mangler.', 501)
  const token = await getManagementToken()
  const url = new URL(`https://${domain}/api/v2/organizations/${encodeURIComponent(orgId)}/members`)
  url.searchParams.set('fields', 'user_id,email,name')
  url.searchParams.set('include_fields', 'true')
  url.searchParams.set('per_page', '100')
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw createError('Kunne ikke hente Auth0 medlemmer.', 501, {}, 'auth0_mgmt_failed')
  }
  const members = await readJsonSafe(response)
  return Array.isArray(members) ? members : []
}

function resolveAppBaseUrl (event) {
  const raw = String(APP_ORIGIN || process.env.APP_BASE_URL || '').trim()
  if (raw && raw.toLowerCase() !== 'base') {
    try {
      const parsed = new URL(raw)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin
      }
    } catch {
      // ignore invalid env value
    }
  }
  const headers = event.headers || {}
  const host = headers['x-forwarded-host'] || headers.host
  if (!host) return ''
  const protocol = (headers['x-forwarded-proto'] || 'https').split(',')[0].trim()
  return `${protocol}://${host}`
}

function resolveTeamSlugFromRequest (event, body = {}) {
  const query = event.queryStringParameters || {}
  return normalizeTeamSlug(body.teamId || body.teamSlug || query.teamId || query.teamSlug || DEFAULT_TEAM_SLUG)
}

function createError (message, status = 400, extra = {}, code = '') {
  const error = new Error(message)
  error.status = status
  if (code) error.code = code
  Object.assign(error, extra)
  return error
}

async function fetchAuth0UserInfo (token) {
  const domain = process.env.AUTH0_DOMAIN || ''
  if (!domain) return null
  const response = await fetch(`https://${domain}/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) return null
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function requireAuth (event) {
  const start = Date.now()
  try {
    const header = getAuthHeader(event)
    if (!header.startsWith('Bearer ')) {
      throw createError('Manglende token', 401, {}, 'auth_missing_token')
    }
    const token = header.replace('Bearer ', '').trim()
    const payload = await verifyToken(token)
    const roles = extractRoles(payload).filter(role => ALLOWED_ROLES.has(role))
    if (!roles.length) {
      throw createError('Manglende rolle i Auth0 token.', 403, {}, 'auth_missing_role')
    }
    const userInfo = payload.email ? null : await fetchAuth0UserInfo(token)
    const email = normalizeEmail(payload.email || userInfo?.email || '')
    const { isOwner, isAdmin, isUser } = resolveRoleFlags(roles)
    return {
      id: payload.sub,
      email,
      roles,
      orgId: extractOrgId(payload),
      isOwner,
      isAdmin,
      isUser,
      isPrivileged: isAdmin || isOwner,
    }
  } catch (error) {
    const status = error?.status || 401
    const code = error?.code || (status === 403 ? 'auth_forbidden' : 'auth_invalid_token')
    throw createError(error?.message || 'Ugyldigt token', status, { cause: error }, code)
  } finally {
    recordTiming(event, 'auth', start)
  }
}

async function findTeamBySlug (slug) {
  const result = await db.query('SELECT id, slug, name, created_at, created_by_sub FROM teams WHERE slug = $1', [slug])
  return result.rows[0] || null
}

async function ensureTeam (slug) {
  const normalizedSlug = normalizeTeamSlug(slug)
  if (!isProd()) {
    const existing = await findTeamBySlug(normalizedSlug)
    if (existing) return existing
    return { id: normalizedSlug, name: normalizedSlug, slug: normalizedSlug, created_at: null, created_by_sub: null }
  }
  const insertResult = await db.query(
    `INSERT INTO teams (id, name, slug, created_at, created_by_sub)
     VALUES (gen_random_uuid(), $1, $1, NOW(), NULL)
     ON CONFLICT (slug) DO NOTHING
     RETURNING id, name, slug, created_at, created_by_sub`,
    [normalizedSlug]
  )
  if (insertResult.rows[0]) return insertResult.rows[0]
  const existing = await findTeamBySlug(normalizedSlug)
  if (existing) return existing
  const fallbackResult = await db.query(
    `INSERT INTO teams (id, name, slug, created_at, created_by_sub)
     VALUES (gen_random_uuid(), $1, $1, NOW(), NULL)
     ON CONFLICT (slug) DO NOTHING
     RETURNING id, name, slug, created_at, created_by_sub`,
    [normalizedSlug]
  )
  return fallbackResult.rows[0] || { id: normalizedSlug, name: normalizedSlug, slug: normalizedSlug, created_at: null, created_by_sub: null }
}

async function getMember (teamId, userSub) {
  const result = await db.query(
    `SELECT team_id, user_sub, email, display_name, role, status, joined_at, last_login_at, last_seen_at
     FROM team_members
     WHERE team_id = $1 AND user_sub = $2`,
    [teamId, userSub]
  )
  return result.rows[0] || null
}

async function upsertMemberFromUser (teamId, user) {
  const role = deriveMemberRole(user)
  const email = normalizeEmail(user.email)
  const displayName = sanitizeDisplayName(user.name)
  const result = await db.query(
    `INSERT INTO team_members (team_id, user_sub, email, display_name, role, status, joined_at, last_login_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), NOW())
     ON CONFLICT (team_id, user_sub)
     DO UPDATE SET
       email = COALESCE(NULLIF(EXCLUDED.email, ''), team_members.email),
       display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), team_members.display_name),
       role = EXCLUDED.role,
       status = EXCLUDED.status,
       last_login_at = NOW(),
       last_seen_at = NOW(),
       joined_at = COALESCE(team_members.joined_at, EXCLUDED.joined_at)
     RETURNING team_id, user_sub, email, display_name, role, status, joined_at, last_login_at, last_seen_at`,
    [teamId, user.id, email, displayName, role, 'active']
  )
  return result.rows[0] || null
}

async function resolveTeamIdForEvent (event, teamInput) {
  if (!event.__teamIdCache) {
    event.__teamIdCache = new Map()
  }
  return resolveTeamId(teamInput, { cache: event.__teamIdCache })
}

async function requireCaseTeamContext (event, teamInput, { requireAdmin = false } = {}) {
  const user = await requireAuth(event)
  const isProduction = isProd()
  const teamId = await resolveTeamIdForEvent(event, teamInput)
  const team = await getTeamById(teamId)
  if (!team) {
    console.warn('[team] invalid team reference', { input: teamInput })
    throw createError('Invalid team reference. Expected team slug/name or uuid.', 400)
  }
  if (requireAdmin && !user.isPrivileged) {
    throw createError('Kun admin kan udføre denne handling.', 403)
  }
  if (user.isPrivileged) {
    return { user, team, member: null }
  }
  let member = await getMember(team.id, user.id)
  if (!member) {
    member = isProduction
      ? await upsertMemberFromUser(team.id, user)
      : buildEphemeralMember(team.id, user)
  }
  if (!member || member.status !== 'active') {
    throw createError('Ingen adgang til teamet', 403)
  }
  return { user, team, member }
}

async function requireTeamContext (event, teamSlug, { requireAdmin = false } = {}) {
  const user = await requireAuth(event)
  const isProduction = isProd()
  const team = await ensureTeam(normalizeTeamSlug(teamSlug))
  if (requireAdmin && !user.isPrivileged) {
    throw createError('Kun admin kan udføre denne handling.', 403)
  }
  if (user.isPrivileged) {
    return { user, team, member: null }
  }
  let member = await getMember(team.id, user.id)
  if (!member) {
    member = isProduction
      ? await upsertMemberFromUser(team.id, user)
      : buildEphemeralMember(team.id, user)
  }
  if (!member || member.status !== 'active') {
    throw createError('Ingen adgang til teamet', 403)
  }
  return { user, team, member }
}

async function requireTeamRole (teamId, userSub, roles = ['admin']) {
  const member = await getMember(teamId, userSub)
  if (!member || member.status !== 'active') {
    throw createError('Ingen adgang til teamet', 403)
  }
  if (!roles.includes(member.role)) {
    throw createError('Kun admin kan udføre denne handling', 403)
  }
  return member
}

async function requireTeamAdmin (teamId, userSub) {
  return requireTeamRole(teamId, userSub, ['admin', 'owner'])
}

function serializeMemberRow (row) {
  const displayName = row.display_name || row.displayName || ''
  return {
    id: row.user_sub,
    uid: row.user_sub,
    user_sub: row.user_sub,
    userSub: row.user_sub,
    email: row.email || '',
    displayName,
    role: row.role || 'member',
    active: row.status === 'active',
    assigned: true,
    createdAt: row.joined_at ? new Date(row.joined_at).toISOString() : null,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
  }
}

function resolveInviteStatus (row) {
  if (row.revoked_at) return 'revoked'
  if (row.used_at) return 'accepted'
  if (row.expires_at && new Date(row.expires_at) < new Date()) return 'expired'
  return 'pending'
}

function serializeInviteRow (row) {
  return {
    id: row.id,
    inviteId: row.id,
    teamId: row.team_slug,
    email: row.email || '',
    emailLower: row.email || '',
    role: row.role || 'member',
    status: resolveInviteStatus(row),
    tokenHint: row.token_hint || '',
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    acceptedAt: row.used_at ? new Date(row.used_at).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
  }
}

function serializeCaseRow (row) {
  const createdAt = row.created_at ? new Date(row.created_at).toISOString() : null
  const updatedAt = row.updated_at ? new Date(row.updated_at).toISOString() : createdAt
  const lastUpdatedAt = row.last_updated_at ? new Date(row.last_updated_at).toISOString() : updatedAt
  const storedAttachments = row.attachments && typeof row.attachments === 'object' ? row.attachments : {}
  const jsonAttachment = row.json_content
    ? { data: row.json_content, createdAt }
    : storedAttachments.json || null
  const jobNumber = row.job_number || ''
  const workflowPhase = normalizeWorkflowPhase(row.phase, row.status)
  const sheetPhase = resolveSheetPhase({
    caseKind: row.case_kind,
    status: row.status,
    attachments: storedAttachments,
  })
  return {
    caseId: row.case_id,
    teamId: row.team_id,
    jobNumber,
    caseKind: row.case_kind || '',
    system: row.system || '',
    totals: row.totals || { materials: 0, montage: 0, demontage: 0, total: 0 },
    status: row.status || 'kladde',
    phase: workflowPhase,
    sheetPhase,
    parentCaseId: row.parent_case_id || null,
    createdAt,
    updatedAt,
    lastUpdatedAt,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email || '',
    createdByName: row.created_by_name || '',
    updatedBy: row.updated_by || row.created_by,
    lastEditorSub: row.last_editor_sub || row.updated_by || row.created_by,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    deletedBy: row.deleted_by || null,
    attachments: {
      ...storedAttachments,
      json: jsonAttachment,
      pdf: storedAttachments.pdf || null,
    },
  }
}

function serializeCaseDeltaRow (row) {
  const base = serializeCaseRow(row)
  if (base.status === 'deleted' || base.deletedAt) {
    return {
      caseId: base.caseId,
      teamId: base.teamId,
      status: 'deleted',
      lastUpdatedAt: base.lastUpdatedAt,
      deletedAt: base.deletedAt,
      deletedBy: base.deletedBy,
    }
  }
  return base
}

async function writeAuditLog ({ teamId, actorSub, action, meta }) {
  if (!teamId || !action) return
  await db.query(
    `INSERT INTO audit_log (id, team_id, actor_sub, action, meta, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
    [crypto.randomUUID(), teamId, actorSub || null, action, JSON.stringify(meta || {})]
  )
}

async function enforceRateLimit ({ key, limit, windowMs }) {
  const now = new Date()
  const windowStart = new Date(now.getTime() - (now.getTime() % windowMs))
  const result = await db.query(
    `INSERT INTO rate_limits (key, window_start, count)
     VALUES ($1, $2, 1)
     ON CONFLICT (key)
     DO UPDATE SET
       count = CASE
         WHEN rate_limits.window_start + ($3 * interval '1 millisecond') < NOW() THEN 1
         ELSE rate_limits.count + 1
       END,
       window_start = CASE
         WHEN rate_limits.window_start + ($3 * interval '1 millisecond') < NOW() THEN EXCLUDED.window_start
         ELSE rate_limits.window_start
       END
     RETURNING count, window_start`,
    [key, windowStart, windowMs]
  )
  const count = result.rows[0]?.count || 0
  if (count > limit) {
    throw createError('For mange forsøg. Prøv igen senere.', 429)
  }
}

async function sendInviteEmail ({ to, role, inviteUrl, expiresAt }) {
  if (!EMAIL_PROVIDER_API_KEY || !EMAIL_FROM || !to) return
  const subject = 'Invitation til SSCaff'
  const expiryLabel = expiresAt ? new Date(expiresAt).toLocaleDateString('da-DK') : 'om 7 dage'
  const bodyText = `Du er inviteret som ${role}.\n\nÅbn linket for at acceptere invitationen:\n${inviteUrl}\n\nLinket udløber ${expiryLabel}.\nLog ind med den email der er inviteret: ${to}.`
  const payload = {
    from: EMAIL_FROM,
    to,
    subject,
    text: bodyText,
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${EMAIL_PROVIDER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const text = await response.text()
    throw createError(`Email kunne ikke sendes: ${text || response.statusText}`, 502)
  }
}

async function handleMe (event) {
  const user = await requireAuth(event)
  return jsonResponse(200, { sub: user.id, email: user.email })
}

async function handleTeamGet (event) {
  const user = await requireAuth(event)
  await requireDbReady(event)
  const teamSlug = resolveTeamSlugFromRequest(event)
  const team = await ensureTeam(teamSlug)
  const role = deriveMemberRole(user)
  return jsonResponse(200, { team: { id: team.id, name: team.name, slug: team.slug }, member: { role } })
}

async function handleTeamAccess (event, teamSlug) {
  await requireDbReady(event)
  const user = await requireAuth(event)
  const normalizedSlug = normalizeTeamSlug(teamSlug)
  const team = await ensureTeam(normalizedSlug)
  if (user.isPrivileged) {
    const role = deriveMemberRole(user)
    return jsonResponse(200, {
      status: 'ok',
      teamId: normalizedSlug,
      team: { id: team.id, name: team.name, slug: team.slug },
      member: { uid: user.id, role, status: 'active' },
    })
  }
  const member = await getMember(team.id, user.id)
  if (!member) {
    if (!isProd()) {
      return jsonResponse(200, {
        status: 'ok',
        teamId: normalizedSlug,
        team: { id: team.id, name: team.name, slug: team.slug },
        member: serializeMemberRow(buildEphemeralMember(team.id, user)),
      })
    }
    return jsonResponse(200, {
      status: 'missing',
      teamId: normalizedSlug,
      team: { id: team.id, name: team.name, slug: team.slug },
      member: null,
    })
  }
  return jsonResponse(200, {
    status: 'ok',
    teamId: normalizedSlug,
    team: { id: team.id, name: team.name, slug: team.slug },
    member: serializeMemberRow(member),
  })
}

async function handleTeamBootstrap (event, teamSlug) {
  const normalizedSlug = normalizeTeamSlug(teamSlug)
  return jsonResponse(410, { error: `Bootstrap er fjernet. Team ${normalizedSlug} styres i Auth0.` })
}

async function handleTeamMembersList (event, teamSlug) {
  await requireDbReady(event)
  const user = await requireAuth(event)
  const normalizedSlug = normalizeTeamSlug(teamSlug)
  const team = await ensureTeam(normalizedSlug)
  const members = await listTeamMembersForUser({ team, user, isProduction: isProd() })
  return jsonResponse(200, members)
}

async function listTeamMembersForUser ({ team, user, isProduction }) {
  if (!user.isPrivileged) {
    let member = await getMember(team.id, user.id)
    if (!member) {
      if (!isProduction) {
        return [serializeMemberRow(buildEphemeralMember(team.id, user))]
      }
      member = await upsertMemberFromUser(team.id, user)
    }
    return member ? [serializeMemberRow(member)] : []
  }
  const result = await db.query(
    `SELECT team_id, user_sub, email, display_name, role, status, joined_at, last_login_at, last_seen_at
     FROM team_members
     WHERE team_id = $1 AND status != 'removed'
     ORDER BY joined_at DESC NULLS LAST`,
    [team.id]
  )
  return result.rows.map(serializeMemberRow)
}

async function handleTeamMembersListRoot (event) {
  return jsonResponse(410, { error: 'Team medlemmer styres i Auth0.' })
}

async function handleTeamMemberPatch (event, teamSlug, memberSub) {
  return jsonResponse(410, { error: 'Team medlemmer styres i Auth0.' })
}

async function handleTeamMemberPatchRoot (event, memberSub) {
  const teamSlug = resolveTeamSlugFromRequest(event, parseBody(event))
  return handleTeamMemberPatch(event, teamSlug, memberSub)
}

async function handleTeamMemberDelete (event, teamSlug, memberSub) {
  return jsonResponse(410, { error: 'Team medlemmer styres i Auth0.' })
}

async function handleTeamMemberDeleteRoot (event, memberSub) {
  const teamSlug = resolveTeamSlugFromRequest(event, parseBody(event))
  return handleTeamMemberDelete(event, teamSlug, memberSub)
}

async function handleInviteCreate (event, teamSlug) {
  await requireDbReady(event)
  const user = await requireAuth(event)
  const body = parseBody(event)
  const role = body.role === 'admin' ? 'admin' : 'member'
  const email = normalizeEmail(body.email || '')
  if (!isValidEmail(email)) return jsonResponse(400, { error: 'Ugyldig email.' })
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  await requireTeamAdmin(team.id, user.id)
  await enforceRateLimit({ key: `invite:${user.id}`, limit: INVITE_RATE_LIMIT, windowMs: INVITE_RATE_WINDOW_MS })
  await enforceRateLimit({ key: `invite-ip:${event.headers?.['x-forwarded-for'] || 'unknown'}`, limit: INVITE_RATE_LIMIT, windowMs: INVITE_RATE_WINDOW_MS })

  const existing = await db.query(
    `SELECT id FROM team_invites
     WHERE team_id = $1 AND email = $2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()`,
    [team.id, email]
  )
  if (existing.rowCount > 0) {
    return jsonResponse(409, { error: 'Der findes allerede en aktiv invitation til denne email.' })
  }

  const rawToken = generateToken()
  const tokenHash = hashToken(rawToken)
  const tokenHint = rawToken.slice(-6)
  const inviteId = crypto.randomUUID()
  const result = await db.query(
    `INSERT INTO team_invites (id, team_id, email, role, token_hash, token_hint, created_by_sub, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW() + interval '${INVITE_TTL_DAYS} days')
     RETURNING id, expires_at`,
    [inviteId, team.id, email, role, tokenHash, tokenHint, user.id]
  )

  const baseUrl = resolveAppBaseUrl(event)
  const invitePath = `/invite?token=${rawToken}`
  const inviteUrl = baseUrl ? `${baseUrl}${invitePath}` : invitePath
  await sendInviteEmail({ to: email, role, inviteUrl, expiresAt: result.rows[0]?.expires_at })
  await writeAuditLog({ teamId: team.id, actorSub: user.id, action: 'invite_created', meta: { inviteId, email, role, tokenHint } })

  return jsonResponse(200, {
    inviteId,
    expiresAt: result.rows[0]?.expires_at ? new Date(result.rows[0].expires_at).toISOString() : null,
    inviteUrl,
  })
}

async function handleTeamMemberSelfUpsert (event, teamSlug) {
  await requireDbReady(event)
  const user = await requireAuth(event)
  const body = parseBody(event)
  const normalizedSlug = normalizeTeamSlug(teamSlug)
  const team = await ensureTeam(normalizedSlug)
  const role = deriveMemberRole(user)
  const email = normalizeEmail(user.email || body.email)
  const displayName = sanitizeDisplayName(user.name || body.name || body.displayName)
  const result = await db.query(
    `INSERT INTO team_members (team_id, user_sub, email, display_name, role, status, joined_at, last_login_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), NOW())
     ON CONFLICT (team_id, user_sub)
     DO UPDATE SET
       email = COALESCE(NULLIF(EXCLUDED.email, ''), team_members.email),
       display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), team_members.display_name),
       role = EXCLUDED.role,
       status = EXCLUDED.status,
       last_login_at = NOW(),
       last_seen_at = NOW(),
       joined_at = COALESCE(team_members.joined_at, EXCLUDED.joined_at)
     RETURNING team_id, user_sub, email, display_name, role, status, joined_at, last_login_at, last_seen_at`,
    [team.id, user.id, email, displayName, role, 'active']
  )
  return jsonResponse(200, { member: serializeMemberRow(result.rows[0]) })
}

async function handleInviteList (event, teamSlug) {
  await requireDbReady(event)
  const user = await requireAuth(event)
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  await requireTeamAdmin(team.id, user.id)
  const result = await db.query(
    `SELECT i.id, i.email, i.role, i.token_hint, i.expires_at, i.created_at, i.used_at, i.revoked_at, t.slug as team_slug
     FROM team_invites i
     JOIN teams t ON t.id = i.team_id
     WHERE i.team_id = $1 AND i.used_at IS NULL AND i.revoked_at IS NULL
     ORDER BY i.created_at DESC`,
    [team.id]
  )
  return jsonResponse(200, result.rows.map(serializeInviteRow))
}

async function handleInviteRevoke (event, inviteId) {
  await requireDbReady(event)
  const user = await requireAuth(event)
  const inviteResult = await db.query('SELECT id, team_id, email FROM team_invites WHERE id = $1', [inviteId])
  const invite = inviteResult.rows[0]
  if (!invite) return jsonResponse(404, { error: 'Invitation findes ikke.' })
  await requireTeamAdmin(invite.team_id, user.id)
  await db.query('UPDATE team_invites SET revoked_at = NOW() WHERE id = $1', [inviteId])
  await writeAuditLog({ teamId: invite.team_id, actorSub: user.id, action: 'invite_revoked', meta: { inviteId, email: invite.email } })
  return emptyResponse(204)
}

async function handleInviteResend (event, inviteId) {
  await requireDbReady(event)
  const user = await requireAuth(event)
  const inviteResult = await db.query(
    `SELECT i.id, i.team_id, i.email, i.role, i.expires_at, t.slug as team_slug
     FROM team_invites i
     JOIN teams t ON t.id = i.team_id
     WHERE i.id = $1`,
    [inviteId]
  )
  const invite = inviteResult.rows[0]
  if (!invite) return jsonResponse(404, { error: 'Invitation findes ikke.' })
  await requireTeamAdmin(invite.team_id, user.id)
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return jsonResponse(400, { error: 'Invitationen er udløbet.' })
  }
  await enforceRateLimit({ key: `invite:${user.id}`, limit: INVITE_RATE_LIMIT, windowMs: INVITE_RATE_WINDOW_MS })

  const rawToken = generateToken()
  const tokenHash = hashToken(rawToken)
  const tokenHint = rawToken.slice(-6)
  const result = await db.query(
    `UPDATE team_invites
     SET token_hash = $1, token_hint = $2, created_at = NOW(), expires_at = NOW() + interval '${INVITE_TTL_DAYS} days'
     WHERE id = $3
     RETURNING expires_at`,
    [tokenHash, tokenHint, inviteId]
  )
  const baseUrl = resolveAppBaseUrl(event)
  const invitePath = `/invite?token=${rawToken}`
  const inviteUrl = baseUrl ? `${baseUrl}${invitePath}` : invitePath
  await sendInviteEmail({ to: invite.email, role: invite.role, inviteUrl, expiresAt: result.rows[0]?.expires_at })
  await writeAuditLog({ teamId: invite.team_id, actorSub: user.id, action: 'invite_resent', meta: { inviteId, email: invite.email, tokenHint } })

  return jsonResponse(200, {
    inviteId,
    inviteUrl,
    expiresAt: result.rows[0]?.expires_at ? new Date(result.rows[0].expires_at).toISOString() : null,
  })
}

async function handleInviteAccept (event) {
  await requireDbReady(event)
  const user = await requireAuth(event)
  const body = parseBody(event)
  const token = body.token
  if (!token) {
    return jsonResponse(400, { error: 'Token er påkrævet.' })
  }
  await enforceRateLimit({ key: `accept:${user.id}`, limit: ACCEPT_RATE_LIMIT, windowMs: ACCEPT_RATE_WINDOW_MS })
  await enforceRateLimit({ key: `accept-ip:${event.headers?.['x-forwarded-for'] || 'unknown'}`, limit: ACCEPT_RATE_LIMIT, windowMs: ACCEPT_RATE_WINDOW_MS })

  const tokenHash = hashToken(token)
  const result = await db.query(
    `SELECT i.id, i.team_id, i.email, i.role, i.token_hash, i.expires_at, i.used_at, i.revoked_at, t.slug as team_slug
     FROM team_invites i
     JOIN teams t ON t.id = i.team_id
     WHERE i.token_hash = $1`,
    [tokenHash]
  )
  const invite = result.rows[0]
  if (!invite) return jsonResponse(404, { error: 'Invitation findes ikke.' })
  if (!secureCompare(invite.token_hash, tokenHash)) {
    return jsonResponse(400, { error: 'Ugyldig invitation.' })
  }
  if (invite.revoked_at) return jsonResponse(400, { error: 'Invitationen er tilbagekaldt.' })
  if (invite.used_at) return jsonResponse(400, { error: 'Invitationen er allerede brugt.' })
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return jsonResponse(400, { error: 'Invitationen er udløbet.' })
  }
  const inviteEmail = normalizeEmail(invite.email)
  if (inviteEmail && inviteEmail !== normalizeEmail(user.email)) {
    return jsonResponse(403, {
      error: 'Email matcher ikke invitationen.',
      invitedEmail: invite.email,
      loginEmail: user.email,
    })
  }

  await db.query(
    `INSERT INTO team_members (team_id, user_sub, email, role, status, joined_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (team_id, user_sub)
     DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status, email = EXCLUDED.email`,
    [invite.team_id, user.id, user.email, invite.role, 'active']
  )
  await db.query(
    `UPDATE team_invites SET used_at = NOW(), accepted_by_sub = $2, accept_ip = $3, accept_ua = $4
     WHERE id = $1`,
    [invite.id, user.id, event.headers?.['x-forwarded-for'] || '', event.headers?.['user-agent'] || '']
  )
  await writeAuditLog({ teamId: invite.team_id, actorSub: user.id, action: 'invite_accepted', meta: { inviteId: invite.id, email: invite.email } })
  return jsonResponse(200, { ok: true, teamId: invite.team_slug })
}

async function handleCaseCreate (event, teamSlug) {
  await requireDbReady(event)
  const { user, team } = await requireCaseTeamContext(event, teamSlug)
  const body = parseBody(event)
  const explicitCaseId = isValidUuid(body.caseId) ? body.caseId : ''
  const caseId = explicitCaseId || crypto.randomUUID()
  let totals = body.totals || { materials: 0, montage: 0, demontage: 0, total: 0 }
  const ifMatchUpdatedAt = parseIfMatchUpdatedAt(body.ifMatchUpdatedAt)
  const action = resolveExportAction({ phaseHint: body.phaseHint, caseKind: body.caseKind })
  const normalizedJobNumber = normalizeJobNumber(body.jobNumber)
  const resolvedParentCaseId = isValidUuid(body.parentCaseId) ? body.parentCaseId : null
  const existing = await getTeamCase({ teamId: team.id, caseId })
  if (ifMatchUpdatedAt && existing?.updated_at) {
    const currentUpdatedAt = new Date(existing.updated_at)
    if (currentUpdatedAt.toISOString() !== ifMatchUpdatedAt.toISOString()) {
      throw createError('Sagen er ændret af en anden. Opdater og prøv igen.', 409)
    }
  }
  const isCreator = !existing || existing.created_by === user.id
  const currentStatus = existing?.status || CASE_STATUS.DRAFT
  const sheetPhase = normalizePhaseHint(body.caseKind || body.phaseHint || body.phase) || 'montage'
  if (!existing && action === 'EXPORT_DEMONTAGE') {
    // Allow demontage exports to create their own case entries.
  }
  const { status: nextStatus } = resolveCaseTransition({
    action,
    currentStatus,
    sheetPhase,
    isCreator,
  })
  const workflowPhase = resolveWorkflowPhase({
    action,
    nextStatus,
    currentPhase: existing?.phase,
  })

  const prevAttachments = (existing && typeof existing.attachments === 'object' && existing.attachments) ? existing.attachments : {}
  const attachments = { ...prevAttachments }
  if (action === 'EXPORT_MONTAGE') {
    attachments.montage = body.jsonContent || null
  }
  if (action === 'EXPORT_DEMONTAGE') {
    attachments.demontage = body.jsonContent || null
    if (!attachments.montage && existing?.json_content) {
      attachments.montage = existing.json_content
    }
  }
  if (nextStatus === CASE_STATUS.DONE) {
    const receipt = computeReceipt({ montageSheet: attachments.montage, demontageSheet: attachments.demontage })
    attachments.receipt = receipt
    totals = receipt.totals
  }

  const upserted = await upsertTeamCase({
    caseId,
    teamId: team.id,
    parentCaseId: resolvedParentCaseId,
    jobNumber: normalizedJobNumber,
    caseKind: body.caseKind || '',
    system: body.system || '',
    totals: JSON.stringify(totals),
    status: nextStatus,
    phase: workflowPhase,
    attachments: JSON.stringify(attachments),
    createdBy: user.id,
    createdByEmail: user.email,
    createdByName: body.createdByName || '',
    updatedBy: user.id,
    lastEditorSub: user.id,
    jsonContent: body.jsonContent || null,
  })
  return jsonResponse(200, serializeCaseRow(upserted))
}

async function handleCaseList (event, teamSlug) {
  await requireDbReady(event)
  const { team } = await requireCaseTeamContext(event, teamSlug)
  const query = event.queryStringParameters || {}
  const limit = clampCasesLimit(query.limit)
  const since = parseSinceParam(query.since)
  const sinceId = String(query.sinceId || '').trim()
  const status = String(query.status || '').trim()
  const phase = String(query.phase || '').trim()
  const search = String(query.q || '').trim()
  const from = parseDateKey(query.from)
  const to = parseDateKey(query.to)
  const cursor = decodeCursor(query.cursor)
  if (since) {
    const sinceIso = since.toISOString()
    const delta = await listTeamCasesDelta({
      teamId: team.id,
      since: sinceIso,
      sinceId,
      limit,
    })
    const rows = delta.rows || []
    const items = rows.map(serializeCaseDeltaRow)
    const lastRow = rows[rows.length - 1]
    const maxUpdatedAt = lastRow?.last_updated_at
      ? new Date(lastRow.last_updated_at).toISOString()
      : sinceIso
    return jsonResponse(200, {
      mode: 'delta',
      serverNow: new Date().toISOString(),
      maxUpdatedAt,
      items,
    })
  }
  const page = await listTeamCasesPage({
    teamId: team.id,
    limit,
    cursor,
    status,
    phase,
    search,
    from,
    to,
  })
  const items = page.rows.map(serializeCaseRow)
  const nextCursor = page.nextCursor
  return jsonResponse(200, { items, nextCursor })
}

async function handleCaseGet (event, teamSlug, caseId) {
  await requireDbReady(event)
  const { team, user } = await requireCaseTeamContext(event, teamSlug)
  const row = await getTeamCase({ teamId: team.id, caseId })
  if (!row) return jsonResponse(404, { error: 'Sag findes ikke.' })
  if (!canAccessCase({ status: row.status, createdBy: row.created_by, userSub: user.id, isPrivileged: user.isPrivileged })) {
    return jsonResponse(403, { error: 'Kun opretter kan se kladden.' })
  }
  return jsonResponse(200, serializeCaseRow(row))
}

async function handleCaseDelete (event, teamSlug, caseId) {
  await requireDbReady(event)
  const { user, team } = await requireCaseTeamContext(event, teamSlug)
  assertTeamIdUuid(team.id, 'handleCaseDelete')
  const result = await db.query(
    guardTeamCasesSql(
      'SELECT created_by FROM public.team_cases WHERE team_id = $1 AND case_id = $2',
      'handleCaseDelete'
    ),
    [team.id, caseId]
  )
  const row = result.rows[0]
  if (!row) return jsonResponse(404, { error: 'Sag findes ikke.' })
  if (row.created_by !== user.id && !user.isPrivileged) {
    return jsonResponse(403, { error: 'Kun opretter eller admin kan slette sagen.' })
  }
  const updated = await softDeleteTeamCase({ teamId: team.id, caseId, deletedBy: user.id })
  return jsonResponse(200, serializeCaseRow(updated))
}

async function handleCaseStatus (event, teamSlug, caseId) {
  await requireDbReady(event)
  const { user, team } = await requireCaseTeamContext(event, teamSlug)
  const body = parseBody(event)
  const requested = (body?.status || '').toString().trim().toLowerCase()
  if (requested === CASE_STATUS.APPROVED) {
    return handleCaseApprove(event, teamSlug, caseId)
  }
  if (![CASE_STATUS.DEMONTAGE, CASE_STATUS.DONE].includes(requested)) {
    return jsonResponse(400, { error: 'Ugyldig statusændring.' })
  }
  const ifMatchUpdatedAt = parseIfMatchUpdatedAt(body.ifMatchUpdatedAt)
  const row = await getTeamCase({ teamId: team.id, caseId })
  if (!row) return jsonResponse(404, { error: 'Sag findes ikke.' })
  if (ifMatchUpdatedAt && row.updated_at) {
    const currentUpdatedAt = new Date(row.updated_at)
    if (currentUpdatedAt.toISOString() !== ifMatchUpdatedAt.toISOString()) {
      return jsonResponse(409, { error: 'Sagen er ændret af en anden. Opdater og prøv igen.', case: serializeCaseRow(row) })
    }
  }
  const currentStatus = row.status || CASE_STATUS.DRAFT
  let nextStatus = currentStatus
  if (requested === CASE_STATUS.DEMONTAGE) {
    if (currentStatus === CASE_STATUS.DEMONTAGE) {
      return jsonResponse(200, serializeCaseRow(row))
    }
    if (currentStatus === CASE_STATUS.APPROVED) {
      nextStatus = CASE_STATUS.DEMONTAGE
    } else if (currentStatus === CASE_STATUS.DONE) {
      return jsonResponse(409, { error: 'Sagen er allerede afsluttet.', case: serializeCaseRow(row) })
    } else {
      return jsonResponse(409, { error: 'Sagen kan ikke sættes i demontage.', case: serializeCaseRow(row) })
    }
  }
  if (requested === CASE_STATUS.DONE) {
    if (currentStatus === CASE_STATUS.DONE) {
      return jsonResponse(200, serializeCaseRow(row))
    }
    if ([CASE_STATUS.APPROVED, CASE_STATUS.DEMONTAGE].includes(currentStatus)) {
      nextStatus = CASE_STATUS.DONE
    } else {
      return jsonResponse(409, { error: 'Sagen kan ikke afsluttes endnu.', case: serializeCaseRow(row) })
    }
  }
  const resolvedParentCaseId = isValidUuid(body.parentCaseId) ? body.parentCaseId : null
  const workflowPhase = resolveWorkflowPhase({
    action: requested === CASE_STATUS.DONE ? 'EXPORT_DEMONTAGE' : 'EXPORT_MONTAGE',
    nextStatus,
    currentPhase: row.phase,
  })
  assertTeamIdUuid(team.id, 'handleCaseStatus')
  await db.query(
    guardTeamCasesSql(
      `UPDATE public.team_cases
       SET status = $1, phase = $2, parent_case_id = COALESCE($3, parent_case_id),
           updated_at = NOW(), last_updated_at = NOW(), updated_by = $4, last_editor_sub = $4
       WHERE team_id = $5 AND case_id = $6`,
      'handleCaseStatus'
    ),
    [nextStatus, workflowPhase, resolvedParentCaseId, user.id, team.id, caseId]
  )
  const updated = await getTeamCase({ teamId: team.id, caseId })
  return jsonResponse(200, serializeCaseRow(updated))
}

async function handleCaseApprove (event, teamSlug, caseId) {
  await requireDbReady(event)
  const { user, team } = await requireCaseTeamContext(event, teamSlug)
  const body = parseBody(event)
  const ifMatchUpdatedAt = parseIfMatchUpdatedAt(body.ifMatchUpdatedAt)
  const row = await getTeamCase({ teamId: team.id, caseId })
  if (!row) return jsonResponse(404, { error: 'Sag findes ikke.' })
  if (ifMatchUpdatedAt && row.updated_at) {
    const currentUpdatedAt = new Date(row.updated_at)
    if (currentUpdatedAt.toISOString() !== ifMatchUpdatedAt.toISOString()) {
      throw createError('Sagen er ændret af en anden. Opdater og prøv igen.', 409)
    }
  }

  const currentStatus = row.status || CASE_STATUS.DRAFT
  const sheetPhase = resolveSheetPhase({ caseKind: row.case_kind, status: currentStatus, attachments: row.attachments })
  const isCreator = row.created_by === user.id
  const { status: nextStatus } = resolveCaseTransition({
    action: 'APPROVE',
    currentStatus,
    sheetPhase,
    isCreator,
  })
  const workflowPhase = resolveWorkflowPhase({
    action: 'APPROVE',
    nextStatus,
    currentPhase: row.phase,
  })

  const storedAttachments = row.attachments && typeof row.attachments === 'object' ? row.attachments : {}
  const attachments = { ...storedAttachments }
  let totals = row.totals || { materials: 0, montage: 0, demontage: 0, total: 0 }
  const approvingMontage = [CASE_STATUS.DRAFT, CASE_STATUS.READY].includes(currentStatus) && nextStatus === CASE_STATUS.APPROVED
  if (approvingMontage && !attachments.montage) {
    attachments.montage = row.json_content || null
  }
  if (nextStatus === CASE_STATUS.DONE) {
    if (!attachments.montage && row.json_content) {
      attachments.montage = row.json_content
    }
    const receipt = computeReceipt({ montageSheet: attachments.montage, demontageSheet: attachments.demontage })
    attachments.receipt = receipt
    totals = receipt.totals
  }

  assertTeamIdUuid(team.id, 'handleCaseApprove')
  await db.query(
    guardTeamCasesSql(
      `UPDATE public.team_cases SET status = $1, phase = $2, totals = $3::jsonb, attachments = $4::jsonb,
       updated_at = NOW(), last_updated_at = NOW(), updated_by = $5, last_editor_sub = $5
       WHERE team_id = $6 AND case_id = $7`,
      'handleCaseApprove'
    ),
    [nextStatus, workflowPhase, JSON.stringify(totals), JSON.stringify(attachments), user.id, team.id, caseId]
  )
  const updated = await getTeamCase({ teamId: team.id, caseId })
  return jsonResponse(200, serializeCaseRow(updated))
}

async function handleBackupExport (event, teamSlug) {
  await requireDbReady(event)
  const { user, team } = await requireCaseTeamContext(event, teamSlug, { requireAdmin: true })
  assertTeamIdUuid(team.id, 'handleBackupExport')
  const query = event.queryStringParameters || {}
  const includeDeleted = parseBooleanParam(query.includeDeleted)
  const casesQuery = includeDeleted
    ? `SELECT c.*, t.slug as team_slug
       FROM public.team_cases c
       JOIN public.teams t ON t.id = c.team_id
       WHERE c.team_id = $1`
    : `SELECT c.*, t.slug as team_slug
       FROM public.team_cases c
       JOIN public.teams t ON t.id = c.team_id
       WHERE c.team_id = $1 AND c.deleted_at IS NULL`
  const casesResult = await db.query(
    guardTeamCasesSql(casesQuery, 'handleBackupExport'),
    [team.id]
  )
  const auditResult = await db.query(
    `SELECT id, team_id, case_id, action, actor, summary, created_at
     FROM team_audit
     WHERE team_id = $1
     ORDER BY created_at ASC`,
    [team.id]
  )
  const backup = {
    schemaVersion: 2,
    teamId: teamSlug,
    exportedAt: new Date().toISOString(),
    exportedBy: { uid: user.id, email: user.email || '', name: '' },
    retentionYears: 5,
    cases: casesResult.rows.map(row => ({
      ...serializeCaseRow(row),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      lastUpdatedAt: row.last_updated_at ? new Date(row.last_updated_at).toISOString() : null,
      deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    })),
    audit: auditResult.rows.map(row => ({
      _id: row.id,
      teamId: teamSlug,
      caseId: row.case_id,
      action: row.action,
      actor: row.actor,
      summary: row.summary,
      timestamp: row.created_at ? new Date(row.created_at).toISOString() : null,
    })),
    metadata: { format: 'sscaff-shared-backup', source: 'sscaff-app' },
  }
  const dateLabel = new Date().toISOString().slice(0, 10)
  const teamLabel = team?.slug || teamSlug || 'team'
  const fileName = `cssmate-backup-${teamLabel}-${dateLabel}.json`
  return jsonResponse(200, backup, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="${fileName}"`,
  })
}

async function handleBackupImport (event, teamSlug) {
  await requireDbReady(event)
  const { user, team } = await requireCaseTeamContext(event, teamSlug, { requireAdmin: true })
  assertTeamIdUuid(team.id, 'handleBackupImport')
  const body = parseBody(event)
  const cases = Array.isArray(body?.cases) ? body.cases : []
  for (const entry of cases) {
    const resolvedParentCaseId = isValidUuid(entry.parentCaseId) ? entry.parentCaseId : null
    await db.query(
      guardTeamCasesSql(
        `INSERT INTO public.team_cases
          (case_id, team_id, parent_case_id, job_number, case_kind, system, totals, status, phase, created_at, updated_at, last_updated_at,
           created_by, created_by_email, created_by_name, updated_by, last_editor_sub, json_content, deleted_at, deleted_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
         ON CONFLICT (case_id) DO UPDATE SET
           parent_case_id = COALESCE(EXCLUDED.parent_case_id, public.team_cases.parent_case_id),
           job_number = EXCLUDED.job_number,
           case_kind = EXCLUDED.case_kind,
           system = EXCLUDED.system,
           totals = EXCLUDED.totals,
           status = EXCLUDED.status,
           phase = EXCLUDED.phase,
           updated_at = EXCLUDED.updated_at,
           last_updated_at = EXCLUDED.last_updated_at,
           updated_by = EXCLUDED.updated_by,
           last_editor_sub = EXCLUDED.last_editor_sub,
           json_content = EXCLUDED.json_content,
           deleted_at = EXCLUDED.deleted_at,
           deleted_by = EXCLUDED.deleted_by`,
        'handleBackupImport'
      ),
      [
        entry.caseId,
        team.id,
        resolvedParentCaseId,
        entry.jobNumber || '',
        entry.caseKind || '',
        entry.system || '',
        JSON.stringify(entry.totals || { materials: 0, montage: 0, demontage: 0, total: 0 }),
        entry.status || 'kladde',
        entry.phase || null,
        entry.createdAt ? new Date(entry.createdAt) : new Date(),
        entry.updatedAt ? new Date(entry.updatedAt) : new Date(),
        entry.lastUpdatedAt ? new Date(entry.lastUpdatedAt) : new Date(),
        entry.createdBy || user.id,
        entry.createdByEmail || '',
        entry.createdByName || '',
        entry.updatedBy || user.id,
        entry.lastEditorSub || entry.updatedBy || entry.createdBy || user.id,
        entry.attachments?.json?.data || null,
        entry.deletedAt ? new Date(entry.deletedAt) : null,
        entry.deletedBy || null,
      ]
    )
  }
  return emptyResponse(204)
}

export const __test = {
  canAccessCase,
  ensureTeam,
  listTeamMembersForUser,
  normalizeCasePhase,
  resolveCaseTransition,
  resolveExportAction,
}

export async function handler (event) {
  if (process.env.DEBUG_CONTEXT === '1') {
    console.log('[context]', {
      deployContext: getDeployContext(),
      URL: Boolean(process.env.URL),
      DEPLOY_URL: Boolean(process.env.DEPLOY_URL),
      DEPLOY_PRIME_URL: Boolean(process.env.DEPLOY_PRIME_URL),
      APP_ORIGIN: process.env.APP_ORIGIN ? '[set]' : '[missing]',
    })
  }
  if (!isProd() && process.env.DEBUG_TEAM_CASES === '1') {
    console.log('[team_cases] schema', TEAM_CASES_SCHEMA_INFO)
  }
  const handlerStart = Date.now()
  event.__timings = []
  const withTiming = (response) => applyServerTiming(event, response, handlerStart)
  const method = event.httpMethod || 'GET'
  const path = getRoutePath(event)
  const isProduction = isProd()
  const isWriteMethod = isWriteRequest(event)

  try {
    if (!isProduction && isWriteMethod) {
      return withTiming(jsonResponse(403, { error: 'Writes disabled in preview deployments.' }))
    }
    if (method === 'GET' && path === '/me') return withTiming(await handleMe(event))
    if (method === 'GET' && path === '/team') return withTiming(await handleTeamGet(event))
    if (method === 'GET' && path === '/team/members') return withTiming(await handleTeamMembersListRoot(event))
    if (method === 'PATCH' && path.startsWith('/team/members/')) {
      const memberSub = decodeURIComponent(path.replace('/team/members/', ''))
      return withTiming(await handleTeamMemberPatchRoot(event, memberSub))
    }

    const isInviteRoute = path.startsWith('/invites') || /\/invites$/.test(path) || /\/invites\//.test(path)
    if (isInviteRoute) {
      return withTiming(jsonResponse(410, { error: 'Invites er fjernet. Team/roller styres i Auth0.' }))
    }

    const teamAccessMatch = path.match(/^\/teams\/([^/]+)\/access$/)
    if (teamAccessMatch && method === 'GET') return withTiming(await handleTeamAccess(event, teamAccessMatch[1]))

    const teamBootstrapMatch = path.match(/^\/teams\/([^/]+)\/bootstrap$/)
    if (teamBootstrapMatch && method === 'POST') return withTiming(await handleTeamBootstrap(event, teamBootstrapMatch[1]))

    const teamMembersMatch = path.match(/^\/teams\/([^/]+)\/members$/)
    if (teamMembersMatch && method === 'GET') return withTiming(await handleTeamMembersList(event, teamMembersMatch[1]))

    const teamMemberSelfMatch = path.match(/^\/teams\/([^/]+)\/members\/self$/)
    if (teamMemberSelfMatch && method === 'POST') return withTiming(await handleTeamMemberSelfUpsert(event, teamMemberSelfMatch[1]))

    const teamMemberPatchMatch = path.match(/^\/teams\/([^/]+)\/members\/([^/]+)$/)
    if (teamMemberPatchMatch && (method === 'PATCH' || method === 'DELETE')) {
      return withTiming(jsonResponse(410, { error: 'Team medlemmer styres i Auth0.' }))
    }

    const caseListMatch = path.match(/^\/teams\/([^/]+)\/cases$/)
    if (caseListMatch && method === 'GET') return withTiming(await handleCaseList(event, caseListMatch[1]))
    if (caseListMatch && method === 'POST') return withTiming(await handleCaseCreate(event, caseListMatch[1]))

    const caseGetMatch = path.match(/^\/teams\/([^/]+)\/cases\/([^/]+)$/)
    if (caseGetMatch && method === 'GET') return withTiming(await handleCaseGet(event, caseGetMatch[1], caseGetMatch[2]))
    if (caseGetMatch && method === 'DELETE') return withTiming(await handleCaseDelete(event, caseGetMatch[1], caseGetMatch[2]))

    const caseStatusMatch = path.match(/^\/teams\/([^/]+)\/cases\/([^/]+)\/status$/)
    if (caseStatusMatch && method === 'PATCH') return withTiming(await handleCaseStatus(event, caseStatusMatch[1], caseStatusMatch[2]))

    const caseApproveMatch = path.match(/^\/teams\/([^/]+)\/cases\/([^/]+)\/approve$/)
    if (caseApproveMatch && method === 'POST') return withTiming(await handleCaseApprove(event, caseApproveMatch[1], caseApproveMatch[2]))

    const backupMatch = path.match(/^\/teams\/([^/]+)\/backup$/)
    if (backupMatch && method === 'GET') return withTiming(await handleBackupExport(event, backupMatch[1]))
    if (backupMatch && method === 'POST') return withTiming(await handleBackupImport(event, backupMatch[1]))

    return withTiming(jsonResponse(404, { error: 'Endpoint findes ikke.' }))
  } catch (error) {
    const status = error?.status || 500
    const message = error?.message || 'Serverfejl'
    const requestId = event.headers?.['x-nf-request-id']
      || event.headers?.['x-request-id']
      || event.headers?.['x-amzn-trace-id']
      || ''
    console.error('[api] handler error', safeError(error), {
      path,
      method,
      status,
      requestId,
    })
    return withTiming(jsonResponse(status, {
      error: message,
      ...(error?.code ? { code: error.code } : {}),
      ...(error?.invitedEmail ? { invitedEmail: error.invitedEmail } : {}),
    }))
  }
}
