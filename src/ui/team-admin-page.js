import {
  addTeamMemberByUid,
  getTeamDocument,
  listTeamInvites,
  listTeamMembers,
  PermissionDeniedError,
  removeTeamMember,
  saveTeamInvite,
  saveTeamMember,
  setMemberActive,
} from '../../js/shared-ledger.js'
import { normalizeEmail } from '../auth/roles.js'
import { getState as getSessionState, onChange as onSessionChange } from '../auth/session.js'

let initialized = false
let teamPanel
let teamTabButton
let teamNameEl
let teamIdEl
let teamCopyIdBtn
let teamCopyNameBtn
let statusEl
let invitesListEl
let membersListEl
let inviteEmailInput
let inviteRoleSelect
let inviteSubmitButton
let uidInput
let uidRoleSelect
let uidSubmitButton
let refreshButton
let fixMembershipButton
let lastTeamId = ''
let loading = false

const MEMBER_EMAIL_FIX = 'renelowesorensen@gmail.com'

function isOwner (role) {
  return role === 'owner'
}

function isAdminRole (role) {
  return role === 'admin' || isOwner(role)
}

function setStatus (message, variant = '') {
  if (!statusEl) return
  statusEl.textContent = message || ''
  statusEl.dataset.variant = variant || ''
}

function setLoading (isLoading) {
  loading = isLoading
  const disabled = Boolean(isLoading)
  ;[inviteSubmitButton, uidSubmitButton, refreshButton, fixMembershipButton].forEach(btn => {
    if (btn) btn.disabled = disabled
  })
}

function copyToClipboard (value) {
  if (!navigator?.clipboard || !value) return
  navigator.clipboard.writeText(value).catch(() => {})
}

function renderTeamInfo (team) {
  if (!team) return
  if (teamNameEl) teamNameEl.textContent = team.name || 'Team'
  if (teamIdEl) teamIdEl.textContent = team.teamId || ''
}

function renderInvites (invites = []) {
  if (!invitesListEl) return
  invitesListEl.textContent = ''
  if (!Array.isArray(invites) || !invites.length) {
    const p = document.createElement('p')
    p.textContent = 'Ingen aktive invitationer.'
    invitesListEl.appendChild(p)
    return
  }
  invites.forEach(invite => {
    const row = document.createElement('div')
    row.className = 'team-invite-row'
    const label = document.createElement('div')
    const status = invite.usedAt ? 'brugt' : (invite.active === false ? 'deaktiveret' : 'aktiv')
    label.textContent = `${invite.email || invite.emailLower || ''} · ${invite.role || 'member'} · ${status}`
    const copyBtn = document.createElement('button')
    copyBtn.type = 'button'
    copyBtn.textContent = 'Kopiér invite-id'
    copyBtn.addEventListener('click', () => copyToClipboard(invite.inviteId || invite.id || ''))
    row.append(label, copyBtn)
    invitesListEl.appendChild(row)
  })
}

function canEditMemberRole (viewerRole, target) {
  if (!viewerRole) return false
  if (isOwner(target.role)) return false
  if (viewerRole === 'owner') return true
  if (viewerRole === 'admin') return target.role !== 'admin'
  return false
}

function canRemoveMember (viewerRole, viewerUid, target) {
  if (!viewerRole) return false
  if (isOwner(target.role)) return false
  if (viewerRole === 'owner') {
    return target.uid !== viewerUid
  }
  if (viewerRole === 'admin') {
    return target.role !== 'admin' && target.role !== 'owner'
  }
  return false
}

