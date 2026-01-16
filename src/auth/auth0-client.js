import { resolveAuthRedirectUri, resolveBaseUrl } from './resolve-base-url.js'
import { isAuthCallbackUrl } from './auth-callback.js'
import { getSavedOrgId, installOrgDebugHooks, saveOrgId } from './org-store.js'
import { hardClearUiLocks } from './ui-locks.js'
import { ensureUiInteractive } from '../ui/guards/ui-unlock.js'

let clientPromise = null
let auth0ModulePromise = null
let clientOverride = null
const BYPASS_USER = {
  sub: 'e2e|local',
  email: 'e2e@cssmate.local',
  name: 'E2E Test User',
  nickname: 'E2E',
}

function resolveAuth0ModulePath () {
  if (typeof window === 'undefined') {
    return new URL('../../js/vendor/auth0-spa-js.js', import.meta.url).href
  }
  return '/js/vendor/auth0-spa-js.js'
}

async function loadAuth0Module () {
  if (typeof window === 'undefined') {
    return {
      createAuth0Client: async () => ({
        isAuthenticated: async () => false,
        loginWithRedirect: async () => {},
        logout: async () => {},
        getUser: async () => null,
        getTokenSilently: async () => '',
        getIdTokenClaims: async () => ({}),
        handleRedirectCallback: async () => {},
      }),
    }
  }
  if (!auth0ModulePromise) {
    auth0ModulePromise = import(resolveAuth0ModulePath())
  }
  return auth0ModulePromise
}

function readEnvValue (value) {
  if (value == null) return ''
  const normalized = String(value).trim()
  return normalized
}

function readEnvFlag (value) {
  const normalized = readEnvValue(value).toLowerCase()
  return normalized === '1' || normalized === 'true'
}

function isE2eBypassEnabled () {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  const windowEnv = typeof window !== 'undefined' ? window : {}
  const env = windowEnv.__ENV__ ? windowEnv.__ENV__ : {}
  return readEnvFlag(
    metaEnv.VITE_E2E_BYPASS_AUTH
      || env.VITE_E2E_BYPASS_AUTH
      || windowEnv.VITE_E2E_BYPASS_AUTH
  )
}

function resolveConfig () {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  const windowEnv = typeof window !== 'undefined' ? window : {}
  const env = (windowEnv && windowEnv.__ENV__) ? windowEnv.__ENV__ : {}

  return {
    domain: readEnvValue(metaEnv.VITE_AUTH0_DOMAIN || env.VITE_AUTH0_DOMAIN || windowEnv.VITE_AUTH0_DOMAIN),
    clientId: readEnvValue(metaEnv.VITE_AUTH0_CLIENT_ID || env.VITE_AUTH0_CLIENT_ID || windowEnv.VITE_AUTH0_CLIENT_ID),
    audience: readEnvValue(metaEnv.VITE_AUTH0_AUDIENCE || env.VITE_AUTH0_AUDIENCE || windowEnv.VITE_AUTH0_AUDIENCE),
  }
}

function resolveOrgConfig () {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  const windowEnv = typeof window !== 'undefined' ? window : {}
  const env = (windowEnv && windowEnv.__ENV__) ? windowEnv.__ENV__ : {}
  const orgId = readEnvValue(metaEnv.VITE_AUTH0_ORG_ID || env.VITE_AUTH0_ORG_ID || windowEnv.VITE_AUTH0_ORG_ID)
  const orgSlug = readEnvValue(metaEnv.VITE_AUTH0_ORG_SLUG || env.VITE_AUTH0_ORG_SLUG || windowEnv.VITE_AUTH0_ORG_SLUG)
  const organization = orgId || orgSlug
  const source = orgId ? 'id' : (orgSlug ? 'slug' : '')
  return {
    orgId,
    orgSlug,
    organization,
    source,
    isConfigured: Boolean(organization),
  }
}

function resolveOrganizationForLogin () {
  const orgConfig = resolveOrgConfig()
  if (orgConfig.organization) return orgConfig.organization
  return getSavedOrgId() || ''
}

function buildAuthParams ({ redirectUri, audience }) {
  const params = { redirect_uri: redirectUri }
  if (audience) {
    params.audience = audience
  }
  return params
}

function decodeBase64 (value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  if (typeof atob === 'function') {
    return atob(padded)
  }
  return Buffer.from(padded, 'base64').toString('utf-8')
}

