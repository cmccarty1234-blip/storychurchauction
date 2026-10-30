import { pieSummary } from '@/lib/pies'
import { formatCents } from '@/lib/money'

/**
 * "Pie Brandon in the Face" — the end-of-night finale. Shown on the guest home page and the auction page.
 * Renders nothing if the sign-ups are switched off.
 */
export async function PiePromo({ eventId, compact = false }: { eventId: string; compact?: boolean }) {
  const p = await pieSummary(eventId)
  if (!p.enabled) return null
  const pledged = p.smallSold + p.largeSold
  return (
    <section aria-labelledby="pie-title" className="rounded-2xl border-2 border-ink bg-brand-yellow p-5 shadow-sm sm:p-7">
      <p className="text-xs font-bold uppercase tracking-[0.2em]">The big finale</p>
      <h2 id="pie-title" className={`mt-1 uppercase leading-[0.95] text-ink ${compact ? 'text-3xl' : 'text-4xl sm:text-6xl'}`}>
        <svg viewBox="0 0 64 64" className="mr-2 inline-block size-[0.9em] align-[-0.08em]" aria-hidden><ellipse cx="32" cy="40" rx="28" ry="12" fill="#c98a3c" /><path d="M6 38 Q32 4 58 38 Q32 50 6 38Z" fill="#fff6e0" /><path d="M6 38 Q32 4 58 38" fill="none" stroke="#c98a3c" strokeWidth="5" strokeLinecap="round" /><circle cx="22" cy="30" r="3.2" fill="#e8b4b8" /><circle cx="34" cy="24" r="3.2" fill="#e8b4b8" /><circle cx="44" cy="31" r="3.2" fill="#e8b4b8" /></svg>Pie Brandon in the Face!
      </h2>
      <p className={`mt-3 max-w-2xl font-semibold ${compact ? 'text-base' : 'text-lg sm:text-xl'}`}>
        Sign up any time tonight at the <b>Bid Desk</b> &mdash; or online in the Power-Up store. At the end of the night, you get to throw it.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-ink px-5 py-2 text-lg font-extrabold text-brand-yellow">Small pie · {formatCents(p.smallPriceCents)}</span>
        <span className="rounded-full bg-ink px-5 py-2 text-lg font-extrabold text-brand-yellow">LARGE pie · {formatCents(p.largePriceCents)}</span>
        {pledged > 0 ? (
          <span className="tnum text-base font-bold" role="status">
            {pledged} {pledged === 1 ? 'pie' : 'pies'} pledged · {formatCents(p.cents)} raised so far!
          </span>
        ) : null}
      </div>
    </section>
  )
}
