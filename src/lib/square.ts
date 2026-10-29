/**
 * Minimal Square client (Checkout payment links + orders + webhook signature check). Uses the Square REST API with plain
 * fetch — no SDK. Credentials come from environment variables and are never logged or sent to the browser:
 *   SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_ENV ('sandbox' | 'production')
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { AppError } from './errors'
import { appUrl } from './appurl'

const VERSION = '2024-10-17'

export const squareReady = () => !!process.env.SQUARE_ACCESS_TOKEN && !!process.env.SQUARE_LOCATION_ID
export const squareEnv = () => (process.env.SQUARE_ENV === 'sandbox' ? 'sandbox' : 'production')
const base = () => (squareEnv() === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com')
export const webhookUrl = () => process.env.SQUARE_WEBHOOK_URL || `${appUrl()}/api/webhooks/square`

async function sq<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!squareReady()) throw new AppError('PAYMENTS_OFF', 'Online payment isn’t set up yet. Please pay at the checkout table.', 503)
  let res: Response
  try {
    res = await fetch(base() + path, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`, 'Square-Version': VERSION, 'Content-Type': 'application/json' },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new AppError('PAYMENT_PROVIDER', 'Couldn’t reach the payment system. Nothing was charged — please try again or pay at the checkout table.', 502)
  }
  const json = (await res.json().catch(() => ({}))) as T & { errors?: { code?: string; detail?: string }[] }
  if (!res.ok) {
    console.error('[square] error', res.status, JSON.stringify(json.errors ?? []).slice(0, 400)) // never includes our token
    throw new AppError('PAYMENT_PROVIDER', 'The payment system declined the request. Nothing was charged — please pay at the checkout table.', 502)
  }
  return json
}

/** A hosted Square checkout page for an exact amount. */
export async function createPaymentLink(p: { idempotencyKey: string; name: string; amountCents: number; redirectUrl: string; note: string }) {
  const r = await sq<{ payment_link?: { id: string; url: string; order_id: string } }>('/v2/online-checkout/payment-links', {
    method: 'POST',
    body: {
      idempotency_key: p.idempotencyKey,
      quick_pay: { name: p.name, price_money: { amount: p.amountCents, currency: 'USD' }, location_id: process.env.SQUARE_LOCATION_ID },
      checkout_options: { redirect_url: p.redirectUrl, ask_for_shipping_address: false },
      payment_note: p.note,
    },
  })
  if (!r.payment_link?.url || !r.payment_link.order_id) throw new AppError('PAYMENT_PROVIDER', 'The payment system gave an unexpected answer. Nothing was charged.', 502)
  return { linkId: r.payment_link.id, url: r.payment_link.url, orderId: r.payment_link.order_id }
}

export type SquareOrder = { state: string; paymentId: string | null; paidCents: number }

/** Asks Square what happened to an order (used when the webhook is slow or missing). */
export async function getOrder(orderId: string): Promise<SquareOrder> {
  const r = await sq<{ order?: { state: string; tenders?: { payment_id?: string; amount_money?: { amount: number; currency: string } }[] } }>(`/v2/orders/${encodeURIComponent(orderId)}`)
  const tenders = r.order?.tenders ?? []
  return {
    state: r.order?.state ?? 'UNKNOWN',
    paymentId: tenders.find((t) => t.payment_id)?.payment_id ?? null,
    paidCents: tenders.filter((t) => t.amount_money?.currency === 'USD').reduce((s, t) => s + (t.amount_money?.amount ?? 0), 0),
  }
}

/** Square signs every webhook: base64(HMAC-SHA256(signatureKey, notificationUrl + rawBody)). */
export function verifyWebhook(rawBody: string, signature: string | null, url = webhookUrl(), key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY): boolean {
  if (!signature || !key) return false
  const expected = createHmac('sha256', key).update(url + rawBody).digest('base64')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}
