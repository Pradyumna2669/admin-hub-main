export function getLatestClaimStartedAt(
  assignments: any[] | undefined,
  userId?: string | null,
  categoryId?: string | null
) {
  if (!assignments || !userId) {
    return null;
  }

  let latestTimestamp = 0;

  const shouldFilterByCategory = categoryId !== undefined;

  for (const assignment of assignments) {
    if (assignment?.user_id !== userId || !assignment?.started_at) {
      continue;
    }

    if (shouldFilterByCategory) {
      const assignmentCategoryId =
        assignment?.task?.category_id ??
        assignment?.tasks?.category_id ??
        null;

      if (assignmentCategoryId !== (categoryId ?? null)) {
        continue;
      }
    }

    const timestamp = new Date(assignment.started_at).getTime();
    if (Number.isFinite(timestamp) && timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
    }
  }

  return latestTimestamp > 0 ? latestTimestamp : null;
}

export function getClaimCooldownRemainingMs(
  latestClaimStartedAt: number | null,
  cooldownMinutes: number,
  now = Date.now()
) {
  if (!latestClaimStartedAt || cooldownMinutes <= 0) {
    return 0;
  }

  const endsAt = latestClaimStartedAt + cooldownMinutes * 60 * 1000;
  return Math.max(0, endsAt - now);
}

export function formatCooldownRemaining(remainingMs: number) {
  if (remainingMs <= 0) {
    return '0m 0s';
  }

  const minutes = Math.floor(remainingMs / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}
