import { listSharedCasesPage, listSharedCasesDelta, downloadCaseJson, importCasePayload, approveSharedCase, deleteSharedCase, getSharedCase, getSharedCaseAudit, formatTeamId, PermissionDeniedError, getDisplayTeamId, MembershipMissingError, DEFAULT_TEAM_SLUG, setSharedCaseContext, updateSharedCaseStatus } from './shared-ledger.js';
import { exportPDFBlob } from './export-pdf.js';
import { buildExportModel } from './export-model.js';
import { downloadBlob } from './utils/downloadBlob.js';
import { getUserDisplay } from './shared-auth.js';
import { initAuthSession, onChange as onSessionChange, getState as getSessionState, SESSION_STATUS } from '../src/auth/session.js';
import { TEAM_ACCESS_STATUS } from '../src/services/team-access.js';
import { normalizeSearchValue, formatDateLabel } from './history-normalizer.js';
import { showToast } from '../src/ui/toast.js';
import { getPreviewWriteDisabledMessage } from '../src/lib/deploy-context.js';
import { debugLog, debugWarn, isDebugEnabled } from '../src/lib/debug.js';

let sharedCasesPanelInitialized = false;
let refreshBtn;
let sessionState = {};
let sharedCard;
let sharedCasesContainer;
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
const casesById = new Map();
let caseItems = [];
let nextCursor = null;
let hasMore = false;
let seenCursorKeys = new Set();
let activeFilters = null;
let isLoading = false;
let loadingCount = 0;
let loadMoreBtn;
let listSharedCasesPageFn = listSharedCasesPage;
let refreshCases = async () => {};
let deltaTimer = null;
let deltaInFlight = false;
let lastDeltaAt = null;
let lastDeltaCaseId = '';
let pollingActive = false;
let pollingReason = '';
let lastDeltaSyncLabel = '';
let latestRequestId = 0;
let lastFiltersSnapshot = null;
let debouncedFilterRender = null;
let debouncedQuickRender = null;
let caseItemsVersion = 0;
let renderCache = {
  version: -1,
  filterKey: '',
  sortKey: '',
  allCounts: null,
  scopeEntries: null,
  displayEntries: null,
  sortedEntries: null,
};
let lastFocusStatus = '';
const sharedCasesUI = {
  search: '',
  from: '',
  to: '',
  statusFocus: '',
  isRefreshing: false,
  lastUpdatedLabel: '',
};
let statusMessage = '';
const UI_STORAGE_KEY = 'cssmate:shared-cases:ui:v1';
const PENDING_ACTIONS_KEY = 'cssmate:shared-cases:pending-actions:v1';
const CASE_META_CACHE = new Map();
const DATE_INPUT_FORMATTER = new Intl.DateTimeFormat('sv-SE');
const CURRENCY_FORMATTER = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CURRENCY_FORMATTER_COMPACT = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const HOURS_FORMATTER = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const PREVIEW_WRITE_MESSAGE = getPreviewWriteDisabledMessage();
const POLL_INTERVAL_MS = 30000;
const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 60000;
const syncState = {
  online: isOnline(),
  isSyncing: false,
  lastSyncAt: null,
  since: null,
  sinceId: null,
  backoffMs: 0,
  pendingActions: [],
};
let activeCaseMenu = null;
let activeCaseMenuButton = null;
let activeCaseMenuCleanup = null;
let activeCaseDetail = null;
let activeCaseDetailRequestId = 0;
let pendingDeepLinkCaseId = '';
let deepLinkHandled = false;
let lastRenderUserId = '';
let lastRenderOnChange = null;

const WORKFLOW_STATUS = {
  DRAFT: 'kladde',
  APPROVED: 'godkendt',
  DEMONTAGE: 'demontage_i_gang',
  DONE: 'afsluttet',
  DELETED: 'deleted',
};
const BOARD_STATUSES = [
  WORKFLOW_STATUS.DRAFT,
  WORKFLOW_STATUS.APPROVED,
  WORKFLOW_STATUS.DEMONTAGE,
  WORKFLOW_STATUS.DONE,
];
const STATUS_COLUMNS = [
  { id: WORKFLOW_STATUS.DRAFT, label: 'Kladde', hint: 'Kladder før deling.' },
  { id: WORKFLOW_STATUS.APPROVED, label: 'Godkendt', hint: 'Montage er godkendt og klar til demontage.' },
  { id: WORKFLOW_STATUS.DEMONTAGE, label: 'Demontage i gang', hint: 'Demontage er i gang.' },
  { id: WORKFLOW_STATUS.DONE, label: 'Afsluttet', hint: 'Sager der er afsluttet.' },
];
const STATUS_UI = {
  [WORKFLOW_STATUS.DRAFT]: { label: 'Kladde' },
  [WORKFLOW_STATUS.APPROVED]: { label: 'Godkendt' },
  [WORKFLOW_STATUS.DEMONTAGE]: { label: 'Demontage i gang' },
  [WORKFLOW_STATUS.DONE]: { label: 'Afsluttet' },
  [WORKFLOW_STATUS.DELETED]: { label: 'Slettet' },
};

function getBoardColumns({ includeDeleted = false } = {}) {
  if (!includeDeleted) return STATUS_COLUMNS;
  return [
    ...STATUS_COLUMNS,
    { id: WORKFLOW_STATUS.DELETED, label: 'Slettet', hint: 'Soft-deleted sager (admin).' },
  ];
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function findElementByIds(...ids) {
  if (typeof document === 'undefined') return null;
  for (const id of ids) {
    if (!id) continue;
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}

function getSharedCasesElements() {
  return {
    searchEl: findElementByIds('sharedCasesSearch', 'sharedSearchInput'),
    fromEl: findElementByIds('sharedCasesFrom', 'sharedDateFrom'),
    toEl: findElementByIds('sharedCasesTo', 'sharedDateTo'),
    focusEl: findElementByIds('sharedCasesStatusFocus', 'sharedFilterStatus'),
    resetBtn: findElementByIds('sharedCasesResetBtn', 'sharedResetBtn'),
    refreshBtn: findElementByIds('sharedCasesRefreshBtn', 'refreshSharedCases'),
    kindEl: findElementByIds('sharedFilterKind'),
    sortEl: findElementByIds('sharedSort'),
    countEl: findElementByIds('sharedCasesTotalCount'),
    lastUpdatedEl: findElementByIds('sharedCasesLastUpdated'),
  };
}

function debounce(fn, waitMs = 300) {
  let timerId;
  return (...args) => {
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(() => {
      timerId = null;
      fn(...args);
    }, waitMs);
  };
}

function startLoading() {
  loadingCount += 1;
  isLoading = loadingCount > 0;
}

function stopLoading() {
  loadingCount = Math.max(0, loadingCount - 1);
  isLoading = loadingCount > 0;
}

function touchCaseItems() {
  caseItemsVersion += 1;
  renderCache = {
    version: -1,
    filterKey: '',
    sortKey: '',
    allCounts: null,
    scopeEntries: null,
    displayEntries: null,
    sortedEntries: null,
  };
}

function formatTimeLabel(value) {
  const d = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function formatTimeShort(value) {
  const d = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatRelativeTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60 * 1000) return 'lige nu';
  if (diffMs < 60 * 60 * 1000) return `${Math.floor(diffMs / (60 * 1000))} min siden`;
  if (diffMs < 24 * 60 * 60 * 1000) return `${Math.floor(diffMs / (60 * 60 * 1000))} t siden`;
  return `${Math.floor(diffMs / (24 * 60 * 60 * 1000))} d siden`;
}

function formatRelativeDa(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60 * 1000) return 'cirka 1 min siden';
  if (diffMs < 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.round(diffMs / (60 * 1000)));
    return `cirka ${minutes} min siden`;
  }
  if (diffMs < 24 * 60 * 60 * 1000) {
    const hours = Math.max(1, Math.round(diffMs / (60 * 60 * 1000)));
    return `cirka ${hours} ${hours === 1 ? 'time' : 'timer'} siden`;
  }
  if (diffMs < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.max(1, Math.round(diffMs / (24 * 60 * 60 * 1000)));
    return `cirka ${days} ${days === 1 ? 'dag' : 'dage'} siden`;
  }
  return `cirka ${Math.max(1, Math.round(diffMs / (24 * 60 * 60 * 1000)))} dage siden`;
}

function formatEditorLabel(value) {
  if (!value) return '–';
  const text = value.toString();
  if (text.length <= 10) return text;
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}

function formatEditorShort(value) {
  if (!value) return 'ukendt';
  const text = value.toString();
  if (text.length <= 8) return text;
  return text.slice(0, 8);
}

function sanitizeFileName(value) {
  return (value || 'case')
    .toString()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-_]+/g, '') || 'case';
}

function buildCaseDetailLink(caseId) {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  url.searchParams.set('tab', 'delte-sager');
  url.searchParams.set('caseId', caseId);
  return url.toString();
}

function updateCaseIdInUrl(caseId) {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  if (caseId) {
    url.searchParams.set('tab', 'delte-sager');
    url.searchParams.set('caseId', caseId);
  } else {
    url.searchParams.delete('caseId');
  }
  window.history.replaceState({}, '', url.toString());
}

function readDeepLinkCaseId() {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  const caseId = params.get('caseId') || '';
  const tab = params.get('tab') || '';
  if (!caseId) return '';
  if (tab && tab !== 'delte-sager') return '';
  return caseId;
}

