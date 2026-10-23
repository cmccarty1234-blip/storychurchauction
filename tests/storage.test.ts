import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readImage, saveImage, storageBackend } from '@/lib/storage'
import { pgConfig } from '@/lib/pgconfig'
import { appUrl } from '@/lib/appurl'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64)])

describe('Supabase Storage backend (mocked network)', () => {
  const calls: { url: string; init?: RequestInit }[] = []
  beforeEach(() => {
    calls.length = 0
    process.env.SUPABASE_URL = 'https://abc.supabase.co/'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.endsWith('/storage/v1/bucket')) return new Response('{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}', { status: 400 })
      if (init?.method === 'POST') return new Response('{}', { status: 200 })
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  it('uploads to a private bucket with the service key, tolerating "bucket already exists"', async () => {
    expect(storageBackend()).toBe('supabase')
    const name = await saveImage(PNG)
    expect(name).toMatch(/^[0-9a-f-]{36}\.png$/)
    const upload = calls.find((c) => c.url.includes('/storage/v1/object/'))!
    expect(upload.url).toBe(`https://abc.supabase.co/storage/v1/object/item-images/${name}`)
    expect((upload.init!.headers as Record<string, string>).Authorization).toBe('Bearer service-key')
    expect((upload.init!.headers as Record<string, string>)['Content-Type']).toBe('image/png')
  })

  it('sends the newer sb_secret_ keys in the apikey header only (they are not JWTs)', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_abc123'
    await saveImage(PNG)
    const upload = calls.find((c) => c.url.includes('/storage/v1/object/'))!
    const h = upload.init!.headers as Record<string, string>
    expect(h.apikey).toBe('sb_secret_abc123')
    expect(h.Authorization).toBeUndefined()
  })

  it('reads through the server (never exposes the key) and rejects odd names', async () => {
    const img = await readImage('11111111-1111-1111-1111-111111111111.png')
    expect(img?.type).toBe('image/png')
    expect(img?.buf.length).toBe(3)
    expect(await readImage('../../etc/passwd')).toBeNull()
  })

  it('rejects non-images and oversize files before touching the network', async () => {
    await expect(saveImage(Buffer.from('<svg onload=alert(1)>'))).rejects.toMatchObject({ code: 'BAD_IMAGE' })
    await expect(saveImage(Buffer.alloc(4 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
    expect(calls).toHaveLength(0)
  })
})

describe('production without storage settings', () => {
  it('refuses to write to the (ephemeral) disk', async () => {
    const prev = process.env.NODE_ENV
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    try {
      await expect(saveImage(PNG)).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' })
    } finally {
      ;(process.env as Record<string, string>).NODE_ENV = prev
    }
  })
})

describe('connection + URL helpers', () => {
  it('uses TLS (relaxed chain check) for hosted Postgres and strips sslmode; stays plain for localhost', () => {
    const hosted = pgConfig('postgresql://postgres.abc:pw@aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require')
    expect(hosted.ssl).toEqual({ rejectUnauthorized: false })
    expect(hosted.connectionString).not.toContain('sslmode')
    expect(pgConfig('postgres://postgres@127.0.0.1:54329/storychurch').ssl).toBeUndefined()
  })

  it('derives the public URL on Vercel when none is set, and an explicit setting wins', () => {
    const save = { a: process.env.NEXT_PUBLIC_APP_URL, v: process.env.VERCEL_PROJECT_PRODUCTION_URL }
    delete process.env.NEXT_PUBLIC_APP_URL
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'storychurchauction.vercel.app'
    expect(appUrl()).toBe('https://storychurchauction.vercel.app')
    process.env.NEXT_PUBLIC_APP_URL = 'https://auction.storychurch.co/'
    expect(appUrl()).toBe('https://auction.storychurch.co')
    if (save.a === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = save.a
    if (save.v === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL; else process.env.VERCEL_PROJECT_PRODUCTION_URL = save.v
  })
})
