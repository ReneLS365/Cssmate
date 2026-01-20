import { getAuth0Config, verifyToken } from './_auth.mjs'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
let cachedToken = ''
let cachedTokenExpiry = 0

function jsonResponse (statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload ?? {}),
  }
}

function getAuthHeader (event) {
  const headers = event.headers || {}
  return headers.authorization || headers.Authorization || ''
}

async function readJsonSafe (response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function normalizeClaimList (value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function extractRoles (payload) {
  return normalizeClaimList(payload?.['https://sscaff.app/roles'] || payload?.roles)
}

function extractOrgId (payload) {
  return payload?.['https://sscaff.app/org_id'] || payload?.org_id || ''
}

function resolveAuth0Domain () {
  return getAuth0Config().domain || ''
}

function resolveManagementAudience (domain) {
  const explicit = String(process.env.AUTH0_MGMT_AUDIENCE || '').trim()
  if (explicit) return explicit
  return `https://${domain}/api/v2/`
}

async function getManagementToken () {
  const now = Date.now()
  if (cachedToken && cachedTokenExpiry > now + 60_000) {
    return cachedToken
  }

  const domain = resolveAuth0Domain()
  const clientId = process.env.AUTH0_MGMT_CLIENT_ID || ''
  const clientSecret = process.env.AUTH0_MGMT_CLIENT_SECRET || ''
  if (!domain || !clientId || !clientSecret) {
    const error = new Error('Auth0 management credentials mangler')
    error.code = 'auth0_mgmt_unconfigured'
    throw error
  }
  const audience = resolveManagementAudience(domain)
  const response = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      audience,
    }),
  })

  if (!response.ok) {
    const error = new Error('Kunne ikke hente Auth0 management token')
    error.code = 'auth0_mgmt_failed'
    throw error
  }

  const payload = await readJsonSafe(response)
  if (!payload) {
    const error = new Error('Kunne ikke læse Auth0 management token')
    error.code = 'auth0_mgmt_invalid_json'
    throw error
  }
  cachedToken = payload?.access_token || ''
  const expiresIn = Number(payload?.expires_in || 0)
  cachedTokenExpiry = now + expiresIn * 1000
  return cachedToken
}

async function listOrganizationMembers (orgId) {
  const domain = resolveAuth0Domain()
  const token = await getManagementToken()
  const url = new URL(`https://${domain}/api/v2/organizations/${encodeURIComponent(orgId)}/members`)
  url.searchParams.set('fields', 'user_id,email,name')
  url.searchParams.set('include_fields', 'true')
  url.searchParams.set('per_page', '100')

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const error = new Error('Kunne ikke hente Auth0 members')
    error.code = 'auth0_mgmt_failed'
    throw error
  }
  const members = await readJsonSafe(response)
  return Array.isArray(members) ? members : []
}

export async function handler (event) {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  const header = getAuthHeader(event)
  if (!header.startsWith('Bearer ')) {
    return jsonResponse(401, { error: 'Manglende token', code: 'auth_missing_token' })
  }

  const token = header.replace('Bearer ', '').trim()
  let payload
  try {
    payload = await verifyToken(token)
  } catch (error) {
    return jsonResponse(401, { error: error?.message || 'Ugyldigt token', code: error?.code || 'auth_invalid_token' })
  }

  const roles = extractRoles(payload)
  const isAdmin = roles.includes('sscaff_owner') || roles.includes('sscaff_admin')
  if (!isAdmin) {
    return jsonResponse(403, { error: 'Ingen adgang', code: 'auth_forbidden' })
  }

  const orgId = extractOrgId(payload)
  if (!orgId) {
    return jsonResponse(400, { error: 'Mangler org_id', code: 'auth_missing_org' })
  }

  try {
    const members = await listOrganizationMembers(orgId)
    const sanitized = members.map(member => ({
      user_id: member?.user_id || '',
      email: member?.email || '',
      name: member?.name || '',
    }))
    return jsonResponse(200, { members: sanitized })
  } catch (error) {
    return jsonResponse(500, { error: 'Kunne ikke hente medlemmer', code: error?.code || 'auth0_mgmt_failed' })
  }
}
