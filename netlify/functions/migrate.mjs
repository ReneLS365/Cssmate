import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { getPoolRaw } from './_db.mjs'
import pathHelper from './_path.cjs'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const MIGRATION_FILES = [
  '001_init.sql',
  '002_add_team_slug.sql',
  '003_auth0_invites.sql',
  '004_add_team_member_login.sql',
]

const { resolveFromFunctionsDir } = pathHelper

function jsonResponse (statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload ?? {}),
  }
}

function resolveHeader (headers, name) {
  if (!headers) return ''
  return headers[name] || headers[name.toLowerCase()] || ''
}

async function readMigrationFile (name) {
  const filePath = resolveFromFunctionsDir('migrations', name)
  if (!existsSync(filePath)) {
    throw new Error(`Missing migration file: ${filePath}`)
  }
  return readFile(filePath, 'utf8')
}

export async function handler (event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }
  const expectedKey = String(process.env.MIGRATION_KEY || '').trim()
  if (!expectedKey) {
    console.warn('MIGRATION_KEY mangler. Migrations-endpoint er slået fra.')
    return jsonResponse(500, { error: 'Migration key ikke konfigureret.' })
  }
  const providedKey = resolveHeader(event.headers || {}, 'x-migration-key')
  if (!providedKey || providedKey !== expectedKey) {
    return jsonResponse(401, { error: 'Ugyldig migrationsnøgle.' })
  }

  const pool = await getPoolRaw()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const name of MIGRATION_FILES) {
      const sql = await readMigrationFile(name)
      if (sql?.trim()) {
        await client.query(sql)
      }
    }
    await client.query('COMMIT')
    return jsonResponse(200, { ok: true })
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore rollback errors
    }
    console.warn('[migrations] kørsel fejlede', error)
    return jsonResponse(500, { error: 'Kunne ikke køre migrations.' })
  } finally {
    client.release()
  }
}
