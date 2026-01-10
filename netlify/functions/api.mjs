import bcrypt from 'bcryptjs'
import { db } from './_db.mjs'
import { generateToken, hashToken, signToken, verifyToken } from './_auth.mjs'
import { ensureActiveOwnerGuard } from './owner-guards.mjs'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const BOOTSTRAP_ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL || 'mr.lion1995@gmail.com'
const DEFAULT_TEAM_SLUG = process.env.DEFAULT_TEAM_SLUG || 'hulmose'

function isMissingRelationError (error) {
  const message = error?.message || ''
  return /relation .* does not exist/i.test(message) || /column .* does not exist/i.test(message)
}

function jsonResponse (statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload ?? {}),
  }
}

function emptyResponse (statusCode = 204) {
  return { statusCode, headers: JSON_HEADERS, body: '' }
}

function parseBody (event) {
  if (!event.body) return {}
  try {
    return JSON.parse(event.body)
  } catch {
    return {}
  }
}

function normalizeEmail (email) {
  return (email || '').toString().trim().toLowerCase()
}

function normalizeTeamSlug (value) {
  const cleaned = (value || '').toString().trim().toLowerCase()
  const normalized = cleaned
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || DEFAULT_TEAM_SLUG
}

function getRoutePath (event) {
  const rawPath = event.path || ''
  if (rawPath.startsWith('/.netlify/functions/api')) {
    return rawPath.replace('/.netlify/functions/api', '') || '/'
  }
  if (rawPath.startsWith('/api')) {
    return rawPath.replace('/api', '') || '/'
  }
  return rawPath || '/'
}

function getAuthHeader (event) {
  const headers = event.headers || {}
  return headers.authorization || headers.Authorization || ''
}

function resolveAppBaseUrl (event) {
  const raw = String(process.env.APP_BASE_URL || '').trim()
  if (raw && raw.toLowerCase() !== 'base') {
    try {
      const parsed = new URL(raw)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin
      }
    } catch {
      // ignore invalid env value
    }
  }
  const headers = event.headers || {}
  const host = headers['x-forwarded-host'] || headers.host
  if (!host) return ''
  const protocol = (headers['x-forwarded-proto'] || 'https').split(',')[0].trim()
  return `${protocol}://${host}`
}

async function requireAuth (event) {
  const header = getAuthHeader(event)
  if (!header.startsWith('Bearer ')) {
    const error = new Error('Manglende token')
    error.status = 401
    throw error
  }
  const token = header.replace('Bearer ', '').trim()
  try {
    const payload = await verifyToken(token)
    return {
      id: payload.sub,
      email: normalizeEmail(payload.email || ''),
    }
  } catch {
    const error = new Error('Ugyldigt token')
    error.status = 401
    throw error
  }
}

async function findUserByEmail (email) {
  const result = await db.query('SELECT id, email, password_hash, created_at FROM users WHERE email = $1', [email])
  return result.rows[0] || null
}

async function findTeamBySlug (slug) {
  const result = await db.query('SELECT id, slug, name, created_at FROM teams WHERE slug = $1', [slug])
  return result.rows[0] || null
}

async function ensureTeam (slug, ownerId = null) {
  const normalizedSlug = normalizeTeamSlug(slug)
  const existing = await findTeamBySlug(normalizedSlug)
  if (existing) return existing
  const teamId = crypto.randomUUID()
  const teamName = normalizedSlug
  await db.query(
    'INSERT INTO teams (id, slug, name, created_at) VALUES ($1, $2, $3, NOW())',
    [teamId, normalizedSlug, teamName]
  )
  if (ownerId) {
    await db.query(
      'INSERT INTO team_members (team_id, user_id, role, status, created_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (team_id, user_id) DO NOTHING',
      [teamId, ownerId, 'owner', 'active']
    )
  }
  return { id: teamId, slug: normalizedSlug, name: teamName, created_at: new Date().toISOString() }
}

