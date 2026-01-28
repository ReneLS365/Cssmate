import { db } from './_db.mjs'
import { isProd } from './_context.mjs'

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createInvalidTeamError () {
  const error = new Error('Invalid team reference. Expected team slug/name or uuid.')
  error.status = 400
  error.code = 'TEAM_REFERENCE_INVALID'
  return error
}

export function isUuidV4 (value) {
  return UUID_V4_REGEX.test((value || '').toString())
}

export function assertTeamIdUuid (teamId, context = '') {
  if (isProd()) return
  if (!isUuidV4(teamId)) {
    const label = context ? ` (${context})` : ''
    console.warn(`[team_cases] expected uuid team_id${label}`, teamId)
  }
}

export async function resolveTeamId (input, { cache } = {}) {
  const normalized = (input || '').toString().trim()
  if (!normalized) {
    console.warn('[team] resolveTeamId missing input')
    throw createInvalidTeamError()
  }
  if (isUuidV4(normalized)) {
    const teamId = normalized.toLowerCase()
    if (cache) cache.set(normalized, teamId)
    return teamId
  }
  if (cache?.has(normalized)) {
    return cache.get(normalized)
  }
  const result = await db.query(
    `SELECT id AS team_id
     FROM public.teams
     WHERE slug = $1 OR name = $1
     ORDER BY CASE WHEN slug = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [normalized]
  )
  const teamId = result.rows[0]?.team_id
  if (!teamId) {
    console.warn('[team] resolveTeamId miss', { input: normalized })
    throw createInvalidTeamError()
  }
  if (cache) cache.set(normalized, teamId)
  return teamId
}

export async function getTeamById (teamId) {
  const result = await db.query(
    'SELECT id, slug, name, created_at, created_by_sub FROM teams WHERE id = $1',
    [teamId]
  )
  return result.rows[0] || null
}
