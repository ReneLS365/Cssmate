const DEBUG_STORAGE_KEY = 'sscaffDebug'

const defaultState = {
  authReady: false,
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
  memberRole: '',
  membershipStatus: 'loading',
  membershipCheckPath: '',
  sessionReady: false,
  sessionStatus: '',
  currentView: '',
  lastFirestoreError: null,
}

let debugState = { ...defaultState }
const listeners = new Set()

function getSnapshot () {
  return {
    ...debugState,
    user: { ...debugState.user },
    lastFirestoreError: debugState.lastFirestoreError ? { ...debugState.lastFirestoreError } : null,
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
  const status = state?.sessionStatus || ''
  const membershipStatus = state?.membershipStatus
  const isSignedIn = status === 'signedIn_admin' || status === 'signedIn_member'
  return Boolean(
    state?.authReady &&
    hasUser &&
    teamResolved &&
    memberExists &&
    memberActive !== false &&
    isSignedIn &&
    membershipStatus === 'member'
  )
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
    return devFlag || window.localStorage?.getItem(DEBUG_STORAGE_KEY) === '1'
  } catch {
    return devFlag
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

export function updateTeamDebugState ({ teamId, member, teamResolved, membershipStatus, membershipCheckPath }) {
  const memberExists = Boolean(member)
  setState({
    teamId: teamId || debugState.teamId,
    teamResolved: Boolean(teamResolved),
    memberExists,
    memberActive: memberExists ? member?.active !== false : null,
    memberRole: member?.role || '',
    membershipStatus: membershipStatus || debugState.membershipStatus,
    membershipCheckPath: membershipCheckPath || debugState.membershipCheckPath,
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
  })
  setState({
    sessionStatus: status,
    sessionReady: Boolean(sessionState?.sessionReady),
  })
}

export function updateCurrentView (viewId) {
  setState({ currentView: viewId || '' })
}

export function setLastFirestoreError (error, path = '') {
  if (!error) {
    setState({ lastFirestoreError: null })
    return
  }
  const code = error?.code || error?.name || 'error'
  const message = error?.message || String(error)
  const normalizedPath = path || ''
  setState({
    lastFirestoreError: {
      code,
      message,
      path: normalizedPath,
      at: new Date().toISOString(),
    },
  })
  if (code === 'failed-precondition' && message?.toLowerCase?.()?.includes('index')) {
    console.error(message)
    dispatchIndexMissing(message, normalizedPath)
  }
}

export function clearLastFirestoreError () {
  setState({ lastFirestoreError: null })
}

function dispatchIndexMissing (message, path) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  const detail = {
    message: message || 'Mangler Firestore index. Se console for create-index link.',
    path: path || '',
  }
  window.dispatchEvent(new CustomEvent('sscaff:index-missing', { detail }))
}
