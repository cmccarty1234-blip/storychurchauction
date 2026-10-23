'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ApiResult } from '@/lib/client'

type ButtonProps = Pick<React.ComponentProps<typeof Button>, 'variant' | 'size' | 'className'>

/**
 * A button that asks for explicit confirmation (and optionally a written reason) before running a
 * destructive or irreversible action. Errors from the server are shown inside the dialog.
 */
export function ConfirmAction({
  label,
  title,
  description,
  confirmLabel,
  reasonLabel,
  action,
  disabled,
  confirmVariant = 'default',
  ...btn
}: ButtonProps & {
  label: React.ReactNode
  title: string
  description?: React.ReactNode
  confirmLabel: string
  reasonLabel?: string
  action: (reason: string) => Promise<ApiResult<unknown>>
  disabled?: boolean
  confirmVariant?: 'default' | 'destructive' | 'bid'
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    const res = await action(reason)
    setBusy(false)
    if (res.ok) {
      setOpen(false)
      setReason('')
      router.refresh()
    } else setError(res.error.message)
  }

  return (
    <>
      <Button type="button" {...btn} disabled={disabled} onClick={() => { setError(null); setOpen(true) }}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {reasonLabel ? (
            <div className="space-y-2">
              <Label htmlFor="confirm-reason">{reasonLabel}</Label>
              <Input id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </div>
          ) : null}
          {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button type="button" variant={confirmVariant} onClick={run} disabled={busy || (!!reasonLabel && !reason.trim())}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function Notice({ kind, children }: { kind: 'error' | 'success' | 'info'; children: React.ReactNode }) {
  const cls = kind === 'error' ? 'bg-red-50 text-red-800' : kind === 'success' ? 'bg-[#dff3ee] text-[#0f5c4f]' : 'bg-secondary text-ink'
  return (
    <p role={kind === 'error' ? 'alert' : 'status'} className={`rounded-xl px-3 py-2.5 text-sm font-medium ${cls}`}>
      {children}
    </p>
  )
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
