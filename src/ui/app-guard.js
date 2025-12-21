import { onChange as onSessionChange, refreshAccess, requestBootstrapAccess, getState as getSessionState, SESSION_STATUS } from '../auth/session.js'
import { isAdminEmail } from '../auth/roles.js'
import { DEFAULT_TEAM_SLUG, formatTeamId, getDisplayTeamId } from '../services/team-ids.js'
import { migrateMemberDocIfNeeded } from '../services/teams.js'

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
  retryButton?.addEventListener('click', () => scheduleRetry())
  bootstrapButton?.addEventListener('click', () => triggerBootstrap())
}

function setVisible (visible) {
  ensureElements()
  guardEl.hidden = !visible
  if (tabPanelsEl) {
    tabPanelsEl.toggleAttribute('hidden', visible)
    tabPanelsEl.setAttribute('aria-hidden', visible ? 'true' : 'false')
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
  const teamId = formatTeamId(state?.teamId || state?.membershipCheckTeamId || DEFAULT_TEAM_SLUG)
  const displayTeam = getDisplayTeamId(teamId)
  const userEmail = state?.user?.email || ''
  const messageFallback = membershipStatus === 'not_member'
    ? `Du er ikke tilføjet til ${displayTeam}. Kontakt admin.`
    : (state?.message || 'Adgang er midlertidigt låst.')

  statusEl.textContent = membershipStatus === 'member'
    ? 'Adgang givet'
    : membershipStatus === 'not_member'
      ? 'Ingen team-adgang'
      : 'Tjekker adgang'

  if (membershipStatus === 'loading') {
    messageEl.textContent = 'Tjekker team-adgang…'
  } else if (membershipStatus === 'error' && state?.memberActive === false) {
    messageEl.textContent = 'Din konto er deaktiveret. Kontakt administrator.'
  } else {
    messageEl.textContent = messageFallback
  }

  teamEl.textContent = displayTeam
  uidEl.textContent = state?.user?.uid || '–'
  emailEl.textContent = userEmail || '–'
  if (retryButton) retryButton.disabled = membershipStatus === 'loading'
  if (bootstrapButton) {
    const showBootstrap = isAdminEmail(userEmail)
    bootstrapButton.hidden = !showBootstrap
    bootstrapButton.disabled = !showBootstrap || membershipStatus === 'loading'
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

  if (isActiveMember) {
    setVisible(false)
    return
  }

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
