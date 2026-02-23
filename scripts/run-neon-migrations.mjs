import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const MIGRATIONS = [
  '001_init.sql',
  '002_add_team_slug.sql',
  '003_auth0_invites.sql',
  '004_add_team_member_login.sql',
  '005_cases_indexes.sql',
  '006_cases_defaults.sql',
  '007_cases_workflow.sql',
  '008_auth0_member_profile.sql',
  '009_cases_attachments.sql',
  '010_cases_legacy_columns.sql',
  '011_cases_workflow_v2.sql',
]

function main () {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('[migrate] FAIL: DATABASE_URL is missing')
    process.exit(1)
  }

  const which = spawnSync('which', ['psql'], { stdio: 'pipe', encoding: 'utf8' })
  if (which.status !== 0) {
    console.error('[migrate] FAIL: psql not found. Install Postgres client tools to run migrations.')
    process.exit(1)
  }

  const baseDir = path.resolve('netlify/functions/migrations')
  for (const file of MIGRATIONS) {
    const filePath = path.join(baseDir, file)
    if (!existsSync(filePath)) {
      console.error(`[migrate] FAIL: missing migration file ${filePath}`)
      process.exit(1)
    }

    console.log(`[migrate] running ${file}`)
    const res = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', filePath], {
      stdio: 'inherit',
      env: process.env,
    })
    if (res.status !== 0) {
      console.error(`[migrate] FAIL: migration ${file} failed`)
      process.exit(res.status || 1)
    }
  }

  console.log('[migrate] OK: all migrations applied')
}

main()
