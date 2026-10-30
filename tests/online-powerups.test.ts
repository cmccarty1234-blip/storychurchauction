import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { one, query } from '@/lib/db'
import { inventory, powerupRevenue } from '@/lib/powerups'
import { handleSquareEvent } from '@/lib/online-pay'
import { onlinePowerupsStatus, reconcilePowerUps, startPowerUpPayment } from '@/lib/online-powerups'
import { expectError, makeBidders, makeEvent, resetDb } from './helpers'

let ev: { id: string }
const calls: { url: string; init?: RequestInit }[] = []
let paymentStatus = 'COMPLETED'

beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
  process.env.SQUARE_ACCESS_TOKEN = 'test-token'
  process.env.SQUARE_LOCATION_ID = 'LOC1'
  process.env.SQUARE_ENV = 'sandbox'
  await query(`update powerup_defs set enabled = (code not in ('block','back_in')), price_cents = case code when 'resurrection' then 3000 when 'final_call' then 1500 when 'knockout' then 3000 else price_cents end, max_per_bidder = null`)
  await query(`update events set online_payments = true, powerups_online_from = now() - interval '1 minute' where id = $1`, [ev.id])
  calls.length = 0
  paymentStatus = 'COMPLETED'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('/v2/online-checkout/payment-links')) return new Response(JSON.stringify({ payment_link: { id: 'pl1', url: 'https://square.test/pay/1', order_id: 'ordPU1' } }), { status: 200 })
      if (url.includes('/v2/orders/')) return new Response(JSON.stringify({ order: { state: 'OPEN', tenders: [{ payment_id: 'payPU1', amount_money: { amount: 6000, currency: 'USD' } }] } }), { status: 200 })
      if (url.includes('/v2/payments/')) return new Response(JSON.stringify({ payment: { status: paymentStatus, amount_money: { amount: 6000, currency: 'USD' }, receipt_number: 'R1' } }), { status: 200 })
      return new Response('{}', { status: 404 })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

const done = (amount = 6000, paymentId = 'payPU1', orderId = 'ordPU1') => ({ type: 'payment.updated', data: { object: { payment: { id: paymentId, status: 'COMPLETED', order_id: orderId, amount_money: { amount, currency: 'USD' } } } } })
const have = async (bidderId: string, code = 'resurrection') => (await inventory(bidderId)).find((r) => r.code === code)!.available

describe('online Power-Ups are not available until the host-set time', () => {
  it('is off when no time is set, closed before the time, and open after it', async () => {
    const [g] = await makeBidders(ev.id, 1)
    await query('update events set powerups_online_from = null where id = $1', [ev.id])
    expect(await onlinePowerupsStatus(ev.id)).toMatchObject({ enabled: false, open: false })
    await expectError(startPowerUpPayment({ bidderId: g.id, code: 'resurrection', quantity: 1 }), 'ONLINE_NOT_OPEN')

    await query(`update events set powerups_online_from = now() + interval '5 hours' where id = $1`, [ev.id])
    expect(await onlinePowerupsStatus(ev.id)).toMatchObject({ enabled: true, open: false })
    await expectError(startPowerUpPayment({ bidderId: g.id, code: 'resurrection', quantity: 1 }), 'ONLINE_NOT_OPEN')
    expect(calls).toHaveLength(0) // Square was never contacted
    expect((await one<{ n: number }>('select count(*)::int n from powerup_online_orders'))!.n).toBe(0)

    await query(`update events set powerups_online_from = now() - interval '1 second' where id = $1`, [ev.id])
    expect(await onlinePowerupsStatus(ev.id)).toMatchObject({ enabled: true, open: true })
  })

  it('is off if Square payments are switched off, even after the time', async () => {
    await query('update events set online_payments = false where id = $1', [ev.id])
    expect(await onlinePowerupsStatus(ev.id)).toMatchObject({ enabled: false, open: false })
  })
})

