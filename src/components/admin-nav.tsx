'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BadgeDollarSign, Gavel, LayoutDashboard, ListOrdered, QrCode, Radio, Settings, Users } from 'lucide-react'

const ICONS = { dashboard: LayoutDashboard, items: Gavel, bidders: Users, bids: ListOrdered, live: Radio, checkout: BadgeDollarSign, labels: QrCode, settings: Settings }
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS }

/** Staff navigation. The current section is shown with a yellow background AND aria-current (never color alone). */
export function AdminNav({ items }: { items: NavItem[] }) {
  const path = usePathname()
  return (
    <nav aria-label="Staff" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 pb-2 text-sm font-semibold">
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon]
        const active = href === '/admin' ? path === '/admin' : path.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 ${active ? 'bg-brand-yellow text-ink' : 'hover:bg-ivory'}`}
          >
            <Icon className="size-4" aria-hidden /> {label}
          </Link>
        )
      })}
    </nav>
  )
}
