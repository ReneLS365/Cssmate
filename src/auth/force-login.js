import { initAuth0, isAuthenticated, login } from './auth0-client.js'
import { getAuthCallbackError, isAuthCallbackUrl } from './auth-callback.js'
import { shouldSkipAuthGate } from './skip-auth-gate.js'
import { hardClearUiLocks } from './ui-locks.js'
import { hideLoginOverlay, showLoginOverlay, startLoginOverlayWatcher } from '../ui/login-overlay.js'

const KEY = 'cssmate_autologin_attempted'
let authOverrides = {}
let overlayOverrides = {}

function shouldSkipAutoLogin () {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname || ''
  return path.startsWith('/diag') || path.startsWith('/_diag')
}

function getAuthDeps () {
  return {
    initAuth0,
    isAuthenticated,
    login,
    ...authOverrides,
  }
}

function getOverlayDeps () {
  return {
    hideLoginOverlay,
    showLoginOverlay,
    startLoginOverlayWatcher,
    ...overlayOverrides,
  }
}

export function setForceLoginDependencies ({ auth, overlay } = {}) {
  if (auth) authOverrides = { ...authOverrides, ...auth }
  if (overlay) overlayOverrides = { ...overlayOverrides, ...overlay }
}

export function resetForceLoginDependencies () {
  authOverrides = {}
  overlayOverrides = {}
}

export async function forceLoginOnce () {
  if (typeof window === 'undefined') return
  if (shouldSkipAutoLogin()) return
  if (shouldSkipAuthGate()) return
  const callbackError = getAuthCallbackError()
  if (callbackError) {
    const overlay = getOverlayDeps()
    const message = callbackError.description
      ? `Login fejlede: ${callbackError.description}`
      : `Login fejlede: ${callbackError.error}`
    overlay.showLoginOverlay({
      message: 'Login fejlede. Prøv igen.',
      error: message,
      buttonLabel: 'Prøv igen',
    })
    overlay.startLoginOverlayWatcher()
    try {
      sessionStorage.removeItem(KEY)
    } catch {}
    hardClearUiLocks()
    return
  }
  if (isAuthCallbackUrl()) {
    // If we are returning from Auth0, ensure any overlays/locks are cleared.
    // Otherwise the UI can stay unclickable due to stale overlay state.
    const auth = getAuthDeps()
    const overlay = getOverlayDeps()
    try { overlay.hideLoginOverlay?.() } catch {}
    try {
      await auth.initAuth0()
    } catch (error) {
      console.warn('Auth callback init failed', error)
    }
    try {
      sessionStorage.removeItem(KEY)
    } catch {}
    hardClearUiLocks()
    return
  }

  const auth = getAuthDeps()
  const overlay = getOverlayDeps()

  let loginAttempted = false
  let hasGuard = false
  try {
    hasGuard = sessionStorage.getItem(KEY) === '1'
  } catch {}

  try {
    await auth.initAuth0()

    const ok = await auth.isAuthenticated()
    if (ok) {
      try {
        sessionStorage.removeItem(KEY)
      } catch {}
      overlay.hideLoginOverlay()
      return
    }

    if (hasGuard) {
      overlay.showLoginOverlay({ message: 'Log ind for at fortsætte.' })
      overlay.startLoginOverlayWatcher()
      return
    }

    try {
      sessionStorage.setItem(KEY, '1')
    } catch {}
    loginAttempted = true
    await auth.login()
  } catch (error) {
    console.warn('Auto login failed', error)
    const message = error?.message || 'Auto login fejlede. Prøv at logge ind manuelt.'
    overlay.showLoginOverlay({ message: 'Log ind for at fortsætte.', error: message })
    overlay.startLoginOverlayWatcher()

    if (!loginAttempted) {
      try {
        try {
          sessionStorage.setItem(KEY, '1')
        } catch {}
        await auth.login()
      } catch (loginError) {
        console.warn('Auto login redirect failed', loginError)
      }
    }
  }
}
