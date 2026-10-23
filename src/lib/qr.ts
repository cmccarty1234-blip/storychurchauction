import QRCode from 'qrcode'

/** Base URL for QR links. Environment-driven so the same build works on localhost, a LAN IP, or Vercel. */
export function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
}

export function itemUrl(itemNumber: number) {
  return `${appUrl()}/i/${itemNumber}`
}

/** Free, local QR generation (the `qrcode` package) — no external service. */
export async function itemQrSvg(itemNumber: number): Promise<string> {
  return QRCode.toString(itemUrl(itemNumber), { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#1c1a22', light: '#ffffff' } })
}
