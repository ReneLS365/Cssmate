import { getAuthContext, onAuthStateChange, waitForAuthReady } from '../../js/shared-auth.js'
import {
  BOOTSTRAP_ADMIN_EMAIL,
  DEFAULT_TEAM_SLUG,
  InviteMissingError,
  InactiveMemberError,
  MembershipMissingError,
  guardTeamAccess,
  getDisplayTeamId,
  getStoredTeamId,
  persistTeamId,
  formatTeamId,
  normalizeTeamId,
} from '../../js/shared-ledger.js'
import { normalizeEmail } from './roles.js'
import { updateSessionDebugState } from '../state/debug.js'
import { markUserLoading, resetUserState, setUserLoadedState } from '../state/user-store.js'

const SESSION_STATUS = {
  SIGNED_OUT: 'signedOut',
  SIGNING_IN: 'signingIn',
  NO_ACCESS: 'signedIn_noAccess',
  MEMBER: 'signedIn_member',
  ADMIN: 'signedIn_admin',
  ERROR: 'error',
}

let initialized = false
let preferredTeamSlug = normalizeTeamId(getStoredTeamId() || DEFAULT_TEAM_SLUG)
let accessInFlight = null
const listeners = new Set()
const waiters = new Set()
const TEAM_LOCK_KEY = 'sscaff.team.locked'
let teamLockedFlag = loadTeamLock()

function loadTeamLock () {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage?.getItem(TEAM_LOCK_KEY) === '1'
  } catch {
    return false
  }
}

function persistTeamLock (locked) {
  if (typeof window === 'undefined') return
  try {
    if (locked) window.localStorage?.setItem(TEAM_LOCK_KEY, '1')
    else window.localStorage?.removeItem(TEAM_LOCK_KEY)
  } catch {}
}

let sessionState = buildState({
  status: SESSION_STATUS.SIGNING_IN,
  message: 'Login initialiseres…',
})

function buildState (overrides = {}) {
  const formattedTeam = formatTeamId(preferredTeamSlug)
  const baseState = {
    status: SESSION_STATUS.SIGNED_OUT,
    user: null,
    authReady: false,
    teamId: formattedTeam,
    displayTeamId: getDisplayTeamId(formattedTeam),
    role: null,
    member: null,
    invite: null,
    error: null,
    message: '',
    requiresVerification: false,
    providers: [],
    teamResolved: false,
    memberExists: false,
    memberActive: null,
    sessionReady: false,
    canChangeTeam: true,
    teamLocked: teamLockedFlag,
    bootstrapAvailable: false,
    hasAccess: false,
    ...overrides,
  }
  baseState.sessionReady = computeSessionReady(baseState)
  return baseState
}

function computeSessionReady (state = sessionState) {
  const status = state?.status
  const hasAccess = status === SESSION_STATUS.ADMIN || status === SESSION_STATUS.MEMBER
  const memberExists = typeof state?.memberExists === 'boolean'
    ? state.memberExists
    : Boolean(state?.member)
  const memberActive = state?.memberActive
  return Boolean(
    state?.authReady &&
    state?.user &&
    hasAccess &&
    !state?.requiresVerification &&
    state?.teamResolved &&
    memberExists &&
    memberActive !== false
  )
}

function notify () {
  listeners.forEach(listener => {
    try { listener({ ...sessionState }) } catch (error) { console.warn('Session listener fejl', error) }
  })
  resolveWaiters()
}

function setState (overrides) {
  const nextState = { ...sessionState, ...overrides }
  nextState.sessionReady = computeSessionReady(nextState)
  sessionState = nextState
  updateSessionDebugState(sessionState)
  notify()
  return sessionState
}

function resolveWaiters () {
  waiters.forEach(waiter => {
    const ok = satisfiesAccess(sessionState, waiter.requireAdmin)
    const failed = [SESSION_STATUS.NO_ACCESS, SESSION_STATUS.ERROR].includes(sessionState.status)
    if (ok) {
      waiter.resolve(sessionState)
      waiters.delete(waiter)
    } else if (failed) {
      waiter.reject(sessionState.error || new Error(sessionState.message || 'Ingen adgang'))
      waiters.delete(waiter)
    }
  })
}

function satisfiesAccess (state, requireAdmin = false) {
  if (!state) return false
  if (requireAdmin) return state.status === SESSION_STATUS.ADMIN
  return state.status === SESSION_STATUS.ADMIN || state.status === SESSION_STATUS.MEMBER
}

