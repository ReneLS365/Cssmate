import { isAdmin } from './admin.js'
import {
  getUser,
  initAuth0,
  isAuthenticated,
  login,
  logout,
} from './auth0-client.js'
import { hideLoginOverlay, showLoginOverlay, startLoginOverlayWatcher } from '../ui/login-overlay.js'

const AUTOLOGIN_GUARD_KEY = 'cssmate_autologin_attempted'

function isAuthCallbackUrl () {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.has('code') || params.has('state') || params.has('error')
}

function shouldSkipAutoLogin () {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname || ''
  return path.startsWith('/diag') || path.startsWith('/_diag')
}

async function forceLoginIfNeeded () {
  if (typeof window === 'undefined') return
  if (shouldSkipAutoLogin()) return
  if (isAuthCallbackUrl()) return

  try {
    let hasGuard = false
    try {
      hasGuard = sessionStorage.getItem(AUTOLOGIN_GUARD_KEY) === '1'
    } catch {}

    const authenticated = await isAuthenticated()
    if (authenticated) {
      sessionStorage.removeItem(AUTOLOGIN_GUARD_KEY)
      hideLoginOverlay()
      return
    }

    if (hasGuard) {
      showLoginOverlay({ message: 'Log ind for at fortsætte.' })
      startLoginOverlayWatcher()
      return
    }

    try {
      sessionStorage.setItem(AUTOLOGIN_GUARD_KEY, '1')
    } catch {}
    await login()
  } catch (error) {
    console.warn('Auto login failed', error)
    const message = error?.message || 'Auto login fejlede. Prøv at logge ind manuelt.'
    showLoginOverlay({ error: message })
    startLoginOverlayWatcher()
  }
}

function setHidden (element, hidden) {
  if (!element) return
  element.hidden = hidden
  if (hidden) {
    element.setAttribute('aria-hidden', 'true')
  } else {
    element.removeAttribute('aria-hidden')
  }
}

function setText (element, value) {
  if (!element) return
  element.textContent = value
}

async function updateAuth0Ui (nodes) {
  const { loginBtn, logoutBtn, userEmail, adminLink, statusMessage } = nodes

  try {
    const authenticated = await isAuthenticated()
    if (authenticated) {
      sessionStorage.removeItem(AUTOLOGIN_GUARD_KEY)
    }
    setHidden(loginBtn, authenticated)
    setHidden(logoutBtn, !authenticated)

    if (!authenticated) {
      setText(userEmail, '–')
      setHidden(adminLink, true)
      setText(statusMessage, '')
      showLoginOverlay({ message: 'Log ind for at fortsætte.' })
      startLoginOverlayWatcher()
      return
    }

    const user = await getUser()
    setText(userEmail, user?.email || '–')
    setHidden(adminLink, !isAdmin(user?.email))
    setText(statusMessage, '')
    hideLoginOverlay()
  } catch (error) {
    setHidden(loginBtn, false)
    setHidden(logoutBtn, true)
    setHidden(adminLink, true)
    setText(userEmail, '–')
    setText(statusMessage, error?.message || 'Auth0 kunne ikke initialiseres.')
    showLoginOverlay({ error: error?.message || 'Auth0 kunne ikke initialiseres.' })
    startLoginOverlayWatcher()
  }
}

export async function initAuth0Ui () {
  if (typeof document === 'undefined') return

  const nodes = {
    loginBtn: document.getElementById('loginBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    userEmail: document.getElementById('authUserEmail'),
    adminLink: document.getElementById('adminLink'),
    statusMessage: document.getElementById('authStatusMessage'),
  }
  if (nodes.loginBtn) {
    nodes.loginBtn.addEventListener('click', () => {
      login().catch(() => {})
    })
  }

  if (nodes.logoutBtn) {
    nodes.logoutBtn.addEventListener('click', () => {
      logout().catch(() => {})
    })
  }

  try {
    await initAuth0()
  } catch (error) {
    setText(nodes.statusMessage, error?.message || 'Auth0 kunne ikke initialiseres.')
    showLoginOverlay({ error: error?.message || 'Auth0 kunne ikke initialiseres.' })
    startLoginOverlayWatcher()
    return
  }

  await updateAuth0Ui(nodes)
  document.documentElement.classList.add('auth-ready')
  await forceLoginIfNeeded()
}
