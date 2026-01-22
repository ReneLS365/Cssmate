import { listSharedCasesPage, downloadCaseJson, importCasePayload, updateCaseStatus, deleteSharedCase, formatTeamId, PermissionDeniedError, getDisplayTeamId, MembershipMissingError, DEFAULT_TEAM_SLUG } from './shared-ledger.js';
import { exportPDFBlob } from './export-pdf.js';
import { buildExportModel } from './export-model.js';
import { downloadBlob } from './utils/downloadBlob.js';
import { getUserDisplay } from './shared-auth.js';
import { initAuthSession, onChange as onSessionChange, getState as getSessionState, SESSION_STATUS } from '../src/auth/session.js';
import { TEAM_ACCESS_STATUS } from '../src/services/team-access.js';
import { normalizeSearchValue, formatDateLabel } from './history-normalizer.js';
import { showToast } from '../src/ui/toast.js';

let sharedCasesPanelInitialized = false;
let refreshBtn;
let sessionState = {};
let sharedCard;
let teamId = '';
let displayTeamId = '';
let membershipRole = '';
let teamError = '';
let membershipError = null;
let statusBox;
let errorBanner;
let statusUser;
let statusEmail;
let debugPanel;
let debugLogOutput;
let hasDebugEntries = false;
let debugMessagesSeen = new Set();
let pagedEntries = [];
let nextCursor = null;
let activeFilters = null;
let isLoadingMore = false;
let loadMoreBtn;
const UI_STORAGE_KEY = 'cssmate:shared-cases:ui:v1';
const CASE_META_CACHE = new Map();
const DATE_INPUT_FORMATTER = new Intl.DateTimeFormat('sv-SE');
const CURRENCY_FORMATTER = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BOARD_COLUMNS = [
  { id: 'kladde', label: 'Kladde', hint: 'Nye eller uafsluttede sager.' },
  { id: 'klar', label: 'Klar til deling', hint: 'Klar til godkendelse.' },
  { id: 'godkendt', label: 'Godkendt', hint: 'Montage klar til demontage-hold.' },
  { id: 'demontage', label: 'Demontage i gang', hint: 'Demontage igangsat.' },
  { id: 'afsluttet', label: 'Afsluttet', hint: 'Sager der er afsluttet.' },
  { id: 'andet', label: 'Andet', hint: 'Ukendte statusser.' },
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localDayKeyFromDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function localDayKeyFromRaw(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return localDayKeyFromDate(d);
}

function dayKeyFromInput(s) {
  if (!s || typeof s !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

displayTeamId = DEFAULT_TEAM_SLUG;

function formatMissingMembershipMessage(teamIdValue, uid) {
  const teamLabel = getDisplayTeamId(teamIdValue || displayTeamId);
  const targetTeamId = formatTeamId(teamLabel);
  const memberPath = `teams/${targetTeamId}/members/${uid || 'uid'}`;
  return `Du er logget ind men ikke medlem (forventet sti: ${memberPath}). Kontakt admin eller opret team.`;
}

function ensureTeamSelected() {
  if (!teamId || membershipError) throw new PermissionDeniedError(teamError || 'Vælg et team for at fortsætte.');
  return teamId;
}

function describePermissionError (error, attemptedTeamId) {
  const message = (error?.message || '').toString();
  const normalized = message.toLowerCase();
  const code = error?.code || '';
  if (error instanceof MembershipMissingError) {
    const uid = sessionState?.user?.uid || 'uid';
    return formatMissingMembershipMessage(error.teamId || attemptedTeamId, uid);
  }
  if (code.startsWith('auth_')) {
    if (code === 'auth_config' || code === 'auth_invalid_claims') {
      return 'Login token matcher ikke serverens Auth0-konfig. Kontakt admin eller prøv igen.';
    }
    if (code === 'auth_token_expired') {
      return 'Login er udløbet. Log ind igen.';
    }
    return 'Kunne ikke validere login. Log ind igen eller kontakt admin.';
  }
  if (error?.code === 'permission-denied' || error instanceof PermissionDeniedError || normalized.includes('missing or insufficient permissions')) {
    const teamLabel = getDisplayTeamId(attemptedTeamId || teamId || displayTeamId);
    return `Du er logget ind, men har ikke adgang til team '${teamLabel}'. Kontakt admin eller skift team (kun admin).`;
  }
  if (normalized.includes('network') || normalized.includes('offline')) {
    return 'Ingen forbindelse – tjek netværket.';
  }
  return '';
}

function setInlineError (message) {
  if (!errorBanner) return;
  if (message) {
    errorBanner.textContent = message;
    errorBanner.hidden = false;
  } else {
    errorBanner.textContent = '';
    errorBanner.hidden = true;
  }
}

function clearInlineError () {
  setInlineError('');
}

function getAccessLabel () {
  const status = sessionState?.accessStatus || TEAM_ACCESS_STATUS.CHECKING;
  const message = teamError || sessionState?.message || '';
  if (status === TEAM_ACCESS_STATUS.SIGNED_OUT) return 'Adgang: Log ind';
  if (status === TEAM_ACCESS_STATUS.OK && !message) return 'Adgang: OK';
  if (status === TEAM_ACCESS_STATUS.CHECKING && !message) return 'Adgang: Tjekker adgang…';
  const labelMessage = message || (status === TEAM_ACCESS_STATUS.OK ? '' : 'Ingen adgang');
  return `Adgang: ${labelMessage || 'Ingen adgang'}`;
}

function renderStatusSummary (primaryMessage = '') {
  if (!statusBox) statusBox = document.getElementById('sharedStatus');
  const teamLabel = displayTeamId || DEFAULT_TEAM_SLUG;
  const accessLabel = getAccessLabel();
  const summaryParts = [primaryMessage, `Team: ${teamLabel}`, accessLabel].filter(Boolean);
  if (statusBox) {
    statusBox.textContent = summaryParts.join(' — ');
    statusBox.hidden = false;
  }
}

function updateStatusCard() {
  const loggedIn = Boolean(sessionState?.user);
  if (statusUser) statusUser.textContent = loggedIn ? getUserDisplay(sessionState?.user) : '–';
  if (statusEmail) statusEmail.textContent = loggedIn ? (sessionState?.user?.email || '–') : '–';
}

function isAdminUser () {
  if (membershipRole === 'admin' || membershipRole === 'owner') return true;
  return sessionState?.role === 'admin' || sessionState?.role === 'owner';
}

function handleActionError (error, fallbackMessage, { teamContext } = {}) {
  const permissionMessage = describePermissionError(error, teamContext);
  const message = permissionMessage || error?.message || fallbackMessage;
  setInlineError(message);
}

function setMembershipError(error, fallbackTeamId) {
  membershipError = error;
  const uid = sessionState?.user?.uid || 'uid';
  const message = error ? formatMissingMembershipMessage(fallbackTeamId || teamId, uid) : '';
  teamError = message;
  setInlineError(message);
  renderStatusSummary(teamError);
  updateStatusCard();
}

function appendDebug(message) {
  if (!message) return;
  if (debugMessagesSeen.has(message)) return;
  debugMessagesSeen.add(message);
  const timestamp = new Date().toISOString();
  const entry = `${timestamp} – ${message}`;
  if (debugPanel) debugPanel.hidden = false;
  hasDebugEntries = true;
  if (debugLogOutput) {
    const existing = debugLogOutput.textContent ? debugLogOutput.textContent.split('\n') : [];
    existing.unshift(entry);
    debugLogOutput.textContent = existing.slice(0, 10).join('\n');
  }
}

function loadUiState() {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(UI_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveUiState(state) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

function applyStoredFilters() {
  const state = loadUiState();
  const searchInput = document.getElementById('sharedSearchInput');
  const dateFrom = document.getElementById('sharedDateFrom');
  const dateTo = document.getElementById('sharedDateTo');
  const status = document.getElementById('sharedFilterStatus');
  const kind = document.getElementById('sharedFilterKind');
  const sort = document.getElementById('sharedSort');
  if (searchInput && typeof state.search === 'string') searchInput.value = state.search;
  if (dateFrom && typeof state.dateFrom === 'string') dateFrom.value = state.dateFrom;
  if (dateTo && typeof state.dateTo === 'string') dateTo.value = state.dateTo;
  if (status && typeof state.status === 'string') status.value = state.status;
  if (kind && typeof state.kind === 'string') kind.value = state.kind;
  if (sort && typeof state.sort === 'string') sort.value = state.sort;
}

function cacheCaseMeta(entry, meta) {
  if (!entry?.caseId) return;
  CASE_META_CACHE.set(entry.caseId, meta);
}

function parseCasePayload(entry) {
  const raw = entry?.attachments?.json?.data;
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function resolveCaseMeta(entry) {
  if (entry?.caseId && CASE_META_CACHE.has(entry.caseId)) {
    return CASE_META_CACHE.get(entry.caseId);
  }
  const payload = parseCasePayload(entry);
  const job = payload?.job || payload;
  const info = job?.info || payload?.info || {};
  const meta = job?.meta || payload?.meta || {};
  const wage = job?.wage || payload?.wage || {};
  const workers = Array.isArray(wage?.workers) ? wage.workers : [];
  const workerNames = workers.map(worker => worker?.name).filter(Boolean);
  const jobName = info?.navn || meta?.caseName || meta?.jobName || '';
  const jobNumber = info?.sagsnummer || meta?.caseNumber || entry?.jobNumber || '';
  const address = info?.adresse || meta?.address || '';
  const customer = info?.kunde || meta?.customer || '';
  const montor = info?.montoer || info?.worker || meta?.montoer || '';
  const date = info?.dato || meta?.date || job?.exportedAt || entry?.createdAt || '';
  const system = meta?.system || entry?.system || '';
  const jobType = meta?.jobType || job?.jobType || entry?.caseKind || '';
  const totals = job?.totals || payload?.totals || entry?.totals || {};
  const resolved = {
    jobName,
    jobNumber,
    address,
    customer,
    montor,
    workerNames,
    date,
    system,
    jobType,
    totals,
  };
  cacheCaseMeta(entry, resolved);
  return resolved;
}

function formatDateInput(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  return DATE_INPUT_FORMATTER.format(date);
}

function parseDateInputStart(value) {
  if (!value) return null;
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || parts.some(part => Number.isNaN(part))) return null;
  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.valueOf())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function parseDateInputEnd(value) {
  const date = parseDateInputStart(value);
  if (!date) return null;
  date.setHours(23, 59, 59, 999);
  return date;
}

function parseCaseDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) return null;
    return new Date(value.getTime());
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (dateOnlyMatch) {
      const year = Number(dateOnlyMatch[1]);
      const month = Number(dateOnlyMatch[2]);
      const day = Number(dateOnlyMatch[3]);
      const date = new Date(year, month - 1, day);
      if (Number.isNaN(date.valueOf())) return null;
      date.setHours(0, 0, 0, 0);
      return date;
    }
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return date;
}

function resolveCaseTotals(entry, meta) {
  const totals = meta?.totals || entry?.totals || {};
  const materials = Number(totals.materials ?? totals.materialsSum ?? totals.materialTotal ?? 0) || 0;
  const total = Number(totals.total ?? totals.project ?? totals.akkord ?? totals.projectTotal ?? 0) || 0;
  return { materials, total };
}

function resolveCaseDate(entry, meta) {
  const dateValue = meta?.date || entry?.createdAt || entry?.updatedAt || '';
  const formatted = formatDateLabel(dateValue);
  const iso = dateValue ? new Date(dateValue).toISOString() : '';
  return { raw: dateValue, formatted, iso };
}

function resolveCaseStatusBucket(status) {
  const value = (status || '').toLowerCase();
  if (value === 'kladde') return 'kladde';
  if (['klar', 'klar-til-deling', 'klar_til_deling', 'ready'].includes(value)) return 'klar';
  if (value === 'godkendt') return 'godkendt';
  if (['demontage', 'demontage-igang', 'demontage_i_gang', 'i-gang', 'igang', 'in-progress'].includes(value)) return 'demontage';
  if (['afsluttet', 'done', 'completed', 'complete'].includes(value)) return 'afsluttet';
  return 'andet';
}

function buildSearchIndex(entry, meta) {
  const date = resolveCaseDate(entry, meta);
  const totals = resolveCaseTotals(entry, meta);
  const values = [
    entry?.jobNumber,
    meta?.jobNumber,
    meta?.jobName,
    meta?.address,
    meta?.customer,
    meta?.montor,
    meta?.workerNames?.join(' '),
    entry?.caseKind,
    meta?.jobType,
    entry?.status,
    meta?.system,
    entry?.createdByName,
    entry?.createdByEmail,
    date.formatted,
    date.iso?.slice(0, 10),
    formatDateInput(date.raw),
    CURRENCY_FORMATTER.format(totals.materials),
    CURRENCY_FORMATTER.format(totals.total),
  ]
    .filter(Boolean)
    .map(normalizeSearchValue);
  return Array.from(new Set(values));
}

function setPanelVisibility(isReady) {
  if (sharedCard) sharedCard.hidden = !isReady;
}

function requireAuth() {
  const accessStatus = sessionState?.accessStatus || TEAM_ACCESS_STATUS.CHECKING;
  const hasAccess = Boolean(accessStatus === TEAM_ACCESS_STATUS.OK && sessionState?.sessionReady);
  if (sessionState?.status === SESSION_STATUS.SIGNING_IN || accessStatus === TEAM_ACCESS_STATUS.CHECKING) {
    renderStatusSummary(sessionState?.message || 'Login initialiseres…');
    setInlineError(sessionState?.message || '');
    setPanelVisibility(false);
    return false;
  }
  if (!hasAccess) {
    const message = sessionState?.message || teamError || 'Log ind via login-skærmen for at se delte sager.';
    renderStatusSummary(message);
    setInlineError(message);
    setPanelVisibility(false);
    return false;
  }
  renderStatusSummary(`Logget ind som ${getUserDisplay(sessionState.user)}`);
  if (membershipError) {
    setMembershipError(null);
  }
  clearInlineError();
  setPanelVisibility(true);
  return true;
}

function bindSessionControls(onAuthenticated, onAccessReady) {
  initAuthSession();
  let lastStatus = '';
  onSessionChange((state) => {
    sessionState = state || {};
    teamId = state?.teamId ? formatTeamId(state.teamId) : '';
    displayTeamId = state?.displayTeamId || (teamId ? getDisplayTeamId(teamId) : DEFAULT_TEAM_SLUG);
    membershipRole = state?.role || '';
    membershipError = null;
    teamError = '';
    const accessStatus = state?.accessStatus || TEAM_ACCESS_STATUS.CHECKING;
    if (state?.status === SESSION_STATUS.SIGNED_OUT) {
      debugMessagesSeen.clear();
    }
    if (state?.status === SESSION_STATUS.NO_ACCESS || state?.status === SESSION_STATUS.ERROR || accessStatus !== TEAM_ACCESS_STATUS.OK) {
      teamError = state?.message || teamError || '';
      if (state?.user?.uid && accessStatus !== TEAM_ACCESS_STATUS.OK) {
        membershipError = new MembershipMissingError(teamId, state?.user?.uid || 'uid', state?.message || '');
      }
      if (state?.status === SESSION_STATUS.NO_ACCESS || state?.status === SESSION_STATUS.ERROR) {
        debugMessagesSeen.clear();
      }
    }
    const hasAccess = Boolean(state?.sessionReady);
    setPanelVisibility(Boolean(state?.sessionReady));
    updateSharedStatus();
    updateStatusCard();

    if (hasAccess && lastStatus !== state.status) {
      if (typeof onAccessReady === 'function') onAccessReady();
    }

    if (hasAccess && typeof onAuthenticated === 'function') {
      onAuthenticated();
    }

    lastStatus = state?.status || '';
  });
}

function getFilters() {
  const searchInput = document.getElementById('sharedSearchInput');
  const dateFrom = document.getElementById('sharedDateFrom');
  const dateTo = document.getElementById('sharedDateTo');
  const status = document.getElementById('sharedFilterStatus');
  const kind = document.getElementById('sharedFilterKind');
  const sort = document.getElementById('sharedSort');
  const filters = {
    search: (searchInput?.value || '').trim(),
    dateFrom: dateFrom?.value || '',
    dateTo: dateTo?.value || '',
    status: status?.value || '',
    kind: kind?.value || '',
    sort: sort?.value || 'newest',
  };
  saveUiState(filters);
  return filters;
}

function resolveServerFilters(filters) {
  const status = filters?.status && filters.status !== 'andet' ? filters.status : '';
  const q = (filters?.search || '').trim();
  const from = dayKeyFromInput(filters?.dateFrom);
  const to = dayKeyFromInput(filters?.dateTo);
  return { status, q, from, to };
}

function matchesFilters(entry, meta, filters) {
  const searchValue = normalizeSearchValue(filters.search);
  const tokens = searchValue ? searchValue.split(' ').filter(Boolean) : [];
  const searchIndex = buildSearchIndex(entry, meta);
  const matchesSearch = tokens.length === 0
    || tokens.every(token => searchIndex.some(value => value.includes(token)));
  const statusMatch = !filters.status || resolveCaseStatusBucket(entry.status) === filters.status;
  const kindValue = (entry.caseKind || meta?.jobType || '').toLowerCase();
  const kindMatch = !filters.kind || kindValue === filters.kind;
  const date = resolveCaseDate(entry, meta);
  const fromKey = dayKeyFromInput(filters.dateFrom);
  const toKey = dayKeyFromInput(filters.dateTo);
  const entryKey = dayKeyFromInput(entry.dateDay)
    || localDayKeyFromRaw(entry.lastUpdatedAt || entry.updatedAt || entry.createdAt || date.raw);
  const dateMatch = (!fromKey || (entryKey && entryKey >= fromKey))
    && (!toKey || (entryKey && entryKey <= toKey));
  return matchesSearch && statusMatch && kindMatch && dateMatch;
}

async function handleJsonDownload(caseId) {
  const result = await downloadCaseJson(ensureTeamSelected(), caseId);
  if (!result) throw new Error('Ingen JSON vedhæftet');
  downloadBlob(result.blob, result.fileName);
}

async function handleImport(caseId) {
  const content = await importCasePayload(ensureTeamSelected(), caseId);
  if (!content) throw new Error('Ingen JSON vedhæftet');
  const file = new File([content], 'shared-case.json', { type: 'application/json' });
  if (typeof window !== 'undefined' && typeof window.cssmateHandleAkkordImport === 'function') {
    await window.cssmateHandleAkkordImport(file);
  } else {
    throw new Error('Import-handler ikke klar');
  }
}

async function handlePdfDownload(entry) {
  const content = await importCasePayload(ensureTeamSelected(), entry.caseId);
  if (!content) throw new Error('Ingen JSON vedhæftet');
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    console.warn('Kunne ikke parse JSON til PDF', error);
    throw new Error('Ugyldig JSON');
  }
  const model = buildExportModel(parsed, { exportedAt: new Date().toISOString() });
  const payload = await exportPDFBlob(parsed, { model, customSagsnummer: entry.jobNumber });
  downloadBlob(payload.blob, `${entry.jobNumber || 'akkord'}-${entry.caseId}.pdf`);
}

function openSharedModal({ title, body, actions = [] }) {
  if (typeof document === 'undefined') return { close: () => {} };
  const overlay = document.createElement('div');
  overlay.className = 'shared-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const card = document.createElement('div');
  card.className = 'shared-modal__card';

  const heading = document.createElement('h3');
  heading.className = 'shared-modal__title';
  heading.textContent = title || 'Besked';

  const bodyEl = document.createElement('div');
  bodyEl.className = 'shared-modal__body';
  if (typeof body === 'string') {
    bodyEl.textContent = body;
  } else if (body instanceof HTMLElement) {
    bodyEl.appendChild(body);
  }

  const actionsEl = document.createElement('div');
  actionsEl.className = 'shared-modal__actions';

  const close = () => {
    overlay.remove();
  };

  actions.forEach(({ label, onClick, autoFocus }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', async () => {
      if (typeof onClick === 'function') {
        await onClick();
      }
      close();
    });
    if (autoFocus) btn.autofocus = true;
    actionsEl.appendChild(btn);
  });

  card.appendChild(heading);
  if (bodyEl.childNodes.length) {
    card.appendChild(bodyEl);
  }
  card.appendChild(actionsEl);
  overlay.appendChild(card);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.body.appendChild(overlay);
  return { close };
}

