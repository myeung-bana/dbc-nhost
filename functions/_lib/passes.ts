import { createAdminClient } from './nhost-admin'

export type PassBalanceRow = {
  id: string
  space_id: string
  user_id: string
  balance: number
  updated_at: string
}

export async function getPassBalance(
  spaceId: string,
  userId: string,
): Promise<PassBalanceRow | null> {
  const admin = createAdminClient()
  const { body } = await admin.graphql.request({
    query: `
      query PassBalance($spaceId: uuid!, $userId: uuid!) {
        pass_balances(
          where: {
            space_id: { _eq: $spaceId }
            user_id: { _eq: $userId }
          }
          limit: 1
        ) {
          id
          space_id
          user_id
          balance
          updated_at
        }
      }
    `,
    variables: { spaceId, userId },
  })

  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? 'Failed to load pass balance')
  }

  return (body.data as { pass_balances?: PassBalanceRow[] }).pass_balances?.[0] ?? null
}

export async function assignPassCredits(input: {
  spaceId: string
  userId: string
  amount: number
  actorId: string
  note?: string | null
}) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error('amount must be a positive integer')
  }

  const admin = createAdminClient()
  const existing = await getPassBalance(input.spaceId, input.userId)
  const nextBalance = (existing?.balance ?? 0) + input.amount

  const { body: balanceResult } = await admin.graphql.request({
    query: `
      mutation UpsertPassBalance($object: pass_balances_insert_input!) {
        insert_pass_balances_one(
          object: $object
          on_conflict: {
            constraint: pass_balances_space_id_user_id_key
            update_columns: [balance, updated_at]
          }
        ) {
          id
          space_id
          user_id
          balance
          updated_at
        }
      }
    `,
    variables: {
      object: {
        space_id: input.spaceId,
        user_id: input.userId,
        balance: nextBalance,
      },
    },
  })

  if (balanceResult.errors?.length) {
    throw new Error(balanceResult.errors[0]?.message ?? 'Failed to update pass balance')
  }

  const { body: ledgerResult } = await admin.graphql.request({
    query: `
      mutation InsertPassLedger($object: pass_ledger_insert_input!) {
        insert_pass_ledger_one(object: $object) {
          id
        }
      }
    `,
    variables: {
      object: {
        space_id: input.spaceId,
        user_id: input.userId,
        delta: input.amount,
        reason: 'manual_assign',
        actor_id: input.actorId,
        note: input.note?.trim() || null,
      },
    },
  })

  if (ledgerResult.errors?.length) {
    throw new Error(ledgerResult.errors[0]?.message ?? 'Failed to record pass ledger entry')
  }

  return (balanceResult.data as { insert_pass_balances_one?: PassBalanceRow })
    .insert_pass_balances_one
}

export async function decrementPassCredit(input: {
  spaceId: string
  userId: string
  sessionId: string
}) {
  const admin = createAdminClient()
  const balance = await getPassBalance(input.spaceId, input.userId)
  if (!balance || balance.balance < 1) {
    throw new Error('Insufficient pass credits')
  }

  const nextBalance = balance.balance - 1

  const { body: balanceResult } = await admin.graphql.request({
    query: `
      mutation DecrementPassBalance($id: uuid!, $balance: Int!) {
        update_pass_balances_by_pk(
          pk_columns: { id: $id }
          _set: { balance: $balance }
        ) {
          id
          balance
        }
      }
    `,
    variables: { id: balance.id, balance: nextBalance },
  })

  if (balanceResult.errors?.length) {
    throw new Error(balanceResult.errors[0]?.message ?? 'Failed to decrement pass balance')
  }

  const { body: ledgerResult } = await admin.graphql.request({
    query: `
      mutation InsertPassLedger($object: pass_ledger_insert_input!) {
        insert_pass_ledger_one(object: $object) {
          id
        }
      }
    `,
    variables: {
      object: {
        space_id: input.spaceId,
        user_id: input.userId,
        delta: -1,
        reason: 'booking',
        actor_id: input.userId,
        session_id: input.sessionId,
      },
    },
  })

  if (ledgerResult.errors?.length) {
    throw new Error(ledgerResult.errors[0]?.message ?? 'Failed to record pass ledger entry')
  }

  return nextBalance
}
