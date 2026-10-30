import Image from 'next/image'
import Link from 'next/link'
import { requireAdminPage } from '@/lib/session'
import { getEvent } from '@/lib/events'
import { SignOutButton } from '@/components/sign-out-button'
import { AdminNav, type NavItem } from '@/components/admin-nav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage() // server-side gate for every page in /admin (login excluded)
  const ev = await getEvent().catch(() => null)
  const nav: NavItem[] = [
    { href: '/admin', label: 'Dashboard', icon: 'dashboard' },
    { href: '/admin/items', label: 'Items', icon: 'items' },
    { href: '/admin/bid-desk', label: 'Bid desk', icon: 'bidDesk' },
    { href: '/admin/bidders', label: 'Bidders', icon: 'bidders' },
    { href: '/admin/bids', label: 'Bid history', icon: 'bids' },
    { href: '/admin/live', label: 'Clerk (bids)', icon: 'live' },
    ...(admin.role !== 'volunteer' ? [{ href: '/admin/show', label: 'Host console', icon: 'show' } as NavItem] : []),
    { href: '/admin/powerups', label: 'Power-Ups', icon: 'powerups' },
    { href: '/admin/checkout', label: 'Checkout', icon: 'checkout' },
    { href: '/admin/labels', label: 'QR labels', icon: 'labels' },
    ...(admin.role === 'admin' ? [{ href: '/admin/settings', label: 'Settings', icon: 'settings' } as NavItem] : []),
  ]
  return (
    <div className="min-h-screen bg-background">
      {ev?.is_demo ? <div className="no-print bg-amber-300 px-4 py-1 text-center text-xs font-bold tracking-wide text-amber-950">DEMO DATA — not a real auction</div> : null}
      <header className="no-print z-40 border-b bg-white sm:sticky sm:top-0">
        <div className="h-1 bg-brand-yellow" aria-hidden />
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2">
          <Link href="/admin" className="flex min-h-11 items-center gap-3">
            <Image src="/brand/storychurch-banner.png" alt="Story Church" width={1562} height={286} className="h-7 w-auto brightness-0" priority />
            <span className="hidden rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-white sm:inline">STAFF</span>
          </Link>
          <div className="flex items-center gap-1 text-sm font-semibold">
            <Link href="/" className="inline-flex min-h-11 items-center rounded-md px-3 hover:bg-ivory">Guest view</Link>
            <span className="hidden font-normal text-muted-foreground sm:inline">{admin.name} · {admin.role}</span>
            <SignOutButton admin />
          </div>
        </div>
        <AdminNav items={nav} />
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  )
}
