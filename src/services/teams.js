import { getFirestoreDb, getFirestoreHelpers } from '../../js/shared-firestore.js'
import { normalizeEmail } from '../auth/roles.js'
import {
  BOOTSTRAP_ADMIN_EMAIL,
  DEFAULT_TEAM_ID,
  DEFAULT_TEAM_SLUG,
  formatTeamId,
  getDisplayTeamId,
  isBootstrapAdminEmail,
  normalizeTeamId,
  persistTeamId,
} from './team-ids.js'

const DEFAULT_MEMBER_INVITE = 'renelowesorensen@gmail.com'

function ensureAuthUser (authUser) {
  if (!authUser || !authUser.uid) throw new Error('Auth-bruger mangler')
  return authUser
}

function normalizeRole (role) {
  if (role === 'owner') return 'owner'
  if (role === 'admin') return 'admin'
  return 'member'
}

function deterministicInviteId (teamIdInput, emailInput) {
  const teamId = formatTeamId(teamIdInput || DEFAULT_TEAM_ID)
  const emailLower = normalizeEmail(emailInput)
  return `${teamId}__${emailLower || 'invite'}`
}

function normalizeInviteForSelection (invite, normalizedEmailLower) {
  const inviteEmailLower = normalizeEmail(invite.emailLower || invite.email)
  const targetEmail = inviteEmailLower || normalizedEmailLower
  const teamId = formatTeamId(invite.teamId || DEFAULT_TEAM_ID)
  const deterministicId = deterministicInviteId(teamId, targetEmail)
  const id = invite.id || invite.inviteId || deterministicId
  return {
    ...invite,
    id,
    inviteId: invite.inviteId || id,
    teamId,
    emailLower: targetEmail,
    role: normalizeRole(invite.role),
    active: invite.active !== false,
  }
}

function rankInvite (invite, normalizedEmailLower) {
  const deterministicId = deterministicInviteId(invite.teamId, normalizedEmailLower)
  const isDefaultTeam = formatTeamId(invite.teamId) === formatTeamId(DEFAULT_TEAM_ID)
  const deterministicRank = invite.id === deterministicId ? 0 : 1
  return { isDefaultTeam, deterministicRank }
}

function collectInviteIds (invites, normalizedEmailLower) {
  const ids = invites.flatMap(invite => {
    const deterministicId = deterministicInviteId(invite.teamId, normalizedEmailLower)
    return [invite.id, invite.inviteId, deterministicId].filter(Boolean)
  })
  return Array.from(new Set(ids))
}

export function selectDeterministicInvite (invites, emailLowerInput) {
  const normalizedEmailLower = normalizeEmail(emailLowerInput)
  if (!normalizedEmailLower) return null
  const normalizedInvites = (invites || [])
    .map(invite => normalizeInviteForSelection(invite, normalizedEmailLower))
    .filter(invite => invite.emailLower === normalizedEmailLower && invite.active !== false && !invite.usedAt)

  if (!normalizedInvites.length) return null

  normalizedInvites.sort((a, b) => {
    const rankA = rankInvite(a, normalizedEmailLower)
    const rankB = rankInvite(b, normalizedEmailLower)
    if (rankA.isDefaultTeam !== rankB.isDefaultTeam) return rankA.isDefaultTeam ? -1 : 1
    if (rankA.deterministicRank !== rankB.deterministicRank) return rankA.deterministicRank - rankB.deterministicRank
    return a.id.localeCompare(b.id)
  })

  return { primary: normalizedInvites[0], inviteIds: collectInviteIds(normalizedInvites, normalizedEmailLower) }
}

function buildMemberPayload ({ sdk, authUser, teamId, role = 'member', existing }) {
  const now = sdk.serverTimestamp()
  const createdAt = existing?.createdAt || now
  const addedAt = existing?.addedAt || createdAt
  return {
    uid: authUser.uid,
    email: normalizeEmail(authUser.email),
    emailLower: normalizeEmail(authUser.email),
    displayName: authUser.displayName || authUser.name || '',
    role: normalizeRole(role),
    active: true,
    createdAt,
    addedAt,
    updatedAt: now,
    teamId,
  }
}

async function ensureTeamDocument (sdk, db, teamId, ownerUid) {
  const ref = sdk.doc(db, 'teams', teamId)
  const snapshot = await sdk.getDoc(ref)
  if (snapshot.exists()) return snapshot
  const now = sdk.serverTimestamp()
  await sdk.setDoc(ref, {
    teamId,
    name: getDisplayTeamId(teamId),
    ownerUid: ownerUid || null,
    createdAt: now,
    updatedAt: now,
  }, { merge: true })
  return sdk.getDoc(ref)
}

