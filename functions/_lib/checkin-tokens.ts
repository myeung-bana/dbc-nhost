import { createHmac, timingSafeEqual } from 'crypto'

export type BookingCheckinToken = {
  kind: 'booking'
  bookingId: string
  userId: string
  sessionId: string
  spaceId: string
  exp: number
}

export type PlayerCheckinToken = {
  kind: 'player'
  userId: string
  spaceId: string
  exp: number
}

export type CheckinToken = BookingCheckinToken | PlayerCheckinToken

const BOOKING_TTL_MS = 5 * 60 * 1000
const PLAYER_TTL_MS = 30 * 24 * 60 * 60 * 1000

function secret() {
  const value =
    process.env.CHECKIN_TOKEN_SECRET ||
    process.env.NHOST_ADMIN_SECRET ||
    process.env.HASURA_GRAPHQL_ADMIN_SECRET
  if (!value) {
    throw new Error('Missing check-in token secret')
  }
  return value
}

function signBody(body: string) {
  return createHmac('sha256', secret()).update(body).digest('base64url')
}

export function issueCheckinToken(payload: Omit<BookingCheckinToken, 'kind' | 'exp'> | Omit<PlayerCheckinToken, 'kind' | 'exp'> & { kind: 'player' }) {
  const now = Date.now()
  const tokenPayload: CheckinToken =
    'bookingId' in payload
      ? {
          kind: 'booking',
          bookingId: payload.bookingId,
          userId: payload.userId,
          sessionId: payload.sessionId,
          spaceId: payload.spaceId,
          exp: now + BOOKING_TTL_MS,
        }
      : {
          kind: 'player',
          userId: payload.userId,
          spaceId: payload.spaceId,
          exp: now + PLAYER_TTL_MS,
        }

  const body = Buffer.from(JSON.stringify(tokenPayload)).toString('base64url')
  return {
    token: `gachi-checkin.${body}.${signBody(body)}`,
    expiresAt: new Date(tokenPayload.exp).toISOString(),
  }
}

export function verifyCheckinToken(token: string): CheckinToken {
  const parts = token.trim().split('.')
  if (parts.length !== 3 || parts[0] !== 'gachi-checkin') {
    throw new Error('Invalid check-in token')
  }

  const [, body, signature] = parts
  const expected = signBody(body)
  const actualBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expected)
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    throw new Error('Invalid check-in token')
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CheckinToken
  if (!payload?.exp || payload.exp < Date.now()) {
    throw new Error('Check-in token has expired')
  }
  if (payload.kind !== 'booking' && payload.kind !== 'player') {
    throw new Error('Invalid check-in token')
  }
  return payload
}
