const DEBUG_STORAGE_KEY = 'sscaffDebug'

const defaultState = {
  authReady: false,
  authGateReason: '',
  user: {
    uid: null,
    email: '',
    providerIds: [],
    emailVerified: false,
  },
  teamId: '',
  teamResolved: false,
  memberExists: false,
  memberActive: null,
  memberAssigned: null,
  memberRole: '',
  membershipStatus: 'loading',
  membershipCheckPath: '',
  accessStatus: 'checking',
  accessError: null,
  sessionReady: false,
  sessionStatus: '',
  currentView: '',
  buildMeta: {
    appVersion: '',
    buildTime: '',
    gitSha: '',
    buildId: '',
    cacheKey: '',
    warnings: [],
  },
  lastCacheResetAt: '',
}

let debugState = { ...defaultState }
const listeners = new Set()

function getSnapshot () {
  return {
    ...debugState,
    user: { ...debugState.user },
    accessError: debugState.accessError ? { ...debugState.accessError } : null,
    buildMeta: { ...debugState.buildMeta, warnings: [...(debugState.buildMeta?.warnings || [])] },
  }
}

function notify () {
  const snapshot = getSnapshot()
  listeners.forEach(listener => {
    try {
      listener(snapshot)
    } catch (error) {
      console.warn('Debug listener failed', error)
    }
  })
}

function normalizeProviderIds (providers) {
  if (Array.isArray(providers)) {
    return providers
      .map(entry => entry?.providerId || entry?.provider || entry)
      .filter(Boolean)
  }
  return []
}

function setState (updates) {
  const nextState = { ...debugState, ...updates }
  nextState.sessionReady = deriveSessionReady(nextState)
  debugState = nextState
  notify()
  return debugState
}

function deriveSessionReady (state) {
  const hasUser = Boolean(state?.user?.uid)
  const teamResolved = Boolean(state?.teamResolved)
  const memberExists = Boolean(state?.memberExists)
  const memberActive = state?.memberActive
  const memberAssigned = state?.memberAssigned
  const status = state?.sessionStatus || ''
  const membershipStatus = state?.membershipStatus
  const isSignedIn = status === 'signedIn_admin' || status === 'signedIn_member'
  return Boolean(
    state?.authReady &&
    hasUser &&
    teamResolved &&
    memberExists &&
    memberActive !== false &&
    memberAssigned !== false &&
    isSignedIn &&
    membershipStatus === 'member'
  )
}

function readEnvFlag (value) {
  if (value == null) return false
  const normalized = String(value).trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

function hasDebugQueryFlag () {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search || '')
    return params.get('debug') === '1'
  } catch {
    return false
  }
}

function hasDebugEnvFlag () {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  if (readEnvFlag(metaEnv.VITE_DEBUG_AUTH)) return true
  if (typeof window === 'undefined') return false
  const windowEnv = window.__ENV__ || {}
  return readEnvFlag(windowEnv.VITE_DEBUG_AUTH || window.VITE_DEBUG_AUTH)
}

export function onDebugChange (callback) {
  if (typeof callback !== 'function') return () => {}
  listeners.add(callback)
  callback(getSnapshot())
  return () => listeners.delete(callback)
}

export function getDebugState () {
  return getSnapshot()
}

export function isDebugOverlayEnabled () {
  const devFlag = Boolean(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV)
  if (typeof window === 'undefined') return devFlag
  try {
    const legacyFlag = window.localStorage?.getItem(DEBUG_STORAGE_KEY) === '1'
    const debugFlag = window.localStorage?.getItem('debug') === '1'
    return devFlag || legacyFlag || debugFlag || hasDebugQueryFlag() || hasDebugEnvFlag()
  } catch {
    return devFlag || hasDebugQueryFlag() || hasDebugEnvFlag()
  }
}

export function updateAuthDebugState (authContext) {
  const ready = Boolean(authContext?.isReady)
  const user = authContext?.user || null
  const providerIds = normalizeProviderIds(authContext?.providers || user?.providerData || [])
  setState({
    authReady: ready,
    user: {
      uid: user?.uid || null,
      email: user?.email || '',
      providerIds,
      emailVerified: Boolean(user?.emailVerified || authContext?.isVerified),
    },
  })
}

export function updateAuthGateReason (reason = '') {
  setState({ authGateReason: reason || '' })
}

export function updateTeamDebugState ({ teamId, member, teamResolved, membershipStatus, membershipCheckPath, accessStatus, accessError, memberAssigned }) {
  const memberExists = Boolean(member)
  setState({
    teamId: teamId || debugState.teamId,
    teamResolved: Boolean(teamResolved),
    memberExists,
    memberActive: memberExists ? member?.active !== false : null,
    memberAssigned: typeof memberAssigned === 'boolean' ? memberAssigned : (memberExists ? member?.assigned !== false : null),
    memberRole: member?.role || '',
    membershipStatus: membershipStatus || debugState.membershipStatus,
    membershipCheckPath: membershipCheckPath || debugState.membershipCheckPath,
    accessStatus: accessStatus || debugState.accessStatus,
    accessError: accessError || (accessStatus ? null : debugState.accessError),
  })
}

export function updateSessionDebugState (sessionState) {
  const status = sessionState?.status || ''
  updateTeamDebugState({
    teamId: sessionState?.teamId,
    member: sessionState?.member,
    teamResolved: Boolean(sessionState?.teamResolved || (sessionState?.user && status !== 'signingIn')),
    membershipStatus: sessionState?.membershipStatus,
    membershipCheckPath: sessionState?.membershipCheckPath,
    accessStatus: sessionState?.accessStatus,
    accessError: sessionState?.accessError,
    memberAssigned: sessionState?.memberAssigned,
  })
  setState({
    sessionStatus: status,
    sessionReady: Boolean(sessionState?.sessionReady),
  })
}

export function updateCurrentView (viewId) {
  setState({ currentView: viewId || '' })
}

function resolveBuildMeta () {
  if (typeof self !== 'undefined' && self.CSSMATE_BUILD_META) return self.CSSMATE_BUILD_META
  if (typeof window !== 'undefined' && window.CSSMATE_BUILD_META) return window.CSSMATE_BUILD_META
  return null
}

export function applyBuildMetadata () {
  const meta = resolveBuildMeta() || {}
  setState({
    buildMeta: {
      appVersion: meta.appVersion || '',
      buildTime: meta.buildTime || '',
      gitSha: meta.gitSha || '',
      buildId: meta.buildId || '',
      cacheKey: meta.cacheKey || '',
      warnings: [],
    },
  })
}

export function markCacheReset () {
  setState({ lastCacheResetAt: new Date().toISOString() })
}