function isOnline() {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

function isDevEnvironment() {
  if (typeof process !== 'undefined' && process?.env?.NODE_ENV) {
    return process.env.NODE_ENV !== 'production';
  }
  if (typeof window !== 'undefined') {
    const host = window.location?.hostname || '';
    return host === 'localhost' || host === '127.0.0.1';
  }
  return false;
}

function warnMissingCaseId(entry) {
  if (!isDevEnvironment()) return;
  const summary = entry && typeof entry === 'object'
    ? { status: entry.status, phase: entry.phase, teamId: entry.teamId, id: entry.id }
    : { entry };
  console.warn('Delte sager: sag mangler caseId/id og springes over.', summary);
}

function getDeltaKey(entry) {
  if (!entry) return { updatedAt: '', caseId: '' };
  return {
    updatedAt: entry.last_updated_at || entry.lastUpdatedAt || entry.updatedAt || entry.createdAt || '',
    caseId: entry.caseId || '',
  };
}

function compareDeltaKeys(a, b) {
  if (a.updatedAt !== b.updatedAt) {
    return (a.updatedAt || '').localeCompare(b.updatedAt || '');
  }
  return (a.caseId || '').localeCompare(b.caseId || '');
}

function getMaxDeltaKey(entries) {
  let maxKey = { updatedAt: '', caseId: '' };
  entries.forEach(entry => {
    const key = getDeltaKey(entry);
    if (compareDeltaKeys(maxKey, key) < 0) {
      maxKey = key;
    }
  });
  return maxKey;
}

function getLiveStatusLabel() {
  if (!pollingActive && !pollingReason) return '';
  if (!pollingActive) return `Live: pauset (${pollingReason})`;
  const lastLabel = lastDeltaSyncLabel ? ` (sidst ${lastDeltaSyncLabel})` : '';
  return `Live: tjekker hvert ${Math.round(POLL_INTERVAL_MS / 1000)}s${lastLabel}`;
}

function getSyncStatusLabel() {
  const pendingCount = syncState.pendingActions.length;
  if (!syncState.online) {
    return pendingCount > 0
      ? `Offline – afventer sync (${pendingCount})`
      : 'Offline';
  }
  if (syncState.isSyncing) return 'Synkroniserer…';
  if (pendingCount > 0) return `Afventer sync (${pendingCount})`;
  if (syncState.lastSyncAt) return 'Synkroniseret';
  return '';
}

function composeStatusMessage(message) {
  const syncLabel = getSyncStatusLabel();
  const liveLabel = getLiveStatusLabel();
  const parts = [message, syncLabel, liveLabel].filter(Boolean);
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  return unique.join(' · ');
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
  if (code === 'preview-disabled' || normalized.includes('writes disabled in preview deployments')) {
    return PREVIEW_WRITE_MESSAGE;
  }
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
  if (typeof document === 'undefined') return;
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

function updateAdminControls() {
  if (typeof document === 'undefined') return;
  const { focusEl } = getSharedCasesElements();
  if (!focusEl) return;
  const deletedOption = focusEl.querySelector('option[value="deleted"]');
  const adminVisible = isAdminUser();
  if (deletedOption) {
    deletedOption.hidden = !adminVisible;
  }
  if (!adminVisible && focusEl.value === WORKFLOW_STATUS.DELETED) {
    focusEl.value = '';
  }
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

function setPendingActions(actions, { persist = true } = {}) {
  const normalized = Array.isArray(actions) ? actions.filter(action => action && action.caseId && action.type) : [];
  syncState.pendingActions = normalized;
  if (persist) {
    savePendingActions(teamId, normalized);
  }
  applyPendingMarkers(casesById);
  touchCaseItems();
  if (sharedCasesContainer) {
    renderFromState(sharedCasesContainer, sessionState?.user?.uid || 'offline-user');
  }
  updateSyncStatus();
}

function loadPendingActionsForTeam(teamIdValue) {
  const stored = loadPendingActions(teamIdValue);
  setPendingActions(stored, { persist: false });
  return stored;
}

function enqueuePendingAction(action) {
  if (!action?.caseId || !action?.type) return;
  const current = syncState.pendingActions.slice();
  const filtered = current.filter(entry => {
    if (!entry || entry.caseId !== action.caseId) return true;
    if (action.type === 'delete') return false;
    return entry.type !== action.type;
  });
  filtered.push(action);
  setPendingActions(filtered);
}

function removePendingAction(action) {
  if (!action?.caseId || !action?.type) return;
  const next = syncState.pendingActions.filter(entry => !(entry.caseId === action.caseId && entry.type === action.type));
  setPendingActions(next);
}

async function handleConflictError(error, previousEntry, onChange, { retryAction, discardAction, caseId } = {}) {
  if (!error || error?.status !== 409) return false;
  const payloadCase = error?.payload?.case || null;
  const merged = payloadCase ? normalizeStoredEntry(payloadCase, previousEntry) : previousEntry;
  const resolvedCaseId = caseId || previousEntry?.caseId || merged?.caseId || payloadCase?.caseId || '';
  if (merged) {
    if (typeof onChange === 'function') {
      onChange({ updatedCase: { ...merged, __syncing: false } });
    } else {
      updateCaseEntry({ ...merged, __syncing: false });
    }
  }
  setInlineError('Sagen er ændret af en anden.');
  openConflictModal({
    entry: merged,
    onDiscard: async () => {
      try {
        if (!resolvedCaseId) {
          if (typeof discardAction === 'function') discardAction(merged || previousEntry);
          updateSharedStatus('Synkroniseret');
          return;
        }
        const fresh = await getSharedCase(ensureTeamSelected(), resolvedCaseId);
        if (fresh) {
          updateCaseEntry({ ...fresh, __syncing: false });
        }
        if (typeof discardAction === 'function') discardAction(fresh);
        updateSharedStatus('Synkroniseret');
      } catch (err) {
        handleActionError(err, 'Kunne ikke hente sag', { teamContext: teamId });
        showToast(err?.message || 'Kunne ikke hente sag.', { variant: 'error' });
      }
    },
    onOverwrite: async () => {
      try {
        if (!resolvedCaseId) {
          if (typeof retryAction === 'function') {
            await retryAction(merged || previousEntry);
          }
          updateSharedStatus('Synkroniseret');
          return;
        }
        const fresh = await getSharedCase(ensureTeamSelected(), resolvedCaseId);
        if (typeof retryAction === 'function') {
          await retryAction(fresh || merged || previousEntry);
        }
        updateSharedStatus('Synkroniseret');
      } catch (err) {
        handleActionError(err, 'Kunne ikke overskrive sag', { teamContext: teamId });
        showToast(err?.message || 'Kunne ikke overskrive sag.', { variant: 'error' });
      }
    },
  });
  return true;
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

function getPendingActionsKey(teamIdValue) {
  const resolved = teamIdValue || teamId || formatTeamId(DEFAULT_TEAM_SLUG);
  return `${PENDING_ACTIONS_KEY}:${resolved}`;
}

function loadPendingActions(teamIdValue) {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(getPendingActionsKey(teamIdValue));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePendingActions(teamIdValue, entries) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(getPendingActionsKey(teamIdValue), JSON.stringify(entries));
  } catch {
    // ignore storage errors
  }
}

function normalizeStoredStatusFilter(value) {
  if (!value) return '';
  if (value === 'draft') return WORKFLOW_STATUS.DRAFT;
  if (value === 'ready_for_demontage') return WORKFLOW_STATUS.APPROVED;
  if (value === 'completed') return WORKFLOW_STATUS.DONE;
  if (value === WORKFLOW_STATUS.DELETED || value === 'deleted') {
    return isAdminUser() ? WORKFLOW_STATUS.DELETED : '';
  }
  return value;
}

function setListSharedCasesPage(fn) {
  listSharedCasesPageFn = typeof fn === 'function' ? fn : listSharedCasesPage;
}

function setRefreshHandler(fn) {
  refreshCases = typeof fn === 'function' ? fn : async () => {};
}

function applyStoredFilters() {
  const state = loadUiState();
  const { searchEl, fromEl, toEl, focusEl, kindEl, sortEl } = getSharedCasesElements();
  const statusFocus = normalizeStoredStatusFilter(state.statusFocus || state.status || '');
  if (searchEl && typeof state.search === 'string') searchEl.value = state.search;
  if (fromEl && typeof state.dateFrom === 'string') fromEl.value = state.dateFrom;
  if (toEl && typeof state.dateTo === 'string') toEl.value = state.dateTo;
  if (focusEl && typeof statusFocus === 'string') focusEl.value = statusFocus;
  if (kindEl && typeof state.kind === 'string') kindEl.value = state.kind;
  if (sortEl && typeof state.sort === 'string') sortEl.value = state.sort;
  sharedCasesUI.search = typeof state.search === 'string' ? state.search : '';
  sharedCasesUI.from = typeof state.dateFrom === 'string' ? state.dateFrom : '';
  sharedCasesUI.to = typeof state.dateTo === 'string' ? state.dateTo : '';
  sharedCasesUI.statusFocus = statusFocus || '';
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

function resolveProjectKey(entry, meta) {
  const jobNumber = (meta?.jobNumber || entry?.jobNumber || '').toString().trim();
  if (jobNumber) return `job:${jobNumber}`;
  return entry?.caseId || '';
}

function formatDateInput(value) {
  if (!value) return '';
  const timestamp = safeParseDate(value);
  if (timestamp === null) return '';
  return DATE_INPUT_FORMATTER.format(new Date(timestamp));
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

function safeParseDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) return null;
    return value.getTime();
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date.getTime();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (dateOnlyMatch) {
      const year = Number(dateOnlyMatch[1]);
      const month = Number(dateOnlyMatch[2]);
      const day = Number(dateOnlyMatch[3]);
      const date = new Date(year, month - 1, day);
      return Number.isNaN(date.valueOf()) ? null : date.getTime();
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function getEntryTimestamp(entry) {
  if (!entry) return null;
  const raw = entry.lastUpdatedAt
    || entry.updatedAt
    || entry.updated_at
    || entry.last_updated_at
    || entry.createdAt
    || entry.created_at
    || '';
  return safeParseDate(raw);
}

function getSearchText(entry, meta) {
  return [
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
  ]
    .filter(Boolean)
    .join(' ');
}

function resolveCaseTotals(entry, meta) {
  const totals = meta?.totals || entry?.totals || {};
  const materials = Number(totals.materials ?? totals.materialsSum ?? totals.materialTotal ?? 0) || 0;
  const total = Number(totals.total ?? totals.project ?? totals.akkord ?? totals.projectTotal ?? 0) || 0;
  return { materials, total };
}

function resolveCaseDate(entry, meta) {
  const dateValue = meta?.date
    || entry?.lastUpdatedAt
    || entry?.updatedAt
    || entry?.updated_at
    || entry?.createdAt
    || entry?.created_at
    || '';
  const formatted = formatDateLabel(dateValue);
  const timestamp = safeParseDate(dateValue);
  const iso = timestamp ? new Date(timestamp).toISOString() : '';
  return { raw: dateValue, formatted, iso };
}

function normalizeStatusValue(value) {
  const normalized = (value || '').toString().trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'draft') return WORKFLOW_STATUS.DRAFT;
  if (normalized === 'ready_for_demontage') return WORKFLOW_STATUS.APPROVED;
  if (normalized === 'completed') return WORKFLOW_STATUS.DONE;
  if (normalized === 'klar_til_deling' || normalized === 'klar') return WORKFLOW_STATUS.DRAFT;
  if (normalized === 'klar_til_demontage' || normalized === 'ready') return WORKFLOW_STATUS.APPROVED;
  return normalized;
}

function deriveBoardStatus(entry) {
  const statusValue = normalizeStatusValue(entry?.status || entry?.workflowStatus || '');
  if (statusValue === WORKFLOW_STATUS.DELETED) return WORKFLOW_STATUS.DELETED;
  if (BOARD_STATUSES.includes(statusValue)) return statusValue;
  const phaseValue = normalizeStatusValue(entry?.phase || entry?.workflowPhase || entry?.workflowStatus || '');
  if (phaseValue === WORKFLOW_STATUS.DONE) return WORKFLOW_STATUS.DONE;
  if (phaseValue === WORKFLOW_STATUS.APPROVED) return WORKFLOW_STATUS.APPROVED;
  if (phaseValue === WORKFLOW_STATUS.DEMONTAGE) return WORKFLOW_STATUS.DEMONTAGE;
  return WORKFLOW_STATUS.DRAFT;
}

function resolveEntryBucket(entry) {
  if (entry?.__viewBucket) return entry.__viewBucket;
  return deriveBoardStatus(entry);
}

function computeBucketCounts(entries, { includeDeleted = false } = {}) {
  const counts = new Map();
  getBoardColumns({ includeDeleted }).forEach(column => {
    counts.set(column.id, 0);
  });
  entries.forEach(entry => {
    const bucketId = deriveBoardStatus(entry);
    const resolved = counts.has(bucketId) ? bucketId : WORKFLOW_STATUS.DRAFT;
    counts.set(resolved, (counts.get(resolved) || 0) + 1);
  });
  return counts;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeStoredEntry(entry, existing) {
  const base = existing ? { ...existing, ...entry } : { ...entry };
  if (!entry || typeof entry !== 'object') return base;
  const updatedAtValue = entry.lastUpdatedAt
    || entry.last_updated_at
    || entry.updatedAt
    || entry.createdAt
    || base.lastUpdatedAt
    || base.updatedAt
    || base.createdAt
    || '';
  if (updatedAtValue) {
    base.lastUpdatedAt = updatedAtValue;
    if (!base.updatedAt) base.updatedAt = updatedAtValue;
  }
  if (!hasOwn(entry, '__syncing')) {
    delete base.__syncing;
  }
  if (!hasOwn(entry, '__pendingAction')) {
    delete base.__pendingAction;
  }
  if (!hasOwn(entry, '__viewBucket')) {
    delete base.__viewBucket;
  }
  return base;
}

function applyPendingMarkers(map) {
  const pendingIds = new Set(syncState.pendingActions.map(action => action.caseId));
  map.forEach((value, key) => {
    if (pendingIds.has(key)) {
      value.__pendingAction = true;
    } else if (value.__pendingAction) {
      delete value.__pendingAction;
    }
  });
}

function countsToObject(counts) {
  const summary = {};
  counts.forEach((value, key) => {
    summary[key] = value;
  });
  return summary;
}

function getFilterKey(filters) {
  if (!filters) return '';
  return [
    filters.search || '',
    filters.dateFrom || '',
    filters.dateTo || '',
    filters.statusFocus || '',
    filters.kind || '',
  ].join('|');
}

function areFiltersEqual(a, b) {
  if (!a || !b) return false;
  return a.search === b.search
    && a.dateFrom === b.dateFrom
    && a.dateTo === b.dateTo
    && a.statusFocus === b.statusFocus
    && a.kind === b.kind
    && a.sort === b.sort;
}

function logFilterChange(nextFilters, { total }) {
  if (!isDebugEnabled()) return;
  const previous = lastFiltersSnapshot || {};
  const changed = Object.keys(nextFilters || {}).some(key => previous[key] !== nextFilters[key]);
  if (!changed) return;
  debugLog('shared-cases filters changed', {
    from: previous,
    to: nextFilters,
    total,
  });
  lastFiltersSnapshot = { ...nextFilters };
}

function formatStatusLabel(status) {
  const normalized = normalizeStatusValue(status);
  if (STATUS_UI[normalized]) return STATUS_UI[normalized].label;
  return 'Ukendt';
}

function formatEntryStatusLabel(entry) {
  const statusValue = normalizeStatusValue(entry?.status);
  const rawStatus = (entry?.status || '').toString().trim().toLowerCase();
  if (rawStatus === 'klar_til_deling') return 'Klar til deling';
  if (STATUS_UI[statusValue]) return formatStatusLabel(statusValue);
  return formatStatusLabel(deriveBoardStatus(entry));
}

function resolveSheetPhase(entry) {
  const phase = (entry?.sheetPhase || entry?.caseKind || '').toString().trim().toLowerCase();
  if (phase === 'demontage') return 'demontage';
  const demontagePayload = resolveAttachmentPayload(entry?.attachments?.demontage);
  const montagePayload = resolveAttachmentPayload(entry?.attachments?.montage);
  if (demontagePayload && !montagePayload) return 'demontage';
  if (normalizeStatusValue(entry?.status) === WORKFLOW_STATUS.DEMONTAGE) return 'demontage';
  return 'montage';
}

function resolvePhaseForEntry(entry) {
  return resolveSheetPhase(entry);
}

function resolveOptimisticStatus(entry) {
  const bucket = resolveEntryBucket(entry);
  if (bucket === WORKFLOW_STATUS.DRAFT) return WORKFLOW_STATUS.APPROVED;
  if (bucket === WORKFLOW_STATUS.DEMONTAGE) return WORKFLOW_STATUS.DONE;
  return normalizeStatusValue(entry?.status || '');
}

function updateSharedHeaderCount(total) {
  if (typeof document === 'undefined') return;
  const { countEl } = getSharedCasesElements();
  if (!countEl) return;
  const value = Number(total) || 0;
  countEl.textContent = `${value} sager`;
}

function updateSharedLastUpdatedLabel(value) {
  if (typeof document === 'undefined') return;
  const { lastUpdatedEl } = getSharedCasesElements();
  const label = value ? formatTimeShort(value) : '';
  sharedCasesUI.lastUpdatedLabel = label;
  if (!lastUpdatedEl) return;
  lastUpdatedEl.textContent = label ? `Sidst opdateret: ${label}` : 'Sidst opdateret: –';
}

function buildSearchIndex(entry, meta) {
  const date = resolveCaseDate(entry, meta);
  const totals = resolveCaseTotals(entry, meta);
  const searchText = getSearchText(entry, meta);
  const values = [
    searchText,
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
    const previousTeamId = teamId;
    sessionState = state || {};
    teamId = state?.teamId ? formatTeamId(state.teamId) : '';
    displayTeamId = state?.displayTeamId || (teamId ? getDisplayTeamId(teamId) : DEFAULT_TEAM_SLUG);
    membershipRole = state?.role || '';
    membershipError = null;
    teamError = '';
    if (teamId) {
      loadPendingActionsForTeam(teamId);
    } else {
      setPendingActions([], { persist: false });
    }
    if (previousTeamId && teamId && teamId !== previousTeamId) {
      resetCaseState();
    }
    const accessStatus = state?.accessStatus || TEAM_ACCESS_STATUS.CHECKING;
    if (state?.status === SESSION_STATUS.SIGNED_OUT) {
      debugMessagesSeen.clear();
      resetCaseState();
    }
    if (state?.status === SESSION_STATUS.NO_ACCESS || state?.status === SESSION_STATUS.ERROR || accessStatus !== TEAM_ACCESS_STATUS.OK) {
      teamError = state?.message || teamError || '';
      if (state?.user?.uid && accessStatus !== TEAM_ACCESS_STATUS.OK) {
        membershipError = new MembershipMissingError(teamId, state?.user?.uid || 'uid', state?.message || '');
      }
      if (state?.status === SESSION_STATUS.NO_ACCESS || state?.status === SESSION_STATUS.ERROR) {
        debugMessagesSeen.clear();
        resetCaseState();
      }
    }
    const hasAccess = Boolean(state?.sessionReady);
    setPanelVisibility(Boolean(state?.sessionReady));
    updateSharedStatus();
    updateStatusCard();
    updateAdminControls();
    updatePollingState();

    if (hasAccess && lastStatus !== state.status) {
      if (typeof onAccessReady === 'function') onAccessReady();
    }

    if (hasAccess && typeof onAuthenticated === 'function') {
      onAuthenticated();
    }

    if (hasAccess) {
      syncState.online = isOnline();
      updateSyncStatus();
      if (syncState.online) {
        flushPendingActions().catch(() => {});
      }
    }

    lastStatus = state?.status || '';
  });
}

function getFilters() {
  if (typeof document === 'undefined') {
    return {
      search: '',
      dateFrom: '',
      dateTo: '',
      statusFocus: '',
      kind: '',
      sort: 'updated-desc',
    };
  }
  const { searchEl, fromEl, toEl, focusEl, kindEl, sortEl } = getSharedCasesElements();
  const filters = {
    search: (searchEl?.value || '').trim(),
    dateFrom: fromEl?.value || '',
    dateTo: toEl?.value || '',
    statusFocus: normalizeStoredStatusFilter(focusEl?.value || ''),
    kind: kindEl?.value || '',
    sort: sortEl?.value || 'updated-desc',
  };
  sharedCasesUI.search = filters.search;
  sharedCasesUI.from = filters.dateFrom;
  sharedCasesUI.to = filters.dateTo;
  sharedCasesUI.statusFocus = filters.statusFocus;
  saveUiState({
    search: filters.search,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    statusFocus: filters.statusFocus,
    kind: filters.kind,
    sort: filters.sort,
  });
  return filters;
}

function matchesFilters(entry, meta, filters) {
  const searchValue = normalizeSearchValue(filters.search);
  const tokens = searchValue ? searchValue.split(' ').filter(Boolean) : [];
  const searchIndex = buildSearchIndex(entry, meta);
  const matchesSearch = tokens.length === 0
    || tokens.every(token => searchIndex.some(value => value.includes(token)));
  const kindValue = (entry.caseKind || meta?.jobType || '').toLowerCase();
  const kindMatch = !filters.kind || kindValue === filters.kind;
  const fromDate = parseDateInputStart(filters.dateFrom);
  const toDate = parseDateInputEnd(filters.dateTo);
  const entryTimestamp = getEntryTimestamp(entry);
  const dateMatch = (() => {
    if (!fromDate && !toDate) return true;
    if (entryTimestamp === null) return true;
    if (fromDate && entryTimestamp < fromDate.getTime()) return false;
    if (toDate && entryTimestamp > toDate.getTime()) return false;
    return true;
  })();
  return matchesSearch && kindMatch && dateMatch;
}

async function handleJsonDownload(caseId) {
  const result = await downloadCaseJson(ensureTeamSelected(), caseId);
  if (!result) throw new Error('Ingen JSON vedhæftet');
  downloadBlob(result.blob, result.fileName);
}

function resolveAttachmentPayload(value) {
  if (!value) return null;
  if (typeof value === 'object' && value && 'payload' in value) {
    return value.payload;
  }
  return value;
}

function safeParseJsonMaybe(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeAttachmentEntry(value) {
  if (!value) return null;
  if (typeof value === 'object' && value) {
    if ('payload' in value || 'exported_at' in value || 'exportedAt' in value) {
      return {
        exportedAt: value.exported_at || value.exportedAt || '',
        payload: value.payload ?? value.data ?? null,
      };
    }
  }
  return { exportedAt: '', payload: value };
}

function normalizeAttachmentContent(value) {
  const resolved = resolveAttachmentPayload(value);
  if (!resolved) return null;
  if (typeof resolved === 'string') return resolved;
  try {
    return JSON.stringify(resolved);
  } catch {
    return null;
  }
}

function buildAttachmentBundle(entry) {
  const attachments = entry?.attachments || {};
  const montage = resolveAttachmentPayload(attachments.montage) || null;
  const demontage = resolveAttachmentPayload(attachments.demontage) || null;
  const receipt = attachments.receipt || null;
  if (!montage && !demontage && !receipt) return null;
  return {
    caseId: entry?.caseId || '',
    jobNumber: entry?.jobNumber || '',
    montage,
    demontage,
    receipt,
  };
}

function downloadAttachmentBundle(entry) {
  const bundle = buildAttachmentBundle(entry);
  if (!bundle) throw new Error('Ingen vedhæftninger fundet');
  const payload = JSON.stringify(bundle, null, 2);
  const fileName = `${entry?.jobNumber || 'akkord'}-${entry?.caseId || 'bundle'}-bundle.json`;
  downloadBlob(new Blob([payload], { type: 'application/json' }), fileName);
}

async function handleJsonDownloadForEntry(entry) {
  const statusBucket = resolveEntryBucket(entry);
  if (statusBucket === WORKFLOW_STATUS.DONE) {
    downloadAttachmentBundle(entry);
    return;
  }
  await handleJsonDownload(entry.caseId);
}

async function handleImport(entry, { phase } = {}) {
  const caseId = typeof entry === 'string' ? entry : entry?.caseId;
  if (entry?.caseId) {
    const phaseHint = phase || resolvePhaseForEntry(entry);
    setSharedCaseContext({
      caseId: entry.caseId,
      phase: phaseHint,
      status: entry.status || '',
      updatedAt: entry.updatedAt || '',
    });
  }
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
  await handlePdfDownloadFromContent(content, entry);
}

async function handlePdfDownloadFromContent(content, entry, suffix) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    console.warn('Kunne ikke parse JSON til PDF', error);
    throw new Error('Ugyldig JSON');
  }
  const model = buildExportModel(parsed, { exportedAt: new Date().toISOString() });
  const payload = await exportPDFBlob(parsed, { model, customSagsnummer: entry.jobNumber });
  const label = suffix ? `-${suffix}` : '';
  downloadBlob(payload.blob, `${entry.jobNumber || 'akkord'}-${entry.caseId}${label}.pdf`);
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractTotalsFromSheet(sheet) {
  let source = sheet;
  if (typeof sheet === 'string') {
    try {
      source = JSON.parse(sheet);
    } catch {
      return { materials: 0, total: 0, hours: 0 };
    }
  }
  const totals = source?.totals || source?.summary?.totals || source?.result?.totals;
  if (!totals) return { materials: 0, total: 0, hours: 0 };
  const totalValue = totals.total ?? totals.project ?? totals.akkord ?? totals.montage ?? totals.demontage;
  return {
    materials: safeNumber(totals.materials),
    total: safeNumber(totalValue),
    hours: safeNumber(totals.hours || totals.timer || totals.time),
  };
}

function resolveReceiptTotals(entry) {
  const totals = entry?.attachments?.receipt?.totals || null;
  if (!totals) return null;
  return {
    materials: safeNumber(totals.materials),
    montage: safeNumber(totals.montage),
    demontage: safeNumber(totals.demontage),
    total: safeNumber(totals.total),
    hours: safeNumber(totals.hours),
  };
}

function countPayloadLines(payload) {
  const parsed = safeParseJsonMaybe(payload);
  if (!parsed) return null;
  const candidates = [
    parsed.lines,
    parsed.items,
    parsed.materials,
    parsed.materialer,
    parsed.rows,
  ];
  for (const list of candidates) {
    if (Array.isArray(list)) return list.length;
  }
  return null;
}

function buildCaseExportPayload(entry) {
  const clone = JSON.parse(JSON.stringify(entry || {}));
  delete clone.__syncing;
  delete clone.createdByEmail;
  delete clone.createdByName;
  delete clone.createdBy;
  delete clone.updatedBy;
  delete clone.lastEditorSub;
  delete clone.deletedBy;
  return clone;
}

function downloadCaseExport(entry) {
  if (!entry) throw new Error('Ingen sag valgt');
  const jobNumber = entry.jobNumber || resolveCaseMeta(entry)?.jobNumber || 'JOB';
  const fileName = `${sanitizeFileName(jobNumber)}_sharedcase.json`;
  const payload = JSON.stringify(buildCaseExportPayload(entry), null, 2);
  downloadBlob(new Blob([payload], { type: 'application/json' }), fileName);
}

async function copyCaseSummary(entry) {
  if (!entry) throw new Error('Ingen sag valgt');
  const meta = resolveCaseMeta(entry);
  const jobNumber = meta.jobNumber || entry.jobNumber || 'Ukendt';
  const statusLabel = formatEntryStatusLabel(entry);
  const link = buildCaseDetailLink(entry.caseId);
  const lines = [
    `Case ID: ${entry.caseId}`,
    `Jobnr: ${jobNumber}`,
    `Status: ${statusLabel}`,
    link ? `Link: ${link}` : '',
  ].filter(Boolean);
  const text = lines.join('\n');
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function renderReceiptSummary(entry) {
  const wrapper = document.createElement('div');
  const receiptTotals = resolveReceiptTotals(entry);
  const montageSheet = resolveAttachmentPayload(entry?.attachments?.montage) || null;
  const demontageSheet = resolveAttachmentPayload(entry?.attachments?.demontage) || null;
  const hasMontage = Boolean(montageSheet);
  const hasDemontage = Boolean(demontageSheet);
  const montageTotals = extractTotalsFromSheet(montageSheet);
  const demontageTotals = extractTotalsFromSheet(demontageSheet);
  const totals = receiptTotals || {
    materials: montageTotals.materials + demontageTotals.materials,
    montage: montageTotals.total,
    demontage: demontageTotals.total,
    total: montageTotals.total + demontageTotals.total,
    hours: montageTotals.hours + demontageTotals.hours,
  };

  if (!hasMontage && !hasDemontage && !receiptTotals) {
    const message = document.createElement('p');
    message.textContent = 'Ingen montage/demontage er tilgængelig endnu.';
    wrapper.appendChild(message);
    return wrapper;
  }

  if (!hasDemontage) {
    const message = document.createElement('p');
    message.textContent = 'Montage afsluttet – venter på demontage.';
    wrapper.appendChild(message);
  } else if (!hasMontage) {
    const message = document.createElement('p');
    message.textContent = 'Demontage afsluttet – montage mangler i oversigten.';
    wrapper.appendChild(message);
  }

  const rows = [
    { label: 'Materialer', value: `${CURRENCY_FORMATTER.format(totals.materials)} kr.` },
    hasMontage ? { label: 'Montage', value: `${CURRENCY_FORMATTER.format(totals.montage)} kr.` } : null,
    hasDemontage ? { label: 'Demontage', value: `${CURRENCY_FORMATTER.format(totals.demontage)} kr.` } : null,
    { label: 'Timer', value: `${HOURS_FORMATTER.format(totals.hours)} t.` },
    { label: 'Projektsum', value: `${CURRENCY_FORMATTER.format(totals.total)} kr.` },
  ].filter(Boolean);
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

function buildConflictBody(entry) {
  const wrapper = document.createElement('div');
  const meta = entry ? resolveCaseMeta(entry) : {};
  const jobNumber = meta?.jobNumber || entry?.jobNumber || '–';
  const status = entry?.status || '–';
  const text = document.createElement('p');
  text.textContent = 'Sagen er ændret af en anden. Vælg hvordan du vil fortsætte:';
  const details = document.createElement('div');
  details.className = 'shared-case-conflict';
  details.appendChild(buildSummaryRow('Jobnr', jobNumber));
  details.appendChild(buildSummaryRow('Status', STATUS_UI[normalizeStatusValue(status)]?.label || status));
  wrapper.appendChild(text);
  wrapper.appendChild(details);
  return wrapper;
}

function openConflictModal({ entry, onDiscard, onOverwrite }) {
  openSharedModal({
    title: 'Konflikt',
    body: buildConflictBody(entry),
    actions: [
      {
        label: 'Genindlæs fra server',
        onClick: onDiscard,
        autoFocus: true,
      },
      {
        label: 'Overskriv med min ændring',
        onClick: onOverwrite,
      },
    ],
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

async function handleApproveAction(entry, onChange, { showSummary = false } = {}) {
  const previousEntry = casesById.get(entry.caseId) || entry;
  const optimisticStatus = resolveOptimisticStatus(previousEntry);
  if (!isOnline()) {
    const queuedEntry = buildPendingUpdate(previousEntry, { status: optimisticStatus });
    if (queuedEntry && typeof onChange === 'function') {
      onChange({ updatedCase: queuedEntry });
    }
    enqueuePendingAction(buildPendingAction('approve', entry, {
      ifMatchUpdatedAt: resolveIfMatchUpdatedAt(entry),
    }));
    showToast('Godkendelse er sat i kø og synkes, når du er online.', { variant: 'info' });
    updateSyncStatus();
    return;
  }
  const optimisticEntry = buildOptimisticUpdate(previousEntry, { status: optimisticStatus });
  if (optimisticEntry && typeof onChange === 'function') {
    onChange({ updatedCase: optimisticEntry });
  }
  try {
    const updated = await approveSharedCase(ensureTeamSelected(), entry.caseId, { ifMatchUpdatedAt: resolveIfMatchUpdatedAt(entry) });
    if (typeof onChange === 'function') onChange({ updatedCase: { ...updated, __syncing: false } });
    removePendingAction({ caseId: entry.caseId, type: 'approve' });
    showToast('Sag er flyttet til godkendt.', { variant: 'success' });
    if (showSummary) {
      openSharedModal({
        title: 'Montage delt',
        body: renderApprovalSummary(updated || entry),
        actions: [
          {
            label: 'Åbn',
            onClick: async () => {
              try {
                await handleImport(updated || entry, { phase: 'demontage' });
              } catch (error) {
                handleActionError(error, 'Kunne ikke åbne sag', { teamContext: teamId });
                showToast(error?.message || 'Kunne ikke åbne sag.', { variant: 'error' });
              }
            },
          },
          { label: 'Luk' },
        ],
      });
    }
  } catch (error) {
    if (await handleConflictError(error, previousEntry, onChange, {
      retryAction: async (freshEntry) => {
        const updatedAt = freshEntry?.updatedAt || freshEntry?.lastUpdatedAt || freshEntry?.last_updated_at || '';
        const updated = await approveSharedCase(ensureTeamSelected(), entry.caseId, { ifMatchUpdatedAt: updatedAt });
        if (typeof onChange === 'function') onChange({ updatedCase: { ...updated, __syncing: false } });
      },
    })) return;
    if (typeof onChange === 'function') {
      onChange({ updatedCase: { ...previousEntry, __syncing: false } });
    }
    handleActionError(error, 'Kunne ikke godkende sag', { teamContext: teamId });
    showToast(error?.message || 'Kunne ikke godkende sag.', { variant: 'error' });
  }
}

async function handleDemontageAction(entry, onChange, { autoImport = false } = {}) {
  const previousEntry = casesById.get(entry.caseId) || entry;
  if (!isOnline()) {
    const queuedEntry = buildPendingUpdate(previousEntry, { status: WORKFLOW_STATUS.DEMONTAGE });
    if (queuedEntry && typeof onChange === 'function') {
      onChange({ updatedCase: queuedEntry });
    }
    enqueuePendingAction(buildPendingAction('status', entry, {
      status: WORKFLOW_STATUS.DEMONTAGE,
      phase: entry.sheetPhase || 'montage',
      ifMatchUpdatedAt: resolveIfMatchUpdatedAt(entry),
    }));
    showToast('Ændringen er sat i kø og synkes, når du er online.', { variant: 'info' });
    updateSyncStatus();
    return;
  }
  const optimisticEntry = buildOptimisticUpdate(previousEntry, { status: WORKFLOW_STATUS.DEMONTAGE });
  if (optimisticEntry && typeof onChange === 'function') {
    onChange({ updatedCase: optimisticEntry });
  }
  try {
    const updated = await updateSharedCaseStatus(ensureTeamSelected(), entry.caseId, {
      status: WORKFLOW_STATUS.DEMONTAGE,
      ifMatchUpdatedAt: resolveIfMatchUpdatedAt(entry),
      phase: entry.sheetPhase || 'montage',
    });
    if (typeof onChange === 'function' && !updated?.queued) {
      onChange({ updatedCase: { ...updated, __syncing: false } });
    }
    if (updated?.queued) {
      showToast('Ændringen er sat i kø og synkes, når du er online.', { variant: 'info' });
      return;
    }
    removePendingAction({ caseId: entry.caseId, type: 'status' });
    if (autoImport) {
      await handleImport(entry, { phase: 'demontage' });
      showToast('Sag indlæst til demontage.', { variant: 'success' });
    } else {
      showToast('Sag er flyttet til demontage i gang.', { variant: 'success' });
    }
  } catch (error) {
    if (await handleConflictError(error, previousEntry, onChange, {
      retryAction: async (freshEntry) => {
        const updatedAt = freshEntry?.updatedAt || freshEntry?.lastUpdatedAt || freshEntry?.last_updated_at || '';
        const updated = await updateSharedCaseStatus(ensureTeamSelected(), entry.caseId, {
          status: WORKFLOW_STATUS.DEMONTAGE,
          ifMatchUpdatedAt: updatedAt,
          phase: entry.sheetPhase || 'montage',
        });
        if (typeof onChange === 'function' && !updated?.queued) {
          onChange({ updatedCase: { ...updated, __syncing: false } });
        }
      },
    })) return;
    if (typeof onChange === 'function') {
      onChange({ updatedCase: { ...previousEntry, __syncing: false } });
    }
    handleActionError(error, 'Kunne ikke opdatere sag', { teamContext: teamId });
    showToast(error?.message || 'Kunne ikke opdatere sag.', { variant: 'error' });
  }
}

async function handleFinishDemontageAction(entry, onChange) {
  const previousEntry = casesById.get(entry.caseId) || entry;
  const optimisticStatus = resolveOptimisticStatus(previousEntry);
  if (!isOnline()) {
    const queuedEntry = buildPendingUpdate(previousEntry, { status: WORKFLOW_STATUS.DONE });
    if (queuedEntry && typeof onChange === 'function') {
      onChange({ updatedCase: queuedEntry });
    }
    enqueuePendingAction(buildPendingAction('status', entry, {
      status: WORKFLOW_STATUS.DONE,
      phase: entry.sheetPhase || 'demontage',
      ifMatchUpdatedAt: resolveIfMatchUpdatedAt(entry),
    }));
    showToast('Afslutningen er sat i kø og synkes, når du er online.', { variant: 'info' });
    updateSyncStatus();
    return;
  }
  const optimisticEntry = buildOptimisticUpdate(previousEntry, { status: optimisticStatus });
  if (optimisticEntry && typeof onChange === 'function') {
    onChange({ updatedCase: optimisticEntry });
  }
  try {
    const updated = await updateSharedCaseStatus(ensureTeamSelected(), entry.caseId, {
      status: WORKFLOW_STATUS.DONE,
      ifMatchUpdatedAt: resolveIfMatchUpdatedAt(entry),
      phase: entry.sheetPhase || 'demontage',
    });
    if (typeof onChange === 'function' && !updated?.queued) {
      onChange({ updatedCase: { ...updated, __syncing: false } });
    }
    if (updated?.queued) {
      showToast('Afslutningen er sat i kø og synkes, når du er online.', { variant: 'info' });
      return;
    }
    removePendingAction({ caseId: entry.caseId, type: 'status' });
    showToast('Sag er afsluttet.', { variant: 'success' });
  } catch (error) {
    if (await handleConflictError(error, previousEntry, onChange, {
      retryAction: async (freshEntry) => {
        const updatedAt = freshEntry?.updatedAt || freshEntry?.lastUpdatedAt || freshEntry?.last_updated_at || '';
        const updated = await updateSharedCaseStatus(ensureTeamSelected(), entry.caseId, {
          status: WORKFLOW_STATUS.DONE,
          ifMatchUpdatedAt: updatedAt,
          phase: entry.sheetPhase || 'demontage',
        });
        if (typeof onChange === 'function' && !updated?.queued) {
          onChange({ updatedCase: { ...updated, __syncing: false } });
        }
      },
    })) return;
    if (typeof onChange === 'function') {
      onChange({ updatedCase: { ...previousEntry, __syncing: false } });
    }
    handleActionError(error, 'Kunne ikke afslutte demontage', { teamContext: teamId });
    showToast(error?.message || 'Kunne ikke afslutte demontage.', { variant: 'error' });
  }
}

async function handleSoftDelete(entry, onChange) {
  const confirmed = await openConfirmModal({
    title: 'Soft delete sag',
    message: 'Denne sag skjules for teamet, men kan gendannes af admin.',
    confirmLabel: 'Soft delete',
  });
  if (!confirmed) return;
  if (!isOnline()) {
    const previousEntry = casesById.get(entry.caseId) || entry;
    const queuedEntry = buildPendingUpdate(previousEntry, { status: WORKFLOW_STATUS.DELETED });
    if (queuedEntry && typeof onChange === 'function') {
      onChange({ updatedCase: queuedEntry });
    }
    enqueuePendingAction(buildPendingAction('delete', entry, {}));
    showToast('Sletningen er sat i kø og synkes, når du er online.', { variant: 'info' });
    updateSyncStatus();
    return;
  }
  try {
    await deleteSharedCase(ensureTeamSelected(), entry.caseId);
    if (typeof onChange === 'function') onChange({ removeCaseId: entry.caseId });
    removePendingAction({ caseId: entry.caseId, type: 'delete' });
    showToast('Sag er soft-deleted.', { variant: 'success' });
  } catch (error) {
    if (await handleConflictError(error, entry, onChange, {
      retryAction: async () => {
        await deleteSharedCase(ensureTeamSelected(), entry.caseId);
        if (typeof onChange === 'function') onChange({ removeCaseId: entry.caseId });
      },
    })) return;
    handleActionError(error, 'Kunne ikke slette sag', { teamContext: teamId });
    showToast(error?.message || 'Kunne ikke slette sag.', { variant: 'error' });
  }
}

function createCaseActions(entry, userId, onChange) {
  const container = document.createElement('div');
  container.className = 'shared-case-actions';
  const statusBucket = resolveEntryBucket(entry);

  if (![WORKFLOW_STATUS.DONE, WORKFLOW_STATUS.DELETED].includes(statusBucket)) {
    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.textContent = 'Importér';
    importBtn.addEventListener('click', async () => {
      importBtn.disabled = true;
      try {
        await handleImport(entry);
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
  }

  const jsonBtn = document.createElement('button');
  jsonBtn.type = 'button';
  jsonBtn.textContent = 'JSON';
  jsonBtn.addEventListener('click', async () => {
    jsonBtn.disabled = true;
    try {
      await handleJsonDownloadForEntry(entry);
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
      if (statusBucket === WORKFLOW_STATUS.DONE) {
        const montageContent = normalizeAttachmentContent(entry?.attachments?.montage);
        const demontageContent = normalizeAttachmentContent(entry?.attachments?.demontage);
        if (!montageContent && !demontageContent) {
          throw new Error('Ingen PDF-data fundet');
        }
        openSharedModal({
          title: 'Vælg PDF',
          body: 'Hvilken PDF vil du hente?',
          actions: [
            montageContent
              ? {
                label: 'PDF montage',
                onClick: async () => {
                  await handlePdfDownloadFromContent(montageContent, entry, 'montage');
                  showToast('PDF montage er genereret.', { variant: 'success' });
                },
              }
              : null,
            demontageContent
              ? {
                label: 'PDF demontage',
                onClick: async () => {
                  await handlePdfDownloadFromContent(demontageContent, entry, 'demontage');
                  showToast('PDF demontage er genereret.', { variant: 'success' });
                },
              }
              : null,
            { label: 'Luk' },
          ].filter(Boolean),
        });
      } else {
        await handlePdfDownload(entry);
        showToast('PDF er genereret.', { variant: 'success' });
      }
    } catch (error) {
      console.error('PDF fejlede', error);
      handleActionError(error, 'Kunne ikke generere PDF', { teamContext: teamId });
      showToast(error?.message || 'Kunne ikke generere PDF.', { variant: 'error' });
    } finally {
      pdfBtn.disabled = false;
    }
  });
  container.appendChild(pdfBtn);

  if (statusBucket === WORKFLOW_STATUS.DONE) {
    const receiptBtn = document.createElement('button');
    receiptBtn.type = 'button';
    receiptBtn.textContent = 'Kvittering';
    receiptBtn.addEventListener('click', () => {
      openSharedModal({
        title: 'Kvittering',
        body: renderReceiptSummary(entry),
        actions: [{ label: 'Luk' }],
      });
    });
    container.appendChild(receiptBtn);
  }

  if (statusBucket === WORKFLOW_STATUS.DRAFT && isAdminUser()) {
    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.textContent = 'Godkend & del';
    approveBtn.addEventListener('click', async () => {
      approveBtn.disabled = true;
      try {
        await handleApproveAction(entry, onChange, { showSummary: true });
      } finally {
        approveBtn.disabled = false;
      }
    });
    container.appendChild(approveBtn);
  }

  if (statusBucket === WORKFLOW_STATUS.APPROVED) {
    const demontageBtn = document.createElement('button');
    demontageBtn.type = 'button';
    demontageBtn.textContent = 'Indlæs til demontage';
    demontageBtn.addEventListener('click', async () => {
      demontageBtn.disabled = true;
      try {
        await handleDemontageAction(entry, onChange, { autoImport: true });
      } finally {
        demontageBtn.disabled = false;
      }
    });
    container.appendChild(demontageBtn);
  }

  if (statusBucket === WORKFLOW_STATUS.DEMONTAGE && isAdminUser()) {
    const finishBtn = document.createElement('button');
    finishBtn.type = 'button';
    finishBtn.textContent = 'Godkend demontage & afslut';
    finishBtn.addEventListener('click', async () => {
      finishBtn.disabled = true;
      try {
        await handleFinishDemontageAction(entry, onChange);
      } finally {
        finishBtn.disabled = false;
      }
    });
    container.appendChild(finishBtn);
  }

  if (![WORKFLOW_STATUS.DONE, WORKFLOW_STATUS.DELETED].includes(statusBucket) && isAdminUser()) {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Soft delete';
    deleteBtn.addEventListener('click', async () => {
      deleteBtn.disabled = true;
      try {
        await handleSoftDelete(entry, onChange);
      } finally {
        deleteBtn.disabled = false;
      }
    });
    container.appendChild(deleteBtn);
  }

  return container;
}

function formatAuditActor(actor) {
  if (!actor) return 'ukendt';
  const name = actor.name || actor.displayName || '';
  if (name) return name;
  if (actor.email) return actor.email;
  return actor.sub || actor.uid || 'ukendt';
}

function buildSummaryRow(label, value) {
  const row = document.createElement('div');
  row.className = 'shared-case-detail__row';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const valueEl = document.createElement('strong');
  valueEl.textContent = value;
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

function renderAttachmentPreview(title, attachment, { showTotals = true } = {}) {
  const normalized = normalizeAttachmentEntry(attachment);
  if (!normalized?.payload && !normalized?.exportedAt) return null;
  const card = document.createElement('div');
  card.className = 'shared-case-detail-card';
  const header = document.createElement('div');
  header.className = 'shared-case-detail-card__title';
  header.textContent = title;
  card.appendChild(header);

  const exportedAt = normalized.exportedAt ? formatDateLabel(normalized.exportedAt) || formatDateInput(normalized.exportedAt) : '';
  if (exportedAt) {
    card.appendChild(buildSummaryRow('Eksporteret', exportedAt));
  }

  const lineCount = countPayloadLines(normalized.payload);
  if (typeof lineCount === 'number') {
    card.appendChild(buildSummaryRow('Linjer', String(lineCount)));
  }

  if (showTotals) {
    const totals = extractTotalsFromSheet(normalized.payload);
    if (totals.materials || totals.total) {
      card.appendChild(buildSummaryRow('Materialesum', `${CURRENCY_FORMATTER.format(totals.materials)} kr.`));
      card.appendChild(buildSummaryRow('Sum', `${CURRENCY_FORMATTER.format(totals.total)} kr.`));
    }
  }

  const rawPayload = safeParseJsonMaybe(normalized.payload);
  if (rawPayload) {
    const rawDetails = document.createElement('details');
    rawDetails.className = 'shared-case-detail-card__raw';
    const summary = document.createElement('summary');
    summary.textContent = 'Åbn rå JSON';
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(rawPayload, null, 2);
    rawDetails.appendChild(summary);
    rawDetails.appendChild(pre);
    card.appendChild(rawDetails);
  }

  return card;
}

function renderReceiptPreview(entry) {
  const receipt = entry?.attachments?.receipt || null;
  if (!receipt) return null;
  const totals = resolveReceiptTotals(entry);
  const card = document.createElement('div');
  card.className = 'shared-case-detail-card';
  const header = document.createElement('div');
  header.className = 'shared-case-detail-card__title';
  header.textContent = 'Kvittering';
  card.appendChild(header);
  if (totals) {
    card.appendChild(buildSummaryRow('Materialesum', `${CURRENCY_FORMATTER.format(totals.materials)} kr.`));
    card.appendChild(buildSummaryRow('Montage', `${CURRENCY_FORMATTER.format(totals.montage)} kr.`));
    card.appendChild(buildSummaryRow('Demontage', `${CURRENCY_FORMATTER.format(totals.demontage)} kr.`));
    card.appendChild(buildSummaryRow('Total', `${CURRENCY_FORMATTER.format(totals.total)} kr.`));
  }
  return card;
}

function renderCaseDetailSummary(entry) {
  const meta = resolveCaseMeta(entry);
  const totals = resolveCaseTotals(entry, meta);
  const statusLabel = formatEntryStatusLabel(entry);
  const updatedAt = entry.last_updated_at || entry.lastUpdatedAt || entry.updatedAt || entry.createdAt || '';
  const createdAt = entry.createdAt || entry.created_at || '';
  const lastEditor = formatEditorLabel(entry.lastEditorSub || entry.updatedBy || entry.createdBy);
  const creator = entry.createdByName || entry.createdByEmail || entry.createdBy || '–';

  const section = document.createElement('section');
  section.className = 'shared-case-detail-summary';
  const badgeRow = document.createElement('div');
  badgeRow.className = 'shared-case-detail-summary__badges';
  const statusBadge = document.createElement('span');
  statusBadge.className = 'shared-case-pill shared-case-pill--status';
  statusBadge.dataset.status = entry.status || '';
  statusBadge.textContent = statusLabel;
  const systemBadge = document.createElement('span');
  systemBadge.className = 'shared-case-pill shared-case-pill--system';
  systemBadge.textContent = meta.system || entry.system || '–';
  badgeRow.appendChild(statusBadge);
  badgeRow.appendChild(systemBadge);
  section.appendChild(badgeRow);

  const info = document.createElement('div');
  info.className = 'shared-case-detail-summary__grid';
  info.appendChild(buildSummaryRow('Jobnr', meta.jobNumber || entry.jobNumber || '–'));
  info.appendChild(buildSummaryRow('Type', meta.jobType || entry.caseKind || '–'));
  info.appendChild(buildSummaryRow('Status', statusLabel));
  info.appendChild(buildSummaryRow('Total', `${CURRENCY_FORMATTER.format(totals.total)} kr.`));
  info.appendChild(buildSummaryRow('Materialer', `${CURRENCY_FORMATTER.format(totals.materials)} kr.`));
  info.appendChild(buildSummaryRow('Opdateret', formatRelativeDa(updatedAt) || formatDateLabel(updatedAt) || '–'));
  info.appendChild(buildSummaryRow('Oprettet', formatDateInput(createdAt) || formatDateLabel(createdAt) || '–'));
  info.appendChild(buildSummaryRow('Oprettet af', creator));
  info.appendChild(buildSummaryRow('Sidste editor', lastEditor));
  section.appendChild(info);
  return section;
}

function renderCaseDetailPreview(entry) {
  const section = document.createElement('section');
  section.className = 'shared-case-detail-preview';
  const title = document.createElement('h4');
  title.textContent = 'Vedhæftninger';
  section.appendChild(title);
  const cards = document.createElement('div');
  cards.className = 'shared-case-detail-preview__cards';
  const montage = renderAttachmentPreview('Montage', entry?.attachments?.montage);
  const demontage = renderAttachmentPreview('Demontage', entry?.attachments?.demontage);
  const receipt = renderReceiptPreview(entry);
  [montage, demontage, receipt].filter(Boolean).forEach(card => cards.appendChild(card));
  if (!cards.childNodes.length) {
    const empty = document.createElement('p');
    empty.className = 'shared-case-detail__empty';
    empty.textContent = 'Ingen attachments er klar endnu.';
    section.appendChild(empty);
  } else {
    section.appendChild(cards);
  }
  return section;
}

function renderCaseDetailAudit({ items = [], unavailable = false, loading = false } = {}) {
  const section = document.createElement('section');
  section.className = 'shared-case-detail-audit';
  const title = document.createElement('h4');
  title.textContent = 'Audit log';
  section.appendChild(title);
  if (loading) {
    const skeleton = document.createElement('div');
    skeleton.className = 'shared-case-detail-skeleton';
    skeleton.textContent = 'Henter audit...';
    section.appendChild(skeleton);
    return section;
  }
  if (unavailable) {
    const empty = document.createElement('p');
    empty.className = 'shared-case-detail__empty';
    empty.textContent = 'Audit er ikke tilgængelig endnu.';
    section.appendChild(empty);
    return section;
  }
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'shared-case-detail__empty';
    empty.textContent = 'Ingen audit events endnu.';
    section.appendChild(empty);
    return section;
  }
  const list = document.createElement('div');
  list.className = 'shared-case-detail-audit__list';
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'shared-case-detail-audit__item';
    const meta = document.createElement('div');
    meta.className = 'shared-case-detail-audit__meta';
    const action = document.createElement('strong');
    action.textContent = item.summary || item.action || 'Hændelse';
    const actor = document.createElement('span');
    actor.textContent = formatAuditActor(item.actor);
    meta.appendChild(action);
    meta.appendChild(actor);
    const time = document.createElement('div');
    time.className = 'shared-case-detail-audit__time';
    const timestamp = item.createdAt || item.timestamp || '';
    time.textContent = formatRelativeDa(timestamp) || formatDateLabel(timestamp) || '–';
    row.appendChild(meta);
    row.appendChild(time);
    list.appendChild(row);
  });
  section.appendChild(list);
  return section;
}

function buildDetailActionButton(label, handler, { disabled = false, variant = '' } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (variant) button.classList.add(`shared-case-detail-action--${variant}`);
  button.disabled = disabled;
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await handler();
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function renderCaseDetailActions(entry, onChange) {
  const container = document.createElement('div');
  container.className = 'shared-case-detail-actions';
  const statusBucket = resolveEntryBucket(entry);
  if (statusBucket === WORKFLOW_STATUS.DRAFT) {
    container.appendChild(buildDetailActionButton('Indlæs til montage', async () => {
      await handleImport(entry, { phase: 'montage' });
      showToast('Sag indlæst til montage.', { variant: 'success' });
    }, { variant: 'primary' }));
  }
  if ([WORKFLOW_STATUS.APPROVED, WORKFLOW_STATUS.DEMONTAGE].includes(statusBucket)) {
    container.appendChild(buildDetailActionButton('Indlæs til demontage', async () => {
      if (statusBucket === WORKFLOW_STATUS.APPROVED) {
        await handleDemontageAction(entry, onChange, { autoImport: true });
      } else {
        await handleImport(entry, { phase: 'demontage' });
        showToast('Sag indlæst til demontage.', { variant: 'success' });
      }
    }, { variant: 'primary' }));
  }
  container.appendChild(buildDetailActionButton('Eksporter JSON', async () => {
    downloadCaseExport(entry);
    showToast('JSON er downloadet.', { variant: 'success' });
  }));
  container.appendChild(buildDetailActionButton('Kopiér', async () => {
    await copyCaseSummary(entry);
    showToast('Sag kopieret til udklipsholder.', { variant: 'success' });
  }));
  return container;
}

function renderCaseDetailBody(entry, auditState = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'shared-case-detail-body';
  wrapper.appendChild(renderCaseDetailSummary(entry));
  wrapper.appendChild(renderCaseDetailPreview(entry));
  wrapper.appendChild(renderCaseDetailAudit(auditState));
  return wrapper;
}

function refreshActiveCaseDetail({ loadingAudit = false } = {}) {
  if (!activeCaseDetail) return;
  const { entry, audit, body, actions, onChange } = activeCaseDetail;
  if (!body || !actions) return;
  body.textContent = '';
  body.appendChild(renderCaseDetailBody(entry, { ...audit, loading: loadingAudit }));
  actions.textContent = '';
  actions.appendChild(renderCaseDetailActions(entry, onChange));
}

function openCaseDetails(entry, userId, onChange, { focusReturnEl } = {}) {
  if (!entry?.caseId) return;
  if (activeCaseDetail?.close) {
    activeCaseDetail.close();
  }
  const overlay = document.createElement('div');
  overlay.className = 'shared-case-detail-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const backdrop = document.createElement('div');
  backdrop.className = 'shared-case-detail-modal__backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'shared-case-detail-modal__sheet';
  const header = document.createElement('div');
  header.className = 'shared-case-detail-modal__header';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'shared-case-detail-modal__back';
  backBtn.textContent = '← Tilbage';
  const title = document.createElement('div');
  title.className = 'shared-case-detail-modal__title';
  title.textContent = entry.jobNumber || resolveCaseMeta(entry)?.jobNumber || 'Sag';
  const headerActions = document.createElement('div');
  headerActions.className = 'shared-case-detail-modal__header-actions';
  header.appendChild(backBtn);
  header.appendChild(title);
  header.appendChild(headerActions);

  const body = document.createElement('div');
  body.className = 'shared-case-detail-modal__body';

  const actions = document.createElement('div');
  actions.className = 'shared-case-detail-modal__actions';

  sheet.appendChild(header);
  sheet.appendChild(body);
  sheet.appendChild(actions);
  overlay.appendChild(backdrop);
  overlay.appendChild(sheet);

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const close = () => {
    if (activeCaseDetail?.caseId !== entry.caseId) return;
    updateCaseIdInUrl('');
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown);
    if (focusReturnEl && typeof focusReturnEl.focus === 'function') {
      focusReturnEl.focus();
    }
    activeCaseDetail = null;
  };

  backBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(overlay);
  updateCaseIdInUrl(entry.caseId);
  backBtn.focus();

  const detailState = {
    caseId: entry.caseId,
    entry,
    audit: { items: [], unavailable: false },
    overlay,
    body,
    actions,
    close,
    onChange,
  };
  activeCaseDetail = detailState;
  refreshActiveCaseDetail({ loadingAudit: true });

  const requestId = ++activeCaseDetailRequestId;
  Promise.all([
    getSharedCase(ensureTeamSelected(), entry.caseId),
    getSharedCaseAudit(ensureTeamSelected(), entry.caseId, { limit: 50 }),
  ])
    .then(([freshEntry, auditResult]) => {
      if (!activeCaseDetail || activeCaseDetail.caseId !== entry.caseId || requestId !== activeCaseDetailRequestId) return;
      if (freshEntry) {
        updateCaseEntry(freshEntry);
        activeCaseDetail.entry = freshEntry;
      }
      activeCaseDetail.audit = auditResult || { items: [], unavailable: true };
      refreshActiveCaseDetail({ loadingAudit: false });
    })
    .catch(() => {
      if (!activeCaseDetail || activeCaseDetail.caseId !== entry.caseId) return;
      activeCaseDetail.audit = { items: [], unavailable: true };
      refreshActiveCaseDetail({ loadingAudit: false });
    });
}

async function openCaseDetailsById(caseId) {
  if (!caseId) return;
  const cached = casesById.get(caseId);
  const userId = lastRenderUserId || sessionState?.user?.uid || 'offline-user';
  const onChange = lastRenderOnChange || ((payload) => {
    if (payload?.updatedCase) updateCaseEntry(payload.updatedCase);
    if (payload?.removeCaseId) removeCaseEntry(payload.removeCaseId);
    if (sharedCasesContainer) renderFromState(sharedCasesContainer, userId);
  });
  if (cached) {
    openCaseDetails(cached, userId, onChange, {});
    return;
  }
  try {
    const entry = await getSharedCase(ensureTeamSelected(), caseId);
    if (!entry) {
      showToast('Sag findes ikke længere.', { variant: 'error' });
      return;
    }
    updateCaseEntry(entry);
    openCaseDetails(entry, userId, onChange, {});
  } catch (error) {
    console.error('Kunne ikke hente sag', error);
    showToast(error?.message || 'Kunne ikke åbne sag.', { variant: 'error' });
  }
}

function attemptOpenDeepLink() {
  if (!pendingDeepLinkCaseId || deepLinkHandled || !lastRenderOnChange) return;
  const caseId = pendingDeepLinkCaseId;
  pendingDeepLinkCaseId = '';
  deepLinkHandled = true;
  openCaseDetailsById(caseId);
}

function closeActiveCaseMenu() {
  if (activeCaseMenuCleanup) {
    activeCaseMenuCleanup();
    activeCaseMenuCleanup = null;
  }
  if (activeCaseMenu) {
    activeCaseMenu.hidden = true;
    activeCaseMenu.classList.remove('is-open');
  }
  if (activeCaseMenuButton) {
    activeCaseMenuButton.setAttribute('aria-expanded', 'false');
  }
  activeCaseMenu = null;
  activeCaseMenuButton = null;
}

function openCaseMenu(menu, button) {
  closeActiveCaseMenu();
  menu.hidden = false;
  menu.classList.add('is-open');
  button.setAttribute('aria-expanded', 'true');
  activeCaseMenu = menu;
  activeCaseMenuButton = button;
  const onDocumentClick = (event) => {
    if (!menu.contains(event.target) && event.target !== button) {
      closeActiveCaseMenu();
    }
  };
  const onDocumentKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeActiveCaseMenu();
    }
  };
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeydown);
  activeCaseMenuCleanup = () => {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKeydown);
  };
}

function addCaseMenuItem(menu, { label, onClick, isDanger = false }) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = `case-menu__item${isDanger ? ' case-menu__item--danger' : ''}`;
  item.textContent = label;
  item.addEventListener('click', async (event) => {
    event.stopPropagation();
    closeActiveCaseMenu();
    if (typeof onClick === 'function') {
      await onClick();
    }
  });
  menu.appendChild(item);
}

function renderCaseCardCompact(entry, userId, onChange) {
  const meta = resolveCaseMeta(entry);
  const totals = resolveCaseTotals(entry, meta);
  const updatedAt = entry.last_updated_at || entry.lastUpdatedAt || entry.updatedAt || entry.createdAt || '';
  const lastEditor = formatEditorShort(entry.lastEditorSub || entry.updatedBy || entry.createdBy);
  const updatedLabel = formatRelativeDa(updatedAt) || formatDateLabel(updatedAt);
  const statusLabel = formatEntryStatusLabel(entry);
  const statusBucket = deriveBoardStatus(entry);
  const card = document.createElement('article');
  card.className = 'shared-case-card shared-case-card--compact';
  card.dataset.ifMatch = entry.updatedAt || '';
  card.dataset.status = statusBucket;
  card.tabIndex = 0;

  const header = document.createElement('div');
  header.className = 'shared-case-card__header';
  const title = document.createElement('div');
  title.className = 'shared-case-card__title';
  title.textContent = meta.jobNumber || entry.jobNumber || 'Ukendt sag';
  const menuWrap = document.createElement('div');
  menuWrap.className = 'shared-case-menu';
  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'shared-case-menu__button';
  menuButton.setAttribute('aria-haspopup', 'true');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Åbn menu');
  menuButton.textContent = '⋮';
  const menu = document.createElement('div');
  menu.className = 'case-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');

  if (statusBucket === WORKFLOW_STATUS.DRAFT && isAdminUser()) {
    addCaseMenuItem(menu, {
      label: 'Godkend',
      onClick: async () => handleApproveAction(entry, onChange, { showSummary: false }),
    });
  }
  if (statusBucket === WORKFLOW_STATUS.APPROVED) {
    addCaseMenuItem(menu, {
      label: 'Sæt til demontage i gang',
      onClick: async () => handleDemontageAction(entry, onChange, { autoImport: false }),
    });
  }
  if (statusBucket === WORKFLOW_STATUS.DEMONTAGE && isAdminUser()) {
    addCaseMenuItem(menu, {
      label: 'Afslut',
      onClick: async () => handleFinishDemontageAction(entry, onChange),
    });
  }
  if (![WORKFLOW_STATUS.DONE, WORKFLOW_STATUS.DELETED].includes(statusBucket) && isAdminUser()) {
    addCaseMenuItem(menu, {
      label: 'Slet sag',
      isDanger: true,
      onClick: async () => handleSoftDelete(entry, onChange),
    });
  }

  menuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (activeCaseMenu === menu) {
      closeActiveCaseMenu();
      return;
    }
    openCaseMenu(menu, menuButton);
  });

  menuWrap.appendChild(menuButton);
  menuWrap.appendChild(menu);
  header.appendChild(title);
  header.appendChild(menuWrap);

  const type = document.createElement('div');
  type.className = 'shared-case-card__type';
  type.textContent = meta.jobType || entry.caseKind || 'Standard';

  const tags = document.createElement('div');
  tags.className = 'shared-case-card__tags';
  const statusPill = document.createElement('span');
  statusPill.className = 'shared-case-pill shared-case-pill--status';
  statusPill.textContent = entry?.__pendingAction
    ? `${statusLabel} · Afventer sync`
    : entry?.__syncing ? `${statusLabel} · Synker…` : statusLabel;
  const systemPill = document.createElement('span');
  systemPill.className = 'shared-case-pill shared-case-pill--system';
  systemPill.textContent = meta.system || entry.system || '–';
  tags.appendChild(statusPill);
  tags.appendChild(systemPill);

  const amount = document.createElement('div');
  amount.className = 'shared-case-card__amount';
  amount.textContent = `${CURRENCY_FORMATTER_COMPACT.format(totals.total)} kr`;

  const footer = document.createElement('div');
  footer.className = 'shared-case-card__footer';
  const time = document.createElement('span');
  time.className = 'shared-case-card__time';
  time.textContent = updatedLabel || '–';
  const editor = document.createElement('span');
  editor.className = 'shared-case-card__editor';
  editor.textContent = lastEditor;
  footer.appendChild(time);
  footer.appendChild(editor);

  card.appendChild(header);
  card.appendChild(type);
  card.appendChild(tags);
  card.appendChild(amount);
  card.appendChild(footer);

  const openDetails = () => {
    closeActiveCaseMenu();
    openCaseDetails(entry, userId, onChange, { focusReturnEl: card });
  };
  card.addEventListener('click', (event) => {
    if (menuWrap.contains(event.target)) return;
    openDetails();
  });
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openDetails();
    }
  });
  return card;
}

