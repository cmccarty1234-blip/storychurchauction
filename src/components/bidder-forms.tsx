'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, Notice } from '@/components/admin-ui'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { post } from '@/lib/client'

export function AssistedRegisterForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res = await post<{ bidderNumber: number }>('/api/admin/bidders', { action: 'register', name, phone: phone || null, email: email || null })
    setBusy(false)
    if (!res.ok) return setMsg({ kind: 'error', text: res.error.message })
    setMsg({ kind: 'success', text: `Registered ${name} — hand them paddle #${res.data.bidderNumber}.` })
    setName(''); setPhone(''); setEmail('')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border bg-card p-5 shadow-sm" noValidate>
      <h2 className="font-bold">Register an assisted bidder</h2>
      <p className="text-sm text-muted-foreground">For guests without a phone or email. Contact info is optional. They’ll get a paddle number to hold up.</p>
      <Field label="Full name" htmlFor="ar-name"><Input id="ar-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone (optional)" htmlFor="ar-phone"><Input id="ar-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Email (optional)" htmlFor="ar-email"><Input id="ar-email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      </div>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      <Button type="submit" disabled={busy || name.trim().length < 2}>{busy ? <Loader2 className="size-4 animate-spin" /> : null} Register & issue paddle</Button>
    </form>
  )
}

export function EditBidderForm({ id, name: n0, phone: p0, email: e0 }: { id: string; name: string; phone: string; email: string }) {
  const router = useRouter()
  const [name, setName] = useState(n0)
  const [phone, setPhone] = useState(p0)
  const [email, setEmail] = useState(e0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res = await post('/api/admin/bidders', { action: 'update', id, name, phone: phone || null, email: email || null })
    setBusy(false)
    if (!res.ok) return setMsg({ kind: 'error', text: res.error.message })
    setMsg({ kind: 'success', text: 'Saved. The change is recorded in the audit log.' })
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border bg-card p-5 shadow-sm" noValidate>
      <h2 className="font-bold">Contact details</h2>
      <Field label="Full name" htmlFor="eb-name"><Input id="eb-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phone" htmlFor="eb-phone"><Input id="eb-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Email" htmlFor="eb-email"><Input id="eb-email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      </div>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      <Button type="submit" disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : null} Save correction</Button>
    </form>
  )
}

export function ResetPinButton({ id, number }: { id: string; number: number }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pin, setPin] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reset() {
    setBusy(true)
    setError(null)
    const res = await post<{ pin: string }>('/api/admin/bidders', { action: 'reset-pin', id })
    setBusy(false)
    if (res.ok) setPin(res.data.pin)
    else setError(res.error.message)
  }

  return (
    <>
      <Button variant="outline" onClick={() => { setPin(null); setError(null); setOpen(true) }}>Reset PIN</Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pin ? `New PIN for bidder #${number}` : `Reset the PIN for bidder #${number}?`}</DialogTitle>
            <DialogDescription>
              {pin ? 'Tell the guest this PIN now — it is not shown again. They are signed out everywhere and can sign in with their bidder number and this PIN.' : 'Check the guest’s identity first. This signs them out of all devices and gives them a new PIN.'}
            </DialogDescription>
          </DialogHeader>
          {pin ? <p className="tnum text-center text-5xl font-extrabold tracking-widest text-danger" role="status">{pin}</p> : null}
          {error ? <Notice kind="error">{error}</Notice> : null}
          <DialogFooter>
            {pin ? (
              <Button onClick={() => setOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
                <Button onClick={reset} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : null} Reset PIN</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
