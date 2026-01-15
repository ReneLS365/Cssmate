import { initAuth0, isAuthenticated, login } from './auth0-client.js'
import { shouldSkipAuthGate } from './skip-auth-gate.js'
import { hideLoginOverlay, showLoginOverlay, startLoginOverlayWatcher } from '../ui/login-overlay.js'

const KEY = 'cssmate_autologin_attempted'
let authOverrides = {}
let overlayOverrides = {}

function isAuthCallbackUrl () {
  const params = new URLSearchParams(window.location.search)
  return params.has('code') && params.has('state')
}

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
  if (isAuthCallbackUrl()) return

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
