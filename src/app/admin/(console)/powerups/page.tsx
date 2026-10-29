import { getEvent } from '@/lib/events'
import { query } from '@/lib/db'
import { requireAdminPage } from '@/lib/session'
import { listDefs, powerupRevenue } from '@/lib/powerups'
import { pieSummary } from '@/lib/pies'
import { listRoomDefs } from '@/lib/rooms'
import { formatCents } from '@/lib/money'
import { DefsEditor, GameSettingsForm, KnockoutEditor, RoomDefsEditor, SellForm, VoidSale } from '@/components/powerups-admin'

export const metadata = { title: 'Power-Ups' }

export default async function PowerUpsPage() {
  const admin = await requireAdminPage()
  const isAdmin = admin.role === 'admin'
  const ev = await getEvent()
  const [defs, rooms, rev, pies] = await Promise.all([listDefs(), listRoomDefs(), powerupRevenue(ev.id), pieSummary(ev.id)])
  const e = (await query<any>('select * from events where id = $1', [ev.id]))[0]
  const purchases = await query<any>(
    `select p.id, p.quantity, p.total_cents, p.method, p.reference, p.created_at, p.voided_at, p.void_reason, d.name, b.bidder_number, b.name as bidder, a.name as sold_by
       from powerup_purchases p join powerup_defs d on d.code = p.powerup_code join bidders b on b.id = p.bidder_id join admin_users a on a.id = p.received_by_admin_id
      where p.event_id = $1 order by p.created_at desc limit 60`,
    [ev.id],
  )
  const acts = await query<any>(
    `select a.created_at, d.name, b.bidder_number, i.item_number, i.title, a.details->>'headline' as headline
       from powerup_activations a join powerup_defs d on d.code = a.powerup_code join bidders b on b.id = a.bidder_id join auction_items i on i.id = a.item_id
      where a.event_id = $1 order by a.created_at desc limit 60`,
    [ev.id],
  )
  const items = await query<any>(`select id, item_number, title, kind, min_qualifying_bid_cents from auction_items where event_id = $1 and status <> 'draft' order by item_number`, [ev.id])
  const owned = await query<any>(
    `select d.name, coalesce(sum(p.quantity) filter (where p.voided_at is null), 0)::int bought,
            (select count(*) from powerup_activations a where a.powerup_code = d.code)::int used
       from powerup_defs d left join powerup_purchases p on p.powerup_code = d.code group by d.code, d.name, d.sort order by d.sort`,
  )
  const fmt = (d: Date) => d.toLocaleString('en-US', { timeZone: ev.timezone, hour: 'numeric', minute: '2-digit', second: '2-digit', month: 'short', day: 'numeric' })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Power-Ups &amp; game</h1>
        <p className="mt-1 text-sm text-muted-foreground">Power-Up sales are reported on their own — they are never added to an item’s winning bid or to a guest’s auction checkout.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[['Power-Up sales', rev.totalCents], ['Cash', rev.cashCents], ['Check', rev.checkCents], ['Card terminal', rev.cardCents]].map(([l, v]) => (
          <div key={l as string} className="rounded-xl border bg-card p-3"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{l}</p><p className="tnum text-2xl font-extrabold">{formatCents(v as number)}</p></div>
        ))}
        <div className="rounded-xl border bg-card p-3"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Units sold</p><p className="tnum text-2xl font-extrabold">{rev.units}{rev.complimentaryUnits ? <span className="text-sm font-medium text-muted-foreground"> ({rev.complimentaryUnits} free)</span> : null}</p></div>
        <div className="rounded-xl border-2 border-ink bg-brand-yellow p-3"><p className="text-xs font-bold uppercase tracking-wide">🥧 Pie sign-ups (separate)</p><p className="tnum text-2xl font-extrabold">{formatCents(pies.cents)}</p><p className="text-xs font-semibold">{pies.smallSold} small · {pies.largeSold} large · {pies.thrown} thrown</p></div>
      </div>

      <SellForm defs={defs.map((d) => ({ code: d.code, name: d.name, description: d.description, category: d.category, price_cents: d.price_cents, enabled: d.enabled, kinds: d.kinds, max_per_bidder_item: d.max_per_bidder_item, max_per_item: d.max_per_item, max_per_bidder: d.max_per_bidder, seconds: d.config.seconds ?? null }))} />

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-2xl">Inventory overview</h2>
        <table className="mt-3 w-full text-left text-sm"><thead><tr className="text-xs uppercase text-muted-foreground"><th className="py-1">Power-Up</th><th>Sold</th><th>Used</th><th>Still held by guests</th></tr></thead>
          <tbody>{owned.map((o: any) => <tr key={o.name} className="border-t"><td className="py-1.5 font-semibold">{o.name}</td><td className="tnum">{o.bought}</td><td className="tnum">{o.used}</td><td className="tnum">{o.bought - o.used}</td></tr>)}</tbody></table>
      </section>

      {isAdmin ? (
        <>
          <GameSettingsForm s={{ gameMode: e.game_mode, autoAcceptLive: e.auto_accept_live, provisionalSilent: e.provisional_silent, provisionalSeconds: e.provisional_seconds, liveInitialSeconds: e.live_initial_seconds, liveInactivitySeconds: e.live_inactivity_seconds, liveWarningSeconds: e.live_warning_seconds, liveMaxSeconds: e.live_max_seconds, minReopenSeconds: e.min_reopen_seconds, goalCents: e.goal_cents }} />
          <DefsEditor defs={defs.map((d) => ({ code: d.code, name: d.name, description: d.description, category: d.category, price_cents: d.price_cents, enabled: d.enabled, kinds: d.kinds, max_per_bidder_item: d.max_per_bidder_item, max_per_item: d.max_per_item, max_per_bidder: d.max_per_bidder, seconds: d.config.seconds ?? null }))} />
          <RoomDefsEditor rooms={rooms.map((r) => ({ code: r.code, name: r.name, enabled: r.enabled, prize: String(r.config.prize ?? ''), reward: String(r.config.reward ?? ''), seconds: (r.config.seconds as number) ?? null }))} />
          <KnockoutEditor items={items.map((i: any) => ({ id: i.id, number: i.item_number, title: i.title, kind: i.kind, minQ: i.min_qualifying_bid_cents }))} />
        </>
      ) : null}

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-2xl">Sales history</h2>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr className="text-xs uppercase text-muted-foreground"><th className="py-1">When</th><th>Guest</th><th>Power-Up</th><th>Qty</th><th>Paid</th><th>By</th><th /></tr></thead>
          <tbody>{purchases.map((p: any) => (
            <tr key={p.id} className={`border-t ${p.voided_at ? 'text-muted-foreground line-through' : ''}`}>
              <td className="py-1.5">{fmt(p.created_at)}</td><td>#{p.bidder_number} {p.bidder}</td><td>{p.name}</td><td className="tnum">{p.quantity}</td>
              <td className="tnum">{formatCents(p.total_cents)} <span className="text-xs">{p.method.replace('_', ' ')}{p.reference ? ` · ${p.reference}` : ''}</span></td><td>{p.sold_by}</td>
              <td>{p.voided_at ? <span className="text-xs no-underline">voided: {p.void_reason}</span> : isAdmin ? <VoidSale id={p.id} /> : null}</td>
            </tr>))}</tbody></table>
          {purchases.length === 0 ? <p className="py-3 text-muted-foreground">No sales yet.</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-2xl">Activation history</h2>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr className="text-xs uppercase text-muted-foreground"><th className="py-1">When</th><th>Power-Up</th><th>Guest</th><th>Item</th></tr></thead>
          <tbody>{acts.map((a: any, i: number) => <tr key={i} className="border-t"><td className="py-1.5">{fmt(a.created_at)}</td><td>{a.name}</td><td>#{a.bidder_number}</td><td>#{a.item_number} {a.title}</td></tr>)}</tbody></table>
          {acts.length === 0 ? <p className="py-3 text-muted-foreground">Nothing used yet.</p> : null}
        </div>
      </section>
    </div>
  )
}
