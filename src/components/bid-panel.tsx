'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react'
import { Button, linkButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCents, parseDollars } from '@/lib/money'
import { newKey, post } from '@/lib/client'

type Props = {
  mode: 'silent' | 'live'
  itemId: string
  itemNumber: number
  signedIn: boolean
  nextPath: string
  /** Server truth, re-rendered on every realtime event. */
  currentCents: number | null
  minNextCents: number
  incrementCents: number
  /** silent: you hold the high bid. live: you hold the accepted bid. */
  iAmLeading: boolean
  myTopBidCents: number | null
  open: boolean
  closedMessage?: string
  /** live only: my most recent request's state */
  myRequest?: { amountCents: number; status: 'pending' | 'accepted' | 'rejected' | 'superseded' | 'expired' } | null
}

type Feedback = { kind: 'success' | 'error' | 'info'; text: string } | null

export function BidPanel(p: Props) {
  const router = useRouter()
  const [amountText, setAmountText] = useState(String(p.minNextCents / 100))
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const key = useRef<string>(newKey()) // reused on retry of the SAME attempt so a retry can never double-bid
  const touched = useRef(false)

  // Server says the minimum moved (someone bid): keep the field at least at the new minimum.
  useEffect(() => {
    const cur = parseDollars(amountText)
    if (!touched.current || cur == null || cur < p.minNextCents) {
      setAmountText(String(p.minNextCents / 100))
      touched.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.minNextCents])

  if (!p.signedIn) {
    return (
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <p className="font-semibold">Register to bid — it takes about a minute.</p>
        <p className="mt-1 text-sm text-muted-foreground">Just your name and a phone number or email.</p>
        <Link href={`/register?next=${encodeURIComponent(p.nextPath)}`} className={linkButton({ size: 'lg', variant: 'bid' }, 'mt-4 w-full')}>
          Register to bid
        </Link>
      </div>
    )
  }

  if (!p.open) {
    return (
      <div className="rounded-xl border bg-card p-5 shadow-sm" role="status">
        <p className="font-semibold">{p.closedMessage ?? 'Bidding is not open right now.'}</p>
      </div>
    )
  }

  const amountCents = parseDollars(amountText)
  const quick = [p.minNextCents, p.minNextCents + p.incrementCents, p.minNextCents + p.incrementCents * 3]

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (amountCents == null) {
      setFeedback({ kind: 'error', text: 'Enter a bid amount in dollars, like 150.' })
      return
    }
    setBusy(true)
    setFeedback(null)
    const res =
      p.mode === 'silent'
        ? await post<{ currentCents: number }>('/api/bids/silent', { itemId: p.itemId, amountCents, expectedCurrentCents: p.currentCents, idempotencyKey: key.current })
        : await post('/api/bids/live-request', { itemId: p.itemId, amountCents, idempotencyKey: key.current })
    setBusy(false)
    if (res.ok) {
      key.current = newKey()
      touched.current = false
      setFeedback(
        p.mode === 'silent'
          ? { kind: 'success', text: `Bid placed! You’re the high bidder at ${formatCents(amountCents)}.` }
          : { kind: 'info', text: `Request sent for ${formatCents(amountCents)}. The clerk will confirm it if the auctioneer takes your bid.` },
      )
      router.refresh()
      return
    }
    // Network errors keep the same key (a retry is safe); definite server answers start a fresh attempt.
    if (res.error.code !== 'NETWORK') key.current = newKey()
    setFeedback({ kind: 'error', text: res.error.message })
    if (res.error.code === 'STALE' || res.error.code === 'TOO_LOW') router.refresh()
  }

  const waiting = p.mode === 'live' && p.myRequest?.status === 'pending'

  return (
    <form onSubmit={submit} className="rounded-xl border bg-card p-5 shadow-sm" noValidate>
      {p.iAmLeading ? (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-[#dff3ee] px-3 py-2.5 text-sm font-semibold text-[#0f5c4f]" role="status">
          <CheckCircle2 className="size-5 shrink-0" />
          {p.mode === 'silent' ? 'You’re the high bidder. Nobody has beaten your bid yet.' : 'The clerk accepted your bid — you’re leading!'}
        </p>
      ) : p.myTopBidCents != null && p.mode === 'silent' ? (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-orange-50 px-3 py-2.5 text-sm font-semibold text-danger" role="status">
          <TriangleAlert className="size-5 shrink-0" />
          You’ve been outbid. Your last bid was {formatCents(p.myTopBidCents)}.
        </p>
      ) : null}

      {waiting ? (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-secondary px-3 py-2.5 text-sm font-medium text-ink" role="status">
          <Loader2 className="size-4 animate-spin" />
          Waiting for the clerk · your request: {formatCents(p.myRequest!.amountCents)}
        </p>
      ) : p.mode === 'live' && p.myRequest && (p.myRequest.status === 'rejected' || p.myRequest.status === 'expired') ? (
        <p className="mb-4 rounded-xl bg-muted px-3 py-2.5 text-sm text-muted-foreground" role="status">
          Your {formatCents(p.myRequest.amountCents)} request {p.myRequest.status === 'rejected' ? 'wasn’t taken' : 'came too late — the bid had moved on'}.
        </p>
      ) : null}

      <label htmlFor={`bid-${p.itemId}`} className="text-sm font-semibold">
        {p.mode === 'silent' ? 'Your bid' : 'Request a bid'}
      </label>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-2xl font-bold text-muted-foreground" aria-hidden>$</span>
        <Input
          id={`bid-${p.itemId}`}
          inputMode="decimal"
          autoComplete="off"
          value={amountText}
          onChange={(e) => {
            touched.current = true
            setAmountText(e.target.value)
            setFeedback(null)
          }}
          className="h-14 text-2xl font-bold tnum md:text-2xl"
          aria-describedby={`bid-help-${p.itemId}`}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Quick amounts">
        {quick.map((c) => (
          <button
            type="button"
            key={c}
            onClick={() => {
              touched.current = true
              setAmountText(String(c / 100))
              setFeedback(null)
            }}
            className="tnum min-h-11 rounded-full border bg-white px-4 text-sm font-semibold text-ink hover:bg-secondary"
          >
            {formatCents(c)}
          </button>
        ))}
      </div>
      <p id={`bid-help-${p.itemId}`} className="mt-3 text-sm text-muted-foreground">
        {p.mode === 'silent'
          ? `Minimum bid: ${formatCents(p.minNextCents)} (increments of ${formatCents(p.incrementCents)}).`
          : `The auctioneer decides whether to take your bid. Next suggested bid: ${formatCents(p.minNextCents)}.`}
      </p>

      <Button type="submit" size="lg" variant="bid" className="mt-4 h-14 w-full text-lg" disabled={busy || (p.iAmLeading && p.mode === 'silent')}>
        {busy ? (
          <>
            <Loader2 className="size-5 animate-spin" /> {p.mode === 'silent' ? 'Placing bid…' : 'Sending…'}
          </>
        ) : p.mode === 'silent' ? (
          `Place bid${amountCents != null ? ` · ${formatCents(amountCents)}` : ''}`
        ) : (
          `Request bid${amountCents != null ? ` · ${formatCents(amountCents)}` : ''}`
        )}
      </Button>

      <div aria-live="polite" className="mt-3 min-h-6">
        {feedback ? (
          <p
            role={feedback.kind === 'error' ? 'alert' : 'status'}
            className={`rounded-xl px-3 py-2.5 text-sm font-medium ${
              feedback.kind === 'success' ? 'bg-[#dff3ee] text-[#0f5c4f]' : feedback.kind === 'info' ? 'bg-secondary text-ink' : 'bg-red-50 text-red-800'
            }`}
          >
            {feedback.text}
          </p>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Bids are binding. You’ll pay in person at checkout.</p>
    </form>
  )
}
