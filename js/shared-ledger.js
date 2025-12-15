const LEDGER_TEAM_PREFIX = 'sscaff-team-';
const LEDGER_VERSION = 1;
const STORAGE_PREFIX = 'sscaff:shared-ledger:';

export function formatTeamId(rawTeamId) {
  const cleaned = (rawTeamId || '').toString().trim() || 'default';
  return cleaned.startsWith(LEDGER_TEAM_PREFIX) ? cleaned : `${LEDGER_TEAM_PREFIX}${cleaned}`;
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
    let existing = storage.getItem(key);
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

function loadLedger(teamId) {
  const storage = getStorage();
  if (!storage) return null;
  const raw = storage.getItem(`${STORAGE_PREFIX}${teamId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === LEDGER_VERSION) return parsed;
  } catch {
    storage.removeItem(`${STORAGE_PREFIX}${teamId}`);
  }
  return null;
}

function persistLedger(teamId, ledger) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(`${STORAGE_PREFIX}${teamId}`, JSON.stringify({ ...ledger, version: LEDGER_VERSION }));
  } catch (error) {
    console.warn('Kunne ikke gemme delt ledger', error);
  }
}

function normalizeJobNumber(jobNumber) {
  return (jobNumber || '').toString().trim() || 'UKENDT';
}

function normalizeSearchValue(value) {
  return (value || '').toString().toLowerCase();
}

function ensureLedger(teamId) {
  const existing = loadLedger(teamId);
  if (existing) return existing;
  const fresh = { version: LEDGER_VERSION, cases: {}, groups: {}, lastSync: Date.now() };
  persistLedger(teamId, fresh);
  return fresh;
}

function ensureCaseId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `case-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildSearchText(caseDoc, payloadText = '') {
  const parts = [
    caseDoc.jobNumber,
    caseDoc.caseKind,
    caseDoc.system,
    payloadText,
  ];
  return parts
    .filter(Boolean)
    .map(normalizeSearchValue)
    .join(' ');
}

export function getCurrentUserId() {
  return ensureUserId();
}

export async function publishSharedCase({ teamId, jobNumber, caseKind, system, totals, status = 'kladde', jsonContent }) {
  const ledger = ensureLedger(teamId);
  const caseId = ensureCaseId();
  const now = new Date().toISOString();
  const userId = ensureUserId();
  const groupKey = normalizeJobNumber(jobNumber);
  const payloadText = `${groupKey} ${system}`;
  const caseDoc = {
    type: 'case',
    caseId,
    parentCaseId: null,
    jobNumber: groupKey,
    caseKind,
    createdBy: userId,
    createdAt: now,
    system,
    totals: totals || { materials: 0, montage: 0, demontage: 0, total: 0 },
    status,
    immutable: true,
    attachments: {
      json: { type: 'json', content: jsonContent, createdAt: now },
      pdf: null,
    },
    searchText: buildSearchText({ jobNumber: groupKey, caseKind, system }, payloadText),
  };

  const group = ledger.groups[groupKey] || {
    type: 'case-group',
    jobNumber: groupKey,
    createdAt: now,
    lastUpdatedAt: now,
    cases: [],
  };

  group.cases = Array.from(new Set([...group.cases, caseId]));
  group.lastUpdatedAt = now;
  ledger.groups[groupKey] = group;
  ledger.cases[caseId] = caseDoc;
  ledger.lastSync = Date.now();
  persistLedger(teamId, ledger);
  return { caseDoc, group };
}

export async function listSharedGroups(teamId) {
  const ledger = ensureLedger(teamId);
  const groups = Object.values(ledger.groups || {});
  return groups
    .map(group => ({
      ...group,
      cases: (group.cases || [])
        .map(caseId => ledger.cases[caseId])
        .filter(Boolean)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    }))
    .sort((a, b) => (b.lastUpdatedAt || '').localeCompare(a.lastUpdatedAt || ''));
}

export async function getSharedCase(teamId, caseId) {
  const ledger = ensureLedger(teamId);
  return ledger.cases[caseId] || null;
}

export async function deleteSharedCase(teamId, caseId, userId) {
  const ledger = ensureLedger(teamId);
  const caseDoc = ledger.cases[caseId];
  if (!caseDoc) return false;
  if (caseDoc.createdBy && caseDoc.createdBy !== userId) return false;
  delete ledger.cases[caseId];
  Object.values(ledger.groups).forEach(group => {
    group.cases = (group.cases || []).filter(id => id !== caseId);
    group.lastUpdatedAt = new Date().toISOString();
  });
  persistLedger(teamId, ledger);
  return true;
}

export async function updateCaseStatus(teamId, caseId, status, userId) {
  const ledger = ensureLedger(teamId);
  const caseDoc = ledger.cases[caseId];
  if (!caseDoc) return null;
  if (caseDoc.createdBy && caseDoc.createdBy !== userId) return null;
  caseDoc.status = status;
  ledger.cases[caseId] = caseDoc;
  const group = ledger.groups[caseDoc.jobNumber];
  if (group) {
    group.lastUpdatedAt = new Date().toISOString();
    ledger.groups[caseDoc.jobNumber] = group;
  }
  persistLedger(teamId, ledger);
  return caseDoc;
}

export async function downloadCaseJson(teamId, caseId) {
  const caseDoc = await getSharedCase(teamId, caseId);
  if (!caseDoc?.attachments?.json?.content) return null;
  const blob = new Blob([caseDoc.attachments.json.content], { type: 'application/json' });
  return { blob, fileName: `${caseDoc.jobNumber || 'akkord'}-${caseDoc.caseId}.json` };
}

export async function importCasePayload(teamId, caseId) {
  const caseDoc = await getSharedCase(teamId, caseId);
  if (!caseDoc?.attachments?.json?.content) return null;
  return caseDoc.attachments.json.content;
}
