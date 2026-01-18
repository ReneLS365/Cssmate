import { listSharedGroups, downloadCaseJson, importCasePayload, updateCaseStatus, deleteSharedCase, formatTeamId, PermissionDeniedError, normalizeTeamId, getDisplayTeamId, MembershipMissingError, DEFAULT_TEAM_SLUG } from './shared-ledger.js';
import { exportPDFBlob } from './export-pdf.js';
import { buildExportModel } from './export-model.js';
import { downloadBlob } from './utils/downloadBlob.js';
import { getUserDisplay } from './shared-auth.js';
import { initAuthSession, onChange as onSessionChange, getState as getSessionState, SESSION_STATUS } from '../src/auth/session.js';
import { TEAM_ACCESS_STATUS } from '../src/services/team-access.js';

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
  if (error instanceof MembershipMissingError) {
    const uid = sessionState?.user?.uid || 'uid';
    return formatMissingMembershipMessage(error.teamId || attemptedTeamId, uid);
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
  const job = document.getElementById('sharedFilterJob');
  const status = document.getElementById('sharedFilterStatus');
  const kind = document.getElementById('sharedFilterKind');
  return {
    job: (job?.value || '').toLowerCase().trim(),
    status: status?.value || '',
    kind: kind?.value || '',
  };
}

function matchesFilters(entry, filters) {
  const jobMatch = !filters.job || (entry.jobNumber || '').toLowerCase().includes(filters.job);
  const statusMatch = !filters.status || entry.status === filters.status;
  const kindMatch = !filters.kind || entry.caseKind === filters.kind;
  return jobMatch && statusMatch && kindMatch;
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
    } catch (error) {
      console.error('Import fejlede', error);
      handleActionError(error, 'Import fejlede', { teamContext: teamId });
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
    } catch (error) {
      console.error('Download fejlede', error);
      handleActionError(error, 'Kunne ikke hente JSON', { teamContext: teamId });
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
    } catch (error) {
      console.error('PDF fejlede', error);
      handleActionError(error, 'Kunne ikke generere PDF', { teamContext: teamId });
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
        await updateCaseStatus(ensureTeamSelected(), entry.caseId, next);
        await onChange();
      } catch (error) {
        console.error('Status opdatering fejlede', error);
        handleActionError(error, 'Kunne ikke opdatere status', { teamContext: teamId });
      } finally {
        statusBtn.disabled = false;
      }
    });
    container.appendChild(statusBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Soft delete';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Soft delete?')) return;
      deleteBtn.disabled = true;
      try {
        await deleteSharedCase(ensureTeamSelected(), entry.caseId);
        await onChange();
      } catch (error) {
        console.error('Sletning fejlede', error);
        handleActionError(error, 'Kunne ikke slette sag', { teamContext: teamId });
      } finally {
        deleteBtn.disabled = false;
      }
    });
    container.appendChild(deleteBtn);
  }

  return container;
}

function renderCase(entry, userId, onChange) {
  const item = document.createElement('div');
  item.className = 'shared-case-item';
  const title = document.createElement('div');
  title.className = 'shared-case-title';
  title.textContent = `${entry.caseKind || ''} · ${entry.system || ''}`;
  const meta = document.createElement('div');
  meta.className = 'shared-case-meta';
  meta.textContent = `${entry.status || 'kladde'} · ${entry.createdAt || ''}`;
  const totals = document.createElement('div');
  totals.className = 'shared-case-totals';
  const materials = entry?.totals?.materials || entry?.totals?.materialsSum || entry?.totals?.materialTotal || 0;
  const total = entry?.totals?.total || entry?.totals?.project || entry?.totals?.akkord || 0;
  totals.textContent = `Materialer: ${materials} · Total: ${total}`;

  item.appendChild(title);
  item.appendChild(meta);
  item.appendChild(totals);
  item.appendChild(createCaseActions(entry, userId, onChange));
  return item;
}

function renderGroup(group, userId, onChange) {
  const details = document.createElement('details');
  details.className = 'shared-group';
  details.open = false;
  const summary = document.createElement('summary');
  summary.textContent = `${group.jobNumber} (${group.cases.length})`;
  details.appendChild(summary);
  group.cases.forEach(entry => {
    details.appendChild(renderCase(entry, userId, onChange));
  });
  return details;
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
  const filters = ['sharedFilterJob', 'sharedFilterStatus', 'sharedFilterKind']
    .map(id => document.getElementById(id))
    .filter(Boolean);
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
      const groups = await listSharedGroups(ensureTeamSelected());
      const activeFilters = getFilters();
      const filtered = groups.map(group => ({
        ...group,
        cases: group.cases.filter(entry => matchesFilters(entry, activeFilters)),
      })).filter(group => group.cases.length);
      container.textContent = '';
      if (!filtered.length) {
        const empty = document.createElement('p');
        empty.textContent = 'Ingen delte sager endnu.';
        container.appendChild(empty);
        setRefreshState('idle');
        return;
      }
      filtered.forEach(group => container.appendChild(renderGroup(group, currentUser, refresh)));
      setSharedStatus('Synkroniseret');
      clearInlineError();
      setRefreshState('idle');
    } catch (error) {
      console.error('Kunne ikke hente delte sager', error);
      const denied = error?.code === 'permission-denied' || error instanceof PermissionDeniedError;
      const message = describePermissionError(error, teamId) || error?.message || 'Kunne ikke hente delte sager.';
      if (denied) teamError = message;
      container.textContent = `${message} ${denied ? '' : 'Tjek netværk eller ret Team ID.'}`.trim();
      setInlineError(message);
      setSharedStatus(`Fejl: ${message}`);
      setRefreshState('error');
      appendDebug(`Liste fejl: ${message}`);
    }
  };

  if (refreshBtn) refreshBtn.addEventListener('click', refresh);
  filters.forEach(input => input.addEventListener('input', () => refresh()))

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
        if (requireAuth()) refresh();
      } catch (error) {
        // Ignore errors (likely due to no auth), since refresh will run on next auth change.
      }
    });
  }
}

export { formatMissingMembershipMessage };
