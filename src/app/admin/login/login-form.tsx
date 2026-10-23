'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, Notice } from '@/components/admin-ui'
import { post } from '@/lib/client'

export function AdminLoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await post('/api/admin/login', { email, password })
    if (!res.ok) {
      setBusy(false)
      setError(res.error.message)
      return
    }
    router.push('/admin')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12" required />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12" required />
      </Field>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Button type="submit" size="lg" className="h-12 w-full" disabled={busy}>
        {busy ? <Loader2 className="size-5 animate-spin" /> : null} Sign in
      </Button>
    </form>
  )
}
