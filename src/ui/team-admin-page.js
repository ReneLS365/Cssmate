import {
  addTeamMemberByEmail,
  addTeamMemberByUid,
  getTeamDocument,
  listTeamInvites,
  listTeamMembers,
  PermissionDeniedError,
  revokeTeamInvite,
  removeTeamMember,
  saveTeamMember,
  setMemberActive,
  saveTeamInvite,
} from '../../js/shared-ledger.js'
import { getAuthDiagnostics } from '../../js/shared-auth.js'
import { assertAdmin } from '../auth/admin.js'
import { isAdminEmail, normalizeEmail } from '../auth/roles.js'
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
let fixMembershipButton
let accessActionsEl
let accessRetryButton
let accessBootstrapButton
let accessResetButton
let lastTeamId = ''
let loading = false
let adminLocked = false
let lastSessionState = null
let diagnosticsToken = 0

const MEMBER_EMAIL_FIX = 'renelowesorensen@gmail.com'

function isOwner (role) {
  return role === 'owner'
}

function isAdminRole (role) {
  return role === 'admin' || isOwner(role)
}

function getSessionRole (session) {
  const role = session?.member?.role || session?.role || ''
  if (role === 'owner' || role === 'admin') return role
  if (isAdminEmail(session?.user?.email)) return 'admin'
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
    fixMembershipButton,
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
  if (teamIdEl) teamIdEl.textContent = team.teamId || ''
}

function formatInviteCreatedAt (value) {
  if (!value) return '-'
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toLocaleDateString('da-DK')
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('da-DK')
    }
    return String(value)
  }
  if (typeof value.toDate === 'function') {
    const parsed = value.toDate()
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('da-DK')
    }
  }
  if (typeof value.seconds === 'number') {
    const parsed = new Date(value.seconds * 1000)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('da-DK')
    }
  }
  return '-'
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
    let status = invite.status || 'pending'
    const statusLabels = {
      pending: 'afventer',
      accepted: 'accepteret',
      revoked: 'tilbagekaldt',
      expired: 'udløbet',
    }
    const statusLabel = statusLabels[status] || status
    const email = invite.email || invite.emailLower || '–'
    const role = invite.role || 'member'
    const createdAtLabel = formatInviteCreatedAt(invite.createdAt || invite.addedAt)
    label.textContent = `${email} · ${role} · ${statusLabel} · Oprettet: ${createdAtLabel}`
    const actions = document.createElement('div')
    actions.className = 'team-invite-actions'
    const revokeBtn = document.createElement('button')
    revokeBtn.type = 'button'
    revokeBtn.textContent = 'Tilbagekald'
    revokeBtn.disabled = status === 'revoked' || status === 'expired' || status === 'accepted'
    revokeBtn.addEventListener('click', async () => {
      try {
        await revokeTeamInvite(invite.inviteId || invite.id || '')
        await loadTeamData()
      } catch (error) {
        setStatus(error?.message || 'Kunne ikke tilbagekalde invite.', 'error')
      }
    })
    actions.append(revokeBtn)
    row.append(label, actions)
    invitesListEl.appendChild(row)
  })
}

function canEditMemberRole (viewerRole, target) {
  if (!viewerRole) return false
  if (isOwner(target.role)) return false
  if (viewerRole === 'owner') return true
  if (viewerRole === 'admin') return target.role !== 'admin'
  return false
}

function canRemoveMember (viewerRole, viewerUid, target) {
  if (!viewerRole) return false
  if (isOwner(target.role)) return false
  if (viewerRole === 'owner') {
    return target.uid !== viewerUid
  }
  if (viewerRole === 'admin') {
    return target.role !== 'admin' && target.role !== 'owner'
  }
  return false
}

