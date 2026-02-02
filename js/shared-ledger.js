import { getAuthContext, waitForAuthReady } from './shared-auth.js'
import { apiJson } from '../src/api/client.js'
import { updateTeamDebugState } from '../src/state/debug.js'
import { sha256Hex } from '../src/lib/sha256.js'
import { getDeployContext, getPreviewWriteDisabledMessage } from '../src/lib/deploy-context.js'
import { debugLog as debugRuntimeLog, debugMeasure as debugRuntimeMeasure } from '../src/lib/debug.js'
import { isDebugOverlayEnabled } from '../src/state/debug.js'
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
const SHARED_CASES_QUEUE_KEY = 'cssmate:shared-cases:queue:v1'
const SHARED_CASES_QUEUE_MAX = 30
const SHARED_CASE_CONTEXT_KEY = 'cssmate:shared-case:context:v1'

const CASE_ID_NAMESPACE = 'cssmate:shared-case'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WORKFLOW_STATUS = {
  DRAFT: 'kladde',
  APPROVED: 'godkendt',
  DEMONTAGE: 'demontage_i_gang',
  DONE: 'afsluttet',
  DELETED: 'deleted',
}

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
    this.expectedPath = teamId && uid ? buildMemberDocPath(teamId, uid) : ''
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

let queueListenerBound = false
let queueFlushInFlight = false
let sharedCaseContext = null

function debugLog (label, details = {}) {
  if (!isDebugOverlayEnabled()) return
  const safeDetails = details && typeof details === 'object'
    ? Object.fromEntries(Object.entries(details).filter(([key]) => !/token|secret|password/i.test(key)))
    : details
  try {
    console.info(`[shared-ledger] ${label}`, safeDetails)
  } catch {}
}

function createPreviewDisabledError (action, context) {
  const error = new Error(getPreviewWriteDisabledMessage())
  error.code = 'preview-disabled'
  error.status = 403
  error.action = action
  error.context = context?.context || ''
  return error
}

function ensureWritesAllowed (action) {
  const context = getDeployContext()
  const allowed = context.writesAllowed
  debugLog('writes-check', {
    action,
    allowed,
    context: context.context,
    hostname: context.hostname,
    isPreview: context.isPreview,
  })
  if (allowed) return context
  const error = createPreviewDisabledError(action, context)
  debugLog('writes-blocked', { action, context: context.context, hostname: context.hostname })
  throw error
}

function normalizeSharedCaseContext(value) {
  if (!value || typeof value !== 'object') return null
  const caseId = value.caseId || ''
  if (!caseId) return null
  const phase = value.phase === 'demontage' ? 'demontage' : 'montage'
  return {
    caseId,
    phase,
    status: value.status || '',
    updatedAt: value.updatedAt || '',
  }
}

