'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmAction, Notice } from '@/components/admin-ui'
import { ItemImage } from '@/components/item-card'
import { post } from '@/lib/client'

export type ItemRow = {
  id: string
  number: number
  title: string
  kind: 'silent' | 'live'
  statusLabel: string
  statusCls: string
  hidden: boolean
  canToggle: boolean
  hasPhoto: boolean
  imagePath: string | null
  bids: number
  money: string
  moneyIsStart: boolean
  closes: string
}

/** Items list with checkboxes so many items can be shown to (or hidden from) guests at once. */
export function ItemsTable({ rows }: { rows: ItemRow[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const toggleable = useMemo(() => rows.filter((r) => r.canToggle), [rows])
  const count = selected.size

  const pick = (ids: string[]) => { setSelected(new Set(ids)); setMsg(null) }
  const flip = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  async function run(published: boolean) {
    const res = await post<{ changed: number; skipped: { title: string; why: string }[] }>('/api/admin/items', { action: 'publish-many', ids: [...selected], published })
    if (res.ok) {
      const { changed, skipped } = res.data
      setMsg({
        kind: skipped.length ? 'info' : 'success',
        text: `${changed} item${changed === 1 ? '' : 's'} ${published ? 'now visible to guests' : 'hidden'}.` + (skipped.length ? ` Skipped ${skipped.length}: ${skipped.slice(0, 3).map((s) => `${s.title} (${s.why})`).join('; ')}${skipped.length > 3 ? '…' : ''}` : ''),
      })
      setSelected(new Set())
      router.refresh()
    }
    return res
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 shadow-sm" role="toolbar" aria-label="Bulk actions">
        <span className="mr-1 text-sm font-semibold">{count} selected</span>
        <Button size="sm" variant="outline" onClick={() => pick(toggleable.filter((r) => r.hidden).map((r) => r.id))}>Select all hidden</Button>
        <Button size="sm" variant="outline" onClick={() => pick(toggleable.filter((r) => r.hidden && r.hasPhoto).map((r) => r.id))}>Hidden with a photo</Button>
        <Button size="sm" variant="outline" onClick={() => pick(toggleable.filter((r) => !r.hidden).map((r) => r.id))}>All visible</Button>
        <Button size="sm" variant="ghost" onClick={() => pick([])} disabled={!count}>Clear</Button>
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
        <ConfirmAction
          size="sm" label={<><Eye className="size-4" /> Show to guests</>} disabled={!count}
          title={`Show ${count} item${count === 1 ? '' : 's'} to guests?`}
          description="Guests will see these items right away. Silent items open for bidding immediately (until the event’s closing time); live items appear as “coming up”. Check prices first — guests see the starting bids."
          confirmLabel={`Show ${count} to guests`}
          action={() => run(true)}
        />
        <ConfirmAction
          size="sm" variant="outline" label={<><EyeOff className="size-4" /> Hide</>} disabled={!count}
          title={`Hide ${count} item${count === 1 ? '' : 's'} from guests?`}
          description="Items that already have bids can’t be hidden and will be skipped."
          confirmLabel={`Hide ${count}`} confirmVariant="destructive"
          action={() => run(false)}
        />
      </div>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}

      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full min-w-[780px] text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-10 p-3"><span className="sr-only">Select</span></th>
              <th className="p-3">#</th><th className="p-3">Item</th><th className="p-3">Type</th><th className="p-3">Status</th>
              <th className="p-3 text-right">Bids</th><th className="p-3 text-right">Current / start</th><th className="p-3">Closes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((i) => (
              <tr key={i.id} className={`hover:bg-secondary/40 ${selected.has(i.id) ? 'bg-brand-yellow/15' : ''}`}>
                <td className="p-3">
                  <input type="checkbox" className="size-5 accent-[var(--ink)]" checked={selected.has(i.id)} disabled={!i.canToggle} onChange={() => flip(i.id)} aria-label={`Select #${i.number} ${i.title}`} />
                </td>
                <td className="p-3 font-bold">{i.number}</td>
                <td className="p-3">
                  <Link href={`/admin/items/${i.id}`} className="flex items-center gap-3 font-semibold text-ink hover:underline">
                    <span className="block size-10 shrink-0 overflow-hidden rounded-lg"><ItemImage path={i.imagePath} title="" /></span>
                    {i.title}
                  </Link>
                </td>
                <td className="p-3 capitalize">{i.kind}</td>
                <td className="p-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${i.statusCls}`}>{i.statusLabel}</span></td>
                <td className="tnum p-3 text-right">{i.bids}</td>
                <td className="tnum p-3 text-right font-semibold">{i.money}{i.moneyIsStart ? <span className="font-normal text-muted-foreground"> start</span> : null}</td>
                <td className="p-3 text-xs text-muted-foreground">{i.closes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
