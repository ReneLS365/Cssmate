import { getAuthContext, waitForAuthReady } from './shared-auth.js'
import { apiJson } from '../src/api/client.js'
import { normalizeEmail } from '../src/auth/roles.js'
import { updateTeamDebugState } from '../src/state/debug.js'
import {
  DEFAULT_TEAM_ID,
  DEFAULT_TEAM_SLUG,
  TEAM_STORAGE_KEY,
  formatTeamId,
  getDisplayTeamId,
  getStoredTeamId,
  normalizeTeamId,
  persistTeamId,
  resolvePreferredTeamId,
} from '../src/services/team-ids.js'
import { buildMemberDocPath } from '../src/services/teams.js'
import { getTeamAccessWithTimeout, TEAM_ACCESS_STATUS } from '../src/services/team-access.js'

const LEDGER_VERSION = 1
const BACKUP_SCHEMA_VERSION = 2

class PermissionDeniedError extends Error {
  constructor(message) {
    super(message)
    this.code = 'permission-denied'
  }
}

class MembershipMissingError extends PermissionDeniedError {
  constructor(teamId, uid, message) {
    super(message || 'Du er ikke medlem af dette team.')
    this.code = 'not-member'
    this.teamId = teamId
    this.uid = uid
    this.expectedPath = teamId && uid ? `teams/${teamId}/members/${uid}` : ''
  }
}

class InviteMissingError extends PermissionDeniedError {
  constructor(teamId, email, message) {
    super(message || 'Ingen aktiv invitation fundet.')
    this.code = 'invite-missing'
    this.teamId = teamId
    this.email = email
  }
}

class InactiveMemberError extends PermissionDeniedError {
  constructor(teamId, uid, message) {
    super(message || 'Medlemmet er deaktiveret.')
    this.code = 'member-inactive'
    this.teamId = teamId
    this.uid = uid
  }
}

const teamCache = {
  uid: null,
  teamId: null,
  membership: null,
}

async function ensureAuthUser() {
  await waitForAuthReady()
  const auth = getAuthContext()
  if (!auth?.isAuthenticated || !auth.user?.uid) {
    throw new PermissionDeniedError('Log ind for at fortsætte.')
  }
  return auth.user
}

function normalizeJobNumber(jobNumber) {
  return (jobNumber || '').toString().trim() || 'UKENDT'
}

function cacheTeamResolution(uid, teamId, membership) {
  teamCache.uid = uid
  teamCache.teamId = teamId
  teamCache.membership = membership || null
}

function getCachedTeam(uid) {
  if (uid && uid === teamCache.uid && teamCache.teamId) {
    return { teamId: teamCache.teamId, membership: teamCache.membership }
  }
  return null
}

function normalizeActor(actor, membership) {
  const base = actor || {}
  return {
    uid: base.uid || base.id || 'user',
    email: base.email || '',
    name: base.name || base.displayName || '',
    displayName: base.displayName || base.name || '',
    providerId: base.providerId || base.provider || 'custom',
    role: membership?.role || base.role || null,
  }
}

export function resolveTeamId(rawTeamId) {
  const provided = rawTeamId || (typeof window !== 'undefined' ? window.TEAM_ID : null)
  if (provided) return formatTeamId(provided)
  const cached = getCachedTeam(getAuthContext()?.user?.uid || null)
  if (cached?.teamId) return cached.teamId
  return resolvePreferredTeamId(provided)
}

