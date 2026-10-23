import Image from 'next/image'
import Link from 'next/link'
import { Download } from 'lucide-react'
import { getEvent } from '@/lib/events'
import { listItems } from '@/lib/queries'
import { appUrl, itemQrSvg, itemUrl } from '@/lib/qr'
import { PrintButton } from '@/components/print-button'
import { buttonVariants } from '@/components/ui/button'

export const metadata = { title: 'QR labels' }

export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ item?: string; type?: string }> }) {
  const sp = await searchParams
  const ev = await getEvent()
  let items = await listItems(ev.id, { includeDraft: false })
  if (sp.item) items = items.filter((i) => i.id === sp.item)
  else if (sp.type === 'silent' || sp.type === 'live') items = items.filter((i) => i.kind === sp.type)
  const qrs = await Promise.all(items.map((i) => itemQrSvg(i.item_number)))
  const isLocal = /localhost|127\.0\.0\.1/.test(appUrl())

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">QR labels</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Each QR code opens that item’s bidding page. Print on letter paper (2 labels across) or save as PDF from the print dialog.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/labels" className={buttonVariants({ variant: 'outline' })}>All</Link>
          <Link href="/admin/labels?type=silent" className={buttonVariants({ variant: 'outline' })}>Silent only</Link>
          <Link href="/admin/labels?type=live" className={buttonVariants({ variant: 'outline' })}>Live only</Link>
          <PrintButton label="Print labels" />
        </div>
      </div>
      {isLocal ? (
        <p className="no-print rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950" role="note">
          These QR codes point to <strong>{appUrl()}</strong>, which phones can’t reach. Set <code>NEXT_PUBLIC_APP_URL</code> to the real public address (or your computer’s Wi-Fi address for a test) and reload before printing.
        </p>
      ) : null}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 print:gap-3">
        {items.map((i, idx) => (
          <li key={i.id} className="break-inside-avoid overflow-hidden rounded-xl border-2 border-ink bg-white">
            <div className="flex items-center justify-between border-b-4 border-brand-yellow bg-white px-4 py-2.5">
              <Image src="/brand/storychurch-banner.png" alt="Story Church" width={1562} height={286} className="h-7 w-auto brightness-0" />
              <span className="rounded-full bg-ink px-3 py-1 text-sm font-extrabold text-brand-yellow">{i.kind === 'live' ? 'LIVE' : 'SILENT'}</span>
            </div>
            <div className="flex items-center gap-4 p-4">
              <div className="size-36 shrink-0" dangerouslySetInnerHTML={{ __html: qrs[idx] }} aria-label={`QR code for item ${i.item_number}`} role="img" />
              <div className="min-w-0">
                <p className="text-5xl font-extrabold leading-none text-ink">#{i.item_number}</p>
                <p className="mt-2 line-clamp-3 text-lg font-bold leading-snug">{i.title}</p>
                <p className="mt-2 inline-block rounded-full bg-brand-yellow px-4 py-1.5 text-base font-extrabold text-ink">Scan to Bid</p>
              </div>
            </div>
            <div className="no-print flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
              <span className="truncate">{itemUrl(i.item_number)}</span>
              <a href={`/api/admin/qr/${i.item_number}`} className="ml-3 inline-flex shrink-0 items-center gap-1 font-semibold text-ink hover:underline"><Download className="size-3.5" /> SVG</a>
            </div>
          </li>
        ))}
      </ul>
      {items.length === 0 ? <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground">No items to label.</p> : null}
    </div>
  )
}