function resolveEntryPhase(entry) {
  return resolveSheetPhase(entry);
}

function buildFinishedProjectGroups(entries) {
  const groups = new Map();
  entries.forEach(entry => {
    if (resolveEntryBucket(entry) !== WORKFLOW_STATUS.DONE) return;
    const meta = resolveCaseMeta(entry);
    const key = resolveProjectKey(entry, meta);
    if (!key) return;
    const timestamp = entry.last_updated_at || entry.lastUpdatedAt || entry.updatedAt || entry.createdAt || '';
    const phase = resolveEntryPhase(entry);
    const existing = groups.get(key) || {
      projectKey: key,
      jobNumber: meta.jobNumber || entry.jobNumber || '',
      latestUpdatedAt: '',
      meta: meta,
      montageCases: [],
      demontageCases: [],
    };
    if (!existing.latestUpdatedAt || timestamp.localeCompare(existing.latestUpdatedAt) > 0) {
      existing.latestUpdatedAt = timestamp;
      existing.meta = meta;
      existing.jobNumber = meta.jobNumber || entry.jobNumber || existing.jobNumber;
    }
    if (phase === 'demontage') {
      existing.demontageCases.push(entry);
    } else {
      existing.montageCases.push(entry);
    }
    groups.set(key, existing);
  });
  return Array.from(groups.values())
    .map(group => ({
      ...group,
      montageCases: group.montageCases.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
      demontageCases: group.demontageCases.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    }))
    .sort((a, b) => (b.latestUpdatedAt || '').localeCompare(a.latestUpdatedAt || ''));
}

