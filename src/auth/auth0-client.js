import { resolveAuthRedirectUri, resolveBaseUrl } from './resolve-base-url.js'
import { isAuthCallbackUrl } from './auth-callback.js'
import { getSavedOrgId, installOrgDebugHooks, saveOrgId } from './org-store.js'
import { hardClearUiLocks } from './ui-locks.js'
import { ensureUiInteractive } from '../ui/guards/ui-unlock.js'
import { isLighthouseMode } from '../config/lighthouse-mode.js'

let clientPromise = null
let auth0ModulePromise = null
let clientOverride = null
const BYPASS_USER = {
  sub: 'e2e|local',
  email: 'e2e@cssmate.local',
  name: 'E2E Test User',
  nickname: 'E2E',
}

function createFallbackClient ({
  isAuthenticated = false,
  user = null,
  token = '',
  idTokenClaims = null,
} = {}) {
  return {
    isAuthenticated: async () => isAuthenticated,
    loginWithRedirect: async () => {},
    logout: async () => {},
    getUser: async () => user,
    getTokenSilently: async () => token,
    getIdTokenClaims: async () => idTokenClaims,
    handleRedirectCallback: async () => {},
  }
}

const ORG_ID_PATTERN = /^org_[A-Za-z0-9]+$/
const ORG_SLUG_PATTERN = /^[a-z0-9][a-z0-9-_]{1,62}$/i
const AUTH0_DOMAIN_PATTERN = /\.auth0\.com$/i
const INVITATION_PATTERN = /^inv_[A-Za-z0-9]+$/i

function resolveAuth0ModulePath () {
  if (typeof window === 'undefined') {
    return new URL('../../js/vendor/auth0-spa-js.js', import.meta.url).href
  }
  return '/js/vendor/auth0-spa-js.js'
}

async function loadAuth0Module () {
  if (typeof window === 'undefined') {
    return {
      createAuth0Client: async () => createFallbackClient({ idTokenClaims: {} }),
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

function normalizeAuth0Domain (domain) {
  if (!domain) return ''
  const stripped = domain.replace(/^https?:\/\//i, '').trim()
  return stripped.replace(/\/.*$/, '')
}

function warnIfUnexpectedDomain (domain) {
  if (!domain) return
  if (AUTH0_DOMAIN_PATTERN.test(domain)) return
  console.warn(`[auth0] Domain "${domain}" matcher ikke *.auth0.com. Kontroller tenant eller custom domain.`)
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
  const orgId = readEnvValue(
    metaEnv.VITE_AUTH0_ORG_ID
      || metaEnv.VITE_AUTH0_ORGANIZATION_ID
      || env.VITE_AUTH0_ORG_ID
      || env.VITE_AUTH0_ORGANIZATION_ID
      || windowEnv.VITE_AUTH0_ORG_ID
      || windowEnv.VITE_AUTH0_ORGANIZATION_ID
  )
  const orgSlug = readEnvValue(
    metaEnv.VITE_AUTH0_ORG_SLUG
      || metaEnv.VITE_AUTH0_ORGANIZATION_SLUG
      || env.VITE_AUTH0_ORG_SLUG
      || env.VITE_AUTH0_ORGANIZATION_SLUG
      || windowEnv.VITE_AUTH0_ORG_SLUG
      || windowEnv.VITE_AUTH0_ORGANIZATION_SLUG
  )
  const orgIdValid = ORG_ID_PATTERN.test(orgId)
  const orgSlugValid = ORG_SLUG_PATTERN.test(orgSlug)
  const organization = orgIdValid ? orgId : (orgSlugValid ? orgSlug : '')
  const source = orgIdValid ? 'id' : (orgSlugValid ? 'slug' : '')
  if (orgId && !orgIdValid) {
    console.warn(`[auth0] VITE_AUTH0_ORG_ID matcher ikke org_ format: "${orgId}".`)
  }
  if (orgSlug && !orgSlugValid) {
    console.warn(`[auth0] VITE_AUTH0_ORG_SLUG matcher ikke forventet slug-format: "${orgSlug}".`)
  }
  return {
    orgId,
    orgSlug,
    organization,
    source,
    isConfigured: Boolean(organization),
  }
}

function normalizeOrganizationParam (value) {
  const normalized = readEnvValue(value)
  if (!normalized) return ''
  if (ORG_ID_PATTERN.test(normalized)) return normalized
  if (ORG_SLUG_PATTERN.test(normalized)) return normalized
  console.warn(`[auth0] Ignorerer organization-param "${normalized}" (ugyldigt format).`)
  return ''
}

function getInviteAuthorizationParams () {
  if (typeof window === 'undefined') return {}
  const params = new URLSearchParams(window.location.search || '')
  const invitationRaw = readEnvValue(params.get('invitation'))
  const invitation = INVITATION_PATTERN.test(invitationRaw) ? invitationRaw : ''
  if (invitationRaw && !invitation) {
    console.warn(`[auth0] Ignorerer invitation-param "${invitationRaw}" (ugyldigt format).`)
  }
  const organization = normalizeOrganizationParam(params.get('organization'))
  const returnTo = readEnvValue(params.get('returnTo'))
  return {
    invitation,
    organization,
    returnTo,
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
  const normalizedDomain = normalizeAuth0Domain(domain)
  warnIfUnexpectedDomain(normalizedDomain)
  return {
    domain: normalizedDomain,
    clientId,
    audience,
    redirectUri: resolveAuthRedirectUri(),
    isConfigured: Boolean(normalizedDomain && clientId),
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
  const { returnTo } = getInviteAuthorizationParams()
  const path = window.location?.pathname || '/'
  const returnTarget = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
    ? returnTo
    : (path === '/callback' ? '/' : path)
  return { returnTo: returnTarget }
}

export async function getClient () {
  if (clientOverride) return clientOverride
  if (clientPromise) return clientPromise

  clientPromise = (async () => {
    if (isLighthouseMode()) {
      return createFallbackClient()
    }
    if (isE2eBypassEnabled()) {
      return createFallbackClient({
        isAuthenticated: true,
        user: BYPASS_USER,
        token: 'e2e-token',
        idTokenClaims: {},
      })
    }
    try {
      installOrgDebugHooks()
      const { createAuth0Client } = await loadAuth0Module()
      const { domain, clientId, audience, redirectUri, isConfigured } = resolveAuth0Config()
      const orgConfig = resolveOrgConfig()
      logAuth0ConfigStatus(isConfigured)
      if (!isConfigured) {
        if (typeof window !== 'undefined') {
          console.warn('[auth0] Mangler domain eller client id. Tjek VITE_AUTH0_DOMAIN og VITE_AUTH0_CLIENT_ID.')
          hardClearUiLocks()
          if (typeof document !== 'undefined') {
            ensureUiInteractive('auth0-missing-config')
          }
        }
        return createFallbackClient()
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
      hardClearUiLocks()
      if (typeof document !== 'undefined') {
        ensureUiInteractive('auth0-init-error')
      }
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
  const inviteParams = getInviteAuthorizationParams()
  const organization = inviteParams.organization || resolveOrganizationForLogin()
  await client.loginWithRedirect({
    appState: resolveAppState(appState),
    authorizationParams: {
      ...buildAuthParams({ redirectUri, audience }),
      ...authorizationParams,
      ...(organization ? { organization } : {}),
      ...(inviteParams.invitation ? { invitation: inviteParams.invitation } : {}),
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
  const authed = await client.isAuthenticated()
  if (authed) {
    hardClearUiLocks()
    if (typeof document !== 'undefined') {
      ensureUiInteractive('auth0-is-authenticated')
    }
  }
  return authed
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
