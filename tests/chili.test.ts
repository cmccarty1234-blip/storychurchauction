import { beforeEach, describe, expect, it } from 'vitest'
import { one, query } from '@/lib/db'
import { castChiliVote, chiliBoard, chiliForCheckout, markChiliPaid, myChili, setChiliState, toggleChiliHeart, voidChiliVotes } from '@/lib/chili'
import { gameState } from '@/lib/game-state'
import { expectError, key, makeAdmin, makeBidders, makeEvent, resetDb } from './helpers'

let ev: { id: string }
let admin: { id: string }
let a: string
let b: string
beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
  admin = await makeAdmin()
  await query(`insert into chili_entries (event_id, entry_number, name, cook) values ($1, 1, 'Dee''s Chili', 'Dee'), ($1, 2, 'Lisa''s Dragon Chili', 'Lisa')`, [ev.id])
  const e = await query<{ id: string }>('select id from chili_entries order by entry_number')
  a = e[0].id
  b = e[1].id
})

describe('chili cook-off', () => {
  it('only takes votes while voting is open', async () => {
    const [g] = await makeBidders(ev.id, 1)
    await expectError(castChiliVote({ bidderId: g.id, entryId: a, votes: 1, idempotencyKey: key() }), 'CHILI_CLOSED')
    await setChiliState(ev.id, 'open', admin.id)
    await castChiliVote({ bidderId: g.id, entryId: a, votes: 3, idempotencyKey: key() })
    await setChiliState(ev.id, 'closed', admin.id)
    await expectError(castChiliVote({ bidderId: g.id, entryId: a, votes: 1, idempotencyKey: key() }), 'CHILI_CLOSED')
  })

  it('$1 = 1 vote: ranks by dollars, and a double tap with the same key counts once', async () => {
    const [g1, g2] = await makeBidders(ev.id, 2)
    await setChiliState(ev.id, 'open', admin.id)
    const k = key()
    await castChiliVote({ bidderId: g1.id, entryId: a, votes: 2, idempotencyKey: k })
    expect((await castChiliVote({ bidderId: g1.id, entryId: a, votes: 2, idempotencyKey: k })).replay).toBe(true)
    await castChiliVote({ bidderId: g2.id, entryId: b, votes: 5, idempotencyKey: key() })
    await castChiliVote({ bidderId: g1.id, entryId: b, votes: 1, idempotencyKey: key() })
    const board = await chiliBoard(ev.id)
    expect(board.entries.map((e) => [e.number, e.cents, e.votes, e.voters])).toEqual([[2, 600, 6, 2], [1, 200, 2, 1]])
    expect(board.totalCents).toBe(800)
    expect((await gameState(ev.id)).totals.chiliCents).toBe(800)
  })

  it('rejects silly vote counts and unknown chilis', async () => {
    const [g] = await makeBidders(ev.id, 1)
    await setChiliState(ev.id, 'open', admin.id)
    await expectError(castChiliVote({ bidderId: g.id, entryId: a, votes: 0, idempotencyKey: key() }), 'INVALID_AMOUNT')
    await expectError(castChiliVote({ bidderId: g.id, entryId: a, votes: 1001, idempotencyKey: key() }), 'INVALID_AMOUNT')
    await expectError(castChiliVote({ bidderId: g.id, entryId: '00000000-0000-0000-0000-000000000000', votes: 1, idempotencyKey: key() }), 'NOT_FOUND')
  })

  it('what a guest owes shows at checkout; paying marks it paid once; a mistaken unpaid vote can be removed', async () => {
    const [g] = await makeBidders(ev.id, 1)
    await setChiliState(ev.id, 'open', admin.id)
    await castChiliVote({ bidderId: g.id, entryId: a, votes: 4, idempotencyKey: key() })
    await castChiliVote({ bidderId: g.id, entryId: b, votes: 1, idempotencyKey: key() })
    expect((await myChili(g.id)).owedCents).toBe(500)
    expect((await chiliForCheckout(g.id)).map((r) => [r.entry_number, r.owed])).toEqual([[1, 400], [2, 100]])

    expect(await voidChiliVotes({ bidderId: g.id, entryId: b, adminId: admin.id, reason: 'wrong chili' })).toEqual({ cents: 100 })
    expect((await chiliBoard(ev.id)).totalCents).toBe(400)

    expect(await markChiliPaid({ bidderId: g.id, method: 'cash', adminId: admin.id })).toEqual({ cents: 400 })
    await expectError(markChiliPaid({ bidderId: g.id, method: 'cash', adminId: admin.id }), 'NOTHING_DUE')
    const m = await myChili(g.id)
    expect([m.owedCents, m.paidCents]).toEqual([0, 400])
    // paid votes can't be removed at the desk
    await expectError(voidChiliVotes({ bidderId: g.id, entryId: a, adminId: admin.id, reason: 'x' }), 'NOTHING_TO_REMOVE')
  })

  it('does not touch the item balance (chili money is kept separate)', async () => {
    const [g] = await makeBidders(ev.id, 1)
    await setChiliState(ev.id, 'open', admin.id)
    await castChiliVote({ bidderId: g.id, entryId: a, votes: 2, idempotencyKey: key() })
    expect((await one<{ n: number }>('select count(*)::int n from payments'))!.n).toBe(0)
    await markChiliPaid({ bidderId: g.id, method: 'check', adminId: admin.id })
    expect((await one<{ n: number }>('select count(*)::int n from payments'))!.n).toBe(0)
  })
})

