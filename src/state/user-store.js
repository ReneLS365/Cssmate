const defaultUserState = {
  uid: null,
  email: '',
  displayName: '',
  teamId: '',
  role: '',
  loaded: false,
}

let userState = { ...defaultUserState }
const listeners = new Set()

function isDevBuild () {
  return Boolean((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV))
}

function updateGlobals () {
  if (typeof window === 'undefined') return
  window.datastore = window.datastore || {}
  window.datastore.user = { ...userState }
  if (isDevBuild()) {
    window.__DBG = window.__DBG || {}
    window.__DBG.user = { ...userState }
    window.__DBG.team = { teamId: userState.teamId, role: userState.role }
  }
}

function notify () {
  const snapshot = { ...userState }
  listeners.forEach(listener => {
    try {
      listener(snapshot)
    } catch (error) {
      console.warn('user-store listener fejlede', error)
    }
  })
  updateGlobals()
}

function setUserState (overrides, { loaded = true } = {}) {
  userState = { ...defaultUserState, ...overrides, loaded }
  notify()
  return userState
}

export function markUserLoading () {
  return setUserState({}, { loaded: false })
}

export function setUserLoadedState (state) {
  return setUserState(state, { loaded: true })
}

export function resetUserState () {
  return setUserState({}, { loaded: true })
}

export function getUserState () {
  return { ...userState }
}

export function onUserStateChange (callback) {
  if (typeof callback !== 'function') return () => {}
  listeners.add(callback)
  callback(getUserState())
  return () => listeners.delete(callback)
}
