'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, Heart, Loader2 } from 'lucide-react'
import { newKey, post } from '@/lib/client'
import { formatCents } from '@/lib/money'
import { Button } from '@/components/ui/button'

type Entry = { id: string; number: number; name: string; cook: string | null; cents: number; votes: number; voters: number; hearts: number }
type Data = { state: 'off' | 'open' | 'closed'; entries: Entry[]; totalCents: number; signedIn: boolean; mine: { byEntry: Record<string, number>; hearts: string[]; owedCents: number; paidCents: number } | null }

/** The guest chili page: $1 = 1 vote. Live totals; each vote is added to what the guest owes the desk at checkout. */
export function ChiliVote({ highlight }: { highlight?: number }) {
  const [data, setData] = useState<Data | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ id: string; ok: boolean; text: string } | null>(null)
  const scrolled = useRef(false)
  const [custom, setCustom] = useState<Record<string, string>>({}) // what each guest is typing in "any amount"

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/chili', { cache: 'no-store' })
      if (r.ok) setData(await r.json())
    } catch {}
  }, [])
  useEffect(() => {
    const first = setTimeout(() => void load(), 0)
    const id = setInterval(() => void load(), 4000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [load])

  // Coming from a chili's QR code: bring that chili into view once the list has loaded.
  useEffect(() => {
    if (!data || highlight == null || scrolled.current) return
    scrolled.current = true
    document.getElementById(`chili-${highlight}`)?.scrollIntoView({ block: 'center' })
  }, [data, highlight])

  async function heart(entry: Entry) {
    const r = await post('/api/chili/heart', { entryId: entry.id })
    if (!r.ok) setNote({ id: entry.id, ok: false, text: r.error.message })
    void load()
  }

  async function vote(entry: Entry, votes: number) {
    setBusy(entry.id + votes)
    setNote(null)
    const r = await post('/api/chili', { entryId: entry.id, votes, idempotencyKey: newKey() })
    setBusy(null)
    setNote(r.ok ? { id: entry.id, ok: true, text: `${votes} vote${votes === 1 ? '' : 's'} for ${entry.name}! (${formatCents(votes * 100)})` } : { id: entry.id, ok: false, text: r.error.message })
    void load()
  }

  if (!data) return <p className="py-8 text-center text-muted-foreground">Loading the cook-off…</p>
  if (data.state === 'off' || data.entries.length === 0) return <p className="rounded-xl border bg-card p-6 text-center text-lg">The chili cook-off isn’t open yet. Check back soon!</p>
  const open = data.state === 'open'
  const leader = data.entries[0]
  const byNumber = [...data.entries].sort((a, b) => a.number - b.number)

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-ink p-5 text-center text-white">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-brand-yellow">Chili cook-off</p>
        <p className="mt-1 text-2xl font-extrabold sm:text-3xl">{open ? '$1 = 1 vote · most dollars wins' : 'Voting is closed'}</p>
        <p className="tnum mt-2 text-lg text-white/80">{formatCents(data.totalCents)} raised so far{leader && leader.cents > 0 ? ` · ${leader.name} is ahead!` : ''}</p>
      </div>

      {!data.signedIn ? (
        <p className="rounded-xl border-2 border-ink bg-brand-yellow p-4 text-center font-bold">
          <Link href="/register?next=/chili" className="underline underline-offset-2">Register</Link> (it takes a minute) to vote for your favorite!
        </p>
      ) : null}

      {data.signedIn && data.mine && data.mine.owedCents > 0 ? (
        <p role="status" className="rounded-xl border bg-card p-3 text-center font-semibold">
          Your chili votes: <b className="tnum">{formatCents(data.mine.owedCents)}</b> — pay at the checkout desk with the rest of your balance.
        </p>
      ) : null}

      <ul className="space-y-3">
        {byNumber.map((e) => {
          const mine = data.mine?.byEntry[e.id] ?? 0
          const hearted = data.mine?.hearts?.includes(e.id) ?? false
          return (
            <li key={e.id} id={`chili-${e.number}`} className={`rounded-2xl border bg-card p-4 shadow-sm ${e.number === highlight ? 'border-2 border-ink ring-4 ring-brand-yellow' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Chili #{e.number}</p>
                  <p className="text-xl font-extrabold leading-tight">{e.name}</p>
                  {e.cook ? <p className="text-sm text-muted-foreground">by {e.cook}</p> : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="tnum text-2xl font-extrabold text-ink">{formatCents(e.cents)}</p>
                  <p className="text-xs text-muted-foreground">{e.votes} vote{e.votes === 1 ? '' : 's'}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {data.signedIn ? (
                  <button type="button" onClick={() => heart(e)} aria-pressed={hearted} aria-label={hearted ? `Take back your heart for ${e.name}` : `Heart ${e.name}`} className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-bold ${hearted ? 'border-red-300 bg-red-50 text-red-600' : 'bg-white text-ink hover:bg-secondary'}`}>
                    <Heart className={`size-5 ${hearted ? 'fill-red-500 text-red-500' : ''}`} /> <span className="tnum">{e.hearts}</span>
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground"><Heart className="size-5" /> <span className="tnum">{e.hearts}</span></span>
                )}
                {mine > 0 ? <p className="text-sm font-semibold text-[#0f5c4f]"><Check className="mr-1 inline size-4" />You gave {formatCents(mine)}</p> : null}
              </div>
              {open && data.signedIn ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {[1, 5, 10, 20].map((n) => (
                    <Button key={n} variant="bid" className="h-12 min-w-20 flex-1 text-base" disabled={busy !== null} onClick={() => vote(e, n)}>
                      {busy === e.id + n ? <Loader2 className="size-5 animate-spin" /> : `+${n} vote${n === 1 ? '' : 's'} · $${n}`}
                    </Button>
                  ))}
                  <form
                    className="flex w-full items-center gap-2"
                    onSubmit={(ev) => {
                      ev.preventDefault()
                      const n = parseInt(custom[e.id] ?? '', 10)
                      if (Number.isInteger(n) && n >= 1) void vote(e, n).then(() => setCustom((c) => ({ ...c, [e.id]: '' })))
                    }}
                  >
                    <label className="flex h-12 flex-1 items-center gap-1 rounded-xl border bg-white px-3 text-lg font-bold">
                      <span aria-hidden>$</span>
                      <input inputMode="numeric" pattern="[0-9]*" aria-label={`Any amount for ${e.name}`} placeholder="Any amount" value={custom[e.id] ?? ''} onChange={(ev) => setCustom((c) => ({ ...c, [e.id]: ev.target.value.replace(/[^0-9]/g, '').slice(0, 4) }))} className="w-full min-w-0 bg-transparent outline-none placeholder:font-normal placeholder:text-muted-foreground" />
                    </label>
                    <Button type="submit" variant="bid" className="h-12 px-5 text-base" disabled={busy !== null || !(parseInt(custom[e.id] ?? '', 10) >= 1)}>
                      {busy !== null && busy === e.id + parseInt(custom[e.id] ?? '', 10) ? <Loader2 className="size-5 animate-spin" /> : `Give $${parseInt(custom[e.id] ?? '', 10) >= 1 ? parseInt(custom[e.id], 10) : ''}`}
                    </Button>
                  </form>
                </div>
              ) : null}
              {note && note.id === e.id ? <p role={note.ok ? 'status' : 'alert'} className={`mt-2 text-sm font-semibold ${note.ok ? 'text-[#0f5c4f]' : 'text-danger'}`}>{note.text}</p> : null}
            </li>
          )
        })}
      </ul>
      <p className="text-center text-xs text-muted-foreground">Votes are collected at the checkout desk. Every dollar goes to the fundraiser.</p>
    </div>
  )
}