async function guardTeamAccess(teamIdInput, user, { allowBootstrap = false } = {}) {
  if (!user?.uid) throw new PermissionDeniedError('Log ind for at fortsætte.')
  const preferredTeam = normalizeTeamId(teamIdInput || getStoredTeamId() || DEFAULT_TEAM_SLUG)
  const resolvedTeamId = formatTeamId(preferredTeam)
  const membershipPath = buildMemberDocPath(resolvedTeamId, user.uid)
  const access = await getTeamAccessWithTimeout({ teamId: resolvedTeamId, user, source: 'shared-ledger:guard' })
  const membershipStatus = access.status === TEAM_ACCESS_STATUS.OK
    ? 'member'
    : access.status === TEAM_ACCESS_STATUS.NO_TEAM || access.status === TEAM_ACCESS_STATUS.NEED_CREATE
      ? 'missing_team'
      : access.status === TEAM_ACCESS_STATUS.NO_AUTH
        ? 'no_auth'
        : 'not_member'
  updateTeamDebugState({
    teamId: access.teamId || resolvedTeamId,
    member: access.memberDoc || null,
    teamResolved: access.status === TEAM_ACCESS_STATUS.OK || access.status === TEAM_ACCESS_STATUS.NO_ACCESS,
    membershipStatus,
    membershipCheckPath: membershipPath,
    memberAssigned: typeof access.assigned === 'boolean' ? access.assigned : access?.memberDoc?.assigned,
  })
  if (access.status === TEAM_ACCESS_STATUS.OK) {
    const baseMember = access.memberDoc || {
      uid: user.uid,
      teamId: access.teamId || resolvedTeamId,
      email: normalizeEmail(user.email),
      emailLower: normalizeEmail(user.email),
      role: access.role || (access.owner ? 'owner' : 'member'),
      active: access.active !== false,
      assigned: access.assigned !== false,
    }
    const normalizedMembership = {
      ...baseMember,
      uid: baseMember.uid || user.uid,
      teamId: access.teamId || resolvedTeamId,
      email: baseMember.email || normalizeEmail(user.email),
      emailLower: normalizeEmail(baseMember.emailLower || baseMember.email || user.email),
      role: baseMember.role === 'owner' ? 'owner' : (baseMember.role === 'admin' ? 'admin' : 'member'),
      active: baseMember.active !== false,
      assigned: baseMember.assigned !== false,
    }
    const accessRole = normalizedMembership.role === 'admin' || normalizedMembership.role === 'owner' ? normalizedMembership.role : 'member'
    cacheTeamResolution(user.uid, normalizedMembership.teamId, normalizedMembership)
    persistTeamId(normalizeTeamId(normalizedMembership.teamId))
    return { teamId: normalizedMembership.teamId, membership: normalizedMembership, invite: null, role: accessRole }
  }
  if (access.status === TEAM_ACCESS_STATUS.NO_TEAM || access.status === TEAM_ACCESS_STATUS.NEED_CREATE) {
    const message = allowBootstrap
      ? `Team ${getDisplayTeamId(resolvedTeamId)} findes ikke. Opret det via bootstrap-knappen.`
      : `Team ${getDisplayTeamId(resolvedTeamId)} findes ikke.`
    throw new MembershipMissingError(resolvedTeamId, user.uid, message)
  }
  if (access.status === TEAM_ACCESS_STATUS.NO_ACCESS) {
    const reason = access?.reason || access?.error?.code || ''
    const fallback = `Ingen adgang til team ${getDisplayTeamId(resolvedTeamId)}. Kontakt admin.`
    if (reason === 'inactive') throw new MembershipMissingError(resolvedTeamId, user.uid, 'Medlemmet er deaktiveret.')
    if (reason === 'not-assigned') throw new MembershipMissingError(resolvedTeamId, user.uid, 'Du er ikke tildelt dette team. Kontakt admin.')
    throw new MembershipMissingError(resolvedTeamId, user.uid, fallback)
  }
  throw new PermissionDeniedError(access?.error?.message || 'Kunne ikke kontrollere team-adgang.')
}

export async function getTeamMembership(teamId, { allowBootstrap = false } = {}) {
  const user = await ensureAuthUser()
  const resolvedTeamId = formatTeamId(teamId || resolveTeamId(teamId))
  const access = await guardTeamAccess(resolvedTeamId, user, { allowBootstrap })
  if (access?.membership) {
    cacheTeamResolution(user.uid, resolvedTeamId, access.membership)
    return { ...access.membership, teamId: resolvedTeamId, role: access.role, invite: access.invite || null }
  }
  throw new MembershipMissingError(resolvedTeamId, user.uid, 'Medlem ikke fundet for valgt team.')
}

