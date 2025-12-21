import { getAuthContext, onAuthStateChange, waitForAuthReady } from '../../js/shared-auth.js'
import { normalizeEmail } from './roles.js'
import { setLastFirestoreError, updateSessionDebugState } from '../state/debug.js'
import { markUserLoading, resetUserState, setUserLoadedState } from '../state/user-store.js'
import {
  BOOTSTRAP_ADMIN_EMAIL,
  DEFAULT_TEAM_SLUG,
  formatTeamId,
  getDisplayTeamId,
  getStoredTeamId,
  normalizeTeamId,
  persistTeamId,
} from '../services/team-ids.js'
import { buildMemberDocPath } from '../services/teams.js'
import { bootstrapTeamMembership, resolveTeamAccessWithTimeout } from '../services/team-access.js'

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
let accessRequestId = 0
const listeners = new Set()
const waiters = new Set()
const TEAM_LOCK_KEY = 'sscaff.team.locked'
let teamLockedFlag = loadTeamLock()
const BOOTSTRAP_FLAG_PREFIX = 'sscaff.bootstrapDone:'
const bootstrapMemory = new Set()

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

function hasBootstrapRun (uid) {
  if (!uid) return false
  if (bootstrapMemory.has(uid)) return true
  if (typeof window === 'undefined') return false
  try {
    const flag = window.sessionStorage?.getItem(`${BOOTSTRAP_FLAG_PREFIX}${uid}`)
    if (flag === '1') {
      bootstrapMemory.add(uid)
      return true
    }
  } catch {}
  return bootstrapMemory.has(uid)
}

