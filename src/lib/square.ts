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
    // Square's own error codes/details (never our token) are kept on the error so staff can see WHY, not just that it failed.
    const errors = (json.errors ?? []).slice(0, 5).map((e) => ({ code: e.code, detail: e.detail?.slice(0, 200), field: (e as { field?: string }).field }))
    console.error('[square] error', res.status, JSON.stringify(errors).slice(0, 400))
    throw new AppError('PAYMENT_PROVIDER', 'The payment system declined the request. Nothing was charged — please pay at the checkout table.', 502, { squareStatus: res.status, squareErrors: errors })
  }
  return json
}

/** A hosted Square checkout page for an exact amount. */
export async function createPaymentLink(p: {
  /** Retry mode: send only what Square strictly needs (no Apple/Google Pay, no pre-filled contact). */
  minimal?: boolean

  idempotencyKey: string
  /** One line per item the guest is paying for; the lines add up to the amount charged. */
  lines: { name: string; amountCents: number }[]
  referenceId: string
  redirectUrl: string
  note: string
  buyerEmail?: string | null
  buyerPhone?: string | null
}) {
  const prefill = p.minimal ? {} : {
    ...(p.buyerEmail ? { buyer_email: p.buyerEmail } : {}),
    ...(p.buyerPhone && /^\+[1-9]\d{7,14}$/.test(p.buyerPhone) ? { buyer_phone_number: p.buyerPhone } : {}),
  }
  const support = process.env.SQUARE_SUPPORT_EMAIL
  const r = await sq<{ payment_link?: { id: string; url: string; order_id: string } }>('/v2/online-checkout/payment-links', {
    method: 'POST',
    body: {
      idempotency_key: p.minimal ? `${p.idempotencyKey}-min` : p.idempotencyKey,
      order: {
        location_id: process.env.SQUARE_LOCATION_ID,
        reference_id: p.referenceId,
        line_items: p.lines.map((l) => ({ name: l.name.slice(0, 250), quantity: '1', base_price_money: { amount: l.amountCents, currency: 'USD' } })),
      },
      checkout_options: {
        redirect_url: p.redirectUrl,
        ask_for_shipping_address: false,
        ...(p.minimal ? {} : { accepted_payment_methods: { apple_pay: true, google_pay: true } }),
        ...(support && !p.minimal ? { merchant_support_email: support } : {}),
      },
      ...(Object.keys(prefill).length ? { pre_populated_data: prefill } : {}),
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

export type SquarePayment = { status: string; amountCents: number; currency: string; receipt: string | null }

/** The payment itself (its status is the real answer — an order can still read OPEN while its payment is COMPLETED). */
export async function getPayment(paymentId: string): Promise<SquarePayment> {
  const r = await sq<{ payment?: { status: string; amount_money?: { amount: number; currency: string }; receipt_number?: string } }>(`/v2/payments/${encodeURIComponent(paymentId)}`)
  return { status: r.payment?.status ?? 'UNKNOWN', amountCents: r.payment?.amount_money?.amount ?? 0, currency: r.payment?.amount_money?.currency ?? '', receipt: r.payment?.receipt_number ?? null }
}

/** Square signs every webhook: base64(HMAC-SHA256(signatureKey, notificationUrl + rawBody)). */
export function verifyWebhook(rawBody: string, signature: string | null, url = webhookUrl(), key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY): boolean {
  if (!signature || !key) return false
  const expected = createHmac('sha256', key).update(url + rawBody).digest('base64')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}
