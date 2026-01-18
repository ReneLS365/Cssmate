import { onChange as onSessionChange, refreshAccess, getState as getSessionState, SESSION_STATUS } from '../auth/session.js'
import { APP_VERSION, GIT_SHA } from '../version.js'
import { DEFAULT_TEAM_SLUG, formatTeamId, getDisplayTeamId } from '../services/team-ids.js'
import { resetAppState } from '../utils/reset-app.js'
import { logoutUser } from '../../js/shared-auth.js'
import { TEAM_ACCESS_STATUS } from '../services/team-access.js'

const RETRY_DEBOUNCE_MS = 350
let guardEl
let statusEl
let messageEl
let emailEl
let retryButton
let logoutButton
let resetButton
let debugEl
let mountEl
let initialized = false
let pendingRetry = null

function ensureElements () {
  if (guardEl) return
  // Mount guard only in the Team tab's dedicated mount point
  mountEl = document.getElementById('teamGuardMount')
  if (!mountEl) return

  guardEl = document.createElement('section')
  guardEl.id = 'appAccessGuard'
  guardEl.className = 'card app-guard'
  guardEl.hidden = true
  guardEl.innerHTML = `
    <div class="app-guard__status" id="appGuardStatus" aria-live="polite"></div>
    <p class="app-guard__message" id="appGuardMessage"></p>
    <dl class="app-guard__details">
      <div><dt>Email</dt><dd id="appGuardEmail"></dd></div>
    </dl>
    <div class="app-guard__actions">
      <button type="button" id="appGuardRetry">Opdater adgang</button>
      <button type="button" id="appGuardLogout">Log ud</button>
    </div>
    <div class="app-guard__meta">
      <button type="button" id="appGuardReset" class="app-guard__reset">Nulstil app</button>
      <p class="app-guard__debug" id="appGuardDebug"></p>
    </div>
  `
  mountEl.appendChild(guardEl)
  statusEl = guardEl.querySelector('#appGuardStatus')
  messageEl = guardEl.querySelector('#appGuardMessage')
  emailEl = guardEl.querySelector('#appGuardEmail')
  retryButton = guardEl.querySelector('#appGuardRetry')
  logoutButton = guardEl.querySelector('#appGuardLogout')
  resetButton = guardEl.querySelector('#appGuardReset')
  debugEl = guardEl.querySelector('#appGuardDebug')
  retryButton?.addEventListener('click', () => scheduleRetry())
  resetButton?.addEventListener('click', () => resetAppState({ reload: true }))
  logoutButton?.addEventListener('click', () => logoutUser().catch(() => {}))

  // Hide the guard's logout button to avoid showing two logout buttons in the Team tab.
  // The Team status card elsewhere in the UI already contains the primary logout control.
  if (logoutButton) {
    logoutButton.hidden = true
    logoutButton.setAttribute('aria-hidden', 'true')
  }
}

function isTeamTabActive () {
  const panel = mountEl?.closest?.('[data-tab-panel="team"]') || document.getElementById('panel-team')
  if (!panel) return false
  if (panel.hasAttribute('hidden') || panel.getAttribute('aria-hidden') === 'true') return false
  return panel.classList.contains('tab-panel--active') || !panel.hasAttribute('hidden')
}

function setVisible (visible) {
  ensureElements()
  if (!guardEl) return
  guardEl.hidden = !visible
  // Note: We no longer hide/show tab panels globally - guard is now scoped to Team tab only
}

function scheduleRetry () {
  if (pendingRetry) return
  pendingRetry = setTimeout(() => {
    pendingRetry = null
    refreshAccess().catch(error => {
      console.warn('Membership refresh fejlede', error)
    })
  }, RETRY_DEBOUNCE_MS)
}

function updateGuardContent (state) {
  const membershipStatus = state?.membershipStatus || 'loading'
  const accessStatus = state?.accessStatus || (membershipStatus === 'member' ? TEAM_ACCESS_STATUS.OK : TEAM_ACCESS_STATUS.LOADING)
  const teamId = formatTeamId(state?.teamId || state?.membershipCheckTeamId || DEFAULT_TEAM_SLUG)
  const displayTeam = getDisplayTeamId(teamId)
  const userEmail = state?.user?.email || ''
  const messageFallback = state?.message || (() => {
    if (accessStatus === TEAM_ACCESS_STATUS.NO_ACCESS) return `Du er logget ind, men har ikke adgang til ${displayTeam}. Kontakt admin.`
    if (accessStatus === TEAM_ACCESS_STATUS.NO_TEAM) return 'Teamet findes ikke. Opret det eller vælg et andet team.'
    if (accessStatus === TEAM_ACCESS_STATUS.NO_AUTH) return 'Log ind for at fortsætte.'
    return 'Adgang er midlertidigt låst.'
  })()
  const errorCode = state?.accessError?.code || state?.error?.code || ''
  const isLoading = accessStatus === TEAM_ACCESS_STATUS.LOADING || membershipStatus === 'loading'

  let statusLabel = 'Tjekker adgang'
  if (accessStatus === TEAM_ACCESS_STATUS.OK) statusLabel = 'Adgang givet'
  else if (accessStatus === TEAM_ACCESS_STATUS.NO_ACCESS) statusLabel = 'Ingen team-adgang'
  else if (accessStatus === TEAM_ACCESS_STATUS.NO_TEAM) statusLabel = 'Team mangler'
  else if (accessStatus === TEAM_ACCESS_STATUS.NO_AUTH) statusLabel = 'Log ind for adgang'
  else if (accessStatus === TEAM_ACCESS_STATUS.ERROR) statusLabel = 'Adgangsfejl'
  statusEl.textContent = statusLabel

  if (isLoading) {
    messageEl.textContent = 'Tjekker team-adgang…'
  } else if (state?.memberActive === false) {
    messageEl.textContent = 'Din konto er deaktiveret. Kontakt administrator.'
  } else {
    const combined = errorCode && accessStatus !== TEAM_ACCESS_STATUS.OK
      ? `${messageFallback} (${errorCode})`
      : messageFallback
    messageEl.textContent = combined
  }

  emailEl.textContent = userEmail || '–'
  if (retryButton) retryButton.disabled = isLoading
  if (debugEl) {
    const swStatus = (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) ? 'aktiv' : 'ingen'
    debugEl.textContent = `Version: ${APP_VERSION} ${GIT_SHA} — SW: ${swStatus} — TeamID: ${teamId || 'ukendt'}`
  }
}

function updateView (state) {
  if (!state || state.status === SESSION_STATUS.SIGNED_OUT || !state.user) {
    setVisible(false)
    return
  }
  ensureElements()
  if (!guardEl) return // Guard not mounted (no teamGuardMount element)
  if (!isTeamTabActive()) {
    setVisible(false)
    return
  }

  const membershipStatus = state.membershipStatus || 'loading'
  const accessStatus = state.accessStatus || TEAM_ACCESS_STATUS.LOADING
  const isReady = Boolean(state.sessionReady && accessStatus === TEAM_ACCESS_STATUS.OK)

  if (isReady) {
    setVisible(false)
    return
  }

  // Show guard in Team tab only, but don't block other tabs
  setVisible(true)
  updateGuardContent(state)
}

export function initAppGuard () {
  if (initialized) return
  initialized = true
  ensureElements()
  updateView(getSessionState())
  onSessionChange(updateView)
}
