import { getAuthContext, waitForAuthReady } from './shared-auth.js';
import { getFirestoreDb, getFirestoreHelpers, toIsoString } from './shared-firestore.js';
import { normalizeEmail } from '../src/auth/roles.js';
import { updateTeamDebugState } from '../src/state/debug.js';
import {
  DEFAULT_TEAM_ID,
  DEFAULT_TEAM_SLUG,
  TEAM_STORAGE_KEY,
  formatTeamId,
  getDisplayTeamId,
  getStoredTeamId,
  isBootstrapAdminEmail,
  normalizeTeamId,
  persistTeamId,
  resolvePreferredTeamId,
} from '../src/services/team-ids.js';
import {
  createTeamInvite,
  ensureUserDoc,
  upsertUserTeamRoleCache,
  buildMemberDocPath,
} from '../src/services/teams.js';
import { getTeamAccessWithTimeout, TEAM_ACCESS_STATUS } from '../src/services/team-access.js';

const LEDGER_VERSION = 1;
const BACKUP_SCHEMA_VERSION = 2;

class PermissionDeniedError extends Error {
  constructor(message) {
    super(message);
    this.code = 'permission-denied';
  }
}

class MembershipMissingError extends PermissionDeniedError {
  constructor(teamId, uid, message) {
    super(message || 'Du er ikke medlem af dette team.');
    this.code = 'not-member';
    this.teamId = teamId;
    this.uid = uid;
    this.expectedPath = teamId && uid ? `teams/${teamId}/members/${uid}` : '';
  }
}

class InviteMissingError extends PermissionDeniedError {
  constructor(teamId, email, message) {
    super(message || 'Ingen aktiv invitation fundet.');
    this.code = 'invite-missing';
    this.teamId = teamId;
    this.email = email;
  }
}

class InactiveMemberError extends PermissionDeniedError {
  constructor(teamId, uid, message) {
    super(message || 'Medlemmet er deaktiveret.');
    this.code = 'member-inactive';
    this.teamId = teamId;
    this.uid = uid;
  }
}

const teamCache = {
  uid: null,
  teamId: null,
  membership: null,
};

async function ensureAuthUser() {
  await waitForAuthReady();
  const auth = getAuthContext();
  if (!auth?.isAuthenticated || !auth.user?.uid) {
    throw new PermissionDeniedError('Log ind for at fortsætte.');
  }
  return auth.user;
}

function getTeamRef(sdk, db, teamId) {
  return sdk.doc(db, 'teams', teamId);
}

function getMemberRef(sdk, db, teamId, uid) {
  return sdk.doc(db, 'teams', teamId, 'members', uid);
}

