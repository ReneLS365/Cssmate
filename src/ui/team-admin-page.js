import {
  addTeamMemberByUid,
  getTeamDocument,
  listTeamInvites,
  listTeamMembers,
  resendTeamInvite,
  revokeTeamInvite,
  removeTeamMember,
  saveTeamMember,
  saveTeamInvite,
} from '../../js/shared-ledger.js'
import { getAuthDiagnostics } from '../../js/shared-auth.js'
import { assertAdmin } from '../auth/admin.js'
import { isAdminUser, normalizeEmail } from '../auth/roles.js'
import { getState as getSessionState, onChange as onSessionChange, refreshAccess, requestBootstrapAccess } from '../auth/session.js'
import { getDebugState } from '../state/debug.js'
import { resetAppState } from '../utils/reset-app.js'
import { createTeamWithMembership, TEAM_ACCESS_STATUS } from '../services/team-access.js'
import { BOOTSTRAP_ADMIN_EMAIL, DEFAULT_TEAM_SLUG, formatTeamId } from '../services/team-ids.js'

let initialized = false
let teamPanel
let teamTabButton
let teamAdminCard
let teamMemberOverviewCard
let teamNameEl
let teamIdEl
let teamCopyIdBtn
let teamCopyNameBtn
let statusEl
let invitesListEl
let membersListEl
let membersReadOnlyListEl
let teamIdInputContainer
let sharedAdminActions
let diagnosticsCard
let diagnosticsList
let diagnosticsWarning
let inviteEmailInput
let inviteRoleSelect
let inviteSubmitButton
let inviteLinkContainer
let inviteLinkInput
let inviteLinkCopyButton
let claimOwnerContainer
let claimOwnerButton
let uidInput
let uidRoleSelect
let uidSubmitButton
let refreshButton
let accessActionsEl
let accessRetryButton
let accessBootstrapButton
let accessResetButton
let lastTeamId = ''
let loading = false
let adminLocked = false
let lastSessionState = null
let diagnosticsToken = 0

function isOwner (role) {
  return role === 'owner'
}

function isAdminRole (role) {
  return role === 'admin' || isOwner(role)
}

function getSessionRole (session) {
  const role = session?.member?.role || session?.role || ''
  if (role === 'owner' || role === 'admin') return role
  if (isAdminUser(session?.user)) return 'admin'
  return role
}

function setStatus (message, variant = '') {
  if (!statusEl) return
  statusEl.textContent = message || ''
  statusEl.dataset.variant = variant || ''
}

function setAriaHidden (element, hidden) {
  if (!element) return
  if (hidden) {
    element.setAttribute('aria-hidden', 'true')
    return
  }
  element.removeAttribute('aria-hidden')
}

function setLoading (isLoading) {
  loading = isLoading
  const disabled = Boolean(isLoading || adminLocked)
  ;[
    inviteSubmitButton,
    uidSubmitButton,
    refreshButton,
    inviteEmailInput,
    inviteRoleSelect,
    uidInput,
    uidRoleSelect,
    claimOwnerButton,
  ].forEach(btn => {
    if (btn) btn.disabled = disabled
  })
}

function ensureAccessActions () {
  if (accessActionsEl || !statusEl) return
  accessActionsEl = document.createElement('div')
  accessActionsEl.className = 'team-access-actions'
  accessRetryButton = document.createElement('button')
  accessRetryButton.type = 'button'
  accessRetryButton.textContent = 'Prøv igen'
  accessBootstrapButton = document.createElement('button')
  accessBootstrapButton.type = 'button'
  accessBootstrapButton.textContent = 'Opret adgang i team'
  accessBootstrapButton.dataset.role = 'primary'
  accessResetButton = document.createElement('button')
  accessResetButton.type = 'button'
  accessResetButton.textContent = 'Nulstil app'
  if (typeof accessActionsEl.append === 'function') {
    accessActionsEl.append(accessRetryButton, accessBootstrapButton, accessResetButton)
  } else {
    accessActionsEl.appendChild(accessRetryButton)
    accessActionsEl.appendChild(accessBootstrapButton)
    accessActionsEl.appendChild(accessResetButton)
  }
  accessActionsEl.hidden = true
  if (typeof statusEl.insertAdjacentElement === 'function') {
    statusEl.insertAdjacentElement('afterend', accessActionsEl)
  } else if (statusEl.parentElement && typeof statusEl.parentElement.appendChild === 'function') {
    statusEl.parentElement.appendChild(accessActionsEl)
  } else {
    accessActionsEl = null
  }
}

