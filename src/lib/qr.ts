import QRCode from 'qrcode'
import { appUrl } from './appurl'

export { appUrl }

export function itemUrl(itemNumber: number) {
  return `${appUrl()}/i/${itemNumber}`
}

/** Free, local QR generation (the `qrcode` package) — no external service. */
export async function itemQrSvg(itemNumber: number): Promise<string> {
  return QRCode.toString(itemUrl(itemNumber), { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#1c1a22', light: '#ffffff' } })
}
