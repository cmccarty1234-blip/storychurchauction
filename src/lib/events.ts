import { one } from './db'
import { AppError } from './errors'

export type EventRow = {
  id: string
  name: string
  event_date: string | null
  timezone: string
  silent_start_at: Date | null
  silent_close_at: Date | null
  default_increment_cents: number
  pickup_instructions: string
  contact_info: string
  next_bidder_number: number
  is_demo: boolean
  game_mode: boolean
  auto_accept_live: boolean
  provisional_silent: boolean
  provisional_seconds: number
}

/** The app serves a single active event: the most recently created one. */
export async function getEvent(): Promise<EventRow> {
  const ev = await one<EventRow>('select * from events order by created_at desc limit 1')
  if (!ev) throw new AppError('NO_EVENT', 'No event has been set up yet. Run the seed script or create one in the admin settings.', 500)
  return ev
}