function updateAccessActions ({ accessStatus, canBootstrapAction, isChecking }) {
  ensureAccessActions()
  if (!accessActionsEl) return
  const show = accessStatus !== 'ok'
  accessActionsEl.hidden = !show
  if (!show) return
  const disabled = Boolean(isChecking || loading)
  if (accessRetryButton) accessRetryButton.disabled = disabled
  if (accessBootstrapButton) {
    accessBootstrapButton.hidden = !canBootstrapAction
    accessBootstrapButton.disabled = disabled || !canBootstrapAction
  }
  if (accessResetButton) {
    accessResetButton.hidden = false
    accessResetButton.disabled = disabled
  }
}

async function handleAccessRetry () {
  setStatus('Tjekker adgang…')
  if (accessRetryButton) accessRetryButton.disabled = true
  try {
    await refreshAccess()
  } catch (error) {
    console.warn('Access refresh failed', error)
    setStatus(error?.message || 'Kunne ikke tjekke adgang.', 'error')
  } finally {
    if (accessRetryButton) accessRetryButton.disabled = false
  }
}

async function handleAccessBootstrap () {
  setStatus('Opretter team-adgang…')
  if (accessBootstrapButton) accessBootstrapButton.disabled = true
  try {
    await requestBootstrapAccess()
    await refreshAccess()
  } catch (error) {
    console.warn('Bootstrap fra team-tab fejlede', error)
    setStatus(error?.message || 'Kunne ikke oprette team-adgang.', 'error')
  } finally {
    if (accessBootstrapButton) accessBootstrapButton.disabled = false
  }
}

async function handleClaimOwner () {
  const session = lastSessionState || getSessionState()
  const user = session?.user
  if (!user) return
  setStatus('Claim owner på hulmose…')
  if (claimOwnerButton) claimOwnerButton.disabled = true
  try {
    await createTeamWithMembership({ teamId: DEFAULT_TEAM_SLUG, user })
    await refreshAccess()
    setStatus('Owner-rolle oprettet.', 'success')
  } catch (error) {
    console.warn('Claim owner failed', error)
    setStatus(error?.message || 'Kunne ikke claim owner.', 'error')
  } finally {
    if (claimOwnerButton) claimOwnerButton.disabled = false
  }
}

function handleAccessReset () {
  setStatus('Nulstiller app…')
  resetAppState({ reload: true })
}

function copyToClipboard (value) {
  if (!navigator?.clipboard || !value) return
  navigator.clipboard.writeText(value).catch(() => {})
}

function renderTeamInfo (team) {
  if (!team) return
  if (teamNameEl) teamNameEl.textContent = team.name || 'Team'
  if (teamIdEl) teamIdEl.textContent = team.slug || team.id || ''
}

function formatInviteCreatedAt (value) {
  if (!value) return '–'
  try {
    return new Date(value).toLocaleString('da-DK')
  } catch {
    return value
  }
}

function renderInvites (invites = []) {
  if (!invitesListEl) return
  invitesListEl.textContent = ''
  if (!Array.isArray(invites) || !invites.length) {
    const p = document.createElement('p')
    p.textContent = 'Ingen aktive invitationer.'
    invitesListEl.appendChild(p)
    return
  }
  invites.forEach(inviteItem => {
    const invite = inviteItem || {}
    const row = document.createElement('div')
    row.className = 'team-invite-row'
    const label = document.createElement('div')
    const status = invite.status || 'pending'
    const email = invite.email || invite.emailLower || '–'
    const role = invite.role || 'member'
    const createdAtLabel = formatInviteCreatedAt(invite.createdAt || invite.addedAt)
    const expiresAtLabel = invite.expiresAt ? formatInviteCreatedAt(invite.expiresAt) : '–'
    const tokenHint = invite.tokenHint ? ` · Hint: ${invite.tokenHint}` : ''
    label.textContent = `${email} · ${role} · ${status} · Oprettet: ${createdAtLabel} · Udløber: ${expiresAtLabel}${tokenHint}`
    const actions = document.createElement('div')
    actions.className = 'team-invite-actions'
    const revokeBtn = document.createElement('button')
    revokeBtn.type = 'button'
    revokeBtn.textContent = 'Tilbagekald'
    revokeBtn.addEventListener('click', async () => {
      revokeBtn.disabled = true
      try {
        await revokeTeamInvite(invite.inviteId || invite.id || '')
        const invites = await listTeamInvites(lastTeamId)
        renderInvites(invites)
      } catch (error) {
        setStatus(error?.message || 'Kunne ikke tilbagekalde invite.', 'error')
      } finally {
        revokeBtn.disabled = false
      }
    })
    const resendBtn = document.createElement('button')
    resendBtn.type = 'button'
    resendBtn.textContent = 'Send igen'
    resendBtn.addEventListener('click', async () => {
      resendBtn.disabled = true
      try {
        const result = await resendTeamInvite(invite.inviteId || invite.id || '')
        if (inviteLinkContainer && inviteLinkInput && result?.inviteUrl) {
          inviteLinkInput.value = result.inviteUrl
          inviteLinkContainer.hidden = false
          inviteLinkContainer.removeAttribute('aria-hidden')
        }
        const invites = await listTeamInvites(lastTeamId)
        renderInvites(invites)
      } catch (error) {
        setStatus(error?.message || 'Kunne ikke sende invite igen.', 'error')
      } finally {
        resendBtn.disabled = false
      }
    })
    actions.appendChild(revokeBtn)
    actions.appendChild(resendBtn)
    row.appendChild(label)
    row.appendChild(actions)
    invitesListEl.appendChild(row)
  })
}

