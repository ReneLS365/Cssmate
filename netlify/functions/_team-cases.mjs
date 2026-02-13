import { db } from './_db.mjs'
import { guardTeamCasesSql } from './_team-cases-guard.mjs'
import { assertTeamIdUuid } from './_team.mjs'

const TEAM_CASE_COLUMNS = `
  c.case_id,
  c.team_id,
  c.job_number,
  c.case_kind,
  c.system,
  c.totals,
  c.status,
  c.phase,
  c.created_at,
  c.updated_at,
  c.last_updated_at,
  c.created_by,
  c.created_by_email,
  c.created_by_name,
  c.updated_by,
  c.json_content,
  c.attachments,
  c.last_editor_sub,
  c.deleted_at,
  c.deleted_by
`

function buildSearchClause({ search, params }) {
  if (!search) return ''
  params.push(`%${search}%`)
  return ` AND (c.job_number ILIKE $${params.length} OR c.created_by_name ILIKE $${params.length} OR c.system ILIKE $${params.length})`
}

export async function getTeamCase({ teamId, caseId }) {
  assertTeamIdUuid(teamId, 'getTeamCase')
  const result = await db.query(
    guardTeamCasesSql(
      `SELECT ${TEAM_CASE_COLUMNS}
       FROM public.team_cases c
       WHERE c.team_id = $1 AND c.case_id = $2`,
      'getTeamCase'
    ),
    [teamId, caseId]
  )
  return result.rows[0] || null
}

export async function getTeamCaseByJobNumber({ teamId, jobNumber }) {
  assertTeamIdUuid(teamId, 'getTeamCaseByJobNumber')
  const result = await db.query(
    guardTeamCasesSql(
      `SELECT ${TEAM_CASE_COLUMNS}
       FROM public.team_cases c
       WHERE c.team_id = $1 AND c.job_number = $2
       ORDER BY c.last_updated_at DESC NULLS LAST, c.updated_at DESC, c.created_at DESC
       LIMIT 1`,
      'getTeamCaseByJobNumber'
    ),
    [teamId, jobNumber]
  )
  return result.rows[0] || null
}

export async function listTeamCasesPage({
  teamId,
  limit,
  cursor,
  status = '',
  phase = '',
  search = '',
  from = '',
  to = '',
  includeDeleted = false,
  userSub = '',
  isPrivileged = false,
}) {
  assertTeamIdUuid(teamId, 'listTeamCasesPage')
  const params = [teamId]
  let whereClause = 'WHERE c.team_id = $1'
  let countWhereClause = 'WHERE c.team_id = $1'
  if (!includeDeleted && status !== 'deleted') {
    whereClause += ' AND c.deleted_at IS NULL'
    countWhereClause += ' AND c.deleted_at IS NULL'
  }
  if (status) {
    params.push(status)
    whereClause += ` AND c.status = $${params.length}`
    countWhereClause += ` AND c.status = $${params.length}`
  }
  if (phase) {
    params.push(phase)
    whereClause += ` AND c.phase = $${params.length}`
    countWhereClause += ` AND c.phase = $${params.length}`
  }
  if (!isPrivileged) {
    params.push(userSub)
    whereClause += ` AND (c.status <> 'kladde' OR c.created_by = $${params.length})`
    countWhereClause += ` AND (c.status <> 'kladde' OR c.created_by = $${params.length})`
  }
  const searchClause = buildSearchClause({ search, params })
  whereClause += searchClause
  countWhereClause += searchClause
  if (from) {
    params.push(from)
    whereClause += ` AND (c.created_at AT TIME ZONE 'Europe/Copenhagen')::date >= $${params.length}`
    countWhereClause += ` AND (c.created_at AT TIME ZONE 'Europe/Copenhagen')::date >= $${params.length}`
  }
  if (to) {
    params.push(to)
    whereClause += ` AND (c.created_at AT TIME ZONE 'Europe/Copenhagen')::date <= $${params.length}`
    countWhereClause += ` AND (c.created_at AT TIME ZONE 'Europe/Copenhagen')::date <= $${params.length}`
  }
  const countParams = [...params]
  if (cursor?.caseId) {
    params.push(cursor.lastUpdatedAt)
    params.push(cursor.updatedAt)
    params.push(cursor.createdAt)
    params.push(cursor.caseId)
    whereClause += ` AND (c.last_updated_at, c.updated_at, c.created_at, c.case_id) < ($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length})`
  }
  params.push(limit + 1)
  const result = await db.query(
    guardTeamCasesSql(
      `SELECT ${TEAM_CASE_COLUMNS}
       FROM public.team_cases c
       ${whereClause}
       ORDER BY c.last_updated_at DESC NULLS LAST, c.updated_at DESC, c.created_at DESC, c.case_id DESC
       LIMIT $${params.length}`,
      'listTeamCasesPage'
    ),
    params
  )
  const countResult = await db.query(
    guardTeamCasesSql(
      `SELECT COUNT(*)::int AS total
       FROM public.team_cases c
       ${countWhereClause}`,
      'listTeamCasesPageCount'
    ),
    countParams
  )
  const rows = result.rows || []
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const lastRow = pageRows[pageRows.length - 1]
  const nextCursor = hasMore && lastRow
    ? {
      lastUpdatedAt: lastRow.last_updated_at ? new Date(lastRow.last_updated_at).toISOString() : new Date(0).toISOString(),
      updatedAt: lastRow.updated_at ? new Date(lastRow.updated_at).toISOString() : new Date(0).toISOString(),
      createdAt: lastRow.created_at ? new Date(lastRow.created_at).toISOString() : new Date(0).toISOString(),
      caseId: lastRow.case_id,
    }
    : null
  const total = countResult.rows[0]?.total ?? pageRows.length
  return { rows: pageRows, nextCursor, total }
}

