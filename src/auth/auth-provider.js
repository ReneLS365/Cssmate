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
import { updateAuthDebugState } from '../state/debug.js'

let authState = null
const listeners = new Set()
let verifiedResolve = null
let verifiedPromise = null
let verifiedReject = null
let initialized = false
let authInitStarted = false
let authInitPromise = null

function ensureVerifiedPromise () {
  if (verifiedPromise) return verifiedPromise
  verifiedPromise = new Promise((resolve, reject) => {
    verifiedResolve = resolve
    verifiedReject = reject
  })
  return verifiedPromise
}

function ensureAuthInit () {
  if (authInitPromise) return authInitPromise
  authInitStarted = true
  authInitPromise = waitForAuthReady().catch(error => {
    authInitPromise = null
    throw error
  })
  return authInitPromise
}

function prefetchAuthInit () {
  if (authInitStarted) return authInitPromise
  const trigger = () => {
    try {
      ensureAuthInit()
    } catch {}
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(trigger, { timeout: 2000 })
  } else {
    setTimeout(trigger, 500)
  }
  return authInitPromise
}

function normalizeState (context) {
  const state = context || {}
  const isReady = authInitStarted ? Boolean(state.isReady) : false
  const isAuthenticated = Boolean(state.isAuthenticated && state.user)
  const isVerified = Boolean(state.isVerified)
  const requiresVerification = Boolean(state.user) && !isVerified
  const error = state.error || null
  const hasError = Boolean(error)
  const loading = authInitStarted ? !isReady : false
  return {
    loading,
    isReady,
    isAuthenticated,
    isVerified,
    hasError,
    error,
    requiresVerification,
    user: state.user || null,
    providers: Array.isArray(state.providers) ? state.providers : [],
    message: authInitStarted
      ? (state.message || state.error?.message || '')
      : 'Log ind for at fortsætte',
  }
}

function notify () {
  const state = authState || normalizeState(getAuthContext())
  updateAuthDebugState(state)
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
    verifiedReject = null
  } else if (state.hasError && typeof verifiedReject === 'function') {
    verifiedReject(state.error || new Error(state.message || 'Auth-fejl'))
    verifiedResolve = null
    verifiedReject = null
  }
}

export function initAuthProvider () {
  if (initialized) return getAuthProviderApi()
  initialized = true
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
    ensureAuth: ensureAuthInit,
    prefetchAuth: prefetchAuthInit,
    actions: {
      signInWithGoogle: () => { ensureAuthInit(); return loginWithProvider('google') },
      signInWithEmail: (...args) => { ensureAuthInit(); return signInWithEmail(...args) },
      signUpWithEmail: (...args) => { ensureAuthInit(); return signUpWithEmail(...args) },
      signOut: logoutUser,
      sendPasswordReset: (...args) => { ensureAuthInit(); return sendPasswordReset(...args) },
      resendVerification: (...args) => { ensureAuthInit(); return resendEmailVerification(...args) },
      reloadUser: (...args) => { ensureAuthInit(); return reloadCurrentUser(...args) },
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
  ensureAuthInit()?.catch?.(() => {})
  const state = getState()
  if (state.isVerified) return Promise.resolve(state)
  if (state.hasError) {
    return Promise.reject(state.error || new Error(state.message || 'Login fejlede'))
  }
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
