import process from 'node:process'
import pg from 'pg'

const { Client } = pg

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

function resolveSslSetting (connectionString) {
  const envSetting = parseBoolean(process.env.DATABASE_SSL)
  if (envSetting !== null) {
    return envSetting
  }
  const urlSetting = parseSslMode(connectionString)
  if (urlSetting !== null) {
    return urlSetting
  }
  return false
}

async function main () {
  const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
  if (!conn) {
    console.error('[schema] FAIL: DATABASE_URL(_UNPOOLED) missing')
    process.exit(1)
  }

  const useSsl = resolveSslSetting(conn)
  const client = new Client({
    connectionString: conn,
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  })
  await client.connect()

  try {
    const missing = { tables: [], columns: [], indexes: [] }

    const tablesRes = await client.query(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname='public'`
    )
    const tableSet = new Set(tablesRes.rows.map((row) => row.tablename))
    for (const tableName of REQUIRED_TABLES) {
      if (!tableSet.has(tableName)) missing.tables.push(tableName)
    }

    const colsRes = await client.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='team_cases'`
    )
    const colSet = new Set(colsRes.rows.map((row) => row.column_name))
    for (const colName of REQUIRED_TEAM_CASE_COLUMNS) {
      if (!colSet.has(colName)) missing.columns.push(`team_cases.${colName}`)
    }

    const idxRes = await client.query(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname='public' AND tablename='team_cases'`
    )
    const idxSet = new Set(idxRes.rows.map((row) => row.indexname))
    for (const indexName of REQUIRED_INDEXES) {
      if (!idxSet.has(indexName)) missing.indexes.push(indexName)
    }

    const hasMissing = missing.tables.length || missing.columns.length || missing.indexes.length
    if (hasMissing) {
      console.error('[schema] FAIL: missing schema elements')
      if (missing.tables.length) console.error(`  tables: ${missing.tables.join(', ')}`)
      if (missing.columns.length) console.error(`  columns: ${missing.columns.join(', ')}`)
      if (missing.indexes.length) console.error(`  indexes: ${missing.indexes.join(', ')}`)
      process.exit(1)
    }

    console.log('[schema] OK')
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error('[schema] FAIL:', error?.message || error)
  process.exit(1)
})
