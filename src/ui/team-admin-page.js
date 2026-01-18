import { getAuthContext } from '../../js/shared-auth.js'
import { getToken } from '../auth/auth0-client.js'
import { getState as getSessionState, onChange as onSessionChange, refreshAccess } from '../auth/session.js'
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

async function renderMembers (membersListEl, statusEl, baseStatus = '') {
  if (!membersListEl) return
  membersListEl.textContent = ''
  if (!membersPromise) {
    const state = getSessionState()
    const resolvedTeamId = formatTeamId(state?.teamId || DEFAULT_TEAM_SLUG)
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
      name: member?.name || '',
    }))

    // Ensure the currently authenticated user is included in the member list.
    // If the API does not return the current user, we synthesize an entry so
    // that the UI always reflects at least "me".
    try {
      const authCtx = getAuthContext()
      const currentUser = authCtx?.user || null
      const currentEmail = currentUser?.email || ''
      if (currentEmail) {
        const exists = normalized.some(member => (member.email || '').toLowerCase() === currentEmail.toLowerCase())
        if (!exists) {
          normalized.push({
            user_id: currentUser?.user_id || currentUser?.userId || currentUser?.sub || '',
            email: currentEmail,
            name: currentUser?.name || currentUser?.displayName || currentEmail,
          })
        }
      }
    } catch {}

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
  const refreshButton = document.getElementById('teamRefresh')
  const resetButton = document.getElementById('teamResetApp')
  const teamMembersList = document.getElementById('teamMembersListTeamPage')
  const teamStatusSection = document.querySelector('.team-status-controls')
  const teamAdminSection = document.querySelector('.team-admin')
  const statusUser = document.getElementById('sharedStatusUser')
  const statusEmail = document.getElementById('sharedStatusEmail')

  setHidden(refreshButton, false)
  setHidden(resetButton, false)

  if (teamStatusSection) setHidden(teamStatusSection, false)
  if (adminLists) setHidden(adminLists, true)

  const authContext = getAuthContext()
  const user = authContext?.user || {}
  const role = resolveAuthRole(user)
  setText(statusUser, user?.displayName || user?.name || user?.email || '—')
  setText(statusEmail, user?.email || '—')

  if (!statusEl) return
  let baseStatus = ''
  if (!authContext?.isReady) {
    baseStatus = 'Tjekker login…'
  } else if (!authContext?.isAuthenticated) {
    baseStatus = 'Log ind for at se teaminformation.'
  } else {
    baseStatus = 'Auth0 klar'
  }
  setText(statusEl, baseStatus)

  const isAdmin = isPrivilegedRole(role)
  if (adminLists) setHidden(adminLists, !isAdmin)
  if (teamAdminSection) setHidden(teamAdminSection, !isAdmin)
  if (isAdmin) renderMembers(teamMembersList, statusEl, baseStatus)
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
