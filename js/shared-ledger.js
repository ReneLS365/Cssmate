import { fireproof } from '@fireproof/core';
import { connect } from '@fireproof/partykit';

const LEDGER_TEAM_PREFIX = 'sscaff-team-';
const LEDGER_VERSION = 1;
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

function normalizeJobNumber(jobNumber) {
  return (jobNumber || '').toString().trim() || 'UKENDT';
}

function ensureCaseId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `case-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function normalizeCaseDoc(doc) {
  if (!doc || doc._deleted) return null;
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

function resolveUpdatedTimestamp(source) {
  const TimestampCtor = source?.constructor;
  if (TimestampCtor && typeof TimestampCtor.now === 'function') return TimestampCtor.now();
  if (TimestampCtor && typeof TimestampCtor.fromDate === 'function') return TimestampCtor.fromDate(new Date());
  return new Date().toISOString();
}

export async function publishSharedCase({ teamId, jobNumber, caseKind, system, totals, status = 'kladde', jsonContent }) {
  const { ledger } = getSharedLedger(teamId);
  if (!ledger) throw new Error('Team ID mangler eller er ugyldigt');
  const caseId = ensureCaseId();
  const now = new Date().toISOString();
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
    createdBy: ensureUserId(),
    immutable: true,
    attachments: {
      json: { data: jsonContent, createdAt: now },
      pdf: null,
    },
  };
  await ledger.put(doc);
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

export async function getSharedCase(teamId, caseId) {
  try {
    const { ledger } = getSharedLedger(teamId);
    if (!ledger) throw new Error('Team ID mangler eller er ugyldigt');
    const doc = await ledger.get(caseId);
    return normalizeCaseDoc(doc);
  } catch (error) {
    console.warn('Kunne ikke hente sag', error);
    return null;
  }
}

export async function deleteSharedCase(teamId, caseId, userId) {
  const entry = await getSharedCase(teamId, caseId);
  if (!entry) return false;
  if (entry.createdBy && entry.createdBy !== userId) return false;
  const { ledger } = getSharedLedger(teamId);
  if (!ledger) return false;
  await ledger.del(caseId);
  return true;
}

export async function updateCaseStatus(teamId, caseId, status, userId) {
  const { ledger } = getSharedLedger(teamId);
  if (!ledger) return null;
  let doc;
  try {
    doc = await ledger.get(caseId);
  } catch (error) {
    console.warn('Kunne ikke hente sag', error);
    return null;
  }
  if (!doc || doc._deleted) return null;
  if (doc.createdBy && doc.createdBy !== userId) return null;
  const updatedAt = resolveUpdatedTimestamp(doc.updatedAt || doc.lastUpdatedAt || doc.createdAt);
  const next = { ...doc, status, updatedAt, lastUpdatedAt: updatedAt };
  await ledger.put(next);
  return normalizeCaseDoc(next);
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
