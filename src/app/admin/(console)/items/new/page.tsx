import { getEvent } from '@/lib/events'
import { ItemForm } from '@/components/item-form'

export const metadata = { title: 'New item' }

export default async function NewItemPage() {
  const ev = await getEvent()
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-3xl font-extrabold">New auction item</h1>
      <ItemForm defaultIncrement={String(ev.default_increment_cents / 100)} />
    </div>
  )
}
