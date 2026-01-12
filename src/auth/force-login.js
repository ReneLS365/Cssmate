import { initAuth0, isAuthenticated, login } from './auth0-client.js'
import { hideLoginOverlay, showLoginOverlay, startLoginOverlayWatcher } from '../ui/login-overlay.js'

const KEY = 'cssmate_autologin_attempted'

function isAuthCallbackUrl () {
  const params = new URLSearchParams(window.location.search)
  return params.has('code') || params.has('state') || params.has('error')
}

function shouldSkipAutoLogin () {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname || ''
  return path.startsWith('/diag') || path.startsWith('/_diag')
}

export async function forceLoginOnce () {
  if (typeof window === 'undefined') return
  if (shouldSkipAutoLogin()) return
  if (isAuthCallbackUrl()) return

  try {
    sessionStorage.removeItem(KEY)
  } catch {}

  let loginAttempted = false

  try {
    await initAuth0()

    const ok = await isAuthenticated()
    if (ok) {
      hideLoginOverlay()
      return
    }

    try {
      sessionStorage.setItem(KEY, '1')
    } catch {}
    loginAttempted = true
    await login()
  } catch (error) {
    console.warn('Auto login failed', error)
    const message = error?.message || 'Auto login fejlede. Prøv at logge ind manuelt.'
    showLoginOverlay({ error: message })
    startLoginOverlayWatcher()

    if (!loginAttempted) {
      try {
        try {
          sessionStorage.setItem(KEY, '1')
        } catch {}
        await login()
      } catch (loginError) {
        console.warn('Auto login redirect failed', loginError)
      }
    }
  }
}