async function ensureBootstrapAdmin (userId, email) {
  if (normalizeEmail(email) !== normalizeEmail(BOOTSTRAP_ADMIN_EMAIL)) return
  const team = await ensureTeam(DEFAULT_TEAM_SLUG)
  await db.query(
    `INSERT INTO team_members (team_id, user_id, role, status, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (team_id, user_id)
     DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status`,
    [team.id, userId, 'owner', 'active']
  )
}

async function getMember (teamId, userId) {
  const result = await db.query(
    'SELECT team_id, user_id, role, status, created_at FROM team_members WHERE team_id = $1 AND user_id = $2',
    [teamId, userId]
  )
  return result.rows[0] || null
}

async function requireTeamRole (teamId, userId, roles = ['owner', 'admin']) {
  const member = await getMember(teamId, userId)
  if (!member || member.status !== 'active') {
    const error = new Error('Ingen adgang til teamet')
    error.status = 403
    throw error
  }
  if (!roles.includes(member.role)) {
    const error = new Error('Kun admin kan udføre denne handling')
    error.status = 403
    throw error
  }
  return member
}

function serializeMemberRow (row) {
  return {
    id: row.user_id,
    uid: row.user_id,
    email: row.email || '',
    displayName: row.display_name || '',
    role: row.role || 'member',
    active: row.status !== 'disabled',
    assigned: true,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

function serializeInviteRow (row) {
  const status = row.status === 'pending' && row.expires_at && new Date(row.expires_at) < new Date()
    ? 'expired'
    : row.status
  return {
    id: row.id,
    inviteId: row.id,
    teamId: row.team_slug,
    email: row.email || '',
    emailLower: row.email || '',
    role: row.role || 'member',
    status,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    acceptedAt: row.accepted_at ? new Date(row.accepted_at).toISOString() : null,
  }
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

async function handleSignup (event) {
  const body = parseBody(event)
  const email = normalizeEmail(body.email)
  const password = body.password || ''
  if (!email || !password) {
    return jsonResponse(400, { error: 'Email og adgangskode er påkrævet.' })
  }
  const existing = await findUserByEmail(email)
  if (existing) {
    return jsonResponse(409, { error: 'Bruger findes allerede.' })
  }
  const passwordHash = await bcrypt.hash(password, 10)
  const userId = crypto.randomUUID()
  await db.query(
    'INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, NOW())',
    [userId, email, passwordHash]
  )
  await ensureBootstrapAdmin(userId, email)
  const token = await signToken({ userId, email })
  return jsonResponse(200, { token })
}

async function handleLogin (event) {
  const body = parseBody(event)
  const email = normalizeEmail(body.email)
  const password = body.password || ''
  if (!email || !password) {
    return jsonResponse(400, { error: 'Email og adgangskode er påkrævet.' })
  }
  const user = await findUserByEmail(email)
  if (!user) {
    return jsonResponse(401, { error: 'Forkert login.' })
  }
  const ok = await bcrypt.compare(password, user.password_hash || '')
  if (!ok) {
    return jsonResponse(401, { error: 'Forkert login.' })
  }
  await ensureBootstrapAdmin(user.id, user.email)
  const token = await signToken({ userId: user.id, email: user.email })
  return jsonResponse(200, { token })
}

async function handleTeamAccess (event, teamSlug) {
  const user = await requireAuth(event)
  const normalizedSlug = normalizeTeamSlug(teamSlug)
  const team = await findTeamBySlug(normalizedSlug)
  if (!team) {
    return jsonResponse(200, { status: 'no-team', teamId: normalizedSlug, bootstrapAdminEmail: BOOTSTRAP_ADMIN_EMAIL })
  }
  const member = await getMember(team.id, user.id)
  if (!member) {
    return jsonResponse(200, { status: 'no-access', reason: 'not-member', teamId: normalizedSlug, bootstrapAdminEmail: BOOTSTRAP_ADMIN_EMAIL })
  }
  if (member.status !== 'active') {
    return jsonResponse(200, { status: 'no-access', reason: 'inactive', teamId: normalizedSlug, bootstrapAdminEmail: BOOTSTRAP_ADMIN_EMAIL })
  }
  return jsonResponse(200, {
    status: 'ok',
    teamId: normalizedSlug,
    team: { id: team.id, name: team.name, slug: team.slug },
    member: { uid: user.id, role: member.role, status: member.status },
    bootstrapAdminEmail: BOOTSTRAP_ADMIN_EMAIL,
  })
}

async function handleTeamBootstrap (event, teamSlug) {
  const user = await requireAuth(event)
  const normalizedSlug = normalizeTeamSlug(teamSlug)
  if (normalizeTeamSlug(DEFAULT_TEAM_SLUG) !== normalizedSlug) {
    return jsonResponse(403, { error: 'Bootstrap er kun tilladt på default-teamet.' })
  }
  if (normalizeEmail(user.email) !== normalizeEmail(BOOTSTRAP_ADMIN_EMAIL)) {
    return jsonResponse(403, { error: 'Kun admin kan bootstrappe team.' })
  }
  const team = await ensureTeam(normalizedSlug)
  await db.query(
    `INSERT INTO team_members (team_id, user_id, role, status, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (team_id, user_id)
     DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status`,
    [team.id, user.id, 'owner', 'active']
  )
  return jsonResponse(200, { ok: true, teamId: normalizedSlug, role: 'owner' })
}

async function handleAuthSession (event) {
  const user = await requireAuth(event)
  return jsonResponse(200, { user: { id: user.id, email: user.email } })
}

async function handleTeamMembersList (event, teamSlug) {
  const user = await requireAuth(event)
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  await requireTeamRole(team.id, user.id, ['owner', 'admin', 'member'])
  const result = await db.query(
    `SELECT m.user_id, m.role, m.status, m.created_at, u.email, u.display_name
     FROM team_members m
     LEFT JOIN users u ON u.id = m.user_id
     WHERE m.team_id = $1
     ORDER BY m.created_at ASC`,
    [team.id]
  )
  return jsonResponse(200, result.rows.map(serializeMemberRow))
}

async function handleTeamMemberCreate (event, teamSlug) {
  const user = await requireAuth(event)
  const body = parseBody(event)
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  await requireTeamRole(team.id, user.id, ['owner', 'admin'])
  const role = body.role === 'admin' ? 'admin' : (body.role === 'owner' ? 'owner' : 'member')
  let targetUserId = body.userId
  if (!targetUserId && body.email) {
    const target = await findUserByEmail(normalizeEmail(body.email))
    targetUserId = target?.id || ''
  }
  if (!targetUserId) return jsonResponse(400, { error: 'Bruger ikke fundet.' })
  await db.query(
    'INSERT INTO team_members (team_id, user_id, role, status, created_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (team_id, user_id) DO NOTHING',
    [team.id, targetUserId, role, 'active']
  )
  return emptyResponse(204)
}

async function handleTeamMemberPatch (event, teamSlug, memberId) {
  const user = await requireAuth(event)
  const body = parseBody(event)
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  await requireTeamRole(team.id, user.id, ['owner', 'admin'])
  const role = body.role === 'admin' || body.role === 'member' || body.role === 'owner' ? body.role : null
  const status = body.status === 'disabled' || body.status === 'active' ? body.status : null
  if (!role && !status) {
    return jsonResponse(400, { error: 'Ingen opdateringer angivet.' })
  }
  const existing = await getMember(team.id, memberId)
  const nextRole = role || existing?.role || 'member'
  const nextStatus = status || existing?.status || 'active'
  if (!existing) {
    await db.query(
      'INSERT INTO team_members (team_id, user_id, role, status, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [team.id, memberId, nextRole, nextStatus]
    )
    return emptyResponse(204)
  }
  if (existing.role === 'owner') {
    await db.withTransaction(async (client) => {
      const memberResult = await client.query(
        'SELECT user_id, role, status FROM team_members WHERE team_id = $1 AND user_id = $2 FOR UPDATE',
        [team.id, memberId]
      )
      const current = memberResult.rows[0]
      if (!current) return
      const resolvedRole = role || current.role
      const resolvedStatus = status || current.status
      const ownersResult = await client.query(
        'SELECT user_id, status FROM team_members WHERE team_id = $1 AND role = $2 FOR UPDATE',
        [team.id, 'owner']
      )
      const allowed = ensureActiveOwnerGuard({
        owners: ownersResult.rows,
        targetUserId: memberId,
        existingRole: current.role,
        existingStatus: current.status,
        nextRole: resolvedRole,
        nextStatus: resolvedStatus,
        isDelete: false,
      })
      if (!allowed) {
        const error = new Error('Teamet skal have mindst én owner.')
        error.status = 400
        throw error
      }
      await client.query(
        'UPDATE team_members SET role = $1, status = $2 WHERE team_id = $3 AND user_id = $4',
        [resolvedRole, resolvedStatus, team.id, memberId]
      )
    })
  } else {
    await db.query(
      'UPDATE team_members SET role = $1, status = $2 WHERE team_id = $3 AND user_id = $4',
      [nextRole, nextStatus, team.id, memberId]
    )
  }
  return emptyResponse(204)
}

async function handleTeamMemberDelete (event, teamSlug, memberId) {
  const user = await requireAuth(event)
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  await requireTeamRole(team.id, user.id, ['owner', 'admin'])
  const existing = await getMember(team.id, memberId)
  if (!existing) return emptyResponse(204)
  if (existing.role === 'owner') {
    await db.withTransaction(async (client) => {
      const memberResult = await client.query(
        'SELECT user_id, role, status FROM team_members WHERE team_id = $1 AND user_id = $2 FOR UPDATE',
        [team.id, memberId]
      )
      const current = memberResult.rows[0]
      if (!current) return
      const ownersResult = await client.query(
        'SELECT user_id, status FROM team_members WHERE team_id = $1 AND role = $2 FOR UPDATE',
        [team.id, 'owner']
      )
      const allowed = ensureActiveOwnerGuard({
        owners: ownersResult.rows,
        targetUserId: memberId,
        existingRole: current.role,
        existingStatus: current.status,
        nextRole: current.role,
        nextStatus: current.status,
        isDelete: true,
      })
      if (!allowed) {
        const error = new Error('Teamet skal have mindst én owner.')
        error.status = 400
        throw error
      }
      await client.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [team.id, memberId])
    })
    return emptyResponse(204)
  }
  await db.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [team.id, memberId])
  return emptyResponse(204)
}

async function handleInviteCreate (event, teamSlug) {
  const user = await requireAuth(event)
  const body = parseBody(event)
  const role = body.role === 'admin' ? 'admin' : 'member'
  const email = normalizeEmail(body.email || '') || null
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  await requireTeamRole(team.id, user.id, ['owner', 'admin'])
  const rawToken = generateToken()
  const tokenHash = hashToken(rawToken)
  const inviteId = crypto.randomUUID()
  const result = await db.query(
    `INSERT INTO team_invites (id, team_id, email, role, token_hash, status, expires_at, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + interval '7 days', $7, NOW())
     RETURNING id, expires_at`,
    [inviteId, team.id, email, role, tokenHash, 'pending', user.id]
  )
  const baseUrl = resolveAppBaseUrl(event)
  const invitePath = `/accept-invite?inviteId=${inviteId}&token=${rawToken}`
  const inviteUrl = baseUrl ? `${baseUrl}${invitePath}` : invitePath
  return jsonResponse(200, {
    inviteId,
    expiresAt: result.rows[0]?.expires_at ? new Date(result.rows[0].expires_at).toISOString() : null,
    inviteUrl,
  })
}

async function handleInviteList (event, teamSlug) {
  const user = await requireAuth(event)
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  await requireTeamRole(team.id, user.id, ['owner', 'admin'])
  const result = await db.query(
    `SELECT i.id, i.email, i.role, i.status, i.expires_at, i.created_at, i.accepted_at, t.slug as team_slug
     FROM team_invites i
     JOIN teams t ON t.id = i.team_id
     WHERE i.team_id = $1
     ORDER BY i.created_at DESC`,
    [team.id]
  )
  return jsonResponse(200, result.rows.map(serializeInviteRow))
}

async function handleInviteRevoke (event, inviteId) {
  const user = await requireAuth(event)
  const inviteResult = await db.query('SELECT id, team_id FROM team_invites WHERE id = $1', [inviteId])
  const invite = inviteResult.rows[0]
  if (!invite) return jsonResponse(404, { error: 'Invitation findes ikke.' })
  await requireTeamRole(invite.team_id, user.id, ['owner', 'admin'])
  await db.query('UPDATE team_invites SET status = $1 WHERE id = $2', ['revoked', inviteId])
  return emptyResponse(204)
}

async function handleInviteAccept (event) {
  const user = await requireAuth(event)
  const body = parseBody(event)
  const inviteId = body.inviteId
  const token = body.token
  if (!inviteId || !token) {
    return jsonResponse(400, { error: 'InviteId og token er påkrævet.' })
  }
  const tokenHash = hashToken(token)
  const result = await db.query(
    `SELECT i.id, i.team_id, i.role, i.status, i.expires_at, t.slug as team_slug
     FROM team_invites i
     JOIN teams t ON t.id = i.team_id
     WHERE i.id = $1`,
    [inviteId]
  )
  const invite = result.rows[0]
  if (!invite) return jsonResponse(404, { error: 'Invitation findes ikke.' })
  if (invite.status !== 'pending') return jsonResponse(400, { error: 'Invitationen er ikke aktiv.' })
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    await db.query('UPDATE team_invites SET status = $1 WHERE id = $2', ['expired', inviteId])
    return jsonResponse(400, { error: 'Invitationen er udløbet.' })
  }
  const tokenResult = await db.query('SELECT token_hash FROM team_invites WHERE id = $1', [inviteId])
  const storedHash = tokenResult.rows[0]?.token_hash
  if (!storedHash || storedHash !== tokenHash) {
    return jsonResponse(400, { error: 'Ugyldig invitation.' })
  }
  await db.query(
    `INSERT INTO team_members (team_id, user_id, role, status, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (team_id, user_id)
     DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status`,
    [invite.team_id, user.id, invite.role, 'active']
  )
  await db.query(
    `UPDATE team_invites SET status = $1, accepted_by = $2, accepted_at = NOW()
     WHERE id = $3`,
    ['accepted', user.id, inviteId]
  )
  return jsonResponse(200, { teamId: invite.team_slug, role: invite.role })
}

