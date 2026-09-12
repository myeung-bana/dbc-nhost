import type { Response } from 'express'

export type ApiSuccess<T> = { ok: true; data: T }
export type ApiError = { ok: false; error: string; details?: unknown }

export function sendSuccess<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ ok: true, data } satisfies ApiSuccess<T>)
}

export function sendError(
  res: Response,
  error: string,
  status = 400,
  details?: unknown,
) {
  return res.status(status).json({ ok: false, error, details } satisfies ApiError)
}