function renderMembers (members = [], sessionRole = '', currentUid = '') {
  if (!membersListEl) return
  membersListEl.textContent = ''
  if (!Array.isArray(members) || !members.length) {
    const p = document.createElement('p')
    p.textContent = 'Ingen medlemmer endnu.'
    membersListEl.appendChild(p)
    return
  }
  const isAdmin = isAdminRole(sessionRole)
  members
    .slice()
    .sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''))
    .forEach(member => {
      const row = document.createElement('div')
      row.className = 'team-member-row'
      const info = document.createElement('div')
      info.className = 'team-member-email'
      const labelParts = [
        member.displayName || member.email || member.uid || 'Ukendt',
        member.email && member.displayName ? `(${member.email})` : '',
        member.uid ? `uid: ${member.uid}` : '',
      ].filter(Boolean)
      info.textContent = labelParts.join(' ')

      // For members (non-admins), only show the info and role as text
      if (!isAdmin) {
        const roleText = document.createElement('span')
        roleText.className = 'team-member-role-text'
        roleText.textContent = member.role === 'owner' ? 'Ejer' : member.role === 'admin' ? 'Admin' : 'Medlem'
        row.append(info, roleText)
        membersListEl.appendChild(row)
        return
      }

      // For admins, show full controls
      const roleSelect = document.createElement('select')
      roleSelect.innerHTML = '<option value="member">Medlem</option><option value="admin">Admin</option>'
      roleSelect.value = member.role === 'admin' || member.role === 'owner' ? member.role : 'member'
      roleSelect.disabled = !canEditMemberRole(sessionRole, member)
      roleSelect.addEventListener('change', async () => {
        if (!isAdminRole(sessionRole)) return
        roleSelect.disabled = true
        try {
          await saveTeamMember(lastTeamId, { ...member, role: roleSelect.value })
          setStatus('Rolle opdateret.', 'success')
          await loadTeamData()
        } catch (error) {
          console.warn('Role update failed', error)
          setStatus(error?.message || 'Kunne ikke opdatere rolle', 'error')
          roleSelect.value = member.role === 'admin' || member.role === 'owner' ? member.role : 'member'
        } finally {
          roleSelect.disabled = !canEditMemberRole(sessionRole, member)
        }
      })

      const removeBtn = document.createElement('button')
      removeBtn.type = 'button'
      removeBtn.textContent = 'Fjern'
      removeBtn.disabled = !canRemoveMember(sessionRole, currentUid, member)
      removeBtn.addEventListener('click', async () => {
        if (!isAdminRole(sessionRole)) return
        removeBtn.disabled = true
        try {
          await removeTeamMember(lastTeamId, member.uid || member.id)
          setStatus('Medlem fjernet.', 'success')
          await loadTeamData()
        } catch (error) {
          console.warn('Remove member failed', error)
          setStatus(error?.message || 'Kunne ikke fjerne medlem', 'error')
        } finally {
          removeBtn.disabled = !canRemoveMember(sessionRole, currentUid, member)
        }
      })

      const toggleBtn = document.createElement('button')
      toggleBtn.type = 'button'
      const isActive = member.active !== false
      toggleBtn.textContent = isActive ? 'Deaktivér' : 'Aktivér'
      toggleBtn.disabled = !isAdminRole(sessionRole) || isOwner(member.role)
      toggleBtn.addEventListener('click', async () => {
        if (!isAdminRole(sessionRole)) return
        toggleBtn.disabled = true
        try {
          await setMemberActive(lastTeamId, member.uid || member.id, !isActive)
          setStatus('Status opdateret.', 'success')
          await loadTeamData()
        } catch (error) {
          console.warn('Toggle active failed', error)
          setStatus(error?.message || 'Kunne ikke opdatere status', 'error')
        } finally {
          toggleBtn.disabled = !isAdminRole(sessionRole) || isOwner(member.role)
        }
      })

      row.append(info, roleSelect, toggleBtn, removeBtn)
      membersListEl.appendChild(row)
    })
}

function renderReadOnlyMembers (members = []) {
  if (!membersReadOnlyListEl) return
  membersReadOnlyListEl.textContent = ''
  if (!Array.isArray(members) || !members.length) {
    const p = document.createElement('p')
    p.textContent = 'Ingen medlemmer endnu.'
    membersReadOnlyListEl.appendChild(p)
    return
  }
  members
    .slice()
    .sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''))
    .forEach(member => {
      const row = document.createElement('div')
      row.className = 'team-member-row'
      const info = document.createElement('div')
      info.className = 'team-member-email'
      const labelParts = [
        member.displayName || member.email || member.uid || 'Ukendt',
        member.email && member.displayName ? `(${member.email})` : '',
        member.uid ? `uid: ${member.uid}` : '',
      ].filter(Boolean)
      info.textContent = labelParts.join(' ')
      const roleText = document.createElement('span')
      roleText.className = 'team-member-role-text'
      roleText.textContent = member.role === 'owner' ? 'Ejer' : member.role === 'admin' ? 'Admin' : 'Medlem'
      row.append(info, roleText)
      membersReadOnlyListEl.appendChild(row)
    })
}

