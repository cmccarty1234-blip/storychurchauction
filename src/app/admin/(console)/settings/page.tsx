import { getEvent } from '@/lib/events'
import { requireAdminPage } from '@/lib/session'
import { query } from '@/lib/db'
import { utcToLocalInput } from '@/lib/time'
import { appUrl } from '@/lib/qr'
import { EventSettingsForm, StaffActiveToggle, StaffForm } from '@/components/settings-forms'

export const metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const admin = await requireAdminPage('admin') // administrators only
  const ev = await getEvent()
  const staff = await query<{ id: string; name: string; email: string; role: string; active: boolean }>('select id, name, email, role, active from admin_users order by created_at')

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-extrabold">Settings</h1>
      <EventSettingsForm
        initial={{
          name: ev.name,
          eventDate: ev.event_date ?? '',
          timezone: ev.timezone,
          silentStart: utcToLocalInput(ev.silent_start_at, ev.timezone),
          silentClose: utcToLocalInput(ev.silent_close_at, ev.timezone),
          defaultIncrement: String(ev.default_increment_cents / 100),
          pickupInstructions: ev.pickup_instructions,
          contactInfo: ev.contact_info,
        }}
      />
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-bold">Public address (QR codes)</h2>
        <p className="mt-1 text-sm text-muted-foreground">QR codes point to <code className="rounded bg-muted px-1.5 py-0.5">{appUrl()}</code>. Change it with the <code>NEXT_PUBLIC_APP_URL</code> setting — no code change needed.</p>
      </section>
      <StaffForm />
      <section className="rounded-xl border bg-card shadow-sm">
        <h2 className="border-b p-4 text-lg font-bold">Staff accounts</h2>
        <ul className="divide-y text-sm">
          {staff.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 p-4">
              <span><span className="font-semibold">{s.name}</span> <span className="text-muted-foreground">· {s.email} · {s.role}{s.active ? '' : ' · deactivated'}</span></span>
              <StaffActiveToggle id={s.id} active={s.active} self={s.id === admin.id} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
