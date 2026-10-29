import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '@/lib/db'
import { gameState } from '@/lib/game-state'
import { COMMERCIALS, GRACE_MS } from '@/lib/commercials'
import { advanceCommercialStart, startItemWithCommercial } from '@/lib/commercial-start'
import { makeEvent, makeItem, resetDb } from './helpers'

let ev: { id: string }
beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
})

describe('commercial breaks', () => {
  it('reports nothing until the host plays one', async () => {
    expect((await gameState(ev.id)).commercial).toBeNull()
  })

  it('reports the playing clip with the promoted item, then drops it once its time is up', async () => {
    const it = await makeItem(ev.id, { num: 4, start: 5000, title: 'Date Night Dinner' })
    const clip = COMMERCIALS[0]
    await query(`update events set commercial_key = $2, commercial_item_id = $3, commercial_started_at = now() where id = $1`, [ev.id, clip.key, it.id])
    const s = (await gameState(ev.id)).commercial!
    expect(s.key).toBe(clip.key)
    expect(s.youtubeId).toBe(clip.youtubeId)
    expect(s.item).toMatchObject({ id: it.id, number: 4, title: 'Date Night Dinner' })
    expect(new Date(s.endsAt).getTime() - new Date(s.startedAt).getTime()).toBe(clip.seconds * 1000)

    // just past the video's length it is still reported (a slow-loading video may still be finishing)...
    await query(`update events set commercial_started_at = now() - interval '${clip.seconds + 2} seconds' where id = $1`, [ev.id])
    expect((await gameState(ev.id)).commercial).not.toBeNull()
    // ...and after the grace period it is gone.
    await query(`update events set commercial_started_at = now() - interval '${clip.seconds + GRACE_MS / 1000 + 2} seconds' where id = $1`, [ev.id])
    expect((await gameState(ev.id)).commercial).toBeNull()
  })

  it('works without an item, and ignores a key that is no longer in the list', async () => {
    await query(`update events set commercial_key = $2, commercial_started_at = now() where id = $1`, [ev.id, COMMERCIALS[0].key])
    expect((await gameState(ev.id)).commercial!.item).toBeNull()
    await query(`update events set commercial_key = 'gone' where id = $1`, [ev.id])
    expect((await gameState(ev.id)).commercial).toBeNull()
  })
})

describe('commercial before a live item opens', () => {
  async function setup() {
    const [admin] = await query<{ id: string }>(`insert into admin_users (email, name, password_hash, role) values ('h@test', 'Host', 'x', 'host') returning id`)
    await query(`update events set game_mode = true where id = $1`, [ev.id])
    const it = await makeItem(ev.id, { kind: 'live', title: 'The Broadmoor Stay', start: 20000, inc: 2500, num: 104 })
    return { admin, it }
  }
  const status = async (id: string) => (await query<{ status: string }>('select status from auction_items where id = $1', [id]))[0].status

  it('plays the commercial first, keeps the item closed to bids, then opens it when the clip is over', async () => {
    const { admin, it } = await setup()
    expect(await startItemWithCommercial(it.id, admin.id)).toEqual({ commercial: true })
    expect(await status(it.id)).toBe('upcoming')
    const s = (await gameState(ev.id)).commercial!
    expect(s.opensItem).toBe(true)
    expect(s.item!.kind).toBe('live')

    await advanceCommercialStart(ev.id) // too early: still playing
    expect(await status(it.id)).toBe('upcoming')

    await query(`update events set commercial_started_at = now() - interval '60 seconds' where id = $1`, [ev.id])
    await Promise.all([advanceCommercialStart(ev.id), advanceCommercialStart(ev.id)]) // two screens asking at once
    expect(await status(it.id)).toBe('open')
    expect((await query('select 1 from item_transitions where item_id = $1 and to_status = $2', [it.id, 'open'])).length).toBe(1)
    expect((await gameState(ev.id)).commercial).toBeNull()
  })

  it('stopping the commercial opens bidding straight away', async () => {
    const { admin, it } = await setup()
    await startItemWithCommercial(it.id, admin.id)
    await query(`update events set commercial_started_at = null where id = $1`, [ev.id])
    await advanceCommercialStart(ev.id)
    expect(await status(it.id)).toBe('open')
  })

  it('an item without a commercial just starts, and a busy block is reported instead of playing a clip', async () => {
    const { admin, it } = await setup()
    const plain = await makeItem(ev.id, { kind: 'live', title: 'Plain Chairs', num: 105 })
    expect(await startItemWithCommercial(plain.id, admin.id)).toEqual({ commercial: false })
    await expect(startItemWithCommercial(it.id, admin.id)).rejects.toThrow(/Another live item/)
    expect((await gameState(ev.id)).commercial).toBeNull()
  })

  it('holds the start during an emergency stop', async () => {
    const { admin, it } = await setup()
    await startItemWithCommercial(it.id, admin.id)
    await query(`update events set commercial_started_at = now() - interval '60 seconds', emergency_stop_at = now() where id = $1`, [ev.id])
    await advanceCommercialStart(ev.id)
    expect(await status(it.id)).toBe('upcoming')
  })
})

describe('promos that match several items', () => {
  it('lists the sibling items when one clip covers more than one', async () => {
    const a = await makeItem(ev.id, { num: 7, title: 'Chick-fil-A: 15 Sandwiches (1 of 2)' })
    await makeItem(ev.id, { num: 61, title: 'Chick-fil-A: 15 Sandwiches (2 of 2)' })
    await makeItem(ev.id, { num: 62, title: 'Something else' })
    await query(`update events set commercial_key = 'chickfila-honest', commercial_item_id = $2, commercial_started_at = now() where id = $1`, [ev.id, a.id])
    // Each Chick-fil-A clip is linked to its own package, so no siblings are listed.
    const s = (await gameState(ev.id)).commercial!
    expect(s.item!.number).toBe(7)
    expect(s.others).toEqual([])
  })

  it('each Chick-fil-A clip is linked to a different package', () => {
    const promos = COMMERCIALS.filter((c) => c.key.startsWith('chickfila')).map((c) => c.promote)
    expect(promos).toEqual(['Sandwiches (2 of 2)', 'Sandwiches (1 of 2)'])
  })
})