describe('chili hearts', () => {
  it('a heart is free, one per guest per chili, and tapping again takes it back', async () => {
    const [g1, g2] = await makeBidders(ev.id, 2)
    await setChiliState(ev.id, 'open', admin.id)
    expect(await toggleChiliHeart({ bidderId: g1.id, entryId: a })).toEqual({ hearted: true })
    await toggleChiliHeart({ bidderId: g2.id, entryId: a })
    await toggleChiliHeart({ bidderId: g2.id, entryId: b })
    expect((await chiliBoard(ev.id)).entries.map((e) => [e.number, e.hearts])).toEqual([[1, 2], [2, 1]])
    expect((await myChili(g1.id)).hearts).toEqual([a])
    expect(await toggleChiliHeart({ bidderId: g1.id, entryId: a })).toEqual({ hearted: false })
    expect((await chiliBoard(ev.id)).entries.find((e) => e.number === 1)!.hearts).toBe(1)
  })

  it('never changes votes, money, ranking or what a guest owes', async () => {
    const [g] = await makeBidders(ev.id, 1)
    await setChiliState(ev.id, 'open', admin.id)
    await castChiliVote({ bidderId: g.id, entryId: a, votes: 2, idempotencyKey: key() })
    const before = await chiliBoard(ev.id)
    await toggleChiliHeart({ bidderId: g.id, entryId: b })
    await toggleChiliHeart({ bidderId: g.id, entryId: b }) // on, then off
    await toggleChiliHeart({ bidderId: g.id, entryId: b }) // and on again
    const after = await chiliBoard(ev.id)
    expect(after.totalCents).toBe(before.totalCents)
    expect(after.entries.map((e) => [e.number, e.cents, e.votes, e.voters])).toEqual(before.entries.map((e) => [e.number, e.cents, e.votes, e.voters]))
    expect((await myChili(g.id)).owedCents).toBe(200)
    expect(await chiliForCheckout(g.id)).toHaveLength(1)
  })

  it('works while voting is open or closed, but not while the cook-off is hidden, and only for real chilis', async () => {
    const [g] = await makeBidders(ev.id, 1)
    await expectError(toggleChiliHeart({ bidderId: g.id, entryId: a }), 'CHILI_CLOSED') // hidden
    await setChiliState(ev.id, 'closed', admin.id)
    expect(await toggleChiliHeart({ bidderId: g.id, entryId: a })).toEqual({ hearted: true })
    await expectError(toggleChiliHeart({ bidderId: g.id, entryId: '00000000-0000-0000-0000-000000000000' }), 'NOT_FOUND')
    const s = (await gameState(ev.id)).chili
    expect(s.entries.find((e) => e.number === 1)!.hearts).toBe(1) // the projector gets the count too
  })
})