async function guardTeamAccess(teamIdInput, user, { allowBootstrap = false } = {}) {
  if (!user?.uid) throw new PermissionDeniedError('Log ind for at fortsætte.');
  const emailLower = normalizeEmail(user.email);
  const preferredTeam = normalizeTeamId(teamIdInput || getStoredTeamId() || DEFAULT_TEAM_SLUG);
  const resolvedTeamId = formatTeamId(preferredTeam);
  const membershipPath = buildMemberDocPath(resolvedTeamId, user.uid);
  const canBootstrap = allowBootstrap && isBootstrapAdminEmail(emailLower);
  await ensureUserDoc(user);
  const access = await getTeamAccessWithTimeout({ teamId: resolvedTeamId, user, source: 'shared-ledger:guard' });
  const membershipStatus = access.status === TEAM_ACCESS_STATUS.OK
    ? 'member'
    : access.status === TEAM_ACCESS_STATUS.NO_TEAM || access.status === TEAM_ACCESS_STATUS.NEED_CREATE
      ? 'missing_team'
      : access.status === TEAM_ACCESS_STATUS.NO_AUTH
        ? 'no_auth'
        : 'not_member';
  updateTeamDebugState({
    teamId: access.teamId || resolvedTeamId,
    member: access.memberDoc || null,
    teamResolved: access.status === TEAM_ACCESS_STATUS.OK || access.status === TEAM_ACCESS_STATUS.NO_ACCESS,
    membershipStatus,
    membershipCheckPath: membershipPath,
    memberAssigned: typeof access.assigned === 'boolean' ? access.assigned : access?.memberDoc?.assigned,
  });
  if (access.status === TEAM_ACCESS_STATUS.OK) {
    const baseMember = access.memberDoc || {
      uid: user.uid,
      teamId: access.teamId || resolvedTeamId,
      email: normalizeEmail(user.email),
      emailLower: normalizeEmail(user.email),
      role: access.role || (access.owner ? 'owner' : 'member'),
      active: access.active !== false,
      assigned: access.assigned !== false,
    };
    const normalizedMembership = {
      ...baseMember,
      uid: baseMember.uid || user.uid,
      teamId: access.teamId || resolvedTeamId,
      email: baseMember.email || normalizeEmail(user.email),
      emailLower: normalizeEmail(baseMember.emailLower || baseMember.email || user.email),
      role: baseMember.role === 'owner' ? 'owner' : (baseMember.role === 'admin' ? 'admin' : 'member'),
      active: baseMember.active !== false,
      assigned: baseMember.assigned !== false,
    };
    const accessRole = normalizedMembership.role === 'admin' || normalizedMembership.role === 'owner' ? normalizedMembership.role : 'member';
    cacheTeamResolution(user.uid, normalizedMembership.teamId, normalizedMembership);
    persistTeamId(normalizeTeamId(normalizedMembership.teamId));
    return { teamId: normalizedMembership.teamId, membership: normalizedMembership, invite: null, role: accessRole };
  }
  if (access.status === TEAM_ACCESS_STATUS.NO_TEAM || access.status === TEAM_ACCESS_STATUS.NEED_CREATE) {
    const message = canBootstrap
      ? `Team ${getDisplayTeamId(resolvedTeamId)} findes ikke. Opret det via bootstrap-knappen.`
      : `Team ${getDisplayTeamId(resolvedTeamId)} findes ikke.`;
    throw new MembershipMissingError(resolvedTeamId, user.uid, message);
  }
  if (access.status === TEAM_ACCESS_STATUS.NO_ACCESS) {
    const reason = access?.reason || access?.error?.code || '';
    const fallback = `Ingen adgang til team ${getDisplayTeamId(resolvedTeamId)}. Kontakt admin.`;
    if (reason === 'inactive') throw new MembershipMissingError(resolvedTeamId, user.uid, 'Medlemmet er deaktiveret.');
    if (reason === 'not-assigned') throw new MembershipMissingError(resolvedTeamId, user.uid, 'Du er ikke tildelt dette team. Kontakt admin.');
    throw new MembershipMissingError(resolvedTeamId, user.uid, fallback);
  }
  throw new PermissionDeniedError(access?.error?.message || 'Kunne ikke kontrollere team-adgang.');
}

async function getTeamDocument(teamId) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId);
  const db = await getFirestoreDb();
  const sdk = await getFirestoreHelpers();
  const snapshot = await sdk.getDoc(getTeamRef(sdk, db, resolvedTeamId));
  const data = snapshot.exists() ? snapshot.data() : {};
  return {
    id: resolvedTeamId,
    teamId: resolvedTeamId,
    name: data.name || getDisplayTeamId(resolvedTeamId),
    ...data,
  };
}

function normalizeJobNumber(jobNumber) {
  return (jobNumber || '').toString().trim() || 'UKENDT';
}

