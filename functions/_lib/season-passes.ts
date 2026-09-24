import { createAdminClient } from './nhost-admin'

export type PassStatus = 'active' | 'expiring_soon' | 'exhausted' | 'expired' | 'upcoming'

export type PassRedemptionMode = 'qr_checkin' | 'auto_consume' | 'both'

export type CheckinMethod = 'qr' | 'manual' | 'auto_consume'

export type SeasonPassTemplate = {
  id: string
  space_id: string
  name: string
  credit_count: number
  start_date: string
  end_date: string
  price?: string | number | null
  is_legacy: boolean
  created_at: string
}

export type UserSeasonPassRow = {
  id: string
  user_id: string
  space_id: string
  season_pass_id: string
  credits_total: number
  credits_remaining: number
  start_date: string
  end_date: string
  created_at: string
  season_pass?: { id: string; name: string; is_legacy: boolean } | null
  space?: { id: string; name: string; slug: string; pass_redemption_mode?: PassRedemptionMode | null } | null
}

export type PassGate = 'ok' | 'no_credits' | 'pass_expired'

export class PassError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

const EXPIRING_SOON_DAYS = 7

export function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10)
}

export function isWithinWindow(
  pass: { start_date: string; end_date: string },
  at: Date,
) {
  const day = dateOnly(at)
  return pass.start_date <= day && day <= pass.end_date
}

export function computePassStatus(
  pass: { start_date: string; end_date: string; credits_remaining: number },
  now = new Date(),
): PassStatus {
  const day = dateOnly(now)
  if (day > pass.end_date) return 'expired'
  if (day < pass.start_date) return 'upcoming'
  if (pass.credits_remaining <= 0) return 'exhausted'
  const endMs = Date.parse(`${pass.end_date}T00:00:00.000Z`)
  const todayMs = Date.parse(`${day}T00:00:00.000Z`)
  const daysLeft = Math.round((endMs - todayMs) / 86_400_000)
  if (daysLeft < EXPIRING_SOON_DAYS) return 'expiring_soon'
  return 'active'
}

async function gql<T>(query: string, variables?: Record<string, unknown>) {
  const admin = createAdminClient()
  const { body } = await admin.graphql.request({ query, variables })
  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? 'GraphQL request failed')
  }
  return body.data as T
}

const userPassFields = `
  id
  user_id
  space_id
  season_pass_id
  credits_total
  credits_remaining
  start_date
  end_date
  created_at
  season_pass {
    id
    name
    is_legacy
  }
  space {
    id
    name
    slug
    pass_redemption_mode
  }
`

export async function listUserSeasonPasses(spaceId: string | null, userId: string) {
  const query = spaceId
    ? `
      query UserSeasonPasses($userId: uuid!, $spaceId: uuid!) {
        user_season_passes(
          where: { user_id: { _eq: $userId }, space_id: { _eq: $spaceId } }
          order_by: { created_at: desc }
        ) {
          ${userPassFields}
        }
      }
    `
    : `
      query UserSeasonPasses($userId: uuid!) {
        user_season_passes(
          where: { user_id: { _eq: $userId } }
          order_by: { created_at: desc }
        ) {
          ${userPassFields}
        }
      }
    `
  const data = await gql<{ user_season_passes: UserSeasonPassRow[] }>(
    query,
    spaceId ? { userId, spaceId } : { userId },
  )
  return data.user_season_passes ?? []
}

export function withStatus<T extends { start_date: string; end_date: string; credits_remaining: number }>(
  pass: T,
  now = new Date(),
) {
  return { ...pass, status: computePassStatus(pass, now) }
}

export function getBookablePassSummary(
  passes: Array<{ start_date: string; end_date: string; credits_remaining: number }>,
  now = new Date(),
): { canBook: boolean; state: PassGate; activeCredits: number } {
  const inWindow = passes.filter((pass) => isWithinWindow(pass, now))
  const activeCredits = inWindow.reduce(
    (sum, pass) => sum + Math.max(0, pass.credits_remaining),
    0,
  )
  if (activeCredits > 0) {
    return { canBook: true, state: 'ok', activeCredits }
  }
  if (inWindow.length > 0) {
    return { canBook: false, state: 'no_credits', activeCredits: 0 }
  }
  if (passes.some((pass) => dateOnly(now) > pass.end_date)) {
    return { canBook: false, state: 'pass_expired', activeCredits: 0 }
  }
  return { canBook: false, state: 'no_credits', activeCredits: 0 }
}

