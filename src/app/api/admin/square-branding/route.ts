import { route } from '@/lib/api'
import { applyCheckoutBranding } from '@/lib/square'
import { requireAdmin } from '@/lib/session'
import { audit } from '@/lib/audit'

/** Administrator-only: show the church logo (not just the name) at the top of Square's checkout page. */
export const POST = route(async () => {
  const admin = await requireAdmin('admin')
  const branding = await applyCheckoutBranding()
  await audit({ actorType: 'admin', actorId: admin.id, action: 'square.branding_applied', details: { branding } })
  return { ok: true, branding }
})
