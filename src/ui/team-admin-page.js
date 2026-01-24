import { getAuthContext } from '../../js/shared-auth.js'
import { getToken } from '../auth/auth0-client.js'
import { getState as getSessionState, onChange as onSessionChange } from '../auth/session.js'
import { getDeployContext } from '../lib/deploy-context.js'
import { getUserOrgId, getUserSub } from '../lib/auth0-user.js'
import { registerTeamMemberOnce } from '../services/team-members.js'
import { DEFAULT_TEAM_SLUG, formatTeamId } from '../services/team-ids.js'
import { resetAppState } from '../utils/reset-app.js'

// Auth0-first:
// - Team + roller styres i Auth0 (Organizations + Roles/Permissions)
// - Postgres gemmer medlemsrækker, men Auth0 claims er autoritative
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
    const error = new Error(message)
    if (payload?.code) {
      error.code = payload.code
    }
    throw error
  }
  return normalizeMembersPayload(payload)
}

let membersPromise = null
let membersKey = ''
let memberRegistrationKey = ''
let memberRegistrationStatus = 'idle'
let memberRegistrationMessage = ''

function setRegistrationState (status, message = '') {
  memberRegistrationStatus = status
  memberRegistrationMessage = message || ''
}

function describeRegistrationError (error, deployContext) {
  const message = (error?.message || '').toString()
  const normalized = message.toLowerCase()
  if (error?.code === 'preview-disabled' || normalized.includes('writes disabled in preview deployments')) {
    return 'Writes er slået fra i deploy preview (deploy-preview/branch deploy). Åbn production-linket for at kunne dele.'
  }
  if (error?.status === 401) return 'Login er udløbet. Log ind igen.'
  if (error?.status === 403) return 'Du har ikke rettigheder til at registrere medlemmet.'
  if (!deployContext?.hostname) return error?.message || 'Kunne ikke registrere medlem.'
  return error?.message || 'Kunne ikke registrere medlem.'
}

async function renderMembers (membersListEl, statusEl, baseStatus = '', teamId, { shouldRefresh = false, user = null, role = '' } = {}) {
  if (!membersListEl) return
  membersListEl.textContent = ''
  if (shouldRefresh) {
    membersPromise = null
    memberRegistrationKey = ''
    setRegistrationState('idle', '')
  }
  if (!membersPromise) {
    const resolvedTeamId = formatTeamId(teamId || DEFAULT_TEAM_SLUG)
    const currentUser = user || getAuthContext()?.user || null
    const deployContext = getDeployContext()
    const sub = getUserSub(currentUser)
    const orgId = getUserOrgId(currentUser)
    const registrationKey = `${resolvedTeamId}:${sub}:${role}:${orgId}`

    if (sub && registrationKey !== memberRegistrationKey) {
      memberRegistrationKey = registrationKey
      setRegistrationState('loading', 'Registrerer medlem…')
      try {
        await registerTeamMemberOnce({ teamId: resolvedTeamId, user: currentUser, role, orgId })
        setRegistrationState('ok', 'Connected til Auth0 (medlem registreret).')
      } catch (error) {
        const message = describeRegistrationError(error, deployContext)
        const status = error?.code === 'preview-disabled' ? 'preview-disabled' : 'error'
        setRegistrationState(status, message)
      }
    } else if (!sub) {
      setRegistrationState('error', 'Auth0 sub mangler – kan ikke registrere medlem.')
    }

    membersPromise = fetchTeamMembers(resolvedTeamId).finally(() => {
      membersPromise = null
    })
  }
  try {
    const loadingMessage = memberRegistrationStatus === 'loading' ? memberRegistrationMessage : 'Henter medlemmer…'
    setText(statusEl, loadingMessage)
    const members = await membersPromise
    membersListEl.textContent = ''
    const normalized = members.map(member => ({
      userSub: member?.userSub || member?.user_sub || member?.id || member?.uid || '',
      email: member?.email || '',
      name: member?.displayName || member?.display_name || member?.name || '',
    }))

    if (!normalized.length) {
      const empty = document.createElement('p')
      empty.className = 'hint'
      empty.textContent = 'Ingen medlemmer fundet.'
      membersListEl.appendChild(empty)
    } else {
      normalized.forEach(member => membersListEl.appendChild(buildMemberRow(member)))
    }
    const statusMessage = memberRegistrationMessage || baseStatus
    setText(statusEl, statusMessage)
  } catch (error) {
    membersListEl.textContent = ''
    const isDbNotMigrated = error?.code === 'DB_NOT_MIGRATED'
    if (!isDbNotMigrated) {
      const errorEl = document.createElement('p')
      errorEl.className = 'status-message'
      errorEl.textContent = error?.message || 'Kunne ikke hente medlemmer.'
      membersListEl.appendChild(errorEl)
    }
    if (isDbNotMigrated) {
      setText(statusEl, error?.message || '')
      return
    }
    const statusMessage = memberRegistrationStatus === 'error' || memberRegistrationStatus === 'preview-disabled'
      ? memberRegistrationMessage
      : baseStatus
    setText(statusEl, statusMessage)
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
  const deployContext = getDeployContext()
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
  setText(connectedAuth0, authContext?.isReady ? (deployContext.isPreview ? `klar (${deployContext.context})` : 'klar') : 'venter')
  setText(connectedOrg, authContext?.user?.orgId || '–')
  setText(connectedTeam, teamId || '–')
  const displayRole = isAuthed ? (state?.role || (isAdmin ? 'admin' : 'member')) : ''
  setText(connectedRole, displayRole || '–')

  if (isAuthed) {
    const key = `${teamId}:${getUserSub(user)}:${displayRole}`
    const shouldRefresh = key !== membersKey
    membersKey = key
    renderMembers(teamMembersList, statusEl, baseStatus, teamId, {
      shouldRefresh,
      user,
      role: displayRole,
    })
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
