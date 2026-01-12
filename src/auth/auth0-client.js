import createAuth0Client from '@auth0/auth0-spa-js'
import { isAutomated } from '../config/runtime-modes.js'
import { resolveBaseUrl } from './resolve-base-url.js'

let client
let initPromise

const INVITE_TOKEN_KEY = 'cssmate:inviteToken'

function env (key, fallback = '') {
  return (import.meta?.env?.[key])
    ?? (window.__ENV__?.[key])
    ?? (typeof process !== 'undefined' ? process.env?.[key] : undefined)
    ?? fallback
}

function storeInviteToken (token) {
  if (!token) return
  try {
    window.sessionStorage?.setItem(INVITE_TOKEN_KEY, token)
  } catch {
    // ignore
  }
}

export async function initAuth0 () {
  if (client) return client
  if (initPromise) return initPromise

  initPromise = (async () => {
    try {
      const domain = env('VITE_AUTH0_DOMAIN')
      const clientId = env('VITE_AUTH0_CLIENT_ID')
      const audience = env('VITE_AUTH0_AUDIENCE', '')
      const baseUrl = resolveBaseUrl()

      if (!domain || !clientId) {
        throw new Error('Missing Auth0 env vars: VITE_AUTH0_DOMAIN / VITE_AUTH0_CLIENT_ID')
      }

      client = await createAuth0Client({
        domain,
        clientId,
        authorizationParams: {
          redirect_uri: baseUrl,
          ...(audience ? { audience } : {}),
        },
        cacheLocation: 'localstorage',
        useRefreshTokens: true,
      })

      const qs = new URLSearchParams(window.location.search)
      const hasCode = qs.has('code')
      const hasState = qs.has('state')
      const inviteToken = qs.get('invite')

      if (inviteToken) {
        storeInviteToken(inviteToken)
      }

      if (hasCode && hasState) {
        const result = await client.handleRedirectCallback()
        if (result?.appState?.invite) {
          storeInviteToken(result.appState.invite)
        }
        window.history.replaceState({}, document.title, window.location.pathname)
      }

      if (inviteToken && !hasCode && !hasState) {
        const authed = await client.isAuthenticated().catch(() => false)
        if (!authed) {
          await client.loginWithRedirect({ appState: { invite: inviteToken } })
        }
      }

      return client
    } catch (error) {
      if (isAutomated()) {
        return null
      }
      throw error
    }
  })()

  try {
    return await initPromise
  } finally {
    initPromise = null
  }
}

export async function login (appState = {}) {
  const c = await initAuth0()
  if (!c) return
  await c.loginWithRedirect({ appState })
}

export async function signup (appState = {}) {
  const c = await initAuth0()
  if (!c) return
  await c.loginWithRedirect({
    appState,
    authorizationParams: { screen_hint: 'signup', redirect_uri: resolveBaseUrl() },
  })
}

export function logout () {
  if (!client) return
  client.logout({ logoutParams: { returnTo: resolveBaseUrl() } })
}

export async function isAuthenticated () {
  const c = await initAuth0()
  if (!c) return false
  return c.isAuthenticated()
}

export async function getUser () {
  const c = await initAuth0()
  if (!c) return null
  return c.getUser()
}

export async function getToken () {
  const c = await initAuth0()
  if (!c) return null
  return c.getTokenSilently()
}

export function isAdmin (user) {
  const adminEmail = (env('VITE_ADMIN_EMAIL') || '').trim().toLowerCase()
  const userEmail = (user?.email || '').trim().toLowerCase()
  return Boolean(adminEmail && userEmail && adminEmail === userEmail)
}
