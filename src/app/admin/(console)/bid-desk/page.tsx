import { getEvent } from '@/lib/events'
import { finalizeDueSilentItems } from '@/lib/bidding'
import { formatInTz } from '@/lib/time'
import { BidDesk } from '@/components/bid-desk'

export const metadata = { title: 'Bid desk' }

export default async function BidDeskPage() {
  const ev = await getEvent()
  await finalizeDueSilentItems()
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold">Bid desk</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Place silent-auction bids for guests without a phone. Silent bidding closes {formatInTz(ev.silent_close_at, ev.timezone)}; the server refuses anything after that.
        </p>
      </div>
      <BidDesk />
    </div>
  )
}
