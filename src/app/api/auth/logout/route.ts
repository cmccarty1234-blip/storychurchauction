import { cookies } from 'next/headers'
import { route } from '@/lib/api'
import { query } from '@/lib/db'
import { hashToken } from '@/lib/auth-core'
import { BIDDER_COOKIE, clearSessionCookie } from '@/lib/session'

export const POST = route(async () => {
  const token = (await cookies()).get(BIDDER_COOKIE)?.value
  if (token) await query('delete from bidder_sessions where token_hash = $1', [hashToken(token)])
  await clearSessionCookie('bidder')
  return { ok: true }
})
