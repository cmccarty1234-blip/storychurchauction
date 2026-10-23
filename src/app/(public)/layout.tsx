import { getEvent } from '@/lib/events'
import { SiteFooter, SiteHeader } from '@/components/site-header'

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const ev = await getEvent().catch(() => null)
  return (
    <div className="flex min-h-screen flex-col">
      {ev?.is_demo ? (
        <div className="no-print bg-amber-300 px-4 py-1.5 text-center text-xs font-bold tracking-wide text-amber-950">
          DEMO DATA — sample items and bidders, not a real auction
        </div>
      ) : null}
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:py-8">
        {ev ? children : <p className="rounded-xl border bg-card p-6">The auction hasn’t been set up yet. Staff: run the seed script or create the event in Settings.</p>}
      </main>
      <SiteFooter contact={ev?.contact_info} />
    </div>
  )
}
