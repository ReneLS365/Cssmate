import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const encoder = new TextEncoder()
let jwks = null

function resolveAuth0Domain () {
  const raw = process.env.AUTH0_DOMAIN || process.env.AUTH0_ISSUER || ''
  if (!raw) return ''
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      return new URL(raw).hostname
    } catch {
      return ''
    }
  }
  return raw
}

function resolveAuth0Issuer () {
  const raw = process.env.AUTH0_ISSUER || process.env.AUTH0_DOMAIN || ''
  if (!raw) return ''
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw.replace(/\/+$/, '')
  }
  return `https://${raw}`
}

function resolveAuth0Audience () {
  return String(process.env.AUTH0_AUDIENCE || '').trim()
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
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer,
    audience,
  })
  return payload
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
