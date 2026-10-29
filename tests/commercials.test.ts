import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '@/lib/db'
import { gameState } from '@/lib/game-state'
import { COMMERCIALS } from '@/lib/commercials'
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

    await query(`update events set commercial_started_at = now() - interval '${clip.seconds + 5} seconds' where id = $1`, [ev.id])
    expect((await gameState(ev.id)).commercial).toBeNull()
  })

  it('works without an item, and ignores a key that is no longer in the list', async () => {
    await query(`update events set commercial_key = $2, commercial_started_at = now() where id = $1`, [ev.id, COMMERCIALS[0].key])
    expect((await gameState(ev.id)).commercial!.item).toBeNull()
    await query(`update events set commercial_key = 'gone' where id = $1`, [ev.id])
    expect((await gameState(ev.id)).commercial).toBeNull()
  })
})