function renderPhaseSummary(entry, label, userId, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'shared-case-project__phase';
  if (!entry) {
    const empty = document.createElement('div');
    empty.className = 'shared-case-project__empty';
    empty.textContent = `${label}: ingen registrering endnu.`;
    wrapper.appendChild(empty);
    return wrapper;
  }
  const date = resolveCaseDate(entry, resolveCaseMeta(entry));
  const heading = document.createElement('div');
  heading.className = 'shared-case-project__phase-title';
  heading.textContent = `${label} · ${date.formatted || formatDateInput(date.raw) || '–'}`;
  wrapper.appendChild(heading);
  const totals = resolveCaseTotals(entry, resolveCaseMeta(entry));
  const totalsRow = document.createElement('div');
  totalsRow.className = 'shared-case-project__totals';
  totalsRow.innerHTML = `<span>Materialer:</span> <strong>${CURRENCY_FORMATTER.format(totals.materials)} kr.</strong>
    <span>Total:</span> <strong>${CURRENCY_FORMATTER.format(totals.total)} kr.</strong>`;
  wrapper.appendChild(totalsRow);
  wrapper.appendChild(createCaseActions(entry, userId, onChange));
  return wrapper;
}

function renderPhaseHistory(entries, label, userId, onChange) {
  if (!entries.length) return null;
  const section = document.createElement('div');
  section.className = 'shared-case-project__history-section';
  const title = document.createElement('div');
  title.className = 'shared-case-project__history-title';
  title.textContent = label;
  section.appendChild(title);
  entries.forEach(entry => {
    const date = resolveCaseDate(entry, resolveCaseMeta(entry));
    const entryWrap = document.createElement('div');
    entryWrap.className = 'shared-case-project__history-entry';
    const item = document.createElement('div');
    item.className = 'shared-case-project__history-item';
    item.textContent = `${entry.caseId.slice(0, 8)} · ${date.formatted || formatDateInput(date.raw) || '–'}`;
    entryWrap.appendChild(item);
    entryWrap.appendChild(createCaseActions(entry, userId, onChange));
    section.appendChild(entryWrap);
  });
  return section;
}

