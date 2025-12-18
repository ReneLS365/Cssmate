import {
  getAuthContext,
  getCurrentUser,
  getEnabledProviders,
  initSharedAuth,
  loginWithProvider,
  logoutUser,
  onAuthStateChange,
  reloadCurrentUser,
  resendEmailVerification,
  sendPasswordReset,
  signInWithEmail,
  signUpWithEmail,
  waitForAuthReady,
} from '../../js/shared-auth.js'

let authState = null
const listeners = new Set()
let verifiedResolve = null
let verifiedPromise = null
let initialized = false

function ensureVerifiedPromise () {
  if (verifiedPromise) return verifiedPromise
  verifiedPromise = new Promise((resolve) => {
    verifiedResolve = resolve
  })
  return verifiedPromise
}

function normalizeState (context) {
  const state = context || {}
  const isReady = Boolean(state.isReady)
  const isAuthenticated = Boolean(state.isAuthenticated && state.user)
  const isVerified = Boolean(state.isVerified)
  const requiresVerification = Boolean(state.user) && !isVerified
  return {
    loading: !isReady,
    isReady,
    isAuthenticated,
    isVerified,
    requiresVerification,
    user: state.user || null,
    providers: Array.isArray(state.providers) ? state.providers : [],
    message: state.message || '',
  }
}

function notify () {
  const state = authState || normalizeState(getAuthContext())
  listeners.forEach((listener) => {
    try {
      listener(state)
    } catch (error) {
      console.warn('AuthProvider listener fejlede', error)
    }
  })
  if (state.isVerified && typeof verifiedResolve === 'function') {
    verifiedResolve(state)
    verifiedResolve = null
  }
}

export function initAuthProvider () {
  if (initialized) return getAuthProviderApi()
  initialized = true
  ensureVerifiedPromise()
  initSharedAuth()?.catch?.(() => {})
  waitForAuthReady()?.catch?.(() => {})
  onAuthStateChange((context) => {
    authState = normalizeState(context)
    notify()
  })
  authState = normalizeState(getAuthContext())
  return getAuthProviderApi()
}

function getAuthProviderApi () {
  return {
    getState,
    onChange,
    waitForVerifiedUser,
    getEnabledProviders,
    actions: {
      signInWithGoogle: () => loginWithProvider('google'),
      signInWithEmail,
      signUpWithEmail,
      signOut: logoutUser,
      sendPasswordReset,
      resendVerification: resendEmailVerification,
      reloadUser: reloadCurrentUser,
    },
  }
}

export function getState () {
  return authState || normalizeState(getAuthContext())
}

export function onChange (callback) {
  if (typeof callback !== 'function') return () => {}
  listeners.add(callback)
  const state = getState()
  callback(state)
  return () => listeners.delete(callback)
}

export function waitForVerifiedUser () {
  const state = getState()
  if (state.isVerified) return Promise.resolve(state)
  return ensureVerifiedPromise()
}

export function getAuthIdentity () {
  const user = getCurrentUser() || authState?.user
  if (!user) return null
  return {
    uid: user.uid || null,
    email: user.email || '',
    displayName: user.displayName || '',
    providerId: user.providerId || '',
  }
}
