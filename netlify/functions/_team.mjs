import { db } from './_db.mjs'
import { isProd } from './_context.mjs'

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createInvalidTeamError () {
  const error = new Error('Invalid team reference. Expected team slug/name or uuid.')
  error.status = 400
  error.code = 'TEAM_REFERENCE_INVALID'
  return error
}

function normalizeTeamSlug (value) {
  const cleaned = (value || '').toString().trim().toLowerCase()
  if (!cleaned) return ''
  return cleaned
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
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
  const rawInput = (input || '').toString().trim()
  if (!rawInput) {
    console.warn('[team] resolveTeamId missing input')
    throw createInvalidTeamError()
  }
  if (isUuidV4(rawInput)) {
    const teamId = rawInput.toLowerCase()
    if (cache) {
      cache.set(rawInput, teamId)
      cache.set(teamId, teamId)
    }
    return teamId
  }
  const normalizedSlug = normalizeTeamSlug(rawInput)
  if (cache?.has(rawInput)) {
    return cache.get(rawInput)
  }
  if (normalizedSlug && cache?.has(normalizedSlug)) {
    return cache.get(normalizedSlug)
  }
  const result = await db.query(
    `SELECT id AS team_id
     FROM public.teams
     WHERE slug = $1 OR name = $2
     ORDER BY CASE WHEN slug = $1 THEN 0 WHEN name = $2 THEN 1 ELSE 2 END
     LIMIT 1`,
    [normalizedSlug, rawInput]
  )
  const teamId = result.rows[0]?.team_id
  if (!teamId) {
    console.warn('[team] resolveTeamId miss', { input: rawInput })
    throw createInvalidTeamError()
  }
  if (cache) {
    cache.set(rawInput, teamId)
    if (normalizedSlug) cache.set(normalizedSlug, teamId)
  }
  return teamId
}

export async function getTeamById (teamId) {
  const result = await db.query(
    'SELECT id, slug, name, created_at, created_by_sub FROM teams WHERE id = $1',
    [teamId]
  )
  return result.rows[0] || null
}