async function getTeamContext(teamId, { allowBootstrap = false, requireAdmin = false } = {}) {
  const user = await ensureAuthUser()
  const resolvedTeamId = formatTeamId(teamId || resolveTeamId(teamId))
  const access = await guardTeamAccess(resolvedTeamId, user, { allowBootstrap })
  if (!access?.membership) throw new PermissionDeniedError('Du er ikke medlem af dette team.')
  if (requireAdmin && access.role !== 'admin' && access.role !== 'owner') {
    throw new PermissionDeniedError('Kun admin kan udføre denne handling.')
  }
  cacheTeamResolution(user.uid, resolvedTeamId, access.membership)
  return { teamId: resolvedTeamId, membership: access.membership, actor: normalizeActor(user, access.membership), role: access.role, invite: access.invite }
}

export async function getTeamDocument(teamId) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId)
  const response = await apiJson(`/api/teams/${resolvedTeamId}/access`)
  if (response?.team) {
    return {
      id: response.team.id || resolvedTeamId,
      teamId: resolvedTeamId,
      name: response.team.name || getDisplayTeamId(resolvedTeamId),
    }
  }
  return {
    id: resolvedTeamId,
    teamId: resolvedTeamId,
    name: getDisplayTeamId(resolvedTeamId),
  }
}

export async function publishSharedCase({ teamId, jobNumber, caseKind, system, totals, status = 'kladde', jsonContent }) {
  const { teamId: resolvedTeamId, membership, actor } = await getTeamContext(teamId, { allowBootstrap: true })
  const payload = await apiJson(`/api/teams/${resolvedTeamId}/cases`, {
    method: 'POST',
    body: JSON.stringify({
      jobNumber: normalizeJobNumber(jobNumber),
      caseKind,
      system,
      totals: totals || { materials: 0, montage: 0, demontage: 0, total: 0 },
      status,
      jsonContent,
      createdByName: actor.name || actor.displayName || '',
      actorRole: membership?.role || null,
    }),
  })
  return payload
}

export async function listSharedGroups(teamId) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId)
  const cases = await apiJson(`/api/teams/${resolvedTeamId}/cases`)
  const groups = new Map()
  ;(cases || []).forEach(entry => {
    const jobNumber = normalizeJobNumber(entry.jobNumber)
    const existing = groups.get(jobNumber) || { jobNumber, cases: [], lastUpdatedAt: entry.lastUpdatedAt }
    existing.cases.push({ ...entry, jobNumber })
    const timestamp = entry.lastUpdatedAt || entry.createdAt || ''
    if (!existing.lastUpdatedAt || timestamp.localeCompare(existing.lastUpdatedAt) > 0) {
      existing.lastUpdatedAt = timestamp
    }
    groups.set(jobNumber, existing)
  })

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      cases: group.cases.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    }))
    .sort((a, b) => (b.lastUpdatedAt || '').localeCompare(a.lastUpdatedAt || ''))
}

export async function getSharedCase(teamId, caseId) {
  try {
    const { teamId: resolvedTeamId } = await getTeamContext(teamId)
    return await apiJson(`/api/teams/${resolvedTeamId}/cases/${caseId}`)
  } catch (error) {
    console.warn('Kunne ikke hente sag', error)
    if (error?.code === 'permission-denied') throw error
    return null
  }
}

export async function deleteSharedCase(teamId, caseId) {
  const entry = await getSharedCase(teamId, caseId)
  if (!entry) return false
  const { teamId: resolvedTeamId } = await getTeamContext(teamId)
  await apiJson(`/api/teams/${resolvedTeamId}/cases/${caseId}`, { method: 'DELETE' })
  return true
}

