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
  debugState = { ...debugState, ...updates }
  notify()
  return debugState
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

export function updateTeamDebugState ({ teamId, member, teamResolved }) {
  const memberExists = Boolean(member)
  setState({
    teamId: teamId || debugState.teamId,
    teamResolved: Boolean(teamResolved),
    memberExists,
    memberActive: memberExists ? member?.active !== false : null,
    memberRole: member?.role || '',
  })
}

export function updateSessionDebugState (sessionState) {
  const ready = Boolean(
    sessionState &&
    sessionState.user &&
    !sessionState.requiresVerification &&
    (sessionState.status === 'signedIn_admin' || sessionState.status === 'signedIn_member')
  )
  setState({
    sessionReady: ready,
    sessionStatus: sessionState?.status || '',
  })
  updateTeamDebugState({
    teamId: sessionState?.teamId,
    member: sessionState?.member,
    teamResolved: Boolean(sessionState?.user && sessionState?.status !== 'signingIn'),
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
  setState({
    lastFirestoreError: {
      code,
      message,
      path,
      at: new Date().toISOString(),
    },
  })
}
