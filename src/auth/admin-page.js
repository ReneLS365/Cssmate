import {
  getUser,
  initAuth,
  isAdmin,
  isAuthenticated,
  login,
  logout,
} from './auth0.js'

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
    await initAuth()
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

  const user = await getUser()
  setText(userEmail, user?.email || '–')

  if (!isAdmin(user)) {
    setText(message, 'Adgang nægtet. Din konto er ikke admin.')
    setHidden(content, true)
    return
  }

  setText(message, '')
  setHidden(content, false)
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', guardAdminPage, { once: true })
}
