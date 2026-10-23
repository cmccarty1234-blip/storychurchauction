import Image from 'next/image'
import { redirect } from 'next/navigation'
import { getAdmin } from '@/lib/session'
import { AdminLoginForm } from './login-form'

export const metadata = { title: 'Staff sign-in' }

export default async function AdminLoginPage() {
  if (await getAdmin()) redirect('/admin')
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b-4 border-brand-yellow bg-white py-3">
        <div className="mx-auto max-w-md px-4">
          <Image src="/brand/storychurch-banner.png" alt="Story Church" width={1562} height={286} className="h-9 w-auto brightness-0" priority />
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-3xl font-extrabold">Staff sign-in</h1>
        <p className="mt-2 text-muted-foreground">For church staff and volunteers running the auction.</p>
        <div className="mt-6 rounded-xl border bg-card p-6 shadow-sm">
          <AdminLoginForm />
        </div>
      </main>
    </div>
  )
}
