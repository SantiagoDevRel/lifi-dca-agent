/**
 * GET /api/logs — Server-Sent Events stream
 * Flushes all buffered logs on connect, then streams new ones in real time.
 * Uses ReadableStream + EventEmitter (Node.js runtime only).
 */
import { NextRequest } from 'next/server'
import { state, type LogEntry } from '@/lib/agentState'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (entry: LogEntry) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`))
        } catch {
          // Client disconnected — cleanup handled below
        }
      }

      // Flush all buffered logs so the client catches up on reconnect
      for (const entry of state.logs) {
        send(entry)
      }

      const onLog = (entry: LogEntry) => send(entry)
      state.emitter.on('log', onLog)

      // Keepalive comment every 20 s (prevents proxies and Vercel from closing idle streams)
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          clearInterval(ping)
          state.emitter.off('log', onLog)
        }
      }, 20_000)

      req.signal.addEventListener('abort', () => {
        clearInterval(ping)
        state.emitter.off('log', onLog)
        try {
          controller.close()
        } catch {
          // Already closed
        }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx/Vercel proxy buffering
    },
  })
}
