import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const encoder = new TextEncoder()
let jwks = null

function env (name) {
  return String(process.env[name] || '').trim()
}

function resolveAuth0Domain () {
  const raw = (env('AUTH0_DOMAIN') || env('VITE_AUTH0_DOMAIN') || '').trim()
  if (raw) return raw.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const issuer = (env('AUTH0_ISSUER') || env('VITE_AUTH0_ISSUER') || '').trim()
  if (issuer) {
    try {
      const url = issuer.startsWith('http') ? new URL(issuer) : new URL(`https://${issuer}`)
      return url.hostname
    } catch {
      return ''
    }
  }
  return ''
}

function resolveAuth0Issuer () {
  const raw =
    env('AUTH0_ISSUER') ||
    env('VITE_AUTH0_ISSUER') ||
    env('AUTH0_DOMAIN') ||
    env('VITE_AUTH0_DOMAIN') ||
    ''
  if (!raw) return ''

  // Accept either full URL or bare domain, but ALWAYS return issuer with exactly one trailing slash.
  try {
    const url = raw.startsWith('http') ? new URL(raw) : new URL(`https://${raw}`)
    return `${url.origin}/`
  } catch {
    return ''
  }
}

function resolveAuth0Audience () {
  return (env('AUTH0_AUDIENCE') || env('VITE_AUTH0_AUDIENCE') || '').trim()
}

function getJwks () {
  if (jwks) return jwks
  const domain = resolveAuth0Domain()
  if (!domain) {
    throw new Error('AUTH0_DOMAIN mangler')
  }
  jwks = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`))
  return jwks
}

export async function verifyToken (token) {
  const issuer = resolveAuth0Issuer()
  const audience = resolveAuth0Audience()
  if (!issuer || !audience) {
    throw new Error('AUTH0_ISSUER eller AUTH0_AUDIENCE mangler')
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
      throw new Error(`${msg} (Tjek at AUTH0_ISSUER/AUTH0_DOMAIN og AUTH0_AUDIENCE matcher din Auth0 tenant og API Identifier)`)
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