async function handleCaseCreate (event, teamSlug) {
  const user = await requireAuth(event)
  const body = parseBody(event)
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  const member = await getMember(team.id, user.id)
  if (!member || member.status !== 'active') {
    return jsonResponse(403, { error: 'Ingen adgang til teamet.' })
  }
  const caseId = crypto.randomUUID()
  const totals = body.totals || { materials: 0, montage: 0, demontage: 0, total: 0 }
  await db.query(
    `INSERT INTO team_cases
      (case_id, team_id, job_number, case_kind, system, totals, status, created_at, updated_at, last_updated_at,
       created_by, created_by_email, created_by_name, updated_by, json_content)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW(), NOW(), NOW(), $8, $9, $10, $8, $11)`,
    [
      caseId,
      team.id,
      body.jobNumber || '',
      body.caseKind || '',
      body.system || '',
      JSON.stringify(totals),
      body.status || 'kladde',
      user.id,
      user.email,
      body.createdByName || '',
      body.jsonContent || null,
    ]
  )
  const result = await db.query(
    `SELECT c.*, t.slug as team_slug
     FROM team_cases c
     JOIN teams t ON t.id = c.team_id
     WHERE c.case_id = $1`,
    [caseId]
  )
  return jsonResponse(200, serializeCaseRow(result.rows[0]))
}

