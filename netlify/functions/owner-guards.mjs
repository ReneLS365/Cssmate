export function isRemovingActiveOwner ({
  existingRole,
  existingStatus,
  nextRole,
  nextStatus,
  isDelete = false,
}) {
  if (existingRole !== 'owner') return false
  if (existingStatus !== 'active') return false
  if (isDelete) return true
  const resolvedRole = nextRole ?? existingRole
  const resolvedStatus = nextStatus ?? existingStatus
  return resolvedRole !== 'owner' || resolvedStatus !== 'active'
}

export function ensureActiveOwnerGuard ({
  owners,
  targetUserId,
  existingRole,
  existingStatus,
  nextRole,
  nextStatus,
  isDelete = false,
}) {
  if (!isRemovingActiveOwner({ existingRole, existingStatus, nextRole, nextStatus, isDelete })) {
    return true
  }
  const activeOwners = owners.filter((owner) => owner.status === 'active')
  if (activeOwners.length === 0) return false
  if (activeOwners.length > 1) return true
  return activeOwners[0]?.user_id !== targetUserId
}
