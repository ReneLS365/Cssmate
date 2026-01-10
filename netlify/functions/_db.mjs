import { Pool } from 'pg'

const DATABASE_SSL = process.env.DATABASE_SSL
const DATABASE_URL_CANDIDATES = [
  process.env.DATABASE_URL,
  process.env.NETLIFY_DATABASE_URL,
  process.env.NETLIFY_DATABASE_URL_UNPOOLED,
]

let pool = null

function parseBoolean (value) {
  if (!value) {
    return null
  }
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on', 'require'].includes(normalized)) {
    return true
  }
  if (['0', 'false', 'no', 'off', 'disable'].includes(normalized)) {
    return false
  }
  return null
}

function parseSslMode (urlString) {
  try {
    const url = new URL(urlString)
    const sslmode = url.searchParams.get('sslmode')
    if (!sslmode) {
      return null
    }
    if (sslmode.toLowerCase() === 'disable') {
      return false
    }
    return true
  } catch {
    return null
  }
}

function resolveDatabaseUrl () {
  const candidates = DATABASE_URL_CANDIDATES.filter(Boolean)
  for (const candidate of candidates) {
    const trimmed = String(candidate).trim()
    if (!trimmed || trimmed.toLowerCase() === 'base') continue
    try {
      const parsed = new URL(trimmed)
      if (parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:') {
        return trimmed
      }
    } catch {
      continue
    }
  }
  return ''
}

function resolveSslSetting (databaseUrl) {
  const envSetting = parseBoolean(DATABASE_SSL)
  if (envSetting !== null) {
    return envSetting
  }
  const urlSetting = parseSslMode(databaseUrl)
  if (urlSetting !== null) {
    return urlSetting
  }
  return false
}

function buildPoolConfig () {
  const databaseUrl = resolveDatabaseUrl()
  if (!databaseUrl) {
    const missingKeys = [
      'DATABASE_URL',
      'NETLIFY_DATABASE_URL',
      'NETLIFY_DATABASE_URL_UNPOOLED',
    ].filter((key) => !process.env[key])
    console.warn('Database URL mangler. Mangler env vars:', missingKeys.join(', ') || 'ukendt')
    throw new Error('Database URL mangler. Sæt DATABASE_URL eller NETLIFY_DATABASE_URL(_UNPOOLED).')
  }
  const useSsl = resolveSslSetting(databaseUrl)
  return {
    connectionString: databaseUrl,
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  }
}

export function getPool () {
  if (!pool) {
    pool = new Pool(buildPoolConfig())
  }
  return pool
}

export async function query (text, params) {
  const client = await getPool().connect()
  try {
    return await client.query(text, params)
  } finally {
    client.release()
  }
}

export async function withTransaction (handler) {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await handler(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore rollback errors
    }
    throw error
  } finally {
    client.release()
  }
}

export const db = {
  getPool,
  query,
  withTransaction,
}
