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

export function buildMemberDocPath (teamIdInput, uid) {
  if (!uid) throw new Error('UID påkrævet for medlemsdokument')
  const teamId = formatTeamId(teamIdInput || DEFAULT_TEAM_ID)
  return `teams/${teamId}/members/${uid}`
}

function getMemberDocRef (sdk, db, teamIdInput, uid) {
  if (!uid) throw new Error('UID påkrævet for medlemsdokument')
  const teamId = formatTeamId(teamIdInput || DEFAULT_TEAM_ID)
  return sdk.doc(db, 'teams', teamId, 'members', uid)
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

export async function resolveMembership (authUid, preferredTeamId, { userTeamId, emailLower } = {}) {
  if (!authUid) return { membership: null, path: '', teamId: '' }
  const db = await getFirestoreDb()
  const sdk = await getFirestoreHelpers()
  const userRef = sdk.doc(db, 'users', authUid)
  const userSnapshot = await sdk.getDoc(userRef)
  const userData = userSnapshot.exists() ? userSnapshot.data() : null
  const cachedTeamId = userData?.teamId ? formatTeamId(userData.teamId) : ''
  const normalizedEmail = normalizeEmail(emailLower || userData?.emailLower || userData?.email || '')

  const candidates = []
  const addCandidate = (teamId) => {
    const formatted = formatTeamId(teamId || DEFAULT_TEAM_ID)
    if (!candidates.includes(formatted)) candidates.push(formatted)
  }
  addCandidate(preferredTeamId)
  if (userTeamId) addCandidate(userTeamId)
  if (cachedTeamId) addCandidate(cachedTeamId)
  addCandidate(DEFAULT_TEAM_ID)

  let lastPath = ''
  for (const teamId of candidates) {
    const memberRef = getMemberDocRef(sdk, db, teamId, authUid)
    lastPath = memberRef?.path || buildMemberDocPath(teamId, authUid)
    const memberSnapshot = await sdk.getDoc(memberRef)
    if (!memberSnapshot.exists()) continue
    const data = memberSnapshot.data() || {}
    if (data.uid && data.uid !== authUid) {
      console.warn('[MembershipGuard] Medlemsdoc UID matcher ikke auth.uid', { expectedUid: authUid, docUid: data.uid, path: memberRef.path })
      continue
    }
    const membership = {
      ...data,
      uid: authUid,
      teamId,
      email: data.email || normalizedEmail,
      emailLower: normalizeEmail(data.emailLower || data.email || normalizedEmail),
      role: normalizeRole(data.role),
      active: data.active !== false,
    }
    if (membership.teamId && cachedTeamId !== membership.teamId) {
      await upsertUserTeamRoleCache(authUid, membership.teamId, membership.role, {
        emailLower: membership.emailLower || normalizedEmail,
        displayName: userData?.displayName,
      })
    }
    return { membership, path: memberRef.path || lastPath, teamId }
  }

  return { membership: null, path: lastPath, teamId: candidates[0] || '' }
}

export async function findMismatchedMemberDocs (teamIdInput, authUser) {
  if (!authUser?.uid) return []
  const db = await getFirestoreDb()
  const sdk = await getFirestoreHelpers()
  const teamId = formatTeamId(teamIdInput || DEFAULT_TEAM_ID)
  const membersRef = sdk.collection(db, 'teams', teamId, 'members')
  const normalizedEmail = normalizeEmail(authUser.email)
  const queries = [
    sdk.query(membersRef, sdk.where('uid', '==', authUser.uid)),
  ]
  if (normalizedEmail) {
    queries.push(sdk.query(membersRef, sdk.where('emailLower', '==', normalizedEmail)))
  }
  const snapshots = await Promise.all(queries.map(q => sdk.getDocs(q).catch(() => null)))
  const mismatches = []
  snapshots.filter(Boolean).forEach(snapshot => {
    snapshot.docs.forEach(doc => {
      if (doc.id === authUser.uid) return
      const data = doc.data() || {}
      if (data.uid === authUser.uid || normalizeEmail(data.email || data.emailLower) === normalizedEmail) {
        mismatches.push({ id: doc.id, path: doc.ref?.path || '', data })
      }
    })
  })
  const seen = new Set()
  return mismatches.filter(entry => {
    if (seen.has(entry.id)) return false
    seen.add(entry.id)
    return true
  })
}

export async function migrateMemberDocIfNeeded (teamIdInput, authUser) {
  const mismatches = await findMismatchedMemberDocs(teamIdInput, authUser)
  if (!mismatches.length) return { created: false, mismatches }
  const db = await getFirestoreDb()
  const sdk = await getFirestoreHelpers()
  const teamId = formatTeamId(teamIdInput || DEFAULT_TEAM_ID)
  const canonicalRef = getMemberDocRef(sdk, db, teamId, authUser.uid)
  const now = sdk.serverTimestamp()
  const source = mismatches[0]?.data || {}
  const payload = {
    uid: authUser.uid,
    email: normalizeEmail(authUser.email) || source.email || source.emailLower || '',
    emailLower: normalizeEmail(authUser.email) || normalizeEmail(source.emailLower || source.email),
    displayName: authUser.displayName || authUser.name || source.displayName || '',
    role: normalizeRole(source.role || 'admin'),
    active: source.active !== false,
    assigned: source.assigned !== false,
    createdAt: source.createdAt || now,
    addedAt: source.addedAt || source.createdAt || now,
    updatedAt: now,
    teamId,
  }
  await sdk.setDoc(canonicalRef, payload, { merge: true })
  console.warn('[MembershipGuard] Oprettede medlemsdoc med UID som id', {
    uid: authUser.uid,
    email: authUser.email,
    expectedPath: canonicalRef.path || buildMemberDocPath(teamId, authUser.uid),
    copiedFrom: mismatches.map(entry => entry.path || entry.id),
  })
  return { created: true, mismatches, canonicalPath: canonicalRef.path || buildMemberDocPath(teamId, authUser.uid) }
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
  const memberRef = getMemberDocRef(sdk, db, teamId, authUid)
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
  const existingMembership = await resolveMembership(user.uid, preferredTeamId, { emailLower: user.email })
  if (existingMembership?.membership?.teamId) return existingMembership.membership
  const db = await getFirestoreDb()
  const sdk = await getFirestoreHelpers()
  const teamId = formatTeamId(preferredTeamId || DEFAULT_TEAM_ID)
  const teamSnapshot = await ensureTeamDocument(sdk, db, teamId, user.uid)
  const memberRef = getMemberDocRef(sdk, db, teamId, user.uid)
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
