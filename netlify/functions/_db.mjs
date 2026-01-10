import { Pool } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || ''
const DATABASE_SSL = process.env.DATABASE_SSL

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

function resolveSslSetting () {
  const envSetting = parseBoolean(DATABASE_SSL)
  if (envSetting !== null) {
    return envSetting
  }
  const urlSetting = parseSslMode(DATABASE_URL)
  if (urlSetting !== null) {
    return urlSetting
  }
  return false
}

function buildPoolConfig () {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL mangler')
  }
  const useSsl = resolveSslSetting()
  return {
    connectionString: DATABASE_URL,
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