function renderMembers (members = [], sessionRole = '', currentUid = '') {
  if (!membersListEl) return
  membersListEl.textContent = ''
  if (!Array.isArray(members) || !members.length) {
    const p = document.createElement('p')
    p.textContent = 'Ingen medlemmer endnu.'
    membersListEl.appendChild(p)
    return
  }
  members
    .slice()
    .sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''))
    .forEach(member => {
      const row = document.createElement('div')
      row.className = 'team-member-row'
      const info = document.createElement('div')
      info.className = 'team-member-email'
      const labelParts = [
        member.displayName || member.email || member.uid || 'Ukendt',
        member.email && member.displayName ? `(${member.email})` : '',
        member.uid ? `uid: ${member.uid}` : '',
      ].filter(Boolean)
      info.textContent = labelParts.join(' ')

      const roleSelect = document.createElement('select')
      roleSelect.innerHTML = '<option value="member">Medlem</option><option value="admin">Admin</option>'
      roleSelect.value = member.role === 'admin' || member.role === 'owner' ? member.role : 'member'
      roleSelect.disabled = !canEditMemberRole(sessionRole, member)
      roleSelect.addEventListener('change', async () => {
        roleSelect.disabled = true
        try {
          await saveTeamMember(lastTeamId, { ...member, role: roleSelect.value })
          setStatus('Rolle opdateret.', 'success')
          await loadTeamData()
        } catch (error) {
          console.warn('Role update failed', error)
          setStatus(error?.message || 'Kunne ikke opdatere rolle', 'error')
          roleSelect.value = member.role === 'admin' || member.role === 'owner' ? member.role : 'member'
        } finally {
          roleSelect.disabled = !canEditMemberRole(sessionRole, member)
        }
      })

      const removeBtn = document.createElement('button')
      removeBtn.type = 'button'
      removeBtn.textContent = 'Fjern'
      removeBtn.disabled = !canRemoveMember(sessionRole, currentUid, member)
      removeBtn.addEventListener('click', async () => {
        removeBtn.disabled = true
        try {
          await removeTeamMember(lastTeamId, member.uid || member.id)
          setStatus('Medlem fjernet.', 'success')
          await loadTeamData()
        } catch (error) {
          console.warn('Remove member failed', error)
          setStatus(error?.message || 'Kunne ikke fjerne medlem', 'error')
        } finally {
          removeBtn.disabled = !canRemoveMember(sessionRole, currentUid, member)
        }
      })

      const toggleBtn = document.createElement('button')
      toggleBtn.type = 'button'
      const isActive = member.active !== false
      toggleBtn.textContent = isActive ? 'Deaktivér' : 'Aktivér'
      toggleBtn.disabled = !isAdminRole(sessionRole) || isOwner(member.role)
      toggleBtn.addEventListener('click', async () => {
        toggleBtn.disabled = true
        try {
          await setMemberActive(lastTeamId, member.uid || member.id, !isActive)
          setStatus('Status opdateret.', 'success')
          await loadTeamData()
        } catch (error) {
          console.warn('Toggle active failed', error)
          setStatus(error?.message || 'Kunne ikke opdatere status', 'error')
        } finally {
          toggleBtn.disabled = !isAdminRole(sessionRole) || isOwner(member.role)
        }
      })

      row.append(info, roleSelect, toggleBtn, removeBtn)
      membersListEl.appendChild(row)
    })
}

async function handleInviteSubmit () {
  if (!inviteEmailInput || !inviteRoleSelect) return
  const email = inviteEmailInput.value || ''
  if (!email.trim()) {
    setStatus('Angiv email for invitation.', 'error')
    return
  }
  const role = inviteRoleSelect.value === 'admin' ? 'admin' : 'member'
  setLoading(true)
  try {
    await saveTeamInvite(lastTeamId, { email, role, active: true })
    inviteEmailInput.value = ''
    setStatus('Invitation oprettet.', 'success')
    await loadTeamData()
  } catch (error) {
    console.warn('Invite create failed', error)
    setStatus(error?.message || 'Kunne ikke sende invitation', 'error')
  } finally {
    setLoading(false)
  }
}

async function handleAddByUid () {
  if (!uidInput || !uidRoleSelect) return
  const uid = uidInput.value || ''
  if (!uid.trim()) {
    setStatus('Angiv UID.', 'error')
    return
  }
  const role = uidRoleSelect.value === 'admin' ? 'admin' : 'member'
  setLoading(true)
  try {
    await addTeamMemberByUid(lastTeamId, uid, role)
    uidInput.value = ''
    setStatus('Medlem tilføjet via UID.', 'success')
    await loadTeamData()
  } catch (error) {
    console.warn('Add by UID failed', error)
    setStatus(error?.message || 'Kunne ikke tilføje medlem', 'error')
  } finally {
    setLoading(false)
  }
}

async function handleFixMembership () {
  setLoading(true)
  try {
    const invites = await listTeamInvites(lastTeamId)
    const members = await listTeamMembers(lastTeamId)
    const normalizedFixEmail = normalizeEmail(MEMBER_EMAIL_FIX)
    const hasMember = members.some(member => normalizeEmail(member.email || member.emailLower) === normalizedFixEmail)
    if (hasMember) {
      setStatus('Medlem findes allerede.', 'success')
      return
    }
    const invite = invites.find(entry => normalizeEmail(entry.email || entry.emailLower) === normalizedFixEmail && !entry.usedAt && entry.active !== false)
    if (invite) {
      setStatus('Aktiv invitation findes allerede.', 'success')
      return
    }
    await saveTeamInvite(lastTeamId, { email: MEMBER_EMAIL_FIX, role: 'member', active: true })
    setStatus('Invitation oprettet for renelowesorensen@gmail.com.', 'success')
    await loadTeamData()
  } catch (error) {
    console.warn('Fix membership failed', error)
    setStatus(error?.message || 'Kunne ikke oprette fix-invitation', 'error')
  } finally {
    setLoading(false)
  }
}