export async function listTeamCasesDelta({ teamId, since, sinceId = '', limit, userSub = '', isPrivileged = false }) {
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
    guardTeamCasesSql(
      `SELECT ${TEAM_CASE_COLUMNS}
       FROM public.team_cases c
       ${whereClause}
       ORDER BY c.last_updated_at ASC, c.case_id ASC
       LIMIT $${params.length}`,
      'listTeamCasesDelta'
    ),
    params
  )
  const rows = result.rows || []
  const deleted = []
  const activeRows = []
  rows.forEach(row => {
    const classification = classifyDeltaRow({ row, userSub, isPrivileged })
    if (classification === 'deleted') {
      deleted.push(row.case_id)
      return
    }
    if (classification === 'active') {
      activeRows.push(row)
    }
  })
  const lastRow = rows[rows.length - 1]
  const cursor = lastRow
    ? {
      updatedAt: lastRow.last_updated_at ? new Date(lastRow.last_updated_at).toISOString() : new Date(0).toISOString(),
      caseId: lastRow.case_id,
    }
    : null
  return { rows: activeRows, deleted, cursor }
}

export function classifyDeltaRow({ row, userSub = '', isPrivileged = false }) {
  if (row.deleted_at || row.status === 'deleted') {
    return 'deleted'
  }
  if (!isPrivileged && row.status === 'kladde' && row.created_by !== userSub) {
    return 'deleted'
  }
  return 'active'
}

export async function upsertTeamCase({
  caseId,
  teamId,
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
    guardTeamCasesSql(
      `INSERT INTO public.team_cases
        (case_id, team_id, job_number, case_kind, system, totals, status, phase, attachments, created_at, updated_at, last_updated_at,
         created_by, created_by_email, created_by_name, updated_by, last_editor_sub, json_content)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, NOW(), NOW(), NOW(), $10, $11, $12, $13, $14, $15)
       ON CONFLICT (case_id) DO UPDATE SET
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
      'upsertTeamCase'
    ),
    [
      caseId,
      teamId,
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
    guardTeamCasesSql(
      `UPDATE public.team_cases
       SET status = $1, deleted_at = NOW(), deleted_by = $2, updated_at = NOW(), last_updated_at = NOW(), updated_by = $2
       WHERE team_id = $3 AND case_id = $4`,
      'softDeleteTeamCase'
    ),
    ['deleted', deletedBy, teamId, caseId]
  )
  return getTeamCase({ teamId, caseId })
}
