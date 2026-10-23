import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { AppError } from './errors'

/**
 * Item-photo storage.
 *  • Production / Vercel: a PRIVATE Supabase Storage bucket, reached with the server-side service key
 *    (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). Guests never talk to Supabase directly: images are served through
 *    /api/uploads/[name], which this module feeds.
 *  • Local development: files in UPLOAD_DIR.
 * In production with no Supabase settings, saving fails with a clear message instead of writing to a disk that
 * Vercel throws away.
 */
const MAX_BYTES = 4 * 1024 * 1024 // Vercel limits request bodies to ~4.5 MB; the browser shrinks photos before upload

const localDir = () => path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR ?? './uploads')

function supabase() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return { url, key, bucket: process.env.SUPABASE_STORAGE_BUCKET || 'item-images' }
}

/** Legacy service_role keys are JWTs (sent as Bearer + apikey); the newer `sb_secret_…` keys are NOT JWTs and go in `apikey` only. */
function authHeaders(key: string): Record<string, string> {
  return key.startsWith('sb_') ? { apikey: key } : { Authorization: `Bearer ${key}`, apikey: key }
}

export function storageBackend(): 'supabase' | 'local' {
  return supabase() ? 'supabase' : 'local'
}

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

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }

let bucketReady: Promise<void> | null = null
async function ensureBucket(s: NonNullable<ReturnType<typeof supabase>>) {
  bucketReady ??= (async () => {
    const res = await fetch(`${s.url}/storage/v1/bucket`, {
      method: 'POST',
      headers: { ...authHeaders(s.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.bucket, name: s.bucket, public: false, file_size_limit: MAX_BYTES, allowed_mime_types: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] }),
    })
    if (res.ok) return
    const text = await res.text()
    if (res.status === 409 || /already exists|duplicate/i.test(text)) return
    throw new AppError('STORAGE_ERROR', `Photo storage isn’t reachable (${res.status}). Check the Supabase settings.`, 502)
  })().catch((e) => {
    bucketReady = null // retry next time
    throw e
  })
  return bucketReady
}

export async function saveImage(buf: Buffer): Promise<string> {
  if (buf.length > MAX_BYTES) throw new AppError('FILE_TOO_LARGE', 'That photo is too large (max 4 MB). Try a smaller one.')
  const t = sniff(buf)
  if (!t) throw new AppError('BAD_IMAGE', 'Please upload a JPG, PNG, WebP or GIF photo.')
  const name = `${crypto.randomUUID()}.${t.ext}`

  const s = supabase()
  if (s) {
    await ensureBucket(s)
    const res = await fetch(`${s.url}/storage/v1/object/${s.bucket}/${name}`, {
      method: 'POST',
      headers: { ...authHeaders(s.key), 'Content-Type': t.type, 'x-upsert': 'false' },
      body: new Uint8Array(buf),
    })
    if (!res.ok) throw new AppError('STORAGE_ERROR', `The photo couldn’t be saved (${res.status}). Please try again.`, 502)
    return name
  }

  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    throw new AppError('STORAGE_NOT_CONFIGURED', 'Photo storage isn’t set up yet. An administrator needs to add the Supabase storage settings.', 503)
  }
  await fs.mkdir(localDir(), { recursive: true })
  await fs.writeFile(path.join(/*turbopackIgnore: true*/ localDir(), name), buf)
  return name
}

export async function readImage(name: string): Promise<{ buf: Buffer; type: string } | null> {
  if (!/^[\w-]+\.(png|jpg|gif|webp|svg)$/.test(name)) return null
  const type = TYPES[name.split('.').pop()!]
  const s = supabase()
  if (s) {
    const res = await fetch(`${s.url}/storage/v1/object/${s.bucket}/${name}`, { headers: authHeaders(s.key) })
    if (!res.ok) return null
    return { buf: Buffer.from(await res.arrayBuffer()), type }
  }
  try {
    return { buf: await fs.readFile(path.join(/*turbopackIgnore: true*/ localDir(), name)), type }
  } catch {
    return null
  }
}

/** Seed-only: demo artwork is written as SVG to local disk. Never used in production. */
export async function writeSeedSvg(name: string, svg: string) {
  await fs.mkdir(localDir(), { recursive: true })
  await fs.writeFile(path.join(/*turbopackIgnore: true*/ localDir(), name), svg)
}
