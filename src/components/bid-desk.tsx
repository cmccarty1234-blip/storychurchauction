'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, Search, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/admin-ui'
import { newKey, post } from '@/lib/client'
import { formatCents, parseDollars } from '@/lib/money'

type DeskItem = { id: string; number: number; title: string; open: boolean; currentCents: number | null; minNextCents: number; incrementCents: number; leaderNumber: number | null; closesAt: string | null }
type GuestItem = DeskItem & { myTopCents: number; leading: boolean }
type Guest = { bidder: { id: string; number: number; name: string; assisted: boolean }; leading: GuestItem[]; outbid: GuestItem[]; finished: GuestItem[] }

async function get<T>(qs: string): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const r = await fetch(`/api/admin/bid-desk?${qs}`, { cache: 'no-store' })
    const j = await r.json()
    return r.ok ? { ok: true, data: j as T } : { ok: false, message: j.error?.message ?? 'Something went wrong.' }
  } catch {
    return { ok: false, message: 'Couldn’t reach the server. Check the connection.' }
  }
}

/**
 * Bid Desk: place silent-auction bids for a guest who has no phone.
 * 1) type their paddle number → see where they stand  2) type an item number → amount is pre-filled → one tap.
 * The guest's standing refreshes every few seconds, so "outbid" shows up as it happens.
 */
