import { listSharedGroups, downloadCaseJson, importCasePayload, updateCaseStatus, deleteSharedCase, formatTeamId, resolveTeamId, exportSharedBackup, importSharedBackup, getTeamMembership, PermissionDeniedError, normalizeTeamId, getDisplayTeamId, MembershipMissingError, DEFAULT_TEAM_SLUG } from './shared-ledger.js';
import { exportPDFBlob } from './export-pdf.js';
import { buildExportModel } from './export-model.js';
import { downloadBlob } from './utils/downloadBlob.js';
import { getAuthContext, getUserDisplay, userIsAdmin, initSharedAuth, waitForAuthReady, loginWithProvider, logoutUser, getEnabledProviders, onAuthStateChange, getUserProviderName } from './shared-auth.js';

let sharedCasesPanelInitialized = false;
let refreshBtn;
let authState;
let sharedCard;
let loginButtonsContainer;
let logoutButton;
let backupActionsBound = false;
let teamId = '';
let displayTeamId = '';
let membershipRole = '';
let teamError = '';
let membershipError = null;
let roleStatus;
let accessStatus;
let statusBox;
let authStatusBox;
let adminNoticeBox;
let errorBanner;
let teamIdInput;
let teamIdSaveButton;
let statusLoggedIn;
let statusUser;
let statusUid;
let statusTeam;
let statusRole;
let uidCopyButton;
let bootstrapButton;
let membershipHint;
let debugPanel;
let debugLogOutput;
let hasDebugEntries = false;

const TEAM_STORAGE_KEY = 'sscaff.teamId';