function canBootstrap (user, teamId) {
  return normalizeEmail(user?.email) === normalizeEmail(BOOTSTRAP_ADMIN_EMAIL)
    && normalizeTeamId(teamId || preferredTeamSlug) === normalizeTeamId(DEFAULT_TEAM_SLUG)
}

async function evaluateAccess ({ allowBootstrap = false } = {}) {
  const auth = getAuthContext()
  if (!auth?.isAuthenticated || !auth.user) {
    resetUserState()
    setState(buildState({ status: SESSION_STATUS.SIGNED_OUT, message: 'Log ind for at fortsætte' }))
    return null
  }

  const formattedTeam = formatTeamId(preferredTeamSlug)
  let displayTeamId = getDisplayTeamId(formattedTeam)

  setState({
    status: SESSION_STATUS.SIGNING_IN,
    message: 'Tjekker adgang…',
    teamId: formattedTeam,
    displayTeamId,
    error: null,
    bootstrapAvailable: false,
    teamResolved: false,
    memberExists: false,
    memberActive: null,
  })
  markUserLoading()

  if (accessInFlight) return accessInFlight

  accessInFlight = (async () => {
    try {
      const access = await guardTeamAccess(formattedTeam, auth.user, { allowBootstrap })
      const isAdmin = access.role === 'admin'
      const membership = access.membership
      const resolvedTeamId = formatTeamId(access.teamId || formattedTeam)
      preferredTeamSlug = normalizeTeamId(resolvedTeamId)
      persistTeamId(preferredTeamSlug)
      displayTeamId = getDisplayTeamId(resolvedTeamId)
      teamLockedFlag = !isAdmin
      persistTeamLock(teamLockedFlag)
      setUserLoadedState({
        uid: auth.user.uid || null,
        email: auth.user.email || '',
        displayName: auth.user.displayName || auth.user.name || '',
        teamId: resolvedTeamId,
        role: membership?.role || access.role,
      })
      return setState({
        status: isAdmin ? SESSION_STATUS.ADMIN : SESSION_STATUS.MEMBER,
        role: access.role,
        member: membership,
        invite: access.invite || null,
        error: null,
        message: '',
        hasAccess: true,
        teamId: resolvedTeamId,
        displayTeamId,
        canChangeTeam: isAdmin,
        teamLocked: teamLockedFlag,
        bootstrapAvailable: false,
        teamResolved: true,
        memberExists: Boolean(membership),
        memberActive: membership?.active !== false,
      })
    } catch (error) {
      const bootstrapAvailable = canBootstrap(auth.user, formattedTeam)
      const noAccessError = error instanceof InviteMissingError
        || error instanceof MembershipMissingError
        || error instanceof InactiveMemberError
      const status = noAccessError ? SESSION_STATUS.NO_ACCESS : SESSION_STATUS.ERROR
      const inactiveMember = error instanceof InactiveMemberError
      setUserLoadedState({
        uid: auth.user.uid || null,
        email: auth.user.email || '',
        displayName: auth.user.displayName || auth.user.name || '',
        teamId: '',
        role: '',
      })
      setState({
        status,
        role: null,
        member: null,
        invite: null,
        error,
        message: error?.message || 'Ingen adgang til teamet.',
        hasAccess: false,
        teamId: formattedTeam,
        displayTeamId,
        bootstrapAvailable: bootstrapAvailable && noAccessError,
        teamResolved: true,
        memberExists: inactiveMember ? true : false,
        memberActive: inactiveMember ? false : null,
      })
      throw error
    } finally {
      accessInFlight = null
    }
  })()

  return accessInFlight
}

