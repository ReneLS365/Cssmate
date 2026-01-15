import {
  getAuthContext,
  getCurrentUser,
  getEnabledProviders,
  loginWithProvider,
  logoutUser,
  onAuthStateChange,
  waitForAuthReady,
} from '../../js/shared-auth.js'
import { onAuthBootstrap } from './bootstrap.js'
import { hardClearUiLocks } from './ui-locks.js'
import { updateAuthDebugState } from '../state/debug.js'

let authState = null
const listeners = new Set()
let verifiedResolve = null
let verifiedPromise = null
let verifiedReject = null
let initialized = false
let authInitStarted = false
let authInitPromise = null
const AUTH_INIT_TIMEOUT_MS = 15000

function readEnvFlag (value) {
  if (value == null) return false
  const normalized = String(value).trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

function isAuthDebugEnvEnabled () {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  if (readEnvFlag(metaEnv.VITE_DEBUG_AUTH)) return true
  if (typeof window === 'undefined') return false
  const windowEnv = window.__ENV__ || {}
  return readEnvFlag(windowEnv.VITE_DEBUG_AUTH || window.VITE_DEBUG_AUTH)
}

function ensureVerifiedPromise () {
  if (verifiedPromise) return verifiedPromise
  verifiedPromise = new Promise((resolve, reject) => {
    verifiedResolve = resolve
    verifiedReject = reject
  })
  return verifiedPromise
}

function withInitTimeout(promise) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('Init timeout. Try Reset app.')
      error.code = 'init-timeout'
      reject(error)
    }, AUTH_INIT_TIMEOUT_MS)
    timer?.unref?.()
    promise
      .then(result => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch(error => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

function ensureAuthInit () {
  if (authInitPromise) return authInitPromise
  authInitStarted = true
  authInitPromise = withInitTimeout(waitForAuthReady()).catch(error => {
    authInitPromise = null
    throw error
  })
  return authInitPromise
}

function prefetchAuthInit () {
  if (authInitStarted) return authInitPromise
  const trigger = () => {
    try {
      ensureAuthInit()?.catch?.(() => {})
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
  if (state.isReady && state.isAuthenticated) {
    hardClearUiLocks()
  }
  if (isAuthDebugEnvEnabled()) {
    console.info('[auth:debug]', {
      ready: state.isReady,
      authenticated: state.isAuthenticated,
      requiresVerification: state.requiresVerification,
      uid: state.user?.uid || '',
      email: state.user?.email || '',
      error: state.error?.code || state.error?.message || '',
    })
  }
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
  onAuthBootstrap({ onAuthStateChange })
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
      signInWithRedirect: () => loginWithProvider('auth0'),
      signOut: logoutUser,
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
