import { beforeEach, describe, expect, it } from 'vitest'
import { listItems } from '@/lib/queries'
import { makeEvent, makeItem, resetDb } from './helpers'

let ev: { id: string }
beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
})

describe('items that are still open come first', () => {
  it('puts open items at the top, finished ones at the bottom, and keeps number order inside each group', async () => {
    await makeItem(ev.id, { num: 1, title: 'Finished A', status: 'finalized' })
    await makeItem(ev.id, { num: 2, title: 'Open B' })
    await makeItem(ev.id, { num: 3, title: 'Finished C', status: 'closed' })
    await makeItem(ev.id, { num: 4, title: 'Open D' })
    await makeItem(ev.id, { num: 5, title: 'Finished E', status: 'finalized' })
    await makeItem(ev.id, { num: 6, title: 'Open F' })

    expect((await listItems(ev.id, { kind: 'silent' })).map((i) => i.item_number)).toEqual([1, 2, 3, 4, 5, 6]) // default order is unchanged
    expect((await listItems(ev.id, { kind: 'silent', openFirst: true })).map((i) => i.item_number)).toEqual([2, 4, 6, 1, 3, 5])
  })
})
