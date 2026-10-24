'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmAction } from '@/components/admin-ui'
import { newKey, post } from '@/lib/client'
import { formatCents, parseDollars } from '@/lib/money'

export type DefRow = { code: string; name: string; description: string; price_cents: number; enabled: boolean; kinds: string[]; max_per_bidder_item: number | null; max_per_item: number | null; max_per_bidder: number | null; seconds: number | null }
export type RoomRow = { code: string; name: string; enabled: boolean; prize: string; reward: string; seconds: number | null }
export type GameSettings = { gameMode: boolean; autoAcceptLive: boolean; provisionalSilent: boolean; provisionalSeconds: number; liveInitialSeconds: number; liveInactivitySeconds: number; liveWarningSeconds: number; liveMaxSeconds: number | null; minReopenSeconds: number; goalCents: number | null }
export type ItemRow = { id: string; number: number; title: string; kind: string; minQ: number | null }

const call = (body: Record<string, unknown>) => post('/api/admin/powerups', body)

function useAction() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  async function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>, okText: string) {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error?.message ?? 'Failed' })
    if (r.ok) router.refresh()
    return r
  }
  return { busy, msg, run, setMsg }
}

const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) =>
  m ? <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-sm font-semibold ${m.ok ? 'bg-[#dff3ee] text-[#0f5c4f]' : 'bg-red-50 text-red-800'}`}>{m.text}</p> : null

// ───────────────────────── record a sale at the desk ─────────────────────────
export function SellForm({ defs }: { defs: DefRow[] }) {
  const { busy, msg, run } = useAction()
  const sellable = defs.filter((d) => d.enabled)
  const [paddle, setPaddle] = useState('')
  const [found, setFound] = useState<{ paddle: string; who: string } | null>(null)
  const [code, setCode] = useState(sellable[0]?.code ?? '')
  const [qty, setQty] = useState('1')
  const [method, setMethod] = useState('cash')
  const [ref, setRef] = useState('')
  const [paid, setPaid] = useState(false)
  const key = useRef(newKey())
  const def = defs.find((d) => d.code === code)
  const n = Math.max(1, parseInt(qty, 10) || 1)
  const total = method === 'comp' ? 0 : (def?.price_cents ?? 0) * n

  // The name is only shown while it still matches what is typed, so a stale guest can never be charged by mistake.
  const who = found && found.paddle === paddle ? found.who : null
  useEffect(() => {
    const p = parseInt(paddle, 10)
    if (!Number.isInteger(p)) return
    const id = setTimeout(async () => {
      const r = await fetch(`/api/admin/bid-desk?paddle=${p}`).then((x) => x.json()).catch(() => null)
      setFound({ paddle, who: r?.bidder ? `#${r.bidder.number} ${r.bidder.name}` : 'No guest with that number' })
    }, 300)
    return () => clearTimeout(id)
  }, [paddle])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const r = await run(
      () => call({ action: 'purchase', bidderNumber: parseInt(paddle, 10), code, quantity: n, method, reference: ref || undefined, idempotencyKey: key.current }),
      `Recorded: ${n} × ${def?.name} for ${who ?? 'guest'} — ${formatCents(total)}. It is in their inventory now.`,
    )
    if (r.ok || (r as { error?: { code?: string } }).error?.code !== 'NETWORK') key.current = newKey()
    if (r.ok) {
      setPaddle('')
      setQty('1')
      setRef('')
      setPaid(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border bg-card p-5">
      <h2 className="text-2xl">Sell a Power-Up</h2>
      <p className="mt-1 text-sm text-muted-foreground">Take the payment first, then record it. The guest sees it in their inventory immediately.</p>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
        <label className="text-sm font-semibold">Paddle #<Input inputMode="numeric" value={paddle} onChange={(e) => setPaddle(e.target.value)} className="mt-1 h-12 text-lg" /></label>
        <label className="text-sm font-semibold md:col-span-2">Power-Up
          <select value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 h-12 w-full rounded-lg border bg-white px-2 text-lg">
            {sellable.map((d) => <option key={d.code} value={d.code}>{d.name} — {formatCents(d.price_cents)}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Quantity<Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 h-12 text-lg" /></label>
        <label className="text-sm font-semibold">Paid by
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1 h-12 w-full rounded-lg border bg-white px-2 text-lg">
            <option value="cash">Cash</option><option value="check">Check</option><option value="card_terminal">Card terminal</option><option value="comp">Complimentary (no charge)</option>
          </select>
        </label>
      </div>
      {method === 'check' || method === 'card_terminal' ? <label className="mt-3 block text-sm font-semibold">Reference (check # / terminal receipt)<Input value={ref} onChange={(e) => setRef(e.target.value)} className="mt-1 h-12" /></label> : null}
      <p className="mt-3 text-lg">{who ? <b>{who}</b> : <span className="text-muted-foreground">Enter a paddle number</span>} {who && !who.startsWith('No') ? <> · total due <b className="tnum">{formatCents(total)}</b></> : null}</p>
      <label className="mt-3 flex items-center gap-2 text-base font-semibold"><input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="size-5" /> {method === 'comp' ? 'This is a complimentary Power-Up' : `I have received ${formatCents(total)}`}</label>
      <Button type="submit" size="lg" variant="bid" className="mt-4 h-12 text-lg" disabled={busy || !paid || !who || who.startsWith('No') || !code}>{busy ? <Loader2 className="size-5 animate-spin" /> : 'Record sale'}</Button>
      <Msg m={msg} />
    </form>
  )
}

// ───────────────────────── definitions ─────────────────────────
export function DefsEditor({ defs }: { defs: DefRow[] }) {
  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="text-2xl">Power-Up settings</h2>
      <p className="mt-1 text-sm text-muted-foreground">Price changes apply to future sales only. A disabled Power-Up can’t be sold or used; guests keep what they already own.</p>
      <div className="mt-4 space-y-4">{defs.map((d) => <DefRowEditor key={d.code} d={d} />)}</div>
    </section>
  )
}
function DefRowEditor({ d }: { d: DefRow }) {
  const { busy, msg, run } = useAction()
  const [price, setPrice] = useState(String(d.price_cents / 100))
  const [enabled, setEnabled] = useState(d.enabled)
  const [kinds, setKinds] = useState(d.kinds)
  const [perItem, setPerItem] = useState(d.max_per_item?.toString() ?? '')
  const [perBI, setPerBI] = useState(d.max_per_bidder_item?.toString() ?? '')
  const [perBidder, setPerBidder] = useState(d.max_per_bidder?.toString() ?? '')
  const [secs, setSecs] = useState(d.seconds?.toString() ?? '')
  const toggle = (k: string) => setKinds((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))
  const num = (s: string) => (s.trim() === '' ? null : parseInt(s, 10) || null)
  return (
    <div className="rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-lg font-bold">{d.name}</p><p className="text-sm text-muted-foreground">{d.description}</p></div>
        <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-5" /> Enabled</label>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <label className="text-xs font-semibold">Price $<Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="mt-1 h-11" /></label>
        <label className="text-xs font-semibold">Max uses per item<Input value={perItem} onChange={(e) => setPerItem(e.target.value)} inputMode="numeric" placeholder="∞" className="mt-1 h-11" /></label>
        <label className="text-xs font-semibold">Max per guest per item<Input value={perBI} onChange={(e) => setPerBI(e.target.value)} inputMode="numeric" placeholder="∞" className="mt-1 h-11" /></label>
        <label className="text-xs font-semibold">Max owned per guest<Input value={perBidder} onChange={(e) => setPerBidder(e.target.value)} inputMode="numeric" placeholder="∞" className="mt-1 h-11" /></label>
        {d.seconds != null ? <label className="text-xs font-semibold">Seconds<Input value={secs} onChange={(e) => setSecs(e.target.value)} inputMode="numeric" className="mt-1 h-11" /></label> : null}
        <fieldset className="text-xs font-semibold"><legend>Allowed on</legend>
          {['silent', 'live'].map((k) => <label key={k} className="mr-3 inline-flex items-center gap-1"><input type="checkbox" checked={kinds.includes(k)} onChange={() => toggle(k)} /> {k}</label>)}
        </fieldset>
      </div>
      <Button className="mt-3 h-11" disabled={busy} onClick={() => run(() => call({ action: 'update-def', code: d.code, priceCents: parseDollars(price) ?? undefined, enabled, kinds, maxPerItem: num(perItem), maxPerBidderItem: num(perBI), maxPerBidder: num(perBidder), seconds: d.seconds != null ? num(secs) ?? undefined : undefined }), `${d.name} saved.`)}>Save {d.name}</Button>
      <Msg m={msg} />
    </div>
  )
}

// ───────────────────────── game settings ─────────────────────────
export function GameSettingsForm({ s }: { s: GameSettings }) {
  const { busy, msg, run } = useAction()
  const [v, setV] = useState({ ...s, liveMaxSeconds: s.liveMaxSeconds?.toString() ?? '', goal: s.goalCents != null ? String(s.goalCents / 100) : '' })
  const set = (k: keyof typeof v, val: unknown) => setV((x) => ({ ...x, [k]: val }))
  const n = (k: keyof typeof v) => (
    <Input inputMode="numeric" value={String(v[k] ?? '')} onChange={(e) => set(k, e.target.value)} className="mt-1 h-11" />
  )
  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="text-2xl">Game settings</h2>
      <p className="mt-1 text-sm text-muted-foreground">Everything here is OFF until you switch game mode on, so the auction behaves exactly as before until then.</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex items-center gap-2 font-semibold"><input type="checkbox" className="size-5" checked={v.gameMode} onChange={(e) => set('gameMode', e.target.checked)} /> Game mode (timers, Power-Ups, Room Events)</label>
        <label className="flex items-center gap-2 font-semibold"><input type="checkbox" className="size-5" checked={v.autoAcceptLive} onChange={(e) => set('autoAcceptLive', e.target.checked)} /> Accept phone bids on live items automatically</label>
        <label className="flex items-center gap-2 font-semibold"><input type="checkbox" className="size-5" checked={v.provisionalSilent} onChange={(e) => set('provisionalSilent', e.target.checked)} /> Silent items also get the last-chance window</label>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <label className="text-xs font-semibold">Opening bidding period (s){n('liveInitialSeconds')}</label>
        <label className="text-xs font-semibold">Inactivity countdown (s){n('liveInactivitySeconds')}</label>
        <label className="text-xs font-semibold">Warning threshold (s){n('liveWarningSeconds')}</label>
        <label className="text-xs font-semibold">Max live item length (s, blank = none){n('liveMaxSeconds')}</label>
        <label className="text-xs font-semibold">Last-chance window (s){n('provisionalSeconds')}</label>
        <label className="text-xs font-semibold">Smallest reopen allowed (s){n('minReopenSeconds')}</label>
        <label className="text-xs font-semibold">Fundraising goal $ (blank = no bar){n('goal')}</label>
      </div>
      <Button
        className="mt-4 h-11"
        disabled={busy}
        onClick={() =>
          run(
            () =>
              post('/api/admin/game-settings', {
                gameMode: v.gameMode, autoAcceptLive: v.autoAcceptLive, provisionalSilent: v.provisionalSilent,
                provisionalSeconds: +v.provisionalSeconds, liveInitialSeconds: +v.liveInitialSeconds, liveInactivitySeconds: +v.liveInactivitySeconds,
                liveWarningSeconds: +v.liveWarningSeconds, goalCents: v.goal.trim() === '' ? null : parseDollars(v.goal), liveMaxSeconds: String(v.liveMaxSeconds).trim() === '' ? null : +v.liveMaxSeconds, minReopenSeconds: +v.minReopenSeconds,
              }),
            'Game settings saved.',
          )
        }
      >
        Save game settings
      </Button>
      <Msg m={msg} />
    </section>
  )
}

// ───────────────────────── room events ─────────────────────────
export function RoomDefsEditor({ rooms }: { rooms: RoomRow[] }) {
  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="text-2xl">Room Events</h2>
      <p className="mt-1 text-sm text-muted-foreground">Free for everyone. Hosts start them from the Host console.</p>
      <div className="mt-4 space-y-3">{rooms.map((r) => <RoomEditor key={r.code} r={r} />)}</div>
    </section>
  )
}
function RoomEditor({ r }: { r: RoomRow }) {
  const { busy, msg, run } = useAction()
  const [enabled, setEnabled] = useState(r.enabled)
  const [prize, setPrize] = useState(r.prize)
  const [reward, setReward] = useState(r.reward)
  const [secs, setSecs] = useState(r.seconds?.toString() ?? '')
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center justify-between"><p className="text-lg font-bold">{r.name}</p><label className="flex items-center gap-2 font-semibold"><input type="checkbox" className="size-5" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled</label></div>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {r.code === 'jackpot' ? <label className="text-xs font-semibold sm:col-span-2">Prize<Input value={prize} onChange={(e) => setPrize(e.target.value)} className="mt-1 h-11" /></label> : null}
        {r.code === 'battle' ? <label className="text-xs font-semibold sm:col-span-2">Reward for the winning team<Input value={reward} onChange={(e) => setReward(e.target.value)} className="mt-1 h-11" /></label> : null}
        {r.code !== 'jackpot' ? <label className="text-xs font-semibold">Length (seconds)<Input value={secs} onChange={(e) => setSecs(e.target.value)} inputMode="numeric" className="mt-1 h-11" /></label> : null}
      </div>
      <Button className="mt-3 h-11" disabled={busy} onClick={() => run(() => call({ action: 'update-room', code: r.code, enabled, ...(r.code === 'jackpot' ? { prize } : {}), ...(r.code === 'battle' ? { reward } : {}), ...(r.code !== 'jackpot' && secs ? { seconds: +secs } : {}) }), `${r.name} saved.`)}>Save</Button>
      <Msg m={msg} />
    </div>
  )
}