function parseJwtPayload (token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    return JSON.parse(decodeBase64(parts[1]))
  } catch {
    return null
  }
}

async function captureOrgId (client) {
  if (!client) return
  let orgId = ''
  if (typeof client.getIdTokenClaims === 'function') {
    try {
      const claims = await client.getIdTokenClaims()
      orgId = claims?.org_id || ''
    } catch {}
  }

  if (!orgId && typeof client.getTokenSilently === 'function') {
    try {
      const accessToken = await client.getTokenSilently()
      const payload = parseJwtPayload(accessToken)
      orgId = payload?.org_id || ''
    } catch {}
  }

  if (orgId) {
    saveOrgId(orgId)
  }
}

function resolveAuth0Config () {
  const { domain, clientId, audience } = resolveConfig()
  return {
    domain,
    clientId,
    audience,
    redirectUri: resolveAuthRedirectUri(),
    isConfigured: Boolean(domain && clientId),
  }
}

function logAuth0ConfigStatus (isConfigured) {
  if (typeof window === 'undefined') return
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  const isProd = Boolean(metaEnv.PROD)
  const message = `Auth0 configured: ${isConfigured ? 'yes' : 'no'}`
  if (isProd || !isProd) {
    console.info(message)
  }
}

function resolveAppState (appState) {
  if (appState) return appState
  if (typeof window === 'undefined') return appState
  const path = window.location?.pathname || '/'
  const returnTo = path === '/callback' ? '/' : path
  return { returnTo }
}

export async function getClient () {
  if (clientOverride) return clientOverride
  if (clientPromise) return clientPromise

  clientPromise = (async () => {
    if (isE2eBypassEnabled()) {
      return {
        isAuthenticated: async () => true,
        loginWithRedirect: async () => {},
        logout: async () => {},
        getUser: async () => BYPASS_USER,
        getTokenSilently: async () => 'e2e-token',
        getIdTokenClaims: async () => ({}),
        handleRedirectCallback: async () => {},
      }
    }
    try {
      installOrgDebugHooks()
      const { createAuth0Client } = await loadAuth0Module()
      const { domain, clientId, audience, redirectUri, isConfigured } = resolveAuth0Config()
      const orgConfig = resolveOrgConfig()
      logAuth0ConfigStatus(isConfigured)
      if (!isConfigured) {
        if (typeof window !== 'undefined') {
          throw new Error('Auth0 config mangler. Tjek VITE_AUTH0_DOMAIN og VITE_AUTH0_CLIENT_ID.')
        }
      }

      const client = await createAuth0Client({
        domain: domain || 'test.local',
        clientId: clientId || 'test',
        authorizationParams: {
          ...buildAuthParams({ redirectUri, audience }),
          ...(orgConfig.organization ? { organization: orgConfig.organization } : {}),
        },
        cacheLocation: 'localstorage',
        useRefreshTokens: true,
      })

      if (typeof window !== 'undefined') {
        if (isAuthCallbackUrl()) {
          const { appState } = await client.handleRedirectCallback()
          await captureOrgId(client)
          hardClearUiLocks()
          if (typeof document !== 'undefined') {
            ensureUiInteractive('post-callback')
          }
          const returnTo = appState?.returnTo || window.location.pathname
          window.history.replaceState({}, document.title, returnTo)
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

async function startLogin ({ appState, authorizationParams = {} } = {}) {
  const client = await getClient()
  const { audience, redirectUri } = resolveAuth0Config()
  const organization = resolveOrganizationForLogin()
  await client.loginWithRedirect({
    appState: resolveAppState(appState),
    authorizationParams: {
      ...buildAuthParams({ redirectUri, audience }),
      ...authorizationParams,
      ...(organization ? { organization } : {}),
    },
  })
}

export async function login (appState) {
  return startLogin({ appState })
}

export async function signup (appState) {
  return startLogin({
    appState,
    authorizationParams: { screen_hint: 'signup' },
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
  const { audience } = resolveConfig()
  if (audience) {
    return client.getTokenSilently({ authorizationParams: { audience } })
  }
  return client.getTokenSilently()
}

export const __test__ = {
  setClient (client) {
    clientOverride = client
    clientPromise = Promise.resolve(client)
  },
  getOrgConfig () {
    return resolveOrgConfig()
  },
  resetClient () {
    clientOverride = null
    clientPromise = null
    auth0ModulePromise = null
  },
}

export function getOrganizationConfig () {
  return resolveOrgConfig()
}
