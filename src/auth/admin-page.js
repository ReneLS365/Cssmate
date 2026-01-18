import { buildUserFromToken } from '../../js/shared-auth.js'
import { isAdmin } from './admin.js'
import {
  getUser,
  getToken,
  getOrganizationConfig,
  initAuth0,
  isAuthenticated,
  login,
  logout,
} from './auth0-client.js'

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

async function guardAdminPage () {
  const message = document.getElementById('adminMessage')
  const loginBtn = document.getElementById('adminLogin')
  const logoutBtn = document.getElementById('adminLogout')
  const userEmail = document.getElementById('adminUserEmail')
  const content = document.getElementById('adminContent')

  loginBtn?.addEventListener('click', () => login().catch(() => {}))
  logoutBtn?.addEventListener('click', () => logout().catch(() => {}))

  try {
    const orgConfig = getOrganizationConfig()
    if (!orgConfig?.isConfigured) {
      console.error('Auth0 org config mangler. Sæt VITE_AUTH0_ORG_ID eller VITE_AUTH0_ORG_SLUG.')
      setText(message, 'Auth0 organisation mangler. Sæt VITE_AUTH0_ORG_ID eller VITE_AUTH0_ORG_SLUG.')
      setHidden(loginBtn, true)
      setHidden(logoutBtn, true)
      setHidden(content, true)
      return
    }
    await initAuth0()
  } catch (error) {
    setText(message, error?.message || 'Auth0 kunne ikke initialiseres.')
    return
  }

  const authenticated = await isAuthenticated()
  setHidden(loginBtn, authenticated)
  setHidden(logoutBtn, !authenticated)

  if (!authenticated) {
    setText(message, 'Log ind for at åbne admin-siden.')
    setHidden(content, true)
    login().catch(() => {})
    return
  }

  const profile = await getUser()
  const token = await getToken()
  const claimedUser = buildUserFromToken(token || '') || {}
  const mergedUser = { ...claimedUser, email: profile?.email || claimedUser?.email || null }
  setText(userEmail, mergedUser?.email || '–')

  if (!isAdmin(mergedUser)) {
    setText(message, 'Adgang nægtet. Din konto er ikke admin.')
    setHidden(content, true)
    setTimeout(() => {
      if (typeof location !== 'undefined') {
        location.href = '/'
      }
    }, 1500)
    return
  }

  setText(message, '')
  setHidden(content, false)
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', guardAdminPage, { once: true })
}
