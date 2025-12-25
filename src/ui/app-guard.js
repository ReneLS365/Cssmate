import { onChange as onSessionChange, refreshAccess, requestBootstrapAccess, getState as getSessionState, setPreferredTeamId, SESSION_STATUS } from '../auth/session.js'
import { isAdminEmail } from '../auth/roles.js'
import { APP_VERSION, GIT_SHA } from '../version.js'
import { DEFAULT_TEAM_SLUG, formatTeamId, getDisplayTeamId } from '../services/team-ids.js'
import { migrateMemberDocIfNeeded } from '../services/teams.js'
import { resetAppState } from '../utils/reset-app.js'
import { APP_CHECK_REASON, APP_CHECK_STATUS } from '../../js/shared-auth.js'
import { logoutUser } from '../../js/shared-auth.js'
import { TEAM_ACCESS_STATUS } from '../services/team-access.js'

const RETRY_DEBOUNCE_MS = 350
const migrationAttempts = new Set()

let guardEl
let statusEl
let messageEl
let teamEl
let uidEl
let emailEl
let retryButton
let switchTeamButton
let logoutButton
let bootstrapButton
let resetButton
let teamInput
let teamSaveButton
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
      <div><dt>Team</dt><dd id="appGuardTeam"></dd></div>
      <div><dt>UID</dt><dd id="appGuardUid"></dd></div>
      <div><dt>Email</dt><dd id="appGuardEmail"></dd></div>
    </dl>
    <div class="app-guard__team">
      <label for="appGuardTeamInput">Team ID</label>
      <div class="app-guard__team-row">
        <input type="text" id="appGuardTeamInput" inputmode="text" autocomplete="organization" placeholder="f.eks. hulmose">
        <button type="button" id="appGuardTeamSave">Gem</button>
      </div>
    </div>
    <div class="app-guard__actions">
      <button type="button" id="appGuardRetry">Opdater adgang</button>
      <button type="button" id="appGuardSwitch">Skift team</button>
      <button type="button" id="appGuardBootstrap" data-role="primary">Opret adgang i team</button>
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
  teamEl = guardEl.querySelector('#appGuardTeam')
  uidEl = guardEl.querySelector('#appGuardUid')
  emailEl = guardEl.querySelector('#appGuardEmail')
  retryButton = guardEl.querySelector('#appGuardRetry')
  switchTeamButton = guardEl.querySelector('#appGuardSwitch')
  logoutButton = guardEl.querySelector('#appGuardLogout')
  bootstrapButton = guardEl.querySelector('#appGuardBootstrap')
  resetButton = guardEl.querySelector('#appGuardReset')
  teamInput = guardEl.querySelector('#appGuardTeamInput')
  teamSaveButton = guardEl.querySelector('#appGuardTeamSave')
  debugEl = guardEl.querySelector('#appGuardDebug')
  retryButton?.addEventListener('click', () => scheduleRetry())
  bootstrapButton?.addEventListener('click', () => triggerBootstrap())
  resetButton?.addEventListener('click', () => resetAppState({ reload: true }))
  switchTeamButton?.addEventListener('click', () => {
    setVisible(true)
    if (typeof window !== 'undefined' && typeof window.__cssmateSetActiveTab === 'function') {
      window.__cssmateSetActiveTab('team', { focus: true })
    }
    teamInput?.focus()
  })
  logoutButton?.addEventListener('click', () => logoutUser().catch(() => {}))
  teamSaveButton?.addEventListener('click', async () => {
    const value = formatTeamId(teamInput?.value || '')
    if (!value) {
      messageEl.textContent = 'Angiv et Team ID først.'
      return
    }
    teamSaveButton.disabled = true
    try {
      setPreferredTeamId(value)
      await refreshAccess()
    } finally {
      teamSaveButton.disabled = false
    }
  })
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

async function triggerBootstrap () {
  if (!bootstrapButton) return
  bootstrapButton.disabled = true
  try {
    await requestBootstrapAccess()
    await refreshAccess()
  } catch (error) {
    console.warn('Bootstrap fejlede', error)
  } finally {
    bootstrapButton.disabled = false
  }
}

async function maybeMigrateMemberDoc (state) {
  if (!state?.user?.uid || !isAdminEmail(state.user.email)) return
  if (state.membershipStatus !== 'not_member') return
  const fallbackTeamId = formatTeamId(state?.membershipCheckTeamId || state?.teamId || DEFAULT_TEAM_SLUG)
  const key = `${state.user.uid}:${fallbackTeamId}`
  if (migrationAttempts.has(key)) return
  migrationAttempts.add(key)
  try {
    const result = await migrateMemberDocIfNeeded(fallbackTeamId, state.user)
    if (result?.created) {
      scheduleRetry()
    }
  } catch (error) {
    console.warn('Kunne ikke migrere medlemsdoc', error)
  }
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

  teamEl.textContent = displayTeam
  uidEl.textContent = state?.user?.uid || '–'
  emailEl.textContent = userEmail || '–'
  if (teamInput) teamInput.value = displayTeam
  if (retryButton) retryButton.disabled = isLoading
  if (teamSaveButton) teamSaveButton.disabled = isLoading
  if (switchTeamButton) switchTeamButton.disabled = isLoading
  if (bootstrapButton) {
    const showBootstrap = Boolean(state?.bootstrapAvailable && accessStatus === TEAM_ACCESS_STATUS.NO_TEAM)
    bootstrapButton.hidden = !showBootstrap
    bootstrapButton.disabled = !showBootstrap || isLoading
  }
  if (debugEl) {
    const swStatus = (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) ? 'aktiv' : 'ingen'
    const appCheckState = APP_CHECK_STATUS || 'off'
    const appCheckInfo = APP_CHECK_REASON ? `${appCheckState} (${APP_CHECK_REASON})` : appCheckState
    debugEl.textContent = `Version: ${APP_VERSION} ${GIT_SHA} — SW: ${swStatus} — TeamID: ${teamId || 'ukendt'} — AppCheck: ${appCheckInfo}`
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
  maybeMigrateMemberDoc(state)
}

export function initAppGuard () {
  if (initialized) return
  initialized = true
  ensureElements()
  updateView(getSessionState())
  onSessionChange(updateView)
}
