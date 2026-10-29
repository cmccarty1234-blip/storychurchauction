'use client'

import { useState } from 'react'
import { Loader2, CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { post } from '@/lib/client'
import { formatCents } from '@/lib/money'

/** Sends the guest to Square's secure page to pay their balance. The amount is decided by the server. */
export function PayOnline({ balanceCents }: { balanceCents: number }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function go() {
    setBusy(true)
    setErr(null)
    const r = await post<{ url: string }>('/api/pay/square/start', {})
    if (r.ok) {
      window.location.href = r.data.url
      return
    }
    setBusy(false)
    setErr(r.error.message)
  }
  return (
    <div className="mt-4">
      <Button variant="bid" size="lg" className="h-14 w-full text-lg" onClick={go} disabled={busy}>
        {busy ? <Loader2 className="size-5 animate-spin" /> : <><CreditCard className="size-5" /> Pay {formatCents(balanceCents)} by card</>}
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">You&rsquo;ll go to Square&rsquo;s secure payment page. When it&rsquo;s done you&rsquo;ll come straight back here.</p>
      {err ? <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{err}</p> : null}
    </div>
  )
}
