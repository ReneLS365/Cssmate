import { normalizeEmail } from '../auth/roles.js'
import {
  BOOTSTRAP_ADMIN_EMAIL,
  DEFAULT_TEAM_ID,
  DEFAULT_TEAM_SLUG,
  formatTeamId,
  normalizeTeamId,
} from './team-ids.js'

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

export function normalizeInviteRecord (invite, fallbackEmailLower = '') {
  if (!invite || typeof invite !== 'object') return null
  if (typeof invite.teamId !== 'string' || !invite.teamId.trim()) return null
  const inviteEmailLower = normalizeEmail(invite.emailLower || invite.email || fallbackEmailLower)
  if (!inviteEmailLower) return null
  const teamId = formatTeamId(invite.teamId || DEFAULT_TEAM_ID)
  if (!teamId) return null
  const deterministicId = deterministicInviteId(teamId, inviteEmailLower)
  const id = invite.id || invite.inviteId || deterministicId
  if (!id) return null
  return {
    ...invite,
    id,
    inviteId: invite.inviteId || id,
    teamId,
    emailLower: inviteEmailLower,
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
    .map(invite => normalizeInviteRecord(invite, normalizedEmailLower))
    .filter(Boolean)
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

export async function ensureUserDoc (authUser) {
  const user = ensureAuthUser(authUser)
  return { id: user.uid, teamId: '', role: '' }
}

export async function upsertUserTeamRoleCache (authUid, teamId, role) {
  if (!authUid) return null
  return { id: authUid, teamId: formatTeamId(teamId), role: normalizeRole(role) }
}

export async function resolveMembership (authUid, preferredTeamId) {
  if (!authUid) return { membership: null, path: '', teamId: '' }
  const teamId = formatTeamId(preferredTeamId || DEFAULT_TEAM_ID)
  return { membership: null, path: buildMemberDocPath(teamId, authUid), teamId }
}

export async function migrateMemberDocIfNeeded (teamIdInput, authUser) {
  const teamId = formatTeamId(teamIdInput || DEFAULT_TEAM_SLUG)
  const canonicalPath = authUser?.uid ? buildMemberDocPath(teamId, authUser.uid) : ''
  return { created: false, mismatches: [], canonicalPath }
}

export function isBootstrapAdminEmail (emailLower) {
  return normalizeEmail(emailLower) === normalizeEmail(BOOTSTRAP_ADMIN_EMAIL)
}

export {
  BOOTSTRAP_ADMIN_EMAIL,
  DEFAULT_TEAM_ID,
  DEFAULT_TEAM_SLUG,
  formatTeamId,
  normalizeTeamId,
}
