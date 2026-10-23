import { redirect } from 'next/navigation'
import { getBidder } from '@/lib/session'
import { RegisterForm } from '@/components/register-form'

export const metadata = { title: 'Register to bid' }

function safeNext(n: string | undefined) {
  // Only same-site relative paths — never an open redirect.
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/auction'
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next)
  if (await getBidder()) redirect(next)
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-extrabold">Register to bid</h1>
      <p className="mt-2 text-muted-foreground">Your name and a phone number or email — that’s it.</p>
      <div className="mt-6 rounded-xl border bg-card p-6 shadow-sm">
        <RegisterForm next={next} />
      </div>
    </div>
  )
}