async function handleCaseList (event, teamSlug) {
  const user = await requireAuth(event)
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  const member = await getMember(team.id, user.id)
  if (!member || member.status !== 'active') {
    return jsonResponse(403, { error: 'Ingen adgang til teamet.' })
  }
  const result = await db.query(
    `SELECT c.*, t.slug as team_slug
     FROM team_cases c
     JOIN teams t ON t.id = c.team_id
     WHERE c.team_id = $1 AND c.deleted_at IS NULL`,
    [team.id]
  )
  return jsonResponse(200, result.rows.map(serializeCaseRow))
}

async function handleCaseGet (event, teamSlug, caseId) {
  const user = await requireAuth(event)
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  const member = await getMember(team.id, user.id)
  if (!member || member.status !== 'active') {
    return jsonResponse(403, { error: 'Ingen adgang til teamet.' })
  }
  const result = await db.query(
    `SELECT c.*, t.slug as team_slug
     FROM team_cases c
     JOIN teams t ON t.id = c.team_id
     WHERE c.team_id = $1 AND c.case_id = $2`,
    [team.id, caseId]
  )
  const row = result.rows[0]
  if (!row) return jsonResponse(404, { error: 'Sag findes ikke.' })
  return jsonResponse(200, serializeCaseRow(row))
}

