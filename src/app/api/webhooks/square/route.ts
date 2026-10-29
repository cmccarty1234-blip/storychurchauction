import { handleSquareEvent } from '@/lib/online-pay'
import { verifyWebhook } from '@/lib/square'

export const dynamic = 'force-dynamic'

/** Square tells us a payment completed. Rejected unless the HMAC signature is valid. */
export async function POST(req: Request) {
  const raw = await req.text()
  if (!verifyWebhook(raw, req.headers.get('x-square-hmacsha256-signature'))) {
    return Response.json({ error: 'bad signature' }, { status: 401 })
  }
  try {
    const result = await handleSquareEvent(JSON.parse(raw))
    return Response.json({ ok: true, ...result })
  } catch (e) {
    console.error('[square webhook] failed', e)
    return Response.json({ error: 'failed' }, { status: 500 }) // Square will retry
  }
}
