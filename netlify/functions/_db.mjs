import { existsSync } from 'node:fs'
import { readFile } from 'fs/promises'
import { Pool } from 'pg'
import pathHelper from './_path.cjs'
import { sanitizeObject, safeError } from './_log.mjs'

const DATABASE_SSL = process.env.DATABASE_SSL
const DATABASE_URL_CANDIDATES = [
  process.env.DATABASE_URL,
  process.env.DATABASE_URL_UNPOOLED,
]

let pool = null
let migrationPromise = null
let migrationsEnsured = false
let _dbReadyPromise = null
let _dbReadyOkAt = 0

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
      const indexResult = await client.query(
        `SELECT
           to_regclass('public.team_cases_team_created_idx') IS NOT NULL AS has_team_created_idx,
           to_regclass('public.team_cases_team_updated_idx') IS NOT NULL AS has_team_updated_idx,
           to_regclass('public.team_cases_team_status_created_idx') IS NOT NULL AS has_team_status_created_idx,
           to_regclass('public.team_cases_team_creator_status_idx') IS NOT NULL AS has_team_creator_status_idx,
           to_regclass('public.team_cases_team_updated_at_idx') IS NOT NULL AS has_team_updated_at_idx`
      )
      const hasCaseIndexes = Boolean(
        indexResult.rows[0]?.has_team_created_idx
        && indexResult.rows[0]?.has_team_updated_idx
        && indexResult.rows[0]?.has_team_status_created_idx
        && indexResult.rows[0]?.has_team_creator_status_idx
        && indexResult.rows[0]?.has_team_updated_at_idx
      )
      const defaultsResult = await client.query(
        `SELECT
           SUM(CASE WHEN column_name = 'created_at' AND column_default IS NOT NULL THEN 1 ELSE 0 END) AS created_default,
           SUM(CASE WHEN column_name = 'updated_at' AND column_default IS NOT NULL THEN 1 ELSE 0 END) AS updated_default,
           SUM(CASE WHEN column_name = 'last_updated_at' AND column_default IS NOT NULL THEN 1 ELSE 0 END) AS last_updated_default,
           SUM(CASE WHEN column_name = 'status' AND column_default IS NOT NULL THEN 1 ELSE 0 END) AS status_default
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'team_cases'
           AND column_name IN ('created_at', 'updated_at', 'last_updated_at', 'status')`
      )
      const workflowColumnsResult = await client.query(
        `SELECT
           SUM(CASE WHEN column_name = 'phase' THEN 1 ELSE 0 END) AS has_phase,
           SUM(CASE WHEN column_name = 'last_editor_sub' THEN 1 ELSE 0 END) AS has_last_editor_sub
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'team_cases'
           AND column_name IN ('phase', 'last_editor_sub')`
      )
      const defaultsRow = defaultsResult.rows[0] || {}
      const hasCaseDefaults = Boolean(
        Number(defaultsRow.created_default) > 0
        && Number(defaultsRow.updated_default) > 0
        && Number(defaultsRow.last_updated_default) > 0
        && Number(defaultsRow.status_default) > 0
      )
      const workflowRow = workflowColumnsResult.rows[0] || {}
      const hasWorkflowColumns = Boolean(Number(workflowRow.has_phase) > 0 && Number(workflowRow.has_last_editor_sub) > 0)
      if (hasUsersTable && hasTeamSlug && hasInviteTokenHint && hasMemberLastLogin && hasCaseIndexes && hasCaseDefaults && hasWorkflowColumns) {
        migrationsEnsured = true
        return
      }

      console.log('[migrations] using dir =', MIGRATIONS_DIR)
      const migrations = await Promise.all([
        readMigrationFile('001_init.sql'),
        readMigrationFile('002_add_team_slug.sql'),
        readMigrationFile('003_auth0_invites.sql'),
        readMigrationFile('004_add_team_member_login.sql'),
        readMigrationFile('005_cases_indexes.sql'),
        readMigrationFile('006_cases_defaults.sql'),
        readMigrationFile('007_cases_workflow.sql'),
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
      'DATABASE_URL_UNPOOLED',
    ].filter((key) => !process.env[key])
    console.warn('Database URL mangler.', sanitizeObject({ missingKeys }))
    throw new Error('Database URL mangler. Sæt DATABASE_URL eller DATABASE_URL_UNPOOLED.')
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
  if (_dbReadyPromise) return _dbReadyPromise
  _dbReadyPromise = (async () => {
    await getPoolRaw()
    await ensureMigrations()
    const ready = await isDbReady()
    if (ready) {
      _dbReadyOkAt = Date.now()
    } else {
      _dbReadyPromise = null
      _dbReadyOkAt = 0
    }
    return ready
  })()
  try {
    return await _dbReadyPromise
  } catch (error) {
    console.error('[db] ensureDbReady failed', safeError(error))
    _dbReadyPromise = null
    _dbReadyOkAt = 0
    throw error
  }
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
