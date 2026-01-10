import { Pool } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || ''

let pool = null

function normalizeSslMode () {
  const rawMode = process.env.DATABASE_SSLMODE || process.env.PGSSLMODE || ''
  const mode = rawMode.trim().toLowerCase()
  if (mode === 'disable' || mode === 'allow' || mode === 'prefer') {
    return 'disable'
  }
  if (mode) {
    return 'require'
  }
  const rawFlag = process.env.DATABASE_SSL || ''
  const flag = rawFlag.trim().toLowerCase()
  if (flag === 'true' || flag === '1' || flag === 'require') {
    return 'require'
  }
  if (flag === 'false' || flag === '0' || flag === 'disable') {
    return 'disable'
  }
  return ''
}

function buildPoolConfig () {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL mangler')
  }
  const sslMode = normalizeSslMode()
  const ssl = sslMode === 'require' ? { rejectUnauthorized: false } : undefined
  return {
    connectionString: DATABASE_URL,
    ssl,
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
