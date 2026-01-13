export function isRemovingActiveAdmin ({
  existingRole,
  existingStatus,
  nextRole,
  nextStatus,
  isDelete = false,
}) {
  if (existingRole !== 'admin' && existingRole !== 'owner') return false
  if (existingStatus !== 'active') return false
  if (isDelete) return true
  const resolvedRole = nextRole ?? existingRole
  const resolvedStatus = nextStatus ?? existingStatus
  return (resolvedRole !== 'admin' && resolvedRole !== 'owner') || resolvedStatus !== 'active'
}

export function ensureActiveAdminGuard ({
  admins,
  targetUserId,
  existingRole,
  existingStatus,
  nextRole,
  nextStatus,
  isDelete = false,
}) {
  if (!isRemovingActiveAdmin({ existingRole, existingStatus, nextRole, nextStatus, isDelete })) {
    return true
  }
  const activeAdmins = admins.filter((admin) => admin.status === 'active')
  if (activeAdmins.length === 0) return false
  if (activeAdmins.length > 1) return true
  return activeAdmins[0]?.user_sub !== targetUserId
}
