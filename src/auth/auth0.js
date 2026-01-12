import { createAuth0Client } from '../../js/vendor/auth0-spa-js.js'
import { resolveBaseUrl } from './resolve-base-url.js'
import { isAutomated } from '../config/runtime-modes.js'

let auth0Client = null
let initPromise = null

function readEnvValue (...values) {
  for (const value of values) {
    if (value == null) continue
    const normalized = String(value).trim()
    if (normalized) return normalized
  }
  return ''
}

function resolveEnv () {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  const processEnv = typeof process !== 'undefined' && process.env ? process.env : {}
  const windowEnv = typeof window !== 'undefined' ? window : {}

  return {
    domain: readEnvValue(
      metaEnv.VITE_AUTH0_DOMAIN,
      processEnv.VITE_AUTH0_DOMAIN,
      windowEnv.VITE_AUTH0_DOMAIN,
      windowEnv.AUTH0_DOMAIN
    ),
    clientId: readEnvValue(
      metaEnv.VITE_AUTH0_CLIENT_ID,
      processEnv.VITE_AUTH0_CLIENT_ID,
      windowEnv.VITE_AUTH0_CLIENT_ID,
      windowEnv.AUTH0_CLIENT_ID
    ),
    audience: readEnvValue(
      metaEnv.VITE_AUTH0_AUDIENCE,
      processEnv.VITE_AUTH0_AUDIENCE,
      windowEnv.VITE_AUTH0_AUDIENCE,
      windowEnv.AUTH0_AUDIENCE
    ),
    adminEmail: readEnvValue(
      metaEnv.VITE_ADMIN_EMAIL,
      processEnv.VITE_ADMIN_EMAIL,
      windowEnv.VITE_ADMIN_EMAIL,
      windowEnv.ADMIN_EMAIL
    ),
  }
}

function requireAuth0Config () {
  const env = resolveEnv()
  if (!env.domain || !env.clientId) {
    const error = new Error('Auth0 config mangler. Tjek VITE_AUTH0_DOMAIN og VITE_AUTH0_CLIENT_ID.')
    error.code = 'auth0/missing-config'
    throw error
  }
  return env
}

export async function initAuth () {
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      const env = requireAuth0Config()
      const baseUrl = resolveBaseUrl()
      const auth0 = await createAuth0Client({
        domain: env.domain,
        clientId: env.clientId,
        authorizationParams: {
          redirect_uri: baseUrl,
          audience: env.audience || undefined,
        },
        cacheLocation: 'localstorage',
        useRefreshTokens: true,
      })

      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        if (params.has('code') && params.has('state')) {
          await auth0.handleRedirectCallback()
          window.history.replaceState({}, document.title, window.location.pathname)
        }
      }

      auth0Client = auth0
      return auth0
    } catch (error) {
      if (isAutomated()) {
        return null
      }
      throw error
    }
  })()
  return initPromise
}

async function getClient () {
  if (auth0Client) return auth0Client
  return initAuth()
}

export async function login () {
  const auth0 = await getClient()
  if (!auth0) return
  return auth0.loginWithRedirect()
}

export async function logout () {
  const auth0 = await getClient()
  if (!auth0) return
  const returnTo = resolveBaseUrl()
  return auth0.logout({ logoutParams: { returnTo } })
}

export async function isAuthenticated () {
  const auth0 = await getClient()
  if (!auth0) return false
  return auth0.isAuthenticated()
}

export async function getUser () {
  const auth0 = await getClient()
  if (!auth0) return null
  return auth0.getUser()
}

export function isAdmin (user) {
  const adminEmail = resolveEnv().adminEmail.toLowerCase()
  if (!adminEmail) return false
  const userEmail = (user?.email || '').toString().trim().toLowerCase()
  return userEmail === adminEmail
}

export async function getAccessTokenSilently () {
  const auth0 = await getClient()
  if (!auth0) return null
  return auth0.getTokenSilently()
}
