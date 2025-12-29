import { getFirestoreDb, getFirestoreHelpers } from '../../js/shared-firestore.js'
import { isMockAuthEnabled } from '../../js/shared-auth.js'
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

function mapError (error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { code: 'offline', message: 'Du er offline. Tjek netværket og prøv igen.' }
  }
  const code = error?.code || 'error'
  const message = error?.message || 'Ukendt fejl'
  if (code === 'permission-denied') {
    return { code, message: 'Firestore permission denied (tjek rules/AppCheck).' }
  }
  if (code === 'unavailable') {
    return { code, message: 'Firestore er utilgængelig. Tjek netværk eller App Check.' }
  }
  if (code === 'missing-config') {
    return { code, message: 'Firestore er ikke konfigureret.' }
  }
  if (message.toLowerCase().includes('app check')) {
    return { code: 'app-check', message: 'AppCheck fejl — tjek site key / debug token.' }
  }
  if (code === 'failed-precondition') {
    return { code, message: 'Firestore failed-precondition (AppCheck / indexes).' }
  }
  return { code, message }
}

function normalizeMemberDoc (snapshot, fallbackUid) {
  if (!snapshot?.exists?.()) return null
  const data = snapshot.data() || {}
  const role = data.role === 'owner'
    ? 'owner'
    : (data.role === 'admin' ? 'admin' : 'member')
  return {
    ...data,
    id: snapshot.id || fallbackUid || '',
    uid: snapshot.id || fallbackUid || '',
    role,
    active: data.active !== false && data.disabled !== true,
    assigned: data.assigned === true,
    disabled: data.disabled === true,
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
  if (isMockAuthEnabled()) {
    const normalizedTeamId = formatTeamId(teamId)
    return {
      ...initial,
      status: TEAM_ACCESS_STATUS.OK,
      teamId: normalizedTeamId,
      role: 'admin',
      owner: false,
      member: true,
      active: true,
      assigned: true,
      memberDoc: {
        uid: user.uid,
        email: user.email || '',
        emailLower: (user.email || '').toLowerCase(),
        role: 'admin',
        active: true,
        assigned: true,
        teamId: normalizedTeamId,
      },
      reason: 'mock-auth',
      error: null,
    }
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
    const db = await getFirestoreDb()
    const sdk = await getFirestoreHelpers()
    const teamRef = sdk.doc(db, 'teams', normalizedTeamId)
    const memberRef = sdk.doc(db, 'teams', normalizedTeamId, 'members', user.uid)
    const [teamSnap, memberSnap] = await Promise.all([
      sdk.getDoc(teamRef),
      sdk.getDoc(memberRef),
    ])

    const teamDoc = teamSnap.exists() ? { ...(teamSnap.data() || {}), id: teamSnap.id || normalizedTeamId } : null
    const memberDoc = normalizeMemberDoc(memberSnap, user.uid)
    const owner = Boolean(teamDoc?.ownerUid && teamDoc.ownerUid === user.uid)
    const member = Boolean(memberDoc)
    const active = owner ? true : memberDoc?.active !== false
    const assigned = owner ? true : memberDoc?.assigned === true
    const role = owner ? 'owner' : (memberDoc?.role || '')

    if (!teamSnap.exists()) {
      return {
        ...initial,
        status: TEAM_ACCESS_STATUS.NO_TEAM,
        teamId: normalizedTeamId,
        reason: 'missing-team',
        teamDoc,
        memberDoc,
        role,
        owner,
        member: owner || member,
        active,
        assigned,
        error: { code: 'missing-team', message: 'Team mangler. Opret det eller vælg et andet team.' },
        raw: { teamDoc, memberDoc },
      }
    }

    // AUTO-REPAIR: if the current user is the team owner but is missing membership doc
    if (!memberDoc && teamDoc?.ownerUid === user.uid) {
      try {
        const email = user.email || ''
        const now = sdk.serverTimestamp()
        await sdk.setDoc(memberRef, {
          uid: user.uid,
          email,
          emailLower: (email || '').toLowerCase(),
          role: 'owner',
          active: true,
          assigned: true,
          teamId: normalizedTeamId,
          repairedAt: now,
        }, { merge: true })

        return {
          ...initial,
          status: TEAM_ACCESS_STATUS.OK,
          teamId: normalizedTeamId,
          teamDoc,
          memberDoc: {
            uid: user.uid,
            email,
            emailLower: (email || '').toLowerCase(),
            role: 'owner',
            active: true,
            assigned: true,
            teamId: normalizedTeamId,
          },
          role: 'owner',
          owner: true,
          member: true,
          active: true,
          assigned: true,
          reason: 'owner-repaired',
          error: null,
          raw: { teamDoc, memberDoc: null, repaired: true },
        }
      } catch (repairError) {
        console.warn('Owner membership auto-repair failed', repairError)
        // Fall through to normal no-access case if repair fails
      }
    }

    if (!owner && !memberDoc) {
      return {
        ...initial,
        status: TEAM_ACCESS_STATUS.NO_ACCESS,
        teamId: normalizedTeamId,
        reason: 'not-member',
        teamDoc,
        memberDoc,
        role,
        owner,
        member: owner || member,
        active,
        assigned,
        error: { code: 'not-member', message: 'Ingen adgang til dette team.' },
        raw: { teamDoc, memberDoc },
      }
    }

    if (!owner && memberDoc.disabled) {
      return {
        ...initial,
        status: TEAM_ACCESS_STATUS.NO_ACCESS,
        teamId: normalizedTeamId,
        reason: 'disabled',
        teamDoc,
        memberDoc,
        role,
        owner,
        member: owner || member,
        active,
        assigned,
        error: { code: 'member-disabled', message: 'Medlemmet er deaktiveret.' },
        raw: { teamDoc, memberDoc },
      }
    }

    if (!owner && active !== true) {
      return {
        ...initial,
        status: TEAM_ACCESS_STATUS.NO_ACCESS,
        teamId: normalizedTeamId,
        reason: 'inactive',
        teamDoc,
        memberDoc,
        role,
        owner,
        member: owner || member,
        active,
        assigned,
        error: { code: 'member-inactive', message: 'Medlemmet er deaktiveret.' },
        raw: { teamDoc, memberDoc },
      }
    }

    if (!owner && assigned !== true) {
      return {
        ...initial,
        status: TEAM_ACCESS_STATUS.NO_ACCESS,
        teamId: normalizedTeamId,
        reason: 'not-assigned',
        teamDoc,
        memberDoc,
        role,
        owner,
        member: owner || member,
        active,
        assigned,
        error: { code: 'member-unassigned', message: 'Medlemmet er ikke tildelt teamet.' },
        raw: { teamDoc, memberDoc },
      }
    }

    const result = {
      ...initial,
      status: TEAM_ACCESS_STATUS.OK,
      teamId: normalizedTeamId,
      teamDoc,
      memberDoc,
      role,
      owner,
      member: owner || member,
      active: true,
      assigned: true,
      reason: 'ok',
      error: null,
      raw: { teamDoc, memberDoc },
    }
    return result
  } catch (error) {
    return {
      ...initial,
      status: TEAM_ACCESS_STATUS.ERROR,
      reason: 'error',
      error: mapError(error),
    }
  }
}

export async function resolveTeamAccess ({ teamId, user, timeoutMs = TEAM_ACCESS_TIMEOUT_MS, allowCache = true, source = 'resolveTeamAccess' }) {
  const cached = allowCache ? readCache(teamId, user?.uid) : null
  if (cached) {
    logAccessState(source, { ...cached, source: `${source}:cache` })
    return cached
  }

  let timeoutId
  let timeoutTriggered = false
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      timeoutTriggered = true
      console.warn('[TeamAccess] timeout', {
        teamId: formatTeamId(teamId),
        uid: user?.uid || '',
        phase: source,
      })
      resolve({
        ...baseResult({ teamId, user, source }),
        status: TEAM_ACCESS_STATUS.ERROR,
        reason: 'timeout',
        error: { code: 'deadline-exceeded', message: 'Timeout while checking team access' },
      })
    }, timeoutMs)
    timeoutId?.unref?.()
  })

  const access = await Promise.race([
    readTeamAccess({ teamId, user, source }),
    timeoutPromise,
  ]).finally(() => {
    if (timeoutId && !timeoutTriggered) {
      clearTimeout(timeoutId)
    }
  })

  if (allowCache && access.status !== TEAM_ACCESS_STATUS.ERROR) {
    writeCache(access.teamId, access.uid, access)
  }

  logAccessState(source, access)
  return access
}

