import { listSharedGroups, downloadCaseJson, importCasePayload, updateCaseStatus, deleteSharedCase, formatTeamId, getSharedLedger, resolveTeamId, exportSharedBackup, importSharedBackup } from './shared-ledger.js';
import { exportPDFBlob } from './export-pdf.js';
import { buildExportModel } from './export-model.js';
import { downloadBlob } from './utils/downloadBlob.js';
import { getAuthContext, getUserDisplay, userIsAdmin, initSharedAuth, waitForAuthReady, loginWithProvider, logoutUser, getEnabledProviders, onAuthStateChange } from './shared-auth.js';

const TEAM_ID = resolveTeamId();
const DISPLAY_TEAM_ID = TEAM_ID.replace(/^sscaff-team-/, '');
const { connection } = getSharedLedger(TEAM_ID);
let sharedCasesPanelInitialized = false;
let refreshBtn;
let authState;
let sharedCard;
let loginButtonsContainer;
let logoutButton;
let backupActionsBound = false;

function setPanelVisibility(isReady) {
  if (sharedCard) sharedCard.hidden = !isReady;
}

function requireAuth() {
  const status = document.getElementById('sharedAuthStatus');
  authState = getAuthContext();
  if (!authState?.isReady) {
    if (status) status.textContent = authState?.message || 'Login initialiseres…';
    return false;
  }
  if (!authState?.isAuthenticated) {
    if (status) status.textContent = authState?.message || 'Log ind for at se delte sager.';
    return false;
  }
  if (status) status.textContent = `Logget ind som ${getUserDisplay(authState.user)}`;
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
  if (!authState?.isReady) {
    if (status) status.textContent = authState?.message || 'Login initialiseres…';
  } else if (!authState?.isAuthenticated) {
    if (status) status.textContent = authState?.message || 'Log ind for at se delte sager.';
  } else if (status) {
    status.textContent = `Logget ind som ${getUserDisplay(authState.user)}`;
  }
  if (loginButtonsContainer) loginButtonsContainer.hidden = Boolean(authState?.isAuthenticated);
  if (logoutButton) logoutButton.hidden = !authState?.isAuthenticated;
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
        alert(error?.message || 'Login fejlede');
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
  onAuthStateChange((context) => {
    authState = context;
    updateAuthUi();
    if (context.isReady) setPanelVisibility(true);
    if (context.isAuthenticated && typeof onAuthenticated === 'function') {
      onAuthenticated();
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
  const result = await downloadCaseJson(TEAM_ID, caseId);
  if (!result) throw new Error('Ingen JSON vedhæftet');
  downloadBlob(result.blob, result.fileName);
}

async function handleImport(caseId) {
  const content = await importCasePayload(TEAM_ID, caseId);
  if (!content) throw new Error('Ingen JSON vedhæftet');
  const file = new File([content], 'shared-case.json', { type: 'application/json' });
  if (typeof window !== 'undefined' && typeof window.cssmateHandleAkkordImport === 'function') {
    await window.cssmateHandleAkkordImport(file);
  } else {
    throw new Error('Import-handler ikke klar');
  }
}

async function handlePdfDownload(entry) {
  const content = await importCasePayload(TEAM_ID, entry.caseId);
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
      alert(error?.message || 'Import fejlede');
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
      alert(error?.message || 'Kunne ikke hente JSON');
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
      alert(error?.message || 'Kunne ikke generere PDF');
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
        await updateCaseStatus(TEAM_ID, entry.caseId, next, authState?.user);
        await onChange();
      } catch (error) {
        console.error('Status opdatering fejlede', error);
        alert('Kunne ikke opdatere status');
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
        await deleteSharedCase(TEAM_ID, entry.caseId, authState?.user);
        await onChange();
      } catch (error) {
        console.error('Sletning fejlede', error);
        alert('Kunne ikke slette sag');
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
  if (status) status.textContent = `Team: ${DISPLAY_TEAM_ID} · ${text}`;
}

function setRefreshState(state = 'idle') {
  if (!refreshBtn) return;
  const label = state === 'loading' ? 'Opdaterer…' : state === 'error' ? 'Prøv igen' : 'Opdater';
  refreshBtn.textContent = label;
  refreshBtn.disabled = state === 'loading';
}

function updateSharedStatus() {
  if (!connection) {
    setSharedStatus('Offline – ingen sync');
    return;
  }
  setSharedStatus('Synkroniserer …');
  if (typeof connection.ready === 'function') {
    connection.ready().then(() => setSharedStatus('Synkroniseret')).catch(error => {
      console.warn('Sync forbindelse fejlede', error);
      setSharedStatus('Offline – ingen sync');
    });
  } else {
    setSharedStatus('Synkroniseret');
  }
}

function initTeamIdInput() {
  const container = document.getElementById('teamIdInputContainer');
  if (!container) return;
  const input = document.getElementById('teamIdInput');
  const saveButton = document.getElementById('saveTeamId');
  if (input && typeof input.value === 'string') input.value = DISPLAY_TEAM_ID;
  if (!saveButton) return;
  saveButton.addEventListener('click', () => {
    const value = input?.value?.trim();
    if (!value) return;
    try {
      const formatted = formatTeamId(value);
      window.localStorage?.setItem('csmate:teamId', formatted);
      window.location.reload();
    } catch (error) {
      console.warn('Kunne ikke gemme Team ID', error);
    }
  });
}

function bindBackupActions() {
  const exportBtn = document.getElementById('sharedBackupExport');
  const importInput = document.getElementById('sharedBackupImport');
  const adminNotice = document.getElementById('sharedAdminNotice');
  const admin = userIsAdmin(authState?.user);
  if (adminNotice) adminNotice.textContent = admin ? 'Admin: Backup & restore tilladelser aktiv.' : 'Login som admin for backup.';
  if (exportBtn) exportBtn.disabled = !admin;
  if (importInput) importInput.disabled = !admin;
  if (!admin || backupActionsBound) return;

  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      try {
        const backup = await exportSharedBackup(TEAM_ID);
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        downloadBlob(blob, `shared-backup-${TEAM_ID}-${Date.now()}.json`);
      } catch (error) {
        console.error('Backup export fejlede', error);
        alert('Kunne ikke eksportere backup');
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
        await importSharedBackup(TEAM_ID, payload, authState?.user);
        alert('Backup importeret');
      } catch (error) {
        console.error('Backup import fejlede', error);
        alert(error?.message || 'Kunne ikke importere backup');
      } finally {
        importInput.value = '';
        importInput.disabled = false;
      }
    });
  }
  backupActionsBound = true;
}