function normalizeTimestampValue(timestampLike) {
  if (!timestampLike) return '';
  if (typeof timestampLike === 'string') return timestampLike;
  if (typeof timestampLike.toISOString === 'function') {
    try {
      return timestampLike.toISOString();
    } catch {
      // ignore and keep trying other shapes
    }
  }
  if (typeof timestampLike.toDate === 'function') {
    const date = timestampLike.toDate();
    if (date && typeof date.toISOString === 'function') return date.toISOString();
  }
  if (typeof timestampLike === 'number') {
    const date = new Date(timestampLike);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof timestampLike === 'object' && typeof timestampLike.seconds === 'number') {
    const millis = timestampLike.seconds * 1000 + (timestampLike.nanoseconds || 0) / 1e6;
    const date = new Date(millis);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return timestampLike?.toString?.() || '';
}

function ensureCaseId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `case-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensureAuditId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cacheTeamResolution(uid, teamId, membership) {
  teamCache.uid = uid;
  teamCache.teamId = teamId;
  teamCache.membership = membership || null;
}

function getCachedTeam(uid) {
  if (uid && uid === teamCache.uid && teamCache.teamId) {
    return { teamId: teamCache.teamId, membership: teamCache.membership };
  }
  return null;
}

function normalizeActor(actor, membership) {
  const base = actor || {};
  return {
    uid: base.uid || base.id || 'user',
    email: base.email || '',
    name: base.name || base.displayName || '',
    displayName: base.displayName || base.name || '',
    providerId: base.providerId || base.provider || 'custom',
    role: membership?.role || base.role || null,
  };
}

export function resolveTeamId(rawTeamId) {
  const provided = rawTeamId || (typeof window !== 'undefined' ? window.TEAM_ID : null);
  if (provided) return formatTeamId(provided);
  const cached = getCachedTeam(getAuthContext()?.user?.uid || null);
  if (cached?.teamId) return cached.teamId;
  return resolvePreferredTeamId(provided);
}

export async function getTeamMembership(teamId, { allowBootstrap = false } = {}) {
  const user = await ensureAuthUser();
  const resolvedTeamId = formatTeamId(teamId || resolveTeamId(teamId));
  const access = await guardTeamAccess(resolvedTeamId, user, { allowBootstrap });
  if (access?.membership) {
    cacheTeamResolution(user.uid, resolvedTeamId, access.membership);
    return { ...access.membership, teamId: resolvedTeamId, role: access.role, invite: access.invite || null };
  }
  throw new MembershipMissingError(resolvedTeamId, user.uid, 'Medlem ikke fundet for valgt team.');
}

async function getTeamContext(teamId, { allowBootstrap = false, requireAdmin = false } = {}) {
  const user = await ensureAuthUser();
  const resolvedTeamId = formatTeamId(teamId || resolveTeamId(teamId));
  const access = await guardTeamAccess(resolvedTeamId, user, { allowBootstrap });
  if (!access?.membership) throw new PermissionDeniedError('Du er ikke medlem af dette team.');
  if (requireAdmin && access.role !== 'admin') {
    throw new PermissionDeniedError('Kun admin kan udføre denne handling.');
  }
  cacheTeamResolution(user.uid, resolvedTeamId, access.membership);
  return { teamId: resolvedTeamId, membership: access.membership, actor: normalizeActor(user, access.membership), role: access.role, invite: access.invite };
}

function normalizeCaseDoc(doc, { includeDeleted = false } = {}) {
  if (!doc || doc._deleted) return null;
  const isSnapshot = typeof doc.data === 'function';
  const data = isSnapshot ? (doc.data() || {}) : doc;
  const teamIdFromPath = isSnapshot && doc.ref?.parent?.parent?.id ? formatTeamId(doc.ref.parent.parent.id) : formatTeamId(data.teamId || '');
  const isDeleted = data.deletedAt || data.status === 'deleted';
  if (isDeleted && !includeDeleted) return null;
  const jobNumber = normalizeJobNumber(data.jobNumber);
  const createdAt = normalizeTimestampValue(data.createdAt);
  const updatedAt = normalizeTimestampValue(data.updatedAt || data.lastUpdatedAt || createdAt);
  const lastUpdatedAt = normalizeTimestampValue(data.lastUpdatedAt || updatedAt);
  return {
    ...data,
    teamId: teamIdFromPath || formatTeamId(data.teamId || ''),
    version: LEDGER_VERSION,
    caseId: data.caseId || data._id || (isSnapshot ? doc.id : ''),
    jobNumber,
    createdAt,
    updatedAt,
    lastUpdatedAt,
  };
}

function resolveUpdatedTimestamp(source) {
  const TimestampCtor = source?.constructor;
  if (TimestampCtor && typeof TimestampCtor.now === 'function') return normalizeTimestampValue(TimestampCtor.now());
  if (TimestampCtor && typeof TimestampCtor.fromDate === 'function') return normalizeTimestampValue(TimestampCtor.fromDate(new Date()));
  return new Date().toISOString();
}

async function getCaseDocument(teamId, caseId) {
  const db = await getFirestoreDb();
  const sdk = await getFirestoreHelpers();
  const ref = sdk.doc(db, 'teams', teamId, 'cases', caseId);
  return { db, sdk, ref };
}

async function recordAuditEvent(teamId, { caseId, action, actor, summary }) {
  const db = await getFirestoreDb();
  const sdk = await getFirestoreHelpers();
  const ref = sdk.doc(db, 'teams', teamId, 'audit', ensureAuditId());
  const timestamp = sdk.serverTimestamp();
  const payload = {
    _id: ref.id,
    teamId,
    caseId: caseId || null,
    action: action || 'UNKNOWN',
    actor: {
      uid: actor?.uid || actor?.id || 'user',
      email: actor?.email || '',
      name: actor?.name || actor?.displayName || '',
    },
    summary: summary || '',
    timestamp,
  };
  await sdk.setDoc(ref, payload);
  return payload;
}

function timestampToIso(value) {
  return normalizeTimestampValue(value) || toIsoString(value) || '';
}

export async function publishSharedCase({ teamId, jobNumber, caseKind, system, totals, status = 'kladde', jsonContent }) {
  const { teamId: resolvedTeamId, membership, actor } = await getTeamContext(teamId, { allowBootstrap: true });
  const { sdk, ref } = await getCaseDocument(resolvedTeamId, ensureCaseId());
  const now = sdk.serverTimestamp();
  const payload = {
    _id: ref.id,
    type: 'case',
    caseId: ref.id,
    parentCaseId: null,
    teamId: resolvedTeamId,
    jobNumber: normalizeJobNumber(jobNumber),
    caseKind,
    system,
    totals: totals || { materials: 0, montage: 0, demontage: 0, total: 0 },
    status,
    createdAt: now,
    updatedAt: now,
    lastUpdatedAt: now,
    createdBy: actor.uid,
    createdByEmail: actor.email || '',
    createdByName: actor.name || actor.displayName || '',
    updatedBy: actor.uid,
    immutable: true,
    deletedAt: null,
    attachments: {
      json: { data: jsonContent, createdAt: now },
      pdf: null,
    },
    actorRole: membership?.role || null,
  };
  await sdk.setDoc(ref, payload);
  const snapshot = await sdk.getDoc(ref);
  const normalized = normalizeCaseDoc(snapshot, { includeDeleted: true });
  await recordAuditEvent(resolvedTeamId, { caseId: ref.id, action: 'CREATE', actor, summary: 'Ny delt sag' });
  return normalized;
}

export async function listSharedGroups(teamId) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId);
  const db = await getFirestoreDb();
  const sdk = await getFirestoreHelpers();
  const query = sdk.query(
    sdk.collection(db, 'teams', resolvedTeamId, 'cases'),
    sdk.where('deletedAt', '==', null),
  );
  const response = await sdk.getDocs(query);
  const cases = response.docs.map(doc => normalizeCaseDoc(doc)).filter(Boolean).filter(entry => entry.type === 'case');

  const groups = new Map();
  cases.forEach(entry => {
    const existing = groups.get(entry.jobNumber) || { jobNumber: entry.jobNumber, cases: [], lastUpdatedAt: entry.lastUpdatedAt };
    existing.cases.push(entry);
    const timestamp = entry.lastUpdatedAt || entry.createdAt || '';
    if (!existing.lastUpdatedAt || timestamp.localeCompare(existing.lastUpdatedAt) > 0) {
      existing.lastUpdatedAt = timestamp;
    }
    groups.set(entry.jobNumber, existing);
  });

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      cases: group.cases.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    }))
    .sort((a, b) => (b.lastUpdatedAt || '').localeCompare(a.lastUpdatedAt || ''));
}

export async function getSharedCase(teamId, caseId, { includeDeleted = false } = {}) {
  try {
    const { teamId: resolvedTeamId } = await getTeamContext(teamId);
    const { sdk, ref } = await getCaseDocument(resolvedTeamId, caseId);
    const doc = await sdk.getDoc(ref);
    return normalizeCaseDoc(doc, { includeDeleted });
  } catch (error) {
    console.warn('Kunne ikke hente sag', error);
    if (error?.code === 'permission-denied') throw error;
    return null;
  }
}

export async function deleteSharedCase(teamId, caseId) {
  const entry = await getSharedCase(teamId, caseId);
  if (!entry) return false;
  const { teamId: resolvedTeamId, actor, membership } = await getTeamContext(teamId);
  if (entry.createdBy && entry.createdBy !== actor.uid && membership.role !== 'admin') {
    throw new PermissionDeniedError('Kun opretter eller admin kan slette sagen.');
  }
  const { sdk, ref } = await getCaseDocument(resolvedTeamId, caseId);
  const updatedAt = sdk.serverTimestamp();
  const next = {
    ...entry,
    teamId: entry.teamId || resolvedTeamId,
    status: 'deleted',
    deletedAt: updatedAt,
    deletedBy: actor.uid,
    updatedAt,
    lastUpdatedAt: updatedAt,
    updatedBy: actor.uid,
  };
  await sdk.setDoc(ref, next, { merge: true });
  await recordAuditEvent(resolvedTeamId, { caseId, action: 'DELETE', actor, summary: 'Soft delete' });
  return true;
}

export async function updateCaseStatus(teamId, caseId, status) {
  const { teamId: resolvedTeamId, actor, membership } = await getTeamContext(teamId);
  const { sdk, ref } = await getCaseDocument(resolvedTeamId, caseId);
  const doc = await sdk.getDoc(ref);
  if (!doc.exists()) return null;
  const current = doc.data() || {};
  if (current.createdBy && current.createdBy !== actor.uid && membership.role !== 'admin') {
    throw new PermissionDeniedError('Kun opretter eller admin kan ændre status.');
  }
  const updatedAt = sdk.serverTimestamp();
  const next = {
    status,
    updatedAt,
    lastUpdatedAt: updatedAt,
    updatedBy: actor.uid,
  };
  await sdk.updateDoc(ref, next);
  const updated = await sdk.getDoc(ref);
  return normalizeCaseDoc(updated, { includeDeleted: true });
}

export async function downloadCaseJson(teamId, caseId) {
  const entry = await getSharedCase(teamId, caseId);
  const content = entry?.attachments?.json?.data;
  if (!content) return null;
  const blob = new Blob([content], { type: 'application/json' });
  return { blob, fileName: `${entry.jobNumber || 'akkord'}-${entry.caseId}.json` };
}

export async function importCasePayload(teamId, caseId) {
  const entry = await getSharedCase(teamId, caseId);
  const content = entry?.attachments?.json?.data;
  if (!content) return null;
  return content;
}

export async function exportSharedBackup(teamId) {
  const { teamId: resolvedTeamId, membership, actor } = await getTeamContext(teamId);
  if (membership.role !== 'admin') throw new PermissionDeniedError('Kun admin kan eksportere backup.');
  const db = await getFirestoreDb();
  const sdk = await getFirestoreHelpers();
  const now = new Date().toISOString();
  const casesSnapshot = await sdk.getDocs(sdk.collection(db, 'teams', resolvedTeamId, 'cases'));
  const auditSnapshot = await sdk.getDocs(sdk.collection(db, 'teams', resolvedTeamId, 'audit'));
  const cases = casesSnapshot.docs.map(doc => ({
    caseId: doc.id,
    ...doc.data(),
    teamId: doc.data().teamId || resolvedTeamId,
    createdAt: timestampToIso(doc.data().createdAt),
    updatedAt: timestampToIso(doc.data().updatedAt),
    lastUpdatedAt: timestampToIso(doc.data().lastUpdatedAt),
    deletedAt: doc.data().deletedAt ? timestampToIso(doc.data().deletedAt) : null,
  }));
  const audit = auditSnapshot.docs.map(doc => ({
    _id: doc.id,
    ...doc.data(),
    teamId: doc.data().teamId || resolvedTeamId,
    timestamp: timestampToIso(doc.data().timestamp),
  }));
  const backup = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    teamId: resolvedTeamId,
    exportedAt: now,
    exportedBy: { uid: actor.uid, email: actor.email, name: actor.name || actor.displayName || '' },
    retentionYears: 5,
    cases,
    audit,
    metadata: { format: 'sscaff-shared-backup', source: 'sscaff-app' },
  };
  await recordAuditEvent(resolvedTeamId, { caseId: null, action: 'BACKUP_EXPORT', actor, summary: `Backup eksport ${cases.length} sager` });
  return backup;
}

function toTimestamp(sdk, value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return sdk.Timestamp.fromDate(date);
}

export function validateBackupSchema(payload) {
  if (!payload || ![BACKUP_SCHEMA_VERSION, 1].includes(payload.schemaVersion)) {
    throw new Error('Ukendt backup-format');
  }
  return payload;
}

function normalizeBackupAuditActor(actor, schemaVersion) {
  if (actor && typeof actor === 'object') {
    return {
      uid: actor.uid || actor.id || 'legacy',
      email: actor.email || '',
      name: actor.name || actor.displayName || '',
    };
  }
  const legacyName = schemaVersion === 1 && typeof actor === 'string' ? actor : '';
  return { uid: 'legacy', email: '', name: legacyName };
}

export async function importSharedBackup(teamId, payload) {
  const { teamId: resolvedTeamId, actor, membership } = await getTeamContext(teamId);
  if (membership.role !== 'admin') throw new PermissionDeniedError('Kun admin kan importere backup.');
  const db = await getFirestoreDb();
  const sdk = await getFirestoreHelpers();
  validateBackupSchema(payload);
  const existing = await sdk.getDocs(sdk.collection(db, 'teams', resolvedTeamId, 'cases'));
  const existingMap = new Map(existing.docs.map(doc => [doc.id, doc.data()]));
  let restored = 0;
  let conflicts = 0;

  for (const doc of payload.cases || []) {
    const docId = doc.caseId || doc._id;
    if (!docId) continue;
    const prior = existingMap.get(docId);
    const incomingUpdatedAt = doc.updatedAt || doc.lastUpdatedAt || doc.createdAt || '';
    const priorUpdatedAt = prior?.updatedAt || prior?.lastUpdatedAt || prior?.createdAt || '';
    const shouldReplace = !prior || incomingUpdatedAt.localeCompare(priorUpdatedAt) >= 0;
    if (!shouldReplace) {
      conflicts += 1;
      await recordAuditEvent(resolvedTeamId, { caseId: docId, action: 'RESTORE_CONFLICT', actor, summary: 'Backup konflikt – ældre data bevaret' });
      continue;
    }
    const ref = sdk.doc(db, 'teams', resolvedTeamId, 'cases', docId);
    const prepared = {
      ...doc,
      caseId: docId,
      teamId: resolvedTeamId,
      createdAt: toTimestamp(sdk, doc.createdAt) || sdk.serverTimestamp(),
      updatedAt: toTimestamp(sdk, doc.updatedAt) || sdk.serverTimestamp(),
      lastUpdatedAt: toTimestamp(sdk, doc.lastUpdatedAt || doc.updatedAt) || sdk.serverTimestamp(),
      deletedAt: doc.deletedAt ? toTimestamp(sdk, doc.deletedAt) : null,
    };
    await sdk.setDoc(ref, prepared, { merge: true });
    restored += 1;
    await recordAuditEvent(resolvedTeamId, { caseId: docId, action: 'RESTORE', actor, summary: 'Backup importeret' });
  }

  if (Array.isArray(payload.audit)) {
    for (const entry of payload.audit) {
      if (!entry?._id) continue;
      const ref = sdk.doc(db, 'teams', resolvedTeamId, 'audit', entry._id);
      const snapshot = await sdk.getDoc(ref);
      if (snapshot.exists()) continue;
      const prepared = {
        ...entry,
        teamId: resolvedTeamId,
        actor: normalizeBackupAuditActor(entry.actor, payload.schemaVersion),
        timestamp: toTimestamp(sdk, entry.timestamp) || sdk.serverTimestamp(),
      };
      await sdk.setDoc(ref, prepared);
    }
  }

  await recordAuditEvent(resolvedTeamId, {
    caseId: null,
    action: 'BACKUP_IMPORT',
    actor,
    summary: `Backup import færdig (restored=${restored}, conflicts=${conflicts})`,
  });

  return { restored, conflicts };
}

export async function hardDeleteCase(teamId, caseId) {
  const { teamId: resolvedTeamId, membership } = await getTeamContext(teamId);
  if (membership.role !== 'admin') throw new PermissionDeniedError('Kun admin kan hard delete.');
  const { sdk, ref } = await getCaseDocument(resolvedTeamId, caseId);
  await sdk.deleteDoc(ref);
  await recordAuditEvent(resolvedTeamId, { caseId, action: 'HARD_DELETE', actor: membership, summary: 'Sletning' });
  return true;
}

export async function saveTeamMember(teamId, member) {
  const { teamId: resolvedTeamId, actor } = await getTeamContext(teamId, { requireAdmin: true });
  const db = await getFirestoreDb();
  const sdk = await getFirestoreHelpers();
  const payload = {
    ...member,
    uid: member.uid || member.id,
    email: member.email || '',
    emailLower: normalizeEmail(member.email),
    displayName: member.displayName || member.name || '',
    role: member.role || 'member',
    active: member.active !== false,
    teamId: resolvedTeamId,
  };
  if (!payload.uid) throw new Error('Manglende bruger-id');
  const ref = sdk.doc(db, 'teams', resolvedTeamId, 'members', payload.uid);
  const existing = await sdk.getDoc(ref);
  const now = sdk.serverTimestamp();
  const prepared = {
    ...payload,
    createdAt: existing.exists() ? (existing.data()?.createdAt || existing.data()?.addedAt || now) : now,
    addedAt: existing.exists() ? (existing.data()?.addedAt || now) : now,
    addedByUid: existing.exists() ? (existing.data()?.addedByUid || actor.uid) : actor.uid,
    updatedAt: now,
  };
  await sdk.setDoc(ref, prepared, { merge: true });
  await recordAuditEvent(resolvedTeamId, {
    caseId: null,
    action: 'MEMBER_UPDATE',
    actor,
    summary: `Medlem ${payload.uid} opdateret`,
  });
  return prepared;
}

export async function deactivateTeamMember(teamId, memberId) {
  const { teamId: resolvedTeamId, actor } = await getTeamContext(teamId, { requireAdmin: true });
  const db = await getFirestoreDb();
  const sdk = await getFirestoreHelpers();
  const ref = sdk.doc(db, 'teams', resolvedTeamId, 'members', memberId);
  await sdk.setDoc(ref, { active: false, updatedAt: sdk.serverTimestamp() }, { merge: true });
  await recordAuditEvent(resolvedTeamId, {
    caseId: null,
    action: 'MEMBER_DEACTIVATE',
    actor,
    summary: `Medlem ${memberId} deaktiveret`,
  });
  return true;
}

export async function listTeamMembers(teamId) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId);
  const db = await getFirestoreDb();
  const sdk = await getFirestoreHelpers();
  const snapshot = await sdk.getDocs(sdk.collection(db, 'teams', resolvedTeamId, 'members'));
  return snapshot.docs.map(doc => ({ id: doc.id, uid: doc.id, ...doc.data() }));
}

export async function listTeamInvites(teamId) {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId, { requireAdmin: true });
  const db = await getFirestoreDb();
  const sdk = await getFirestoreHelpers();
  const invitesRef = sdk.collection(db, 'teamInvites');
  const snapshot = await sdk.getDocs(sdk.query(invitesRef, sdk.where('teamId', '==', resolvedTeamId)));
  return snapshot.docs.map(doc => {
    const data = doc.data() || {}
    const email = data.email || data.emailLower || ''
    return { id: doc.id, inviteId: doc.id, email, emailLower: data.emailLower || email, ...data }
  });
}

export async function saveTeamInvite(teamId, invite, actorOverride) {
  const { teamId: resolvedTeamId, actor } = await getTeamContext(teamId, { requireAdmin: true });
  const email = normalizeEmail(invite.email || invite.id || '');
  if (!email) throw new Error('Angiv email.');
  const role = invite.role === 'admin' ? 'admin' : 'member';
  const inviteRecord = await createTeamInvite(resolvedTeamId, email, role, {
    invitedByUid: actorOverride?.uid || actor.uid,
    invitedByEmail: actorOverride?.email || actor.email || '',
  });
  await recordAuditEvent(resolvedTeamId, {
    caseId: null,
    action: 'INVITE_SAVE',
    actor,
    summary: `Invite ${email} sat til ${role}`,
  });
  return { ...inviteRecord, email: inviteRecord.emailLower || email };
}

export async function addTeamMemberByEmail(teamId, emailInput, role = 'member') {
  const { teamId: resolvedTeamId } = await getTeamContext(teamId, { requireAdmin: true });
  const emailLower = normalizeEmail(emailInput);
  if (!emailLower) throw new Error('Angiv email.');
  const db = await getFirestoreDb();
  const sdk = await getFirestoreHelpers();
  const usersRef = sdk.collection(db, 'users');
  const constraints = [sdk.where('emailLower', '==', emailLower)];
  if (typeof sdk.limit === 'function') constraints.push(sdk.limit(1));
  const snapshot = await sdk.getDocs(sdk.query(usersRef, ...constraints));
  const match = snapshot.docs[0];
  if (!match) throw new Error('Bruger ikke fundet. Bed brugeren logge ind først.');
  return addTeamMemberByUid(resolvedTeamId, match.id, role);
}

export async function addTeamMemberByUid(teamId, memberUid, role = 'member') {
  const { teamId: resolvedTeamId, actor } = await getTeamContext(teamId, { requireAdmin: true });
  if (!memberUid) throw new Error('Angiv UID for medlemmet.');
  const db = await getFirestoreDb();
  const sdk = await getFirestoreHelpers();
  const memberRef = sdk.doc(db, 'teams', resolvedTeamId, 'members', memberUid);
  const [existing, userSnapshot] = await Promise.all([
    sdk.getDoc(memberRef),
    sdk.getDoc(sdk.doc(db, 'users', memberUid)),
  ]);
  const userData = userSnapshot.exists() ? (userSnapshot.data() || {}) : {};
  const now = sdk.serverTimestamp();
  const normalizedRole = role === 'admin' ? 'admin' : 'member';
  const payload = {
    uid: memberUid,
    email: userData.email || '',
    emailLower: userData.emailLower || normalizeEmail(userData.email),
    displayName: userData.displayName || '',
    role: normalizedRole,
    active: true,
    teamId: resolvedTeamId,
  };
  const prepared = {
    ...payload,
    createdAt: existing.exists() ? (existing.data()?.createdAt || existing.data()?.addedAt || now) : now,
    addedAt: existing.exists() ? (existing.data()?.addedAt || now) : now,
    addedByUid: existing.exists() ? (existing.data()?.addedByUid || actor.uid) : actor.uid,
    updatedAt: now,
  };
  await sdk.setDoc(memberRef, prepared, { merge: true });
  await upsertUserTeamRoleCache(memberUid, resolvedTeamId, prepared.role, {
    emailLower: payload.emailLower,
    displayName: payload.displayName,
  });
  await recordAuditEvent(resolvedTeamId, {
    caseId: null,
    action: 'MEMBER_ADD_UID',
    actor,
    summary: `Medlem ${memberUid} sat til ${prepared.role}`,
  });
  return prepared;
}

export async function removeTeamMember(teamId, memberId) {
  const { teamId: resolvedTeamId, actor, membership } = await getTeamContext(teamId, { requireAdmin: true });
  if (!memberId) throw new Error('Angiv medlem der skal fjernes.');
  const db = await getFirestoreDb();
  const sdk = await getFirestoreHelpers();
  const ref = sdk.doc(db, 'teams', resolvedTeamId, 'members', memberId);
  const snapshot = await sdk.getDoc(ref);
  const data = snapshot.exists() ? (snapshot.data() || {}) : {};
  const targetRole = data.role || 'member';
  if (targetRole === 'owner') {
    throw new PermissionDeniedError('Owner kan ikke fjernes fra teamet.');
  }
  if (memberId === (membership?.uid || actor.uid) && membership?.role === 'owner') {
    throw new PermissionDeniedError('Owner kan ikke fjerne sig selv.');
  }
  await sdk.deleteDoc(ref);
  await recordAuditEvent(resolvedTeamId, {
    caseId: null,
    action: 'MEMBER_REMOVE',
    actor,
    summary: `Medlem ${memberId} fjernet`,
  });
  return true;
}

export async function setMemberActive(teamId, memberId, active) {
  const { teamId: resolvedTeamId, actor } = await getTeamContext(teamId, { requireAdmin: true });
  const db = await getFirestoreDb();
  const sdk = await getFirestoreHelpers();
  const ref = sdk.doc(db, 'teams', resolvedTeamId, 'members', memberId);
  await sdk.setDoc(ref, { active: Boolean(active), updatedAt: sdk.serverTimestamp() }, { merge: true });
  await recordAuditEvent(resolvedTeamId, {
    caseId: null,
    action: Boolean(active) ? 'MEMBER_REACTIVATE' : 'MEMBER_DEACTIVATE',
    actor,
    summary: Boolean(active) ? `Medlem ${memberId} aktiveret` : `Medlem ${memberId} deaktiveret`,
  });
  return true;
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
  getTeamDocument,
  buildMemberDocPath,
};
