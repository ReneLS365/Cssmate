import { onChange as onSessionChange, refreshAccess, requestBootstrapAccess, getState as getSessionState, SESSION_STATUS } from '../auth/session.js'
import { isAdminEmail } from '../auth/roles.js'
import { APP_VERSION, GIT_SHA } from '../version.js'
import { DEFAULT_TEAM_SLUG, formatTeamId, getDisplayTeamId } from '../services/team-ids.js'
import { migrateMemberDocIfNeeded } from '../services/teams.js'
import { resetAppState } from '../utils/reset-app.js'
import { APP_CHECK_REASON, APP_CHECK_STATUS } from '../../js/shared-auth.js'
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
let bootstrapButton
let resetButton
let debugEl
let tabPanelsEl
let initialized = false
let pendingRetry = null

function ensureElements () {
  if (guardEl) return
  tabPanelsEl = document.querySelector('[data-tab-panels]')
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
    <div class="app-guard__actions">
      <button type="button" id="appGuardRetry">Prøv igen</button>
      <button type="button" id="appGuardBootstrap" data-role="primary">Opret adgang i team</button>
    </div>
    <div class="app-guard__meta">
      <button type="button" id="appGuardReset" class="app-guard__reset">Nulstil app</button>
      <p class="app-guard__debug" id="appGuardDebug"></p>
    </div>
  `
  const main = document.getElementById('main') || tabPanelsEl?.parentElement || document.body
  if (main && typeof main.insertBefore === 'function') {
    main.insertBefore(guardEl, tabPanelsEl || main.firstChild)
  } else if (document.body && typeof document.body.appendChild === 'function') {
    document.body.appendChild(guardEl)
  }
  statusEl = guardEl.querySelector('#appGuardStatus')
  messageEl = guardEl.querySelector('#appGuardMessage')
  teamEl = guardEl.querySelector('#appGuardTeam')
  uidEl = guardEl.querySelector('#appGuardUid')
  emailEl = guardEl.querySelector('#appGuardEmail')
  retryButton = guardEl.querySelector('#appGuardRetry')
  bootstrapButton = guardEl.querySelector('#appGuardBootstrap')
  resetButton = guardEl.querySelector('#appGuardReset')
  debugEl = guardEl.querySelector('#appGuardDebug')
  retryButton?.addEventListener('click', () => scheduleRetry())
  bootstrapButton?.addEventListener('click', () => triggerBootstrap())
  resetButton?.addEventListener('click', () => resetAppState({ reload: true }))
}

function setVisible (visible, hidePanels = true) {
  ensureElements()
  guardEl.hidden = !visible
  if (tabPanelsEl) {
    if (hidePanels && visible) {
      tabPanelsEl.setAttribute('hidden', '')
      tabPanelsEl.setAttribute('aria-hidden', 'true')
    } else {
      tabPanelsEl.removeAttribute('hidden')
      tabPanelsEl.setAttribute('aria-hidden', 'false')
    }
  }
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
  const accessStatus = state?.accessStatus || (membershipStatus === 'member' ? TEAM_ACCESS_STATUS.OK : TEAM_ACCESS_STATUS.CHECKING)
  const teamId = formatTeamId(state?.teamId || state?.membershipCheckTeamId || DEFAULT_TEAM_SLUG)
  const displayTeam = getDisplayTeamId(teamId)
  const userEmail = state?.user?.email || ''
  const messageFallback = state?.message || (accessStatus === TEAM_ACCESS_STATUS.NO_ACCESS
    ? `Du er logget ind, men har ikke adgang til ${displayTeam}. Kontakt admin.`
    : accessStatus === TEAM_ACCESS_STATUS.NEED_CREATE
      ? 'Teamet findes ikke. Opret det eller vælg et andet team.'
      : 'Adgang er midlertidigt låst.')
  const errorCode = state?.accessError?.code || state?.error?.code || ''

  let statusLabel = 'Tjekker adgang'
  if (accessStatus === TEAM_ACCESS_STATUS.OK) statusLabel = 'Adgang givet'
  else if (accessStatus === TEAM_ACCESS_STATUS.NO_ACCESS) statusLabel = 'Ingen team-adgang'
  else if (accessStatus === TEAM_ACCESS_STATUS.NEED_CREATE) statusLabel = 'Team mangler'
  else if (accessStatus === TEAM_ACCESS_STATUS.ERROR) statusLabel = 'Adgangsfejl'
  statusEl.textContent = statusLabel

  if (accessStatus === TEAM_ACCESS_STATUS.CHECKING || membershipStatus === 'loading') {
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
  if (retryButton) retryButton.disabled = accessStatus === TEAM_ACCESS_STATUS.CHECKING || membershipStatus === 'loading'
  if (bootstrapButton) {
    const showBootstrap = Boolean(state?.bootstrapAvailable || isAdminEmail(userEmail))
    bootstrapButton.hidden = !showBootstrap
    bootstrapButton.disabled = !showBootstrap || accessStatus === TEAM_ACCESS_STATUS.CHECKING || membershipStatus === 'loading'
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
  const membershipStatus = state.membershipStatus || 'loading'
  const isActiveMember = membershipStatus === 'member' && state.memberActive !== false && state.sessionReady
  const hidePanels = (state?.accessStatus || membershipStatus) === 'checking' || membershipStatus === 'loading'

  if (isActiveMember) {
    setVisible(false)
    return
  }

  setVisible(true, hidePanels)
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
