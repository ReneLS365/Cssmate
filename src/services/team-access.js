import { apiJson } from '../api/client.js'
import { formatTeamId, normalizeTeamId } from './team-ids.js'
import { isTeamDebugEnabled, teamDebug } from '../utils/team-debug.js'

const TEAM_ACCESS_TIMEOUT_MS = 8000
const TEAM_ACCESS_CACHE_MS = 30000

const STATUS_VALUES = {
  LOADING: 'loading',
  OK: 'ok',
  NO_TEAM: 'no-team',
  NO_AUTH: 'no-auth',
  NO_ACCESS: 'no-access',
  ERROR: 'error',
}

export const TEAM_ACCESS_STATUS = {
  SIGNED_OUT: STATUS_VALUES.NO_AUTH,
  NO_AUTH: STATUS_VALUES.NO_AUTH,
  CHECKING: STATUS_VALUES.LOADING,
  LOADING: STATUS_VALUES.LOADING,
  OK: STATUS_VALUES.OK,
  NO_TEAM: STATUS_VALUES.NO_TEAM,
  NEED_CREATE: STATUS_VALUES.NO_TEAM,
  NO_ACCESS: STATUS_VALUES.NO_ACCESS,
  DENIED: STATUS_VALUES.NO_ACCESS,
  ERROR: STATUS_VALUES.ERROR,
}

const accessCache = new Map()

function cacheKey (teamId, uid) {
  const normalizedTeamId = normalizeTeamId(teamId || '')
  return `${normalizedTeamId || 'team'}::${uid || 'anon'}`
}

function readCache (teamId, uid) {
  const key = cacheKey(teamId, uid)
  const entry = accessCache.get(key)
  if (entry && entry.expiresAt > Date.now()) return entry.value
  accessCache.delete(key)
  return null
}

function writeCache (teamId, uid, value) {
  const key = cacheKey(teamId, uid)
  accessCache.set(key, { value, expiresAt: Date.now() + TEAM_ACCESS_CACHE_MS })
}

export function clearTeamAccessCache (teamId, uid) {
  if (!teamId && !uid) {
    accessCache.clear()
    return
  }
  accessCache.delete(cacheKey(teamId, uid))
}

function baseResult ({ teamId, user, source = 'resolveTeamAccess' }) {
  return {
    status: TEAM_ACCESS_STATUS.LOADING,
    teamId: formatTeamId(teamId),
    uid: user?.uid || '',
    email: user?.email || '',
    role: '',
    owner: false,
    member: false,
    active: null,
    assigned: null,
    teamDoc: null,
    memberDoc: null,
    reason: '',
    error: null,
    source,
    raw: null,
  }
}

function logAccessState (source, payload) {
  if (!isTeamDebugEnabled()) return
  const safePayload = {
    uid: payload.uid || '',
    email: payload.email || '',
    teamId: payload.teamId || '',
    memberDocExists: Boolean(payload.memberDoc),
    role: payload.role || '',
    active: payload.active,
    assigned: payload.assigned,
    ownerUid: payload.teamDoc?.ownerUid || null,
    canUseTeamComputed: payload.status === TEAM_ACCESS_STATUS.OK,
    reason: payload.reason || '',
    source,
  }
  teamDebug('access-state', safePayload)
}

