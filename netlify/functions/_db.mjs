import { existsSync } from 'node:fs'
import { readFile } from 'fs/promises'
import { Pool } from 'pg'
import pathHelper from './_path.cjs'

const DATABASE_SSL = process.env.DATABASE_SSL
const DATABASE_URL_CANDIDATES = [
  process.env.DATABASE_URL,
  process.env.NETLIFY_DATABASE_URL,
  process.env.NETLIFY_DATABASE_URL_UNPOOLED,
]

let pool = null
let migrationPromise = null
let migrationsEnsured = false

const { resolveFromFunctionsDir } = pathHelper
const MIGRATIONS_DIR = resolveFromFunctionsDir('migrations')

async function readMigrationFile (name) {
  const filePath = resolveFromFunctionsDir('migrations', name)
  if (!existsSync(filePath)) {
    throw new Error(
      `Missing migration file: ${filePath}. Ensure netlify.toml functions.included_files includes netlify/functions/migrations/*.sql`
    )
  }
  return readFile(filePath, 'utf8')
}

async function ensureMigrations () {
  if (migrationPromise) return migrationPromise
  migrationPromise = (async () => {
    const client = await pool.connect()
    try {
      const usersResult = await client.query("SELECT to_regclass('public.users') AS table_name")
      const hasUsersTable = Boolean(usersResult.rows[0]?.table_name)
      const slugResult = await client.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'teams' AND column_name = 'slug'`
      )
      const hasTeamSlug = slugResult.rowCount > 0
      const inviteTokenHintResult = await client.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'team_invites' AND column_name = 'token_hint'`
      )
      const hasInviteTokenHint = inviteTokenHintResult.rowCount > 0
      const lastLoginResult = await client.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'team_members' AND column_name = 'last_login_at'`
      )
      const hasMemberLastLogin = lastLoginResult.rowCount > 0
      if (hasUsersTable && hasTeamSlug && hasInviteTokenHint && hasMemberLastLogin) {
        migrationsEnsured = true
        return
      }

      console.log('[migrations] using dir =', MIGRATIONS_DIR)
      const migrations = await Promise.all([
        readMigrationFile('001_init.sql'),
        readMigrationFile('002_add_team_slug.sql'),
        readMigrationFile('003_auth0_invites.sql'),
        readMigrationFile('004_add_team_member_login.sql'),
      ])
      await client.query('BEGIN')
      for (const sql of migrations) {
        if (sql?.trim()) {
          await client.query(sql)
        }
      }
      await client.query('COMMIT')
      migrationsEnsured = true
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // ignore rollback errors
      }
      migrationPromise = null
      migrationsEnsured = false
      throw error
    } finally {
      client.release()
    }
  })()
  return migrationPromise
}

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

export async function getPoolRaw () {
  if (!pool) {
    pool = new Pool(buildPoolConfig())
  }
  return pool
}

export async function getPool () {
  await getPoolRaw()
  if (!migrationsEnsured) {
    await ensureMigrations()
  }
  return pool
}

export async function isDbReady () {
  const activePool = await getPoolRaw()
  const client = await activePool.connect()
  try {
    const tableResult = await client.query(
      `SELECT
         to_regclass('public.teams') IS NOT NULL AS has_teams,
         to_regclass('public.team_members') IS NOT NULL AS has_team_members,
         to_regclass('public.team_invites') IS NOT NULL AS has_team_invites`
    )
    const row = tableResult.rows[0]
    if (!row?.has_teams || !row?.has_team_members || !row?.has_team_invites) {
      return false
    }
    const columnResult = await client.query(
      `SELECT
         SUM(CASE WHEN table_name = 'teams' AND column_name = 'slug' THEN 1 ELSE 0 END) > 0 AS has_team_slug,
         SUM(CASE WHEN table_name = 'team_members' AND column_name = 'last_login_at' THEN 1 ELSE 0 END) > 0 AS has_member_last_login
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (
           (table_name = 'teams' AND column_name = 'slug')
           OR (table_name = 'team_members' AND column_name = 'last_login_at')
         )`
    )
    return Boolean(columnResult.rows[0]?.has_team_slug && columnResult.rows[0]?.has_member_last_login)
  } finally {
    client.release()
  }
}

export async function ensureDbReady () {
  await getPoolRaw()
  await ensureMigrations()
  return isDbReady()
}

export async function query (text, params) {
  const client = await (await getPool()).connect()
  try {
    return await client.query(text, params)
  } finally {
    client.release()
  }
}

export async function withTransaction (handler) {
  const client = await (await getPool()).connect()
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