async function handleCaseDelete (event, teamSlug, caseId) {
  const user = await requireAuth(event)
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  const member = await getMember(team.id, user.id)
  if (!member || member.status !== 'active') {
    return jsonResponse(403, { error: 'Ingen adgang til teamet.' })
  }
  const result = await db.query(
    'SELECT created_by FROM team_cases WHERE team_id = $1 AND case_id = $2',
    [team.id, caseId]
  )
  const row = result.rows[0]
  if (!row) return jsonResponse(404, { error: 'Sag findes ikke.' })
  if (row.created_by !== user.id && member.role !== 'admin' && member.role !== 'owner') {
    return jsonResponse(403, { error: 'Kun opretter eller admin kan slette sagen.' })
  }
  await db.query(
    `UPDATE team_cases SET status = $1, deleted_at = NOW(), deleted_by = $2, updated_at = NOW(), last_updated_at = NOW(), updated_by = $2
     WHERE team_id = $3 AND case_id = $4`,
    ['deleted', user.id, team.id, caseId]
  )
  const updated = await db.query(
    `SELECT c.*, t.slug as team_slug
     FROM team_cases c
     JOIN teams t ON t.id = c.team_id
     WHERE c.team_id = $1 AND c.case_id = $2`,
    [team.id, caseId]
  )
  return jsonResponse(200, serializeCaseRow(updated.rows[0]))
}

