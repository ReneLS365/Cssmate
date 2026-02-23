import { getDeployContext, isProd } from './_context.mjs'
import { getPoolRaw, isDbReady } from './_db.mjs'

const REQUIRED_TABLES = ['teams', 'team_members', 'team_cases', 'team_audit']
const REQUIRED_TEAM_CASE_COLUMNS = [
  'attachments',
  'phase',
  'last_editor_sub',
  'last_updated_at',
  'status',
  'totals',
]
const REQUIRED_INDEXES = [
  'team_cases_team_created_idx',
  'team_cases_team_updated_idx',
  'team_cases_team_status_created_idx',
  'team_cases_team_creator_status_idx',
  'team_cases_team_updated_at_idx',
]

function parseHostList (value) {
  if (!value) return new Set()
  return new Set(
    String(value)
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  )
}

function resolveDatabaseHost (databaseUrl) {
  try {
    const url = new URL(databaseUrl)
    return url.hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function getDbConfigStatus () {
  const configured = Boolean(process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED)
  const missingKeys = [
    'DATABASE_URL',
    'DATABASE_URL_UNPOOLED',
  ].filter((key) => !process.env[key])
  return { configured, missingKeys }
}

export function collectDriftWarnings () {
  const warnings = []
  if (!process.env.APP_ORIGIN) warnings.push('APP_ORIGIN mangler.')
  if (!process.env.AUTH0_DOMAIN) warnings.push('AUTH0_DOMAIN mangler.')
  if (!process.env.AUTH0_AUDIENCE) warnings.push('AUTH0_AUDIENCE mangler.')
  if (!process.env.AUTH0_ISSUER) warnings.push('AUTH0_ISSUER mangler.')

  if (isProd() && process.env.DATABASE_PROD_HOSTS) {
    const allowlist = parseHostList(process.env.DATABASE_PROD_HOSTS)
    const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || ''
    const host = resolveDatabaseHost(databaseUrl)
    if (host && allowlist.size && !allowlist.has(host)) {
      warnings.push(`DATABASE_URL host (${host}) matcher ikke DATABASE_PROD_HOSTS.`)
    }
  }

  return warnings
}

async function collectSchemaDrift (pool) {
  const [tablesRes, columnsRes, indexesRes] = await Promise.all([
    pool.query(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname='public'`
    ),
    pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='team_cases'`
    ),
    pool.query(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname='public' AND tablename='team_cases'`
    ),
  ])

  const tableSet = new Set(tablesRes.rows.map((row) => row.tablename))
  const columnSet = new Set(columnsRes.rows.map((row) => row.column_name))
  const indexSet = new Set(indexesRes.rows.map((row) => row.indexname))

  return {
    tables: REQUIRED_TABLES.filter((table) => !tableSet.has(table)),
    columns: REQUIRED_TEAM_CASE_COLUMNS
      .filter((column) => !columnSet.has(column))
      .map((column) => `team_cases.${column}`),
    indexes: REQUIRED_INDEXES.filter((indexName) => !indexSet.has(indexName)),
  }
}

function hasSchemaDrift (missing) {
  return missing.tables.length > 0 || missing.columns.length > 0 || missing.indexes.length > 0
}

export async function runDeepHealthChecks () {
  const dbStatus = {
    configured: false,
    select1Ok: false,
    ready: false,
    latencyMs: null,
  }
  const warnings = collectDriftWarnings()
  const config = getDbConfigStatus()
  let code = null
  let missing = { tables: [], columns: [], indexes: [] }
  let status = 'ok'
  dbStatus.configured = config.configured

  if (!dbStatus.configured) {
    warnings.push('Database ikke konfigureret.')
    status = 'degraded'
    return {
      ok: false,
      status,
      code: 'DB_NOT_CONFIGURED',
      db: dbStatus,
      warnings,
      missing,
      deployContext: getDeployContext(),
    }
  }

  try {
    const pool = await getPoolRaw()
    const started = Date.now()
    await pool.query('SELECT 1')
    dbStatus.select1Ok = true
    dbStatus.latencyMs = Math.max(0, Date.now() - started)
    dbStatus.ready = await isDbReady()
    if (dbStatus.select1Ok) {
      missing = await collectSchemaDrift(pool)
    }
    if (hasSchemaDrift(missing)) {
      code = 'DB_SCHEMA_DRIFT'
      status = 'degraded'
      warnings.push('Database schema drift registreret.')
    }
  } catch (error) {
    code = 'DB_UNAVAILABLE'
    status = 'degraded'
    warnings.push('Database check fejlede.')
  }

  if (!dbStatus.ready && !code) {
    code = 'DB_NOT_READY'
    status = 'degraded'
  }

  return {
    ok: Boolean(dbStatus.select1Ok && dbStatus.ready && !hasSchemaDrift(missing)),
    status,
    code,
    db: dbStatus,
    warnings,
    missing,
    deployContext: getDeployContext(),
  }
}