function openConfirmModal({ title, message, confirmLabel = 'OK', cancelLabel = 'Annuller' }) {
  return new Promise(resolve => {
    openSharedModal({
      title,
      body: message,
      actions: [
        {
          label: cancelLabel,
          onClick: () => resolve(false),
        },
        {
          label: confirmLabel,
          onClick: () => resolve(true),
          autoFocus: true,
        },
      ],
    });
  });
}

function renderApprovalSummary(entry) {
  const meta = resolveCaseMeta(entry);
  const totals = resolveCaseTotals(entry, meta);
  const date = resolveCaseDate(entry, meta);
  const wrapper = document.createElement('div');
  const rows = [
    { label: 'Jobnr', value: meta.jobNumber || entry.jobNumber || '–' },
    { label: 'Type', value: meta.jobType || entry.caseKind || '–' },
    { label: 'Dato', value: date.formatted || formatDateInput(date.raw) || '–' },
    { label: 'Kunde', value: meta.customer || '–' },
    { label: 'Adresse', value: meta.address || '–' },
    { label: 'Materialer', value: `${CURRENCY_FORMATTER.format(totals.materials)} kr.` },
    { label: 'Total', value: `${CURRENCY_FORMATTER.format(totals.total)} kr.` },
  ];
  rows.forEach(row => {
    const line = document.createElement('div');
    const label = document.createElement('span');
    label.textContent = row.label;
    const value = document.createElement('strong');
    value.textContent = row.value;
    line.appendChild(label);
    line.appendChild(value);
    wrapper.appendChild(line);
  });
  return wrapper;
}

