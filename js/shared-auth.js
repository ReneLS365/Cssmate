import { normalizeEmail } from '../src/auth/roles.js'
import { clearAuthToken } from '../src/api/client.js'
import {
  getUser,
  initAuth0,
  isAuthenticated,
  login,
  logout,
} from '../src/auth/auth0-client.js'

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

export function buildUserFromToken (token) {
  const payload = decodeJwt(token)
  if (!payload || !payload.sub) return null
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    clearAuthToken()
    return null
  }
  return {
    uid: payload.sub,
    email: normalizeEmail(payload.email || ''),
    displayName: payload.name || '',
    providerId: 'password',
    emailVerified: true,
  }
}

function normalizeAuth0User (user) {
  if (!user) return null
  return {
    uid: user.sub || '',
    email: normalizeEmail(user.email || ''),
    displayName: user.name || user.nickname || '',
    providerId: 'auth0',
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
    initAuth0()
      .then(async () => {
        const authed = await isAuthenticated()
        if (!authed) {
          clearTimeout(timer)
          setAuthState({ user: null, error: null })
          resolve(null)
          return
        }
        const user = normalizeAuth0User(await getUser())
        clearTimeout(timer)
        setAuthState({ user, error: null })
        resolve(user)
      })
      .catch((error) => {
        clearTimeout(timer)
        if (!error?.code) {
          error.code = error?.message?.includes('Missing Auth0 env vars')
            ? 'auth0/missing-config'
            : 'auth0/init-failed'
        }
        setAuthState({ user: null, error })
        resolve(null)
      })
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
  return ['auth0']
}

export async function loginWithProvider () {
  await login()
}

export async function logoutUser () {
  await logout()
  setAuthState({ user: null, error: null })
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
