import { gzipSync } from 'node:zlib'
import { getStore } from '@netlify/blobs'
import { db, ensureDbReady } from './_db.mjs'

const BACKUP_SCHEMA_VERSION = 2

export const config = {
  schedule: '@monthly',
}

function serializeCaseRow (row) {
  const createdAt = row.created_at ? new Date(row.created_at).toISOString() : null
  const updatedAt = row.updated_at ? new Date(row.updated_at).toISOString() : createdAt
  const lastUpdatedAt = row.last_updated_at ? new Date(row.last_updated_at).toISOString() : updatedAt
  return {
    caseId: row.case_id,
    teamId: row.team_slug,
    jobNumber: row.job_number || '',
    caseKind: row.case_kind || '',
    system: row.system || '',
    totals: row.totals || { materials: 0, montage: 0, demontage: 0, total: 0 },
    status: row.status || 'kladde',
    createdAt,
    updatedAt,
    lastUpdatedAt,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email || '',
    createdByName: row.created_by_name || '',
    updatedBy: row.updated_by || row.created_by,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    deletedBy: row.deleted_by || null,
    attachments: {
      json: row.json_content ? { data: row.json_content, createdAt } : null,
      pdf: null,
    },
  }
}

function buildBackupPayload ({ teamSlug, cases, audit }) {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    teamId: teamSlug,
    exportedAt: new Date().toISOString(),
    exportedBy: { uid: 'system', email: '', name: 'scheduled-backup' },
    retentionYears: 5,
    cases,
    audit,
    metadata: { format: 'sscaff-shared-backup', source: 'sscaff-app' },
  }
}

export async function handler () {
  const context = String(process.env.CONTEXT || process.env.NETLIFY_CONTEXT || 'unknown').toLowerCase()
  if (context !== 'production') {
    return { statusCode: 200, body: 'Backup skipped (non-production context).' }
  }

  await ensureDbReady()
  const store = getStore('cssmate-backups')
  const teamsResult = await db.query('SELECT id, slug FROM teams ORDER BY created_at ASC')
  const teams = teamsResult.rows || []
  const yearMonth = new Date().toISOString().slice(0, 7)

  for (const team of teams) {
    const teamSlug = team.slug || team.id
    const casesResult = await db.query(
      `SELECT c.*, t.slug as team_slug
       FROM public.team_cases c
       JOIN public.teams t ON t.id = c.team_id
       WHERE c.team_id = $1`,
      [team.id]
    )
    const auditResult = await db.query(
      `SELECT id, team_id, case_id, action, actor, summary, created_at
       FROM team_audit
       WHERE team_id = $1
       ORDER BY created_at ASC`,
      [team.id]
    )
    const backup = buildBackupPayload({
      teamSlug,
      cases: casesResult.rows.map(serializeCaseRow),
      audit: auditResult.rows.map(row => ({
        _id: row.id,
        teamId: teamSlug,
        caseId: row.case_id,
        action: row.action,
        actor: row.actor,
        summary: row.summary,
        timestamp: row.created_at ? new Date(row.created_at).toISOString() : null,
      })),
    })
    const payload = gzipSync(JSON.stringify(backup), { level: 9 })
    const key = `backups/${teamSlug}/${yearMonth}.json.gz`
    await store.set(key, payload, {
      contentType: 'application/json',
      contentEncoding: 'gzip',
    })
  }

  return { statusCode: 200, body: `Backup complete (${teams.length} teams).` }
}
