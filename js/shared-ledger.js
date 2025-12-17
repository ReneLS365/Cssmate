import { fireproof } from '@fireproof/core';
import { connect } from '@fireproof/partykit';
import { getAuthContext } from './shared-auth.js';

const LEDGER_TEAM_PREFIX = 'sscaff-team-';
const LEDGER_VERSION = 1;
const BACKUP_SCHEMA_VERSION = 1;
const STORAGE_PREFIX = 'sscaff:shared-ledger:';
const TEAM_ID_STORAGE_KEY = 'csmate:teamId';
const LEGACY_TEAM_ID_KEYS = ['sscaff-team-id'];
const DEFAULT_TEAM_ID = 'Hulmose';

export function formatTeamId(rawTeamId) {
  const cleaned = (rawTeamId || '').toString().trim() || 'default';
  return cleaned.startsWith(LEDGER_TEAM_PREFIX) ? cleaned : `${LEDGER_TEAM_PREFIX}${cleaned}`;
}

function persistTeamId(teamId) {
  try {
    const storage = getStorage();
    storage?.setItem(TEAM_ID_STORAGE_KEY, teamId);
  } catch (error) {
    console.warn('Kunne ikke gemme Team ID', error);
  }
}

function readTeamIdFromStorage() {
  try {
    const storage = getStorage();
    if (!storage) return null;
    const stored = storage.getItem(TEAM_ID_STORAGE_KEY);
    if (stored && stored.trim()) return stored;

    for (const legacyKey of LEGACY_TEAM_ID_KEYS) {
      const legacyValue = storage.getItem(legacyKey);
      if (legacyValue && legacyValue.trim()) {
        const normalizedLegacy = legacyValue.trim();
        persistTeamId(normalizedLegacy);
        return normalizedLegacy;
      }
    }
  } catch (error) {
    console.warn('Kunne ikke læse Team ID', error);
  }
  return null;
}

export function resolveTeamId(rawTeamId) {
  const requestedTeamId = rawTeamId
    || (typeof window !== 'undefined' ? window.TEAM_ID : null)
    || readTeamIdFromStorage();

  const normalizedRequest = (requestedTeamId || '').toString().trim();
  const resolved = normalizedRequest ? formatTeamId(normalizedRequest) : formatTeamId(DEFAULT_TEAM_ID);
  persistTeamId(resolved);
  return resolved;
}

