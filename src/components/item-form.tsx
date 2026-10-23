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
import { shrinkImage } from '@/lib/shrink-image'

export type ItemFormValues = {
  id?: string
  kind: 'silent' | 'live'
  itemNumber?: number
  title: string
  description: string
  donorName: string
  imagePath: string | null
  startingBid: string
  increment: string
  published: boolean
  locked?: boolean // prices locked once bidding started
  kindLocked?: boolean // type can no longer be switched (bids exist, or it's on the block / closed)
}

export function ItemForm({ initial, defaultIncrement }: { initial?: ItemFormValues; defaultIncrement: string }) {
  const router = useRouter()
  const editing = !!initial?.id
  const [v, setV] = useState<ItemFormValues>(
    initial ?? { kind: 'silent', title: '', description: '', donorName: '', imagePath: null, startingBid: '', increment: defaultIncrement, published: true },
  )
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const originalKind = initial?.kind
  const set = <K extends keyof ItemFormValues>(k: K, val: ItemFormValues[K]) => { setV((p) => ({ ...p, [k]: val })); setSaved(false) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const start = parseDollars(v.startingBid)
    const inc = parseDollars(v.increment)
    if (!v.title.trim()) return setError('Enter a title.')
    if (start == null || start < 100) return setError('Starting bid must be at least $1 (use whole dollars or cents, like 50 or 50.00).')
    if (inc == null || inc < 100) return setError('Bid increment must be at least $1.')
    setBusy(true)

    let imagePath = v.imagePath
    if (file) {
      const fd = new FormData()
      fd.append('file', await shrinkImage(file))
      try {
        const r = await fetch('/api/admin/upload', { method: 'POST', body: fd })
        const j = await r.json()
        if (!r.ok) { setBusy(false); return setError(j.error?.message ?? 'Photo upload failed.') }
        imagePath = j.imagePath
      } catch {
        setBusy(false)
        return setError('Couldn’t upload the photo — check your connection.')
      }
    }

    const common = {
      title: v.title.trim(), description: v.description, donorName: v.donorName.trim() || null, imagePath,
      startingBidCents: start, incrementCents: inc, published: v.published,
      // When the type changes the server assigns a new number in the other range.
      itemNumber: editing && v.kind !== originalKind ? undefined : v.itemNumber || undefined,
    }
    const res = editing
      ? await post('/api/admin/items', { action: 'update', id: v.id, kind: v.kind, ...common })
      : await post<{ id: string }>('/api/admin/items', { action: 'create', kind: v.kind, ...common })
    setBusy(false)
    if (!res.ok) return setError(res.error.message)
    if (editing) {
      setSaved(true)
      setFile(null)
      if (v.kind !== originalKind) window.location.reload() // new item number / status come back from the server
      router.refresh()
    } else {
      router.push(`/admin/items/${(res.data as { id: string }).id}`)
      router.refresh()
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border bg-card p-5 shadow-sm" noValidate>
      {(
        <fieldset disabled={editing && !!v.kindLocked}>
          <legend className="mb-2 text-sm font-medium">Auction type</legend>
          <div className="flex gap-2">
            {(['silent', 'live'] as const).map((k) => (
              <label key={k} className={`flex-1 cursor-pointer rounded-xl border-2 px-4 py-3 text-center text-sm font-semibold ${v.kind === k ? 'border-ink bg-secondary text-ink' : 'border-border bg-white'}`}>
                <input type="radio" name="kind" className="sr-only" checked={v.kind === k} onChange={() => set('kind', k)} />
                {k === 'silent' ? 'Silent auction' : 'Live auction'}
              </label>
            ))}
          </div>
          {editing ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {v.kindLocked ? 'The type is locked because this item has bids or is already on the block or closed.' : 'You can switch silent ⇄ live until the first bid. Saving a change gives the item a new number (silent 1…, live 101…), so reprint its QR label if you already printed one.'}
            </p>
          ) : null}
        </fieldset>
      )}
      <Field label="Title" htmlFor="title">
        <Input id="title" value={v.title} onChange={(e) => set('title', e.target.value)} maxLength={120} />
      </Field>
      <Field label="Description" htmlFor="desc">
        <Textarea id="desc" value={v.description} onChange={(e) => set('description', e.target.value)} rows={4} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Starting bid ($)" htmlFor="start" hint={v.locked ? 'Locked — bidding has started.' : undefined}>
          <Input id="start" inputMode="decimal" value={v.startingBid} onChange={(e) => set('startingBid', e.target.value)} disabled={v.locked} />
        </Field>
        <Field label="Minimum increment ($)" htmlFor="inc">
          <Input id="inc" inputMode="decimal" value={v.increment} onChange={(e) => set('increment', e.target.value)} disabled={v.locked} />
        </Field>
        <Field label="Item number" htmlFor="num" hint="Leave blank to assign the next one.">
          <Input id="num" inputMode="numeric" value={v.itemNumber ?? ''} onChange={(e) => set('itemNumber', e.target.value ? parseInt(e.target.value, 10) || undefined : undefined)} />
        </Field>
      </div>
      <Field label="Donor name (optional)" htmlFor="donor">
        <Input id="donor" value={v.donorName} onChange={(e) => set('donorName', e.target.value)} maxLength={120} />
      </Field>
      <Field label="Photo" htmlFor="photo" hint="JPG, PNG, WebP or GIF. Big phone photos are shrunk automatically. Landscape looks best.">
        <Input id="photo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-auto py-2" />
        {v.imagePath && !file ? <p className="text-xs text-muted-foreground">Current photo: {v.imagePath}</p> : null}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.published} onChange={(e) => set('published', e.target.checked)} className="size-4 accent-[var(--ink)]" />
        Visible to guests (uncheck to keep this item hidden while you set it up)
      </label>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {saved ? <Notice kind="success">Saved.</Notice> : null}
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? <Loader2 className="size-5 animate-spin" /> : null} {editing ? 'Save changes' : 'Create item'}
      </Button>
    </form>
  )
}
