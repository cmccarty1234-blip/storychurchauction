import { route } from '@/lib/api'
import { AppError } from '@/lib/errors'
import { itemQrSvg } from '@/lib/qr'
import { requireAdmin } from '@/lib/session'

export const GET = route<RouteContext<'/api/admin/qr/[number]'>>(async (_req, ctx) => {
  await requireAdmin()
  const n = parseInt((await ctx.params).number, 10)
  if (!Number.isInteger(n) || n < 1) throw new AppError('NOT_FOUND', 'Unknown item.', 404)
  return new Response(await itemQrSvg(n), {
    headers: { 'Content-Type': 'image/svg+xml', 'Content-Disposition': `attachment; filename="storychurch-item-${n}-qr.svg"` },
  })
})
