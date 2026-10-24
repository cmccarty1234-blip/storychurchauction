'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, Notice } from '@/components/admin-ui'
import { post } from '@/lib/client'
import { parseDollars } from '@/lib/money'

export type EventFormValues = {
  name: string
  eventDate: string
  timezone: string
  silentStart: string
  silentClose: string
  defaultIncrement: string
  pickupInstructions: string
  contactInfo: string
}

export function EventSettingsForm({ initial }: { initial: EventFormValues }) {
  const router = useRouter()
  const [v, setV] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const set = (k: keyof EventFormValues, val: string) => { setV((p) => ({ ...p, [k]: val })); setMsg(null) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const inc = parseDollars(v.defaultIncrement)
    if (inc == null || inc < 100) return setMsg({ kind: 'error', text: 'Default increment must be at least $1.' })
    setBusy(true)
    const res = await post('/api/admin/settings', {
      action: 'event', name: v.name, eventDate: v.eventDate || null, timezone: v.timezone,
      silentStart: v.silentStart || null, silentClose: v.silentClose || null, defaultIncrementCents: inc,
      pickupInstructions: v.pickupInstructions, contactInfo: v.contactInfo,
    })
    setBusy(false)
    if (!res.ok) return setMsg({ kind: 'error', text: res.error.message })
    setMsg({ kind: 'success', text: 'Settings saved. Times are interpreted in the event time zone.' })
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-5 shadow-sm" noValidate>
      <h2 className="text-lg font-bold">Event</h2>
      <Field label="Event name" htmlFor="ev-name"><Input id="ev-name" value={v.name} onChange={(e) => set('name', e.target.value)} /></Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Event date" htmlFor="ev-date"><Input id="ev-date" type="date" value={v.eventDate} onChange={(e) => set('eventDate', e.target.value)} /></Field>
        <Field label="Time zone" htmlFor="ev-tz" hint="All times below use this zone, e.g. America/Denver."><Input id="ev-tz" value={v.timezone} onChange={(e) => set('timezone', e.target.value)} /></Field>
        <Field label="Silent auction opens" htmlFor="ev-start"><Input id="ev-start" type="datetime-local" value={v.silentStart} onChange={(e) => set('silentStart', e.target.value)} /></Field>
        <Field label="Silent auction closes" htmlFor="ev-close" hint="Fixed closing time — no automatic extensions. The server enforces it."><Input id="ev-close" type="datetime-local" value={v.silentClose} onChange={(e) => set('silentClose', e.target.value)} /></Field>
        <Field label="Default bid increment ($)" htmlFor="ev-inc" hint="Pre-filled when creating new items."><Input id="ev-inc" inputMode="decimal" value={v.defaultIncrement} onChange={(e) => set('defaultIncrement', e.target.value)} /></Field>
      </div>
      <Field label="Pickup instructions" htmlFor="ev-pickup"><Textarea id="ev-pickup" rows={3} value={v.pickupInstructions} onChange={(e) => set('pickupInstructions', e.target.value)} /></Field>
      <Field label="Event contact information" htmlFor="ev-contact"><Textarea id="ev-contact" rows={2} value={v.contactInfo} onChange={(e) => set('contactInfo', e.target.value)} /></Field>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      <Button type="submit" size="lg" disabled={busy}>{busy ? <Loader2 className="size-5 animate-spin" /> : null} Save settings</Button>
    </form>
  )
}

export function StaffForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'volunteer'>('volunteer')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const res = await post('/api/admin/settings', { action: 'staff-create', email, name, password, role })
    setBusy(false)
    if (!res.ok) return setMsg({ kind: 'error', text: res.error.message })
    setMsg({ kind: 'success', text: `Created ${role} account for ${name}.` })
    setEmail(''); setName(''); setPassword('')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border bg-card p-5 shadow-sm" noValidate>
      <h2 className="text-lg font-bold">Add a staff or volunteer account</h2>
      <p className="text-sm text-muted-foreground">Volunteers can run the live console, record bids and payments. Administrators can also correct payments, reopen items, and change settings.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="st-name"><Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email" htmlFor="st-email"><Input id="st-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Temporary password (8+ characters)" htmlFor="st-pw"><Input id="st-pw" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label="Role" htmlFor="st-role">
          <select id="st-role" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'volunteer')} className="h-10 w-full rounded-lg border border-input bg-white px-3 text-base">
            <option value="volunteer">Volunteer</option>
            <option value="admin">Administrator</option>
          </select>
        </Field>
      </div>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      <Button type="submit" disabled={busy || !email || !name || password.length < 8}>{busy ? <Loader2 className="size-4 animate-spin" /> : null} Create account</Button>
    </form>
  )
}

export function StaffActiveToggle({ id, active, self }: { id: string; active: boolean; self: boolean }) {
  const router = useRouter()
  if (self) return <span className="text-xs text-muted-foreground">you</span>
  return (
    <Button size="sm" variant="outline" onClick={async () => { await post('/api/admin/settings', { action: 'staff-active', id, active: !active }); router.refresh() }}>
      {active ? 'Deactivate' : 'Reactivate'}
    </Button>
  )
}