export async function loadBookablePassSummary(spaceId: string, userId: string, now = new Date()) {
  const passes = await listUserSeasonPasses(spaceId, userId)
  return {
    passes,
    ...getBookablePassSummary(passes, now),
  }
}

export function pickPassForDeduction(
  passes: UserSeasonPassRow[],
  at: Date,
) {
  return (
    passes
      .filter((pass) => isWithinWindow(pass, at) && pass.credits_remaining > 0)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  )
}

async function insertLedger(input: {
  spaceId: string
  userId: string
  delta: number
  reason: string
  actorId?: string | null
  sessionId?: string | null
  bookingId?: string | null
  userSeasonPassId?: string | null
  note?: string | null
}) {
  await gql(
    `
      mutation InsertPassLedger($object: pass_ledger_insert_input!) {
        insert_pass_ledger_one(object: $object) { id }
      }
    `,
    {
      object: {
        space_id: input.spaceId,
        user_id: input.userId,
        delta: input.delta,
        reason: input.reason,
        actor_id: input.actorId ?? null,
        session_id: input.sessionId ?? null,
        booking_id: input.bookingId ?? null,
        user_season_pass_id: input.userSeasonPassId ?? null,
        note: input.note ?? null,
      },
    },
  )
}

function ledgerReasonForMethod(method: CheckinMethod) {
  if (method === 'qr') return 'checkin'
  if (method === 'manual') return 'manual_deduct'
  return 'auto_consume'
}

export async function findCheckinForSessionUser(sessionId: string, userId: string) {
  const data = await gql<{
    booking_checkins: Array<{
      id: string
      method: CheckinMethod
      scanned_at: string
      user_season_pass_id: string
      credit_delta: number
    }>
  }>(
    `
      query ExistingCheckin($sessionId: uuid!, $userId: uuid!) {
        booking_checkins(
          where: { session_id: { _eq: $sessionId }, user_id: { _eq: $userId } }
          limit: 1
        ) {
          id
          method
          scanned_at
          user_season_pass_id
          credit_delta
        }
      }
    `,
    { sessionId, userId },
  )
  return data.booking_checkins?.[0] ?? null
}

async function restoreCredit(passId: string) {
  await gql(
    `
      mutation RestoreCredit($id: uuid!) {
        update_user_season_passes(
          where: { id: { _eq: $id } }
          _inc: { credits_remaining: 1 }
        ) {
          affected_rows
        }
      }
    `,
    { id: passId },
  )
}

