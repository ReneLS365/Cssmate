import { Pool } from 'pg'

let pool = null

function buildPoolConfig () {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL mangler')
  }
  const sslRequired = process.env.DATABASE_SSL === 'true'
  return {
    connectionString,
    ssl: sslRequired ? { rejectUnauthorized: false } : undefined,
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