function renderFinishedProjectCard(group, userId, onChange) {
  const card = document.createElement('div');
  card.className = 'shared-case-card shared-case-project';
  const top = document.createElement('div');
  top.className = 'shared-case-card__top';
  const title = document.createElement('h3');
  title.className = 'shared-case-card__title';
  title.textContent = group.jobNumber || 'Ukendt projekt';
  const badge = document.createElement('span');
  badge.className = 'shared-case-card__badge';
  badge.textContent = 'Afsluttet';
  top.appendChild(title);
  top.appendChild(badge);
  card.appendChild(top);

  const meta = group.meta || {};
  const metaGrid = document.createElement('div');
  metaGrid.className = 'shared-case-card__meta';
  const lines = [
    { label: 'Opgave', value: meta.jobName || '–' },
    { label: 'Adresse', value: meta.address || '–' },
    { label: 'Kunde', value: meta.customer || '–' },
    { label: 'System', value: meta.system || '–' },
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
  card.appendChild(metaGrid);

  const latestMontage = group.montageCases[0] || null;
  const latestDemontage = group.demontageCases[0] || null;
  card.appendChild(renderPhaseSummary(latestMontage, 'Seneste montage', userId, onChange));
  card.appendChild(renderPhaseSummary(latestDemontage, 'Seneste demontage', userId, onChange));

  const olderMontage = group.montageCases.slice(1);
  const olderDemontage = group.demontageCases.slice(1);
  if (olderMontage.length || olderDemontage.length) {
    const details = document.createElement('details');
    details.className = 'shared-case-project__history';
    const summary = document.createElement('summary');
    summary.textContent = `Vis historik (${olderMontage.length + olderDemontage.length})`;
    details.appendChild(summary);
    const historyWrap = document.createElement('div');
    historyWrap.className = 'shared-case-project__history-content';
    const montageHistory = renderPhaseHistory(olderMontage, 'Montage', userId, onChange);
    const demontageHistory = renderPhaseHistory(olderDemontage, 'Demontage', userId, onChange);
    if (montageHistory) historyWrap.appendChild(montageHistory);
    if (demontageHistory) historyWrap.appendChild(demontageHistory);
    details.appendChild(historyWrap);
    card.appendChild(details);
  }

  return card;
}

function sortEntries(entries, sortKey) {
  const list = entries.slice();
  if (sortKey === 'updated-asc') {
    return list.sort((a, b) => (a.lastUpdatedAt || a.updatedAt || '').localeCompare(b.lastUpdatedAt || b.updatedAt || ''));
  }
  if (sortKey === 'updated-desc') {
    return list.sort((a, b) => (b.lastUpdatedAt || b.updatedAt || '').localeCompare(a.lastUpdatedAt || a.updatedAt || ''));
  }
  if (sortKey === 'total-desc') {
    return list.sort((a, b) => resolveCaseTotals(b, resolveCaseMeta(b)).total - resolveCaseTotals(a, resolveCaseMeta(a)).total);
  }
  if (sortKey === 'total-asc') {
    return list.sort((a, b) => resolveCaseTotals(a, resolveCaseMeta(a)).total - resolveCaseTotals(b, resolveCaseMeta(b)).total);
  }
  return list.sort((a, b) => (b.lastUpdatedAt || b.updatedAt || '').localeCompare(a.lastUpdatedAt || a.updatedAt || ''));
}

function buildBoardBuckets(entries, columns) {
  const buckets = new Map();
  columns.forEach(column => {
    buckets.set(column.id, []);
  });
  entries.forEach(entry => {
    const bucketId = deriveBoardStatus(entry);
    const bucket = buckets.get(bucketId);
    if (bucket) {
      bucket.push(entry);
    }
  });
  return buckets;
}

function syncBoardContents(board, buckets, columns, userId, onChange, allCounts, { focusStatus = '' } = {}) {
  columns.forEach(column => {
    const columnEl = board.querySelector(`.shared-board-column[data-status="${column.id}"]`);
    if (!columnEl) return;
    if (focusStatus) {
      const isFocused = column.id === focusStatus;
      columnEl.classList.toggle('is-focused', isFocused);
      columnEl.classList.toggle('is-dimmed', !isFocused);
    } else {
      columnEl.classList.remove('is-focused', 'is-dimmed');
    }
    const count = columnEl.querySelector('.shared-board-count');
    const columnEntries = buckets.get(column.id) || [];
    if (count) {
      const countValue = allCounts instanceof Map ? (allCounts.get(column.id) || 0) : columnEntries.length;
      count.textContent = countValue;
    }
    const list = columnEl.querySelector('.shared-board-list');
    if (!list) return;
    list.textContent = '';
    columnEntries.forEach(entry => list.appendChild(renderCaseCardCompact(entry, userId, onChange)));
    if (!columnEntries.length) {
      const empty = document.createElement('div');
      empty.className = 'shared-board-meta';
      empty.textContent = 'Ingen sager';
      list.appendChild(empty);
    }
  });
}

function renderBoard(entries, userId, onChange, allCounts, { includeDeleted = false, focusStatus = '' } = {}) {
  const board = document.createElement('div');
  board.className = 'shared-board';
  if (focusStatus) {
    board.dataset.focus = focusStatus;
  }
  const columns = getBoardColumns({ includeDeleted });
  const buckets = buildBoardBuckets(entries, columns);
  columns.forEach(column => {
    const columnEl = document.createElement('section');
    columnEl.className = 'shared-board-column';
    columnEl.dataset.status = column.id;
    if (focusStatus) {
      const isFocused = column.id === focusStatus;
      columnEl.classList.toggle('is-focused', isFocused);
      if (!isFocused) {
        columnEl.classList.add('is-dimmed');
      }
    }
    const header = document.createElement('div');
    header.className = 'shared-board-header';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'shared-board-title-wrap';
    const dot = document.createElement('span');
    dot.className = 'shared-board-dot';
    dot.setAttribute('aria-hidden', 'true');
    const title = document.createElement('h3');
    title.className = 'shared-board-title';
    title.textContent = column.label;
    const count = document.createElement('span');
    count.className = 'shared-board-count';
    const columnEntries = buckets.get(column.id) || [];
    const countValue = allCounts instanceof Map ? (allCounts.get(column.id) || 0) : columnEntries.length;
    count.textContent = countValue;
    titleWrap.appendChild(dot);
    titleWrap.appendChild(title);
    header.appendChild(titleWrap);
    header.appendChild(count);
    columnEl.appendChild(header);
    const list = document.createElement('div');
    list.className = 'shared-board-list';
    columnEntries.forEach(entry => list.appendChild(renderCaseCardCompact(entry, userId, onChange)));
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
  renderStatusSummary(composeStatusMessage(text));
}

function setRefreshState(state = 'idle') {
  if (!refreshBtn) return;
  const label = state === 'loading' ? 'Opdaterer…' : state === 'error' ? 'Prøv igen' : 'Opdater';
  sharedCasesUI.isRefreshing = state === 'loading';
  refreshBtn.textContent = label;
  refreshBtn.disabled = state === 'loading';
  refreshBtn.classList.toggle('is-loading', state === 'loading');
  refreshBtn.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
}

function updateSharedStatus(message) {
  statusMessage = message || '';
  setSharedStatus(statusMessage);
  updateStatusCard();
}

function updateSyncStatus() {
  setSharedStatus(statusMessage);
  updateStatusCard();
}

function resetCaseState() {
  casesById.clear();
  caseItems = [];
  resetPaginationState();
  lastDeltaAt = null;
  lastDeltaCaseId = '';
  syncState.since = null;
  syncState.sinceId = null;
  lastDeltaSyncLabel = '';
  updateSharedLastUpdatedLabel('');
  touchCaseItems();
}

function replaceCaseState(entries) {
  casesById.clear();
  resetPaginationState();
  const { map, list } = mergeCasesById(new Map(), entries);
  map.forEach((value, key) => casesById.set(key, value));
  caseItems = list;
  touchCaseItems();
}

function resetPaginationState() {
  nextCursor = null;
  hasMore = false;
  seenCursorKeys = new Set();
}

function setTestState({ session, teamIdValue, role } = {}) {
  sessionState = session || {};
  teamId = teamIdValue || sessionState?.teamId || teamId || formatTeamId(DEFAULT_TEAM_SLUG);
  displayTeamId = sessionState.displayTeamId || getDisplayTeamId(teamId);
  membershipRole = role || sessionState.role || membershipRole;
  membershipError = null;
  teamError = '';
  activeFilters = null;
  isLoading = false;
  loadingCount = 0;
  latestRequestId = 0;
}

function getCursorKey(cursor) {
  if (!cursor) return '';
  try {
    return JSON.stringify(cursor);
  } catch {
    return '';
  }
}

function mergeCasesById(existingMap, incomingList, { deletedIds = [] } = {}) {
  const nextMap = new Map(existingMap || []);
  deletedIds.forEach(caseId => {
    if (caseId) nextMap.delete(caseId);
  });
  (incomingList || []).forEach(entry => {
    if (!entry?.caseId) {
      warnMissingCaseId(entry);
      return;
    }
    if (normalizeStatusValue(entry.status) === WORKFLOW_STATUS.DELETED) {
      nextMap.delete(entry.caseId);
      return;
    }
    const existing = nextMap.get(entry.caseId);
    const updated = normalizeStoredEntry(entry, existing);
    if (!existing) {
      nextMap.set(entry.caseId, updated);
      return;
    }
    const existingKey = getDeltaKey(existing);
    const incomingKey = getDeltaKey(updated);
    if (compareDeltaKeys(existingKey, incomingKey) <= 0) {
      nextMap.set(entry.caseId, updated);
    }
  });
  applyPendingMarkers(nextMap);
  const mergedList = Array.from(nextMap.values()).sort((a, b) => {
    return compareDeltaKeys(getDeltaKey(b), getDeltaKey(a));
  });
  return { map: nextMap, list: mergedList };
}

function mergeEntries(entries, { prepend = false } = {}) {
  const { map, list } = mergeCasesById(casesById, entries);
  casesById.clear();
  map.forEach((value, key) => casesById.set(key, value));
  caseItems = list;
  touchCaseItems();
}

function updateCaseEntry(updatedCase) {
  if (!updatedCase?.caseId) return;
  const existing = casesById.get(updatedCase.caseId);
  const merged = normalizeStoredEntry(updatedCase, existing);
  mergeEntries([merged], { prepend: true });
  if (activeCaseDetail?.caseId === merged.caseId) {
    activeCaseDetail.entry = merged;
    refreshActiveCaseDetail();
  }
}

async function handleExportedEvent(detail) {
  if (!requireAuth()) return;
  const caseData = detail?.case || null;
  const caseId = caseData?.caseId || detail?.caseId || '';
  if (caseData?.caseId) {
    updateCaseEntry(caseData);
    if (sharedCasesContainer) {
      renderFromState(sharedCasesContainer, sessionState?.user?.uid || 'offline-user');
    }
    updateDeltaCursorFromItems([caseData]);
    lastDeltaSyncLabel = formatTimeLabel(new Date());
    updateSharedStatus('Opdateret');
  }
  if (caseId) {
    try {
      await refreshCases({ prepend: false });
    } catch {
      // refreshCases handles errors
    }
  }
}

function buildOptimisticUpdate(entry, updates) {
  if (!entry?.caseId) return null;
  const base = { ...entry };
  delete base.__viewBucket;
  return {
    ...base,
    ...updates,
    __syncing: true,
  };
}

function resolveIfMatchUpdatedAt(entry) {
  return entry?.updatedAt || entry?.lastUpdatedAt || entry?.last_updated_at || '';
}

function buildPendingUpdate(entry, updates) {
  if (!entry?.caseId) return null;
  const base = { ...entry };
  delete base.__viewBucket;
  return {
    ...base,
    ...updates,
    __syncing: false,
    __pendingAction: true,
  };
}

function buildPendingAction(type, entry, payload = {}) {
  return {
    type,
    caseId: entry?.caseId || '',
    payload,
    localTs: Date.now(),
  };
}

async function performPendingAction(action, { updatedAtOverride } = {}) {
  if (!action || !action.caseId) return null;
  if (action.type === 'approve') {
    return await approveSharedCase(ensureTeamSelected(), action.caseId, {
      ifMatchUpdatedAt: updatedAtOverride || action.payload?.ifMatchUpdatedAt || '',
    });
  }
  if (action.type === 'status') {
    return await updateSharedCaseStatus(ensureTeamSelected(), action.caseId, {
      status: action.payload?.status,
      phase: action.payload?.phase,
      ifMatchUpdatedAt: updatedAtOverride || action.payload?.ifMatchUpdatedAt || '',
    });
  }
  if (action.type === 'delete') {
    return await deleteSharedCase(ensureTeamSelected(), action.caseId);
  }
  return null;
}

async function flushPendingActions() {
  if (!syncState.online || syncState.isSyncing || !syncState.pendingActions.length) return;
  syncState.isSyncing = true;
  updateSyncStatus();
  const pending = syncState.pendingActions.slice();
  const remaining = [];
  let appliedCount = 0;
  for (const action of pending) {
    try {
      const result = await performPendingAction(action);
      if (result?.queued) {
        remaining.push(action);
        break;
      }
      if (action.type === 'delete') {
        removeCaseEntry(action.caseId);
      } else if (result) {
        updateCaseEntry({ ...result, __syncing: false });
      }
      appliedCount += 1;
    } catch (error) {
      if (error?.status === 409) {
        await handleConflictError(error, casesById.get(action.caseId), null, {
          caseId: action.caseId,
          retryAction: async (freshEntry) => {
            const updatedAt = freshEntry?.updatedAt || freshEntry?.lastUpdatedAt || freshEntry?.last_updated_at || '';
            const result = await performPendingAction(action, { updatedAtOverride: updatedAt });
            if (action.type === 'delete') {
              removeCaseEntry(action.caseId);
            } else if (result) {
              updateCaseEntry({ ...result, __syncing: false });
            }
            removePendingAction(action);
          },
          discardAction: () => {
            removePendingAction(action);
          },
        });
        syncState.isSyncing = false;
        updateSyncStatus();
        return;
      }
      const isNetworkError = error instanceof TypeError || /network|offline|failed to fetch/i.test(error?.message || '');
      remaining.push(action);
      if (isNetworkError) break;
    }
  }
  setPendingActions(remaining);
  if (appliedCount > 0) {
    syncState.lastSyncAt = new Date().toISOString();
  }
  syncState.isSyncing = false;
  updateSyncStatus();
}

function removeCaseEntry(caseId) {
  if (!caseId) return;
  if (activeCaseDetail?.caseId === caseId && typeof activeCaseDetail.close === 'function') {
    activeCaseDetail.close();
  }
  casesById.delete(caseId);
  const { list } = mergeCasesById(casesById, []);
  caseItems = list;
  touchCaseItems();
}

function getActiveFilters() {
  return activeFilters || getFilters();
}

function handleFiltersChanged({ immediate = false, fast = false } = {}) {
  if (!sharedCasesContainer) return;
  const filters = getFilters();
  if (activeFilters && areFiltersEqual(filters, activeFilters)) {
    return;
  }
  activeFilters = filters;
  logFilterChange(filters, { total: caseItems.length });
  if (immediate) {
    renderFromState(sharedCasesContainer, sessionState?.user?.uid || 'offline-user');
    return;
  }
  if (fast && typeof debouncedQuickRender === 'function') {
    debouncedQuickRender();
    return;
  }
  if (typeof debouncedFilterRender === 'function') {
    debouncedFilterRender();
    return;
  }
  renderFromState(sharedCasesContainer, sessionState?.user?.uid || 'offline-user');
}

function renderFromState(container, userId) {
  const debugEnabled = isDebugEnabled();
  const start = debugEnabled && typeof performance !== 'undefined' ? performance.now() : 0;
  const filters = getActiveFilters();
  const filterKey = getFilterKey(filters);
  const sortKey = filters?.sort || 'updated-desc';
  const includeDeleted = isAdminUser() && filters?.statusFocus === WORKFLOW_STATUS.DELETED;
  let expandedEntries = caseItems;
  if (!includeDeleted) {
    expandedEntries = expandedEntries.filter(entry => normalizeStatusValue(entry?.status) !== WORKFLOW_STATUS.DELETED);
  }
  let allCounts = null;
  let scopeEntries = null;
  let displayEntries = null;
  let sorted = null;
  if (renderCache.version === caseItemsVersion && renderCache.filterKey === filterKey) {
    allCounts = renderCache.allCounts;
    scopeEntries = renderCache.scopeEntries;
    displayEntries = renderCache.displayEntries;
  } else {
    scopeEntries = expandedEntries.filter(entry => {
      const meta = resolveCaseMeta(entry);
      return matchesFilters(entry, meta, filters);
    });
    allCounts = computeBucketCounts(scopeEntries, { includeDeleted });
    displayEntries = scopeEntries;
    renderCache = {
      version: caseItemsVersion,
      filterKey,
      sortKey: '',
      allCounts,
      scopeEntries,
      displayEntries,
      sortedEntries: null,
    };
  }
  if (renderCache.version === caseItemsVersion && renderCache.filterKey === filterKey && renderCache.sortKey === sortKey) {
    sorted = renderCache.sortedEntries || [];
  } else {
    sorted = sortEntries(displayEntries, sortKey);
    renderCache.sortKey = sortKey;
    renderCache.sortedEntries = sorted;
  }
  if (debugEnabled) {
    debugLog('shared-cases grouped', {
      total: expandedEntries.length,
      counts: countsToObject(allCounts),
    });
  }
  if (debugEnabled && expandedEntries.length > 0 && sorted.length === 0) {
    debugWarn('shared-cases stale state guard', {
      total: expandedEntries.length,
      filtered: scopeEntries.length,
      filters,
    });
  }
  const onChange = (payload) => {
    if (payload?.updatedCase) updateCaseEntry(payload.updatedCase);
    if (payload?.removeCaseId) removeCaseEntry(payload.removeCaseId);
    renderFromState(container, userId);
  };
  lastRenderUserId = userId;
  lastRenderOnChange = onChange;
  renderSharedCases(container, sorted, filters, userId, onChange, allCounts, { includeDeleted });
  attemptOpenDeepLink();
  if (debugEnabled && start) {
    const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
    debugLog('shared-cases render', { durationMs: Number((end - start).toFixed(1)), visible: sorted.length });
  }
}

function updateDeltaCursorFromItems(items) {
  if (!Array.isArray(items) || !items.length) return;
  const maxKey = getMaxDeltaKey(items);
  if (maxKey.updatedAt) {
    lastDeltaAt = maxKey.updatedAt;
    lastDeltaCaseId = maxKey.caseId || lastDeltaCaseId;
    syncState.since = lastDeltaAt;
    syncState.sinceId = lastDeltaCaseId;
  }
}

function updateDeltaCursorFromPayload(payload) {
  const maxUpdatedAt = payload?.maxUpdatedAt || payload?.cursor?.updatedAt || payload?.cursor?.maxUpdatedAt || '';
  const nextSinceId = payload?.nextSinceId || payload?.cursor?.caseId || payload?.cursor?.sinceId || '';
  if (!maxUpdatedAt) return false;
  lastDeltaAt = maxUpdatedAt;
  syncState.since = maxUpdatedAt;
  if (nextSinceId) {
    lastDeltaCaseId = nextSinceId;
    syncState.sinceId = nextSinceId;
  }
  return true;
}

function markDeltaSynced(message) {
  const now = new Date();
  lastDeltaSyncLabel = formatTimeLabel(now);
  updateSharedLastUpdatedLabel(now);
  updateSharedStatus(message || '');
}

function stopDeltaPolling(reason) {
  if (deltaTimer) {
    clearTimeout(deltaTimer);
    deltaTimer = null;
  }
  pollingActive = false;
  pollingReason = reason || '';
  syncState.isSyncing = false;
  updateSyncStatus();
}

function scheduleNextDelta({ immediate = false } = {}) {
  if (deltaTimer) {
    clearTimeout(deltaTimer);
    deltaTimer = null;
  }
  if (!pollingActive) return;
  const delay = immediate ? 0 : (syncState.backoffMs || POLL_INTERVAL_MS);
  deltaTimer = setTimeout(() => {
    runDeltaSync().catch(() => {
      // handled in runDeltaSync
    });
  }, delay);
}

function startDeltaPolling() {
  if (pollingActive) return;
  pollingActive = true;
  pollingReason = '';
  scheduleNextDelta({ immediate: true });
  updateSyncStatus();
}

function updatePollingState() {
  if (!sharedCard || !sharedCasesContainer) return;
  syncState.online = isOnline();
  if (!requireAuth()) {
    stopDeltaPolling('ingen adgang');
    return;
  }
  if (!isOnline()) {
    stopDeltaPolling('offline');
    return;
  }
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    stopDeltaPolling('fanen er skjult');
    return;
  }
  if (sharedCard.hidden) {
    stopDeltaPolling('panelet er skjult');
    return;
  }
  startDeltaPolling();
}

async function runDeltaSync() {
  if (deltaInFlight || isLoading) return;
  if (!sharedCasesContainer) return;
  if (!requireAuth()) return;
  if (!isOnline()) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (sharedCard?.hidden) return;
  if (syncState.isSyncing && syncState.pendingActions.length) return;
  deltaInFlight = true;
  syncState.isSyncing = true;
  updateSyncStatus();
  const debugEnabled = isDebugEnabled();
  const start = debugEnabled && typeof performance !== 'undefined' ? performance.now() : 0;
  try {
    if (!lastDeltaAt) {
      await refreshCases({ prepend: false });
      return;
    }
    const payload = await listSharedCasesDelta(ensureTeamSelected(), {
      since: lastDeltaAt,
      sinceId: lastDeltaCaseId,
      limit: 200,
    });
    const items = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.items) ? payload.items : []);
    const deleted = Array.isArray(payload?.deleted) ? payload.deleted : [];
    if (debugEnabled && start) {
      const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
      debugLog('shared-cases delta fetched', { count: items.length, durationMs: Number((end - start).toFixed(1)) });
    }
    let didChange = false;
    if (deleted.length || items.length) {
      const { map, list } = mergeCasesById(casesById, items, { deletedIds: deleted });
      casesById.clear();
      map.forEach((value, key) => casesById.set(key, value));
      caseItems = list;
      touchCaseItems();
      didChange = true;
    }
    if (!updateDeltaCursorFromPayload(payload)) {
      if (items.length) {
        updateDeltaCursorFromItems(items);
      } else if (payload?.maxUpdatedAt) {
        lastDeltaAt = payload.maxUpdatedAt;
        syncState.since = lastDeltaAt;
      }
    }
    if (didChange) {
      renderFromState(sharedCasesContainer, sessionState?.user?.uid || 'offline-user');
      markDeltaSynced('Opdateret');
    } else {
      markDeltaSynced('Synkroniseret');
    }
    syncState.backoffMs = 0;
    syncState.lastSyncAt = new Date().toISOString();
    clearInlineError();
  } catch (error) {
    appendDebug(`Delta sync fejl: ${error?.message || 'Ukendt fejl'}`);
    syncState.backoffMs = Math.min(syncState.backoffMs ? syncState.backoffMs * 2 : BACKOFF_BASE_MS, BACKOFF_MAX_MS);
  } finally {
    deltaInFlight = false;
    syncState.isSyncing = false;
    updateSyncStatus();
    scheduleNextDelta();
  }
}

