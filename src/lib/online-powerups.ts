/**
 * Buy Power-Ups on the phone with Square. Same safety rules as paying a balance online:
 *   1. The server prices the order itself (the screen only chooses WHICH Power-Up and HOW MANY).
 *   2. Nothing is credited until SQUARE says the payment is COMPLETED (signed webhook, or asking Square when the guest comes back).
 *   3. Crediting is idempotent — one Square payment can never add Power-Ups twice.
 * Not available until events.powerups_online_from (checked against the database clock).
 */
import { one, query, tx } from './db'
import { AppError } from './errors'
import { audit } from './audit'
import { notify } from './realtime'
import { formatCents } from './money'
import { appUrl } from './appurl'
import { inventory } from './powerups'
import { createPaymentLink, getOrder, getPayment, squareReady } from './square'

export type OnlinePowerups = { enabled: boolean; open: boolean; opensAt: string | null; timezone: string }

/** Whether guests can buy Power-Ups online right now. Safe to call before migration 0011 has been run. */
export async function onlinePowerupsStatus(eventId: string): Promise<OnlinePowerups> {
  const off = { enabled: false, open: false, opensAt: null, timezone: 'America/Denver' }
  try {
    const e = await one<{ online_payments: boolean; opens_at: Date | null; timezone: string; now: Date }>(
      'select online_payments, powerups_online_from as opens_at, timezone, clock_timestamp() as now from events where id = $1',
      [eventId],
    )
    if (!e) return off
    const enabled = !!e.online_payments && squareReady() && !!e.opens_at
    return { enabled, open: enabled && e.now.getTime() >= e.opens_at!.getTime(), opensAt: e.opens_at ? e.opens_at.toISOString() : null, timezone: e.timezone }
  } catch {
    return off
  }
}

/** Guest taps "Buy online": returns the Square page to send them to. */
export async function startPowerUpPayment(p: { bidderId: string; code: string; quantity: number }) {
  if (!Number.isInteger(p.quantity) || p.quantity < 1 || p.quantity > 10) throw new AppError('INVALID_REQUEST', 'Choose between 1 and 10.')
  const b = await one<{ id: string; event_id: string; bidder_number: number }>('select id, event_id, bidder_number from bidders where id = $1', [p.bidderId])
  if (!b) throw new AppError('BIDDER_NOT_FOUND', 'Bidder not found.', 404)
  const status = await onlinePowerupsStatus(b.event_id)
  if (!status.open) throw new AppError('ONLINE_NOT_OPEN', status.enabled ? 'Buying Power-Ups online isn’t open yet. You can always buy at the Bid Desk.' : 'Buying Power-Ups online isn’t available. Please buy at the Bid Desk.', 409)
  const def = await one<{ code: string; name: string; price_cents: number; enabled: boolean; category: string; max_per_bidder: number | null }>(
    'select code, name, price_cents, enabled, category, max_per_bidder from powerup_defs where code = $1',
    [p.code],
  )
  if (!def || def.category !== 'powerup') throw new AppError('NOT_FOUND', 'That Power-Up isn’t sold online.', 404)
  if (!def.enabled) throw new AppError('POWERUP_DISABLED', `${def.name} is not for sale right now.`, 409)
  if (def.price_cents <= 0) throw new AppError('INVALID_REQUEST', 'That Power-Up can’t be bought online.', 409)
  if (def.max_per_bidder != null) {
    const inv = (await inventory(b.id)).find((r) => r.code === def.code)!
    if (inv.purchased + p.quantity > def.max_per_bidder) throw new AppError('LIMIT', `Each guest may buy at most ${def.max_per_bidder} ${def.name}.`, 409)
  }
  const amount = def.price_cents * p.quantity
  const order = await one<{ id: string }>(
    'insert into powerup_online_orders (event_id, bidder_id, powerup_code, quantity, unit_price_cents, amount_cents) values ($1,$2,$3,$4,$5,$6) returning id',
    [b.event_id, b.id, def.code, p.quantity, def.price_cents, amount],
  )
  const contact = await one<{ email: string | null; phone: string | null }>('select email, phone from bidders where id = $1', [b.id])
  try {
    const args = {
      idempotencyKey: order!.id,
      lines: [{ name: `${p.quantity} × ${def.name} (Power-Up)`, amountCents: amount }],
      referenceId: order!.id,
      buyerEmail: contact?.email ?? null,
      buyerPhone: contact?.phone ?? null,
      redirectUrl: `${appUrl()}/play?bought=1`,
      note: `Power-Up, bidder #${b.bidder_number} (ref ${order!.id.slice(0, 8)})`,
    }
    let link
    try {
      link = await createPaymentLink(args)
    } catch (e) {
      if (e instanceof AppError && e.data?.squareStatus === 400) link = await createPaymentLink({ ...args, minimal: true })
      else throw e
    }
    await query('update powerup_online_orders set square_link_id = $2, square_order_id = $3 where id = $1', [order!.id, link.linkId, link.orderId])
    return { url: link.url, amountCents: amount }
  } catch (e) {
    await query("update powerup_online_orders set status = 'failed' where id = $1", [order!.id])
    await audit({ eventId: b.event_id, actorType: 'system', action: 'powerup.online_error', entityType: 'bidder', entityId: b.id, details: { bidderNumber: b.bidder_number, ...(e instanceof AppError ? e.data ?? {} : { message: String((e as Error)?.message ?? e).slice(0, 200) }) } }).catch(() => {})
    throw e
  }
}

