import { listSharedGroups, downloadCaseJson, importCasePayload, updateCaseStatus, deleteSharedCase, formatTeamId, exportSharedBackup, importSharedBackup, PermissionDeniedError, normalizeTeamId, getDisplayTeamId, MembershipMissingError, DEFAULT_TEAM_SLUG, saveTeamInvite, listTeamMembers, listTeamInvites, setMemberActive, saveTeamMember } from './shared-ledger.js';
import { exportPDFBlob } from './export-pdf.js';
import { buildExportModel } from './export-model.js';
import { downloadBlob } from './utils/downloadBlob.js';
import { getUserDisplay, logoutUser } from './shared-auth.js';
import { initAuthSession, onChange as onSessionChange, getState as getSessionState, waitForAccess, setPreferredTeamId, requestBootstrapAccess, SESSION_STATUS } from '../src/auth/session.js';

let sharedCasesPanelInitialized = false;
let refreshBtn;
let sessionState = {};
let sharedCard;
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
let debugMessagesSeen = new Set();
let inviteEmailInput;
let inviteRoleSelect;
let inviteSubmitButton;
let membersList;
let invitesList;
let adminPanel;

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
  const loggedIn = Boolean(sessionState?.user);
  if (statusLoggedIn) statusLoggedIn.textContent = loggedIn ? 'Ja' : 'Nej';
  if (statusUser) statusUser.textContent = loggedIn ? (sessionState?.user?.email || getUserDisplay(sessionState?.user)) : '–';
  if (statusUid) statusUid.textContent = sessionState?.user?.uid || '–';
  if (statusTeam) statusTeam.textContent = displayTeamId || DEFAULT_TEAM_SLUG;
  if (statusRole) statusRole.textContent = membershipRole || (loggedIn ? 'ikke medlem' : 'ikke logget ind');
}

function isAdminUser () {
  if (membershipRole === 'admin') return true;
  return sessionState?.role === 'admin';
}

function handleActionError (error, fallbackMessage, { teamContext } = {}) {
  const permissionMessage = describePermissionError(error, teamContext);
  const message = permissionMessage || error?.message || fallbackMessage;
  setInlineError(message);
}

function setTeamSelection(nextTeamId) {
  teamId = nextTeamId || '';
  displayTeamId = nextTeamId ? getDisplayTeamId(nextTeamId) : displayTeamId;
  updateTeamAccessState();
  updateStatusCard();
}

