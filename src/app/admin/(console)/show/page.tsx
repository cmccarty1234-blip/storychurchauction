import { requireAdminPage } from '@/lib/session'
import { redirect } from 'next/navigation'
import { HostConsole } from '@/components/host-console'

export const metadata = { title: 'Host console' }

export default async function ShowPage() {
  const admin = await requireAdminPage()
  if (admin.role === 'volunteer') redirect('/admin') // hosts and administrators only
  return (
    <div className="space-y-3">
      <h1 className="text-3xl font-extrabold">Host console</h1>
      <HostConsole isAdmin={admin.role === 'admin'} />
    </div>
  )
}
