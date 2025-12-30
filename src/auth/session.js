import { getAuthContext, onAuthStateChange, waitForAuthReady } from '../../js/shared-auth.js'
import { normalizeEmail } from './roles.js'
import { isLighthouseMode } from '../config/lighthouse-mode.js'
import { setLastFirestoreError, updateSessionDebugState } from '../state/debug.js'
import { markUserLoading, resetUserState, setUserLoadedState } from '../state/user-store.js'
import { resolveMembershipStatus, resolveSessionStatus, SESSION_STATUS } from './access-state.js'
import {
  BOOTSTRAP_ADMIN_EMAIL,
  DEFAULT_TEAM_SLUG,
  formatTeamId,
  getDisplayTeamId,
  getStoredTeamId,
  normalizeTeamId,
  persistTeamId,
} from '../services/team-ids.js'
import { buildMemberDocPath, ensureUserDoc } from '../services/teams.js'
import { TEAM_ACCESS_STATUS, clearTeamAccessCache, createTeamWithMembership, getTeamAccessWithTimeout } from '../services/team-access.js'
import { teamDebug } from '../utils/team-debug.js'

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
  status: SESSION_STATUS.SIGNED_OUT,
  message: 'Log ind for at fortsætte',
  accessStatus: TEAM_ACCESS_STATUS.NO_AUTH,
  accessError: null,
  accessDetail: null,
  memberAssigned: null,
  membershipStatus: 'idle',
  authReady: false,
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
    accessDetail: null,
    requiresVerification: false,
    providers: [],
    teamResolved: false,
    memberExists: false,
    memberActive: null,
    memberAssigned: null,
    membershipStatus: 'idle',
    membershipCheckPath: '',
    membershipCheckTeamId: '',
    accessStatus: TEAM_ACCESS_STATUS.NO_AUTH,
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
  const memberAssigned = state?.memberAssigned
  const membershipStatus = state?.membershipStatus
  return Boolean(
    state?.authReady &&
    state?.user &&
    hasAccess &&
    !state?.requiresVerification &&
    state?.teamResolved &&
    memberExists &&
    memberActive !== false &&
    memberAssigned !== false &&
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
    assigned: memberDoc.assigned === true,
  }
}

function resolveAccessMessage (accessStatus, displayTeamId, accessError, memberDoc, accessDetail) {
  if (accessStatus === TEAM_ACCESS_STATUS.OK) return ''
  if (accessStatus === TEAM_ACCESS_STATUS.NO_TEAM || accessStatus === TEAM_ACCESS_STATUS.NEED_CREATE) return 'Teamet findes ikke. Opret det eller vælg et andet team.'
  if (accessStatus === TEAM_ACCESS_STATUS.NO_AUTH || accessStatus === TEAM_ACCESS_STATUS.SIGNED_OUT) return 'Log ind for at fortsætte.'
  if (accessStatus === TEAM_ACCESS_STATUS.NO_ACCESS || accessStatus === TEAM_ACCESS_STATUS.DENIED) {
    if (memberDoc?.active === false || accessDetail?.reason === 'inactive') return 'Din konto er deaktiveret. Kontakt administrator.'
    if (accessDetail?.reason === 'not-assigned') return 'Du er ikke tildelt dette team. Kontakt admin.'
    return `Du er logget ind, men har ikke adgang til ${displayTeamId}. Kontakt admin.`
  }
  if (accessStatus === TEAM_ACCESS_STATUS.ERROR) {
    if (accessError?.code === 'offline') return 'Du er offline. Tjek netværket og prøv igen.'
    if (accessError?.code === 'deadline-exceeded' || accessError?.code === 'timeout') return 'Adgangstjek tog for lang tid. Prøv igen.'
    if (accessError?.message) return accessError.message
  }
  return 'Ingen adgang til teamet.'
}

