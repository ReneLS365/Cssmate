import { DEFAULT_TEAM_SLUG, formatTeamId, normalizeTeamId } from './team-ids.js'
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
    bootstrapAdminEmail: '',
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

  /**
   * AUTH0-ONLY TEAM ACCESS (NO DB MEMBERSHIP)
   *
   * Source of truth:
   * - Membership: Auth0 organization on the user (org_id / orgId / organization)
   * - Role: Auth0 roles + permissions on the user (sscaff_owner / sscaff_admin, admin:* permissions)
   *
   * DB (ledger/firestore/postgres) MUST NOT decide team membership or roles anymore.
   */
  const rawOrg = user?.org_id || user?.orgId || user?.organization || ''
  const orgSlug = rawOrg ? formatTeamId(rawOrg) : ''

  // Access rule:
  // - If org is set: it must match selected team
  // - If org is not set: allow only default team as member
  if (orgSlug) {
    if (orgSlug !== normalizedTeamId) {
      return {
        ...initial,
        status: TEAM_ACCESS_STATUS.NO_ACCESS,
        teamId: normalizedTeamId,
        reason: 'not-member',
        error: { code: 'not-member', message: 'Ingen adgang til dette team.' },
      }
    }
  } else {
    if (normalizedTeamId !== DEFAULT_TEAM_SLUG) {
      return {
        ...initial,
        status: TEAM_ACCESS_STATUS.NO_ACCESS,
        teamId: normalizedTeamId,
        reason: 'missing-org',
        error: { code: 'missing-org', message: 'Din konto er ikke tilknyttet et team i Auth0.' },
      }
    }
  }

  const permissions = Array.isArray(user?.permissions) ? user.permissions : []
  const roles = Array.isArray(user?.roles) ? user.roles : []

  const isOwner = roles.includes('sscaff_owner') || permissions.includes('admin:all') || permissions.includes('admin:app')
  const isAdmin = isOwner || roles.includes('sscaff_admin')
  const role = isOwner ? 'owner' : (isAdmin ? 'admin' : 'member')

  return {
    ...initial,
    status: TEAM_ACCESS_STATUS.OK,
    teamId: normalizedTeamId,
    role,
    owner: isOwner,
    member: true,
    active: true,
    assigned: true,
    // Minimal docs to keep existing callers stable (NO DB lookup)
    teamDoc: { id: normalizedTeamId, slug: normalizedTeamId, name: normalizedTeamId },
    memberDoc: {
      uid: user.uid,
      email: user.email || '',
      role,
      active: true,
      assigned: true,
      teamId: normalizedTeamId,
    },
    raw: { source: 'auth0-only', orgSlug, roles, permissions },
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
  // Membership/roles are managed in Auth0 now.
  // Keep function for API compatibility, but do not bootstrap via DB anymore.
  throw new Error('Bootstrap er slået fra. Team/rolle styres i Auth0.')
}

export async function createTeamWithMembership ({ teamId, user }) {
  throw new Error('Bootstrap er slået fra. Team/rolle styres i Auth0.')
}

export function getTeamAccessWithTimeout (options) {
  return resolveTeamAccess(options)
}
