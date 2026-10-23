'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Check, Loader2, Pause, Play, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmAction, Notice } from '@/components/admin-ui'
import { newKey, post } from '@/lib/client'
import { formatCents, parseDollars } from '@/lib/money'

export type ConsoleItem = {
  id: string
  item_number: number
  title: string
  status: 'upcoming' | 'open' | 'paused' | 'closed' | 'finalized'
  current_bid_cents: number | null
  leader_number: number | null
  leader_name: string | null
  bid_count: number
  min_next_cents: number
  increment_cents: number
  starting_bid_cents: number
}
export type ConsoleRequest = { id: string; bidder_number: number; bidder_name: string; amount_cents: number; at: string }
export type ConsoleBid = { id: string; seq: number; bidder_number: number; bidder_name: string; amount_cents: number; source: 'paddle' | 'mobile'; at: string; voided: boolean; void_reason: string | null }
export type QueueItem = { id: string; item_number: number; title: string; starting_bid_cents: number }
export type DoneItem = { id: string; item_number: number; title: string; winner: string | null; amount_cents: number | null }

const live = (body: Record<string, unknown>) => post('/api/admin/live', body)

export function LiveConsole(p: {
  active: ConsoleItem | null
  requests: ConsoleRequest[]
  bids: ConsoleBid[]
  queue: QueueItem[]
  done: DoneItem[]
  isAdmin: boolean
}) {
  const router = useRouter()
  const a = p.active
  const [paddle, setPaddle] = useState('')
  const [amount, setAmount] = useState(a ? String(a.min_next_cents / 100) : '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null)
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const key = useRef(newKey())
  const touched = useRef(false)
  const paddleRef = useRef<HTMLInputElement>(null)

  // After every accepted bid the suggested next bid moves; follow it unless the clerk typed a custom amount.
  useEffect(() => {
    if (!a) return
    const cur = parseDollars(amount)
    if (!touched.current || cur == null || cur < a.min_next_cents) {
      setAmount(String(a.min_next_cents / 100))
      touched.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id, a?.min_next_cents])

  const onBlock = a && (a.status === 'open' || a.status === 'paused')

  async function recordPaddle(e: React.FormEvent) {
    e.preventDefault()
    if (!a || busy) return
    const n = parseInt(paddle, 10)
    const cents = parseDollars(amount)
    if (!Number.isInteger(n)) return setMsg({ kind: 'error', text: 'Enter the paddle number.' })
    if (cents == null) return setMsg({ kind: 'error', text: 'Enter the bid amount.' })
    setBusy(true)
    setMsg(null)
    const res = await live({ action: 'paddle', itemId: a.id, paddleNumber: n, amountCents: cents, idempotencyKey: key.current })
    setBusy(false)
    if (res.ok) {
      const d = res.data as { bidderName?: string; replay?: boolean }
      setMsg({ kind: 'success', text: d.replay ? 'That bid was already recorded.' : `Recorded: paddle #${n}${d.bidderName ? ` (${d.bidderName})` : ''} — ${formatCents(cents)}` })
      key.current = newKey()
      touched.current = false
      setPaddle('')
      paddleRef.current?.focus()
      router.refresh()
    } else {
      if (res.error.code !== 'NETWORK') key.current = newKey()
      setMsg({ kind: 'error', text: res.error.message })
      router.refresh()
    }
  }

  async function resolve(id: string, action: 'accept' | 'reject') {
    setRowBusy(id)
    setMsg(null)
    const res = await live({ action, requestId: id })
    setRowBusy(null)
    if (!res.ok) setMsg({ kind: 'error', text: res.error.message })
    else if (action === 'accept') setMsg({ kind: 'success', text: 'Phone bid accepted.' })
    router.refresh()
  }

  const quick = a ? [a.min_next_cents, a.min_next_cents + a.increment_cents, a.min_next_cents + a.increment_cents * 3] : []

  return (
    <div className="space-y-6">
      {!a ? (
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <p className="text-lg font-bold">No live item on the block.</p>
          <p className="mt-1 text-sm text-muted-foreground">Choose the next item from the program below to bring it to the block.</p>
        </div>
      ) : (
        <>
          <section className="rounded-xl border-2 border-ink bg-white p-5 shadow-sm" aria-label="Current live item">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-muted-foreground">Item #{a.item_number}</p>
                <h2 className="text-2xl font-extrabold">{a.title}</h2>
              </div>
              <span className={`rounded-full px-4 py-1.5 text-sm font-extrabold ${a.status === 'open' ? 'bg-ink text-brand-yellow' : a.status === 'paused' ? 'bg-amber-200 text-amber-950' : 'bg-muted text-foreground'}`}>
                {a.status === 'open' ? 'OPEN — taking bids' : a.status === 'paused' ? 'PAUSED' : 'CLOSED — not yet finalized'}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-secondary p-3"><dt className="text-xs text-muted-foreground">Current accepted bid</dt><dd className="tnum text-3xl font-extrabold text-ink">{a.current_bid_cents == null ? '—' : formatCents(a.current_bid_cents)}</dd></div>
              <div className="rounded-xl bg-secondary p-3"><dt className="text-xs text-muted-foreground">Leading paddle</dt><dd className="text-3xl font-extrabold text-ink">{a.leader_number ? `#${a.leader_number}` : '—'}</dd><dd className="truncate text-xs text-muted-foreground">{a.leader_name ?? 'no bids yet'}</dd></div>
              <div className="rounded-xl bg-secondary p-3"><dt className="text-xs text-muted-foreground">Next suggested bid</dt><dd className="tnum text-3xl font-extrabold text-danger">{formatCents(a.min_next_cents)}</dd></div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {a.status === 'open' ? (
                <Button variant="outline" size="lg" onClick={async () => { await live({ action: 'pause', itemId: a.id }); router.refresh() }}><Pause className="size-4" /> Pause</Button>
              ) : null}
              {a.status === 'paused' ? (
                <Button size="lg" onClick={async () => { await live({ action: 'resume', itemId: a.id }); router.refresh() }}><Play className="size-4" /> Resume</Button>
              ) : null}
              {onBlock ? (
                <>
                  <ConfirmAction
                    size="lg" variant="outline" label="Close bidding…"
                    title={`Close bidding on #${a.item_number}?`}
                    description={<>Bidding stops. {a.current_bid_cents != null ? <>Leading: <strong>paddle #{a.leader_number}</strong> at <strong>{formatCents(a.current_bid_cents)}</strong>.</> : 'There are no bids.'} Pending phone requests will be dismissed.</>}
                    confirmLabel="Yes, close bidding" confirmVariant="destructive"
                    action={() => live({ action: 'close', itemId: a.id, confirmed: true })}
                  />
                  <ConfirmAction
                    size="lg" variant="outline" label={<><Undo2 className="size-4" /> Undo last bid</>}
                    title="Undo the most recent accepted bid?"
                    description="Use this only for a clerk mistake. The bid stays in the history, marked void, with your reason."
                    confirmLabel="Undo bid" reasonLabel="Reason (e.g. wrong paddle number)" confirmVariant="destructive"
                    disabled={a.bid_count === 0}
                    action={(reason) => live({ action: 'undo', itemId: a.id, reason })}
                  />
                </>
              ) : null}
              {a.status === 'closed' ? (
                <ConfirmAction
                  size="lg" variant="bid" label="Finalize winner…"
                  title={a.current_bid_cents != null ? `Declare paddle #${a.leader_number} the winner?` : 'Finalize with no sale?'}
                  description={a.current_bid_cents != null ? <>Item #{a.item_number} “{a.title}” goes to <strong>paddle #{a.leader_number} ({a.leader_name})</strong> for <strong>{formatCents(a.current_bid_cents)}</strong>. A checkout record is created for them.</> : 'No bids were accepted, so this item will be recorded as unsold.'}
                  confirmLabel={a.current_bid_cents != null ? 'Finalize winner' : 'Finalize, unsold'} confirmVariant="bid"
                  action={() => live({ action: 'finalize', itemId: a.id, confirmed: true })}
                />
              ) : null}
              {a.status === 'closed' && p.isAdmin ? (
                <ConfirmAction
                  size="lg" variant="outline" label="Reopen…"
                  title="Reopen this item?" description="Brings the item back (paused). Recorded in the audit log."
                  confirmLabel="Reopen" reasonLabel="Reason (required)"
                  action={(reason) => live({ action: 'reopen', itemId: a.id, reason })}
                />
              ) : null}
            </div>
          </section>

          {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <form onSubmit={recordPaddle} className="space-y-4 rounded-xl border bg-card p-5 shadow-sm" noValidate>
              <h2 className="text-lg font-bold">Record a paddle bid</h2>
              <p className="text-sm text-muted-foreground">The auctioneer calls the bid → type the paddle number → press Enter.</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="paddle" className="text-sm font-semibold">Paddle #</label>
                  <Input id="paddle" ref={paddleRef} inputMode="numeric" autoComplete="off" autoFocus value={paddle} onChange={(e) => setPaddle(e.target.value.replace(/\D/g, ''))} className="h-16 text-3xl font-extrabold tnum md:text-3xl" disabled={!onBlock} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="amt" className="text-sm font-semibold">Amount ($)</label>
                  <Input id="amt" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => { touched.current = true; setAmount(e.target.value) }} className="h-16 text-3xl font-extrabold tnum md:text-3xl" disabled={!onBlock} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {quick.map((c) => (
                  <button type="button" key={c} disabled={!onBlock} onClick={() => { touched.current = true; setAmount(String(c / 100)) }} className="tnum min-h-11 rounded-full border bg-white px-4 text-sm font-semibold text-ink hover:bg-secondary disabled:opacity-50">{formatCents(c)}</button>
                ))}
              </div>
              <Button type="submit" size="lg" variant="bid" className="h-14 w-full text-lg" disabled={!onBlock || busy || !paddle}>
                {busy ? <Loader2 className="size-5 animate-spin" /> : null} Record accepted bid
              </Button>
              {a.status === 'paused' ? <p className="text-sm font-medium text-amber-900">Bidding is paused — resume to take bids.</p> : null}
            </form>

            <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Phone bid requests">
              <h2 className="text-lg font-bold">Phone bid requests <span className="ml-1 rounded-full bg-danger px-2.5 py-0.5 text-sm text-white">{p.requests.length}</span></h2>
              <p className="mt-1 text-sm text-muted-foreground">Requests are not bids until you accept them. Accept only what the auctioneer has taken.</p>
              <ul className="mt-3 space-y-2" aria-live="polite">
                {p.requests.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 rounded-xl border bg-white p-3">
                    <div className="min-w-0 flex-1">
                      <p className="tnum text-xl font-extrabold">{formatCents(r.amount_cents)}</p>
                      <p className="truncate text-sm text-muted-foreground">Paddle #{r.bidder_number} · {r.bidder_name}</p>
                    </div>
                    <Button size="lg" disabled={rowBusy === r.id || !onBlock} onClick={() => resolve(r.id, 'accept')} aria-label={`Accept ${formatCents(r.amount_cents)} from paddle ${r.bidder_number}`}>
                      {rowBusy === r.id ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-5" />} Accept
                    </Button>
                    <Button variant="outline" size="lg" disabled={rowBusy === r.id} onClick={() => resolve(r.id, 'reject')} aria-label={`Reject request from paddle ${r.bidder_number}`}><X className="size-5" /> Reject</Button>
                  </li>
                ))}
                {p.requests.length === 0 ? <li className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No pending requests.</li> : null}
              </ul>
            </section>
          </div>

          <section className="rounded-xl border bg-card shadow-sm" aria-label="Bid history">
            <h2 className="border-b p-4 text-lg font-bold">Accepted bids — #{a.item_number}</h2>
            <ul className="divide-y text-sm">
              {p.bids.map((b) => (
                <li key={b.id} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${b.voided ? 'text-muted-foreground line-through' : ''}`}>
                  <span><span className="font-bold">#{b.bidder_number}</span> {b.bidder_name} <span className="text-xs text-muted-foreground">· {b.source === 'paddle' ? 'paddle' : 'phone'}{b.voided ? ` · voided: ${b.void_reason}` : ''}</span></span>
                  <span className="tnum font-bold">{formatCents(b.amount_cents)}</span>
                </li>
              ))}
              {p.bids.length === 0 ? <li className="p-4 text-muted-foreground">No accepted bids yet.</li> : null}
            </ul>
          </section>
        </>
      )}

      <section className="rounded-xl border bg-card shadow-sm" aria-label="Live program">
        <h2 className="border-b p-4 text-lg font-bold">Live program</h2>
        <ul className="divide-y text-sm">
          {p.queue.map((q, idx) => (
            <li key={q.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="flex items-center gap-2">
                <span className="flex flex-col">
                  <button type="button" aria-label={`Move #${q.item_number} earlier`} disabled={idx === 0} className="flex size-9 items-center justify-center rounded text-muted-foreground hover:bg-secondary disabled:opacity-30" onClick={async () => { await post('/api/admin/items', { action: 'reorder', id: q.id, direction: 'up' }); router.refresh() }}><ArrowUp className="size-4" /></button>
                  <button type="button" aria-label={`Move #${q.item_number} later`} disabled={idx === p.queue.length - 1} className="flex size-9 items-center justify-center rounded text-muted-foreground hover:bg-secondary disabled:opacity-30" onClick={async () => { await post('/api/admin/items', { action: 'reorder', id: q.id, direction: 'down' }); router.refresh() }}><ArrowDown className="size-4" /></button>
                </span>
                <span><span className="font-bold">#{q.item_number}</span> {q.title} <span className="tnum text-muted-foreground">· opens at {formatCents(q.starting_bid_cents)}</span></span>
              </span>
              <ConfirmAction
                variant="outline" label="Bring to the block"
                disabled={!!onBlock || a?.status === 'closed'}
                title={`Bring #${q.item_number} to the block?`} description="Guests will see this item as on the block and can send bid requests."
                confirmLabel="Open bidding" confirmVariant="bid"
                action={() => live({ action: 'start', itemId: q.id })}
              />
            </li>
          ))}
          {p.queue.length === 0 ? <li className="p-4 text-muted-foreground">No more items waiting.</li> : null}
          {p.done.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 bg-muted/40 px-4 py-3 text-muted-foreground">
              <span><span className="font-bold">#{d.item_number}</span> {d.title}</span>
              <span className="tnum">{d.winner ? `${d.winner} · ${formatCents(d.amount_cents)}` : 'unsold'}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