async function loadTeamData () {
  if (!lastTeamId || loading) return
  setLoading(true)
  try {
    setStatus('Indlæser team…')
    const [team, members, invites] = await Promise.all([
      getTeamDocument(lastTeamId),
      listTeamMembers(lastTeamId),
      listTeamInvites(lastTeamId),
    ])
    renderTeamInfo(team)
    const session = getSessionState()
    const sessionRole = session?.member?.role || session?.role || ''
    renderMembers(members, sessionRole, session?.user?.uid || '')
    renderInvites(invites.filter(invite => invite.active !== false && !invite.usedAt))
    setStatus('Team opdateret.', 'success')
  } catch (error) {
    console.warn('Load team data failed', error)
    const message = error instanceof PermissionDeniedError
      ? error.message || 'Ingen adgang til teamet.'
      : (error?.message || 'Kunne ikke indlæse team.')
    setStatus(message, 'error')
  } finally {
    setLoading(false)
  }
}

function updateTabVisibility (session) {
  const role = session?.member?.role || session?.role || ''
  const allowed = isAdminRole(role)
  if (!teamTabButton || !teamPanel) return
  if (allowed) {
    teamTabButton.hidden = false
    teamTabButton.removeAttribute('aria-hidden')
    teamTabButton.removeAttribute('data-tab-disabled')
    teamPanel.removeAttribute('data-tab-disabled')
  } else {
    const wasActive = teamTabButton.classList.contains('tab--active')
    teamTabButton.hidden = true
    teamTabButton.setAttribute('aria-hidden', 'true')
    teamTabButton.setAttribute('data-tab-disabled', 'true')
    teamPanel.setAttribute('data-tab-disabled', 'true')
    teamPanel.setAttribute('hidden', '')
    teamPanel.setAttribute('aria-hidden', 'true')
    if (wasActive && typeof window.__cssmateSetActiveTab === 'function') {
      window.__cssmateSetActiveTab('sagsinfo')
    }
  }
  if (typeof window.__cssmateRefreshTabs === 'function') {
    window.__cssmateRefreshTabs()
  }
}

function handleSessionChange (session) {
  updateTabVisibility(session)
  const sessionRole = session?.member?.role || session?.role || ''
  const hasAccess = isAdminRole(sessionRole) && session?.teamId && session?.sessionReady
  if (!hasAccess) {
    lastTeamId = ''
    return
  }
  const nextTeamId = session.teamId
  if (nextTeamId && nextTeamId !== lastTeamId) {
    lastTeamId = nextTeamId
    loadTeamData()
  }
}

function bindEvents () {
  if (inviteSubmitButton) {
    inviteSubmitButton.addEventListener('click', handleInviteSubmit)
  }
  if (uidSubmitButton) {
    uidSubmitButton.addEventListener('click', handleAddByUid)
  }
  if (refreshButton) {
    refreshButton.addEventListener('click', () => loadTeamData())
  }
  if (teamCopyIdBtn) {
    teamCopyIdBtn.addEventListener('click', () => copyToClipboard(lastTeamId))
  }
  if (teamCopyNameBtn) {
    teamCopyNameBtn.addEventListener('click', () => copyToClipboard(teamNameEl?.textContent || ''))
  }
  if (fixMembershipButton) {
    fixMembershipButton.addEventListener('click', handleFixMembership)
  }
}

export function initTeamAdminPage () {
  if (initialized) return
  initialized = true
  teamPanel = document.getElementById('panel-team')
  teamTabButton = document.getElementById('tab-team')
  teamNameEl = document.getElementById('teamName')
  teamIdEl = document.getElementById('teamId')
  teamCopyIdBtn = document.getElementById('teamCopyId')
  teamCopyNameBtn = document.getElementById('teamCopyName')
  statusEl = document.getElementById('teamAdminStatus')
  invitesListEl = document.getElementById('teamInvitesListTeamPage')
  membersListEl = document.getElementById('teamMembersListTeamPage')
  inviteEmailInput = document.getElementById('teamInviteEmailTeamPage')
  inviteRoleSelect = document.getElementById('teamInviteRoleTeamPage')
  inviteSubmitButton = document.getElementById('teamInviteSubmitTeamPage')
  uidInput = document.getElementById('teamUidInput')
  uidRoleSelect = document.getElementById('teamUidRole')
  uidSubmitButton = document.getElementById('teamUidSubmit')
  refreshButton = document.getElementById('teamRefresh')
  fixMembershipButton = document.getElementById('teamFixMembership')

  bindEvents()
  onSessionChange(handleSessionChange)
  handleSessionChange(getSessionState())
}

export function setTeamTabVisibility (visible) {
  if (!teamTabButton || !teamPanel) return
  if (visible) {
    teamTabButton.hidden = false
    teamTabButton.removeAttribute('aria-hidden')
    teamTabButton.removeAttribute('data-tab-disabled')
    teamPanel.removeAttribute('data-tab-disabled')
  } else {
    teamTabButton.hidden = true
    teamTabButton.setAttribute('aria-hidden', 'true')
    teamTabButton.setAttribute('data-tab-disabled', 'true')
    teamPanel.setAttribute('data-tab-disabled', 'true')
  }
  if (typeof window.__cssmateRefreshTabs === 'function') {
    window.__cssmateRefreshTabs()
  }
}
