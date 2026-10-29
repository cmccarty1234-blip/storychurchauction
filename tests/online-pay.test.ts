import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { one, query } from '@/lib/db'
import { finalizeDueSilentItems, placeSilentBid } from '@/lib/bidding'
import { recordPayment, totals, wonItems } from '@/lib/checkout'
import { applyCompleted, handleSquareEvent, reconcileBidder, startOnlinePayment } from '@/lib/online-pay'
import { verifyWebhook } from '@/lib/square'
import { expectError, key, makeAdmin, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

let ev: { id: string }
let admin: { id: string }
const calls: { url: string; init?: RequestInit }[] = []
let orderState = { state: 'OPEN', payment_id: 'pay_1', amount: 10000, paymentStatus: 'APPROVED' }

beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
  admin = await makeAdmin()
  process.env.SQUARE_ACCESS_TOKEN = 'test-token'
  process.env.SQUARE_LOCATION_ID = 'LOC1'
  process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = 'sig-key'
  process.env.SQUARE_ENV = 'sandbox'
  await query('update events set online_payments = true where id = $1', [ev.id])
  calls.length = 0
  orderState = { state: 'OPEN', payment_id: 'pay_1', amount: 10000, paymentStatus: 'APPROVED' }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('/v2/online-checkout/payment-links')) return new Response(JSON.stringify({ payment_link: { id: 'pl1', url: 'https://square.test/pay/1', order_id: 'ord1' } }), { status: 200 })
      if (url.includes('/v2/orders/')) return new Response(JSON.stringify({ order: { state: orderState.state, tenders: orderState.paymentStatus !== 'NONE' ? [{ payment_id: orderState.payment_id, amount_money: { amount: orderState.amount, currency: 'USD' } }] : [] } }), { status: 200 })
      if (url.includes('/v2/payments/')) return new Response(JSON.stringify({ payment: { status: orderState.paymentStatus, amount_money: { amount: orderState.amount, currency: 'USD' }, receipt_number: 'RCPT1' } }), { status: 200 })
      return new Response('{}', { status: 404 })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

/** A guest who has won one $100 silent item (finalized). */
async function winner() {
  const [b] = await makeBidders(ev.id, 1)
  const it = await makeItem(ev.id, { num: 1, start: 10000 })
  await placeSilentBid({ bidderId: b.id, itemId: it.id, amountCents: 10000, expectedCurrentCents: null, idempotencyKey: key() })
  await query(`update auction_items set closes_at = now() - interval '1 second' where id = $1`, [it.id])
  await finalizeDueSilentItems()
  return b
}
const balance = async (bidderId: string) => totals(await wonItems(bidderId)).balanceCents
const completedEvent = (amount = 10000, paymentId = 'pay_1', status = 'COMPLETED') => ({ type: 'payment.updated', data: { object: { payment: { id: paymentId, status, order_id: 'ord1', amount_money: { amount, currency: 'USD' }, receipt_number: 'ABCD' } } } })

describe('starting an online payment', () => {
  it('asks Square for a link for the EXACT balance the server computed', async () => {
    const b = await winner()
    const r = await startOnlinePayment(b.id)
    expect(r).toEqual({ url: 'https://square.test/pay/1', amountCents: 10000 })
    const sent = JSON.parse(String(calls[0].init!.body))
    expect(sent.quick_pay.price_money).toEqual({ amount: 10000, currency: 'USD' })
    expect(sent.quick_pay.location_id).toBe('LOC1')
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
    expect(await balance(b.id)).toBe(10000) // nothing is credited just for starting
  })

  it('refuses when switched off, when nothing is owed, and records a failure when Square is down', async () => {
    const b = await winner()
    await query('update events set online_payments = false')
    await expectError(startOnlinePayment(b.id), 'PAYMENTS_OFF')
    await query('update events set online_payments = true')
    const [other] = await makeBidders(ev.id, 1)
    await expectError(startOnlinePayment(other.id), 'NOTHING_DUE')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expectError(startOnlinePayment(b.id), 'PAYMENT_PROVIDER')
    expect((await one<{ status: string }>('select status from online_payments order by created_at desc limit 1'))!.status).toBe('failed')
    expect(await balance(b.id)).toBe(10000)
  })
})

