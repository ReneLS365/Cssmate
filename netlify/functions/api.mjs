import { db } from './_db.mjs'
import { generateToken, hashToken, secureCompare, verifyToken } from './_auth.mjs'
import { ensureActiveAdminGuard } from './owner-guards.mjs'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const BOOTSTRAP_ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL || 'mr.lion1995@gmail.com'
const DEFAULT_TEAM_SLUG = process.env.DEFAULT_TEAM_SLUG || 'hulmose'
const EMAIL_FROM = process.env.EMAIL_FROM || ''
const EMAIL_PROVIDER_API_KEY = process.env.EMAIL_PROVIDER_API_KEY || ''
const APP_ORIGIN = process.env.APP_ORIGIN || ''
const INVITE_TTL_DAYS = 7
const INVITE_RATE_LIMIT = 20
const INVITE_RATE_WINDOW_MS = 60 * 60 * 1000
const ACCEPT_RATE_LIMIT = 30
const ACCEPT_RATE_WINDOW_MS = 60 * 60 * 1000

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

function isValidEmail (email) {
  if (!email) return false
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
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
  const raw = String(APP_ORIGIN || process.env.APP_BASE_URL || '').trim()
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

function resolveTeamSlugFromRequest (event, body = {}) {
  const query = event.queryStringParameters || {}
  return normalizeTeamSlug(body.teamId || body.teamSlug || query.teamId || query.teamSlug || DEFAULT_TEAM_SLUG)
}

function createError (message, status = 400, extra = {}) {
  const error = new Error(message)
  error.status = status
  Object.assign(error, extra)
  return error
}

async function fetchAuth0UserInfo (token) {
  const domain = process.env.AUTH0_DOMAIN || ''
  if (!domain) return null
  const response = await fetch(`https://${domain}/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) return null
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function requireAuth (event) {
  const header = getAuthHeader(event)
  if (!header.startsWith('Bearer ')) {
    throw createError('Manglende token', 401)
  }
  const token = header.replace('Bearer ', '').trim()
  try {
    const payload = await verifyToken(token)
    const userInfo = payload.email ? null : await fetchAuth0UserInfo(token)
    const email = normalizeEmail(payload.email || userInfo?.email || '')
    return {
      id: payload.sub,
      email,
    }
  } catch (error) {
    throw createError('Ugyldigt token', 401, { cause: error })
  }
}

async function findTeamBySlug (slug) {
  const result = await db.query('SELECT id, slug, name, created_at, created_by_sub FROM teams WHERE slug = $1', [slug])
  return result.rows[0] || null
}

async function ensureTeam (slug, ownerSub = null) {
  const normalizedSlug = normalizeTeamSlug(slug)
  const existing = await findTeamBySlug(normalizedSlug)
  if (existing) return existing
  const teamId = crypto.randomUUID()
  const teamName = normalizedSlug
  await db.query(
    'INSERT INTO teams (id, slug, name, created_at, created_by_sub) VALUES ($1, $2, $3, NOW(), $4)',
    [teamId, normalizedSlug, teamName, ownerSub]
  )
  if (ownerSub) {
    await db.query(
      'INSERT INTO team_members (team_id, user_sub, email, role, status, joined_at) VALUES ($1, $2, $3, $4, $5, NOW()) ON CONFLICT (team_id, user_sub) DO NOTHING',
      [teamId, ownerSub, '', 'admin', 'active']
    )
  }
  return { id: teamId, slug: normalizedSlug, name: teamName, created_at: new Date().toISOString() }
}

async function getMember (teamId, userSub) {
  const result = await db.query(
    'SELECT team_id, user_sub, email, role, status, joined_at FROM team_members WHERE team_id = $1 AND user_sub = $2',
    [teamId, userSub]
  )
  return result.rows[0] || null
}

async function requireTeamRole (teamId, userSub, roles = ['admin']) {
  const member = await getMember(teamId, userSub)
  if (!member || member.status !== 'active') {
    throw createError('Ingen adgang til teamet', 403)
  }
  if (!roles.includes(member.role)) {
    throw createError('Kun admin kan udføre denne handling', 403)
  }
  return member
}

async function requireTeamAdmin (teamId, userSub) {
  return requireTeamRole(teamId, userSub, ['admin', 'owner'])
}

function serializeMemberRow (row) {
  return {
    id: row.user_sub,
    uid: row.user_sub,
    email: row.email || '',
    displayName: row.display_name || '',
    role: row.role || 'member',
    active: row.status === 'active',
    assigned: true,
    createdAt: row.joined_at ? new Date(row.joined_at).toISOString() : null,
  }
}

function resolveInviteStatus (row) {
  if (row.revoked_at) return 'revoked'
  if (row.used_at) return 'accepted'
  if (row.expires_at && new Date(row.expires_at) < new Date()) return 'expired'
  return 'pending'
}

function serializeInviteRow (row) {
  return {
    id: row.id,
    inviteId: row.id,
    teamId: row.team_slug,
    email: row.email || '',
    emailLower: row.email || '',
    role: row.role || 'member',
    status: resolveInviteStatus(row),
    tokenHint: row.token_hint || '',
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    acceptedAt: row.used_at ? new Date(row.used_at).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
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

async function writeAuditLog ({ teamId, actorSub, action, meta }) {
  if (!teamId || !action) return
  await db.query(
    `INSERT INTO audit_log (id, team_id, actor_sub, action, meta, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
    [crypto.randomUUID(), teamId, actorSub || null, action, JSON.stringify(meta || {})]
  )
}

async function enforceRateLimit ({ key, limit, windowMs }) {
  const now = new Date()
  const windowStart = new Date(now.getTime() - (now.getTime() % windowMs))
  const result = await db.query(
    `INSERT INTO rate_limits (key, window_start, count)
     VALUES ($1, $2, 1)
     ON CONFLICT (key)
     DO UPDATE SET
       count = CASE
         WHEN rate_limits.window_start + ($3 * interval '1 millisecond') < NOW() THEN 1
         ELSE rate_limits.count + 1
       END,
       window_start = CASE
         WHEN rate_limits.window_start + ($3 * interval '1 millisecond') < NOW() THEN EXCLUDED.window_start
         ELSE rate_limits.window_start
       END
     RETURNING count, window_start`,
    [key, windowStart, windowMs]
  )
  const count = result.rows[0]?.count || 0
  if (count > limit) {
    throw createError('For mange forsøg. Prøv igen senere.', 429)
  }
}

async function sendInviteEmail ({ to, role, inviteUrl, expiresAt }) {
  if (!EMAIL_PROVIDER_API_KEY || !EMAIL_FROM || !to) return
  const subject = 'Invitation til SSCaff'
  const expiryLabel = expiresAt ? new Date(expiresAt).toLocaleDateString('da-DK') : 'om 7 dage'
  const bodyText = `Du er inviteret som ${role}.\n\nÅbn linket for at acceptere invitationen:\n${inviteUrl}\n\nLinket udløber ${expiryLabel}.\nLog ind med den email der er inviteret: ${to}.`
  const payload = {
    from: EMAIL_FROM,
    to,
    subject,
    text: bodyText,
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${EMAIL_PROVIDER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const text = await response.text()
    throw createError(`Email kunne ikke sendes: ${text || response.statusText}`, 502)
  }
}

async function handleMe (event) {
  const user = await requireAuth(event)
  return jsonResponse(200, { sub: user.id, email: user.email })
}

async function handleTeamGet (event) {
  const user = await requireAuth(event)
  const teamSlug = resolveTeamSlugFromRequest(event)
  const team = await findTeamBySlug(teamSlug)
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  const member = await getMember(team.id, user.id)
  if (!member || member.status !== 'active') return jsonResponse(404, { error: 'Ingen adgang til teamet.' })
  return jsonResponse(200, { team: { id: team.id, name: team.name, slug: team.slug }, member: { role: member.role } })
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
  const team = await ensureTeam(normalizedSlug, user.id)
  await db.query(
    `INSERT INTO team_members (team_id, user_sub, email, role, status, joined_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (team_id, user_sub)
     DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status, email = EXCLUDED.email`,
    [team.id, user.id, user.email, 'admin', 'active']
  )
  return jsonResponse(200, { ok: true, teamId: normalizedSlug, role: 'admin' })
}

async function handleTeamMembersList (event, teamSlug) {
  const user = await requireAuth(event)
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  await requireTeamRole(team.id, user.id, ['admin', 'owner', 'member'])
  const result = await db.query(
    `SELECT user_sub, role, status, joined_at, email
     FROM team_members
     WHERE team_id = $1
     ORDER BY joined_at ASC`,
    [team.id]
  )
  return jsonResponse(200, result.rows.map(serializeMemberRow))
}

async function handleTeamMembersListRoot (event) {
  const teamSlug = resolveTeamSlugFromRequest(event)
  return handleTeamMembersList(event, teamSlug)
}

async function handleTeamMemberPatch (event, teamSlug, memberSub) {
  const user = await requireAuth(event)
  const body = parseBody(event)
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  await requireTeamAdmin(team.id, user.id)
  const role = body.role === 'admin' || body.role === 'member' || body.role === 'owner' ? body.role : null
  const status = body.status === 'removed' || body.status === 'active' ? body.status : null
  if (!role && !status) {
    return jsonResponse(400, { error: 'Ingen opdateringer angivet.' })
  }
  const existing = await getMember(team.id, memberSub)
  const nextRole = role || existing?.role || 'member'
  const nextStatus = status || existing?.status || 'active'
  if (!existing) {
    await db.query(
      'INSERT INTO team_members (team_id, user_sub, email, role, status, joined_at) VALUES ($1, $2, $3, $4, $5, NOW())',
      [team.id, memberSub, '', nextRole, nextStatus]
    )
    await writeAuditLog({ teamId: team.id, actorSub: user.id, action: 'member_added', meta: { memberSub, role: nextRole } })
    return emptyResponse(204)
  }
  if (existing.role === 'admin' || existing.role === 'owner') {
    await db.withTransaction(async (client) => {
      const memberResult = await client.query(
        'SELECT user_sub, role, status FROM team_members WHERE team_id = $1 AND user_sub = $2 FOR UPDATE',
        [team.id, memberSub]
      )
      const current = memberResult.rows[0]
      if (!current) return
      const resolvedRole = role || current.role
      const resolvedStatus = status || current.status
      const adminsResult = await client.query(
        'SELECT user_sub, role, status FROM team_members WHERE team_id = $1 AND role IN ($2, $3) FOR UPDATE',
        [team.id, 'admin', 'owner']
      )
      const allowed = ensureActiveAdminGuard({
        admins: adminsResult.rows,
        targetUserId: memberSub,
        existingRole: current.role,
        existingStatus: current.status,
        nextRole: resolvedRole,
        nextStatus: resolvedStatus,
        isDelete: false,
      })
      if (!allowed) {
        throw createError('Teamet skal have mindst én admin.', 400)
      }
      await client.query(
        'UPDATE team_members SET role = $1, status = $2 WHERE team_id = $3 AND user_sub = $4',
        [resolvedRole, resolvedStatus, team.id, memberSub]
      )
    })
  } else {
    await db.query(
      'UPDATE team_members SET role = $1, status = $2 WHERE team_id = $3 AND user_sub = $4',
      [nextRole, nextStatus, team.id, memberSub]
    )
  }
  await writeAuditLog({ teamId: team.id, actorSub: user.id, action: 'member_updated', meta: { memberSub, role: nextRole, status: nextStatus } })
  return emptyResponse(204)
}

async function handleTeamMemberPatchRoot (event, memberSub) {
  const teamSlug = resolveTeamSlugFromRequest(event, parseBody(event))
  return handleTeamMemberPatch(event, teamSlug, memberSub)
}

async function handleTeamMemberDelete (event, teamSlug, memberSub) {
  const user = await requireAuth(event)
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  await requireTeamAdmin(team.id, user.id)
  const existing = await getMember(team.id, memberSub)
  if (!existing) return emptyResponse(204)
  if (existing.role === 'admin' || existing.role === 'owner') {
    await db.withTransaction(async (client) => {
      const memberResult = await client.query(
        'SELECT user_sub, role, status FROM team_members WHERE team_id = $1 AND user_sub = $2 FOR UPDATE',
        [team.id, memberSub]
      )
      const current = memberResult.rows[0]
      if (!current) return
      const adminsResult = await client.query(
        'SELECT user_sub, role, status FROM team_members WHERE team_id = $1 AND role IN ($2, $3) FOR UPDATE',
        [team.id, 'admin', 'owner']
      )
      const allowed = ensureActiveAdminGuard({
        admins: adminsResult.rows,
        targetUserId: memberSub,
        existingRole: current.role,
        existingStatus: current.status,
        nextRole: current.role,
        nextStatus: current.status,
        isDelete: true,
      })
      if (!allowed) {
        throw createError('Teamet skal have mindst én admin.', 400)
      }
      await client.query('DELETE FROM team_members WHERE team_id = $1 AND user_sub = $2', [team.id, memberSub])
    })
  } else {
    await db.query('DELETE FROM team_members WHERE team_id = $1 AND user_sub = $2', [team.id, memberSub])
  }
  await writeAuditLog({ teamId: team.id, actorSub: user.id, action: 'member_removed', meta: { memberSub } })
  return emptyResponse(204)
}

async function handleTeamMemberDeleteRoot (event, memberSub) {
  const teamSlug = resolveTeamSlugFromRequest(event, parseBody(event))
  return handleTeamMemberDelete(event, teamSlug, memberSub)
}

async function handleInviteCreate (event, teamSlug) {
  const user = await requireAuth(event)
  const body = parseBody(event)
  const role = body.role === 'admin' ? 'admin' : 'member'
  const email = normalizeEmail(body.email || '')
  if (!isValidEmail(email)) return jsonResponse(400, { error: 'Ugyldig email.' })
  const team = await findTeamBySlug(normalizeTeamSlug(teamSlug))
  if (!team) return jsonResponse(404, { error: 'Team findes ikke.' })
  await requireTeamAdmin(team.id, user.id)
  await enforceRateLimit({ key: `invite:${user.id}`, limit: INVITE_RATE_LIMIT, windowMs: INVITE_RATE_WINDOW_MS })
  await enforceRateLimit({ key: `invite-ip:${event.headers?.['x-forwarded-for'] || 'unknown'}`, limit: INVITE_RATE_LIMIT, windowMs: INVITE_RATE_WINDOW_MS })

  const existing = await db.query(
    `SELECT id FROM team_invites
     WHERE team_id = $1 AND email = $2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()`,
    [team.id, email]
  )
  if (existing.rowCount > 0) {
    return jsonResponse(409, { error: 'Der findes allerede en aktiv invitation til denne email.' })
  }

  const rawToken = generateToken()
  const tokenHash = hashToken(rawToken)
  const tokenHint = rawToken.slice(-6)
  const inviteId = crypto.randomUUID()
  const result = await db.query(
    `INSERT INTO team_invites (id, team_id, email, role, token_hash, token_hint, created_by_sub, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW() + interval '${INVITE_TTL_DAYS} days')
     RETURNING id, expires_at`,
    [inviteId, team.id, email, role, tokenHash, tokenHint, user.id]
  )

  const baseUrl = resolveAppBaseUrl(event)
  const invitePath = `/invite?token=${rawToken}`
  const inviteUrl = baseUrl ? `${baseUrl}${invitePath}` : invitePath
  await sendInviteEmail({ to: email, role, inviteUrl, expiresAt: result.rows[0]?.expires_at })
  await writeAuditLog({ teamId: team.id, actorSub: user.id, action: 'invite_created', meta: { inviteId, email, role, tokenHint } })

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
  await requireTeamAdmin(team.id, user.id)
  const result = await db.query(
    `SELECT i.id, i.email, i.role, i.token_hint, i.expires_at, i.created_at, i.used_at, i.revoked_at, t.slug as team_slug
     FROM team_invites i
     JOIN teams t ON t.id = i.team_id
     WHERE i.team_id = $1 AND i.used_at IS NULL AND i.revoked_at IS NULL
     ORDER BY i.created_at DESC`,
    [team.id]
  )
  return jsonResponse(200, result.rows.map(serializeInviteRow))
}

async function handleInviteRevoke (event, inviteId) {
  const user = await requireAuth(event)
  const inviteResult = await db.query('SELECT id, team_id, email FROM team_invites WHERE id = $1', [inviteId])
  const invite = inviteResult.rows[0]
  if (!invite) return jsonResponse(404, { error: 'Invitation findes ikke.' })
  await requireTeamAdmin(invite.team_id, user.id)
  await db.query('UPDATE team_invites SET revoked_at = NOW() WHERE id = $1', [inviteId])
  await writeAuditLog({ teamId: invite.team_id, actorSub: user.id, action: 'invite_revoked', meta: { inviteId, email: invite.email } })
  return emptyResponse(204)
}

async function handleInviteResend (event, inviteId) {
  const user = await requireAuth(event)
  const inviteResult = await db.query(
    `SELECT i.id, i.team_id, i.email, i.role, i.expires_at, t.slug as team_slug
     FROM team_invites i
     JOIN teams t ON t.id = i.team_id
     WHERE i.id = $1`,
    [inviteId]
  )
  const invite = inviteResult.rows[0]
  if (!invite) return jsonResponse(404, { error: 'Invitation findes ikke.' })
  await requireTeamAdmin(invite.team_id, user.id)
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return jsonResponse(400, { error: 'Invitationen er udløbet.' })
  }
  await enforceRateLimit({ key: `invite:${user.id}`, limit: INVITE_RATE_LIMIT, windowMs: INVITE_RATE_WINDOW_MS })

  const rawToken = generateToken()
  const tokenHash = hashToken(rawToken)
  const tokenHint = rawToken.slice(-6)
  const result = await db.query(
    `UPDATE team_invites
     SET token_hash = $1, token_hint = $2, created_at = NOW(), expires_at = NOW() + interval '${INVITE_TTL_DAYS} days'
     WHERE id = $3
     RETURNING expires_at`,
    [tokenHash, tokenHint, inviteId]
  )
  const baseUrl = resolveAppBaseUrl(event)
  const invitePath = `/invite?token=${rawToken}`
  const inviteUrl = baseUrl ? `${baseUrl}${invitePath}` : invitePath
  await sendInviteEmail({ to: invite.email, role: invite.role, inviteUrl, expiresAt: result.rows[0]?.expires_at })
  await writeAuditLog({ teamId: invite.team_id, actorSub: user.id, action: 'invite_resent', meta: { inviteId, email: invite.email, tokenHint } })

  return jsonResponse(200, {
    inviteId,
    inviteUrl,
    expiresAt: result.rows[0]?.expires_at ? new Date(result.rows[0].expires_at).toISOString() : null,
  })
}

async function handleInviteAccept (event) {
  const user = await requireAuth(event)
  const body = parseBody(event)
  const token = body.token
  if (!token) {
    return jsonResponse(400, { error: 'Token er påkrævet.' })
  }
  await enforceRateLimit({ key: `accept:${user.id}`, limit: ACCEPT_RATE_LIMIT, windowMs: ACCEPT_RATE_WINDOW_MS })
  await enforceRateLimit({ key: `accept-ip:${event.headers?.['x-forwarded-for'] || 'unknown'}`, limit: ACCEPT_RATE_LIMIT, windowMs: ACCEPT_RATE_WINDOW_MS })

  const tokenHash = hashToken(token)
  const result = await db.query(
    `SELECT i.id, i.team_id, i.email, i.role, i.token_hash, i.expires_at, i.used_at, i.revoked_at, t.slug as team_slug
     FROM team_invites i
     JOIN teams t ON t.id = i.team_id
     WHERE i.token_hash = $1`,
    [tokenHash]
  )
  const invite = result.rows[0]
  if (!invite) return jsonResponse(404, { error: 'Invitation findes ikke.' })
  if (!secureCompare(invite.token_hash, tokenHash)) {
    return jsonResponse(400, { error: 'Ugyldig invitation.' })
  }
  if (invite.revoked_at) return jsonResponse(400, { error: 'Invitationen er tilbagekaldt.' })
  if (invite.used_at) return jsonResponse(400, { error: 'Invitationen er allerede brugt.' })
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return jsonResponse(400, { error: 'Invitationen er udløbet.' })
  }
  const inviteEmail = normalizeEmail(invite.email)
  if (inviteEmail && inviteEmail !== normalizeEmail(user.email)) {
    return jsonResponse(403, {
      error: 'Email matcher ikke invitationen.',
      invitedEmail: invite.email,
      loginEmail: user.email,
    })
  }

  await db.query(
    `INSERT INTO team_members (team_id, user_sub, email, role, status, joined_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (team_id, user_sub)
     DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status, email = EXCLUDED.email`,
    [invite.team_id, user.id, user.email, invite.role, 'active']
  )
  await db.query(
    `UPDATE team_invites SET used_at = NOW(), accepted_by_sub = $2, accept_ip = $3, accept_ua = $4
     WHERE id = $1`,
    [invite.id, user.id, event.headers?.['x-forwarded-for'] || '', event.headers?.['user-agent'] || '']
  )
  await writeAuditLog({ teamId: invite.team_id, actorSub: user.id, action: 'invite_accepted', meta: { inviteId: invite.id, email: invite.email } })
  return jsonResponse(200, { ok: true, teamId: invite.team_slug })
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

  try {
    if (method === 'GET' && path === '/me') return await handleMe(event)
    if (method === 'GET' && path === '/team') return await handleTeamGet(event)
    if (method === 'GET' && path === '/team/members') return await handleTeamMembersListRoot(event)
    if (method === 'PATCH' && path.startsWith('/team/members/')) {
      const memberSub = decodeURIComponent(path.replace('/team/members/', ''))
      return await handleTeamMemberPatchRoot(event, memberSub)
    }

    if (method === 'POST' && path === '/invites') return await handleInviteCreate(event, resolveTeamSlugFromRequest(event, parseBody(event)))
    if (method === 'GET' && path === '/invites') return await handleInviteList(event, resolveTeamSlugFromRequest(event))

    const inviteRevokeMatch = path.match(/^\/invites\/([^/]+)\/revoke$/)
    if (inviteRevokeMatch && method === 'POST') return await handleInviteRevoke(event, inviteRevokeMatch[1])

    const inviteResendMatch = path.match(/^\/invites\/([^/]+)\/resend$/)
    if (inviteResendMatch && method === 'POST') return await handleInviteResend(event, inviteResendMatch[1])

    if (method === 'POST' && path === '/invites/accept') return await handleInviteAccept(event)

    const teamAccessMatch = path.match(/^\/teams\/([^/]+)\/access$/)
    if (teamAccessMatch && method === 'GET') return await handleTeamAccess(event, teamAccessMatch[1])

    const teamBootstrapMatch = path.match(/^\/teams\/([^/]+)\/bootstrap$/)
    if (teamBootstrapMatch && method === 'POST') return await handleTeamBootstrap(event, teamBootstrapMatch[1])

    const teamMembersMatch = path.match(/^\/teams\/([^/]+)\/members$/)
    if (teamMembersMatch && method === 'GET') return await handleTeamMembersList(event, teamMembersMatch[1])

    const teamMemberPatchMatch = path.match(/^\/teams\/([^/]+)\/members\/([^/]+)$/)
    if (teamMemberPatchMatch && method === 'PATCH') {
      return await handleTeamMemberPatch(event, teamMemberPatchMatch[1], decodeURIComponent(teamMemberPatchMatch[2]))
    }
    if (teamMemberPatchMatch && method === 'DELETE') {
      return await handleTeamMemberDelete(event, teamMemberPatchMatch[1], decodeURIComponent(teamMemberPatchMatch[2]))
    }

    const inviteCreateMatch = path.match(/^\/teams\/([^/]+)\/invites$/)
    if (inviteCreateMatch && method === 'POST') return await handleInviteCreate(event, inviteCreateMatch[1])
    if (inviteCreateMatch && method === 'GET') return await handleInviteList(event, inviteCreateMatch[1])

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
      ? 'DB er ikke migreret. Kør migrations/001_init.sql, migrations/002_add_team_slug.sql og migrations/003_auth0_invites.sql mod Neon.'
      : (error?.message || 'Serverfejl')
    return jsonResponse(status, { error: message, ...(error?.invitedEmail ? { invitedEmail: error.invitedEmail } : {}) })
  }
}