export function BidDesk() {
  const [paddle, setPaddle] = useState('')
  const [guest, setGuest] = useState<Guest | null>(null)
  const [guestErr, setGuestErr] = useState<string | null>(null)
  const [itemNo, setItemNo] = useState('')
  const [item, setItem] = useState<DeskItem | null>(null)
  const [itemErr, setItemErr] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const key = useRef(newKey())
  const paddleRef = useRef<HTMLInputElement>(null)
  const itemRef = useRef<HTMLInputElement>(null)
  const touched = useRef(false)

  const loadGuest = useCallback(async (p: string, quiet = false) => {
    if (!p) return
    const r = await get<Guest>(`paddle=${encodeURIComponent(p)}`)
    if (r.ok) { setGuest(r.data); setGuestErr(null) } else if (!quiet) { setGuest(null); setGuestErr(r.message) }
  }, [])

  const loadItem = useCallback(async (n: string, quiet = false) => {
    if (!n) { setItem(null); return }
    const r = await get<DeskItem>(`item=${encodeURIComponent(n)}`)
    if (r.ok) {
      setItem(r.data); setItemErr(null)
      if (!touched.current || parseDollars(amount) == null || parseDollars(amount)! < r.data.minNextCents) { setAmount(String(r.data.minNextCents / 100)); touched.current = false }
    } else if (!quiet) { setItem(null); setItemErr(r.message) }
  }, [amount])

  // Keep the guest's standing and the chosen item current while the desk is open.
  useEffect(() => {
    const t = setInterval(() => { if (guest) void loadGuest(String(guest.bidder.number), true); if (item) void loadItem(String(item.number), true) }, 6000)
    return () => clearInterval(t)
  }, [guest, item, loadGuest, loadItem])

  async function place() {
    if (!guest || !item || busy) return
    const cents = parseDollars(amount)
    if (cents == null) return setResult({ kind: 'error', text: 'Enter the bid amount in dollars.' })
    setBusy(true); setResult(null)
    const res = await post('/api/admin/bids', { itemId: item.id, bidderNumber: guest.bidder.number, amountCents: cents, expectedCurrentCents: item.currentCents, idempotencyKey: key.current })
    setBusy(false)
    if (res.ok) {
      setResult({ kind: 'success', text: `Recorded ${formatCents(cents)} for ${guest.bidder.name} (#${guest.bidder.number}) on #${item.number} ${item.title}.` })
      key.current = newKey(); touched.current = false
      setItemNo(''); setItem(null); setAmount('')
      void loadGuest(String(guest.bidder.number), true)
      itemRef.current?.focus()
    } else {
      if (res.error.code !== 'NETWORK') key.current = newKey()
      setResult({ kind: 'error', text: res.error.message })
      void loadItem(String(item.number), true)
    }
  }

  const pickItem = (g: GuestItem) => { setItemNo(String(g.number)); touched.current = false; void loadItem(String(g.number)) }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="font-bold">1 · Who is bidding?</h2>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); setResult(null); void loadGuest(paddle.trim()) }}>
          <Input ref={paddleRef} autoFocus inputMode="numeric" autoComplete="off" placeholder="Paddle number" aria-label="Guest paddle number" value={paddle} onChange={(e) => setPaddle(e.target.value.replace(/\D/g, ''))} className="h-14 text-2xl font-bold tnum md:text-2xl" />
          <Button type="submit" size="lg" className="h-14 px-6" disabled={!paddle}><Search className="size-5" /> Look up</Button>
        </form>
        {guestErr ? <div className="mt-3"><Notice kind="error">{guestErr}</Notice></div> : null}

        {guest ? (
          <div className="mt-4 space-y-4">
            <p className="text-lg"><span className="font-extrabold">#{guest.bidder.number} {guest.bidder.name}</span>{guest.bidder.assisted ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">assisted</span> : null}</p>

            {guest.outbid.length > 0 ? (
              <div role="status" className="rounded-xl border-2 border-danger bg-red-50 p-3">
                <p className="flex items-center gap-2 font-bold text-danger"><TriangleAlert className="size-5" /> Outbid on {guest.outbid.length} item{guest.outbid.length === 1 ? '' : 's'} — tell the guest</p>
                <ul className="mt-2 divide-y divide-red-200">
                  {guest.outbid.map((g) => (
                    <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span><b>#{g.number}</b> {g.title}<br /><span className="tnum text-muted-foreground">their top {formatCents(g.myTopCents)} · now {formatCents(g.currentCents)} · next {formatCents(g.minNextCents)}</span></span>
                      <Button size="sm" variant="outline" onClick={() => pickItem(g)}>Raise bid</Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="flex items-center gap-2 rounded-xl bg-[#dff3ee] px-3 py-2 text-sm font-semibold text-[#0f5c4f]"><CheckCircle2 className="size-5" /> Not outbid on anything right now.</p>
            )}

            {guest.leading.length > 0 ? (
              <div>
                <p className="text-sm font-bold">Currently winning ({guest.leading.length})</p>
                <ul className="mt-1 divide-y text-sm">
                  {guest.leading.map((g) => <li key={g.id} className="flex justify-between gap-2 py-1.5"><span><b>#{g.number}</b> {g.title}</span><span className="tnum font-semibold">{formatCents(g.currentCents)}</span></li>)}
                </ul>
              </div>
            ) : null}
            {guest.finished.length > 0 ? <p className="text-xs text-muted-foreground">{guest.finished.length} item{guest.finished.length === 1 ? '' : 's'} already closed.</p> : null}
          </div>
        ) : null}
      </section>

      <section className={`rounded-xl border bg-card p-5 shadow-sm ${guest ? '' : 'opacity-60'}`}>
        <h2 className="font-bold">2 · Place a bid</h2>
        <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); void loadItem(itemNo.trim()) }}>
          <div className="flex gap-2">
            <Input ref={itemRef} inputMode="numeric" autoComplete="off" placeholder="Item number (from the item card)" aria-label="Item number" value={itemNo} disabled={!guest} onChange={(e) => { setItemNo(e.target.value.replace(/\D/g, '')); setItem(null); setItemErr(null); setResult(null) }} onBlur={() => itemNo && !item && void loadItem(itemNo.trim())} className="h-14 text-2xl font-bold tnum md:text-2xl" />
            <Button type="submit" size="lg" variant="outline" className="h-14 px-6" disabled={!guest || !itemNo}>Find</Button>
          </div>
        </form>
        {itemErr ? <div className="mt-3"><Notice kind="error">{itemErr}</Notice></div> : null}

        {item ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl bg-secondary p-3">
              <p className="font-bold">#{item.number} {item.title}</p>
              <p className="tnum mt-1 text-sm">Current bid <b>{formatCents(item.currentCents)}</b>{item.leaderNumber ? ` (paddle #${item.leaderNumber})` : ' — no bids yet'} · minimum <b>{formatCents(item.minNextCents)}</b></p>
              {!item.open ? <p className="mt-1 text-sm font-semibold text-danger">Bidding on this item is closed.</p> : null}
              {guest && item.leaderNumber === guest.bidder.number ? <p className="mt-1 text-sm font-semibold text-[#0f5c4f]">This guest already has the high bid.</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-muted-foreground" aria-hidden>$</span>
              <Input inputMode="decimal" aria-label="Bid amount in dollars" value={amount} onChange={(e) => { touched.current = true; setAmount(e.target.value) }} className="h-14 text-2xl font-bold tnum md:text-2xl" />
            </div>
            <div className="flex flex-wrap gap-2">
              {[item.minNextCents, item.minNextCents + item.incrementCents, item.minNextCents + item.incrementCents * 3].map((c) => (
                <button type="button" key={c} onClick={() => { touched.current = true; setAmount(String(c / 100)) }} className="tnum min-h-11 rounded-full border bg-white px-4 text-sm font-semibold hover:bg-secondary">{formatCents(c)}</button>
              ))}
            </div>
            <Button type="button" size="lg" variant="bid" className="h-14 w-full text-lg" disabled={busy || !item.open || !guest} onClick={place}>
              {busy ? <><Loader2 className="size-5 animate-spin" /> Placing…</> : `Place bid for #${guest?.bidder.number ?? ''}${parseDollars(amount) != null ? ` · ${formatCents(parseDollars(amount))}` : ''}`}
            </Button>
          </div>
        ) : null}
        <div aria-live="polite" className="mt-3">{result ? <Notice kind={result.kind}>{result.text}</Notice> : null}</div>
      </section>
    </div>
  )
}
