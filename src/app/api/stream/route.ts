import { subscribe } from '@/lib/realtime'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Server-Sent Events: a tiny "something changed" signal. Clients re-fetch their own (authorised) view. */
export async function GET(req: Request) {
  const enc = new TextEncoder()
  let cleanup = () => {}
  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s))
        } catch {
          cleanup()
        }
      }
      send('retry: 2000\n\n: connected\n\n')
      const unsub = subscribe((m) => send(`data: ${JSON.stringify(m)}\n\n`))
      const ping = setInterval(() => send(': ping\n\n'), 20_000)
      cleanup = () => {
        clearInterval(ping)
        unsub()
        try {
          controller.close()
        } catch {}
      }
      req.signal.addEventListener('abort', cleanup)
    },
    cancel() {
      cleanup()
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  })
}