async function readTeamAccess ({ teamId, user, source = 'resolveTeamAccess' }) {
  const initial = baseResult({ teamId, user, source })
  if (!user?.uid) {
    return { ...initial, status: TEAM_ACCESS_STATUS.NO_AUTH, reason: 'no-auth' }
  }
  const normalizedTeamId = formatTeamId(teamId)
  if (!normalizedTeamId) {
    return {
      ...initial,
      status: TEAM_ACCESS_STATUS.NO_TEAM,
      reason: 'missing-team',
      error: { code: 'missing-team', message: 'TeamId mangler' },
    }
  }

  try {
    const response = await apiJson(`/api/teams/${normalizedTeamId}/access`)
    if (!response) {
      return { ...initial, status: TEAM_ACCESS_STATUS.ERROR, reason: 'empty-response' }
    }
    if (response.status === 'no-team') {
      return {
        ...initial,
        status: TEAM_ACCESS_STATUS.NO_TEAM,
        teamId: normalizedTeamId,
        reason: 'missing-team',
        error: { code: 'missing-team', message: 'Team mangler. Opret det eller vælg et andet team.' },
        raw: response,
      }
    }
    if (response.status === 'no-access') {
      return {
        ...initial,
        status: TEAM_ACCESS_STATUS.NO_ACCESS,
        teamId: normalizedTeamId,
        reason: response.reason || 'not-member',
        error: { code: response.reason || 'not-member', message: 'Ingen adgang til dette team.' },
        raw: response,
      }
    }
    if (response.status !== 'ok') {
      return {
        ...initial,
        status: TEAM_ACCESS_STATUS.ERROR,
        teamId: normalizedTeamId,
        reason: response.reason || 'error',
        error: { code: response.reason || 'error', message: 'Kunne ikke kontrollere team-adgang.' },
        raw: response,
      }
    }
    const role = response.member?.role || 'member'
    return {
      ...initial,
      status: TEAM_ACCESS_STATUS.OK,
      teamId: normalizedTeamId,
      role,
      owner: role === 'owner',
      member: true,
      active: true,
      assigned: true,
      teamDoc: response.team || null,
      memberDoc: {
        uid: user.uid,
        email: user.email || '',
        role,
        active: true,
        assigned: true,
        teamId: normalizedTeamId,
      },
      raw: response,
    }
  } catch (error) {
    const status = error?.status || 500
    if (status === 401) {
      return { ...initial, status: TEAM_ACCESS_STATUS.NO_AUTH, reason: 'no-auth' }
    }
    if (status === 403) {
      return { ...initial, status: TEAM_ACCESS_STATUS.NO_ACCESS, reason: 'no-access' }
    }
    return {
      ...initial,
      status: TEAM_ACCESS_STATUS.ERROR,
      reason: 'error',
      error: { code: 'error', message: error?.message || 'Ukendt fejl' },
    }
  }
}

export async function resolveTeamAccess ({ teamId, user, timeoutMs = TEAM_ACCESS_TIMEOUT_MS, allowCache = true, source = 'resolveTeamAccess' }) {
  const cached = allowCache ? readCache(teamId, user?.uid) : null
  if (cached) return cached
  let timeoutHandle
  const timeoutPromise = new Promise(resolve => {
    timeoutHandle = setTimeout(() => {
      resolve({
        ...baseResult({ teamId, user, source }),
        status: TEAM_ACCESS_STATUS.ERROR,
        reason: 'timeout',
        error: { code: 'deadline-exceeded', message: 'Timeout while checking team access' },
      })
    }, timeoutMs)
    timeoutHandle?.unref?.()
  })
  const access = await Promise.race([readTeamAccess({ teamId, user, source }), timeoutPromise])
  clearTimeout(timeoutHandle)
  writeCache(access.teamId, access.uid, access)
  logAccessState(source, access)
  return access
}

export async function bootstrapTeamMembership ({ teamId, user, role = 'admin' }) {
  return createTeamWithMembership({ teamId, user, role })
}

export async function createTeamWithMembership ({ teamId, user }) {
  if (!user?.uid) throw new Error('Auth-bruger mangler')
  const normalizedTeamId = formatTeamId(teamId)
  if (!normalizedTeamId) throw new Error('Team ID mangler')
  await apiJson(`/api/teams/${normalizedTeamId}/bootstrap`, { method: 'POST' })
  return {
    teamId: normalizedTeamId,
    teamDoc: { id: normalizedTeamId, name: normalizedTeamId },
    memberDoc: { uid: user.uid, role: 'owner', active: true, assigned: true },
  }
}

export function getTeamAccessWithTimeout (options) {
  return resolveTeamAccess(options)
}

