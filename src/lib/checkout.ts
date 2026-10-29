import { one, query, tx, type Db } from './db'
import { AppError } from './errors'
import { audit } from './audit'
import { formatCents } from './money'
import { notify } from './realtime'

export type WonItem = {
  winning_result_id: string
  item_id: string
  item_number: number
  title: string
  kind: 'silent' | 'live'
  amount_cents: number
  paid_cents: number
  balance_cents: number
  collection_status: 'pending' | 'released'
  released_at: Date | null
  exception: boolean
  exception_reason: string | null
}

export type PaymentRow = {
  id: string
  method: 'cash' | 'check' | 'card_terminal' | 'online_card'
  amount_cents: number
  reference: string | null
  note: string | null
  received_by: string
  created_at: Date
  voided_at: Date | null
  void_reason: string | null
}

export const METHOD_LABEL: Record<string, string> = { cash: 'Cash', check: 'Check', card_terminal: 'Card terminal', online_card: 'Online (Square)' }

/** Items a bidder won, with what has been paid against each (voided payments excluded). */
export async function wonItems(bidderId: string, db?: Db): Promise<WonItem[]> {
  return query<WonItem>(
    `select wr.id as winning_result_id, i.id as item_id, i.item_number, i.title, i.kind,
            wr.amount_cents,
            coalesce((select sum(a.amount_cents) from payment_allocations a join payments p on p.id = a.payment_id
                       where a.winning_result_id = wr.id and p.voided_at is null), 0)::int as paid_cents,
            (wr.amount_cents - coalesce((select sum(a.amount_cents) from payment_allocations a join payments p on p.id = a.payment_id
                       where a.winning_result_id = wr.id and p.voided_at is null), 0))::int as balance_cents,
            ic.status as collection_status, ic.released_at, ic.exception, ic.exception_reason
       from winning_results wr
       join auction_items i on i.id = wr.item_id
       left join item_collections ic on ic.winning_result_id = wr.id
      where wr.bidder_id = $1 and wr.voided_at is null
      order by i.item_number`,
    [bidderId],
    db,
  )
}

export async function bidderPayments(bidderId: string): Promise<PaymentRow[]> {
  return query<PaymentRow>(
    `select p.id, p.method, p.amount_cents, p.reference, p.note, coalesce(a.name, 'the guest, online') as received_by, p.created_at, p.voided_at, p.void_reason
       from payments p left join admin_users a on a.id = p.received_by_admin_id
      where p.bidder_id = $1 order by p.created_at`,
    [bidderId],
  )
}

export function totals(items: WonItem[]) {
  const owed = items.reduce((s, i) => s + i.amount_cents, 0)
  const paid = items.reduce((s, i) => s + i.paid_cents, 0)
  return { owedCents: owed, paidCents: paid, balanceCents: owed - paid }
}

export function paymentStatus(t: { owedCents: number; paidCents: number }): 'none' | 'unpaid' | 'partial' | 'paid' {
  if (t.owedCents === 0) return 'none'
  if (t.paidCents === 0) return 'unpaid'
  return t.paidCents >= t.owedCents ? 'paid' : 'partial'
}

/**
 * Records money that has ACTUALLY been received. Serialised per bidder (row lock) so two volunteers
 * can never overpay a balance. The payment is allocated oldest-item-first.
 */