export async function ensureUserDoc (authUser) {
  const user = ensureAuthUser(authUser)
  const db = await getFirestoreDb()
  const sdk = await getFirestoreHelpers()
  const ref = sdk.doc(db, 'users', user.uid)
  const existing = await sdk.getDoc(ref)
  const now = sdk.serverTimestamp()
  const basePayload = {
    uid: user.uid,
    email: user.email || '',
    emailLower: normalizeEmail(user.email),
    displayName: user.displayName || user.name || '',
    updatedAt: now,
    lastLoginAt: now,
  }
  if (!existing.exists()) {
    basePayload.createdAt = now
  }
  await sdk.setDoc(ref, basePayload, { merge: true })
  const next = await sdk.getDoc(ref)
  const nextData = next.data() || {}
  return { id: ref.id, ...nextData, teamId: nextData.teamId || '', role: nextData.role || '' }
}

export async function upsertUserTeamRoleCache (authUid, teamId, role, extra = {}) {
  if (!authUid) return null
  const db = await getFirestoreDb()
  const sdk = await getFirestoreHelpers()
  const ref = sdk.doc(db, 'users', authUid)
  const now = sdk.serverTimestamp()
  const payload = {
    teamId: teamId ? formatTeamId(teamId) : '',
    role: normalizeRole(role),
    updatedAt: now,
  }
  if (extra.emailLower) payload.emailLower = normalizeEmail(extra.emailLower)
  if (extra.displayName) payload.displayName = extra.displayName
  await sdk.setDoc(ref, payload, { merge: true })
  return { id: authUid, ...payload }
}

export async function resolveMembership (authUid) {
  if (!authUid) return null
  const db = await getFirestoreDb()
  const sdk = await getFirestoreHelpers()
  const userRef = sdk.doc(db, 'users', authUid)
  const userSnapshot = await sdk.getDoc(userRef)
  const userData = userSnapshot.exists() ? userSnapshot.data() : null
  const cachedTeamId = userData?.teamId ? formatTeamId(userData.teamId) : ''
  let membership = null

  if (cachedTeamId) {
    const memberRef = sdk.doc(db, 'teams', cachedTeamId, 'members', authUid)
    const memberSnapshot = await sdk.getDoc(memberRef)
    if (memberSnapshot.exists()) {
      membership = { ...(memberSnapshot.data() || {}), teamId: cachedTeamId, uid: authUid }
    }
  }

  if (!membership) {
    const membersGroup = sdk.collectionGroup(db, 'members')
    const query = sdk.query(membersGroup, sdk.where('uid', '==', authUid), sdk.limit(1))
    const snapshot = await sdk.getDocs(query)
    if (!snapshot.empty) {
      const doc = snapshot.docs[0]
      const parentTeamId = doc.ref?.parent?.parent?.id
      membership = {
        ...(doc.data() || {}),
        uid: authUid,
        teamId: parentTeamId ? formatTeamId(parentTeamId) : formatTeamId(doc.data()?.teamId || cachedTeamId || DEFAULT_TEAM_ID),
      }
    }
  }

  if (membership?.teamId && cachedTeamId !== membership.teamId) {
    await upsertUserTeamRoleCache(authUid, membership.teamId, membership.role, {
      emailLower: membership.email || userData?.emailLower || '',
      displayName: userData?.displayName,
    })
  }

  if (membership) {
    return {
      ...membership,
      role: normalizeRole(membership.role),
      active: membership.active !== false,
    }
  }

  return null
}

export async function createTeamInvite (teamIdInput, email, role = 'member', meta = {}) {
  const emailLower = normalizeEmail(email)
  if (!emailLower) throw new Error('Angiv email for invitation.')
  const db = await getFirestoreDb()
  const sdk = await getFirestoreHelpers()
  const teamId = formatTeamId(teamIdInput || DEFAULT_TEAM_ID)
  const invitesRef = sdk.collection(db, 'teamInvites')
  const deterministicId = deterministicInviteId(teamId, emailLower)
  const deterministicRef = sdk.doc(invitesRef, deterministicId)
  const deterministicSnapshot = await sdk.getDoc(deterministicRef)
  const existingSnapshot = await sdk.getDocs(
    sdk.query(invitesRef, sdk.where('teamId', '==', teamId), sdk.where('emailLower', '==', emailLower))
  )
  const existingInvite = existingSnapshot.docs.find(doc => {
    const data = doc.data() || {}
    return data.active !== false && !data.usedAt
  })
  const inviteRef = deterministicSnapshot.exists() ? deterministicRef : (existingInvite ? existingInvite.ref : deterministicRef)
  const now = sdk.serverTimestamp()
  const sourceData = existingInvite ? (existingInvite.data() || {}) : (deterministicSnapshot.exists() ? (deterministicSnapshot.data() || {}) : {})
  const payload = {
    teamId,
    emailLower,
    role: normalizeRole(role),
    inviteId: inviteRef.id,
    active: sourceData.active !== false,
    invitedByUid: meta?.invitedByUid || sourceData.invitedByUid || null,
    invitedByEmail: normalizeEmail(meta?.invitedByEmail) || sourceData.invitedByEmail || null,
    createdAt: sourceData.createdAt || now,
    updatedAt: now,
    usedAt: sourceData.usedAt || null,
    usedByUid: sourceData.usedByUid || null,
  }
  await sdk.setDoc(inviteRef, payload, { merge: true })
  if (inviteRef.id !== deterministicRef.id) {
    await sdk.setDoc(deterministicRef, payload, { merge: true })
  }
  return { id: inviteRef.id, inviteId: inviteRef.id, ...payload }
}

