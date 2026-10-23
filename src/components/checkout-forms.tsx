'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmAction, Field, Notice } from '@/components/admin-ui'
import { newKey, post } from '@/lib/client'
import { formatCents, parseDollars } from '@/lib/money'

const METHODS = [
  { v: 'cash', label: 'Cash' },
  { v: 'check', label: 'Check' },
  { v: 'card_terminal', label: 'Card terminal' },
] as const

export function PaymentForm({ bidderId, balanceCents }: { bidderId: string; balanceCents: number }) {
  const router = useRouter()
  const [method, setMethod] = useState<'cash' | 'check' | 'card_terminal'>('cash')
  const [amount, setAmount] = useState(String(balanceCents / 100))
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [key, setKey] = useState(newKey())

  const cents = parseDollars(amount)

  async function submit() {
    if (cents == null || cents <= 0) return setMsg({ kind: 'error', text: 'Enter the amount received.' })
    setBusy(true)
    setMsg(null)
    const res = await post('/api/admin/checkout', { action: 'pay', bidderId, method, amountCents: cents, reference: reference || undefined, idempotencyKey: key })
    setBusy(false)
    setConfirming(false)
    if (res.ok) {
      setMsg({ kind: 'success', text: `Recorded ${formatCents(cents)} (${METHODS.find((m) => m.v === method)!.label}).` })
      setKey(newKey())
      setReference('')
      setAmount('')
      router.refresh()
    } else {
      if (res.error.code !== 'NETWORK') setKey(newKey())
      setMsg({ kind: 'error', text: res.error.message })
      router.refresh()
    }
  }

  if (balanceCents <= 0) return <Notice kind="success">Paid in full — nothing more to collect.</Notice>

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (cents == null || cents <= 0) setMsg({ kind: 'error', text: 'Enter the amount received.' }); else setConfirming(true) }} className="space-y-4 rounded-xl border bg-card p-5 shadow-sm" noValidate>
      <h2 className="font-bold">Record a payment</h2>
      <p className="text-sm text-muted-foreground">Only record money you have <strong>actually received</strong> in hand or on the terminal.</p>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Payment method</legend>
        <div className="grid grid-cols-3 gap-2">
          {METHODS.map((m) => (
            <label key={m.v} className={`cursor-pointer rounded-xl border-2 px-2 py-3 text-center text-sm font-semibold ${method === m.v ? 'border-ink bg-secondary text-ink' : 'border-border bg-white'}`}>
              <input type="radio" name="method" className="sr-only" checked={method === m.v} onChange={() => setMethod(m.v)} />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount received ($)" htmlFor="pay-amt" hint={`Balance due: ${formatCents(balanceCents)}. A partial payment is fine.`}>
          <Input id="pay-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-12 text-xl font-bold tnum md:text-xl" />
        </Field>
        <Field label={method === 'check' ? 'Check number' : method === 'card_terminal' ? 'Terminal receipt # (optional)' : 'Note (optional)'} htmlFor="pay-ref">
          <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} className="h-12" maxLength={100} />
        </Field>
      </div>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      {confirming ? (
        <div className="space-y-3 rounded-xl border-2 border-ink bg-secondary p-4">
          <p className="font-semibold">Confirm: you received <span className="tnum">{formatCents(cents)}</span> by {METHODS.find((m) => m.v === method)!.label.toLowerCase()}?</p>
          <div className="flex gap-2">
            <Button type="button" size="lg" onClick={submit} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : null} Yes, record payment</Button>
            <Button type="button" variant="outline" size="lg" onClick={() => setConfirming(false)} disabled={busy}>Not yet</Button>
          </div>
        </div>
      ) : (
        <Button type="submit" size="lg">Record payment…</Button>
      )}
    </form>
  )
}

export function ReleaseButton({ winningResultId, balanceCents, isAdmin, released, title }: { winningResultId: string; balanceCents: number; isAdmin: boolean; released: boolean; title: string }) {
  const router = useRouter()
  if (released) {
    return isAdmin ? (
      <ConfirmAction size="sm" variant="ghost" label="Undo release" title={`Undo release of “${title}”?`} confirmLabel="Mark not released" reasonLabel="Reason" action={(reason) => post('/api/admin/checkout', { action: 'unrelease', winningResultId, reason })} />
    ) : null
  }
  if (balanceCents > 0) {
    return isAdmin ? (
      <ConfirmAction
        size="sm" variant="outline" label="Release unpaid (exception)…"
        title={`Release “${title}” before it is paid?`}
        description={`${formatCents(balanceCents)} is still due on this item. This exception is recorded with your name and reason.`}
        confirmLabel="Record exception & release" reasonLabel="Reason for the exception" confirmVariant="destructive"
        action={(exceptionReason) => post('/api/admin/checkout', { action: 'release', winningResultId, exceptionReason })}
      />
    ) : (
      <span className="text-xs text-muted-foreground">Pay to release</span>
    )
  }
  return (
    <Button size="sm" onClick={async () => { await post('/api/admin/checkout', { action: 'release', winningResultId }); router.refresh() }}>
      Mark released
    </Button>
  )
}

export function VoidPaymentButton({ paymentId, amount }: { paymentId: string; amount: string }) {
  return (
    <ConfirmAction
      size="sm" variant="ghost" label="Void"
      title={`Void the ${amount} payment?`}
      description="The payment stays in the history marked void, and the balance goes back up. Use this to correct a mistake."
      confirmLabel="Void payment" reasonLabel="Reason (required)" confirmVariant="destructive"
      action={(reason) => post('/api/admin/checkout', { action: 'void', paymentId, reason })}
    />
  )
}
