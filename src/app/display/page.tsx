import { Projector } from '@/components/projector'

export const metadata = { title: 'Projector display' }
export const dynamic = 'force-dynamic'

/** Public, read-only, full-screen audience display. Shows bidder numbers only — no names or contact details. */
export default function DisplayPage() {
  return <Projector />
}