export function initSharedCasesPanel() {
  if (sharedCasesPanelInitialized) return;
  const container = document.getElementById('sharedCasesList');
  if (!container) return;
  sharedCasesPanelInitialized = true;
  sharedCard = document.querySelector('#panel-delte-sager .shared-cases');
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
      container.textContent = authState?.message || 'Login mangler.';
      setRefreshState('idle');
      return;
    }
    setRefreshState('loading');
    container.textContent = 'Henter sager…';
    const currentUser = authState?.user?.uid || 'offline-user';
    try {
      const groups = await listSharedGroups(TEAM_ID);
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
      setRefreshState('idle');
    } catch (error) {
      console.error('Kunne ikke hente delte sager', error);
      const message = error?.message || 'Kunne ikke hente delte sager.';
      container.textContent = `${message} Tjek netværk eller ret Team ID.`;
      setSharedStatus(`Fejl: ${message}`);
      setRefreshState('error');
    }
  };

  if (refreshBtn) refreshBtn.addEventListener('click', refresh);
  filters.forEach(input => input.addEventListener('input', () => refresh()))

  bindAuthControls(() => {
    if (!requireAuth()) {
      container.textContent = authState?.message || 'Log ind for at se delte sager.';
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
    if (!requireAuth()) {
      container.textContent = authState?.message || 'Log ind for at se delte sager.';
      return;
    }
    bindBackupActions();
    refresh();
  };

  startAuth();
}
