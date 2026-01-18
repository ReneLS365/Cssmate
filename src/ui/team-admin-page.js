import { getAuthContext, getAuthDiagnostics } from '../../js/shared-auth.js'
import { getState as getSessionState, onChange as onSessionChange } from '../auth/session.js'

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
  if (role === 'owner') return 'Owner'
  if (role === 'admin') return 'Admin'
  if (role === 'member') return 'Medlem'
  return 'Ingen adgang'
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

  setHidden(teamIdInputContainer, true)
  setHidden(teamMemberOverview, true)
  setHidden(claimOwnerContainer, true)
  setHidden(adminActions, true)
  setHidden(adminLists, true)
  setHidden(refreshButton, true)

  const displayTeam = state?.displayTeamId || state?.teamId || '—'
  const role = state?.role || ''
  const roleText = roleLabel(role)

  setText(teamNameEl, displayTeam)
  setText(teamIdEl, displayTeam)

  if (!statusEl) return
  if (!state?.teamResolved) {
    setText(statusEl, 'Tjekker adgang…')
  } else if (state?.hasAccess) {
    setText(statusEl, `Adgang OK (Auth0) • Rolle: ${roleText}`)
  } else {
    setText(statusEl, `Ingen adgang (Auth0) • Rolle: ${roleText}`)
  }

  const isAdmin = role === 'owner' || role === 'admin'
  renderDiagnostics(isAdmin)
}

export function initTeamAdminPage () {
  render()
  onSessionChange(() => {
    render()
  })
}