// ───────────────────────── Knockout thresholds ─────────────────────────
export function KnockoutEditor({ items }: { items: ItemRow[] }) {
  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="text-2xl">Knockout minimums</h2>
      <p className="mt-1 text-sm text-muted-foreground">The Knockout can only be used on an item once its bid reaches this amount. Leave blank to switch the Knockout off for that item.</p>
      <div className="mt-3 max-h-96 divide-y overflow-auto rounded-xl border">{items.map((i) => <KnockoutRow key={i.id} i={i} />)}</div>
    </section>
  )
}
function KnockoutRow({ i }: { i: ItemRow }) {
  const { busy, msg, run } = useAction()
  const [v, setV] = useState(i.minQ != null ? String(i.minQ / 100) : '')
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2">
      <span className="min-w-0 flex-1 truncate"><b>#{i.number}</b> {i.title} <span className="text-xs text-muted-foreground">({i.kind})</span></span>
      <Input value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" placeholder="off" className="h-11 w-28" aria-label={`Knockout minimum for item ${i.number}`} />
      <Button className="h-11" disabled={busy} onClick={() => run(() => call({ action: 'set-knockout', itemId: i.id, cents: v.trim() === '' ? null : parseDollars(v) }), 'Saved.')}>Save</Button>
      {msg ? <span className={`text-xs font-semibold ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</span> : null}
    </div>
  )
}

// ───────────────────────── void a sale ─────────────────────────
export function VoidSale({ id }: { id: string }) {
  return <ConfirmAction label="Void" className="h-11" variant="outline" title="Void this Power-Up sale?" description="The units are removed from the guest’s inventory and the money drops out of Power-Up sales. Refused if they already used them." confirmLabel="Void sale" reasonLabel="Reason (required)" action={(reason) => call({ action: 'void', purchaseId: id, reason })} />
}