export async function deductSeasonPassCredit(input: {
  spaceId: string
  userId: string
  sessionId: string
  bookingId?: string | null
  method: CheckinMethod
  actorId: string
  at?: Date
}) {
  const existing = await findCheckinForSessionUser(input.sessionId, input.userId)
  if (existing) {
    throw new PassError('Already checked in', 'already_checked_in', 409)
  }

  const at = input.at ?? new Date()
  const passes = await listUserSeasonPasses(input.spaceId, input.userId)
  const pass = pickPassForDeduction(passes, at)
  if (!pass) {
    const summary = getBookablePassSummary(passes, at)
    if (summary.state === 'pass_expired') {
      throw new PassError('Season pass has expired', 'pass_expired', 409)
    }
    throw new PassError('No credits remaining', 'no_credits', 409)
  }

  const decremented = await gql<{
    update_user_season_passes?: { affected_rows: number; returning: Array<{ credits_remaining: number }> }
  }>(
    `
      mutation DecrementSeasonPass($id: uuid!) {
        update_user_season_passes(
          where: { id: { _eq: $id }, credits_remaining: { _gte: 1 } }
          _inc: { credits_remaining: -1 }
        ) {
          affected_rows
          returning { credits_remaining }
        }
      }
    `,
    { id: pass.id },
  )

  if (!decremented.update_user_season_passes?.affected_rows) {
    throw new PassError('No credits remaining', 'no_credits', 409)
  }

  const creditsRemaining = decremented.update_user_season_passes.returning[0]?.credits_remaining ?? 0

  try {
    const inserted = await gql<{
      insert_booking_checkins_one?: { id: string; scanned_at: string }
    }>(
      `
        mutation InsertCheckin($object: booking_checkins_insert_input!) {
          insert_booking_checkins_one(object: $object) {
            id
            scanned_at
          }
        }
      `,
      {
        object: {
          booking_id: input.bookingId ?? null,
          session_id: input.sessionId,
          user_id: input.userId,
          user_season_pass_id: pass.id,
          method: input.method,
          scanned_by: input.actorId,
          credit_delta: -1,
        },
      },
    )

    await insertLedger({
      spaceId: input.spaceId,
      userId: input.userId,
      delta: -1,
      reason: ledgerReasonForMethod(input.method),
      actorId: input.actorId,
      sessionId: input.sessionId,
      bookingId: input.bookingId,
      userSeasonPassId: pass.id,
    })

    return {
      checkinId: inserted.insert_booking_checkins_one?.id ?? null,
      creditsRemaining,
      passId: pass.id,
      passName: pass.season_pass?.name ?? 'Season pass',
    }
  } catch (error) {
    await restoreCredit(pass.id)
    const message = error instanceof Error ? error.message : ''
    if (message.toLowerCase().includes('unique') || message.toLowerCase().includes('uniqueness')) {
      throw new PassError('Already checked in', 'already_checked_in', 409)
    }
    throw error
  }
}

export async function listSeasonPassTemplates(spaceId: string) {
  const data = await gql<{ season_passes: SeasonPassTemplate[] }>(
    `
      query SeasonPassTemplates($spaceId: uuid!) {
        season_passes(
          where: { space_id: { _eq: $spaceId }, is_legacy: { _eq: false } }
          order_by: { created_at: desc }
        ) {
          id
          space_id
          name
          credit_count
          start_date
          end_date
          price
          is_legacy
          created_at
        }
      }
    `,
    { spaceId },
  )
  return data.season_passes ?? []
}

export async function createSeasonPassTemplate(input: {
  spaceId: string
  name: string
  creditCount: number
  startDate: string
  endDate: string
  price?: number | null
  createdBy: string
}) {
  if (!Number.isInteger(input.creditCount) || input.creditCount <= 0) {
    throw new PassError('creditCount must be a positive integer', 'invalid_amount')
  }
  if (input.endDate < input.startDate) {
    throw new PassError('endDate must be on or after startDate', 'invalid_dates')
  }

  const data = await gql<{ insert_season_passes_one: SeasonPassTemplate }>(
    `
      mutation CreateSeasonPass($object: season_passes_insert_input!) {
        insert_season_passes_one(object: $object) {
          id
          space_id
          name
          credit_count
          start_date
          end_date
          price
          is_legacy
          created_at
        }
      }
    `,
    {
      object: {
        space_id: input.spaceId,
        name: input.name.trim(),
        credit_count: input.creditCount,
        start_date: input.startDate,
        end_date: input.endDate,
        price: input.price ?? null,
        is_legacy: false,
        created_by: input.createdBy,
      },
    },
  )
  return data.insert_season_passes_one
}

async function ensureLegacyTemplate(spaceId: string, actorId: string) {
  const existing = await gql<{ season_passes: SeasonPassTemplate[] }>(
    `
      query LegacyTemplate($spaceId: uuid!) {
        season_passes(
          where: { space_id: { _eq: $spaceId }, is_legacy: { _eq: true } }
          limit: 1
        ) {
          id
          space_id
          name
          credit_count
          start_date
          end_date
          is_legacy
          created_at
        }
      }
    `,
    { spaceId },
  )
  if (existing.season_passes?.[0]) return existing.season_passes[0]

  const created = await gql<{ insert_season_passes_one: SeasonPassTemplate }>(
    `
      mutation CreateLegacyTemplate($object: season_passes_insert_input!) {
        insert_season_passes_one(object: $object) {
          id
          space_id
          name
          credit_count
          start_date
          end_date
          is_legacy
          created_at
        }
      }
    `,
    {
      object: {
        space_id: spaceId,
        name: 'Legacy credits',
        credit_count: 1,
        start_date: '2000-01-01',
        end_date: '2099-12-31',
        is_legacy: true,
        created_by: actorId,
      },
    },
  )
  return created.insert_season_passes_one
}

