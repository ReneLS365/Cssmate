import { getFirestoreDb, getFirestoreHelpers } from '../../js/shared-firestore.js'
import { formatTeamId } from './team-ids.js'

const TEAM_ACCESS_TIMEOUT_MS = 8000

export const TEAM_ACCESS_STATUS = {
  CHECKING: 'checking',
  OK: 'ok',
  NO_ACCESS: 'no-access',
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
    isOwner: false,
    isAdmin: false,
    error: null,
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

async function resolveTeamAccessInner ({ teamId, user }) {
  const initial = baseResult({ teamId, user })

  if (!user?.uid) {
    return {
      ...initial,
      status: TEAM_ACCESS_STATUS.NO_ACCESS,
      error: { code: 'unauthenticated', message: 'Log ind for at fortsætte.' },
    }
  }

  if (!teamId) {
    return {
      ...initial,
      status: TEAM_ACCESS_STATUS.ERROR,
      error: { code: 'missing-team', message: 'TeamId mangler' },
    }
  }

  let finalResult = { ...initial }
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
    const memberDoc = memberSnap.exists()
      ? { ...(memberSnap.data() || {}), id: memberSnap.id || user.uid, uid: memberSnap.id || user.uid }
      : null
    const isOwner = Boolean(teamDoc?.ownerUid && teamDoc.ownerUid === user.uid)
    const memberRole = memberDoc?.role === 'owner' ? 'owner' : (memberDoc?.role === 'admin' ? 'admin' : 'member')
    const isAdmin = Boolean(isOwner || memberRole === 'admin')

    let status = TEAM_ACCESS_STATUS.OK
    let error = null
    if (!teamSnap.exists()) {
      status = TEAM_ACCESS_STATUS.NEED_CREATE
      error = { code: 'missing-team', message: 'Team mangler. Opret eller vælg et andet team.' }
    } else if (!memberSnap.exists()) {
      status = TEAM_ACCESS_STATUS.NO_ACCESS
      error = { code: 'not-member', message: 'Ingen adgang til dette team.' }
    } else if (memberDoc.active === false) {
      status = TEAM_ACCESS_STATUS.NO_ACCESS
      error = { code: 'member-inactive', message: 'Medlemmet er deaktiveret.' }
    }

    finalResult = {
      ...initial,
      status,
      teamId: normalizedTeamId,
      teamDoc,
      memberDoc,
      role: memberRole,
      memberActive: memberDoc?.active !== false,
      isOwner,
      isAdmin,
      error,
    }
  } catch (error) {
    finalResult = {
      ...initial,
      status: TEAM_ACCESS_STATUS.ERROR,
      error: mapError(error),
    }
  }

  return finalResult
}

export async function resolveTeamAccess ({ teamId, user }) {
  return resolveTeamAccessInner({ teamId, user })
}

export async function resolveTeamAccessWithTimeout ({ teamId, user, timeoutMs = TEAM_ACCESS_TIMEOUT_MS }) {
  const timeoutPromise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({
        ...baseResult({ teamId, user }),
        status: TEAM_ACCESS_STATUS.ERROR,
        error: { code: 'deadline-exceeded', message: 'Timeout while checking team access' },
      })
    }, timeoutMs)
    timer.unref?.()
  })

  return Promise.race([
    resolveTeamAccessInner({ teamId, user }),
    timeoutPromise,
  ])
}

export async function bootstrapTeamMembership ({ teamId, user }) {
  if (!user?.uid) throw new Error('Not signed in')
  const db = await getFirestoreDb()
  const sdk = await getFirestoreHelpers()
  const normalizedTeamId = formatTeamId(teamId)
  const memberRef = sdk.doc(db, 'teams', normalizedTeamId, 'members', user.uid)
  const existing = await sdk.getDoc(memberRef)
  const existingData = existing.exists() ? existing.data() || {} : {}
  const payload = {
    uid: user.uid,
    email: user.email || '',
    name: user.displayName || user.name || '',
    active: true,
    assigned: true,
  }
  if (!existingData.createdAt) {
    payload.createdAt = sdk.serverTimestamp()
  }
  if (!existingData.role) {
    payload.role = 'user'
  }
  await sdk.setDoc(memberRef, payload, { merge: true })
  const nextSnapshot = await sdk.getDoc(memberRef)
  return nextSnapshot.exists() ? { id: nextSnapshot.id, ...(nextSnapshot.data() || {}) } : payload
}

export {
  TEAM_ACCESS_TIMEOUT_MS,
}