describe('buying a Power-Up online', () => {
  it('prices the order on the server, and credits nothing until Square confirms', async () => {
    const [g] = await makeBidders(ev.id, 1)
    const r = await startPowerUpPayment({ bidderId: g.id, code: 'resurrection', quantity: 2 })
    expect(r).toEqual({ url: 'https://square.test/pay/1', amountCents: 6000 })
    const sent = JSON.parse(String(calls[0].init!.body))
    expect(sent.order.line_items[0].base_price_money).toEqual({ amount: 6000, currency: 'USD' })
    expect(sent.order.line_items[0].name).toMatch(/2 × Resurrection/)
    expect(sent.checkout_options.redirect_url).toMatch(/\/play\?bought=1$/)
    expect(await have(g.id)).toBe(0) // not credited yet
  })

  it('credits exactly once when Square says the payment completed, even if told twice', async () => {
    const [g] = await makeBidders(ev.id, 1)
    await startPowerUpPayment({ bidderId: g.id, code: 'resurrection', quantity: 2 })
    expect(await handleSquareEvent(done())).toEqual({ credited: 2 })
    expect(await have(g.id)).toBe(2)
    expect(await handleSquareEvent(done())).toEqual({ replay: true })
    expect(await have(g.id)).toBe(2)
    const rev = await powerupRevenue(ev.id)
    expect(rev.onlineCents).toBe(6000)
    expect(rev.totalCents).toBe(6000)
    expect((await one<{ method: string }>('select method from powerup_purchases'))!.method).toBe('online_card')
  })

  it('ignores payments that are not completed, not ours, or in the wrong amount', async () => {
    const [g] = await makeBidders(ev.id, 1)
    await startPowerUpPayment({ bidderId: g.id, code: 'resurrection', quantity: 2 })
    expect(await handleSquareEvent({ ...done(), data: { object: { payment: { ...done().data.object.payment, status: 'APPROVED' } } } })).toEqual({ ignored: true })
    expect(await handleSquareEvent(done(6000, 'payX', 'someOtherOrder'))).toEqual({ ignored: true })
    expect(await have(g.id)).toBe(0)
    expect(await handleSquareEvent(done(100))).toEqual({ mismatch: true }) // paid the wrong amount: a person must look
    expect(await have(g.id)).toBe(0)
    expect((await one<{ status: string }>('select status from powerup_online_orders'))!.status).toBe('amount_mismatch')
  })

  it('credits when the guest comes back and Square says paid, but not while it is still pending', async () => {
    const [g] = await makeBidders(ev.id, 1)
    await startPowerUpPayment({ bidderId: g.id, code: 'resurrection', quantity: 2 })
    paymentStatus = 'APPROVED'
    expect(await reconcilePowerUps(g.id)).toBe(0)
    expect(await have(g.id)).toBe(0)
    paymentStatus = 'COMPLETED'
    expect(await reconcilePowerUps(g.id)).toBe(1)
    expect(await have(g.id)).toBe(2)
    expect(await reconcilePowerUps(g.id)).toBe(0) // already paid: nothing more
    expect(await have(g.id)).toBe(2)
  })

  it('only sells enabled Power-Ups (not pies), within sensible quantities and limits', async () => {
    const [g] = await makeBidders(ev.id, 1)
    await expectError(startPowerUpPayment({ bidderId: g.id, code: 'pie_small', quantity: 1 }), 'NOT_FOUND')
    await expectError(startPowerUpPayment({ bidderId: g.id, code: 'block', quantity: 1 }), 'POWERUP_DISABLED')
    await expectError(startPowerUpPayment({ bidderId: g.id, code: 'resurrection', quantity: 0 }), 'INVALID_REQUEST')
    await expectError(startPowerUpPayment({ bidderId: g.id, code: 'resurrection', quantity: 11 }), 'INVALID_REQUEST')
    await query(`update powerup_defs set max_per_bidder = 1 where code = 'knockout'`)
    await startPowerUpPayment({ bidderId: g.id, code: 'knockout', quantity: 1 }) // allowed: nothing bought yet
    await handleSquareEvent(done(3000))
    await expectError(startPowerUpPayment({ bidderId: g.id, code: 'knockout', quantity: 1 }), 'LIMIT')
  })

  it('marks the order failed (and credits nothing) if Square cannot be reached', async () => {
    const [g] = await makeBidders(ev.id, 1)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(startPowerUpPayment({ bidderId: g.id, code: 'resurrection', quantity: 1 })).rejects.toThrow()
    expect((await one<{ status: string }>('select status from powerup_online_orders'))!.status).toBe('failed')
    expect(await have(g.id)).toBe(0)
  })
})