function requireAdminAction () {
  try {
    assertAdmin(getSessionState(), 'Denne handling')
    return true
  } catch (error) {
    setStatus(error?.message || 'Kun admin kan udføre denne handling.', 'error')
    return false
  }
}

async function handleInviteSubmit () {
  if (!inviteEmailInput || !inviteRoleSelect) return
  if (!requireAdminAction()) return
  const email = inviteEmailInput.value || ''
  if (email && !normalizeEmail(email)) {
    setStatus('Ugyldig email.', 'error')
    return
  }
  const role = inviteRoleSelect.value === 'admin' ? 'admin' : 'member'
  setLoading(true)
  try {
    const result = await saveTeamInvite(lastTeamId, { email, role })
    inviteEmailInput.value = ''
    if (inviteLinkContainer && inviteLinkInput && result?.inviteUrl) {
      inviteLinkInput.value = result.inviteUrl
      inviteLinkContainer.hidden = false
      inviteLinkContainer.removeAttribute('aria-hidden')
    }
    setStatus('Invitation sendt.', 'success')
    // Reload invites list to show the new invite
    const invites = await listTeamInvites(lastTeamId)
    renderInvites(invites)
  } catch (error) {
    console.warn('Send invite failed', error)
    setStatus(error?.message || 'Kunne ikke sende invitation', 'error')
  } finally {
    setLoading(false)
  }
}

async function handleAddByUid () {
  if (!uidInput || !uidRoleSelect) return
  if (!requireAdminAction()) return
  const uid = uidInput.value || ''
  if (!uid.trim()) {
    setStatus('Angiv UID.', 'error')
    return
  }
  const role = uidRoleSelect.value === 'admin' ? 'admin' : 'member'
  setLoading(true)
  try {
    await addTeamMemberByUid(lastTeamId, uid, role)
    uidInput.value = ''
    setStatus('Medlem tilføjet via UID.', 'success')
    await loadTeamData()
  } catch (error) {
    console.warn('Add by UID failed', error)
    setStatus(error?.message || 'Kunne ikke tilføje medlem', 'error')
  } finally {
    setLoading(false)
  }
}

async function handleFixMembership () {
  if (!requireAdminAction()) return
  setLoading(true)
  try {
    const members = await listTeamMembers(lastTeamId)
    const normalizedFixEmail = normalizeEmail(MEMBER_EMAIL_FIX)
    const hasMember = members.some(member => normalizeEmail(member.email || member.emailLower) === normalizedFixEmail)
    if (hasMember) {
      setStatus('Medlem findes allerede.', 'success')
      return
    }
    await addTeamMemberByEmail(lastTeamId, MEMBER_EMAIL_FIX, 'member')
    setStatus('Medlem oprettet for renelowesorensen@gmail.com.', 'success')
    await loadTeamData()
  } catch (error) {
    console.warn('Fix membership failed', error)
    setStatus(error?.message || 'Kunne ikke oprette medlemmet', 'error')
  } finally {
    setLoading(false)
  }
}

function clearTeamLists () {
  if (membersListEl) membersListEl.textContent = ''
  if (invitesListEl) invitesListEl.textContent = ''
  if (membersReadOnlyListEl) membersReadOnlyListEl.textContent = ''
  if (inviteLinkContainer) {
    inviteLinkContainer.hidden = true
    inviteLinkContainer.setAttribute('aria-hidden', 'true')
  }
}

function renderDiagnosticsRows (rows) {
  if (!diagnosticsList) return
  diagnosticsList.textContent = ''
  rows.forEach(text => {
    const li = document.createElement('li')
    li.textContent = text
    diagnosticsList.appendChild(li)
  })
}

async function refreshDiagnostics (session) {
  if (!diagnosticsCard || !diagnosticsList) return
  const adminVisible = isAdminRole(getSessionRole(session))
  diagnosticsCard.hidden = !adminVisible
  setAriaHidden(diagnosticsCard, !adminVisible)
  if (!adminVisible) return

  const token = ++diagnosticsToken
  renderDiagnosticsRows(['Indlæser diagnostic...'])
  if (diagnosticsWarning) diagnosticsWarning.textContent = ''
  const authDiagnostics = getAuthDiagnostics()
  if (token !== diagnosticsToken) return

  const debugState = getDebugState()

  renderDiagnosticsRows([
    `Auth klar: ${authDiagnostics.authReady ? 'ja' : 'nej'}`,
    `Logget ind: ${authDiagnostics.isAuthenticated ? 'ja' : 'nej'}`,
    `Sidste auth-fejlkode: ${authDiagnostics.lastAuthErrorCode || '–'}`,
    `Team ID: ${debugState?.teamId || '–'}`,
  ])

  if (diagnosticsWarning) {
    diagnosticsWarning.textContent = ''
    diagnosticsWarning.dataset.variant = ''
  }
}

