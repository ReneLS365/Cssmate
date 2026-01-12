import { isAdmin } from './admin.js'
import {
  getUser,
  initAuth0,
  isAuthenticated,
  login,
  logout,
} from './auth0-client.js'

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

  if (sessionStorage.getItem(AUTOLOGIN_GUARD_KEY) === '1') return

  const authenticated = await isAuthenticated()
  if (authenticated) {
    sessionStorage.removeItem(AUTOLOGIN_GUARD_KEY)
    return
  }

  sessionStorage.setItem(AUTOLOGIN_GUARD_KEY, '1')
  await login()
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
      return
    }

    const user = await getUser()
    setText(userEmail, user?.email || '–')
    setHidden(adminLink, !isAdmin(user?.email))
    setText(statusMessage, '')
  } catch (error) {
    setHidden(loginBtn, false)
    setHidden(logoutBtn, true)
    setHidden(adminLink, true)
    setText(userEmail, '–')
    setText(statusMessage, error?.message || 'Auth0 kunne ikke initialiseres.')
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

  if (!nodes.loginBtn || !nodes.logoutBtn || !nodes.userEmail) return

  nodes.loginBtn.addEventListener('click', () => {
    login().catch(() => {})
  })

  nodes.logoutBtn.addEventListener('click', () => {
    logout().catch(() => {})
  })

  try {
    await initAuth0()
  } catch (error) {
    setText(nodes.statusMessage, error?.message || 'Auth0 kunne ikke initialiseres.')
    return
  }

  await updateAuth0Ui(nodes)
  document.documentElement.classList.add('auth-ready')
  await forceLoginIfNeeded()
}