function renderMembersList (members = []) {
  if (!membersListEl) return
  membersListEl.textContent = ''
  if (!Array.isArray(members) || !members.length) {
    const p = document.createElement('p')
    p.textContent = 'Ingen medlemmer endnu.'
    membersListEl.appendChild(p)
    return
  }
  members
    .sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''))
    .forEach(member => {
      const row = document.createElement('div')
      row.className = 'team-member-row'
      const info = document.createElement('div')
      info.className = 'team-member-email'
      info.textContent = [
        member.displayName || member.email || member.uid || 'Ukendt',
        member.email && member.displayName ? `(${member.email})` : '',
      ].join(' ')
      const actions = document.createElement('div')
      actions.className = 'team-member-actions'
      const roleSelect = document.createElement('select')
      roleSelect.innerHTML = `
        <option value="member">Medlem</option>
        <option value="admin">Admin</option>
      `
      roleSelect.value = member.role || 'member'
      roleSelect.addEventListener('change', async () => {
        roleSelect.disabled = true
        try {
          await saveTeamMember(lastTeamId, { uid: member.uid || member.id, role: roleSelect.value, active: true })
        } catch (error) {
          setStatus(error?.message || 'Kunne ikke ændre rolle.', 'error')
        } finally {
          roleSelect.disabled = false
        }
      })
      const removeBtn = document.createElement('button')
      removeBtn.type = 'button'
      removeBtn.textContent = 'Fjern'
      removeBtn.addEventListener('click', async () => {
        removeBtn.disabled = true
        try {
          await removeTeamMember(lastTeamId, member.uid || member.id)
          const members = await listTeamMembers(lastTeamId)
          renderMembersList(members)
        } catch (error) {
          setStatus(error?.message || 'Kunne ikke fjerne medlem.', 'error')
        } finally {
          removeBtn.disabled = false
        }
      })
      actions.appendChild(roleSelect)
      actions.appendChild(removeBtn)
      row.appendChild(info)
      row.appendChild(actions)
      membersListEl.appendChild(row)
    })
}

function renderMembersReadOnly (members = []) {
  if (!membersReadOnlyListEl) return
  membersReadOnlyListEl.textContent = ''
  if (!Array.isArray(members) || !members.length) {
    const p = document.createElement('p')
    p.textContent = 'Ingen medlemmer endnu.'
    membersReadOnlyListEl.appendChild(p)
    return
  }
  members
    .sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''))
    .forEach(member => {
      const row = document.createElement('div')
      row.className = 'team-member-row'
      const info = document.createElement('div')
      info.className = 'team-member-email'
      info.textContent = [
        member.displayName || member.email || member.uid || 'Ukendt',
        member.email && member.displayName ? `(${member.email})` : '',
      ].join(' ')
      row.appendChild(info)
      membersReadOnlyListEl.appendChild(row)
    })
}

async function handleInviteSubmit () {
  if (!inviteEmailInput || !inviteRoleSelect) return
  const email = inviteEmailInput.value || ''
  if (email && !normalizeEmail(email)) {
    setStatus('Ugyldig email.', 'error')
    return
  }
  setLoading(true)
  try {
    const role = inviteRoleSelect.value === 'admin' ? 'admin' : 'member'
    const result = await saveTeamInvite(lastTeamId, { email, role })
    inviteEmailInput.value = ''
    if (inviteLinkContainer && inviteLinkInput && result?.inviteUrl) {
      inviteLinkInput.value = result.inviteUrl
      inviteLinkContainer.hidden = false
      inviteLinkContainer.removeAttribute('aria-hidden')
    }
    const invites = await listTeamInvites(lastTeamId)
    renderInvites(invites)
    setStatus('Invitation sendt.', 'success')
  } catch (error) {
    console.warn('Send invite failed', error)
    setStatus(error?.message || 'Kunne ikke sende invitation.', 'error')
  } finally {
    setLoading(false)
  }
}