function toggleAdminControls (isAdmin) {
  adminLocked = !isAdmin
  setLoading(loading)

  if (teamAdminCard) {
    teamAdminCard.hidden = !isAdmin
    setAriaHidden(teamAdminCard, !isAdmin)
  }

  if (teamIdInputContainer) {
    teamIdInputContainer.hidden = !isAdmin
    setAriaHidden(teamIdInputContainer, !isAdmin)
  }

  if (sharedAdminActions) {
    sharedAdminActions.hidden = !isAdmin
    setAriaHidden(sharedAdminActions, !isAdmin)
  }

  // Hide all admin-only actions (invite forms, UID add form)
  const actionSections = teamPanel?.querySelectorAll('.team-admin__actions')
  actionSections?.forEach(section => {
    if (!section) return
    section.hidden = !isAdmin
    setAriaHidden(section, !isAdmin)
    section.classList.toggle('team-admin--locked', !isAdmin)
  })

  const adminOnlyFields = teamPanel?.querySelectorAll('.team-admin__actions button, .team-admin__actions input, .team-admin__actions select, .btn-group button')
  adminOnlyFields?.forEach(field => {
    if (!field) return
    field.disabled = !isAdmin
    field.tabIndex = isAdmin ? 0 : -1
  })

  // Hide the button group (Opdater, Ret medlemskab) for non-admins
  const btnGroups = teamPanel?.querySelectorAll('.btn-group')
  btnGroups?.forEach(section => {
    if (!section) return
    section.hidden = !isAdmin
    setAriaHidden(section, !isAdmin)
    section.classList.toggle('team-admin--locked', !isAdmin)
  })

  // Show member list always, but hide invites card for non-admins
  const listSections = teamPanel?.querySelectorAll('.team-admin__lists')
  listSections?.forEach(section => {
    if (!section) return
    setAriaHidden(section, false)
    section.classList.toggle('team-admin--locked', !isAdmin)
  })

  // Hide invites card completely for non-admins
  const invitesCard = teamPanel?.querySelector('.team-admin__card:has(#teamInvitesListTeamPage)')
  if (invitesCard) {
    invitesCard.hidden = !isAdmin
  } else {
    // Fallback: find by sibling of members card
    const allCards = teamPanel?.querySelectorAll('.team-admin__card')
    if (allCards && allCards.length > 1) {
      allCards[1].hidden = !isAdmin
    }
  }
}

function toggleMemberOverview (visible) {
  if (!teamMemberOverviewCard) return
  teamMemberOverviewCard.hidden = !visible
  setAriaHidden(teamMemberOverviewCard, !visible)
}