async function fetchCasesPage({ reset = false, prepend = false, requestId = null, replace = false, allowParallel = false } = {}) {
  if (isLoading && !allowParallel) return null;
  if (!requireAuth()) return null;
  startLoading();
  const debugEnabled = isDebugEnabled();
  const start = debugEnabled && typeof performance !== 'undefined' ? performance.now() : 0;
  try {
    const filters = reset ? getFilters() : (activeFilters || getFilters());
    if (reset) {
      activeFilters = filters;
    }
    const includeDeleted = isAdminUser() && filters?.statusFocus === WORKFLOW_STATUS.DELETED;
    const page = await listSharedCasesPageFn(ensureTeamSelected(), {
      limit: 100,
      cursor: reset ? null : nextCursor,
      q: '',
      from: '',
      to: '',
      includeDeleted,
    });
    if (requestId && requestId !== latestRequestId) return null;
    const items = Array.isArray(page?.items) ? page.items : [];
    if (reset && replace) {
      replaceCaseState(items);
    } else if (reset && prepend) {
      mergeEntries(items, { prepend: true });
    } else if (reset) {
      mergeEntries(items, { prepend: false });
    }
    if (!reset) {
      mergeEntries(items, { prepend: false });
    }
    const newCursor = page?.nextCursor || page?.cursor || null;
    const newCursorKey = getCursorKey(newCursor);
    if (newCursorKey && seenCursorKeys.has(newCursorKey)) {
      nextCursor = null;
      hasMore = false;
      updateSharedStatus('Stopper: serveren returnerede samme side igen.');
      appendDebug('Load more stoppet: næste cursor gentog sig.');
    } else {
      if (newCursorKey) {
        seenCursorKeys.add(newCursorKey);
      }
      nextCursor = newCursor;
      hasMore = Boolean(nextCursor) || Boolean(page?.hasMore);
    }
    if (debugEnabled && start) {
      const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
      debugLog('shared-cases page fetched', {
        count: items.length,
        hasMore,
        durationMs: Number((end - start).toFixed(1)),
      });
    }
    return { entries: caseItems.slice(), filters };
  } finally {
    stopLoading();
  }
}