export async function recordPayment(p: {
  bidderId: string
  method: 'cash' | 'check' | 'card_terminal'
  amountCents: number
  reference?: string
  note?: string
  adminId: string
  idempotencyKey: string
}) {
  if (!['cash', 'check', 'card_terminal'].includes(p.method)) throw new AppError('INVALID_METHOD', 'Choose cash, check, or card terminal.')
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new AppError('INVALID_AMOUNT', 'Enter the amount received.')
  if (!p.idempotencyKey) throw new AppError('INVALID_REQUEST', 'Missing request id.')
  return tx(async (c) => {
    const b = await one<{ id: string; event_id: string; bidder_number: number }>('select id, event_id, bidder_number from bidders where id = $1 for update', [p.bidderId], c)
    if (!b) throw new AppError('BIDDER_NOT_FOUND', 'Bidder not found.', 404)

    const prior = await one<{ id: string }>('select id from payments where idempotency_key = $1', [p.idempotencyKey], c)
    if (prior) return { replay: true, paymentId: prior.id }

    const items = await wonItems(b.id, c)
    const t = totals(items)
    if (p.amountCents > t.balanceCents) {
      throw new AppError('OVERPAYMENT', `That is more than the balance due (${formatCents(t.balanceCents)}).`, 422, { balanceCents: t.balanceCents })
    }
    const pay = await one<{ id: string }>(
      `insert into payments (event_id, bidder_id, method, amount_cents, reference, note, received_by_admin_id, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [b.event_id, b.id, p.method, p.amountCents, p.reference?.trim() || null, p.note?.trim() || null, p.adminId, p.idempotencyKey],
      c,
    )
    let left = p.amountCents
    for (const it of items) {
      if (left <= 0) break
      const take = Math.min(left, it.balance_cents)
      if (take <= 0) continue
      await c.query('insert into payment_allocations (payment_id, winning_result_id, amount_cents) values ($1,$2,$3)', [pay!.id, it.winning_result_id, take])
      left -= take
    }
    await audit({ eventId: b.event_id, actorType: 'admin', actorId: p.adminId, action: 'payment.recorded', entityType: 'payment', entityId: pay!.id, details: { bidderNumber: b.bidder_number, method: p.method, amountCents: p.amountCents, reference: p.reference ?? null } }, c)
    await notify(c, { t: 'bidder', id: b.id })
    return { replay: false, paymentId: pay!.id }
  })
}

/** Admin-only correction. The payment row is kept and flagged void; the balance is recomputed from valid payments. */
export async function voidPayment(paymentId: string, adminId: string, reason: string) {
  if (!reason.trim()) throw new AppError('REASON_REQUIRED', 'A reason is required to void a payment.')
  return tx(async (c) => {
    const pay = await one<{ id: string; bidder_id: string; event_id: string; amount_cents: number; voided_at: Date | null }>('select id, bidder_id, event_id, amount_cents, voided_at from payments where id = $1', [paymentId], c)
    if (!pay) throw new AppError('PAYMENT_NOT_FOUND', 'Payment not found.', 404)
    await c.query('select 1 from bidders where id = $1 for update', [pay.bidder_id])
    const fresh = await one<{ voided_at: Date | null }>('select voided_at from payments where id = $1', [paymentId], c)
    if (fresh!.voided_at) throw new AppError('ALREADY_VOIDED', 'This payment was already voided.', 409)

    // Items already handed over on the strength of this payment must be re-checked by an admin.
    const released = await query<{ item_number: number }>(
      `select i.item_number from payment_allocations a
         join winning_results wr on wr.id = a.winning_result_id
         join auction_items i on i.id = wr.item_id
         join item_collections ic on ic.winning_result_id = wr.id
        where a.payment_id = $1 and ic.status = 'released' and not ic.exception`,
      [paymentId],
      c,
    )
    await c.query('update payments set voided_at = now(), voided_by_admin_id = $2, void_reason = $3 where id = $1', [paymentId, adminId, reason.trim()])
    await audit({ eventId: pay.event_id, actorType: 'admin', actorId: adminId, action: 'payment.voided', entityType: 'payment', entityId: paymentId, details: { amountCents: pay.amount_cents, reason, releasedItemNumbers: released.map((r) => r.item_number) } }, c)
    await notify(c, { t: 'bidder', id: pay.bidder_id })
    return { releasedItemNumbers: released.map((r) => r.item_number) }
  })
}

/** Hand an item over. Requires it to be fully paid, unless an admin records an explicit exception with a reason. */
export async function releaseItem(p: { winningResultId: string; adminId: string; isAdmin: boolean; exceptionReason?: string }) {
  return tx(async (c) => {
    const wr = await one<{ id: string; bidder_id: string; amount_cents: number; event_id: string }>(
      `select wr.id, wr.bidder_id, wr.amount_cents, i.event_id from winning_results wr join auction_items i on i.id = wr.item_id
        where wr.id = $1 and wr.voided_at is null`,
      [p.winningResultId],
      c,
    )
    if (!wr) throw new AppError('RESULT_NOT_FOUND', 'Winning record not found.', 404)
    await c.query('select 1 from bidders where id = $1 for update', [wr.bidder_id])
    const it = (await wonItems(wr.bidder_id, c)).find((x) => x.winning_result_id === wr.id)!
    if (it.collection_status === 'released') throw new AppError('ALREADY_RELEASED', 'This item was already released.', 409)
    const exception = it.balance_cents > 0
    if (exception) {
      if (!p.isAdmin) throw new AppError('UNPAID', `This item still has ${formatCents(it.balance_cents)} due. Only an administrator can release it unpaid.`, 403)
      if (!p.exceptionReason?.trim()) throw new AppError('REASON_REQUIRED', 'Enter a reason for releasing this item before it is paid.')
    }
    await c.query(
      `update item_collections set status = 'released', released_by_admin_id = $2, released_at = now(), exception = $3, exception_reason = $4 where winning_result_id = $1`,
      [wr.id, p.adminId, exception, exception ? p.exceptionReason!.trim() : null],
    )
    await audit({ eventId: wr.event_id, actorType: 'admin', actorId: p.adminId, action: exception ? 'item.released_exception' : 'item.released', entityType: 'winning_result', entityId: wr.id, details: { balanceCents: it.balance_cents, reason: p.exceptionReason ?? null } }, c)
    await notify(c, { t: 'bidder', id: wr.bidder_id })
  })
}

export async function unreleaseItem(winningResultId: string, adminId: string, reason: string) {
  if (!reason.trim()) throw new AppError('REASON_REQUIRED', 'A reason is required.')
  const r = await one<{ event_id: string }>(
    `select i.event_id from winning_results wr join auction_items i on i.id = wr.item_id where wr.id = $1`,
    [winningResultId],
  )
  await query(`update item_collections set status = 'pending', released_by_admin_id = null, released_at = null, exception = false, exception_reason = null where winning_result_id = $1`, [winningResultId])
  await audit({ eventId: r?.event_id, actorType: 'admin', actorId: adminId, action: 'item.unreleased', entityType: 'winning_result', entityId: winningResultId, details: { reason } })
}
