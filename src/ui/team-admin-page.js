import { getAuthContext, getAuthDiagnostics } from '../../js/shared-auth.js'
import { getToken } from '../auth/auth0-client.js'
import { getState as getSessionState, onChange as onSessionChange, refreshAccess } from '../auth/session.js'
import { resetAppState } from '../utils/reset-app.js'

// Auth0-first:
// - Team + roller styres i Auth0 (Organizations + Roles/Permissions)
// - DB/Firestore er IKKE kilde til membership/rolle
// - UI skal ikke lække teamId som input

function setText (el, text) {
  if (!el) return
  el.textContent = text == null ? '' : String(text)
}

function setHidden (el, hidden = true) {
  if (!el) return
  el.hidden = Boolean(hidden)
  el.setAttribute('aria-hidden', hidden ? 'true' : 'false')
}

function roleLabel (role) {
  if (role === 'sscaff_owner') return 'Owner'
  if (role === 'sscaff_admin') return 'Admin'
  if (role === 'sscaff_user') return 'Bruger'
  return 'Ukendt'
}

function resolveAuthRole (user) {
  const roles = Array.isArray(user?.roles) ? user.roles : []
  if (roles.includes('sscaff_owner')) return 'sscaff_owner'
  if (roles.includes('sscaff_admin')) return 'sscaff_admin'
  if (roles.includes('sscaff_user')) return 'sscaff_user'
  return ''
}

function isPrivilegedRole (role) {
  return role === 'sscaff_owner' || role === 'sscaff_admin'
}

function renderDiagnostics (isAdmin) {
  const diagnosticsCard = document.getElementById('teamDiagnostics')
  const diagnosticsList = document.getElementById('teamDiagnosticsList')
  const diagnosticsWarning = document.getElementById('teamDiagnosticsWarning')
  if (!diagnosticsCard || !diagnosticsList) return

  setHidden(diagnosticsCard, !isAdmin)
  if (!isAdmin) return

  const authContext = getAuthContext()
  const authDiagnostics = getAuthDiagnostics()
  const user = authContext?.user || {}
  const roles = Array.isArray(user.roles) ? user.roles : []
  const permissions = Array.isArray(user.permissions) ? user.permissions : []

  diagnosticsList.textContent = ''
  if (diagnosticsWarning) diagnosticsWarning.textContent = ''

  const lines = [
    ['authReady', authDiagnostics?.authReady ? 'yes' : 'no'],
    ['isAuthenticated', authDiagnostics?.isAuthenticated ? 'yes' : 'no'],
    ['userEmail', authDiagnostics?.userEmail || user.email || '—'],
    ['uid', user.uid || '—'],
    ['orgId', user.orgId || user.org_id || '—'],
    ['roles', roles.join(', ') || '—'],
    ['permissions', permissions.join(', ') || '—'],
  ]

  lines.forEach(([label, value]) => {
    const item = document.createElement('li')
    item.textContent = `${label}: ${value ?? '—'}`
    diagnosticsList.appendChild(item)
  })
}

function buildMemberRow (member) {
  const row = document.createElement('div')
  row.className = 'team-admin__list-row'
  const name = member?.name || '—'
  const email = member?.email || '—'
  row.innerHTML = `
    <div class="team-admin__list-main">
      <strong>${name}</strong>
      <span>${email}</span>
    </div>
  `
  return row
}

function normalizeMembersPayload (payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.members)) return payload.members
  return []
}

async function fetchOrgMembers () {
  const token = await getToken()
  const response = await fetch('/api/org-members', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = payload?.error || 'Kunne ikke hente medlemmer'
    throw new Error(message)
  }
  return normalizeMembersPayload(payload)
}

let membersPromise = null

