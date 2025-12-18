import { listSharedGroups, downloadCaseJson, importCasePayload, updateCaseStatus, deleteSharedCase, formatTeamId, resolveTeamId, exportSharedBackup, importSharedBackup, getTeamMembership, PermissionDeniedError } from './shared-ledger.js';
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
let roleStatus;
let accessStatus;
let errorBanner;
let teamIdInput;
let teamIdSaveButton;

const TEAM_STORAGE_KEY = 'sscaff.teamId';
const TEAM_PREFIX = 'sscaff-team-';
const DEFAULT_TEAM_SLUG = 'hulmose';

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

function getDisplayTeamId (rawTeamId) {
  const label = (rawTeamId || '').replace(new RegExp(`^${TEAM_PREFIX}`, 'i'), '').trim();
  if (label) return label;
  return DEFAULT_TEAM_SLUG;
}

displayTeamId = getStoredTeamId() || DEFAULT_TEAM_SLUG;

function ensureTeamSelected() {
  if (!teamId) throw new PermissionDeniedError(teamError || 'Vælg et team for at fortsætte.');
  return teamId;
}

function describePermissionError (error, attemptedTeamId) {
  const message = (error?.message || '').toString();
  const normalized = message.toLowerCase();
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

function isAdminUser () {
  if (membershipRole === 'admin') return true;
  return userIsAdmin(authState?.user);
}

function handleActionError (error, fallbackMessage, { teamContext } = {}) {
  const permissionMessage = describePermissionError(error, teamContext);
  const message = permissionMessage || error?.message || fallbackMessage;
  setInlineError(message);
}

async function syncTeamContext(preferredTeamId) {
  try {
    const desiredTeam = preferredTeamId || displayTeamId || getStoredTeamId() || DEFAULT_TEAM_SLUG;
    const resolved = await resolveTeamId(desiredTeam);
    const membership = await getTeamMembership(resolved);
    teamId = resolved;
    displayTeamId = getDisplayTeamId(resolved);
    persistTeamId(displayTeamId);
    membershipRole = membership?.role || '';
    teamError = '';
    updateSharedStatus();
    return resolved;
  } catch (error) {
    teamId = '';
    membershipRole = '';
    teamError = describePermissionError(error, preferredTeamId) || error?.message || 'Ingen adgang til team.';
    updateSharedStatus();
    setInlineError(teamError);
    throw error;
  }
}

function setPanelVisibility(isReady) {
  if (sharedCard) sharedCard.hidden = !isReady;
}

function requireAuth() {
  const status = document.getElementById('sharedAuthStatus');
  authState = getAuthContext();
  if (!authState?.isReady) {
    if (status) status.textContent = authState?.message || 'Login initialiseres…';
    setInlineError(authState?.message || '');
    return false;
  }
  if (!authState?.isAuthenticated) {
    if (status) status.textContent = authState?.message || 'Log ind for at se delte sager.';
    setInlineError('Log ind først for at se delte sager.');
    return false;
  }
  if (teamError) {
    if (status) status.textContent = teamError;
    setInlineError(teamError);
    return false;
  }
  if (!teamId) {
    if (status) status.textContent = 'Vælg et team for at fortsætte.';
    setInlineError('Vælg et team for at fortsætte.');
    return false;
  }
  if (status) status.textContent = `Logget ind som ${getUserDisplay(authState.user)}`;
  clearInlineError();
  return true;
}

function updateAuthUi() {
  const status = document.getElementById('sharedAuthStatus');
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
    if (status) status.textContent = authState?.message || 'Login initialiseres…';
    if (roleStatus) roleStatus.textContent = 'Rolle: Ukendt';
  } else if (!authState?.isAuthenticated) {
    if (status) status.textContent = authState?.message || 'Log ind for at se delte sager.';
    if (roleStatus) roleStatus.textContent = 'Rolle: Ikke logget ind';
  } else if (status) {
    const providerLabel = providerName ? ` · Provider: ${providerName}` : '';
    const uidLabel = uidShort ? ` · UID: ${uidShort}` : '';
    status.textContent = `Logget ind som: ${getUserDisplay(authState.user)}${providerLabel}${uidLabel}`;
    if (roleStatus) roleStatus.textContent = admin ? 'Rolle: Admin (whitelist)' : 'Rolle: Montør (read-only)';
  }
  if (loginButtonsContainer) loginButtonsContainer.hidden = Boolean(authState?.isAuthenticated);
  if (logoutButton) logoutButton.hidden = !authState?.isAuthenticated;
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
  const status = document.getElementById('sharedStatus');
  const label = displayTeamId || 'ukendt';
  if (status) status.textContent = `Team: ${label} · ${text}`;
}

function setRefreshState(state = 'idle') {
  if (!refreshBtn) return;
  const label = state === 'loading' ? 'Opdaterer…' : state === 'error' ? 'Prøv igen' : 'Opdater';
  refreshBtn.textContent = label;
  refreshBtn.disabled = state === 'loading';
}

function updateSharedStatus() {
  if (teamError) {
    setSharedStatus(`Adgang: ${teamError}`);
  } else if (!teamId) {
    setSharedStatus('Adgang: Vælg team for at hente sager');
  } else {
    setSharedStatus('Adgang: OK');
  }
  const admin = isAdminUser();
  if (accessStatus) {
    const locked = !authState?.isAuthenticated ? 'Log ind for at vælge team.' : admin ? 'Team kan redigeres.' : 'Team låst (kun admin kan ændre).';
    const accessLabel = teamError ? 'Adgang: Mangler rettigheder' : 'Adgang: OK';
    accessStatus.textContent = `${accessLabel} · ${locked}`;
  }
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
    const value = teamIdInput?.value?.trim();
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

function bindBackupActions() {
  const exportBtn = document.getElementById('sharedBackupExport');
  const importInput = document.getElementById('sharedBackupImport');
  const adminNotice = document.getElementById('sharedAdminNotice');
  const admin = membershipRole === 'admin' || userIsAdmin(authState?.user);
  if (adminNotice) adminNotice.textContent = admin ? 'Rolle: Admin (whitelist) · Backup & import er aktiv.' : 'Rolle: Montør (read-only) · Backup kræver admin.';
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
}

export function initSharedCasesPanel() {
  if (sharedCasesPanelInitialized) return;
  const container = document.getElementById('sharedCasesList');
  if (!container) return;
  sharedCasesPanelInitialized = true;
  sharedCard = document.querySelector('#panel-delte-sager .shared-cases');
  roleStatus = document.getElementById('sharedRoleStatus');
  accessStatus = document.getElementById('sharedAccessStatus');
  errorBanner = document.getElementById('sharedInlineError');
  setPanelVisibility(false);
  refreshBtn = document.getElementById('refreshSharedCases');
  const filters = ['sharedFilterJob', 'sharedFilterStatus', 'sharedFilterKind']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  updateSharedStatus();
  initTeamIdInput();

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
