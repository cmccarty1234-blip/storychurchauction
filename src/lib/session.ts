import { cookies } from 'next/headers'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { adminFromToken, bidderFromToken, ADMIN_SESSION_HOURS, BIDDER_SESSION_DAYS, type AdminRow, type BidderRow } from './auth-core'
import { AppError } from './errors'
import { appUrl } from './appurl'

export const BIDDER_COOKIE = 'sc_bidder'
export const ADMIN_COOKIE = 'sc_admin'

const secureCookies = () => appUrl().startsWith('https://')

export const getBidder = cache(async (): Promise<BidderRow | null> => {
  return bidderFromToken((await cookies()).get(BIDDER_COOKIE)?.value)
})

export const getAdmin = cache(async (): Promise<AdminRow | null> => {
  return adminFromToken((await cookies()).get(ADMIN_COOKIE)?.value)
})

export async function setSessionCookie(kind: 'bidder' | 'admin', token: string) {
  const maxAge = kind === 'bidder' ? BIDDER_SESSION_DAYS * 86400 : ADMIN_SESSION_HOURS * 3600
  ;(await cookies()).set(kind === 'bidder' ? BIDDER_COOKIE : ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    path: '/',
    maxAge,
  })
}

export async function clearSessionCookie(kind: 'bidder' | 'admin') {
  ;(await cookies()).delete(kind === 'bidder' ? BIDDER_COOKIE : ADMIN_COOKIE)
}

/** For API routes: throws 401 JSON error. */
export async function requireBidder(): Promise<BidderRow> {
  const b = await getBidder()
  if (!b) throw new AppError('UNAUTHENTICATED', 'Please sign in to bid.', 401)
  return b
}

/** For API routes. Authorization is always enforced here, server-side — never only in the UI. */
export async function requireAdmin(role: 'admin' | 'host' | 'volunteer' = 'volunteer'): Promise<AdminRow> {
  const a = await getAdmin()
  if (!a) throw new AppError('UNAUTHENTICATED', 'Staff sign-in required.', 401)
  if (role === 'admin' && a.role !== 'admin') throw new AppError('FORBIDDEN', 'Only an administrator can do this.', 403)
  if (role === 'host' && a.role === 'volunteer') throw new AppError('FORBIDDEN', 'Only a host or administrator can do this.', 403)
  return a
}

/** For pages: redirects instead of throwing. */
export async function requireAdminPage(role: 'admin' | 'volunteer' = 'volunteer'): Promise<AdminRow> {
  const a = await getAdmin()
  if (!a) redirect('/admin/login')
  if (role === 'admin' && a.role !== 'admin') redirect('/admin')
  return a
}

export async function requireBidderPage(next: string): Promise<BidderRow> {
  const b = await getBidder()
  if (!b) redirect(`/register?next=${encodeURIComponent(next)}`)
  return b
}
