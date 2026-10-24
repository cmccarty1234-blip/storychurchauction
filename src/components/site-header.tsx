import Image from 'next/image'
import Link from 'next/link'
import { getBidder } from '@/lib/session'
import { getEvent } from '@/lib/events'
import { SignOutButton } from './sign-out-button'
import { buttonVariants } from '@/components/ui/button'

const link = 'inline-flex min-h-11 items-center rounded-md px-2 hover:bg-ivory sm:px-3'

export async function SiteHeader() {
  const bidder = await getBidder()
  const game = (await getEvent().catch(() => null))?.game_mode ?? false
  return (
    <header className="no-print sticky top-0 z-40 border-b bg-white">
      <div className="h-1 bg-brand-yellow" aria-hidden />
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-3 px-4 py-1 sm:py-2">
        <Link href="/" aria-label="StoryChurch Auction home" className="inline-flex min-h-11 shrink-0 items-center">
          {/* The church's white logo, rendered solid black to match the brand wordmark */}
          <Image src="/brand/storychurch-banner.png" alt="Story Church" width={1562} height={286} priority className="h-6 w-auto brightness-0 sm:h-9" />
        </Link>
        <nav aria-label="Main" className="flex w-full items-center justify-between gap-0.5 whitespace-nowrap border-t pt-0.5 text-sm font-semibold sm:w-auto sm:justify-end sm:gap-1 sm:border-t-0 sm:pt-0">
          <Link href="/auction" className={link}>Auction</Link>
          {game ? <Link href="/play" className={`${link} bg-brand-yellow font-bold`}>Live ⚡</Link> : null}
          {bidder ? (
            <>
              <Link href="/my-bids" className={link}>My bids</Link>
              <Link href="/my-wins" className={link}>My wins</Link>
              <span className="ml-1 hidden rounded-full border px-3 py-1.5 text-xs font-bold sm:inline" title={bidder.name}>
                Bidder #{bidder.bidder_number}
              </span>
              <SignOutButton />
            </>
          ) : (
            <Link href="/register" className={`${buttonVariants({ variant: 'default' })} ml-1`}>
              <span className="sm:hidden">Register</span>
              <span className="hidden sm:inline">Register to bid</span>
            </Link>
          )}
        </nav>
      </div>
    </header>
  )
}

export function SiteFooter({ contact }: { contact?: string }) {
  return (
    <footer className="no-print mt-16 border-t bg-white">
      <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-muted-foreground">
        <p className="font-heading text-lg uppercase text-ink">Your story matters.</p>
        {contact ? <p className="mt-2">{contact}</p> : null}
        <p className="mt-3 text-xs">
          Bids are binding. Payment is collected in person at checkout (cash, check, or card terminal). ·{' '}
          <Link href="/admin" className="inline-block py-2 underline underline-offset-2">Staff</Link>
        </p>
      </div>
    </footer>
  )
}
