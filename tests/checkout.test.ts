import { beforeEach, describe, expect, it } from 'vitest'
import { one, query } from '@/lib/db'
import { closeSilentItem, finalizeLiveItem, placeSilentBid, recordPaddleBid, reopenItem, setLiveRunState, startLiveItem } from '@/lib/bidding'
import { bidderPayments, paymentStatus, recordPayment, releaseItem, totals, unreleaseItem, voidPayment, wonItems } from '@/lib/checkout'
import { expectError, key, makeAdmin, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

let ev: { id: string }
let vol: { id: string }
let admin: { id: string }
let winner: { id: string; bidder_number: number }

/** Winner takes: item A (silent) $300, item B (silent) $450, item C (live) $1,250 = $2,000 total. */
async function setup() {
  await resetDb()
  ev = await makeEvent()
  admin = (await makeAdmin('admin'))!
  vol = (await makeAdmin('volunteer'))!
  ;[winner] = await makeBidders(ev.id, 1)
  const a = await makeItem(ev.id, { start: 5000, num: 1 })
  const b = await makeItem(ev.id, { start: 5000, num: 2 })
  for (const [it, amt] of [[a, 30000], [b, 45000]] as const) {
    await placeSilentBid({ bidderId: winner.id, itemId: it.id, amountCents: amt, expectedCurrentCents: null, idempotencyKey: key() })
    await closeSilentItem(it.id, admin.id)
  }
  const c = await makeItem(ev.id, { kind: 'live', start: 10000, num: 101 })
  await startLiveItem(c.id, admin.id)
  await recordPaddleBid({ itemId: c.id, paddleNumber: winner.bidder_number, amountCents: 125000, adminId: admin.id, idempotencyKey: key() })
  await setLiveRunState(c.id, 'close', admin.id, true)
  await finalizeLiveItem(c.id, admin.id, true)
  return { a, b, c }
}

const pay = (amountCents: number, method: 'cash' | 'check' | 'card_terminal' = 'cash', idempotencyKey = key(), adminId = vol.id) =>
  recordPayment({ bidderId: winner.id, method, amountCents, adminId, idempotencyKey })

beforeEach(async () => {
  await setup()
})

describe('checkout totals', () => {
  it('lists every won item (silent + live) with the exact amount owed', async () => {
    const items = await wonItems(winner.id)
    expect(items.map((i) => [i.item_number, i.amount_cents, i.paid_cents, i.collection_status])).toEqual([
      [1, 30000, 0, 'pending'],
      [2, 45000, 0, 'pending'],
      [101, 125000, 0, 'pending'],
    ])
    const t = totals(items)
    expect(t).toEqual({ owedCents: 200000, paidCents: 0, balanceCents: 200000 })
    expect(paymentStatus(t)).toBe('unpaid')
  })
})

describe('payments', () => {
  it('supports partial payments, allocated oldest item first, with exact balances', async () => {
    await pay(40000, 'cash') // $400: item 1 ($300) + $100 toward item 2
    let items = await wonItems(winner.id)
    expect(items.map((i) => i.balance_cents)).toEqual([0, 35000, 125000])
    let t = totals(items)
    expect([t.paidCents, t.balanceCents, paymentStatus(t)]).toEqual([40000, 160000, 'partial'])
    await pay(60000, 'check') // + $600
    items = await wonItems(winner.id)
    expect(items.map((i) => i.balance_cents)).toEqual([0, 0, 100000])
    await pay(100000, 'card_terminal')
    t = totals(await wonItems(winner.id))
    expect([t.paidCents, t.balanceCents, paymentStatus(t)]).toEqual([200000, 0, 'paid'])
    const allocSum = await one<{ s: number }>('select sum(amount_cents)::int s from payment_allocations')
    expect(allocSum!.s).toBe(200000)
  })

  it('refuses overpayment and invalid input', async () => {
    const e = await expectError(pay(200001), 'OVERPAYMENT')
    expect(e.data.balanceCents).toBe(200000)
    await expectError(pay(0), 'INVALID_AMOUNT')
    await expectError(pay(-5), 'INVALID_AMOUNT')
    await expectError(pay(1.5), 'INVALID_AMOUNT')
    await expectError(pay(100, 'bitcoin' as any), 'INVALID_METHOD')
  })

  it('a double-submitted payment (same key) is recorded once', async () => {
    const k = key()
    const rs = await Promise.all([pay(50000, 'cash', k), pay(50000, 'cash', k), pay(50000, 'cash', k)])
    expect(rs.filter((r) => !r.replay)).toHaveLength(1)
    expect(totals(await wonItems(winner.id)).paidCents).toBe(50000)
  })

  it('two volunteers racing cannot overpay the balance', async () => {
    const results = await Promise.allSettled([pay(120000, 'cash'), pay(120000, 'check'), pay(120000, 'card_terminal')])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const t = totals(await wonItems(winner.id))
    expect(t.paidCents).toBe(120000)
    expect(t.balanceCents).toBe(80000)
  })

  it('a correction voids the payment (history kept, reason + audit) and restores the balance', async () => {
    const p = await pay(100000, 'cash')
    await expectError(voidPayment(p.paymentId, admin.id, ' '), 'REASON_REQUIRED')
    await voidPayment(p.paymentId, admin.id, 'Counted wrong — only $400 was in the envelope')
    await expectError(voidPayment(p.paymentId, admin.id, 'again'), 'ALREADY_VOIDED')
    expect(totals(await wonItems(winner.id)).balanceCents).toBe(200000)
    const hist = await bidderPayments(winner.id)
    expect(hist).toHaveLength(1)
    expect(hist[0].voided_at).not.toBeNull()
    expect(hist[0].void_reason).toMatch(/Counted wrong/)
    expect((await one<any>(`select details from audit_logs where action = 'payment.voided'`)).details.amountCents).toBe(100000)
    await pay(40000, 'cash') // corrected amount
    expect(totals(await wonItems(winner.id)).balanceCents).toBe(160000)
  })

  it('payment rows are never deleted by the app (void only)', async () => {
    const p = await pay(1000)
    await voidPayment(p.paymentId, admin.id, 'oops')
    expect((await query('select * from payments')).length).toBe(1)
  })
})

describe('item release', () => {
  it('blocks release until paid; volunteers cannot override; admins can with a recorded reason', async () => {
    const items = await wonItems(winner.id)
    const [i1, i2] = items
    await expectError(releaseItem({ winningResultId: i1.winning_result_id, adminId: vol.id, isAdmin: false }), 'UNPAID')
    await pay(30000)
    await releaseItem({ winningResultId: i1.winning_result_id, adminId: vol.id, isAdmin: false })
    await expectError(releaseItem({ winningResultId: i1.winning_result_id, adminId: vol.id, isAdmin: false }), 'ALREADY_RELEASED')
    await expectError(releaseItem({ winningResultId: i2.winning_result_id, adminId: admin.id, isAdmin: true }), 'REASON_REQUIRED')
    await releaseItem({ winningResultId: i2.winning_result_id, adminId: admin.id, isAdmin: true, exceptionReason: 'Pastor approved — pays Sunday' })
    const after = await wonItems(winner.id)
    expect(after.map((i) => [i.collection_status, i.exception])).toEqual([['released', false], ['released', true], ['pending', false]])
    expect(after[1].exception_reason).toMatch(/Pastor/)
    expect(await one(`select 1 from audit_logs where action = 'item.released_exception'`)).toBeTruthy()
  })

  it('voiding a payment reports items already released on it', async () => {
    const p = await pay(30000)
    const [i1] = await wonItems(winner.id)
    await releaseItem({ winningResultId: i1.winning_result_id, adminId: vol.id, isAdmin: false })
    const r = await voidPayment(p.paymentId, admin.id, 'check bounced')
    expect(r.releasedItemNumbers).toEqual([1])
    await unreleaseItem(i1.winning_result_id, admin.id, 'check bounced')
    expect((await wonItems(winner.id))[0].collection_status).toBe('pending')
  })

  it('an item with recorded payments cannot be reopened until the payments are voided', async () => {
    const [i1] = await wonItems(winner.id)
    const p = await pay(30000)
    await expectError(reopenItem(i1.item_id, admin.id, 'mistake', new Date(Date.now() + 60000)), 'HAS_PAYMENTS')
    await voidPayment(p.paymentId, admin.id, 'refund')
    await reopenItem(i1.item_id, admin.id, 'mistake', new Date(Date.now() + 60000))
    expect((await wonItems(winner.id)).map((i) => i.item_number)).toEqual([2, 101]) // result removed from what is owed
  })
})