function createCaseActions(entry, userId, onChange) {
  const container = document.createElement('div');
  container.className = 'shared-case-actions';

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.textContent = 'Importér';
  importBtn.addEventListener('click', async () => {
    importBtn.disabled = true;
    try {
      await handleImport(entry.caseId);
      showToast('Sag importeret til optælling.', { variant: 'success' });
    } catch (error) {
      console.error('Import fejlede', error);
      handleActionError(error, 'Import fejlede', { teamContext: teamId });
      showToast(error?.message || 'Import fejlede.', { variant: 'error' });
    } finally {
      importBtn.disabled = false;
    }
  });
  container.appendChild(importBtn);

  const jsonBtn = document.createElement('button');
  jsonBtn.type = 'button';
  jsonBtn.textContent = 'JSON';
  jsonBtn.addEventListener('click', async () => {
    jsonBtn.disabled = true;
    try {
      await handleJsonDownload(entry.caseId);
      showToast('JSON er hentet.', { variant: 'success' });
    } catch (error) {
      console.error('Download fejlede', error);
      handleActionError(error, 'Kunne ikke hente JSON', { teamContext: teamId });
      showToast(error?.message || 'Kunne ikke hente JSON.', { variant: 'error' });
    } finally {
      jsonBtn.disabled = false;
    }
  });
  container.appendChild(jsonBtn);

  const pdfBtn = document.createElement('button');
  pdfBtn.type = 'button';
  pdfBtn.textContent = 'PDF';
  pdfBtn.addEventListener('click', async () => {
    pdfBtn.disabled = true;
    try {
      await handlePdfDownload(entry);
      showToast('PDF er genereret.', { variant: 'success' });
    } catch (error) {
      console.error('PDF fejlede', error);
      handleActionError(error, 'Kunne ikke generere PDF', { teamContext: teamId });
      showToast(error?.message || 'Kunne ikke generere PDF.', { variant: 'error' });
    } finally {
      pdfBtn.disabled = false;
    }
  });
  container.appendChild(pdfBtn);

  if (entry.createdBy === userId || isAdminUser()) {
    const statusBtn = document.createElement('button');
    statusBtn.type = 'button';
    statusBtn.textContent = entry.status === 'godkendt' ? 'Markér kladde' : 'Godkend';
    statusBtn.addEventListener('click', async () => {
      statusBtn.disabled = true;
      try {
        const next = entry.status === 'godkendt' ? 'kladde' : 'godkendt';
        const updated = await updateCaseStatus(ensureTeamSelected(), entry.caseId, next);
        await onChange();
        if (next === 'godkendt') {
          openSharedModal({
            title: 'Sag godkendt',
            body: renderApprovalSummary(updated || entry),
            actions: [
              {
                label: 'Åbn',
                onClick: async () => {
                  try {
                    await handleImport(entry.caseId);
                  } catch (error) {
                    handleActionError(error, 'Kunne ikke åbne sag', { teamContext: teamId });
                    showToast(error?.message || 'Kunne ikke åbne sag.', { variant: 'error' });
                  }
                },
              },
              { label: 'Luk' },
            ],
          });
        } else {
          showToast('Status sat tilbage til kladde.', { variant: 'info' });
        }
      } catch (error) {
        console.error('Status opdatering fejlede', error);
        handleActionError(error, 'Kunne ikke opdatere status', { teamContext: teamId });
        showToast(error?.message || 'Kunne ikke opdatere status.', { variant: 'error' });
      } finally {
        statusBtn.disabled = false;
      }
    });
    container.appendChild(statusBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Soft delete';
    deleteBtn.addEventListener('click', async () => {
      const confirmed = await openConfirmModal({
        title: 'Soft delete sag',
        message: 'Denne sag skjules for teamet, men kan gendannes af admin.',
        confirmLabel: 'Soft delete',
      });
      if (!confirmed) return;
      deleteBtn.disabled = true;
      try {
        await deleteSharedCase(ensureTeamSelected(), entry.caseId);
        await onChange();
        showToast('Sag er soft-deleted.', { variant: 'success' });
      } catch (error) {
        console.error('Sletning fejlede', error);
        handleActionError(error, 'Kunne ikke slette sag', { teamContext: teamId });
        showToast(error?.message || 'Kunne ikke slette sag.', { variant: 'error' });
      } finally {
        deleteBtn.disabled = false;
      }
    });
    container.appendChild(deleteBtn);
  }

  return container;
}

function renderCaseCard(entry, userId, onChange) {
  const meta = resolveCaseMeta(entry);
  const totals = resolveCaseTotals(entry, meta);
  const date = resolveCaseDate(entry, meta);
  const card = document.createElement('div');
  card.className = 'shared-case-card';

  const top = document.createElement('div');
  top.className = 'shared-case-card__top';
  const title = document.createElement('h3');
  title.className = 'shared-case-card__title';
  title.textContent = meta.jobNumber || entry.jobNumber || 'Ukendt sag';
  const badge = document.createElement('span');
  badge.className = 'shared-case-card__badge';
  badge.textContent = entry.status || 'kladde';
  top.appendChild(title);
  top.appendChild(badge);

  const metaGrid = document.createElement('div');
  metaGrid.className = 'shared-case-card__meta';
  const lines = [
    { label: 'Type', value: meta.jobType || entry.caseKind || '–' },
    { label: 'Opgave', value: meta.jobName || '–' },
    { label: 'Adresse', value: meta.address || '–' },
    { label: 'Kunde', value: meta.customer || '–' },
    { label: 'Montører', value: meta.montor || meta.workerNames?.join(', ') || '–' },
    { label: 'Dato', value: date.formatted || formatDateInput(date.raw) || '–' },
    { label: 'System', value: meta.system || entry.system || '–' },
  ];
  lines.forEach(line => {
    const row = document.createElement('div');
    const label = document.createElement('span');
    label.textContent = `${line.label}:`;
    const value = document.createElement('strong');
    value.textContent = line.value;
    row.appendChild(label);
    row.appendChild(value);
    metaGrid.appendChild(row);
  });

  const totalsRow = document.createElement('div');
  totalsRow.className = 'shared-case-card__totals';
  const materials = document.createElement('div');
  materials.innerHTML = `<span>Materialer:</span> <strong>${CURRENCY_FORMATTER.format(totals.materials)} kr.</strong>`;
  const total = document.createElement('div');
  total.innerHTML = `<span>Total:</span> <strong>${CURRENCY_FORMATTER.format(totals.total)} kr.</strong>`;
  totalsRow.appendChild(materials);
  totalsRow.appendChild(total);

  card.appendChild(top);
  card.appendChild(metaGrid);
  card.appendChild(totalsRow);
  card.appendChild(createCaseActions(entry, userId, onChange));
  return card;
}

function sortEntries(entries, sortKey) {
  const list = entries.slice();
  if (sortKey === 'oldest') {
    return list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }
  if (sortKey === 'total-desc') {
    return list.sort((a, b) => resolveCaseTotals(b, resolveCaseMeta(b)).total - resolveCaseTotals(a, resolveCaseMeta(a)).total);
  }
  if (sortKey === 'total-asc') {
    return list.sort((a, b) => resolveCaseTotals(a, resolveCaseMeta(a)).total - resolveCaseTotals(b, resolveCaseMeta(b)).total);
  }
  return list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function renderBoard(entries, userId, onChange) {
  const board = document.createElement('div');
  board.className = 'shared-board';
  const buckets = new Map();
  BOARD_COLUMNS.forEach(column => {
    buckets.set(column.id, []);
  });
  entries.forEach(entry => {
    const bucketId = resolveCaseStatusBucket(entry.status);
    const bucket = buckets.get(bucketId) || buckets.get('andet');
    bucket.push(entry);
  });
  BOARD_COLUMNS.forEach(column => {
    const columnEl = document.createElement('section');
    columnEl.className = 'shared-board-column';
    const header = document.createElement('div');
    header.className = 'shared-board-header';
    const title = document.createElement('h3');
    title.className = 'shared-board-title';
    title.textContent = column.label;
    const meta = document.createElement('span');
    meta.className = 'shared-board-meta';
    const columnEntries = buckets.get(column.id) || [];
    meta.textContent = `${columnEntries.length} sager`;
    header.appendChild(title);
    header.appendChild(meta);
    if (column.hint) {
      const hint = document.createElement('div');
      hint.className = 'shared-board-meta';
      hint.textContent = column.hint;
      columnEl.appendChild(header);
      columnEl.appendChild(hint);
    } else {
      columnEl.appendChild(header);
    }
    const list = document.createElement('div');
    list.className = 'shared-board-list';
    columnEntries.forEach(entry => list.appendChild(renderCaseCard(entry, userId, onChange)));
    if (!columnEntries.length) {
      const empty = document.createElement('div');
      empty.className = 'shared-board-meta';
      empty.textContent = 'Ingen sager';
      list.appendChild(empty);
    }
    columnEl.appendChild(list);
    board.appendChild(columnEl);
  });
  return board;
}

function setSharedStatus(text) {
  renderStatusSummary(text);
}

function setRefreshState(state = 'idle') {
  if (!refreshBtn) return;
  const label = state === 'loading' ? 'Opdaterer…' : state === 'error' ? 'Prøv igen' : 'Opdater';
  refreshBtn.textContent = label;
  refreshBtn.disabled = state === 'loading';
}

function updateSharedStatus(message) {
  const summaryMessage = message || '';
  setSharedStatus(summaryMessage);
  updateStatusCard();
}

async function fetchCasesPage({ reset = false } = {}) {
  if (isLoadingMore) return null;
  if (!requireAuth()) return null;
  isLoadingMore = true;
  try {
    const filters = reset ? getFilters() : (activeFilters || getFilters());
    if (reset) {
      activeFilters = filters;
      pagedEntries = [];
      nextCursor = null;
    }
    const serverFilters = resolveServerFilters(filters);
    const page = await listSharedCasesPage(ensureTeamSelected(), {
      limit: 100,
      cursor: nextCursor,
      status: serverFilters.status,
      q: serverFilters.q,
      from: serverFilters.from,
      to: serverFilters.to,
    });
    const items = Array.isArray(page?.items) ? page.items : [];
    pagedEntries = reset ? items : pagedEntries.concat(items);
    nextCursor = page?.nextCursor || null;
    return { entries: pagedEntries.slice(), filters };
  } finally {
    isLoadingMore = false;
  }
}

function renderSharedCases(container, entries, filters, userId, onChange) {
  container.textContent = '';
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Ingen delte sager endnu.';
    container.appendChild(empty);
    return;
  }
  container.appendChild(renderBoard(entries, userId, onChange));
  if (nextCursor) {
    loadMoreBtn = document.createElement('button');
    loadMoreBtn.type = 'button';
    loadMoreBtn.className = 'shared-load-more';
    loadMoreBtn.textContent = 'Hent flere';
    loadMoreBtn.addEventListener('click', async () => {
      if (isLoadingMore) return;
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = 'Henter…';
      try {
        const page = await fetchCasesPage({ reset: false });
        if (!page) return;
        const filtered = page.entries.filter(entry => {
          const meta = resolveCaseMeta(entry);
          return matchesFilters(entry, meta, page.filters);
        });
        const sorted = sortEntries(filtered, page.filters.sort);
        renderSharedCases(container, sorted, page.filters, userId, onChange);
        setSharedStatus('Synkroniseret');
        clearInlineError();
      } catch (error) {
        console.error('Kunne ikke hente flere delte sager', error);
        handleActionError(error, 'Kunne ikke hente flere sager', { teamContext: teamId });
        appendDebug(`Load more fejl: ${error?.message || 'Ukendt fejl'}`);
      }
    });
    container.appendChild(loadMoreBtn);
  }
}

export function initSharedCasesPanel() {
  if (sharedCasesPanelInitialized) return;
  const container = document.getElementById('sharedCasesList');
  if (!container) return;
  sessionState = getSessionState?.() || {};
  displayTeamId = sessionState.displayTeamId || displayTeamId || DEFAULT_TEAM_SLUG;
  teamId = sessionState.teamId || teamId || formatTeamId(DEFAULT_TEAM_SLUG);
  membershipRole = sessionState.role || membershipRole;
  sharedCasesPanelInitialized = true;
  sharedCard = document.querySelector('#panel-delte-sager .shared-cases');
  statusBox = document.getElementById('sharedStatus');
  errorBanner = document.getElementById('sharedInlineError');
  statusUser = document.getElementById('sharedStatusUser');
  statusEmail = document.getElementById('sharedStatusEmail');
  debugPanel = document.getElementById('sharedDebugPanel');
  debugLogOutput = document.getElementById('sharedDebugLog');
  setPanelVisibility(false);
  refreshBtn = document.getElementById('refreshSharedCases');
  const filters = ['sharedSearchInput', 'sharedDateFrom', 'sharedDateTo', 'sharedFilterStatus', 'sharedFilterKind', 'sharedSort']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  applyStoredFilters();
  updateSharedStatus();
  updateStatusCard();

  const refresh = async () => {
    if (!container) return;
    if (!requireAuth()) {
      container.textContent = teamError || sessionState?.message || 'Login mangler.';
      setRefreshState('idle');
      return;
    }
    setRefreshState('loading');
    container.textContent = 'Henter sager…';
    const currentUser = sessionState?.user?.uid || 'offline-user';
    try {
      const page = await fetchCasesPage({ reset: true });
      if (!page) {
        setRefreshState('idle');
        return;
      }
      const filtered = page.entries.filter(entry => {
        const meta = resolveCaseMeta(entry);
        return matchesFilters(entry, meta, page.filters);
      });
      const sorted = sortEntries(filtered, page.filters.sort);
      renderSharedCases(container, sorted, page.filters, currentUser, refresh);
      setSharedStatus('Synkroniseret');
      clearInlineError();
      setRefreshState('idle');
    } catch (error) {
      console.error('Kunne ikke hente delte sager', error);
      const denied = error?.code === 'permission-denied' || error instanceof PermissionDeniedError;
      const message = describePermissionError(error, teamId) || error?.message || 'Kunne ikke hente delte sager.';
      const status = typeof error?.status === 'number' ? error.status : 0;
      const looksLikeAuth = status === 401 || message.includes('"iss"') || message.includes('"aud"');
      if (denied) teamError = message;
      container.textContent = looksLikeAuth
        ? `${message} (Login token matcher ikke serverens Auth0-konfig. Prøv Log ud → Log ind igen.)`
        : `${message} ${denied ? '' : 'Tjek netværk eller log ind igen.'}`.trim();
      setInlineError(message);
      setSharedStatus(`Fejl: ${message}`);
      setRefreshState('error');
      appendDebug(`Liste fejl: ${message}`);
    }
  };

  if (refreshBtn) refreshBtn.addEventListener('click', refresh);
  filters.forEach(input => {
    input.addEventListener('input', () => refresh());
    input.addEventListener('change', () => refresh());
  });

  bindSessionControls(() => refresh(), () => {
    if (!requireAuth()) {
      container.textContent = teamError || sessionState?.message || 'Log ind for at se delte sager.';
      setRefreshState('idle');
      return;
    }
    refresh();
  });

  // Automatically refresh the shared cases list when a case is exported. The
  // export workflow dispatches a `cssmate:exported` event; listening here
  // ensures that newly shared cases appear without requiring manual refresh.
  if (typeof window !== 'undefined') {
    window.addEventListener('cssmate:exported', () => {
      try {
        if (requireAuth()) {
          const fromInput = document.getElementById('sharedDateFrom');
          const toInput = document.getElementById('sharedDateTo');
          if (fromInput) fromInput.value = '';
          if (toInput) toInput.value = '';
          refresh();
        }
      } catch (error) {
        // Ignore errors (likely due to no auth), since refresh will run on next auth change.
      }
    });
  }
}

export { formatMissingMembershipMessage };
