import { initAuth0, isAuthenticated, login } from './auth0-client.js'

const KEY = 'cssmate_autologin_attempted'

function isAuthCallbackUrl () {
  const params = new URLSearchParams(window.location.search)
  return params.has('code') || params.has('state') || params.has('error')
}

export async function forceLoginOnce () {
  if (typeof window === 'undefined') return
  if (isAuthCallbackUrl()) return
  if (sessionStorage.getItem(KEY) === '1') return

  await initAuth0()

  const ok = await isAuthenticated()
  if (ok) {
    sessionStorage.removeItem(KEY)
    return
  }

  sessionStorage.setItem(KEY, '1')
  await login()
}
