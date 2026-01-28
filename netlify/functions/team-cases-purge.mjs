import { db, ensureDbReady } from './_db.mjs'
import { secureCompare, verifyToken } from './_auth.mjs'
import { isProd } from './_context.mjs'
import { resolveTeamId } from './_team.mjs'

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }
const ROLE_CLAIM = 'https://sscaff.app/roles'
const ALLOWED_ROLES = new Set(['sscaff_owner', 'sscaff_admin', 'sscaff_user'])
const ADMIN_CONFIRM_PHRASE = 'PURGE-ALL'

function jsonResponse (statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload ?? {}),
  }
}

function getAuthHeader (event) {
  const headers = event.headers || {}
  return headers.authorization || headers.Authorization || ''
}

function normalizeClaimList (value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function extractRoles (payload) {
  return normalizeClaimList(payload?.[ROLE_CLAIM] || payload?.roles)
}

function createError (message, status = 400, code = '') {
  const error = new Error(message)
  error.status = status
  if (code) error.code = code
  return error
}

async function requireAuth (event) {
  const header = getAuthHeader(event)
  if (!header.startsWith('Bearer ')) {
    throw createError('Manglende token', 401, 'auth_missing_token')
  }
  const token = header.replace('Bearer ', '').trim()
  const payload = await verifyToken(token)
  const roles = extractRoles(payload).filter(role => ALLOWED_ROLES.has(role))
  if (!roles.length) {
    throw createError('Manglende rolle i Auth0 token.', 403, 'auth_missing_role')
  }
  return {
    id: payload.sub,
    roles,
  }
}

async function requireTeamAdmin (teamId, userSub) {
  const result = await db.query(
    `SELECT role, status
     FROM team_members
     WHERE team_id = $1 AND user_sub = $2`,
    [teamId, userSub]
  )
  const member = result.rows[0]
  if (!member || member.status !== 'active') {
    throw createError('Ingen adgang til teamet', 403, 'team_access_denied')
  }
  if (member.role !== 'admin' && member.role !== 'owner') {
    throw createError('Kun admin kan udføre denne handling.', 403, 'team_admin_required')
  }
  return member
}

function parseBody (event) {
  if (!event.body) return {}
  try {
    return JSON.parse(event.body)
  } catch (error) {
    throw createError('Kunne ikke læse JSON body.', 400, 'invalid_json')
  }
}

function resolveTeamInput (event, body) {
  const query = event.queryStringParameters || {}
  return body.teamId || body.teamSlug || query.teamId || query.teamSlug || ''
}

async function countTeamCases (teamId) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM public.team_cases
     WHERE team_id = $1`,
    [teamId]
  )
  return result.rows[0]?.count ?? 0
}

async function purgeTeamCases (teamId) {
  return db.withTransaction(async (client) => {
    await client.query(
      `DELETE FROM public.team_audit
       WHERE case_id IN (
         SELECT case_id
         FROM public.team_cases
         WHERE team_id = $1
       )`,
      [teamId]
    )
    const deleteResult = await client.query(
      `DELETE FROM public.team_cases
       WHERE team_id = $1`,
      [teamId]
    )
    return deleteResult.rowCount || 0
  })
}

export async function handler (event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }
  if (!isProd()) {
    return jsonResponse(403, { error: 'Writes disabled in preview deployments.' })
  }

  try {
    await ensureDbReady()
    const body = parseBody(event)
    const teamInput = resolveTeamInput(event, body)
    if (!teamInput) {
      throw createError('Mangler team reference.', 400, 'team_reference_missing')
    }
    const user = await requireAuth(event)
    const teamId = await resolveTeamId(teamInput)
    await requireTeamAdmin(teamId, user.id)

    if (body.confirm !== ADMIN_CONFIRM_PHRASE) {
      throw createError('Bekræftelse mangler eller er forkert.', 400, 'confirm_missing')
    }
    const adminCode = String(process.env.ADMIN_PURGE_CODE || '').trim()
    if (!adminCode) {
      throw createError('ADMIN_PURGE_CODE mangler.', 500, 'admin_purge_missing')
    }
    const providedCode = String(body.code || '').trim()
    if (!secureCompare(providedCode, adminCode)) {
      throw createError('Purge-kode er forkert.', 400, 'invalid_purge_code')
    }

    const before = await countTeamCases(teamId)
    if (body.dryRun === true) {
      return jsonResponse(200, {
        ok: true,
        mode: 'dry-run',
        team_id: teamId,
        before,
        deleted: 0,
      })
    }

    const deleted = await purgeTeamCases(teamId)
    return jsonResponse(200, {
      ok: true,
      mode: 'purge',
      team_id: teamId,
      before,
      deleted,
    })
  } catch (error) {
    const status = error?.status || 500
    const message = error?.message || 'Server error'
    const code = error?.code || 'server_error'
    return jsonResponse(status, { error: message, code })
  }
}