/** Square says this order was paid. Safe to call any number of times, from the webhook and from reconciliation. */
export async function applyPowerUpPaid(p: { orderId: string; paymentId: string; amountCents: number }) {
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) return { ignored: true as const }
  return tx(async (c) => {
    const o = await one<{ id: string; event_id: string; bidder_id: string; powerup_code: string; quantity: number; unit_price_cents: number; amount_cents: number; status: string }>(
      'select id, event_id, bidder_id, powerup_code, quantity, unit_price_cents, amount_cents, status from powerup_online_orders where square_order_id = $1 for update',
      [p.orderId],
      c,
    )
    if (!o) return { ignored: true as const } // not one of ours
    if (o.status === 'paid') return { replay: true as const }
    if (p.amountCents !== o.amount_cents) {
      // Never guess: leave it for a person to look at.
      await c.query("update powerup_online_orders set status = 'amount_mismatch', square_payment_id = $2 where id = $1", [o.id, p.paymentId])
      await audit({ eventId: o.event_id, actorType: 'system', action: 'powerup.online_amount_mismatch', entityType: 'bidder', entityId: o.bidder_id, details: { expectedCents: o.amount_cents, paidCents: p.amountCents, squarePaymentId: p.paymentId } }, c)
      return { mismatch: true as const }
    }
    const purchase = await one<{ id: string }>(
      `insert into powerup_purchases (event_id, bidder_id, powerup_code, quantity, unit_price_cents, total_cents, method, reference, received_by_admin_id, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,'online_card',$7,null,$8) returning id`,
      [o.event_id, o.bidder_id, o.powerup_code, o.quantity, o.unit_price_cents, o.amount_cents, p.paymentId, `square:${p.paymentId}`],
      c,
    )
    await c.query("update powerup_online_orders set status = 'paid', square_payment_id = $2, purchase_id = $3, paid_at = now() where id = $1", [o.id, p.paymentId, purchase!.id])
    await audit({ eventId: o.event_id, actorType: 'system', action: 'powerup.purchased_online', entityType: 'bidder', entityId: o.bidder_id, details: { code: o.powerup_code, quantity: o.quantity, amount: formatCents(o.amount_cents), squarePaymentId: p.paymentId } }, c)
    await notify(c, { t: 'bidder', id: o.bidder_id })
    return { credited: o.quantity }
  })
}

/** Belt and braces: ask Square about this guest's recent unfinished Power-Up orders (covers a slow or missing webhook). */
export async function reconcilePowerUps(bidderId: string) {
  if (!squareReady()) return 0
  const open = await query<{ square_order_id: string }>(
    `select square_order_id from powerup_online_orders where bidder_id = $1 and status = 'created' and square_order_id is not null and created_at > now() - interval '12 hours'`,
    [bidderId],
  ).catch(() => [])
  let n = 0
  for (const o of open) {
    try {
      const order = await getOrder(o.square_order_id)
      if (!order.paymentId) continue
      const pay = await getPayment(order.paymentId) // trust the payment's own status
      if (pay.status === 'COMPLETED' && pay.currency === 'USD' && pay.amountCents > 0) {
        const r = await applyPowerUpPaid({ orderId: o.square_order_id, paymentId: order.paymentId, amountCents: pay.amountCents })
        if ('credited' in r) n++
      }
    } catch {
      // Square unreachable: leave it for the webhook / the next page load.
    }
  }
  return n
}