describe('webhook signature', () => {
  it('accepts only a message signed with our key for our URL', () => {
    const body = JSON.stringify({ hello: 'world' })
    const url = 'https://auction.test/api/webhooks/square'
    const good = createHmac('sha256', 'sig-key').update(url + body).digest('base64')
    expect(verifyWebhook(body, good, url)).toBe(true)
    expect(verifyWebhook(body + ' ', good, url)).toBe(false)
    expect(verifyWebhook(body, good, 'https://evil.test/api/webhooks/square')).toBe(false)
    expect(verifyWebhook(body, null, url)).toBe(false)
    expect(verifyWebhook(body, createHmac('sha256', 'other').update(url + body).digest('base64'), url)).toBe(false)
  })
})

describe('applying a confirmed payment', () => {
  it('credits the balance only when Square says COMPLETED, as a system payment with the receipt as reference', async () => {
    const b = await winner()
    await startOnlinePayment(b.id)
    await handleSquareEvent(completedEvent(10000, 'pay_1', 'APPROVED')) // not completed yet
    expect(await balance(b.id)).toBe(10000)
    const r = await handleSquareEvent(completedEvent())
    expect(r).toMatchObject({ applied: 10000, refundDue: 0 })
    expect(await balance(b.id)).toBe(0)
    const p = (await query<any>('select * from payments'))[0]
    expect(p).toMatchObject({ method: 'online_card', amount_cents: 10000, reference: 'ABCD', received_by_admin_id: null })
    expect((await one<{ status: string }>('select status from online_payments'))!.status).toBe('paid')
  })

  it('never double-counts: repeated and simultaneous deliveries of the same payment apply once', async () => {
    const b = await winner()
    await startOnlinePayment(b.id)
    await Promise.all([handleSquareEvent(completedEvent()), handleSquareEvent(completedEvent()), handleSquareEvent(completedEvent())])
    await handleSquareEvent(completedEvent())
    expect(await query('select 1 from payments')).toHaveLength(1)
    expect(await balance(b.id)).toBe(0)
  })

  it('ignores payments for orders we never created', async () => {
    const b = await winner()
    expect(await applyCompleted({ orderId: 'someone-elses', paymentId: 'x', amountCents: 500 })).toEqual({ ignored: true })
    expect(await balance(b.id)).toBe(10000)
  })

  it('cannot overpay: if they also paid at the desk meanwhile, only the balance is applied and the rest is flagged for refund', async () => {
    const b = await winner()
    await startOnlinePayment(b.id)
    await recordPayment({ bidderId: b.id, method: 'cash', amountCents: 4000, adminId: admin.id, idempotencyKey: key() })
    const r = await handleSquareEvent(completedEvent())
    expect(r).toMatchObject({ applied: 6000, refundDue: 4000 })
    expect(await balance(b.id)).toBe(0)
    expect((await one<any>('select status, refund_due_cents from online_payments'))).toMatchObject({ status: 'paid_refund_due', refund_due_cents: 4000 })
  })

  it('a voided online payment reopens the balance (staff refunds in Square)', async () => {
    const b = await winner()
    await startOnlinePayment(b.id)
    await handleSquareEvent(completedEvent())
    const { voidPayment } = await import('@/lib/checkout')
    const id = (await one<{ id: string }>('select id from payments'))!.id
    await voidPayment(id, admin.id, 'refunded in Square')
    expect(await balance(b.id)).toBe(10000)
  })
})

describe('reconciliation (slow or missing webhook)', () => {
  it('picks up a completed order when the guest returns, without any webhook', async () => {
    const b = await winner()
    await startOnlinePayment(b.id)
    orderState.paymentStatus = 'NONE'
    expect(await reconcileBidder(b.id)).toBe(0) // nothing paid at Square yet
    orderState.paymentStatus = 'APPROVED'
    expect(await reconcileBidder(b.id)).toBe(0) // authorised but not completed: not credited
    expect(await balance(b.id)).toBe(10000)
    orderState = { state: 'OPEN', payment_id: 'pay_9', amount: 10000, paymentStatus: 'COMPLETED' } // note: the order itself still reads OPEN
    expect(await reconcileBidder(b.id)).toBe(1)
    expect(await balance(b.id)).toBe(0)
    expect(await reconcileBidder(b.id)).toBe(0) // and never twice
    expect(await query('select 1 from payments')).toHaveLength(1)
  })

  it('shrugs off Square being unreachable', async () => {
    const b = await winner()
    await startOnlinePayment(b.id)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await reconcileBidder(b.id)).toBe(0)
    expect(await balance(b.id)).toBe(10000)
  })
})