async function handleCaseStatus (event, teamSlug, caseId) {
  const user = await requireAuth(event)
  const body = parseBody(event)
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  const member = await getMember(team.id, user.id)
  if (!member || member.status !== 'active') {
    return jsonResponse(403, { error: 'Ingen adgang til teamet.' })
  }
  const result = await db.query('SELECT created_by FROM team_cases WHERE team_id = $1 AND case_id = $2', [team.id, caseId])
  const row = result.rows[0]
  if (!row) return jsonResponse(404, { error: 'Sag findes ikke.' })
  if (row.created_by !== user.id && member.role !== 'admin' && member.role !== 'owner') {
    return jsonResponse(403, { error: 'Kun opretter eller admin kan ændre status.' })
  }
  await db.query(
    `UPDATE team_cases SET status = $1, updated_at = NOW(), last_updated_at = NOW(), updated_by = $2
     WHERE team_id = $3 AND case_id = $4`,
    [body.status || 'kladde', user.id, team.id, caseId]
  )
  const updated = await db.query(
    `SELECT c.*, t.slug as team_slug
     FROM team_cases c
     JOIN teams t ON t.id = c.team_id
     WHERE c.team_id = $1 AND c.case_id = $2`,
    [team.id, caseId]
  )
  return jsonResponse(200, serializeCaseRow(updated.rows[0]))
}

