import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { AppError } from './errors'

// Local-disk image storage for development. On Vercel the filesystem is read-only/ephemeral, so
// production needs object storage (Supabase Storage / Vercel Blob) behind this same interface — see README.
const dir = () => path.resolve(process.env.UPLOAD_DIR ?? './uploads')

const MAGIC: [string, number[], string][] = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47], 'png'],
  ['image/jpeg', [0xff, 0xd8, 0xff], 'jpg'],
  ['image/gif', [0x47, 0x49, 0x46, 0x38], 'gif'],
]

function sniff(buf: Buffer): { type: string; ext: string } | null {
  for (const [type, sig, ext] of MAGIC) if (sig.every((b, i) => buf[i] === b)) return { type, ext }
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { type: 'image/webp', ext: 'webp' }
  return null
}

export async function saveImage(buf: Buffer): Promise<string> {
  if (buf.length > 6 * 1024 * 1024) throw new AppError('FILE_TOO_LARGE', 'Photos must be under 6 MB.')
  const t = sniff(buf)
  if (!t) throw new AppError('BAD_IMAGE', 'Please upload a JPG, PNG, WebP or GIF photo.')
  const name = `${crypto.randomUUID()}.${t.ext}`
  await fs.mkdir(dir(), { recursive: true })
  await fs.writeFile(path.join(dir(), name), buf)
  return name
}

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }

export async function readImage(name: string): Promise<{ buf: Buffer; type: string } | null> {
  if (!/^[\w-]+\.(png|jpg|gif|webp|svg)$/.test(name)) return null
  try {
    const buf = await fs.readFile(path.join(dir(), name))
    return { buf, type: TYPES[name.split('.').pop()!] }
  } catch {
    return null
  }
}

/** Seed-only: demo artwork is written as SVG. Uploads through the app are raster-only. */
export async function writeSeedSvg(name: string, svg: string) {
  await fs.mkdir(dir(), { recursive: true })
  await fs.writeFile(path.join(dir(), name), svg)
}
