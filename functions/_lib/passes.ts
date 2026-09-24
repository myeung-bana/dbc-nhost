import { assignLegacyCredits, loadBookablePassSummary } from './season-passes'

export type PassBalanceRow = {
  id: string
  space_id: string
  user_id: string
  balance: number
  updated_at: string
}

export async function getActiveCreditTotal(spaceId: string, userId: string) {
  const summary = await loadBookablePassSummary(spaceId, userId)
  return summary.activeCredits
}

export async function getPassBalance(
  spaceId: string,
  userId: string,
): Promise<PassBalanceRow | null> {
  const summary = await loadBookablePassSummary(spaceId, userId)
  if (!summary.passes.length && summary.activeCredits === 0) {
    return null
  }

  return {
    id: summary.passes[0]?.id ?? '',
    space_id: spaceId,
    user_id: userId,
    balance: summary.activeCredits,
    updated_at: summary.passes[0]?.created_at ?? new Date().toISOString(),
  }
}

export async function assignPassCredits(input: {
  spaceId: string
  userId: string
  amount: number
  actorId: string
  note?: string | null
}) {
  const assigned = await assignLegacyCredits(input)
  const activeCredits = await getActiveCreditTotal(input.spaceId, input.userId)
  return {
    id: assigned?.id ?? '',
    space_id: input.spaceId,
    user_id: input.userId,
    balance: activeCredits,
    updated_at: new Date().toISOString(),
  }
}
