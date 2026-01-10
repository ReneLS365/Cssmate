import { createHash, randomBytes } from 'crypto'
import { jwtVerify, SignJWT } from 'jose'

const encoder = new TextEncoder()

function getJwtSecret () {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET mangler')
  }
  return encoder.encode(secret)
}

export async function signToken ({ userId, email }) {
  const secret = getJwtSecret()
  return await new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret)
}

export async function verifyToken (token) {
  const secret = getJwtSecret()
  const { payload } = await jwtVerify(token, secret)
  return payload
}

export function generateToken () {
  const raw = randomBytes(32)
  return raw.toString('base64url')
}

export function hashToken (token) {
  return createHash('sha256').update(token).digest('hex')
}

