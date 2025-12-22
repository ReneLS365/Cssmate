import {
  addTeamMemberByUid,
  getTeamDocument,
  listTeamInvites,
  listTeamMembers,
  PermissionDeniedError,
  removeTeamMember,
  saveTeamMember,
  setMemberActive,
  addTeamMemberByEmail,
} from '../../js/shared-ledger.js'
import { normalizeEmail } from '../auth/roles.js'
import { getState as getSessionState, onChange as onSessionChange, refreshAccess, requestBootstrapAccess } from '../auth/session.js'
import { resetAppState } from '../utils/reset-app.js'
import { TEAM_ACCESS_STATUS } from '../services/team-access.js'

let initialized = false
let teamPanel
let teamTabButton
let teamNameEl
let teamIdEl
let teamCopyIdBtn
let teamCopyNameBtn
let statusEl
let invitesListEl
let membersListEl
let inviteEmailInput
let inviteRoleSelect
let inviteSubmitButton
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

const MEMBER_EMAIL_FIX = 'renelowesorensen@gmail.com'

function isOwner (role) {
  return role === 'owner'
}

function isAdminRole (role) {
  return role === 'admin' || isOwner(role)
}

function setStatus (message, variant = '') {
  if (!statusEl) return
  statusEl.textContent = message || ''
  statusEl.dataset.variant = variant || ''
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

function renderInvites (invites = []) {
  if (!invitesListEl) return
  invitesListEl.textContent = ''
  if (!Array.isArray(invites) || !invites.length) {
    const p = document.createElement('p')
    p.textContent = 'Ingen aktive invitationer.'
    invitesListEl.appendChild(p)
    return
  }
  invites.forEach(invite => {
    const row = document.createElement('div')
    row.className = 'team-invite-row'
    const label = document.createElement('div')
    const status = invite.usedAt ? 'brugt' : (invite.active === false ? 'deaktiveret' : 'aktiv')
    label.textContent = `${invite.email || invite.emailLower || ''} · ${invite.role || 'member'} · ${status}`
    const copyBtn = document.createElement('button')
    copyBtn.type = 'button'
    copyBtn.textContent = 'Kopiér invite-id'
    copyBtn.addEventListener('click', () => copyToClipboard(invite.inviteId || invite.id || ''))
    row.append(label, copyBtn)
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

      const roleSelect = document.createElement('select')
      roleSelect.innerHTML = '<option value="member">Medlem</option><option value="admin">Admin</option>'
      roleSelect.value = member.role === 'admin' || member.role === 'owner' ? member.role : 'member'
      roleSelect.disabled = !canEditMemberRole(sessionRole, member)
      roleSelect.addEventListener('change', async () => {
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

async function handleInviteSubmit () {
  if (!inviteEmailInput || !inviteRoleSelect) return
  const email = inviteEmailInput.value || ''
  if (!email.trim()) {
    setStatus('Angiv email for medlemmet.', 'error')
    return
  }
  const role = inviteRoleSelect.value === 'admin' ? 'admin' : 'member'
  setLoading(true)
  try {
    await addTeamMemberByEmail(lastTeamId, email, role)
    inviteEmailInput.value = ''
    setStatus('Medlem tilføjet via email.', 'success')
    await loadTeamData()
  } catch (error) {
    console.warn('Add member by email failed', error)
    setStatus(error?.message || 'Kunne ikke tilføje medlem via email', 'error')
  } finally {
    setLoading(false)
  }
}

async function handleAddByUid () {
  if (!uidInput || !uidRoleSelect) return
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
}

function toggleAdminControls (enabled) {
  adminLocked = !enabled
  setLoading(loading)
  const actionSections = teamPanel?.querySelectorAll('.team-admin__actions, .btn-group')
  actionSections?.forEach(section => {
    if (!section) return
    section.toggleAttribute('aria-hidden', !enabled)
    section.classList.toggle('team-admin--locked', !enabled)
  })
  const listSections = teamPanel?.querySelectorAll('.team-admin__lists')
  listSections?.forEach(section => {
    if (!section) return
    section.toggleAttribute('aria-hidden', false)
    section.classList.toggle('team-admin--locked', !enabled)
  })
}

function renderAccessState (session) {
  ensureAccessActions()
  const accessStatus = session?.accessStatus || TEAM_ACCESS_STATUS.LOADING
  const membershipStatus = session?.membershipStatus || 'loading'
  const isChecking = accessStatus === TEAM_ACCESS_STATUS.LOADING || membershipStatus === 'loading'
  const role = session?.member?.role || session?.role || ''
  const isAdmin = isAdminRole(role)
  const canViewMembers = accessStatus === TEAM_ACCESS_STATUS.OK && session?.sessionReady
  const canEditMembers = canViewMembers && isAdmin
  const canBootstrapAction = Boolean(session?.bootstrapAvailable && accessStatus === TEAM_ACCESS_STATUS.NO_TEAM)
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
  toggleAdminControls(canEditMembers)
  updateAccessActions({ accessStatus, canBootstrapAction, isChecking })
}

async function loadTeamData () {
  if (!lastTeamId || loading) return
  setLoading(true)
  try {
    setStatus('Indlæser team…')
    const session = getSessionState()
    const sessionRole = session?.member?.role || session?.role || ''
    const allowInvites = isAdminRole(sessionRole)
    const [team, members, invites] = await Promise.all([
      getTeamDocument(lastTeamId),
      listTeamMembers(lastTeamId),
      allowInvites ? listTeamInvites(lastTeamId) : Promise.resolve([]),
    ])
    renderTeamInfo(team)
    renderMembers(members, sessionRole, session?.user?.uid || '')
    const activeInvites = allowInvites ? invites.filter(invite => invite.active !== false && !invite.usedAt) : []
    renderInvites(activeInvites)
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
  const visible = Boolean(session?.sessionReady && session?.accessStatus === TEAM_ACCESS_STATUS.OK)
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
  const sessionRole = session?.member?.role || session?.role || ''
  const accessStatus = session?.accessStatus || TEAM_ACCESS_STATUS.LOADING
  renderAccessState(session)
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
}

export function initTeamAdminPage () {
  if (initialized) return
  initialized = true
  teamPanel = document.getElementById('panel-team')
  teamTabButton = document.getElementById('tab-team')
  teamNameEl = document.getElementById('teamName')
  teamIdEl = document.getElementById('teamId')
  teamCopyIdBtn = document.getElementById('teamCopyId')
  teamCopyNameBtn = document.getElementById('teamCopyName')
  statusEl = document.getElementById('teamAdminStatus')
  invitesListEl = document.getElementById('teamInvitesListTeamPage')
  membersListEl = document.getElementById('teamMembersListTeamPage')
  inviteEmailInput = document.getElementById('teamInviteEmailTeamPage')
  inviteRoleSelect = document.getElementById('teamInviteRoleTeamPage')
  inviteSubmitButton = document.getElementById('teamInviteSubmitTeamPage')
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