function getStoredTeamId () {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage?.getItem(TEAM_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function persistTeamId (value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(TEAM_STORAGE_KEY, value || '');
  } catch (error) {
    console.warn('Kunne ikke gemme team ID', error);
  }
}

displayTeamId = normalizeTeamId(getStoredTeamId() || DEFAULT_TEAM_SLUG);

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
    const uid = authState?.user?.uid || 'uid';
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

function hideLegacyStatus () {
  [authStatusBox, roleStatus, accessStatus, adminNoticeBox].forEach(element => {
    if (element) {
      element.textContent = '';
      element.hidden = true;
    }
  });
}

function renderStatusSummary (primaryMessage = '') {
  if (!statusBox) statusBox = document.getElementById('sharedStatus');
  const teamLabel = displayTeamId || DEFAULT_TEAM_SLUG;
  const accessLabel = teamError ? `Adgang: ${teamError}` : (teamId ? 'Adgang: OK' : 'Adgang: vælg team');
  const summaryParts = [primaryMessage, `Team: ${teamLabel}`, accessLabel].filter(Boolean);
  if (statusBox) {
    statusBox.textContent = summaryParts.join(' — ');
    statusBox.hidden = false;
  }
  hideLegacyStatus();
}

function updateStatusCard() {
  if (statusLoggedIn) statusLoggedIn.textContent = authState?.isAuthenticated ? 'Ja' : 'Nej';
  if (statusUser) statusUser.textContent = authState?.isAuthenticated ? (authState?.user?.email || getUserDisplay(authState?.user)) : '–';
  if (statusUid) statusUid.textContent = authState?.user?.uid || '–';
  if (statusTeam) statusTeam.textContent = displayTeamId || DEFAULT_TEAM_SLUG;
  if (statusRole) statusRole.textContent = membershipRole || (authState?.isAuthenticated ? 'ikke medlem' : 'ikke logget ind');
}

function isAdminUser () {
  if (membershipRole === 'admin') return true;
  return userIsAdmin(authState?.user);
}

function handleActionError (error, fallbackMessage, { teamContext } = {}) {
  const permissionMessage = describePermissionError(error, teamContext);
  const message = permissionMessage || error?.message || fallbackMessage;
  setInlineError(message);
}

function setTeamSelection(nextTeamId) {
  teamId = nextTeamId || '';
  displayTeamId = nextTeamId ? getDisplayTeamId(nextTeamId) : displayTeamId;
  persistTeamId(displayTeamId);
  updateTeamAccessState();
  updateStatusCard();
}

function setMembershipError(error, fallbackTeamId) {
  membershipError = error;
  const uid = authState?.user?.uid || 'uid';
  const message = error ? formatMissingMembershipMessage(fallbackTeamId || teamId, uid) : '';
  teamError = message;
  setInlineError(message);
  renderStatusSummary(teamError);
  updateStatusCard();
  updateTeamAccessState();
}

function appendDebug(message) {
  if (!message) return;
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

async function syncTeamContext(preferredTeamId) {
  try {
    const desiredTeam = normalizeTeamId(preferredTeamId || displayTeamId || getStoredTeamId() || DEFAULT_TEAM_SLUG);
    const resolved = await resolveTeamId(desiredTeam);
    setTeamSelection(resolved);
    const membership = await getTeamMembership(resolved, { allowBootstrap: false });
    membershipRole = membership?.role || '';
    membershipError = null;
    teamError = '';
    updateSharedStatus();
    appendDebug(`Team sync OK for ${resolved}`);
    return resolved;
  } catch (error) {
    membershipRole = '';
    const resolved = preferredTeamId ? formatTeamId(preferredTeamId) : teamId;
    if (error instanceof MembershipMissingError) {
      setMembershipError(error, resolved);
    } else {
      teamError = describePermissionError(error, preferredTeamId) || error?.message || 'Ingen adgang til team.';
      membershipError = null;
      setInlineError(teamError);
    }
    appendDebug(`Team sync fejl: ${error?.message || error}`);
    updateSharedStatus();
    throw error;
  }
}

function setPanelVisibility(isReady) {
  if (sharedCard) sharedCard.hidden = !isReady;
}

function requireAuth() {
  authState = getAuthContext();
  if (!authState?.isReady) {
    renderStatusSummary(authState?.message || 'Login initialiseres…');
    setInlineError(authState?.message || '');
    return false;
  }
  if (!authState?.isAuthenticated) {
    renderStatusSummary(authState?.message || 'Log ind for at se delte sager.');
    setInlineError('Log ind først for at se delte sager.');
    return false;
  }
  if (teamError) {
    renderStatusSummary(teamError);
    setInlineError(teamError);
    return false;
  }
  if (!teamId) {
    renderStatusSummary('Vælg et team for at fortsætte.');
    setInlineError('Vælg et team for at fortsætte.');
    return false;
  }
  renderStatusSummary(`Logget ind som ${getUserDisplay(authState.user)}`);
  if (membershipError) {
    setMembershipError(null);
  }
  clearInlineError();
  return true;
}

function updateAuthUi() {
  const enabledProviders = getEnabledProviders();
  ['google', 'microsoft', 'apple', 'facebook'].forEach((providerId) => {
    const button = document.getElementById(`sharedLogin-${providerId}`);
    if (button) button.hidden = !enabledProviders.includes(providerId);
  });
  authState = getAuthContext();
  const providerName = getUserProviderName(authState?.user);
  const uidShort = authState?.user?.uid ? authState.user.uid.slice(0, 6) : '';
  const admin = isAdminUser();
  if (!authState?.isReady) {
    renderStatusSummary(authState?.message || 'Login initialiseres…');
    membershipRole = '';
    membershipError = null;
  } else if (!authState?.isAuthenticated) {
    renderStatusSummary(authState?.message || 'Log ind for at se delte sager.');
    membershipRole = '';
    membershipError = null;
  } else {
    const providerLabel = providerName ? `Provider: ${providerName}` : '';
    const uidLabel = uidShort ? `UID: ${uidShort}` : '';
    const message = [`Logget ind som: ${getUserDisplay(authState.user)}`, providerLabel, uidLabel].filter(Boolean).join(' · ');
    renderStatusSummary(message || 'Logget ind');
    membershipRole = admin ? 'admin' : membershipRole;
  }
  if (loginButtonsContainer) loginButtonsContainer.hidden = Boolean(authState?.isAuthenticated);
  if (logoutButton) logoutButton.hidden = !authState?.isAuthenticated;
  updateStatusCard();
  updateTeamAccessState();
}

function bindAuthControls(onAuthenticated) {
  loginButtonsContainer = document.getElementById('sharedLoginButtons');
  logoutButton = document.getElementById('sharedLogout');
  const buttons = {
    google: document.getElementById('sharedLogin-google'),
    microsoft: document.getElementById('sharedLogin-microsoft'),
    apple: document.getElementById('sharedLogin-apple'),
    facebook: document.getElementById('sharedLogin-facebook'),
  };
  const attachHandler = (providerId, button) => {
    if (!button) return;
    button.addEventListener('click', async () => {
      button.disabled = true;
      const status = document.getElementById('sharedAuthStatus');
      if (status) status.textContent = 'Logger ind…';
      try {
        await loginWithProvider(providerId);
      } catch (error) {
        console.error('Login fejlede', error);
        setInlineError(error?.message || 'Login fejlede');
      } finally {
        button.disabled = false;
      }
    });
  };
  Object.entries(buttons).forEach(([providerId, button]) => attachHandler(providerId, button));
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      logoutButton.disabled = true;
      try {
        await logoutUser();
      } catch (error) {
        console.warn('Logout fejlede', error);
      } finally {
        logoutButton.disabled = false;
      }
    });
  }
  onAuthStateChange(async (context) => {
    authState = context;
    updateAuthUi();
    if (context.isReady) setPanelVisibility(true);
    if (context.isAuthenticated) {
      try {
        await syncTeamContext();
      } catch (error) {
        console.warn('Kunne ikke synkronisere team', error);
      }
      bindBackupActions();
      if (typeof onAuthenticated === 'function') {
        onAuthenticated();
      }
    } else {
      teamId = '';
      displayTeamId = getStoredTeamId() || DEFAULT_TEAM_SLUG;
      membershipRole = '';
      teamError = '';
      membershipError = null;
      backupActionsBound = false;
      updateSharedStatus();
      updateTeamAccessState();
    }
  });
  updateAuthUi();
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

  if (entry.createdBy === userId || userIsAdmin(authState?.user)) {
    const statusBtn = document.createElement('button');
    statusBtn.type = 'button';
    statusBtn.textContent = entry.status === 'godkendt' ? 'Markér kladde' : 'Godkend';
    statusBtn.addEventListener('click', async () => {
      statusBtn.disabled = true;
      try {
        const next = entry.status === 'godkendt' ? 'kladde' : 'godkendt';
        await updateCaseStatus(ensureTeamSelected(), entry.caseId, next, authState?.user);
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
        await deleteSharedCase(ensureTeamSelected(), entry.caseId, authState?.user);
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
  const summaryMessage = message || (teamError
    ? `Adgang: ${teamError}`
    : (!teamId ? 'Adgang: Vælg team for at hente sager' : 'Adgang: OK'));
  setSharedStatus(summaryMessage);
  updateStatusCard();
  updateTeamAccessState();
}

function initTeamIdInput() {
  const container = document.getElementById('teamIdInputContainer');
  if (!container) return;
  teamIdInput = document.getElementById('teamIdInput');
  teamIdSaveButton = document.getElementById('saveTeamId');
  if (teamIdInput && typeof teamIdInput.value === 'string') teamIdInput.value = displayTeamId;
  if (!teamIdSaveButton) return;
  teamIdSaveButton.addEventListener('click', async () => {
    const value = normalizeTeamId(teamIdInput?.value || '');
    if (!value) {
      setInlineError('Angiv et Team ID først.');
      return;
    }
    teamIdSaveButton.disabled = true;
    try {
      const formatted = formatTeamId(value);
      await syncTeamContext(formatted);
      updateSharedStatus();
      clearInlineError();
    } catch (error) {
      console.warn('Kunne ikke sætte Team ID', error);
      setInlineError(error?.message || 'Ingen adgang til valgt team');
    } finally {
      teamIdSaveButton.disabled = false;
    }
  });
}

async function handleBootstrapTeam() {
  if (!isAdminUser()) return;
  const targetTeam = teamId || formatTeamId(displayTeamId || DEFAULT_TEAM_SLUG);
  if (!targetTeam) return;
  if (bootstrapButton) bootstrapButton.disabled = true;
  try {
    await getTeamMembership(targetTeam, { allowBootstrap: true });
    membershipError = null;
    teamError = '';
    membershipRole = 'admin';
    updateSharedStatus();
    clearInlineError();
    appendDebug(`Bootstrap færdig for ${targetTeam}`);
    await syncTeamContext(targetTeam);
  } catch (error) {
    console.error('Bootstrap fejlede', error);
    handleActionError(error, 'Kunne ikke oprette team', { teamContext: targetTeam });
    appendDebug(`Bootstrap fejl: ${error?.message || error}`);
  } finally {
    if (bootstrapButton) bootstrapButton.disabled = false;
  }
}

function bindBackupActions() {
  const exportBtn = document.getElementById('sharedBackupExport');
  const importInput = document.getElementById('sharedBackupImport');
  const admin = membershipRole === 'admin' || userIsAdmin(authState?.user);
  if (adminNoticeBox) {
    adminNoticeBox.textContent = '';
    adminNoticeBox.hidden = true;
  }
  if (exportBtn) exportBtn.disabled = !admin;
  if (importInput) importInput.disabled = !admin;
  if (!admin || backupActionsBound) return;

  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      try {
        const backup = await exportSharedBackup(ensureTeamSelected());
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        downloadBlob(blob, `shared-backup-${teamId}-${Date.now()}.json`);
      } catch (error) {
        console.error('Backup export fejlede', error);
        setInlineError(describePermissionError(error, teamId) || 'Kunne ikke eksportere backup');
      } finally {
        exportBtn.disabled = false;
      }
    });
  }

  if (importInput) {
    importInput.addEventListener('change', async (event) => {
      const file = event?.target?.files?.[0];
      if (!file) return;
      importInput.disabled = true;
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        await importSharedBackup(ensureTeamSelected(), payload, authState?.user);
        clearInlineError();
      } catch (error) {
        console.error('Backup import fejlede', error);
        setInlineError(describePermissionError(error, teamId) || error?.message || 'Kunne ikke importere backup');
      } finally {
        importInput.value = '';
        importInput.disabled = false;
      }
    });
  }
  backupActionsBound = true;
}