function readSharedCaseContext() {
  if (sharedCaseContext) return sharedCaseContext
  if (typeof window === 'undefined' || !window.sessionStorage) return null
  try {
    const raw = window.sessionStorage.getItem(SHARED_CASE_CONTEXT_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    sharedCaseContext = normalizeSharedCaseContext(parsed)
    return sharedCaseContext
  } catch {
    return null
  }
}

function writeSharedCaseContext(context) {
  sharedCaseContext = normalizeSharedCaseContext(context)
  if (typeof window === 'undefined' || !window.sessionStorage) return
  try {
    if (sharedCaseContext) {
      window.sessionStorage.setItem(SHARED_CASE_CONTEXT_KEY, JSON.stringify(sharedCaseContext))
    } else {
      window.sessionStorage.removeItem(SHARED_CASE_CONTEXT_KEY)
    }
  } catch {
    // ignore storage errors
  }
}

export function setSharedCaseContext(context) {
  writeSharedCaseContext(context)
}

export function getSharedCaseContext() {
  return readSharedCaseContext()
}

export function clearSharedCaseContext() {
  writeSharedCaseContext(null)
}

function dispatchSharedEvent (detail = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  const payload = {
    timestamp: Date.now(),
    ...detail,
  }
  window.dispatchEvent(new CustomEvent('cssmate:exported', { detail: payload }))
}

function readQueueStorage () {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(SHARED_CASES_QUEUE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueueStorage (entries) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(SHARED_CASES_QUEUE_KEY, JSON.stringify(entries))
  } catch {
    // ignore storage errors
  }
}

function isOnline () {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

function normalizeQueuedEntry (entry) {
  if (!entry || !entry.caseId) return null
  const operationType = entry.operationType || 'publish'
  return {
    operationType,
    caseId: entry.caseId,
    teamId: entry.teamId,
    jobNumber: entry.jobNumber || 'UKENDT',
    caseKind: entry.caseKind || '',
    system: entry.system || '',
    totals: entry.totals || { materials: 0, montage: 0, demontage: 0, total: 0 },
    status: entry.status || 'kladde',
    jsonContent: entry.jsonContent || '',
    phase: normalizePhase(entry.phase || entry.phaseHint || entry.caseKind),
    ifMatchUpdatedAt: entry.ifMatchUpdatedAt || '',
    createdByName: entry.createdByName || '',
    actorRole: entry.actorRole || null,
    queuedAt: entry.queuedAt || Date.now(),
    retries: entry.retries || 0,
  }
}

function upsertQueueEntry (entry) {
  const normalized = normalizeQueuedEntry(entry)
  if (!normalized) return
  const current = readQueueStorage()
  const index = current.findIndex(item => item?.caseId === normalized.caseId && item?.operationType === normalized.operationType)
  if (index >= 0) {
    current[index] = { ...current[index], ...normalized, queuedAt: current[index].queuedAt || normalized.queuedAt }
  } else {
    current.unshift(normalized)
  }
  if (current.length > SHARED_CASES_QUEUE_MAX) {
    current.length = SHARED_CASES_QUEUE_MAX
  }
  writeQueueStorage(current)
}

function removeQueueEntry (caseId, operationType = '') {
  if (!caseId) return
  const current = readQueueStorage().filter(item => {
    if (item?.caseId !== caseId) return true
    if (!operationType) return false
    return item?.operationType !== operationType
  })
  writeQueueStorage(current)
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

function normalizePhase(value) {
  const normalized = (value || '').toString().trim().toLowerCase()
  if (normalized === 'demontage') return 'demontage'
  return 'montage'
}

function normalizeStatusValue(value) {
  const normalized = (value || '').toString().trim().toLowerCase()
  if (!normalized) return ''
  if (normalized === 'draft') return WORKFLOW_STATUS.DRAFT
  if (normalized === 'ready_for_demontage') return WORKFLOW_STATUS.APPROVED
  if (normalized === 'completed') return WORKFLOW_STATUS.DONE
  if (normalized === 'klar_til_deling' || normalized === 'klar') return WORKFLOW_STATUS.DRAFT
  if (normalized === 'klar_til_demontage' || normalized === 'ready') return WORKFLOW_STATUS.APPROVED
  return normalized
}

function normalizeStoredPhase(value, status = '') {
  const normalized = (value || '').toString().trim().toLowerCase()
  if (normalized === 'demontage') return 'demontage'
  if (normalized === 'montage') return 'montage'
  if (normalized === 'draft' || normalized === 'ready_for_demontage') return 'montage'
  if (normalized === 'completed') return 'demontage'
  const statusValue = normalizeStatusValue(status)
  if ([WORKFLOW_STATUS.DEMONTAGE, WORKFLOW_STATUS.DONE].includes(statusValue)) return 'demontage'
  return 'montage'
}

function mapTeamCaseRow(row) {
  if (!row || typeof row !== 'object') return null
  const caseId = row.caseId || row.case_id || row.id || ''
  if (!caseId) return null
  const teamId = row.teamId || row.team_id || row.team_slug || row.team || ''
  const status = normalizeStatusValue(row.status || '')
  const caseKind = row.caseKind || row.case_kind || ''
  const storedPhase = normalizeStoredPhase(row.phase || row.sheetPhase || row.phaseHint || caseKind, status)
  const sheetPhase = normalizePhase(row.sheetPhase || row.phaseHint || storedPhase || caseKind)
  return {
    ...row,
    id: caseId,
    caseId,
    teamId,
    caseKind,
    status: status || row.status || '',
    phase: storedPhase,
    sheetPhase,
  }
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

function isValidUuid (value) {
  return UUID_PATTERN.test((value || '').toString())
}

function formatUuidFromHex (hex) {
  const cleaned = (hex || '').toString().replace(/[^a-f0-9]/gi, '').padEnd(32, '0').slice(0, 32)
  return `${cleaned.slice(0, 8)}-${cleaned.slice(8, 12)}-${cleaned.slice(12, 16)}-${cleaned.slice(16, 20)}-${cleaned.slice(20, 32)}`.toLowerCase()
}

async function buildStableCaseId ({ teamId, jobNumber, phase, jsonContent }) {
  const normalizedJob = normalizeJobNumber(jobNumber)
  const normalizedPhase = normalizePhase(phase)
  const base = normalizedJob && normalizedJob !== 'UKENDT'
    ? `${CASE_ID_NAMESPACE}|team:${teamId}|job:${normalizedJob}|phase:${normalizedPhase}`
    : `${CASE_ID_NAMESPACE}|team:${teamId}|phase:${normalizedPhase}`
  const payload = jsonContent
    ? `${base}|payload:${jsonContent}`
    : base
  const hex = await sha256Hex(payload)
  return formatUuidFromHex(hex)
}

export function resolveTeamId(rawTeamId) {
  const provided = rawTeamId || (typeof window !== 'undefined' ? window.TEAM_ID : null)
  if (provided) return formatTeamId(provided)
  const cached = getCachedTeam(getAuthContext()?.user?.uid || null)
  if (cached?.teamId) return cached.teamId
  return resolvePreferredTeamId(provided)
}

async function guardTeamAccess(teamIdInput, user) {
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
      email: (user.email || '').toLowerCase(),
      emailLower: (user.email || '').toLowerCase(),
      role: access.role || (access.owner ? 'owner' : 'member'),
      active: access.active !== false,
      assigned: access.assigned !== false,
    }
    const normalizedMembership = {
      ...baseMember,
      uid: baseMember.uid || user.uid,
      teamId: access.teamId || resolvedTeamId,
      email: baseMember.email || (user.email || '').toLowerCase(),
      emailLower: (baseMember.emailLower || baseMember.email || user.email || '').toLowerCase(),
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
    throw new MembershipMissingError(resolvedTeamId, user.uid, `Team ${getDisplayTeamId(resolvedTeamId)} findes ikke.`)
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

export async function getTeamMembership(teamId) {
  const user = await ensureAuthUser()
  const resolvedTeamId = formatTeamId(teamId || resolveTeamId(teamId))
  const access = await guardTeamAccess(resolvedTeamId, user)
  if (access?.membership) {
    cacheTeamResolution(user.uid, resolvedTeamId, access.membership)
    return { ...access.membership, teamId: resolvedTeamId, role: access.role, invite: access.invite || null }
  }
  throw new MembershipMissingError(resolvedTeamId, user.uid, 'Medlem ikke fundet for valgt team.')
}

async function getTeamContext(teamId, { requireAdmin = false } = {}) {
  const user = await ensureAuthUser()
  const resolvedTeamId = formatTeamId(teamId || resolveTeamId(teamId))
  const access = await guardTeamAccess(resolvedTeamId, user)
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

export async function publishSharedCase({
  teamId,
  jobNumber,
  caseKind,
  system,
  totals,
  status = 'kladde',
  jsonContent,
  phaseHint,
  phase,
  caseId: explicitCaseId,
  ifMatchUpdatedAt,
}) {
  ensureWritesAllowed('publishSharedCase')
  const { teamId: resolvedTeamId, membership, actor } = await getTeamContext(teamId)
  const normalizedJobNumber = normalizeJobNumber(jobNumber)
  const resolvedPhase = normalizePhase(phase || phaseHint || caseKind)
  const caseId = isValidUuid(explicitCaseId)
    ? explicitCaseId
    : await buildStableCaseId({ teamId: resolvedTeamId, jobNumber: normalizedJobNumber, phase: resolvedPhase, jsonContent })
  const requestPayload = {
    caseId,
    jobNumber: normalizedJobNumber,
    caseKind,
    system,
    totals: totals || { materials: 0, montage: 0, demontage: 0, total: 0 },
    status,
    jsonContent,
    phaseHint: resolvedPhase,
    phase: resolvedPhase,
    ifMatchUpdatedAt,
    createdByName: actor.name || actor.displayName || '',
    actorRole: membership?.role || null,
  }
  if (!isOnline()) {
    upsertQueueEntry({ ...requestPayload, teamId: resolvedTeamId, operationType: 'publish' })
    debugRuntimeLog('shared-case queued (offline)', { caseId, teamId: resolvedTeamId })
    return { queued: true, caseId }
  }
  try {
    const payload = await debugRuntimeMeasure(`shared-case publish ${resolvedTeamId}`, () => apiJson(`/api/teams/${resolvedTeamId}/cases`, {
      method: 'POST',
      body: JSON.stringify(requestPayload),
    }))
    const mapped = mapTeamCaseRow(payload)
    if (mapped) {
      dispatchSharedEvent({ type: 'case-updated', case: mapped })
    }
    removeQueueEntry(caseId, 'publish')
    debugRuntimeLog('shared-case published', { caseId: mapped?.caseId || caseId, teamId: resolvedTeamId })
    return { ...(mapped || payload), queued: false, caseId: mapped?.caseId || payload?.caseId || caseId }
  } catch (error) {
    const isNetworkError = error instanceof TypeError || /network|offline|failed to fetch/i.test(error?.message || '')
    if (isNetworkError) {
      upsertQueueEntry({ ...requestPayload, teamId: resolvedTeamId, operationType: 'publish' })
      return { queued: true, caseId }
    }
    throw error
  }
}

async function publishQueuedEntry (entry) {
  const normalized = normalizeQueuedEntry(entry)
  if (!normalized) return false
  if (normalized.operationType !== 'publish') return false
  ensureWritesAllowed('publishQueuedEntry')
  const { teamId: resolvedTeamId } = await getTeamContext(normalized.teamId)
  const payload = {
    caseId: isValidUuid(normalized.caseId) ? normalized.caseId : await buildStableCaseId({
      teamId: resolvedTeamId,
      jobNumber: normalized.jobNumber,
      phase: normalized.phase,
      jsonContent: normalized.jsonContent,
    }),
    jobNumber: normalized.jobNumber,
    caseKind: normalized.caseKind,
    system: normalized.system,
    totals: normalized.totals,
    status: normalized.status,
    jsonContent: normalized.jsonContent,
    phaseHint: normalized.phase,
    phase: normalized.phase,
    ifMatchUpdatedAt: normalized.ifMatchUpdatedAt,
    createdByName: normalized.createdByName || '',
    actorRole: normalized.actorRole || null,
  }
  await apiJson(`/api/teams/${resolvedTeamId}/cases`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return true
}

async function updateQueuedStatus (entry) {
  const normalized = normalizeQueuedEntry(entry)
  if (!normalized) return false
  if (normalized.operationType !== 'status-update') return false
  ensureWritesAllowed('updateQueuedStatus')
  const { teamId: resolvedTeamId } = await getTeamContext(normalized.teamId)
  const payload = {
    status: normalized.status,
    ifMatchUpdatedAt: normalized.ifMatchUpdatedAt,
    phase: normalized.phase,
  }
  const result = await apiJson(`/api/teams/${resolvedTeamId}/cases/${normalized.caseId}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  const mapped = mapTeamCaseRow(result)
  if (mapped) {
    dispatchSharedEvent({ type: 'case-updated', case: mapped })
  }
  return true
}

export async function updateSharedCaseStatus(teamId, caseId, { status, ifMatchUpdatedAt, phase } = {}) {
  ensureWritesAllowed('updateSharedCaseStatus')
  const { teamId: resolvedTeamId } = await getTeamContext(teamId)
  const payload = {
    status,
    ifMatchUpdatedAt,
    phase,
  }
  if (!isOnline()) {
    upsertQueueEntry({ operationType: 'status-update', caseId, teamId: resolvedTeamId, ...payload })
    return { queued: true, caseId, status }
  }
  try {
    const result = await apiJson(`/api/teams/${resolvedTeamId}/cases/${caseId}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    const mapped = mapTeamCaseRow(result)
    if (mapped) {
      dispatchSharedEvent({ type: 'case-updated', case: mapped })
    }
    removeQueueEntry(caseId, 'status-update')
    return { ...(mapped || result), queued: false }
  } catch (error) {
    const isNetworkError = error instanceof TypeError || /network|offline|failed to fetch/i.test(error?.message || '')
    if (isNetworkError) {
      upsertQueueEntry({ operationType: 'status-update', caseId, teamId: resolvedTeamId, ...payload })
      return { queued: true, caseId, status }
    }
    throw error
  }
}

export async function flushSharedCasesQueue () {
  if (queueFlushInFlight) return { flushed: 0, pending: readQueueStorage().length }
  if (!isOnline()) return { flushed: 0, pending: readQueueStorage().length }
  queueFlushInFlight = true
  const queue = readQueueStorage()
  let flushed = 0
  const remaining = []
  for (const entry of queue) {
    try {
      const normalized = normalizeQueuedEntry(entry)
      const handled = normalized?.operationType === 'status-update'
        ? await updateQueuedStatus(entry)
        : await publishQueuedEntry(entry)
      if (!handled) {
        remaining.push(entry)
        continue
      }
      flushed += 1
    } catch (error) {
      if (error?.code === 'preview-disabled') {
        remaining.push(entry)
        break
      }
      if (error?.status === 409) {
        continue
      }
      const isNetworkError = error instanceof TypeError || /network|offline|failed to fetch/i.test(error?.message || '')
      const updated = { ...entry, retries: (entry?.retries || 0) + 1 }
      remaining.push(updated)
      if (isNetworkError) break
    }
  }
  writeQueueStorage(remaining)
  queueFlushInFlight = false
  if (flushed > 0) {
    dispatchSharedEvent({ type: 'shared-sync', flushed, pending: remaining.length })
  }
  return { flushed, pending: remaining.length }
}

function bindQueueListeners () {
  if (queueListenerBound || typeof window === 'undefined') return
  queueListenerBound = true
  window.addEventListener('online', () => {
    flushSharedCasesQueue().catch(() => {})
  })
  if (isOnline()) {
    flushSharedCasesQueue().catch(() => {})
  }
}

bindQueueListeners()

export async function listSharedGroups(teamId, opts = {}) {
  const page = await listSharedCasesPage(teamId, { ...opts, cursor: null })
  const cases = page?.items || []
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

function encodeCursorPayload(cursor) {
  if (!cursor) return ''
  const payload = typeof cursor === 'string' ? cursor : JSON.stringify(cursor)
  if (!payload) return ''
  if (typeof btoa === 'function') {
    const encoded = btoa(unescape(encodeURIComponent(payload)))
    return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(payload, 'utf8').toString('base64url')
  }
  return ''
}

function normalizeCasesPage(payload) {
  if (Array.isArray(payload)) {
    return { items: payload.map(mapTeamCaseRow).filter(Boolean), nextCursor: null, hasMore: false, total: null }
  }
  if (payload && Array.isArray(payload.data)) {
    return {
      items: payload.data.map(mapTeamCaseRow).filter(Boolean),
      nextCursor: payload.cursor || null,
      hasMore: Boolean(payload.hasMore),
      total: Number.isFinite(payload.total) ? payload.total : null,
    }
  }
  if (payload && Array.isArray(payload.items)) {
    return {
      items: payload.items.map(mapTeamCaseRow).filter(Boolean),
      nextCursor: payload.nextCursor || payload.cursor || null,
      hasMore: Boolean(payload.hasMore),
      total: Number.isFinite(payload.total) ? payload.total : null,
    }
  }
  return { items: [], nextCursor: null, hasMore: false, total: null }
}

function normalizeCasesDelta(payload, since = '') {
  const base = normalizeCasesPage(payload)
  return {
    ...base,
    mode: payload?.mode || 'delta',
    serverNow: payload?.serverNow || null,
    maxUpdatedAt: payload?.maxUpdatedAt || since || null,
    cursor: payload?.cursor || null,
    deleted: Array.isArray(payload?.deleted) ? payload.deleted : [],
  }
}

export async function listSharedCasesPage(teamId, { limit = 100, cursor = null, status = '', q = '', from = '', to = '', includeDeleted = false } = {}) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId)
  const params = new URLSearchParams()
  if (limit) params.set('limit', String(limit))
  if (cursor) {
    const encoded = encodeCursorPayload(cursor)
    if (encoded) params.set('cursor', encoded)
  }
  if (status) params.set('status', status)
  if (q) params.set('q', q)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (includeDeleted) params.set('includeDeleted', '1')
  const query = params.toString()
  const payload = await debugRuntimeMeasure(`shared-cases list ${resolvedTeamId}`, () => apiJson(`/api/teams/${resolvedTeamId}/cases${query ? `?${query}` : ''}`))
  const normalized = normalizeCasesPage(payload)
  debugRuntimeLog('shared-cases list result', { teamId: resolvedTeamId, count: normalized.items.length, hasNext: Boolean(normalized.nextCursor) })
  return normalized
}

export async function listSharedCasesDelta(teamId, { since = '', sinceId = '', limit = 200 } = {}) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId)
  const params = new URLSearchParams()
  if (limit) params.set('limit', String(limit))
  if (since) params.set('since', since)
  if (sinceId) params.set('sinceId', sinceId)
  const query = params.toString()
  const payload = await debugRuntimeMeasure(`shared-cases delta ${resolvedTeamId}`, () => apiJson(`/api/teams/${resolvedTeamId}/cases${query ? `?${query}` : ''}`))
  const normalized = normalizeCasesDelta(payload, since)
  debugRuntimeLog('shared-cases delta result', {
    teamId: resolvedTeamId,
    count: normalized.items.length,
    deleted: normalized.deleted?.length || 0,
    maxUpdatedAt: normalized.maxUpdatedAt,
  })
  return normalized
}

export async function listSharedCasesFirstPage(teamId, opts = {}) {
  return listSharedCasesPage(teamId, { ...opts, cursor: null })
}

export async function getSharedCase(teamId, caseId) {
  try {
    const { teamId: resolvedTeamId } = await getTeamContext(teamId)
    const payload = await apiJson(`/api/teams/${resolvedTeamId}/cases/${caseId}`)
    return mapTeamCaseRow(payload)
  } catch (error) {
    console.warn('Kunne ikke hente sag', error)
    if (error?.code === 'permission-denied') throw error
    return null
  }
}

export async function deleteSharedCase(teamId, caseId) {
  ensureWritesAllowed('deleteSharedCase')
  const entry = await getSharedCase(teamId, caseId)
  if (!entry) return false
  const { teamId: resolvedTeamId } = await getTeamContext(teamId)
  await apiJson(`/api/teams/${resolvedTeamId}/cases/${caseId}`, { method: 'DELETE' })
  return true
}

export async function approveSharedCase(teamId, caseId, { ifMatchUpdatedAt } = {}) {
  ensureWritesAllowed('approveSharedCase')
  const { teamId: resolvedTeamId } = await getTeamContext(teamId)
  return await apiJson(`/api/teams/${resolvedTeamId}/cases/${caseId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ ifMatchUpdatedAt }),
  })
}

export async function purgeSharedCases(teamId) {
  ensureWritesAllowed('purgeSharedCases')
  const { teamId: resolvedTeamId } = await getTeamContext(teamId, { requireAdmin: true })
  return await apiJson(`/api/admin/teams/${resolvedTeamId}/purge`, {
    method: 'POST',
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

export async function exportSharedBackup(teamId, { includeDeleted = false } = {}) {
  ensureWritesAllowed('exportSharedBackup')
  const { teamId: resolvedTeamId } = await getTeamContext(teamId, { requireAdmin: true })
  const params = new URLSearchParams()
  if (includeDeleted) params.set('includeDeleted', '1')
  const query = params.toString()
  return await apiJson(`/api/teams/${resolvedTeamId}/backup${query ? `?${query}` : ''}`)
}

export function validateBackupSchema(payload) {
  if (!payload || ![BACKUP_SCHEMA_VERSION, 1].includes(payload.schemaVersion)) {
    throw new Error('Ukendt backup-format')
  }
  return payload
}

export async function importSharedBackup(teamId, payload) {
  ensureWritesAllowed('importSharedBackup')
  const { teamId: resolvedTeamId } = await getTeamContext(teamId, { requireAdmin: true })
  const validated = validateBackupSchema(payload)
  await apiJson(`/api/teams/${resolvedTeamId}/backup`, {
    method: 'POST',
    body: JSON.stringify(validated),
  })
  return true
}

export async function listTeamMembers(teamId) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId)
  const payload = await debugRuntimeMeasure(`team members ${resolvedTeamId}`, () => apiJson(`/api/teams/${resolvedTeamId}/members`))
  const count = Array.isArray(payload) ? payload.length : 0
  debugRuntimeLog('team members result', { teamId: resolvedTeamId, count })
  return payload
}

export const getCases = listSharedCasesPage
export const getCasesDelta = listSharedCasesDelta
export const createOrUpdateCase = publishSharedCase
export const updateCaseStatus = updateSharedCaseStatus
export const approveCase = approveSharedCase
export const deleteCase = deleteSharedCase
export const purgeCases = purgeSharedCases

export {
  PermissionDeniedError,
  MembershipMissingError,
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

export const __ledgerVersion = LEDGER_VERSION
export const __test = {
  mapTeamCaseRow,
  normalizeStatusValue,
  WORKFLOW_STATUS,
}