function getStorage() {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function ensureUserId() {
  try {
    const storage = getStorage();
    const key = `${STORAGE_PREFIX}user`;
    if (!storage) return 'offline-user';
    const existing = storage.getItem(key);
    if (existing && existing.trim()) return existing;
    const created = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    storage.setItem(key, created);
    return created;
  } catch {
    return 'offline-user';
  }
}

function getCurrentActor() {
  const auth = getAuthContext();
  if (auth?.isAuthenticated && auth.user) {
    return {
      uid: auth.user.uid,
      email: auth.user.email || '',
      displayName: auth.user.displayName || '',
      providerId: auth.user.providerId || 'custom',
      role: auth.user.role || null,
    };
  }
  const fallbackId = ensureUserId();
  return {
    uid: fallbackId,
    email: '',
    displayName: 'Offline bruger',
    providerId: 'offline',
    role: null,
  };
}

function normalizeJobNumber(jobNumber) {
  return (jobNumber || '').toString().trim() || 'UKENDT';
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

function resolveConnectionHost() {
  if (typeof import.meta !== 'undefined') {
    const host = import.meta?.env?.PUBLIC_PARTYKIT_HOST;
    if (host) return host;
  }
  if (typeof process !== 'undefined' && process?.env?.PUBLIC_PARTYKIT_HOST) {
    return process.env.PUBLIC_PARTYKIT_HOST;
  }
  if (typeof window !== 'undefined' && window.PUBLIC_PARTYKIT_HOST) {
    return window.PUBLIC_PARTYKIT_HOST;
  }
  return null;
}

const ledgers = {};

export function getSharedLedger(teamId) {
  const cleanedTeamId = (teamId || '').toString().trim();
  if (!cleanedTeamId) return { ledger: null, connection: null };
  const name = formatTeamId(cleanedTeamId);
  if (!ledgers[name]) {
    const ledger = fireproof(name);
    const host = resolveConnectionHost();
    const connection = host ? connect.partykit(ledger, host) : null;
    ledgers[name] = { ledger, connection };
  }
  return ledgers[name];
}

export function getCurrentUserId() {
  return ensureUserId();
}

function normalizeCaseDoc(doc, { includeDeleted = false } = {}) {
  if (!doc || doc._deleted) return null;
  if (doc.deletedAt && !includeDeleted) return null;
  const jobNumber = normalizeJobNumber(doc.jobNumber);
  const createdAt = doc.createdAt || '';
  const updatedAt = doc.updatedAt || createdAt;
  return {
    ...doc,
    version: LEDGER_VERSION,
    caseId: doc.caseId || doc._id,
    jobNumber,
    createdAt,
    updatedAt,
    lastUpdatedAt: updatedAt,
  };
}

function normalizeActor(actor) {
  if (actor && actor.uid) return actor;
  return getCurrentActor();
}

async function recordAuditEvent(teamId, { caseId, action, actor, summary = '' }) {
  const { ledger } = getSharedLedger(teamId);
  if (!ledger) return null;
  const normalizedActor = normalizeActor(actor);
  const timestamp = new Date().toISOString();
  const doc = {
    _id: ensureAuditId(),
    type: 'audit',
    caseId,
    action,
    actor: normalizedActor.uid,
    actorEmail: normalizedActor.email || '',
    actorName: normalizedActor.displayName || '',
    providerId: normalizedActor.providerId || 'custom',
    timestamp,
    summary,
  };
  try {
    await ledger.put(doc);
    return doc;
  } catch (error) {
    console.warn('Kunne ikke gemme audit-log', error);
    return null;
  }
}

export async function publishSharedCase({ teamId, jobNumber, caseKind, system, totals, status = 'kladde', jsonContent, actor }) {
  const { ledger } = getSharedLedger(teamId);
  if (!ledger) throw new Error('Team ID mangler eller er ugyldigt');
  const caseId = ensureCaseId();
  const now = new Date().toISOString();
  const normalizedActor = normalizeActor(actor);
  const doc = {
    _id: caseId,
    type: 'case',
    caseId,
    parentCaseId: null,
    jobNumber: normalizeJobNumber(jobNumber),
    caseKind,
    system,
    totals: totals || { materials: 0, montage: 0, demontage: 0, total: 0 },
    status,
    createdAt: now,
    updatedAt: now,
    createdBy: normalizedActor.uid,
    createdByEmail: normalizedActor.email || '',
    createdByName: normalizedActor.displayName || '',
    updatedBy: normalizedActor.uid,
    immutable: true,
    attachments: {
      json: { data: jsonContent, createdAt: now },
      pdf: null,
    },
  };
  await ledger.put(doc);
  await recordAuditEvent(teamId, { caseId, action: 'CREATE', actor: normalizedActor, summary: 'Ny delt sag' });
  return doc;
}

export async function listSharedGroups(teamId) {
  const { ledger } = getSharedLedger(teamId);
  if (!ledger) throw new Error('Team ID mangler eller er ugyldigt');
  const response = await ledger.allDocs({ includeDeleted: false });
  const cases = response.rows
    .map(row => normalizeCaseDoc(row.value))
    .filter(Boolean)
    .filter(entry => entry.type === 'case');

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
    const { ledger } = getSharedLedger(teamId);
    if (!ledger) throw new Error('Team ID mangler eller er ugyldigt');
    const doc = await ledger.get(caseId);
    return normalizeCaseDoc(doc, { includeDeleted });
  } catch (error) {
    console.warn('Kunne ikke hente sag', error);
    return null;
  }
}

export async function deleteSharedCase(teamId, caseId, actor) {
  const entry = await getSharedCase(teamId, caseId);
  if (!entry) return false;
  const normalizedActor = normalizeActor(actor);
  if (entry.createdBy && entry.createdBy !== normalizedActor.uid && normalizedActor.role !== 'admin') return false;
  const { ledger } = getSharedLedger(teamId);
  if (!ledger) return false;
  const updatedAt = new Date().toISOString();
  const next = { ...entry, status: 'deleted', deletedAt: updatedAt, deletedBy: normalizedActor.uid, updatedAt, lastUpdatedAt: updatedAt };
  await ledger.put(next);
  await recordAuditEvent(teamId, { caseId, action: 'DELETE', actor: normalizedActor, summary: 'Soft delete' });
  return true;
}

export async function restoreSharedCase(teamId, caseId, actor) {
  const entry = await getSharedCase(teamId, caseId, { includeDeleted: true });
  if (!entry) return null;
  const normalizedActor = normalizeActor(actor);
  const { ledger } = getSharedLedger(teamId);
  if (!ledger) return null;
  const updatedAt = new Date().toISOString();
  const next = { ...entry, status: entry.status === 'deleted' ? 'kladde' : entry.status, deletedAt: null, deletedBy: null, updatedAt, lastUpdatedAt: updatedAt, updatedBy: normalizedActor.uid };
  await ledger.put(next);
  await recordAuditEvent(teamId, { caseId, action: 'RESTORE', actor: normalizedActor, summary: 'Gendannet delt sag' });
  return next;
}

export async function updateCaseStatus(teamId, caseId, status, actor) {
  const entry = await getSharedCase(teamId, caseId);
  if (!entry || entry.deletedAt) return null;
  const normalizedActor = normalizeActor(actor);
  if (entry.createdBy && entry.createdBy !== normalizedActor.uid && normalizedActor.role !== 'admin') return null;
  const { ledger } = getSharedLedger(teamId);
  if (!ledger) return null;
  const updatedAt = new Date().toISOString();
  const next = { ...entry, status, updatedAt, lastUpdatedAt: updatedAt, updatedBy: normalizedActor.uid };
  await ledger.put(next);
  await recordAuditEvent(teamId, { caseId, action: 'STATUS', actor: normalizedActor, summary: `Status → ${status}` });
  return next;
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
  const { ledger } = getSharedLedger(teamId);
  if (!ledger) throw new Error('Team ID mangler eller er ugyldigt');
  const now = new Date().toISOString();
  const docs = await ledger.allDocs({ includeDeleted: true });
  const cases = [];
  const audit = [];
  docs.rows.forEach(row => {
    const value = row.value;
    if (!value) return;
    if (value.type === 'case') {
      cases.push(value);
    } else if (value.type === 'audit') {
      audit.push(value);
    }
  });
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    teamId: formatTeamId(teamId),
    exportedAt: now,
    retentionYears: 5,
    cases,
    audit,
    metadata: { format: 'sscaff-shared-backup', source: 'sscaff-app' },
  };
}

