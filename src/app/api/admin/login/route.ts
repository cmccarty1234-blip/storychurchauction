import { z } from 'zod'
import { body, route } from '@/lib/api'
import { adminLogin } from '@/lib/auth-core'
import { setSessionCookie } from '@/lib/session'

export const POST = route(async (req) => {
  const b = await body(req, z.object({ email: z.string().max(200), password: z.string().max(200) }))
  const { token, admin } = await adminLogin(b.email, b.password)
  await setSessionCookie('admin', token)
  return { name: admin.name, role: admin.role }
})