function setMembershipError(error, fallbackTeamId) {
  membershipError = error;
  const uid = sessionState?.user?.uid || 'uid';
  const message = error ? formatMissingMembershipMessage(fallbackTeamId || teamId, uid) : '';
  teamError = message;
  setInlineError(message);
  renderStatusSummary(teamError);
  updateStatusCard();
  updateTeamAccessState();
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

async function syncTeamContext(preferredTeamId) {
  try {
    return preferredTeamId || null;
  } catch {
    return null;
  }
}

function setPanelVisibility(isReady) {
  if (sharedCard) sharedCard.hidden = !isReady;
}

function requireAuth() {
  const hasAccess = sessionState?.status === SESSION_STATUS.ADMIN || sessionState?.status === SESSION_STATUS.MEMBER;
  if (sessionState?.status === SESSION_STATUS.SIGNING_IN) {
    renderStatusSummary(sessionState?.message || 'Login initialiseres…');
    setInlineError(sessionState?.message || '');
    return false;
  }
  if (!sessionState?.user || sessionState?.status === SESSION_STATUS.SIGNED_OUT) {
    renderStatusSummary(sessionState?.message || 'Log ind for at se delte sager.');
    setInlineError('Log ind først for at se delte sager.');
    return false;
  }
  if (!hasAccess) {
    const message = sessionState?.message || teamError || 'Ingen adgang til teamet.';
    renderStatusSummary(message);
    setInlineError(message);
    return false;
  }
  renderStatusSummary(`Logget ind som ${getUserDisplay(sessionState.user)}`);
  if (membershipError) {
    setMembershipError(null);
  }
  clearInlineError();
  return true;
}

function bindSessionControls(onAuthenticated, onAccessReady) {
  logoutButton = document.getElementById('sharedLogout');
  if (logoutButton) {
    logoutButton.hidden = false;
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

  initAuthSession();
  let lastStatus = '';
  onSessionChange((state) => {
    sessionState = state || {};
    teamId = state?.teamId ? formatTeamId(state.teamId) : '';
    displayTeamId = state?.displayTeamId || (teamId ? getDisplayTeamId(teamId) : DEFAULT_TEAM_SLUG);
    membershipRole = state?.role || '';
    membershipError = null;
    teamError = '';
    if (state?.status === SESSION_STATUS.SIGNED_OUT) {
      debugMessagesSeen.clear();
    }
    if (state?.status === SESSION_STATUS.NO_ACCESS || state?.status === SESSION_STATUS.ERROR) {
      teamError = state?.message || '';
      membershipError = new MembershipMissingError(teamId, state?.user?.uid || 'uid', state?.message || '');
      debugMessagesSeen.clear();
    }
    const hasAccess = state?.status === SESSION_STATUS.ADMIN || state?.status === SESSION_STATUS.MEMBER;
    setPanelVisibility(state?.status !== SESSION_STATUS.SIGNED_OUT && state?.status !== SESSION_STATUS.SIGNING_IN);
    updateSharedStatus();
    updateTeamAccessState();
    updateStatusCard();
    if (logoutButton) logoutButton.hidden = !sessionState?.user;

    if (hasAccess && lastStatus !== state.status) {
      bindBackupActions();
      if (typeof onAccessReady === 'function') onAccessReady();
    }

    if (hasAccess && isAdminUser()) {
      refreshAdminData();
    } else if (adminPanel) {
      adminPanel.hidden = true;
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
      setPreferredTeamId(value);
      setTeamSelection(formatted);
      await waitForAccess();
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
  const targetTeam = teamId || formatTeamId(displayTeamId || DEFAULT_TEAM_SLUG);
  if (!targetTeam) return;
  if (bootstrapButton) bootstrapButton.disabled = true;
  try {
    await requestBootstrapAccess();
    membershipError = null;
    teamError = '';
    appendDebug(`Bootstrap færdig for ${targetTeam}`);
    clearInlineError();
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
  const admin = membershipRole === 'admin';
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
        await importSharedBackup(ensureTeamSelected(), payload);
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

function renderInvitesList (invites = []) {
  if (!invitesList) return;
  invitesList.textContent = '';
  if (!Array.isArray(invites) || !invites.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Ingen aktive invitationer.';
    invitesList.appendChild(empty);
    return;
  }
  invites.forEach(invite => {
    const row = document.createElement('div');
    row.className = 'team-invite-row';
    row.textContent = `${invite.email || invite.id || ''} · ${invite.role || 'member'} · ${invite.active === false ? 'deaktiveret' : 'aktiv'}`;
    invitesList.appendChild(row);
  });
}

function renderMembersList (members = []) {
  if (!membersList) return;
  membersList.textContent = '';
  if (!Array.isArray(members) || !members.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Ingen medlemmer endnu.';
    membersList.appendChild(empty);
    return;
  }

  members.forEach(member => {
    const row = document.createElement('div');
    row.className = 'team-member-row';
    const memberId = member.uid || member.id;

    const emailEl = document.createElement('div');
    emailEl.className = 'team-member-email';
    emailEl.textContent = member.email || memberId || 'Ukendt bruger';

    const roleSelect = document.createElement('select');
    roleSelect.innerHTML = '<option value="member">Medlem</option><option value="admin">Admin</option>';
    roleSelect.value = member.role === 'admin' ? 'admin' : 'member';
    roleSelect.addEventListener('change', async () => {
      roleSelect.disabled = true;
      try {
        await saveTeamMember(ensureTeamSelected(), { ...member, uid: memberId, role: roleSelect.value });
        clearInlineError();
      } catch (error) {
        handleActionError(error, 'Kunne ikke opdatere rolle', { teamContext: teamId });
        roleSelect.value = member.role === 'admin' ? 'admin' : 'member';
      } finally {
        roleSelect.disabled = false;
        refreshAdminData();
      }
    });

    const toggleBtn = document.createElement('button');
    const isActive = member.active !== false;
    toggleBtn.type = 'button';
    toggleBtn.textContent = isActive ? 'Deaktivér' : 'Aktivér';
    toggleBtn.addEventListener('click', async () => {
      toggleBtn.disabled = true;
      try {
        await setMemberActive(ensureTeamSelected(), memberId, !isActive);
        clearInlineError();
      } catch (error) {
        handleActionError(error, 'Kunne ikke opdatere status', { teamContext: teamId });
      } finally {
        toggleBtn.disabled = false;
        refreshAdminData();
      }
    });

    row.append(emailEl, roleSelect, toggleBtn);
    membersList.appendChild(row);
  });
}

async function refreshAdminData () {
  if (!isAdminUser() || !teamId) {
    if (adminPanel) adminPanel.hidden = true;
    return;
  }
  if (adminPanel) adminPanel.hidden = false;
  try {
    const [members, invites] = await Promise.all([
      listTeamMembers(ensureTeamSelected()),
      listTeamInvites(ensureTeamSelected()),
    ]);
    renderMembersList(members);
    renderInvitesList(invites);
    clearInlineError();
  } catch (error) {
    handleActionError(error, 'Kunne ikke hente medlemmer/invites', { teamContext: teamId });
  }
}

async function handleInviteSubmit () {
  if (!inviteEmailInput || !inviteRoleSelect) return;
  const email = inviteEmailInput.value || '';
  const role = inviteRoleSelect.value || 'member';
  if (!email.trim()) {
    setInlineError('Angiv email for invitation.');
    return;
  }
  if (inviteSubmitButton) inviteSubmitButton.disabled = true;
  try {
    await saveTeamInvite(ensureTeamSelected(), { email, role, active: true });
    inviteEmailInput.value = '';
    clearInlineError();
    refreshAdminData();
  } catch (error) {
    handleActionError(error, 'Kunne ikke sende invitation', { teamContext: teamId });
  } finally {
    if (inviteSubmitButton) inviteSubmitButton.disabled = false;
  }
}

function updateTeamAccessState () {
  const admin = isAdminUser();
  const loggedIn = Boolean(sessionState?.user);
  const locked = Boolean(sessionState?.teamLocked && !admin);
  const allowTeamChange = admin || (!locked && !loggedIn);
  if (teamIdInput) {
    if (!teamIdInput.value) teamIdInput.value = displayTeamId || '';
    teamIdInput.disabled = !allowTeamChange;
    teamIdInput.readOnly = !allowTeamChange;
    teamIdInput.placeholder = allowTeamChange ? 'f.eks. hulmose' : 'Team låst';
  }
  if (teamIdSaveButton) {
    teamIdSaveButton.disabled = !allowTeamChange;
  }
  if (bootstrapButton) {
    const showBootstrap = Boolean(sessionState?.bootstrapAvailable);
    bootstrapButton.hidden = !showBootstrap;
    bootstrapButton.disabled = bootstrapButton.hidden;
  }
  if (membershipHint) {
    const showHint = Boolean(sessionState?.bootstrapAvailable);
    membershipHint.hidden = !showHint;
    membershipHint.textContent = showHint ? 'Du kan oprette teamet og tilføje dig selv som admin.' : '';
  }
}

export function initSharedCasesPanel() {
  if (sharedCasesPanelInitialized) return;
  const container = document.getElementById('sharedCasesList');
  if (!container) return;
  const sharedLoginButtons = document.getElementById('sharedLoginButtons');
  if (sharedLoginButtons) sharedLoginButtons.hidden = true;
  sessionState = getSessionState?.() || {};
  displayTeamId = sessionState.displayTeamId || displayTeamId;
  teamId = sessionState.teamId || teamId;
  membershipRole = sessionState.role || membershipRole;
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
  adminPanel = document.getElementById('teamAdminPanel');
  inviteEmailInput = document.getElementById('teamInviteEmail');
  inviteRoleSelect = document.getElementById('teamInviteRole');
  inviteSubmitButton = document.getElementById('teamInviteSubmit');
  membersList = document.getElementById('teamMembersList');
  invitesList = document.getElementById('teamInvitesList');
  if (uidCopyButton) {
    uidCopyButton.addEventListener('click', async () => {
      if (!sessionState?.user?.uid || !navigator?.clipboard) return;
      try {
        await navigator.clipboard.writeText(sessionState.user.uid);
        appendDebug('UID kopieret');
      } catch (error) {
        console.warn('Kunne ikke kopiere UID', error);
      }
    });
  }
  if (bootstrapButton) {
    bootstrapButton.addEventListener('click', handleBootstrapTeam);
  }
  if (inviteSubmitButton) {
    inviteSubmitButton.addEventListener('click', handleInviteSubmit);
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
    bindBackupActions();
    refresh();
  });
}

export { formatMissingMembershipMessage };
