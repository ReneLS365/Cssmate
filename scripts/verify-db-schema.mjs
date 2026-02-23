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

async function main () {
  const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
  if (!conn) {
    console.error('[schema] FAIL: DATABASE_URL(_UNPOOLED) missing')
    process.exit(1)
  }

  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
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
