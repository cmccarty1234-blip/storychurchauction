import { cookies } from 'next/headers'
import { route } from '@/lib/api'
import { query } from '@/lib/db'
import { hashToken } from '@/lib/auth-core'
import { ADMIN_COOKIE, clearSessionCookie } from '@/lib/session'

export const POST = route(async () => {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value
  if (token) await query('delete from admin_sessions where token_hash = $1', [hashToken(token)])
  await clearSessionCookie('admin')
  return { ok: true }
})
