/**
 * Shrinks a phone photo in the browser before upload (max 1600 px, JPEG ~85%). Phone photos are often 4–10 MB, but
 * Vercel rejects request bodies over ~4.5 MB; the shrunk file is typically 200–600 KB and loads faster for guests.
 * GIFs and tiny files are sent untouched. If anything fails the original file is returned and the server decides.
 */
export async function shrinkImage(file: File, maxEdge = 1600): Promise<File> {
  if (file.type === 'image/gif' || file.size < 400 * 1024) return file
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * scale)
    const h = Math.round(bmp.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.fillStyle = '#ffffff' // transparent PNGs become white instead of black
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}
