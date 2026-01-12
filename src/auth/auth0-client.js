import createAuth0Client from '@auth0/auth0-spa-js'
import { resolveBaseUrl } from './resolve-base-url.js'

let clientPromise = null

function readEnvValue (value) {
  if (value == null) return ''
  const normalized = String(value).trim()
  return normalized
}

function resolveConfig () {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  const windowEnv = typeof window !== 'undefined' ? window : {}

  return {
    domain: readEnvValue(metaEnv.VITE_AUTH0_DOMAIN || windowEnv.VITE_AUTH0_DOMAIN),
    clientId: readEnvValue(metaEnv.VITE_AUTH0_CLIENT_ID || windowEnv.VITE_AUTH0_CLIENT_ID),
  }
}

export async function getClient () {
  if (clientPromise) return clientPromise

  clientPromise = (async () => {
    try {
      const { domain, clientId } = resolveConfig()
      if (!domain || !clientId) {
        throw new Error('Auth0 config mangler. Tjek VITE_AUTH0_DOMAIN og VITE_AUTH0_CLIENT_ID.')
      }

      const redirectUri = resolveBaseUrl()
      const client = await createAuth0Client({
        domain,
        clientId,
        authorizationParams: {
          redirect_uri: redirectUri,
        },
        cacheLocation: 'localstorage',
        useRefreshTokens: true,
      })

      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        if (params.has('code') && params.has('state')) {
          await client.handleRedirectCallback()
          window.history.replaceState({}, document.title, window.location.pathname)
        }
      }

      return client
    } catch (error) {
      clientPromise = null
      throw error
    }
  })()

  return clientPromise
}

export async function initAuth0 () {
  return getClient()
}

export async function login (appState) {
  const client = await getClient()
  await client.loginWithRedirect({
    appState,
    authorizationParams: { redirect_uri: resolveBaseUrl() },
  })
}

export async function signup (appState) {
  const client = await getClient()
  await client.loginWithRedirect({
    appState,
    authorizationParams: { redirect_uri: resolveBaseUrl(), screen_hint: 'signup' },
  })
}

export async function logout () {
  const client = await getClient()
  await client.logout({ logoutParams: { returnTo: resolveBaseUrl() } })
}

export async function isAuthenticated () {
  const client = await getClient()
  return client.isAuthenticated()
}

export async function getUser () {
  const client = await getClient()
  return client.getUser()
}

export async function getToken () {
  const client = await getClient()
  return client.getTokenSilently()
}
