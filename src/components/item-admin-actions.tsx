'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmAction, Field, Notice } from '@/components/admin-ui'
import { newKey, post } from '@/lib/client'
import { formatCents, parseDollars } from '@/lib/money'

export function ItemAdminActions(p: {
  itemId: string
  kind: 'silent' | 'live'
  status: string
  phase: string
  hasHistory: boolean
  isAdmin: boolean
  published: boolean
  suggestedReopenLocal: string
}) {
  const router = useRouter()
  const [closeAt, setCloseAt] = useState(p.suggestedReopenLocal)
  const canClose = p.kind === 'silent' && p.status === 'open' && p.phase === 'open'
  const canReopen = p.isAdmin && (p.status === 'closed' || p.status === 'finalized' || p.phase === 'closed')
  const canToggle = ['draft', 'open', 'upcoming'].includes(p.status) && p.phase !== 'closed'

  return (
    <div className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="font-bold">Item controls</h2>
      <div className="flex flex-wrap gap-2">
        {canToggle ? (
          <Button variant="outline" onClick={async () => { await post('/api/admin/items', { action: 'publish', id: p.itemId, published: !p.published }); router.refresh() }}>
            {p.published ? 'Hide from guests' : 'Show to guests'}
          </Button>
        ) : null}
        {canClose ? (
          <ConfirmAction
            variant="outline"
            label="Close bidding now"
            title="Close bidding on this item?"
            description="Bidders will no longer be able to bid, and the highest bid becomes the winner. Only an administrator can reopen it."
            confirmLabel="Close bidding"
            confirmVariant="destructive"
            action={() => post('/api/admin/items', { action: 'close', id: p.itemId })}
          />
        ) : null}
        {!p.hasHistory ? (
          <ConfirmAction
            variant="destructive"
            label="Delete item"
            title="Delete this item?"
            description="This item has no bids, so it can be deleted. This can’t be undone."
            confirmLabel="Delete"
            confirmVariant="destructive"
            action={async () => {
              const res = await post('/api/admin/items', { action: 'delete', id: p.itemId })
              if (res.ok) router.push('/admin/items')
              return res
            }}
          />
        ) : (
          <p className="self-center text-xs text-muted-foreground">Items with bid history can’t be deleted — hide them instead.</p>
        )}
      </div>

      {canReopen ? (
        <div className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-bold">Reopen (administrators only)</h3>
          {p.kind === 'silent' ? (
            <Field label="New closing time" htmlFor="reopen-time" hint="Event time zone.">
              <Input id="reopen-time" type="datetime-local" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} />
            </Field>
          ) : null}
          <ConfirmAction
            variant="outline"
            label="Reopen this item…"
            title="Reopen this item?"
            description="The current winner record is voided (kept in the history) and the reason below is saved in the audit log. If payments were recorded, void them first."
            confirmLabel="Reopen item"
            reasonLabel="Reason (required)"
            action={(reason) => post('/api/admin/items', { action: 'reopen', id: p.itemId, reason, newCloseAt: p.kind === 'silent' ? closeAt : undefined })}
          />
        </div>
      ) : null}
    </div>
  )
}

export function AssistedBidForm({ itemId, currentCents, minNextCents }: { itemId: string; currentCents: number | null; minNextCents: number }) {
  const router = useRouter()
  const [num, setNum] = useState('')
  const [amount, setAmount] = useState(String(minNextCents / 100))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [key, setKey] = useState(newKey())

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const cents = parseDollars(amount)
    const n = parseInt(num, 10)
    if (!Number.isInteger(n)) return setMsg({ kind: 'error', text: 'Enter the bidder number from the guest’s paddle.' })
    if (cents == null) return setMsg({ kind: 'error', text: 'Enter a valid amount.' })
    setBusy(true)
    const res = await post('/api/admin/bids', { itemId, bidderNumber: n, amountCents: cents, expectedCurrentCents: currentCents, idempotencyKey: key })
    setBusy(false)
    if (res.ok) {
      setMsg({ kind: 'success', text: `Recorded ${formatCents(cents)} for bidder #${n}.` })
      setKey(newKey())
      setNum('')
      router.refresh()
    } else {
      if (res.error.code !== 'NETWORK') setKey(newKey())
      setMsg({ kind: 'error', text: res.error.message })
      router.refresh()
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border bg-card p-5 shadow-sm" noValidate>
      <h2 className="font-bold">Place an assisted bid</h2>
      <p className="text-sm text-muted-foreground">For a registered guest without a smartphone. The bid is recorded for the guest and credited to you as the volunteer who entered it.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bidder / paddle #" htmlFor="ab-num"><Input id="ab-num" inputMode="numeric" value={num} onChange={(e) => setNum(e.target.value)} /></Field>
        <Field label="Bid amount ($)" htmlFor="ab-amt" hint={`Minimum ${formatCents(minNextCents)}`}><Input id="ab-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      </div>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      <Button type="submit" disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : null} Record bid</Button>
    </form>
  )
}