function renderSharedCases(container, entries, filters, userId, onChange, allCounts, { includeDeleted = false } = {}) {
  const focusStatus = filters?.statusFocus || '';
  const columns = getBoardColumns({ includeDeleted });
  const hasCounts = allCounts instanceof Map
    && Array.from(allCounts.values()).some(value => value > 0);
  updateSharedHeaderCount(entries.length);
  const existingBoard = container.querySelector('.shared-board');
  const existingColumns = existingBoard
    ? Array.from(existingBoard.querySelectorAll('.shared-board-column')).map(col => col.dataset.status)
    : [];
  const matchesColumns = existingBoard
    && existingColumns.length === columns.length
    && existingColumns.every((id, idx) => id === columns[idx].id);
  if (!entries.length && !hasCounts) {
    container.textContent = '';
    const empty = document.createElement('p');
    empty.textContent = 'Ingen delte sager endnu.';
    container.appendChild(empty);
    return;
  }
  if (!existingBoard || !matchesColumns) {
    container.textContent = '';
    const board = renderBoard(entries, userId, onChange, allCounts, { includeDeleted, focusStatus });
    container.appendChild(board);
  } else {
    const scrollLeft = existingBoard.scrollLeft;
    const scrollTop = existingBoard.scrollTop;
    const buckets = buildBoardBuckets(entries, columns);
    syncBoardContents(existingBoard, buckets, columns, userId, onChange, allCounts, { focusStatus });
    if (focusStatus) {
      existingBoard.dataset.focus = focusStatus;
    } else {
      delete existingBoard.dataset.focus;
    }
    requestAnimationFrame(() => {
      existingBoard.scrollLeft = scrollLeft;
      existingBoard.scrollTop = scrollTop;
    });
  }
  let status = container.querySelector('.shared-cases-status');
  if (!status) {
    status = document.createElement('div');
    status.className = 'shared-cases-status';
    container.appendChild(status);
  }
  status.textContent = `Viser ${entries.length} sager${hasMore ? ' (flere kan hentes)' : ''}.`;
  if (hasMore) {
    if (!loadMoreBtn || !container.contains(loadMoreBtn)) {
      loadMoreBtn = document.createElement('button');
      loadMoreBtn.type = 'button';
      loadMoreBtn.className = 'shared-load-more';
      loadMoreBtn.textContent = 'Hent flere';
      loadMoreBtn.addEventListener('click', async () => {
        if (isLoading) return;
        loadMoreBtn.disabled = true;
        loadMoreBtn.textContent = 'Henter…';
        try {
          const page = await fetchCasesPage({ reset: false, prepend: false });
          if (!page) return;
          renderFromState(container, userId);
          updateSharedStatus('Synkroniseret');
          clearInlineError();
        } catch (error) {
          handleActionError(error, 'Kunne ikke hente flere sager', { teamContext: teamId });
          appendDebug(`Load more fejl: ${error?.message || 'Ukendt fejl'}`);
          loadMoreBtn.textContent = 'Hent flere';
        } finally {
          loadMoreBtn.disabled = false;
        }
      });
      container.appendChild(loadMoreBtn);
    }
  } else if (loadMoreBtn && container.contains(loadMoreBtn)) {
    loadMoreBtn.remove();
    loadMoreBtn = null;
  }
  if (focusStatus && focusStatus !== lastFocusStatus) {
    requestAnimationFrame(() => {
      const target = container.querySelector(`.shared-board-column[data-status="${focusStatus}"]`);
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
      }
    });
  }
  lastFocusStatus = focusStatus;
}

