import { route } from '@/lib/api'
import { AppError } from '@/lib/errors'
import { requireAdmin } from '@/lib/session'
import { saveImage } from '@/lib/storage'

export const POST = route(async (req) => {
  await requireAdmin()
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new AppError('INVALID_REQUEST', 'Choose a photo to upload.')
  const name = await saveImage(Buffer.from(await file.arrayBuffer()))
  return { imagePath: name }
})