export async function consumeInviteIfAny (authUserEmailLower, authUid) {
  const emailLower = normalizeEmail(authUserEmailLower)
  if (!emailLower || !authUid) return null
  const db = await getFirestoreDb()
  const sdk = await getFirestoreHelpers()
  const invitesRef = sdk.collection(db, 'teamInvites')
  const snapshot = await sdk.getDocs(sdk.query(invitesRef, sdk.where('emailLower', '==', emailLower)))
  const invites = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() || {}) }))
  const selection = selectDeterministicInvite(invites, emailLower)
  if (!selection) return null
  const primaryInvite = selection.primary
  const teamId = formatTeamId(primaryInvite.teamId || DEFAULT_TEAM_ID)
  const inviteId = primaryInvite.inviteId || primaryInvite.id
  const inviteDocIds = selection.inviteIds.length ? selection.inviteIds : [inviteId]
  const memberRef = sdk.doc(db, 'teams', teamId, 'members', authUid)
  const memberSnapshot = await sdk.getDoc(memberRef)
  const memberPayload = buildMemberPayload({
    sdk,
    authUser: { uid: authUid, email: emailLower, displayName: primaryInvite.displayName || '' },
    teamId,
    role: normalizeRole(primaryInvite.role),
    existing: memberSnapshot.exists() ? memberSnapshot.data() : null,
  })
  memberPayload.inviteId = inviteId
  await sdk.setDoc(memberRef, memberPayload, { merge: true })
  await upsertUserTeamRoleCache(authUid, teamId, memberPayload.role, { emailLower })
  const usedPayload = { usedAt: sdk.serverTimestamp(), usedByUid: authUid, active: false, updatedAt: sdk.serverTimestamp() }
  await Promise.all(inviteDocIds.map(id => sdk.setDoc(sdk.doc(db, 'teamInvites', id), usedPayload, { merge: true })))
  return { teamId, role: memberPayload.role, inviteId, membership: { ...memberPayload, inviteId } }
}

export async function ensureTeamForAdminIfMissing (authUser, preferredTeamId = DEFAULT_TEAM_ID) {
  const user = ensureAuthUser(authUser)
  if (!isBootstrapAdminEmail(user.email)) return null
  const existingMembership = await resolveMembership(user.uid)
  if (existingMembership?.teamId) return existingMembership
  const db = await getFirestoreDb()
  const sdk = await getFirestoreHelpers()
  const teamId = formatTeamId(preferredTeamId || DEFAULT_TEAM_ID)
  const teamSnapshot = await ensureTeamDocument(sdk, db, teamId, user.uid)
  const memberRef = sdk.doc(db, 'teams', teamId, 'members', user.uid)
  const memberPayload = buildMemberPayload({
    sdk,
    authUser: user,
    teamId,
    role: 'owner',
    existing: teamSnapshot.exists() ? teamSnapshot.data() : null,
  })
  await sdk.setDoc(memberRef, memberPayload, { merge: true })
  await upsertUserTeamRoleCache(user.uid, teamId, memberPayload.role, { emailLower: normalizeEmail(user.email), displayName: user.displayName })
  persistTeamId(normalizeTeamId(teamId))
  try {
    await createTeamInvite(teamId, DEFAULT_MEMBER_INVITE, 'member', { invitedByUid: user.uid, invitedByEmail: user.email })
  } catch (error) {
    console.warn('Kunne ikke oprette auto-invite', error)
  }
  try {
    console.info('[Teams] Bootstrap-team klar', teamId)
  } catch (error) {}
  return { ...memberPayload, teamId, role: memberPayload.role }
}