async function renderMembers (membersListEl, statusEl, baseStatus = '') {
  if (!membersListEl) return
  membersListEl.textContent = ''
  if (!membersPromise) {
    membersPromise = fetchOrgMembers().finally(() => {
      membersPromise = null
    })
  }
  try {
    setText(statusEl, 'Henter medlemmer…')
    const members = await membersPromise
    membersListEl.textContent = ''
    const normalized = members.map(member => ({
      user_id: member?.user_id || member?.userId || '',
      email: member?.email || '',
      name: member?.name || '',
    }))
    if (!normalized.length) {
      const empty = document.createElement('p')
      empty.className = 'hint'
      empty.textContent = 'Ingen medlemmer fundet.'
      membersListEl.appendChild(empty)
    } else {
      normalized.forEach(member => membersListEl.appendChild(buildMemberRow(member)))
    }
    setText(statusEl, baseStatus)
  } catch (error) {
    membersListEl.textContent = ''
    const errorEl = document.createElement('p')
    errorEl.className = 'status-message'
    errorEl.textContent = error?.message || 'Kunne ikke hente medlemmer.'
    membersListEl.appendChild(errorEl)
    setText(statusEl, error?.message || 'Kunne ikke hente medlemmer.')
  }
}

function render () {
  const state = getSessionState()
  const teamNameEl = document.getElementById('teamName')
  const teamIdEl = document.getElementById('teamId')
  const statusEl = document.getElementById('teamAdminStatus')

  const teamIdInputContainer = document.getElementById('teamIdInputContainer')
  const teamMemberOverview = document.getElementById('teamMemberOverview')
  const claimOwnerContainer = document.getElementById('teamClaimOwnerContainer')
  const adminActions = document.querySelector('.team-admin__actions')
  const adminLists = document.querySelector('.team-admin__lists')
  const refreshButton = document.getElementById('teamRefresh')
  const resetButton = document.getElementById('teamResetApp')
  const sharedLogout = document.getElementById('sharedLogout')
  const teamMembersList = document.getElementById('teamMembersListTeamPage')
  const invitesCard = document.getElementById('teamInvitesListTeamPage')?.closest('.team-admin__card')
  const teamStatusSection = document.querySelector('.team-status-controls')
  const teamAdminSection = document.querySelector('.team-admin')
  const statusLoggedIn = document.getElementById('sharedStatusLoggedIn')
  const statusUser = document.getElementById('sharedStatusUser')
  const statusUid = document.getElementById('sharedStatusUid')
  const statusTeam = document.getElementById('sharedStatusTeam')
  const statusRole = document.getElementById('sharedStatusRole')

  setHidden(teamIdInputContainer, true)
  setHidden(teamMemberOverview, true)
  setHidden(claimOwnerContainer, true)
  setHidden(adminActions, true)
  setHidden(refreshButton, false)
  setHidden(resetButton, false)
  setHidden(sharedLogout, true)

  if (teamStatusSection) setHidden(teamStatusSection, false)
  if (teamAdminSection) setHidden(teamAdminSection, false)
  if (adminLists) setHidden(adminLists, true)
  if (invitesCard) setHidden(invitesCard, true)

  const authContext = getAuthContext()
  const user = authContext?.user || {}
  const displayTeam = user?.orgId || state?.displayTeamId || state?.teamId || '—'
  const role = resolveAuthRole(user)
  const roleText = roleLabel(role)

  setText(statusLoggedIn, authContext?.isAuthenticated ? 'Ja' : 'Nej')
  setText(statusUser, user?.displayName || user?.email || '—')
  setText(statusUid, user?.uid || '—')
  setText(statusTeam, displayTeam)
  setText(statusRole, roleText || '—')

  setText(teamNameEl, displayTeam)
  setText(teamIdEl, displayTeam)

  if (!statusEl) return
  let baseStatus = ''
  if (!authContext?.isReady) {
    baseStatus = 'Tjekker login…'
  } else if (!authContext?.isAuthenticated) {
    baseStatus = 'Log ind for at se teaminformation.'
  } else {
    baseStatus = `Auth0 klar • Rolle: ${roleText}`
  }
  setText(statusEl, baseStatus)

  const isAdmin = isPrivilegedRole(role)
  renderDiagnostics(isAdmin)

  if (adminLists) {
    setHidden(adminLists, !isAdmin)
  }
  if (isAdmin) {
    renderMembers(teamMembersList, statusEl, baseStatus)
  }
}

export async function initTeamAdminPage () {
  const refreshButton = document.getElementById('teamRefresh')
  const resetButton = document.getElementById('teamResetApp')

  refreshButton?.addEventListener('click', async () => {
    refreshButton.disabled = true
    try {
      await refreshAccess()
      render()
    } finally {
      refreshButton.disabled = false
    }
  })

  resetButton?.addEventListener('click', () => {
    resetAppState({ reload: true })
  })

  render()
  onSessionChange(() => {
    render()
  })
}