export async function assignSeasonPassFromTemplate(input: {
  spaceId: string
  userId: string
  seasonPassId: string
  actorId: string
}) {
  const templateResult = await gql<{ season_passes_by_pk: SeasonPassTemplate | null }>(
    `
      query SeasonPassByPk($id: uuid!) {
        season_passes_by_pk(id: $id) {
          id
          space_id
          name
          credit_count
          start_date
          end_date
          is_legacy
          created_at
        }
      }
    `,
    { id: input.seasonPassId },
  )
  const template = templateResult.season_passes_by_pk
  if (!template || template.space_id !== input.spaceId) {
    throw new PassError('Season pass template not found', 'not_found', 404)
  }

  const created = await gql<{ insert_user_season_passes_one: UserSeasonPassRow }>(
    `
      mutation AssignUserSeasonPass($object: user_season_passes_insert_input!) {
        insert_user_season_passes_one(object: $object) {
          ${userPassFields}
        }
      }
    `,
    {
      object: {
        user_id: input.userId,
        space_id: input.spaceId,
        season_pass_id: template.id,
        credits_total: template.credit_count,
        credits_remaining: template.credit_count,
        start_date: template.start_date,
        end_date: template.end_date,
        assigned_by: input.actorId,
      },
    },
  )

  const pass = created.insert_user_season_passes_one
  await insertLedger({
    spaceId: input.spaceId,
    userId: input.userId,
    delta: template.credit_count,
    reason: 'manual_assign',
    actorId: input.actorId,
    userSeasonPassId: pass.id,
    note: template.name,
  })
  return pass
}

export async function topUpSeasonPass(input: {
  userSeasonPassId: string
  amount: number
  actorId: string
  note?: string | null
  at?: Date
}) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new PassError('amount must be a positive integer', 'invalid_amount')
  }

  const loaded = await gql<{ user_season_passes_by_pk: UserSeasonPassRow | null }>(
    `
      query UserSeasonPassByPk($id: uuid!) {
        user_season_passes_by_pk(id: $id) {
          ${userPassFields}
        }
      }
    `,
    { id: input.userSeasonPassId },
  )
  const pass = loaded.user_season_passes_by_pk
  if (!pass) {
    throw new PassError('Season pass not found', 'not_found', 404)
  }

  const at = input.at ?? new Date()
  if (dateOnly(at) > pass.end_date) {
    throw new PassError(
      'This pass has expired. Issue a new season pass instead of topping it up.',
      'pass_expired',
      409,
    )
  }

  const updated = await gql<{
    update_user_season_passes_by_pk: UserSeasonPassRow | null
  }>(
    `
      mutation TopUpSeasonPass($id: uuid!, $remaining: Int!, $total: Int!) {
        update_user_season_passes_by_pk(
          pk_columns: { id: $id }
          _set: { credits_remaining: $remaining, credits_total: $total }
        ) {
          ${userPassFields}
        }
      }
    `,
    {
      id: pass.id,
      remaining: pass.credits_remaining + input.amount,
      total: pass.credits_total + input.amount,
    },
  )

  await insertLedger({
    spaceId: pass.space_id,
    userId: pass.user_id,
    delta: input.amount,
    reason: 'top_up',
    actorId: input.actorId,
    userSeasonPassId: pass.id,
    note: input.note,
  })

  return updated.update_user_season_passes_by_pk
}

