import { route } from '@/lib/api'
import { readImage } from '@/lib/storage'

export const GET = route<RouteContext<'/api/uploads/[name]'>>(async (_req, ctx) => {
  const { name } = await ctx.params
  const img = await readImage(name)
  if (!img) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(img.buf), {
    headers: {
      'Content-Type': img.type,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  })
})
