import QRCode from 'qrcode'
import { Projector } from '@/components/projector'
import { appUrl } from '@/lib/appurl'

export const metadata = { title: 'Projector display' }
export const dynamic = 'force-dynamic'

/** Public, read-only, full-screen audience display. Shows bidder numbers only — no names or contact details. */
export default async function DisplayPage() {
  const joinUrl = `${appUrl()}/register?next=/auction`
  const qr = await QRCode.toDataURL(joinUrl, { errorCorrectionLevel: 'M', margin: 1, width: 600, color: { dark: '#101010', light: '#ffffff' } })
  const chiliQr = await QRCode.toDataURL(`${appUrl()}/chili`, { errorCorrectionLevel: 'M', margin: 1, width: 600, color: { dark: '#101010', light: '#ffffff' } })
  return <Projector qr={qr} chiliQr={chiliQr} joinUrl={`${appUrl()}/register`} />
}
