'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { post } from '@/lib/client'

export function RegisterForm({ next }: { next: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<'register' | 'signin'>('register')
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [number, setNumber] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ bidderNumber: number; pin: string } | null>(null)

  async function register(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await post<{ bidderNumber: number; pin: string }>('/api/auth/register', { name, contact })
    setBusy(false)
    if (!res.ok) {
      setError(res.error.message)
      if (res.error.code === 'DUPLICATE_CONTACT') setMode('signin')
      return
    }
    setDone({ bidderNumber: res.data.bidderNumber, pin: res.data.pin }) // shown once
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await post('/api/auth/signin', { bidderNumber: parseInt(number, 10), pin })
    if (!res.ok) {
      setBusy(false)
      setError(res.error.message)
      return
    }
    router.push(next)
    router.refresh()
  }

  if (done) {
    return (
      <div className="space-y-5" role="status">
        <div>
          <h2 className="text-xl font-bold">You’re registered!</h2>
          <p className="mt-1 text-sm text-muted-foreground">You’re signed in on this phone. Save these in case you switch phones or lose your sign-in.</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-center">
          <div className="rounded-xl bg-secondary p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bidder / paddle #</dt>
            <dd className="tnum mt-1 text-4xl font-extrabold text-ink">{done.bidderNumber}</dd>
          </div>
          <div className="rounded-xl bg-brand-yellow p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink">Your PIN</dt>
            <dd className="tnum mt-1 text-4xl font-extrabold tracking-widest text-ink">{done.pin}</dd>
          </div>
        </dl>
        <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
          📸 Take a screenshot now — we only show your PIN once. Lost it? Any volunteer can reset it.
        </p>
        <Button size="lg" variant="bid" className="h-12 w-full" onClick={() => { router.push(next); router.refresh() }}>
          Start bidding
        </Button>
      </div>
    )
  }

  if (mode === 'signin') {
    return (
      <form onSubmit={signIn} className="space-y-5" noValidate>
        <div className="space-y-2">
          <Label htmlFor="number">Bidder number</Label>
          <Input id="number" inputMode="numeric" autoComplete="username" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))} placeholder="1042" className="h-12 text-lg tnum" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pin">4-digit PIN</Label>
          <Input id="pin" inputMode="numeric" type="password" autoComplete="current-password" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="h-12 text-lg tracking-[0.5em] tnum" />
        </div>
        {error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-800">{error}</p> : null}
        <Button type="submit" size="lg" variant="bid" className="h-12 w-full" disabled={busy || !number || pin.length !== 4}>
          {busy ? <Loader2 className="size-5 animate-spin" /> : null} Sign in
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          New here?{' '}
          <button type="button" className="font-semibold text-ink underline underline-offset-2" onClick={() => { setMode('register'); setError(null) }}>Register</button>
          {' · '}Lost your PIN? Ask any volunteer.
        </p>
      </form>
    )
  }

  return (
    <form onSubmit={register} className="space-y-5" noValidate>
      <div className="space-y-2">
        <Label htmlFor="name">Your full name</Label>
        <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" className="h-12" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact">Mobile number or email</Label>
        <Input id="contact" autoComplete="email" inputMode="email" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="719-555-0123 or you@example.com" className="h-12" aria-describedby="contact-help" />
        <p id="contact-help" className="text-xs text-muted-foreground">So the church can reach you about your winnings and pickup. Staff only — never shown to other guests.</p>
      </div>
      {error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-800">{error}</p> : null}
      <Button type="submit" size="lg" variant="bid" className="h-12 w-full" disabled={busy || !contact.trim() || name.trim().length < 2}>
        {busy ? <Loader2 className="size-5 animate-spin" /> : null} Register & start bidding
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already registered?{' '}
        <button type="button" className="font-semibold text-ink underline underline-offset-2" onClick={() => { setMode('signin'); setError(null) }}>Sign in with your PIN</button>
      </p>
      <p className="text-center text-xs text-muted-foreground">No smartphone? Any volunteer can register you and give you a paddle.</p>
    </form>
  )
}