async function evaluateAccess () {
  const auth = getAuthContext()
  if (!auth?.isAuthenticated || !auth.user) {
    resetUserState()
    setState(buildState({
      status: SESSION_STATUS.SIGNED_OUT,
      message: 'Log ind for at fortsætte',
      accessStatus: TEAM_ACCESS_STATUS.NO_AUTH,
      accessError: null,
      accessDetail: null,
      membershipStatus: 'no_auth',
      memberAssigned: null,
    }))
    return null
  }

  try {
    await ensureUserDoc(auth.user)
  } catch (error) {
    console.warn('Kunne ikke oprette brugerprofil', error)
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
    memberAssigned: null,
    membershipStatus: 'loading',
    membershipCheckPath: membershipPath,
    membershipCheckTeamId: formattedTeam,
    accessStatus: TEAM_ACCESS_STATUS.CHECKING,
    accessError: null,
    accessDetail: null,
  })
  markUserLoading()

  const requestId = ++accessRequestId
  const currentUser = auth.user

  const applyAccessResult = (accessResult) => {
    const accessStatus = accessResult?.status || TEAM_ACCESS_STATUS.ERROR
    const resolvedTeamId = formatTeamId(accessResult?.teamId || formattedTeam)
    const resolvedDisplayTeamId = getDisplayTeamId(resolvedTeamId)
    const accessError = accessResult?.error || null
    const member = normalizeMemberDoc(accessResult?.memberDoc, resolvedTeamId, currentUser?.uid)
    const owner = Boolean(accessResult?.owner || member?.role === 'owner')
    const role = owner ? 'owner' : (member?.role || accessResult?.role || '')
    const memberExists = Boolean(owner || member)
    const memberActive = memberExists ? (owner ? true : member?.active !== false) : null
    const memberAssigned = memberExists ? (owner ? true : accessResult?.assigned !== false && member?.assigned !== false) : null
    const isAdmin = Boolean(owner || role === 'admin')
    const membershipStatus = resolveMembershipStatus(accessStatus)
    const sessionStatus = resolveSessionStatus(accessStatus, isAdmin, membershipStatus)
    const message = resolveAccessMessage(accessStatus, resolvedDisplayTeamId, accessError, member, accessResult)
    const errorObject = accessStatus === TEAM_ACCESS_STATUS.OK
      ? null
      : (accessError ? Object.assign(new Error(accessError.message || 'Ingen adgang'), { code: accessError.code }) : null)
    const memberPath = currentUser?.uid ? buildMemberDocPath(resolvedTeamId, currentUser.uid) : ''
    if (accessError?.code) {
      setLastFirestoreError(accessError, memberPath)
    }
    const lockTeam = accessStatus === TEAM_ACCESS_STATUS.OK ? !isAdmin : false
    teamLockedFlag = lockTeam
    persistTeamLock(teamLockedFlag)
    preferredTeamSlug = normalizeTeamId(resolvedTeamId)
    persistTeamId(preferredTeamSlug)
    if (membershipStatus === 'member') {
      setUserLoadedState({
        uid: currentUser?.uid || null,
        email: currentUser?.email || '',
        displayName: currentUser?.displayName || currentUser?.name || '',
        teamId: resolvedTeamId,
        role: role || (isAdmin ? 'admin' : 'member'),
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
    const bootstrapAvailable = (accessStatus === TEAM_ACCESS_STATUS.NO_TEAM || accessStatus === TEAM_ACCESS_STATUS.NEED_CREATE)
      && canBootstrap(currentUser, resolvedTeamId)
      && !hasBootstrapRun(currentUser?.uid)
    const nextState = setState({
      status: sessionStatus,
      role: role || (isAdmin ? 'admin' : null),
      member,
      invite: null,
      error: errorObject,
      message,
      hasAccess: membershipStatus === 'member' && memberActive !== false && memberAssigned !== false,
      teamId: resolvedTeamId,
      displayTeamId: resolvedDisplayTeamId,
      canChangeTeam: !lockTeam || isAdmin,
      teamLocked: teamLockedFlag,
      bootstrapAvailable,
      teamResolved: true,
      memberExists,
      memberActive,
      memberAssigned,
      membershipStatus,
      membershipCheckPath: memberPath,
      membershipCheckTeamId: resolvedTeamId,
      accessStatus,
      accessError,
      accessDetail: accessResult || null,
    })
    teamDebug('session-access', {
      status: nextState.status,
      accessStatus,
      teamId: resolvedTeamId,
      role: nextState.role,
      assigned: memberAssigned,
      reason: accessResult?.reason || accessError?.code || 'unknown',
    })
    return nextState
  }

  const runPromise = (async () => {
    let accessResult = null
    try {
      accessResult = await getTeamAccessWithTimeout({ teamId: formattedTeam, user: currentUser, source: 'session:evaluate' })
      if (requestId !== accessRequestId) return sessionState
      return applyAccessResult(accessResult)
    } catch (err) {
      console.warn('SESSION ACCESS ERROR', err)
      accessResult = {
        status: TEAM_ACCESS_STATUS.ERROR,
        teamId: formattedTeam,
        reason: 'exception',
        error: { code: 'exception', message: err?.message || 'Ukendt fejl' },
      }
      return applyAccessResult(accessResult)
    } finally {
      // GUARANTEE: spinner stops in all outcomes - accessStatus must leave CHECKING state
      // Do NOT clobber membershipStatus here - applyAccessResult already set it correctly
      if (sessionState.accessStatus === TEAM_ACCESS_STATUS.CHECKING) {
        setState({
          accessStatus: accessResult?.status || TEAM_ACCESS_STATUS.ERROR,
          teamResolved: true,
        })
      }
    }
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
      memberAssigned: null,
      membershipStatus: 'idle',
      membershipCheckPath: '',
      membershipCheckTeamId: '',
      accessStatus: TEAM_ACCESS_STATUS.NO_AUTH,
      accessError: null,
      accessDetail: null,
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
      memberAssigned: null,
      membershipStatus: 'idle',
      membershipCheckPath: '',
      membershipCheckTeamId: '',
      accessStatus: TEAM_ACCESS_STATUS.NO_AUTH,
      accessError: null,
      accessDetail: null,
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
    memberAssigned: null,
    membershipStatus: 'loading',
    membershipCheckPath: buildMemberDocPath(formatTeamId(preferredTeamSlug), context.user?.uid || ''),
    membershipCheckTeamId: formatTeamId(preferredTeamSlug),
    accessStatus: TEAM_ACCESS_STATUS.CHECKING,
    accessError: null,
    accessDetail: null,
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
  if (isLighthouseMode()) {
    initialized = true
    setState({
      status: SESSION_STATUS.ADMIN,
      authReady: true,
      hasAccess: true,
      role: 'admin',
      user: { uid: 'lighthouse', email: 'lighthouse@local' },
      teamResolved: true,
      memberExists: true,
      memberActive: true,
      membershipStatus: 'member',
      accessStatus: TEAM_ACCESS_STATUS.OK,
      message: '',
    })
    return getSessionApi()
  }
  initialized = true

  // Kick auth init immediately so onAuthStateChange callbacks actually fire
  void waitForAuthReady().catch((err) => {
    console.warn('Auth init failed', err)
  })

  preferredTeamSlug = normalizeTeamId(preferredTeamSlug || DEFAULT_TEAM_SLUG)
  persistTeamId(preferredTeamSlug)
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
  clearTeamAccessCache()
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
    memberAssigned: null,
    status: SESSION_STATUS.SIGNING_IN,
    membershipStatus: 'loading',
    membershipCheckPath: memberPath,
    membershipCheckTeamId: formatted,
    accessStatus: TEAM_ACCESS_STATUS.LOADING,
    accessError: null,
    accessDetail: null,
    message: 'Tjekker adgang…',
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
  waitForAuthReady()?.catch?.(() => {})
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
  await createTeamWithMembership({ teamId: targetTeamId, user: auth.user })
  markBootstrapRun(auth?.user?.uid)
  teamDebug('bootstrap-request', { teamId: targetTeamId, uid: auth?.user?.uid })
  return refreshAccess()
}

function refreshAccess () {
  clearTeamAccessCache()
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