export async function updateCaseStatus(teamId, caseId, status) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId)
  return await apiJson(`/api/teams/${resolvedTeamId}/cases/${caseId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export async function downloadCaseJson(teamId, caseId) {
  const entry = await getSharedCase(teamId, caseId)
  const content = entry?.attachments?.json?.data
  if (!content) return null
  const blob = new Blob([content], { type: 'application/json' })
  return { blob, fileName: `${entry.jobNumber || 'akkord'}-${entry.caseId}.json` }
}

export async function importCasePayload(teamId, caseId) {
  const entry = await getSharedCase(teamId, caseId)
  const content = entry?.attachments?.json?.data
  if (!content) return null
  return content
}

export async function exportSharedBackup(teamId) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId, { requireAdmin: true })
  return await apiJson(`/api/teams/${resolvedTeamId}/backup`)
}

export function validateBackupSchema(payload) {
  if (!payload || ![BACKUP_SCHEMA_VERSION, 1].includes(payload.schemaVersion)) {
    throw new Error('Ukendt backup-format')
  }
  return payload
}

export async function importSharedBackup(teamId, payload) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId, { requireAdmin: true })
  const validated = validateBackupSchema(payload)
  await apiJson(`/api/teams/${resolvedTeamId}/backup`, {
    method: 'POST',
    body: JSON.stringify(validated),
  })
  return true
}

export async function listTeamInvites(teamId) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId, { requireAdmin: true })
  return await apiJson(`/api/teams/${resolvedTeamId}/invites`)
}

export async function saveTeamInvite(teamId, invite) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId, { requireAdmin: true })
  const payload = await apiJson(`/api/teams/${resolvedTeamId}/invites`, {
    method: 'POST',
    body: JSON.stringify({ email: invite.email || '', role: invite.role || 'member' }),
  })
  return payload
}

export async function revokeTeamInvite(inviteId) {
  if (!inviteId) throw new PermissionDeniedError('Invite-id mangler')
  await apiJson(`/api/invites/${inviteId}/revoke`, { method: 'POST' })
  return true
}

export async function listTeamMembers(teamId) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId)
  return await apiJson(`/api/teams/${resolvedTeamId}/members`)
}

export async function saveTeamMember(teamId, member) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId, { requireAdmin: true })
  await apiJson(`/api/teams/${resolvedTeamId}/members/${member.uid || member.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: member.role, status: member.active === false ? 'disabled' : 'active' }),
  })
  return true
}

export async function removeTeamMember(teamId, memberId) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId, { requireAdmin: true })
  await apiJson(`/api/teams/${resolvedTeamId}/members/${memberId}`, { method: 'DELETE' })
  return true
}

export async function setMemberActive(teamId, memberId, active) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId, { requireAdmin: true })
  await apiJson(`/api/teams/${resolvedTeamId}/members/${memberId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: active ? 'active' : 'disabled' }),
  })
  return true
}

export async function addTeamMemberByUid(teamId, uid, role = 'member') {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId, { requireAdmin: true })
  await apiJson(`/api/teams/${resolvedTeamId}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId: uid, role }),
  })
  return true
}

export async function addTeamMemberByEmail(teamId, emailInput, role = 'member') {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId, { requireAdmin: true })
  const email = normalizeEmail(emailInput)
  if (!email) throw new PermissionDeniedError('Email mangler')
  await apiJson(`/api/teams/${resolvedTeamId}/members`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  })
  return true
}

export {
  PermissionDeniedError,
  MembershipMissingError,
  InviteMissingError,
  InactiveMemberError,
  DEFAULT_TEAM_ID,
  DEFAULT_TEAM_SLUG,
  TEAM_STORAGE_KEY,
  getStoredTeamId,
  persistTeamId,
  guardTeamAccess,
  formatTeamId,
  normalizeTeamId,
  getDisplayTeamId,
  resolvePreferredTeamId,
  buildMemberDocPath,
}
