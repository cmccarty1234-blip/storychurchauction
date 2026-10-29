'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Loader2 } from 'lucide-react'
import { newKey, post } from '@/lib/client'
import { formatCents } from '@/lib/money'
import { Button } from '@/components/ui/button'

type Entry = { id: string; number: number; name: string; cook: string | null; cents: number; votes: number; voters: number }
type Data = { state: 'off' | 'open' | 'closed'; entries: Entry[]; totalCents: number; signedIn: boolean; mine: { byEntry: Record<string, number>; owedCents: number; paidCents: number } | null }

/** The guest chili page: $1 = 1 vote. Live totals; each vote is added to what the guest owes the desk at checkout. */
export function ChiliVote() {
  const [data, setData] = useState<Data | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ id: string; ok: boolean; text: string } | null>(null)

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
          return (
            <li key={e.id} className="rounded-2xl border bg-card p-4 shadow-sm">
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
              {mine > 0 ? <p className="mt-2 text-sm font-semibold text-[#0f5c4f]"><Check className="mr-1 inline size-4" />You gave {formatCents(mine)}</p> : null}
              {open && data.signedIn ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {[1, 5, 10].map((n) => (
                    <Button key={n} variant="bid" className="h-12 min-w-24 flex-1 text-base" disabled={busy !== null} onClick={() => vote(e, n)}>
                      {busy === e.id + n ? <Loader2 className="size-5 animate-spin" /> : `+${n} vote${n === 1 ? '' : 's'} · $${n}`}
                    </Button>
                  ))}
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
