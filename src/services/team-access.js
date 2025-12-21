import { getFirestoreDb, getFirestoreHelpers } from '../../js/shared-firestore.js'
import { formatTeamId } from './team-ids.js'

const TEAM_ACCESS_TIMEOUT_MS = 8000

function baseResult ({ teamId, user }) {
  return {
    status: 'checking',
    teamId: formatTeamId(teamId),
    uid: user?.uid || '',
    email: user?.email || '',
    teamDoc: null,
    memberDoc: null,
    isOwner: false,
    isAdmin: false,
    error: null,
  }
}

async function resolveTeamAccessInner ({ teamId, user }) {
  const initial = baseResult({ teamId, user })
  console.debug('[TeamAccess] start', { teamId: initial.teamId, uid: initial.uid })

  if (!user?.uid) {
    return {
      ...initial,
      status: 'error',
      error: { code: 'unauthenticated', message: 'Not signed in' },
    }
  }

  if (!teamId) {
    return {
      ...initial,
      status: 'error',
      error: { code: 'missing-team', message: 'Missing teamId' },
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
    const isAdmin = Boolean(isOwner || memberDoc?.role === 'admin')

    let status = 'ok'
    let error = null
    if (!teamSnap.exists()) {
      status = 'error'
      error = { code: 'missing-team', message: 'Team not found' }
    } else if (!memberSnap.exists()) {
      status = 'no-membership'
      error = { code: 'not-member', message: 'No membership for this team' }
    } else if (memberDoc.active === false) {
      status = 'denied'
      error = { code: 'member-inactive', message: 'Membership is deactivated' }
    }

    finalResult = {
      ...initial,
      status,
      teamId: normalizedTeamId,
      teamDoc,
      memberDoc,
      isOwner,
      isAdmin,
      error,
    }
  } catch (error) {
    finalResult = {
      ...initial,
      status: 'error',
      error: { code: error?.code || 'error', message: error?.message || 'Unknown error' },
    }
  } finally {
    console.debug('[TeamAccess] outcome', {
      teamId: finalResult.teamId,
      uid: finalResult.uid,
      status: finalResult.status,
      isAdmin: finalResult.isAdmin,
      error: finalResult.error?.code || null,
    })
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
        status: 'error',
        teamId: formatTeamId(teamId),
        uid: user?.uid || '',
        email: user?.email || '',
        teamDoc: null,
        memberDoc: null,
        isOwner: false,
        isAdmin: false,
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