function handleAuthChange (context) {
  const providers = Array.isArray(context?.providers)
    ? context.providers.map(entry => entry?.providerId || entry?.provider).filter(Boolean)
    : Array.isArray(context?.user?.providerData)
      ? context.user.providerData.map(entry => entry?.providerId || entry?.provider).filter(Boolean)
      : []
  const usesPassword = providers.includes('password')
  const authReady = Boolean(context?.isReady)

  if (!context?.isReady) {
    markUserLoading()
    setState(buildState({
      status: SESSION_STATUS.SIGNING_IN,
      message: context?.message || 'Login initialiseres…',
      providers,
      authReady,
      user: null,
      teamResolved: false,
      memberExists: false,
      memberActive: null,
    }))
    return
  }

  if (!context.isAuthenticated) {
    resetUserState()
    setState(buildState({
      status: SESSION_STATUS.SIGNED_OUT,
      message: context?.message || 'Log ind for at fortsætte',
      providers,
      authReady: true,
      user: null,
      teamResolved: false,
      memberExists: false,
      memberActive: null,
    }))
    return
  }

  const requiresVerification = Boolean(context.requiresVerification && usesPassword)
  const baseState = setState({
    authReady: true,
    user: context.user,
    providers,
    requiresVerification,
    status: requiresVerification ? SESSION_STATUS.SIGNING_IN : sessionState.status,
    message: requiresVerification ? 'Bekræft din email for at fortsætte' : 'Tjekker adgang…',
    teamResolved: false,
    memberExists: false,
    memberActive: null,
  })

  if (requiresVerification) {
    setUserLoadedState({
      uid: context.user?.uid || null,
      email: context.user?.email || '',
      displayName: context.user?.displayName || context.user?.name || '',
      teamId: '',
      role: '',
    })
    return baseState
  }
  markUserLoading()
  return evaluateAccess()
}

function initAuthSession () {
  if (initialized) return getSessionApi()
  initialized = true
  preferredTeamSlug = normalizeTeamId(preferredTeamSlug || DEFAULT_TEAM_SLUG)
  persistTeamId(preferredTeamSlug)
  waitForAuthReady()?.catch?.(() => {})
  onAuthStateChange(handleAuthChange)
  handleAuthChange(getAuthContext())
  return getSessionApi()
}

function onChange (callback) {
  if (typeof callback !== 'function') return () => {}
  listeners.add(callback)
  callback({ ...sessionState })
  return () => listeners.delete(callback)
}

function getState () {
  return { ...sessionState }
}

function getPreferredTeamId () {
  return preferredTeamSlug
}

function setPreferredTeamId (nextTeamId) {
  const normalized = normalizeTeamId(nextTeamId || preferredTeamSlug)
  const formatted = formatTeamId(normalized)
  if (teamLockedFlag && sessionState.role !== 'admin') {
    return sessionState
  }
  preferredTeamSlug = normalized
  persistTeamId(preferredTeamSlug)
  setState({
    teamId: formatted,
    displayTeamId: getDisplayTeamId(formatted),
    teamLocked: teamLockedFlag,
    teamResolved: false,
    memberExists: false,
    memberActive: null,
    status: SESSION_STATUS.SIGNING_IN,
  })
  if (sessionState.user) {
    evaluateAccess().catch(() => {})
  }
  return sessionState
}

function waitForAccess ({ requireAdmin = false } = {}) {
  if (!initialized) {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      sessionState = buildState({
        status: SESSION_STATUS.ADMIN,
        hasAccess: true,
        role: 'admin',
        authReady: true,
        user: sessionState.user || { uid: 'server', email: '' },
        teamResolved: true,
        memberExists: true,
        memberActive: true,
      })
      initialized = true
      return Promise.resolve({ ...sessionState })
    }
    initAuthSession()
  }
  if (typeof navigator === 'undefined') return Promise.resolve({ ...sessionState })
  if (satisfiesAccess(sessionState, requireAdmin)) return Promise.resolve({ ...sessionState })
  if ([SESSION_STATUS.NO_ACCESS, SESSION_STATUS.ERROR].includes(sessionState.status)) {
    return Promise.reject(sessionState.error || new Error(sessionState.message || 'Adgang afvist'))
  }
  return new Promise((resolve, reject) => {
    waiters.add({ resolve, reject, requireAdmin })
  })
}

async function requestBootstrapAccess () {
  const auth = getAuthContext()
  if (!canBootstrap(auth?.user, sessionState.teamId)) {
    throw new Error('Bootstrap er ikke tilladt for denne bruger.')
  }
  return evaluateAccess({ allowBootstrap: true })
}

function refreshAccess () {
  return evaluateAccess()
}

function getSessionApi () {
  return {
    getState,
    onChange,
    waitForAccess,
    setPreferredTeamId,
    getPreferredTeamId,
    requestBootstrapAccess,
    refreshAccess,
  }
}

export {
  initAuthSession,
  getState,
  onChange,
  waitForAccess,
  setPreferredTeamId,
  getPreferredTeamId,
  requestBootstrapAccess,
  refreshAccess,
  SESSION_STATUS,
}
