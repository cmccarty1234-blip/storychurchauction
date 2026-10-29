/**
 * Pay-by-card from a guest's phone. The flow is deliberately conservative:
 *   1. The server works out the guest's balance itself and creates a Square checkout link for that exact amount.
 *   2. Nothing is credited until SQUARE says the payment is COMPLETED — via a signed webhook, or by asking Square about
 *      the order when the guest comes back (so a slow or missing webhook can't leave a paid guest unpaid).
 *   3. Applying a payment is idempotent (same Square payment never counts twice) and can never overpay a balance: if the
 *      guest owed less by then (e.g. they also paid at the desk), the extra is flagged "refund due" for staff.
 */
import { one, query, tx } from './db'
import { AppError } from './errors'
import { audit } from './audit'
import { notify } from './realtime'
import { formatCents } from './money'
import { appUrl } from './appurl'
import { totals, wonItems } from './checkout'
import { createPaymentLink, getOrder, getPayment, squareReady } from './square'

export async function onlinePaymentsAvailable(eventId: string) {
  const e = await one<{ online_payments: boolean }>('select online_payments from events where id = $1', [eventId])
  return !!e?.online_payments && squareReady()
}

/** Guest taps "Pay now": returns the Square page to send them to. */
export async function startOnlinePayment(bidderId: string) {
  const row = await tx(async (c) => {
    const b = await one<{ id: string; event_id: string; bidder_number: number }>('select id, event_id, bidder_number from bidders where id = $1 for update', [bidderId], c)
    if (!b) throw new AppError('BIDDER_NOT_FOUND', 'Bidder not found.', 404)
    const ev = await one<{ online_payments: boolean }>('select online_payments from events where id = $1', [b.event_id], c)
    if (!ev?.online_payments || !squareReady()) throw new AppError('PAYMENTS_OFF', 'Online payment isn’t switched on. Please pay at the checkout table.', 409)
    const owing = (await wonItems(b.id, c)).filter((i) => i.balance_cents > 0)
    const balance = owing.reduce((s, i) => s + i.balance_cents, 0)
    if (balance <= 0) throw new AppError('NOTHING_DUE', 'You don’t have a balance to pay right now.', 409)
    const contact = await one<{ email: string | null; phone: string | null }>('select email, phone from bidders where id = $1', [b.id], c)
    const op = await one<{ id: string }>('insert into online_payments (event_id, bidder_id, amount_cents) values ($1,$2,$3) returning id', [b.event_id, b.id, balance], c)
    return { id: op!.id, eventId: b.event_id, number: b.bidder_number, amountCents: balance, lines: owing.map((i) => ({ name: `#${i.item_number} ${i.title}`, amountCents: i.balance_cents })), email: contact?.email ?? null, phone: contact?.phone ?? null }
  })
  try {
    const link = await createPaymentLink({
      idempotencyKey: row.id,
      lines: row.lines,
      referenceId: row.id,
      buyerEmail: row.email,
      buyerPhone: row.phone,
      redirectUrl: `${appUrl()}/my-wins?paid=1`,
      note: `Auction balance, bidder #${row.number} (ref ${row.id.slice(0, 8)})`,
    })
    await query('update online_payments set square_link_id = $2, square_order_id = $3 where id = $1', [row.id, link.linkId, link.orderId])
    return { url: link.url, amountCents: row.amountCents }
  } catch (e) {
    await query("update online_payments set status = 'failed' where id = $1", [row.id])
    throw e
  }
}

/** Square says this order was paid. Safe to call any number of times, from the webhook and from reconciliation. */
export async function applyCompleted(p: { orderId: string; paymentId: string; amountCents: number; receipt?: string | null }) {
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) return { ignored: true as const }
  return tx(async (c) => {
    const op = await one<{ id: string; event_id: string; bidder_id: string; status: string }>('select id, event_id, bidder_id, status from online_payments where square_order_id = $1 for update', [p.orderId], c)
    if (!op) return { ignored: true as const } // not one of ours
    if (op.status === 'paid' || op.status === 'paid_refund_due') return { replay: true as const }

    const b = await one<{ id: string; bidder_number: number }>('select id, bidder_number from bidders where id = $1 for update', [op.bidder_id], c)
    const items = await wonItems(op.bidder_id, c)
    const balance = totals(items).balanceCents
    const apply = Math.min(p.amountCents, balance)
    const refund = p.amountCents - apply

    if (apply > 0) {
      const pay = await one<{ id: string }>(
        `insert into payments (event_id, bidder_id, method, amount_cents, reference, note, received_by_admin_id, idempotency_key)
         values ($1,$2,'online_card',$3,$4,$5,null,$6) returning id`,
        [op.event_id, op.bidder_id, apply, p.receipt ?? p.paymentId, 'Paid online (Square)', `square:${p.paymentId}`],
        c,
      )
      let left = apply
      for (const it of items) {
        if (left <= 0) break
        const take = Math.min(left, it.balance_cents)
        if (take <= 0) continue
        await c.query('insert into payment_allocations (payment_id, winning_result_id, amount_cents) values ($1,$2,$3)', [pay!.id, it.winning_result_id, take])
        left -= take
      }
    }
    await c.query(
      `update online_payments set status = $2, square_payment_id = $3, applied_cents = $4, refund_due_cents = $5, paid_at = now() where id = $1`,
      [op.id, refund > 0 ? 'paid_refund_due' : 'paid', p.paymentId, apply, refund],
    )
    await audit(
      { eventId: op.event_id, actorType: 'system', action: 'payment.online', entityType: 'bidder', entityId: op.bidder_id, details: { bidderNumber: b!.bidder_number, paidCents: p.amountCents, appliedCents: apply, refundDueCents: refund, squarePaymentId: p.paymentId } },
      c,
    )
    await notify(c, { t: 'bidder', id: op.bidder_id })
    return { applied: apply, refundDue: refund }
  })
}

/** Handles a (signature-verified) Square webhook body. */
export async function handleSquareEvent(evt: any) {
  const pay = evt?.data?.object?.payment
  if (!String(evt?.type ?? '').startsWith('payment.') || !pay) return { ignored: true }
  if (pay.status !== 'COMPLETED' || !pay.order_id || pay.amount_money?.currency !== 'USD') return { ignored: true }
  return applyCompleted({ orderId: pay.order_id, paymentId: pay.id, amountCents: pay.amount_money.amount, receipt: pay.receipt_number })
}

/** Belt and braces: ask Square about this guest's recent unfinished checkouts (covers a slow or misconfigured webhook). */
export async function reconcileBidder(bidderId: string) {
  if (!squareReady()) return 0
  const open = await query<{ square_order_id: string }>(
    `select square_order_id from online_payments where bidder_id = $1 and status = 'created' and square_order_id is not null and created_at > now() - interval '12 hours'`,
    [bidderId],
  )
  let n = 0
  for (const o of open) {
    try {
      const order = await getOrder(o.square_order_id)
      if (!order.paymentId) continue // nothing paid yet
      const pay = await getPayment(order.paymentId) // trust the payment's own status, not the order's
      if (pay.status === 'COMPLETED' && pay.currency === 'USD' && pay.amountCents > 0) {
        const r = await applyCompleted({ orderId: o.square_order_id, paymentId: order.paymentId, amountCents: pay.amountCents, receipt: pay.receipt })
        if ('applied' in r) n++
      }
    } catch {
      // Square unreachable: leave it for the webhook / the next page load.
    }
  }
  return n
}

export const refundNote = (cents: number) => `Paid ${formatCents(cents)} more than was owed — refund it in Square.`
