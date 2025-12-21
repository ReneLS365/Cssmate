import { getFirestoreDb, getFirestoreHelpers } from '../../js/shared-firestore.js'
import { formatTeamId } from './team-ids.js'
import { isTeamDebugEnabled, teamDebug } from '../utils/team-debug.js'

const TEAM_ACCESS_TIMEOUT_MS = 10000

export const TEAM_ACCESS_STATUS = {
  SIGNED_OUT: 'signed-out',
  CHECKING: 'checking',
  OK: 'ok',
  NO_ACCESS: 'denied',
  DENIED: 'denied',
  NEED_CREATE: 'need-create',
  ERROR: 'error',
}

function baseResult ({ teamId, user }) {
  return {
    status: TEAM_ACCESS_STATUS.CHECKING,
    teamId: formatTeamId(teamId),
    uid: user?.uid || '',
    email: user?.email || '',
    teamDoc: null,
    memberDoc: null,
    role: '',
    memberActive: null,
    isAdmin: false,
    error: null,
    reason: '',
  }
}

function mapError (error) {
  const code = error?.code || 'error'
  const message = error?.message || 'Ukendt fejl'
  if (code === 'permission-denied') {
    return { code, message: 'Firestore permission denied (tjek rules/AppCheck).' }
  }
  if (message.toLowerCase().includes('app check')) {
    return { code: 'app-check', message: 'AppCheck fejl — tjek site key / debug token.' }
  }
  return { code, message }
}

function normalizeMemberDoc (snapshot, fallbackUid) {
  if (!snapshot?.exists?.()) return null
  const data = snapshot.data() || {}
  const role = data.role === 'admin' ? 'admin' : 'member'
  return {
    ...data,
    id: snapshot.id || fallbackUid || '',
    uid: snapshot.id || fallbackUid || '',
    role,
    active: data.active !== false && data.disabled !== true,
    disabled: data.disabled === true,
  }
}

async function readTeamAccess ({ teamId, user }) {
  const initial = baseResult({ teamId, user })
  if (!user?.uid) {
    return { ...initial, status: TEAM_ACCESS_STATUS.SIGNED_OUT, reason: 'unauthenticated' }
  }
  if (!teamId) {
    return {
      ...initial,
      status: TEAM_ACCESS_STATUS.ERROR,
      reason: 'missing-team',
      error: { code: 'missing-team', message: 'TeamId mangler' },
    }
  }

  try {
    const db = await getFirestoreDb()
    const sdk = await getFirestoreHelpers()
    const normalizedTeamId = formatTeamId(teamId)
    const teamRef = sdk.doc(db, 'teams', normalizedTeamId)
    const memberRef = sdk.doc(db, 'teams', normalizedTeamId, 'members', user.uid)
    const [teamSnap, memberSnap] = await Promise.all([
      sdk.getDoc(teamRef),
      sdk.getDoc(memberRef),
    ])

    const teamDoc = teamSnap.exists() ? { ...(teamSnap.data() || {}), id: teamSnap.id || normalizedTeamId } : null
    const memberDoc = normalizeMemberDoc(memberSnap, user.uid)

    if (!teamSnap.exists()) {
      return {
        ...initial,
        status: TEAM_ACCESS_STATUS.NEED_CREATE,
        teamId: normalizedTeamId,
        reason: 'missing-team',
        teamDoc,
        memberDoc,
        error: { code: 'missing-team', message: 'Team mangler. Opret eller vælg et andet team.' },
      }
    }

    if (!memberDoc) {
      return {
        ...initial,
        status: TEAM_ACCESS_STATUS.DENIED,
        teamId: normalizedTeamId,
        reason: 'not-member',
        teamDoc,
        error: { code: 'not-member', message: 'Ingen adgang til dette team.' },
      }
    }

    if (memberDoc.disabled) {
      return {
        ...initial,
        status: TEAM_ACCESS_STATUS.DENIED,
        teamId: normalizedTeamId,
        reason: 'disabled',
        teamDoc,
        memberDoc,
        error: { code: 'member-disabled', message: 'Medlemmet er deaktiveret.' },
      }
    }

    const isAdmin = memberDoc.role === 'admin'
    const result = {
      ...initial,
      status: TEAM_ACCESS_STATUS.OK,
      teamId: normalizedTeamId,
      teamDoc,
      memberDoc,
      role: memberDoc.role,
      memberActive: memberDoc.active,
      isAdmin,
      reason: 'ok',
      error: null,
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

export async function getTeamAccess ({ teamId, user, timeoutMs = TEAM_ACCESS_TIMEOUT_MS }) {
  const timeoutPromise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({
        ...baseResult({ teamId, user }),
        status: TEAM_ACCESS_STATUS.ERROR,
        reason: 'timeout',
        error: { code: 'deadline-exceeded', message: 'Timeout while checking team access' },
      })
    }, timeoutMs)
    timer.unref?.()
  })

  const access = await Promise.race([
    readTeamAccess({ teamId, user }),
    timeoutPromise,
  ])

  if (isTeamDebugEnabled()) {
    teamDebug('access-state', {
      teamId: access.teamId,
      uid: access.uid,
      status: access.status,
      reason: access.reason,
      role: access.role,
      error: access.error?.code || null,
    })
  }

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
  return getTeamAccess(options)
}

export {
  TEAM_ACCESS_TIMEOUT_MS,
}