async function handleUidSubmit () {
  if (!uidInput || !uidRoleSelect) return
  const uid = uidInput.value || ''
  if (!uid) {
    setStatus('UID mangler.', 'error')
    return
  }
  setLoading(true)
  try {
    const role = uidRoleSelect.value === 'admin' ? 'admin' : 'member'
    await addTeamMemberByUid(lastTeamId, uid, role)
    uidInput.value = ''
    const members = await listTeamMembers(lastTeamId)
    renderMembersList(members)
    setStatus('Medlem tilføjet.', 'success')
  } catch (error) {
    setStatus(error?.message || 'Kunne ikke tilføje medlem.', 'error')
  } finally {
    setLoading(false)
  }
}

function updateAdminVisibility (sessionRole) {
  const isAdmin = isAdminRole(sessionRole)
  if (teamAdminCard) {
    setAriaHidden(teamAdminCard, !isAdmin)
    teamAdminCard.hidden = !isAdmin
  }
  if (teamMemberOverviewCard) {
    teamMemberOverviewCard.hidden = isAdmin
    setAriaHidden(teamMemberOverviewCard, isAdmin)
  }
  if (sharedAdminActions) {
    setAriaHidden(sharedAdminActions, !isAdmin)
  }
  const invitesCard = teamPanel?.querySelector('.team-admin__card:has(#teamInvitesListTeamPage)')
  if (invitesCard) {
    invitesCard.hidden = !isAdmin
  }
}

function updateTeamSummary (state) {
  if (teamIdInputContainer) {
    const canEdit = Boolean(state?.canChangeTeam)
    teamIdInputContainer.hidden = !canEdit
    setAriaHidden(teamIdInputContainer, !canEdit)
  }
}

function updateDiagnosticsCard (session) {
  if (!diagnosticsCard) return
  const isAdmin = isAdminRole(getSessionRole(session))
  diagnosticsCard.hidden = !isAdmin
  setAriaHidden(diagnosticsCard, !isAdmin)
}

function updateAdminLock (sessionRole) {
  adminLocked = !isAdminRole(sessionRole)
  setLoading(loading)
}

async function loadTeamData (session) {
  if (!session?.teamId) return
  lastTeamId = formatTeamId(session.teamId)
  setLoading(true)
  try {
    const [teamResponse, members, invites] = await Promise.all([
      getTeamDocument(lastTeamId),
      listTeamMembers(lastTeamId),
      isAdminRole(session?.role) ? listTeamInvites(lastTeamId) : Promise.resolve([]),
    ])
    renderTeamInfo(teamResponse?.team || teamResponse)
    renderMembersList(members)
    renderMembersReadOnly(members)
    renderInvites(invites)
  } catch (error) {
    setStatus(error?.message || 'Kunne ikke hente team-data.', 'error')
  } finally {
    setLoading(false)
  }
}

async function handleRefreshClick () {
  const session = lastSessionState || getSessionState()
  setStatus('Opdaterer…')
  await loadTeamData(session)
  setStatus('Opdateret.', 'success')
}

async function ensureDiagnostics () {
  const session = lastSessionState || getSessionState()
  if (!session?.user?.uid) return
  if (!diagnosticsList) return
  diagnosticsList.textContent = ''
  const token = ++diagnosticsToken
  try {
    const diagnostics = await getAuthDiagnostics()
    if (token !== diagnosticsToken) return
    const rows = Object.entries(diagnostics || {})
    if (!rows.length) return
    rows.forEach(([key, value]) => {
      const item = document.createElement('li')
      item.textContent = `${key}: ${value ?? ''}`
      diagnosticsList.appendChild(item)
    })
  } catch (error) {
    if (diagnosticsWarning) diagnosticsWarning.textContent = 'Kunne ikke hente diagnostics.'
  }
}