export async function assignLegacyCredits(input: {
  spaceId: string
  userId: string
  amount: number
  actorId: string
  note?: string | null
}) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new PassError('amount must be a positive integer', 'invalid_amount')
  }

  const template = await ensureLegacyTemplate(input.spaceId, input.actorId)
  const existing = (await listUserSeasonPasses(input.spaceId, input.userId)).find(
    (pass) => pass.season_pass_id === template.id,
  )

  if (existing) {
    return topUpSeasonPass({
      userSeasonPassId: existing.id,
      amount: input.amount,
      actorId: input.actorId,
      note: input.note,
    })
  }

  const created = await gql<{ insert_user_season_passes_one: UserSeasonPassRow }>(
    `
      mutation AssignLegacyPass($object: user_season_passes_insert_input!) {
        insert_user_season_passes_one(object: $object) {
          ${userPassFields}
        }
      }
    `,
    {
      object: {
        user_id: input.userId,
        space_id: input.spaceId,
        season_pass_id: template.id,
        credits_total: input.amount,
        credits_remaining: input.amount,
        start_date: template.start_date,
        end_date: template.end_date,
        assigned_by: input.actorId,
      },
    },
  )

  await insertLedger({
    spaceId: input.spaceId,
    userId: input.userId,
    delta: input.amount,
    reason: 'manual_assign',
    actorId: input.actorId,
    userSeasonPassId: created.insert_user_season_passes_one.id,
    note: input.note,
  })

  return created.insert_user_season_passes_one
}

export async function listPassHistory(spaceId: string, userId: string) {
  const data = await gql<{
    pass_ledger: Array<{
      id: string
      delta: number
      reason: string
      note?: string | null
      created_at: string
      session_id?: string | null
      booking_id?: string | null
      user_season_pass_id?: string | null
    }>
    booking_checkins: Array<{
      id: string
      session_id: string
      method: CheckinMethod
      scanned_at: string
      credit_delta: number
      booking_id?: string | null
      session?: { id: string; title: string; starts_at: string } | null
    }>
  }>(
    `
      query PassHistory($spaceId: uuid!, $userId: uuid!) {
        pass_ledger(
          where: { space_id: { _eq: $spaceId }, user_id: { _eq: $userId } }
          order_by: { created_at: desc }
          limit: 50
        ) {
          id
          delta
          reason
          note
          created_at
          session_id
          booking_id
          user_season_pass_id
        }
        booking_checkins(
          where: { user_id: { _eq: $userId }, session: { space_id: { _eq: $spaceId } } }
          order_by: { scanned_at: desc }
          limit: 50
        ) {
          id
          session_id
          method
          scanned_at
          credit_delta
          booking_id
          session {
            id
            title
            starts_at
          }
        }
      }
    `,
    { spaceId, userId },
  )

  return {
    ledger: data.pass_ledger ?? [],
    checkins: data.booking_checkins ?? [],
  }
}

export async function getSpaceRedemptionSettings(spaceId: string) {
  const data = await gql<{
    spaces_by_pk: {
      id: string
      pass_redemption_mode: PassRedemptionMode
      auto_consume_cutoff_minutes: number
    } | null
  }>(
    `
      query SpaceRedemption($id: uuid!) {
        spaces_by_pk(id: $id) {
          id
          pass_redemption_mode
          auto_consume_cutoff_minutes
        }
      }
    `,
    { id: spaceId },
  )
  return data.spaces_by_pk
}

export function toPublicPass(pass: UserSeasonPassRow, now = new Date()) {
  return {
    id: pass.id,
    spaceId: pass.space_id,
    seasonPassId: pass.season_pass_id,
    name: pass.season_pass?.name ?? 'Season pass',
    creditsRemaining: pass.credits_remaining,
    creditsTotal: pass.credits_total,
    startDate: pass.start_date,
    endDate: pass.end_date,
    status: computePassStatus(pass, now),
    isLegacy: pass.season_pass?.is_legacy ?? false,
    createdAt: pass.created_at,
    space: pass.space
      ? {
          id: pass.space.id,
          name: pass.space.name,
          slug: pass.space.slug,
          redemptionMode: pass.space.pass_redemption_mode ?? 'both',
        }
      : null,
  }
}