function markBootstrapRun (uid) {
  if (!uid) return
  bootstrapMemory.add(uid)
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage?.setItem(`${BOOTSTRAP_FLAG_PREFIX}${uid}`, '1')
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
    membershipStatus: 'loading',
    membershipCheckPath: '',
    membershipCheckTeamId: '',
    accessStatus: 'checking',
    accessError: null,
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
  const membershipStatus = state?.membershipStatus
  return Boolean(
    state?.authReady &&
    state?.user &&
    hasAccess &&
    !state?.requiresVerification &&
    state?.teamResolved &&
    memberExists &&
    memberActive !== false &&
    membershipStatus === 'member'
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

function normalizeMemberDoc (memberDoc, teamId, uid) {
  if (!memberDoc) return null
  const normalizedTeamId = formatTeamId(memberDoc.teamId || teamId || preferredTeamSlug)
  const role = memberDoc.role === 'owner'
    ? 'owner'
    : (memberDoc.role === 'admin' ? 'admin' : 'member')
  return {
    ...memberDoc,
    uid: memberDoc.uid || uid || '',
    teamId: normalizedTeamId,
    role,
    active: memberDoc.active !== false,
  }
}

function resolveAccessMessage (accessStatus, displayTeamId, accessError, memberDoc) {
  if (accessStatus === 'ok') return ''
  if (accessStatus === 'no-membership') return `Du er ikke tilføjet til ${displayTeamId}. Kontakt admin.`
  if (accessStatus === 'denied' || memberDoc?.active === false) {
    return 'Din konto er deaktiveret. Kontakt administrator.'
  }
  if (accessError?.message) return accessError.message
  return 'Ingen adgang til teamet.'
}

async function evaluateAccess () {
  const auth = getAuthContext()
  if (!auth?.isAuthenticated || !auth.user) {
    resetUserState()
    setState(buildState({
      status: SESSION_STATUS.SIGNED_OUT,
      message: 'Log ind for at fortsætte',
      accessStatus: 'error',
      accessError: null,
    }))
    return null
  }

  const formattedTeam = formatTeamId(preferredTeamSlug)
  const displayTeamId = getDisplayTeamId(formattedTeam)
  const membershipPath = auth.user?.uid ? buildMemberDocPath(formattedTeam, auth.user.uid) : ''

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
    membershipStatus: 'loading',
    membershipCheckPath: membershipPath,
    membershipCheckTeamId: formattedTeam,
    accessStatus: 'checking',
    accessError: null,
  })
  markUserLoading()

  const requestId = ++accessRequestId
  const currentUser = auth.user

  const applyAccessResult = (accessResult) => {
    const accessStatus = accessResult?.status || 'error'
    const resolvedTeamId = formatTeamId(accessResult?.teamId || formattedTeam)
    const resolvedDisplayTeamId = getDisplayTeamId(resolvedTeamId)
    const accessError = accessResult?.error || null
    const member = normalizeMemberDoc(accessResult?.memberDoc, resolvedTeamId, currentUser?.uid)
    const memberExists = Boolean(member)
    const memberActive = memberExists ? member.active !== false : null
    const isOwner = Boolean(accessResult?.isOwner)
    const isAdmin = Boolean(accessStatus === 'ok' && (accessResult?.isAdmin || member?.role === 'admin' || member?.role === 'owner' || isOwner))
    const membershipStatus = accessStatus === 'ok'
      ? 'member'
      : accessStatus === 'no-membership'
        ? 'not_member'
        : 'error'
    const sessionStatus = membershipStatus === 'member'
      ? (isAdmin ? SESSION_STATUS.ADMIN : SESSION_STATUS.MEMBER)
      : (accessStatus === 'no-membership' || accessStatus === 'denied' ? SESSION_STATUS.NO_ACCESS : SESSION_STATUS.ERROR)
    const message = resolveAccessMessage(accessStatus, resolvedDisplayTeamId, accessError, member)
    const errorObject = accessStatus === 'ok'
      ? null
      : (accessError ? Object.assign(new Error(accessError.message || 'Ingen adgang'), { code: accessError.code }) : null)
    const memberPath = currentUser?.uid ? buildMemberDocPath(resolvedTeamId, currentUser.uid) : ''
    if (accessError?.code) {
      setLastFirestoreError(accessError, memberPath)
    }
    teamLockedFlag = !isAdmin
    persistTeamLock(teamLockedFlag)
    preferredTeamSlug = normalizeTeamId(resolvedTeamId)
    persistTeamId(preferredTeamSlug)
    if (membershipStatus === 'member') {
      setUserLoadedState({
        uid: currentUser?.uid || null,
        email: currentUser?.email || '',
        displayName: currentUser?.displayName || currentUser?.name || '',
        teamId: resolvedTeamId,
        role: member?.role || (isAdmin ? 'admin' : 'member'),
      })
    } else {
      setUserLoadedState({
        uid: currentUser?.uid || null,
        email: currentUser?.email || '',
        displayName: currentUser?.displayName || currentUser?.name || '',
        teamId: '',
        role: '',
      })
    }
    const bootstrapAvailable = membershipStatus === 'not_member'
      && canBootstrap(currentUser, resolvedTeamId)
      && !hasBootstrapRun(currentUser?.uid)
    return setState({
      status: sessionStatus,
      role: member?.role || (isAdmin ? 'admin' : null),
      member,
      invite: null,
      error: errorObject,
      message,
      hasAccess: membershipStatus === 'member',
      teamId: resolvedTeamId,
      displayTeamId: resolvedDisplayTeamId,
      canChangeTeam: isAdmin,
      teamLocked: teamLockedFlag,
      bootstrapAvailable,
      teamResolved: true,
      memberExists,
      memberActive,
      membershipStatus,
      membershipCheckPath: memberPath,
      membershipCheckTeamId: resolvedTeamId,
      accessStatus,
      accessError,
    })
  }

  const runPromise = (async () => {
    const accessResult = await resolveTeamAccessWithTimeout({ teamId: formattedTeam, user: currentUser })
    if (requestId !== accessRequestId) return sessionState
    return applyAccessResult(accessResult)
  })()

  accessInFlight = runPromise.finally(() => {
    if (accessInFlight === runPromise) accessInFlight = null
  })

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
      membershipStatus: 'loading',
      membershipCheckPath: '',
      membershipCheckTeamId: '',
      accessStatus: 'checking',
      accessError: null,
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
      membershipStatus: 'loading',
      membershipCheckPath: '',
      membershipCheckTeamId: '',
      accessStatus: 'checking',
      accessError: null,
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
    membershipStatus: 'loading',
    membershipCheckPath: buildMemberDocPath(formatTeamId(preferredTeamSlug), context.user?.uid || ''),
    membershipCheckTeamId: formatTeamId(preferredTeamSlug),
    accessStatus: 'checking',
    accessError: null,
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
  const memberPath = sessionState.user?.uid ? buildMemberDocPath(formatted, sessionState.user.uid) : ''
  setState({
    teamId: formatted,
    displayTeamId: getDisplayTeamId(formatted),
    teamLocked: teamLockedFlag,
    teamResolved: false,
    memberExists: false,
    memberActive: null,
    status: SESSION_STATUS.SIGNING_IN,
    membershipStatus: 'loading',
    membershipCheckPath: memberPath,
    membershipCheckTeamId: formatted,
    accessStatus: 'checking',
    accessError: null,
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
  const targetTeamId = formatTeamId(sessionState.teamId || preferredTeamSlug)
  if (!canBootstrap(auth?.user, targetTeamId)) {
    throw new Error('Bootstrap er ikke tilladt for denne bruger.')
  }
  await bootstrapTeamMembership({ teamId: targetTeamId, user: auth.user })
  markBootstrapRun(auth?.user?.uid)
  return refreshAccess()
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
