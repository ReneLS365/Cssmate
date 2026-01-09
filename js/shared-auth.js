import { normalizeEmail } from '../src/auth/roles.js'
import { apiJson, clearAuthToken, getAuthToken, setAuthToken } from '../src/api/client.js'

const AUTH_INIT_TIMEOUT_MS = 15000
const listeners = new Set()

let authReady = false
let authError = null
let currentUser = null
let lastAuthErrorCode = ''
let initPromise = null

function decodeJwt (token) {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload
  } catch {
    return null
  }
}

function buildUserFromToken (token) {
  const payload = decodeJwt(token)
  if (!payload || !payload.sub) return null
  return {
    uid: payload.sub,
    email: normalizeEmail(payload.email || ''),
    displayName: payload.name || '',
    providerId: 'password',
    emailVerified: true,
  }
}

function setAuthState ({ user, error }) {
  currentUser = user || null
  authError = error || null
  if (error?.code) lastAuthErrorCode = error.code
  authReady = true
  listeners.forEach((listener) => listener(getAuthContext()))
}

export function getAuthContext () {
  if (!authReady) {
    return {
      isReady: false,
      isAuthenticated: false,
      isVerified: false,
      user: null,
      providers: getEnabledProviders(),
      message: 'Login initialiseres…',
      error: authError,
    }
  }
  if (authError) {
    return {
      isReady: true,
      isAuthenticated: false,
      isVerified: false,
      user: null,
      providers: getEnabledProviders(),
      message: authError.message || 'Login-fejl',
      error: authError,
    }
  }
  if (!currentUser) {
    return {
      isReady: true,
      isAuthenticated: false,
      isVerified: false,
      user: null,
      providers: getEnabledProviders(),
      message: 'Log ind for at fortsætte.',
      error: null,
    }
  }
  return {
    isReady: true,
    isAuthenticated: true,
    isVerified: true,
    user: currentUser,
    providers: getEnabledProviders(),
    message: '',
    error: null,
  }
}

export function onAuthStateChange (callback) {
  if (typeof callback !== 'function') return () => {}
  listeners.add(callback)
  callback(getAuthContext())
  return () => listeners.delete(callback)
}

export async function initSharedAuth () {
  if (initPromise) return initPromise
  initPromise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      const error = new Error('Auth timeout')
      error.code = 'auth-timeout'
      setAuthState({ user: null, error })
      resolve(null)
    }, AUTH_INIT_TIMEOUT_MS)
    timer?.unref?.()
    const token = getAuthToken()
    const user = buildUserFromToken(token)
    clearTimeout(timer)
    setAuthState({ user, error: null })
    resolve(user)
  })
  return initPromise
}

export async function waitForAuthReady () {
  await initSharedAuth()
  if (authReady) return getAuthContext()
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChange((context) => {
      if (context?.isReady) {
        unsubscribe()
        resolve(context)
      }
    })
  })
}

export function getCurrentUser () {
  return currentUser
}

export function getUserDisplay (user = currentUser) {
  if (!user) return 'Ukendt'
  return user.displayName || user.email || user.uid || 'Ukendt'
}

export function getEnabledProviders () {
  return ['email']
}

export async function loginWithProvider () {
  const error = new Error('Login med udbyder er ikke tilgængelig.')
  error.code = 'auth/provider-disabled'
  setAuthState({ user: null, error })
  throw error
}

export async function signUpWithEmail (email, password) {
  const response = await apiJson('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!response?.token) {
    const error = new Error('Kunne ikke oprette bruger.')
    error.code = 'auth/signup-failed'
    setAuthState({ user: null, error })
    throw error
  }
  setAuthToken(response.token)
  const user = buildUserFromToken(response.token)
  setAuthState({ user, error: null })
  return user
}

export async function signInWithEmail (email, password) {
  const response = await apiJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!response?.token) {
    const error = new Error('Login fejlede.')
    error.code = 'auth/login-failed'
    setAuthState({ user: null, error })
    throw error
  }
  setAuthToken(response.token)
  const user = buildUserFromToken(response.token)
  setAuthState({ user, error: null })
  return user
}

export async function logoutUser () {
  clearAuthToken()
  setAuthState({ user: null, error: null })
}

export async function sendPasswordReset () {
  const error = new Error('Kodeordsreset er ikke tilgængelig endnu.')
  error.code = 'auth/reset-unavailable'
  setAuthState({ user: currentUser, error })
  throw error
}

export async function resendEmailVerification () {
  const error = new Error('Email-verificering er ikke nødvendig i dette login.')
  error.code = 'auth/verify-unavailable'
  setAuthState({ user: currentUser, error })
  throw error
}

export async function reloadCurrentUser () {
  const token = getAuthToken()
  const user = buildUserFromToken(token)
  setAuthState({ user, error: null })
  return user
}

export function isMockAuthEnabled () {
  return false
}

export function getAuthDiagnostics () {
  return {
    authReady,
    isAuthenticated: Boolean(currentUser),
    userEmail: currentUser?.email || '',
    lastAuthErrorCode,
  }
}