async function handleBackupExport (event, teamSlug) {
  const user = await requireAuth(event)
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  const member = await getMember(team.id, user.id)
  if (!member || member.status !== 'active' || (member.role !== 'admin' && member.role !== 'owner')) {
    return jsonResponse(403, { error: 'Kun admin kan eksportere backup.' })
  }
  const casesResult = await db.query(
    `SELECT c.*, t.slug as team_slug
     FROM team_cases c
     JOIN teams t ON t.id = c.team_id
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
  const backup = {
    schemaVersion: 2,
    teamId: teamSlug,
    exportedAt: new Date().toISOString(),
    exportedBy: { uid: user.id, email: user.email || '', name: '' },
    retentionYears: 5,
    cases: casesResult.rows.map(row => ({
      ...serializeCaseRow(row),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      lastUpdatedAt: row.last_updated_at ? new Date(row.last_updated_at).toISOString() : null,
      deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    })),
    audit: auditResult.rows.map(row => ({
      _id: row.id,
      teamId: teamSlug,
      caseId: row.case_id,
      action: row.action,
      actor: row.actor,
      summary: row.summary,
      timestamp: row.created_at ? new Date(row.created_at).toISOString() : null,
    })),
    metadata: { format: 'sscaff-shared-backup', source: 'sscaff-app' },
  }
  return jsonResponse(200, backup)
}

async function handleBackupImport (event, teamSlug) {
  const user = await requireAuth(event)
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  const member = await getMember(team.id, user.id)
  if (!member || member.status !== 'active' || (member.role !== 'admin' && member.role !== 'owner')) {
    return jsonResponse(403, { error: 'Kun admin kan importere backup.' })
  }
  const body = parseBody(event)
  const cases = Array.isArray(body?.cases) ? body.cases : []
  for (const entry of cases) {
    await db.query(
      `INSERT INTO team_cases
        (case_id, team_id, job_number, case_kind, system, totals, status, created_at, updated_at, last_updated_at,
         created_by, created_by_email, created_by_name, updated_by, json_content, deleted_at, deleted_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (case_id) DO UPDATE SET
         job_number = EXCLUDED.job_number,
         case_kind = EXCLUDED.case_kind,
         system = EXCLUDED.system,
         totals = EXCLUDED.totals,
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at,
         last_updated_at = EXCLUDED.last_updated_at,
         updated_by = EXCLUDED.updated_by,
         json_content = EXCLUDED.json_content,
         deleted_at = EXCLUDED.deleted_at,
         deleted_by = EXCLUDED.deleted_by`,
      [
        entry.caseId,
        team.id,
        entry.jobNumber || '',
        entry.caseKind || '',
        entry.system || '',
        JSON.stringify(entry.totals || { materials: 0, montage: 0, demontage: 0, total: 0 }),
        entry.status || 'kladde',
        entry.createdAt ? new Date(entry.createdAt) : new Date(),
        entry.updatedAt ? new Date(entry.updatedAt) : new Date(),
        entry.lastUpdatedAt ? new Date(entry.lastUpdatedAt) : new Date(),
        entry.createdBy || user.id,
        entry.createdByEmail || '',
        entry.createdByName || '',
        entry.updatedBy || user.id,
        entry.attachments?.json?.data || null,
        entry.deletedAt ? new Date(entry.deletedAt) : null,
        entry.deletedBy || null,
      ]
    )
  }
  return emptyResponse(204)
}

export async function handler (event) {
  const method = event.httpMethod || 'GET'
  const path = getRoutePath(event)
  const action = String(event.queryStringParameters?.action || '').toLowerCase()

  try {
    if (method === 'POST' && action === 'signup') return await handleSignup(event)
    if (method === 'POST' && action === 'login') return await handleLogin(event)

    if (method === 'POST' && path === '/auth/signup') return await handleSignup(event)
    if (method === 'POST' && path === '/auth/login') return await handleLogin(event)
    if (method === 'GET' && path === '/auth/session') return await handleAuthSession(event)

    const teamAccessMatch = path.match(/^\/teams\/([^/]+)\/access$/)
    if (teamAccessMatch && method === 'GET') return await handleTeamAccess(event, teamAccessMatch[1])

    const teamBootstrapMatch = path.match(/^\/teams\/([^/]+)\/bootstrap$/)
    if (teamBootstrapMatch && method === 'POST') return await handleTeamBootstrap(event, teamBootstrapMatch[1])

    const teamMembersMatch = path.match(/^\/teams\/([^/]+)\/members$/)
    if (teamMembersMatch && method === 'GET') return await handleTeamMembersList(event, teamMembersMatch[1])
    if (teamMembersMatch && method === 'POST') return await handleTeamMemberCreate(event, teamMembersMatch[1])

    const teamMemberPatchMatch = path.match(/^\/teams\/([^/]+)\/members\/([^/]+)$/)
    if (teamMemberPatchMatch && method === 'PATCH') {
      return await handleTeamMemberPatch(event, teamMemberPatchMatch[1], teamMemberPatchMatch[2])
    }
    if (teamMemberPatchMatch && method === 'DELETE') {
      return await handleTeamMemberDelete(event, teamMemberPatchMatch[1], teamMemberPatchMatch[2])
    }

    const inviteCreateMatch = path.match(/^\/teams\/([^/]+)\/invites$/)
    if (inviteCreateMatch && method === 'POST') return await handleInviteCreate(event, inviteCreateMatch[1])
    if (inviteCreateMatch && method === 'GET') return await handleInviteList(event, inviteCreateMatch[1])

    const inviteRevokeMatch = path.match(/^\/invites\/([^/]+)\/revoke$/)
    if (inviteRevokeMatch && method === 'POST') return await handleInviteRevoke(event, inviteRevokeMatch[1])

    if (method === 'POST' && path === '/invites/accept') return await handleInviteAccept(event)

    const caseListMatch = path.match(/^\/teams\/([^/]+)\/cases$/)
    if (caseListMatch && method === 'GET') return await handleCaseList(event, caseListMatch[1])
    if (caseListMatch && method === 'POST') return await handleCaseCreate(event, caseListMatch[1])

    const caseGetMatch = path.match(/^\/teams\/([^/]+)\/cases\/([^/]+)$/)
    if (caseGetMatch && method === 'GET') return await handleCaseGet(event, caseGetMatch[1], caseGetMatch[2])
    if (caseGetMatch && method === 'DELETE') return await handleCaseDelete(event, caseGetMatch[1], caseGetMatch[2])

    const caseStatusMatch = path.match(/^\/teams\/([^/]+)\/cases\/([^/]+)\/status$/)
    if (caseStatusMatch && method === 'PATCH') return await handleCaseStatus(event, caseStatusMatch[1], caseStatusMatch[2])

    const backupMatch = path.match(/^\/teams\/([^/]+)\/backup$/)
    if (backupMatch && method === 'GET') return await handleBackupExport(event, backupMatch[1])
    if (backupMatch && method === 'POST') return await handleBackupImport(event, backupMatch[1])

    return jsonResponse(404, { error: 'Endpoint findes ikke.' })
  } catch (error) {
    const status = error?.status || 500
    const message = isMissingRelationError(error)
      ? 'DB er ikke migreret. Kør migrations/001_init.sql og migrations/002_add_team_slug.sql mod Neon.'
      : (error?.message || 'Serverfejl')
    return jsonResponse(status, { error: message })
  }
}
