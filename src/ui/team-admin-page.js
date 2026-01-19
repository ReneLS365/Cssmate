import { getAuthContext } from '../../js/shared-auth.js'
import { getToken } from '../auth/auth0-client.js'
import { getState as getSessionState, onChange as onSessionChange } from '../auth/session.js'
import { registerTeamMemberOnce } from '../services/team-members.js'
import { DEFAULT_TEAM_SLUG, formatTeamId } from '../services/team-ids.js'
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

async function fetchTeamMembers (teamId) {
  const token = await getToken()
  const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/members`, {
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
let membersKey = ''

async function renderMembers (membersListEl, statusEl, baseStatus = '', teamId, shouldRefresh = false) {
  if (!membersListEl) return
  membersListEl.textContent = ''
  if (shouldRefresh) membersPromise = null
  if (!membersPromise) {
    const resolvedTeamId = formatTeamId(teamId || DEFAULT_TEAM_SLUG)
    const authCtx = getAuthContext()
    const currentUser = authCtx?.user || null
    await registerTeamMemberOnce({ teamId: resolvedTeamId, userId: currentUser?.uid || currentUser?.sub || '' })
    membersPromise = fetchTeamMembers(resolvedTeamId).finally(() => {
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
      name: member?.displayName || member?.name || '',
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
  const statusEl = document.getElementById('teamAdminStatus')

  const adminLists = document.querySelector('.team-admin__lists')
  const resetButton = document.getElementById('teamResetApp')
  const teamMembersList = document.getElementById('teamMembersListTeamPage')
  const teamStatusSection = document.querySelector('.team-status-controls')
  const teamAdminSection = document.querySelector('.team-admin')
  const statusUser = document.getElementById('sharedStatusUser')
  const statusEmail = document.getElementById('sharedStatusEmail')
  const connectedState = document.getElementById('teamConnectedState')
  const connectedAuth0 = document.getElementById('teamConnectedAuth0')
  const connectedOrg = document.getElementById('teamConnectedOrg')
  const connectedTeam = document.getElementById('teamConnectedTeam')
  const connectedRole = document.getElementById('teamConnectedRole')

  setHidden(resetButton, false)

  if (teamStatusSection) setHidden(teamStatusSection, false)
  if (adminLists) setHidden(adminLists, true)

  const authContext = getAuthContext()
  const user = authContext?.user || {}
  const role = resolveAuthRole(user)
  const teamId = formatTeamId(state?.teamId || DEFAULT_TEAM_SLUG)
  setText(statusUser, user?.displayName || user?.name || user?.email || '—')
  setText(statusEmail, user?.email || '—')

  if (!statusEl) return
  let baseStatus = ''
  if (!authContext?.isReady) baseStatus = 'Auth0 initialiseres…'
  else if (!authContext?.isAuthenticated) baseStatus = 'Log ind for at se teaminformation.'
  else baseStatus = 'Connected til Auth0'
  setText(statusEl, baseStatus)

  const isAdmin = isPrivilegedRole(role)
  const isAuthed = Boolean(authContext?.isAuthenticated)
  if (adminLists) setHidden(adminLists, !isAuthed)
  if (teamAdminSection) setHidden(teamAdminSection, !isAuthed)
  setText(connectedState, isAuthed ? 'Ja' : 'Nej')
  setText(connectedAuth0, authContext?.isReady ? 'klar' : 'venter')
  setText(connectedOrg, authContext?.user?.orgId || '–')
  setText(connectedTeam, teamId || '–')
  const displayRole = isAuthed ? (state?.role || (isAdmin ? 'admin' : 'member')) : ''
  setText(connectedRole, displayRole || '–')

  if (isAuthed) {
    const key = `${teamId}:${user?.email || user?.uid || ''}:${isAdmin ? 'admin' : 'member'}`
    const shouldRefresh = key !== membersKey
    membersKey = key
    renderMembers(teamMembersList, statusEl, baseStatus, teamId, shouldRefresh)
  }
}

export async function initTeamAdminPage () {
  const resetButton = document.getElementById('teamResetApp')

  resetButton?.addEventListener('click', () => {
    resetAppState({ reload: true })
  })

  render()
  onSessionChange(() => {
    render()
  })
}