export async function importSharedBackup(teamId, payload, actor) {
  const { ledger } = getSharedLedger(teamId);
  if (!ledger) throw new Error('Team ID mangler eller er ugyldigt');
  if (!payload || payload.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error('Ukendt backup-format');
  }
  const normalizedActor = normalizeActor(actor);
  const existing = await ledger.allDocs({ includeDeleted: true });
  const existingMap = new Map(existing.rows.map(row => [row.id, row.value]));
  let restored = 0;
  let conflicts = 0;

  for (const doc of payload.cases || []) {
    const prior = existingMap.get(doc._id);
    const incomingUpdatedAt = doc.updatedAt || doc.lastUpdatedAt || doc.createdAt || '';
    const priorUpdatedAt = prior?.updatedAt || prior?.lastUpdatedAt || prior?.createdAt || '';
    const shouldReplace = !prior || incomingUpdatedAt.localeCompare(priorUpdatedAt) >= 0;
    if (!shouldReplace) {
      conflicts += 1;
      await recordAuditEvent(teamId, { caseId: doc.caseId || doc._id, action: 'RESTORE_CONFLICT', actor: normalizedActor, summary: 'Backup konflikt – ældre data bevaret' });
      continue;
    }
    await ledger.put({ ...doc, lastUpdatedAt: incomingUpdatedAt });
    restored += 1;
    await recordAuditEvent(teamId, { caseId: doc.caseId || doc._id, action: 'RESTORE', actor: normalizedActor, summary: 'Backup importeret' });
  }

  if (Array.isArray(payload.audit)) {
    for (const entry of payload.audit) {
      if (!entry?._id) continue;
      const exists = existingMap.get(entry._id);
      if (exists) continue;
      await ledger.put(entry);
    }
  }

  return { restored, conflicts };
}