export async function bootstrapTeamMembership ({ teamId, user, role = 'admin' }) {
  return createTeamWithMembership({ teamId, user, role })
}

export async function createTeamWithMembership ({ teamId, user, role = 'admin' }) {
  if (!user?.uid) throw new Error('Not signed in')
  const db = await getFirestoreDb()
  const sdk = await getFirestoreHelpers()
  const normalizedTeamId = formatTeamId(teamId)
  const now = sdk.serverTimestamp()
  const membershipRole = role === 'admin' ? 'admin' : 'member'

  const result = await sdk.runTransaction(db, async (tx) => {
    const teamRef = sdk.doc(db, 'teams', normalizedTeamId)
    const memberRef = sdk.doc(db, 'teams', normalizedTeamId, 'members', user.uid)
    const teamSnap = await tx.get(teamRef)
    if (teamSnap.exists()) {
      throw Object.assign(new Error('Team findes allerede'), { code: 'team-exists' })
    }
    const teamPayload = {
      teamId: normalizedTeamId,
      name: normalizedTeamId,
      ownerUid: user.uid,
      createdAt: now,
      updatedAt: now,
      createdBy: user.uid,
    }
    const memberPayload = {
      uid: user.uid,
      email: user.email || '',
      emailLower: (user.email || '').toLowerCase(),
      role: membershipRole,
      active: true,
      assigned: true,
      createdAt: now,
      addedAt: now,
      updatedAt: now,
      createdBy: user.uid,
      teamId: normalizedTeamId,
    }
    tx.set(teamRef, teamPayload, { merge: true })
    tx.set(memberRef, memberPayload, { merge: true })
    return { teamPayload, memberPayload }
  })

  if (isTeamDebugEnabled()) {
    teamDebug('team-bootstrap', { teamId: formatTeamId(teamId), uid: user.uid, role: result?.memberPayload?.role })
  }

  return {
    teamId: formatTeamId(teamId),
    teamDoc: { ...(result?.teamPayload || {}), id: formatTeamId(teamId) },
    memberDoc: { ...(result?.memberPayload || {}), id: user.uid },
    role: result?.memberPayload?.role || membershipRole,
  }
}

export function getTeamAccessWithTimeout (options) {
  return resolveTeamAccess(options)
}

export {
  TEAM_ACCESS_TIMEOUT_MS,
  TEAM_ACCESS_CACHE_MS,
}
