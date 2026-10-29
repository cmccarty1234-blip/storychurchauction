'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { post } from '@/lib/client'
import { formatCents } from '@/lib/money'
import { Button } from '@/components/ui/button'

type Row = { entry_id: string; entry_number: number; name: string; cents: number; owed: number; paid: number }

/** Desk volunteers: collect a guest's chili votes (separate from their item balance), or remove a mistaken unpaid vote. */
export function ChiliCheckout({ bidderId, rows }: { bidderId: string; rows: Row[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const owed = rows.reduce((s, r) => s + r.owed, 0)

  async function paid(method: 'cash' | 'check' | 'card_terminal') {
    setBusy(true)
    setErr(null)
    const r = await post('/api/admin/chili', { action: 'paid', bidderId, method })
    setBusy(false)
    if (r.ok) router.refresh()
    else setErr(r.error.message)
  }
  async function remove(entryId: string, name: string) {
    if (!window.confirm(`Remove this guest's UNPAID chili votes for ${name}?`)) return
    setBusy(true)
    setErr(null)
    const r = await post('/api/admin/chili', { action: 'void', bidderId, entryId, reason: 'Removed at checkout' })
    setBusy(false)
    if (r.ok) router.refresh()
    else setErr(r.error.message)
  }

  return (
    <section className="rounded-xl border-2 border-ink bg-card shadow-sm" aria-label="Chili votes">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
        <h2 className="font-bold">Chili cook-off votes</h2>
        <p className="tnum text-lg font-extrabold">{owed > 0 ? `${formatCents(owed)} owed` : 'All paid'}</p>
      </div>
      <ul className="divide-y text-sm">
        {rows.map((r) => (
          <li key={r.entry_id} className="flex flex-wrap items-center justify-between gap-2 p-4">
            <span className="font-semibold">#{r.entry_number} {r.name}</span>
            <span className="flex items-center gap-3">
              <span className="tnum">{formatCents(r.cents)}{r.owed === 0 ? ' · paid' : r.paid > 0 ? ` · ${formatCents(r.owed)} owed` : ''}</span>
              {r.owed > 0 ? <Button size="sm" variant="outline" disabled={busy} onClick={() => remove(r.entry_id, r.name)}>Remove</Button> : null}
            </span>
          </li>
        ))}
      </ul>
      {owed > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t p-4">
          <span className="text-sm font-semibold">Received {formatCents(owed)} by:</span>
          <Button variant="bid" disabled={busy} onClick={() => paid('cash')}>Cash</Button>
          <Button variant="bid" disabled={busy} onClick={() => paid('check')}>Check</Button>
          <Button variant="bid" disabled={busy} onClick={() => paid('card_terminal')}>Card terminal</Button>
        </div>
      ) : null}
      {err ? <p role="alert" className="border-t p-3 text-sm font-semibold text-danger">{err}</p> : null}
    </section>
  )
}
