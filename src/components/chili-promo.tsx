import Link from 'next/link'
import { chiliBoard } from '@/lib/chili'
import { formatCents } from '@/lib/money'
import { linkButton } from '@/components/ui/button'

/** Home-page promo for the chili cook-off. Renders nothing until the host turns the cook-off on. */
export async function ChiliPromo({ eventId }: { eventId: string }) {
  const b = await chiliBoard(eventId)
  if (b.state === 'off' || b.entries.length === 0) return null
  return (
    <section aria-labelledby="chili-title" className="rounded-2xl border-2 border-ink bg-ink p-5 text-white shadow-sm sm:p-7">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-yellow">Taste &amp; vote</p>
      <h2 id="chili-title" className="mt-1 text-4xl uppercase leading-[0.95] sm:text-6xl">Chili cook-off</h2>
      <p className="mt-3 max-w-2xl text-lg font-semibold sm:text-xl">
        {b.state === 'open' ? `${b.entries.length} chilis, one winner. Every $1 is a vote — the chili with the most dollars wins!` : 'Voting is closed. Thank you!'}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link href="/chili" className={linkButton({ size: 'lg', variant: 'default' }, 'h-12 px-6 text-base uppercase tracking-wide')}>
          {b.state === 'open' ? 'Vote for your favorite' : 'See the results'}
        </Link>
        {b.totalCents > 0 ? <span className="tnum text-base font-bold text-brand-yellow">{formatCents(b.totalCents)} raised so far!</span> : null}
      </div>
    </section>
  )
}
