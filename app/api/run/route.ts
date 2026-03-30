import { NextResponse } from 'next/server'
import { state } from '@/lib/agentState'
import { startLoop, resumeLoop } from '@/lib/agentRunner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    if (!state.config) {
      return NextResponse.json({ error: 'No config. Use /api/configure first.' }, { status: 400 })
    }
    if (state.status === 'running') {
      return NextResponse.json({ error: 'Agent is already running' }, { status: 400 })
    }

    if (state.status === 'paused') {
      resumeLoop()
    } else {
      startLoop() // synchronous — fires background iteration, returns immediately
    }

    return NextResponse.json({ status: state.status })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
