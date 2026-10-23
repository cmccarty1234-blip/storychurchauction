'use client'

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { post } from '@/lib/client'

export function SignOutButton({ admin = false, className }: { admin?: boolean; className?: string }) {
  const router = useRouter()
  return (
    <button
      type="button"
      aria-label="Sign out"
      className={className ?? 'inline-flex min-h-11 items-center rounded-md px-2 text-sm font-semibold hover:bg-ivory sm:px-3'}
      onClick={async () => {
        await post(admin ? '/api/admin/logout' : '/api/auth/logout', {})
        router.push(admin ? '/admin/login' : '/')
        router.refresh()
      }}
    >
      <span className="hidden sm:inline">Sign out</span>
      <LogOut className="size-5 sm:hidden" aria-hidden />
    </button>
  )
}
