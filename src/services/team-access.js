import { formatTeamId, normalizeTeamId } from './team-ids.js'
import { isTeamDebugEnabled, teamDebug } from '../utils/team-debug.js'

const TEAM_ACCESS_TIMEOUT_MS = 8000
const TEAM_ACCESS_CACHE_MS = 30000

// Auth0-first setup:
// Team + rolle kommer udelukkende fra Auth0 token claims.
// Postgres gemmer medlemsrækker, men claims er autoritative for roller/privilegier.
// Vi låser drift til DEFAULT_TEAM_SLUG ("hulmose") indtil multi-org mapping tilføjes.
const DEFAULT_TEAM_SLUG = 'hulmose'
const OWNER_ROLES = new Set(['sscaff_owner'])
const ADMIN_ROLES = new Set(['sscaff_admin'])
const ADMIN_PERMISSIONS = new Set(['admin:app', 'admin:all'])

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
    return { ...initial, status: TEAM_ACCESS_STATUS.NO_AUTH, reason: 'missing_uid' }
  }
  // Team styres af Auth0 org. teamId input ignoreres i drift.
  const normalizedTeamId = normalizeTeamId(DEFAULT_TEAM_SLUG)

  // Org gating:
  // Hvis orgId mangler, behandler vi brugeren som default-team (som ønsket).
  // Hvis du senere vil kræve org, så ændr allowByOrg til: Boolean(user.orgId)
  const allowByOrg = true
  if (!allowByOrg) {
    return {
      ...initial,
      status: TEAM_ACCESS_STATUS.NO_ACCESS,
      reason: 'org_required',
      teamId: normalizedTeamId,
    }
  }

  const permissions = Array.isArray(user?.permissions) ? user.permissions : []
  const roles = Array.isArray(user?.roles) ? user.roles : []

  const isOwner = roles.some(role => OWNER_ROLES.has(role))
    || permissions.some(permission => ADMIN_PERMISSIONS.has(permission))
  const isAdmin = isOwner || roles.some(role => ADMIN_ROLES.has(role))
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
    raw: { source: 'auth0-only', roles, permissions },
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