function updateTeamAccessState () {
  const admin = isAdminUser();
  const loggedIn = Boolean(authState?.isAuthenticated);
  if (teamIdInput) {
    if (!teamIdInput.value) teamIdInput.value = displayTeamId || '';
    teamIdInput.disabled = !admin || !loggedIn;
    teamIdInput.readOnly = !admin || !loggedIn;
    teamIdInput.placeholder = loggedIn ? 'f.eks. hulmose' : 'Log ind for at vælge team';
  }
  if (teamIdSaveButton) {
    teamIdSaveButton.disabled = !admin || !loggedIn;
  }
  if (bootstrapButton) {
    bootstrapButton.hidden = !(membershipError && admin && loggedIn);
    bootstrapButton.disabled = bootstrapButton.hidden;
  }
  if (membershipHint) {
    const showHint = membershipError && admin && loggedIn;
    membershipHint.hidden = !showHint;
    membershipHint.textContent = showHint ? 'Du kan oprette teamet og tilføje dig selv som admin.' : '';
  }
}

export function initSharedCasesPanel() {
  if (sharedCasesPanelInitialized) return;
  const container = document.getElementById('sharedCasesList');
  if (!container) return;
  sharedCasesPanelInitialized = true;
  sharedCard = document.querySelector('#panel-delte-sager .shared-cases');
  roleStatus = document.getElementById('sharedRoleStatus');
  accessStatus = document.getElementById('sharedAccessStatus');
  statusBox = document.getElementById('sharedStatus');
  authStatusBox = document.getElementById('sharedAuthStatus');
  adminNoticeBox = document.getElementById('sharedAdminNotice');
  errorBanner = document.getElementById('sharedInlineError');
  statusLoggedIn = document.getElementById('sharedStatusLoggedIn');
  statusUser = document.getElementById('sharedStatusUser');
  statusUid = document.getElementById('sharedStatusUid');
  uidCopyButton = document.getElementById('sharedUidCopy');
  statusTeam = document.getElementById('sharedStatusTeam');
  statusRole = document.getElementById('sharedStatusRole');
  bootstrapButton = document.getElementById('sharedBootstrapTeam');
  membershipHint = document.getElementById('sharedMembershipHint');
  debugPanel = document.getElementById('sharedDebugPanel');
  debugLogOutput = document.getElementById('sharedDebugLog');
  if (uidCopyButton) {
    uidCopyButton.addEventListener('click', async () => {
      if (!authState?.user?.uid || !navigator?.clipboard) return;
      try {
        await navigator.clipboard.writeText(authState.user.uid);
        appendDebug('UID kopieret');
      } catch (error) {
        console.warn('Kunne ikke kopiere UID', error);
      }
    });
  }
  if (bootstrapButton) {
    bootstrapButton.addEventListener('click', handleBootstrapTeam);
  }
  hideLegacyStatus();
  setPanelVisibility(false);
  refreshBtn = document.getElementById('refreshSharedCases');
  const filters = ['sharedFilterJob', 'sharedFilterStatus', 'sharedFilterKind']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  updateSharedStatus();
  initTeamIdInput();
  updateStatusCard();

  const refresh = async () => {
    if (!container) return;
    if (!requireAuth()) {
      container.textContent = teamError || authState?.message || 'Login mangler.';
      setRefreshState('idle');
      return;
    }
    setRefreshState('loading');
    container.textContent = 'Henter sager…';
    const currentUser = authState?.user?.uid || 'offline-user';
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

  bindAuthControls(() => {
    if (!requireAuth()) {
      container.textContent = teamError || authState?.message || 'Log ind for at se delte sager.';
      setRefreshState('idle');
      return;
    }
    bindBackupActions();
    refresh();
  });

  const startAuth = async () => {
    await initSharedAuth();
    const context = await waitForAuthReady();
    authState = context;
    updateAuthUi();
    setPanelVisibility(true);
    try {
      await syncTeamContext();
    } catch (error) {
      console.warn('Team kunne ikke hentes ved login', error);
    }
    if (!requireAuth()) {
      container.textContent = teamError || authState?.message || 'Log ind for at se delte sager.';
      return;
    }
    bindBackupActions();
    refresh();
  };

  startAuth();
}

export { formatMissingMembershipMessage };