function renderAccessState (session) {
  ensureAccessActions()
  const accessStatus = session?.accessStatus || TEAM_ACCESS_STATUS.LOADING
  const membershipStatus = session?.membershipStatus || 'loading'
  const isChecking = accessStatus === TEAM_ACCESS_STATUS.LOADING || membershipStatus === 'loading'
  const role = getSessionRole(session)
  const isAdmin = isAdminRole(role)
  const canViewMembers = accessStatus === TEAM_ACCESS_STATUS.OK && session?.sessionReady
  const canEditMembers = canViewMembers && isAdmin
  const canShowAdmin = canEditMembers
  const canBootstrapAction = Boolean(session?.bootstrapAvailable && accessStatus === TEAM_ACCESS_STATUS.NO_TEAM)
  const bootstrapEmail = normalizeEmail(session?.bootstrapAdminEmail || BOOTSTRAP_ADMIN_EMAIL || '')
  const isBootstrapAdmin = normalizeEmail(session?.user?.email) === bootstrapEmail
  const teamId = formatTeamId(session?.teamId || DEFAULT_TEAM_SLUG)
  const canClaimOwner = isBootstrapAdmin
    && teamId === formatTeamId(DEFAULT_TEAM_SLUG)
    && accessStatus === TEAM_ACCESS_STATUS.NO_ACCESS
  const accessError = session?.accessError || session?.error || null
  const reason = session?.accessDetail?.reason || ''
  let message = session?.message || ''
  let variant = ''

  if (isChecking) {
    message = 'Tjekker team-adgang…'
  } else if (accessStatus === TEAM_ACCESS_STATUS.NO_AUTH) {
    message = 'Log ind for at administrere teamet.'
    variant = 'info'
  } else if (accessStatus === TEAM_ACCESS_STATUS.OK) {
    message = isAdmin
      ? 'Adgang givet. Team-medlemmer kan indlæses.'
      : 'Adgang givet. Medlemslisten er skrivebeskyttet.'
    variant = 'success'
  } else if (accessStatus === TEAM_ACCESS_STATUS.NO_ACCESS) {
    if (reason === 'inactive') message = 'Din konto er deaktiveret. Kontakt administrator.'
    else if (reason === 'not-assigned') message = 'Du er ikke tildelt teamet. Kontakt admin.'
    else message = session?.message || 'Ingen team-adgang. Tilføj dig selv eller kontakt admin.'
    variant = 'error'
  } else if (accessStatus === TEAM_ACCESS_STATUS.NO_TEAM) {
    message = session?.message || 'Teamet findes ikke. Opret det eller vælg et andet team.'
    variant = 'error'
  } else {
    message = message || accessError?.message || 'Kunne ikke kontrollere team-adgang.'
    variant = 'error'
  }

  const parts = [
    session?.teamId ? `Team: ${session.teamId}` : '',
    session?.user?.uid ? `UID: ${session.user.uid}` : '',
    session?.user?.email ? `Email: ${session.user.email}` : '',
    session?.memberAssigned === false ? 'Ikke tildelt' : '',
  ].filter(Boolean)

  if (accessError?.code && accessStatus !== 'ok') {
    parts.push(`Fejlkode: ${accessError.code}`)
  }

  const detail = parts.length ? ` (${parts.join(' · ')})` : ''
  setStatus(`${message}${detail}`, variant)
  if (session?.teamId) {
    renderTeamInfo({ name: session?.displayTeamId || session.teamId, teamId: session.teamId })
  }
  toggleAdminControls(canShowAdmin)
  toggleMemberOverview(canViewMembers && !isAdmin)
  updateAccessActions({ accessStatus, canBootstrapAction, isChecking })
  if (claimOwnerContainer) {
    claimOwnerContainer.hidden = !canClaimOwner
    setAriaHidden(claimOwnerContainer, !canClaimOwner)
  }
  if (claimOwnerButton) {
    claimOwnerButton.hidden = !canClaimOwner
    claimOwnerButton.disabled = !canClaimOwner || isChecking || loading
  }
}

async function loadTeamData () {
  if (!lastTeamId || loading) return
  setLoading(true)
  try {
    setStatus('Indlæser team…')
    const session = getSessionState()
    const sessionRole = getSessionRole(session)
    const allowInvites = isAdminRole(sessionRole)
    const [team, members, invites] = await Promise.all([
      getTeamDocument(lastTeamId),
      listTeamMembers(lastTeamId),
      allowInvites ? listTeamInvites(lastTeamId) : Promise.resolve([]),
    ])
    renderTeamInfo(team)
    renderMembers(members, sessionRole, session?.user?.uid || '')
    renderReadOnlyMembers(members)
    renderInvites(allowInvites ? invites : [])
    setStatus('Team opdateret.', 'success')
  } catch (error) {
    console.warn('Load team data failed', error)
    const message = error instanceof PermissionDeniedError
      ? error.message || 'Ingen adgang til teamet.'
      : (error?.message || 'Kunne ikke indlæse team.')
    setStatus(message, 'error')
  } finally {
    setLoading(false)
  }
}

function updateTabVisibility (session) {
  if (!teamTabButton || !teamPanel) return
  // Always show Team tab - handle access state within the page content
  // This prevents route-level blocking and infinite spinner issues
  const authReady = session?.authReady !== false
  const isSignedIn = Boolean(session?.user)
  // Show tab if user is signed in (regardless of access check status)
  const visible = authReady && isSignedIn
  if (visible) {
    teamTabButton.hidden = false
    teamTabButton.removeAttribute('aria-hidden')
    teamTabButton.removeAttribute('data-tab-disabled')
    teamPanel.removeAttribute('data-tab-disabled')
  } else {
    teamTabButton.hidden = true
    teamTabButton.setAttribute('aria-hidden', 'true')
    teamTabButton.setAttribute('data-tab-disabled', 'true')
    teamPanel.setAttribute('data-tab-disabled', 'true')
  }
  if (typeof window.__cssmateRefreshTabs === 'function') {
    window.__cssmateRefreshTabs()
  }
}