export function initTeamAdminPage () {
  if (initialized) return
  initialized = true
  teamPanel = document.querySelector('[data-tab-panel="team"]')
  teamTabButton = document.querySelector('[data-tab-id="team"]')
  teamAdminCard = document.querySelector('.team-admin')
  teamMemberOverviewCard = document.getElementById('teamMemberOverview')
  teamNameEl = document.getElementById('teamName')
  teamIdEl = document.getElementById('teamId')
  teamCopyIdBtn = document.getElementById('teamCopyId')
  teamCopyNameBtn = document.getElementById('teamCopyName')
  statusEl = document.getElementById('teamAdminStatus')
  invitesListEl = document.getElementById('teamInvitesListTeamPage')
  membersListEl = document.getElementById('teamMembersListTeamPage')
  membersReadOnlyListEl = document.getElementById('teamMembersListReadOnly')
  teamIdInputContainer = document.getElementById('teamIdInput')?.closest('.shared-controls') || null
  sharedAdminActions = document.querySelector('.shared-admin-actions')
  diagnosticsCard = document.getElementById('teamDiagnostics')
  diagnosticsList = document.getElementById('teamDiagnosticsList')
  diagnosticsWarning = document.getElementById('teamDiagnosticsWarning')
  inviteEmailInput = document.getElementById('teamInviteEmailTeamPage')
  inviteRoleSelect = document.getElementById('teamInviteRoleTeamPage')
  inviteSubmitButton = document.getElementById('teamInviteSubmitTeamPage')
  inviteLinkContainer = document.getElementById('teamInviteLinkContainer')
  inviteLinkInput = document.getElementById('teamInviteLink')
  inviteLinkCopyButton = document.getElementById('teamInviteCopy')
  claimOwnerContainer = document.getElementById('teamClaimOwnerContainer')
  claimOwnerButton = document.getElementById('teamClaimOwner')
  uidInput = document.getElementById('teamUidInput')
  uidRoleSelect = document.getElementById('teamUidRole')
  uidSubmitButton = document.getElementById('teamUidSubmit')
  refreshButton = document.getElementById('teamRefresh')

  if (inviteSubmitButton) inviteSubmitButton.addEventListener('click', handleInviteSubmit)
  if (inviteLinkCopyButton) {
    inviteLinkCopyButton.addEventListener('click', () => copyToClipboard(inviteLinkInput?.value || ''))
  }
  if (uidSubmitButton) uidSubmitButton.addEventListener('click', handleUidSubmit)
  if (refreshButton) refreshButton.addEventListener('click', handleRefreshClick)
  if (claimOwnerButton) claimOwnerButton.addEventListener('click', handleClaimOwner)
  if (accessRetryButton) accessRetryButton.addEventListener('click', handleAccessRetry)
  if (accessBootstrapButton) accessBootstrapButton.addEventListener('click', handleAccessBootstrap)
  if (accessResetButton) accessResetButton.addEventListener('click', handleAccessReset)
  if (teamCopyIdBtn) teamCopyIdBtn.addEventListener('click', () => copyToClipboard(teamIdEl?.textContent || ''))
  if (teamCopyNameBtn) teamCopyNameBtn.addEventListener('click', () => copyToClipboard(teamNameEl?.textContent || ''))

  if (teamTabButton) {
    teamTabButton.addEventListener('click', async () => {
      const session = getSessionState()
      await loadTeamData(session)
    })
  }

  onSessionChange((state) => {
    lastSessionState = state
    const sessionRole = getSessionRole(state)
    updateAdminVisibility(sessionRole)
    updateAdminLock(sessionRole)
    updateDiagnosticsCard(state)
    updateTeamSummary(state)
    if (state?.accessStatus && state.accessStatus !== TEAM_ACCESS_STATUS.OK) {
      updateAccessActions({
        accessStatus: state.accessStatus,
        canBootstrapAction: Boolean(state?.bootstrapAvailable),
        isChecking: state.accessStatus === TEAM_ACCESS_STATUS.CHECKING,
      })
    } else {
      updateAccessActions({ accessStatus: 'ok', canBootstrapAction: false, isChecking: false })
    }
    if (claimOwnerContainer) {
      const bootstrapEmail = normalizeEmail(state?.bootstrapAdminEmail || BOOTSTRAP_ADMIN_EMAIL || '')
      const isBootstrapAdmin = normalizeEmail(state?.user?.email) === bootstrapEmail
      claimOwnerContainer.hidden = !(isBootstrapAdmin && state?.accessStatus === TEAM_ACCESS_STATUS.NO_ACCESS)
      setAriaHidden(claimOwnerContainer, claimOwnerContainer.hidden)
    }
    if (teamPanel && teamTabButton?.getAttribute('aria-selected') === 'true') {
      loadTeamData(state).catch(() => {})
    }
    ensureDiagnostics().catch(() => {})
  })

  assertAdmin().catch(() => {})
}
