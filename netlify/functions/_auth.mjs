import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const encoder = new TextEncoder()
let jwks = null

function env (name) {
  return String(process.env[name] || '').trim()
}

function normalizeAuth0Domain (raw) {
  if (!raw) return ''
  return raw.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

function normalizeAuth0Issuer (raw) {
  if (!raw) return ''
  // Accept either full URL or bare domain, but ALWAYS return issuer with exactly one trailing slash.
  try {
    const url = raw.startsWith('http') ? new URL(raw) : new URL(`https://${raw}`)
    return `${url.origin}/`
  } catch {
    return ''
  }
}

export function getAuth0Config () {
  const rawIssuer = env('AUTH0_ISSUER')
  const rawDomain = env('AUTH0_DOMAIN')
  const audience = env('AUTH0_AUDIENCE')
  const issuer = normalizeAuth0Issuer(rawIssuer || rawDomain)
  const domain = normalizeAuth0Domain(rawDomain || rawIssuer)
  return { issuer, audience, domain }
}

function getJwks () {
  if (jwks) return jwks
  const { domain } = getAuth0Config()
  if (!domain) {
    const error = new Error('AUTH0_DOMAIN mangler')
    error.code = 'auth_config'
    throw error
  }
  jwks = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`))
  return jwks
}

export async function verifyToken (token) {
  const { issuer, audience } = getAuth0Config()
  if (!issuer || !audience) {
    const error = new Error('AUTH0_ISSUER eller AUTH0_AUDIENCE mangler')
    error.code = 'auth_config'
    throw error
  }
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer,
      audience,
    })
    return payload
  } catch (err) {
    // Friendlier hint for the common issuer/audience mismatch cases
    const msg = String(err?.message || '')
    if (msg.includes('"iss"') || msg.includes('"aud"')) {
      const error = new Error(`${msg} (Tjek at AUTH0_ISSUER/AUTH0_DOMAIN og AUTH0_AUDIENCE matcher din Auth0 tenant og API Identifier)`)
      error.code = 'auth_invalid_claims'
      throw error
    }
    if (err?.code === 'ERR_JWT_EXPIRED') {
      const error = new Error('Token er udløbet. Log ind igen.')
      error.code = 'auth_token_expired'
      throw error
    }
    throw err
  }
}

export function generateToken () {
  const raw = randomBytes(32)
  return raw.toString('base64url')
}

export function hashToken (token) {
  return createHash('sha256').update(token).digest('hex')
}

export function secureCompare (left, right) {
  if (!left || !right) return false
  const leftBuffer = encoder.encode(String(left))
  const rightBuffer = encoder.encode(String(right))
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}
