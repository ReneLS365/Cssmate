import { db } from './_db.mjs'
import { assertTeamIdUuid } from './_team.mjs'

const TEAM_CASE_COLUMNS = `
  c.case_id,
  c.team_id,
  c.project_id,
  c.parent_case_id,
  c.job_number,
  c.case_kind,
  c.system,
  c.totals,
  c.status,
  c.phase,
  c.attachments,
  c.created_at,
  c.updated_at,
  c.last_updated_at,
  c.created_by,
  c.created_by_email,
  c.created_by_name,
  c.updated_by,
  c.last_editor_sub,
  c.json_content,
  c.deleted_at,
  c.deleted_by,
  t.slug as team_slug
`

function buildSearchClause({ search, params }) {
  if (!search) return ''
  params.push(`%${search}%`)
  return ` AND (c.job_number ILIKE $${params.length} OR c.case_kind ILIKE $${params.length} OR c.system ILIKE $${params.length})`
}

export async function getTeamCase({ teamId, caseId }) {
  assertTeamIdUuid(teamId, 'getTeamCase')
  const result = await db.query(
    `SELECT ${TEAM_CASE_COLUMNS}
     FROM public.team_cases c
     JOIN public.teams t ON t.id = c.team_id
     WHERE c.team_id = $1 AND c.case_id = $2`,
    [teamId, caseId]
  )
  return result.rows[0] || null
}

export async function listTeamCasesPage({
  teamId,
  limit,
  cursor,
  status = '',
  search = '',
  from = '',
  to = '',
  includeDeleted = false,
}) {
  assertTeamIdUuid(teamId, 'listTeamCasesPage')
  const params = [teamId]
  let whereClause = 'WHERE c.team_id = $1'
  if (!includeDeleted) {
    whereClause += ' AND c.deleted_at IS NULL'
  }
  if (status) {
    params.push(status)
    whereClause += ` AND c.status = $${params.length}`
  }
  whereClause += buildSearchClause({ search, params })
  if (from) {
    params.push(from)
    whereClause += ` AND (c.created_at AT TIME ZONE 'Europe/Copenhagen')::date >= $${params.length}`
  }
  if (to) {
    params.push(to)
    whereClause += ` AND (c.created_at AT TIME ZONE 'Europe/Copenhagen')::date <= $${params.length}`
  }
  if (cursor) {
    params.push(cursor.createdAt)
    params.push(cursor.caseId)
    whereClause += ` AND (c.created_at, c.case_id) < ($${params.length - 1}, $${params.length})`
  }
  params.push(limit + 1)
  const result = await db.query(
    `SELECT ${TEAM_CASE_COLUMNS}
     FROM public.team_cases c
     JOIN public.teams t ON t.id = c.team_id
     ${whereClause}
     ORDER BY c.created_at DESC, c.case_id DESC
     LIMIT $${params.length}`,
    params
  )
  const rows = result.rows || []
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const lastRow = pageRows[pageRows.length - 1]
  const nextCursor = hasMore && lastRow
    ? {
      createdAt: lastRow.created_at ? new Date(lastRow.created_at).toISOString() : new Date(0).toISOString(),
      caseId: lastRow.case_id,
    }
    : null
  return { rows: pageRows, nextCursor }
}

export async function listTeamCasesDelta({ teamId, since, sinceId = '', limit }) {
  assertTeamIdUuid(teamId, 'listTeamCasesDelta')
  const params = [teamId]
  let whereClause = 'WHERE c.team_id = $1'
  if (sinceId) {
    params.push(since)
    params.push(sinceId)
    whereClause += ` AND (c.last_updated_at, c.case_id) > ($${params.length - 1}, $${params.length})`
  } else {
    params.push(since)
    whereClause += ` AND c.last_updated_at > $${params.length}`
  }
  params.push(limit)
  const result = await db.query(
    `SELECT ${TEAM_CASE_COLUMNS}
     FROM public.team_cases c
     JOIN public.teams t ON t.id = c.team_id
     ${whereClause}
     ORDER BY c.last_updated_at ASC, c.case_id ASC
     LIMIT $${params.length}`,
    params
  )
  return { rows: result.rows || [] }
}

export async function upsertTeamCase({
  caseId,
  teamId,
  projectId,
  parentCaseId,
  jobNumber,
  caseKind,
  system,
  totals,
  status,
  phase,
  attachments,
  createdBy,
  createdByEmail,
  createdByName,
  updatedBy,
  lastEditorSub,
  jsonContent,
}) {
  assertTeamIdUuid(teamId, 'upsertTeamCase')
  const totalsPayload = typeof totals === 'string' ? totals : JSON.stringify(totals || {})
  const attachmentsPayload = typeof attachments === 'string' ? attachments : JSON.stringify(attachments || {})
  await db.query(
    `INSERT INTO public.team_cases
      (case_id, team_id, project_id, parent_case_id, job_number, case_kind, system, totals, status, phase, attachments, created_at, updated_at, last_updated_at,
       created_by, created_by_email, created_by_name, updated_by, last_editor_sub, json_content)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb, NOW(), NOW(), NOW(), $12, $13, $14, $15, $16, $17)
     ON CONFLICT (case_id) DO UPDATE SET
       project_id = EXCLUDED.project_id,
       parent_case_id = COALESCE(EXCLUDED.parent_case_id, public.team_cases.parent_case_id),
       job_number = EXCLUDED.job_number,
       case_kind = EXCLUDED.case_kind,
       system = EXCLUDED.system,
       totals = EXCLUDED.totals,
       status = EXCLUDED.status,
       phase = EXCLUDED.phase,
       attachments = EXCLUDED.attachments,
       updated_at = NOW(),
       last_updated_at = NOW(),
       updated_by = EXCLUDED.updated_by,
       last_editor_sub = EXCLUDED.last_editor_sub,
       json_content = EXCLUDED.json_content,
       deleted_at = NULL,
       deleted_by = NULL`,
    [
      caseId,
      teamId,
      projectId,
      parentCaseId,
      jobNumber,
      caseKind,
      system,
      totalsPayload,
      status,
      phase,
      attachmentsPayload,
      createdBy,
      createdByEmail,
      createdByName,
      updatedBy,
      lastEditorSub,
      jsonContent,
    ]
  )
  return getTeamCase({ teamId, caseId })
}

export async function softDeleteTeamCase({ teamId, caseId, deletedBy }) {
  assertTeamIdUuid(teamId, 'softDeleteTeamCase')
  await db.query(
    `UPDATE public.team_cases
     SET status = $1, deleted_at = NOW(), deleted_by = $2, updated_at = NOW(), last_updated_at = NOW(), updated_by = $2
     WHERE team_id = $3 AND case_id = $4`,
    ['deleted', deletedBy, teamId, caseId]
  )
  return getTeamCase({ teamId, caseId })
}