function handleSessionChange (session) {
  lastSessionState = session
  updateTabVisibility(session)
  const accessStatus = session?.accessStatus || TEAM_ACCESS_STATUS.LOADING
  renderAccessState(session)
  refreshDiagnostics(session).catch(error => {
    console.warn('Diagnostics refresh failed', error)
  })
  const hasAccess = session?.teamId && session?.sessionReady && accessStatus === TEAM_ACCESS_STATUS.OK
  if (!hasAccess) {
    lastTeamId = ''
    clearTeamLists()
    return
  }
  const nextTeamId = session.teamId
  if (nextTeamId && nextTeamId !== lastTeamId) {
    lastTeamId = nextTeamId
    loadTeamData()
  }
}

function bindEvents () {
  if (inviteSubmitButton) {
    inviteSubmitButton.addEventListener('click', handleInviteSubmit)
  }
  if (inviteLinkCopyButton) {
    inviteLinkCopyButton.addEventListener('click', () => copyToClipboard(inviteLinkInput?.value || ''))
  }
  if (uidSubmitButton) {
    uidSubmitButton.addEventListener('click', handleAddByUid)
  }
  if (refreshButton) {
      refreshButton.addEventListener('click', () => {
        const session = lastSessionState || getSessionState()
        const accessStatus = session?.accessStatus || TEAM_ACCESS_STATUS.CHECKING
        if (accessStatus !== TEAM_ACCESS_STATUS.OK || !session?.sessionReady) {
          handleAccessRetry()
          return
        }
        loadTeamData()
      })
  }
  if (teamCopyIdBtn) {
    teamCopyIdBtn.addEventListener('click', () => copyToClipboard(lastTeamId))
  }
  if (teamCopyNameBtn) {
    teamCopyNameBtn.addEventListener('click', () => copyToClipboard(teamNameEl?.textContent || ''))
  }
  if (fixMembershipButton) {
    fixMembershipButton.addEventListener('click', handleFixMembership)
  }
  ensureAccessActions()
  if (accessRetryButton) accessRetryButton.addEventListener('click', handleAccessRetry)
  if (accessBootstrapButton) accessBootstrapButton.addEventListener('click', handleAccessBootstrap)
  if (accessResetButton) accessResetButton.addEventListener('click', handleAccessReset)
  if (claimOwnerButton) claimOwnerButton.addEventListener('click', handleClaimOwner)
}

export function initTeamAdminPage () {
  if (initialized) return
  initialized = true
  teamPanel = document.getElementById('panel-team')
  teamTabButton = document.getElementById('tab-team')
  teamAdminCard = teamPanel?.querySelector('.team-admin') || null
  teamMemberOverviewCard = document.getElementById('teamMemberOverview')
  teamIdInputContainer = document.getElementById('teamIdInputContainer')
  sharedAdminActions = teamPanel?.querySelector('.shared-admin-actions') || null
  teamNameEl = document.getElementById('teamName')
  teamIdEl = document.getElementById('teamId')
  teamCopyIdBtn = document.getElementById('teamCopyId')
  teamCopyNameBtn = document.getElementById('teamCopyName')
  statusEl = document.getElementById('teamAdminStatus')
  invitesListEl = document.getElementById('teamInvitesListTeamPage')
  membersListEl = document.getElementById('teamMembersListTeamPage')
  membersReadOnlyListEl = document.getElementById('teamMembersListReadOnly')
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
  fixMembershipButton = document.getElementById('teamFixMembership')

  bindEvents()
  onSessionChange(handleSessionChange)
  handleSessionChange(getSessionState())
}

export function setTeamTabVisibility (visible) {
  if (!teamTabButton || !teamPanel) return
  // Allow programmatic control but prefer showing tab when user is signed in
  if (visible) {
    teamTabButton.hidden = false
    teamTabButton.removeAttribute('aria-hidden')
    teamTabButton.removeAttribute('data-tab-disabled')
    teamPanel.removeAttribute('data-tab-disabled')
  } else {
    teamTabButton.hidden = true
    teamTabButton.setAttribute('aria-hidden', 'true')
    teamTabButton.setAttribute('data-tab-disabled', 'true')
    teamPanel.setAttribute('data-tab-disabled', 'true')
  }
  if (typeof window.__cssmateRefreshTabs === 'function') {
    window.__cssmateRefreshTabs()
  }
}