export function initSharedCasesPanel() {
  if (sharedCasesPanelInitialized) return;
  sharedCasesContainer = document.getElementById('sharedCasesList');
  if (!sharedCasesContainer) return;
  pendingDeepLinkCaseId = readDeepLinkCaseId();
  deepLinkHandled = false;
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
  loadPendingActionsForTeam(teamId);
  syncState.online = isOnline();
  updateSyncStatus();
  setPanelVisibility(false);
  const {
    searchEl,
    fromEl,
    toEl,
    focusEl,
    resetBtn,
    refreshBtn: refreshBtnEl,
    kindEl,
    sortEl,
    lastUpdatedEl,
  } = getSharedCasesElements();
  refreshBtn = refreshBtnEl;
  const filters = [searchEl, fromEl, toEl, focusEl, kindEl, sortEl].filter(Boolean);
  applyStoredFilters();
  if (lastUpdatedEl) {
    updateSharedLastUpdatedLabel(sharedCasesUI.lastUpdatedLabel);
  }
  updateSharedStatus();
  updateStatusCard();
  const initialFilters = getFilters();
  activeFilters = initialFilters;
  debouncedFilterRender = debounce(() => {
    if (!sharedCasesContainer) return;
    renderFromState(sharedCasesContainer, sessionState?.user?.uid || 'offline-user');
  }, 200);
  debouncedQuickRender = debounce(() => {
    if (!sharedCasesContainer) return;
    renderFromState(sharedCasesContainer, sessionState?.user?.uid || 'offline-user');
  }, 80);

  refreshCases = async ({ prepend = false } = {}) => {
    if (!sharedCasesContainer) return;
    if (!requireAuth()) {
      sharedCasesContainer.textContent = teamError || sessionState?.message || 'Login mangler.';
      setRefreshState('idle');
      return;
    }
    const existingBoard = sharedCasesContainer.querySelector('.shared-board');
    const previousScroll = existingBoard ? { left: existingBoard.scrollLeft, top: existingBoard.scrollTop } : null;
    setRefreshState('loading');
    if (!prepend && !caseItems.length) {
      sharedCasesContainer.textContent = 'Henter sager…';
    }
    updateSharedStatus('Opdaterer…');
    const currentUser = sessionState?.user?.uid || 'offline-user';
    let requestId = 0;
    try {
      requestId = ++latestRequestId;
      const page = await fetchCasesPage({
        reset: true,
        prepend,
        requestId,
        replace: true,
        allowParallel: true,
      });
      if (!page || requestId !== latestRequestId) {
        if (requestId === latestRequestId) {
          setRefreshState('idle');
        }
        return;
      }
      renderFromState(sharedCasesContainer, currentUser);
      updateDeltaCursorFromItems(caseItems);
      const refreshedBoard = sharedCasesContainer.querySelector('.shared-board');
      if (previousScroll && refreshedBoard) {
        requestAnimationFrame(() => {
          refreshedBoard.scrollLeft = previousScroll.left;
          refreshedBoard.scrollTop = previousScroll.top;
        });
      }
      const now = new Date();
      syncState.lastSyncAt = now.toISOString();
      syncState.backoffMs = 0;
      lastDeltaSyncLabel = formatTimeLabel(now);
      updateSharedLastUpdatedLabel(now);
      updateSharedStatus('');
      clearInlineError();
      setRefreshState('idle');
    } catch (error) {
      const denied = error?.code === 'permission-denied' || error instanceof PermissionDeniedError;
      const message = describePermissionError(error, teamId) || error?.message || 'Kunne ikke hente delte sager.';
      const status = typeof error?.status === 'number' ? error.status : 0;
      const looksLikeAuth = status === 401 || message.includes('"iss"') || message.includes('"aud"');
      if (denied) teamError = message;
      if (denied || looksLikeAuth) {
        resetCaseState();
      }
      sharedCasesContainer.textContent = looksLikeAuth
        ? `${message} (Login token matcher ikke serverens Auth0-konfig. Prøv Log ud → Log ind igen.)`
        : `${message} ${denied ? '' : 'Tjek netværk eller log ind igen.'}`.trim();
      setInlineError(message);
      updateSharedStatus(`Fejl: ${message}`);
      if (requestId === latestRequestId) {
        setRefreshState('error');
      }
      appendDebug(`Liste fejl: ${message}`);
    }
  };

  if (refreshBtn) refreshBtn.addEventListener('click', refreshCases);
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (searchEl) searchEl.value = '';
      if (fromEl) fromEl.value = '';
      if (toEl) toEl.value = '';
      if (focusEl) focusEl.value = '';
      if (kindEl) kindEl.value = '';
      if (sortEl) sortEl.value = 'updated-desc';
      handleFiltersChanged({ immediate: true });
    });
  }
  filters.forEach(input => {
    const isServerInput = [
      'sharedCasesSearch',
      'sharedSearchInput',
      'sharedCasesFrom',
      'sharedDateFrom',
      'sharedCasesTo',
      'sharedDateTo',
    ].includes(input.id);
    if (isServerInput) {
      input.addEventListener('input', () => handleFiltersChanged({ immediate: false }));
      input.addEventListener('change', () => handleFiltersChanged({ immediate: false }));
    } else {
      input.addEventListener('input', () => handleFiltersChanged({ immediate: false, fast: true }));
      input.addEventListener('change', () => handleFiltersChanged({ immediate: false, fast: true }));
    }
  });

  bindSessionControls(() => refreshCases(), () => {
    if (!requireAuth()) {
      sharedCasesContainer.textContent = teamError || sessionState?.message || 'Log ind for at se delte sager.';
      setRefreshState('idle');
      updatePollingState();
      return;
    }
    refreshCases();
    updatePollingState();
  });

  // Automatically refresh the shared cases list when a case is exported. The
  // export workflow dispatches a `cssmate:exported` event; listening here
  // keeps the list in sync without reloading all pages.
  if (typeof window !== 'undefined') {
    window.addEventListener('cssmate:exported', (event) => {
      handleExportedEvent(event?.detail || {}).catch(() => {});
    });

    window.addEventListener('online', () => {
      syncState.online = true;
      updateSyncStatus();
      flushPendingActions().catch(() => {});
      updatePollingState();
      runDeltaSync().catch(() => {});
    });

    window.addEventListener('offline', () => {
      syncState.online = false;
      updateSyncStatus();
      updatePollingState();
    });
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      updatePollingState();
      if (document.visibilityState === 'visible') {
        runDeltaSync().catch(() => {});
      }
    });
  }
}

export { formatMissingMembershipMessage };
export const __test = {
  computeBucketCounts,
  fetchCasesPage,
  handleExportedEvent,
  resetCaseState,
  setRefreshHandler,
  setListSharedCasesPage,
  setTestState,
  deriveBoardStatus,
  resolveEntryBucket,
  WORKFLOW_STATUS,
  openCaseDetails,
};
