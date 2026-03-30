import { NextResponse } from 'next/server'
import { state } from '@/lib/agentState'
import { pauseLoop } from '@/lib/agentRunner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  if (state.status !== 'running') {
    return NextResponse.json({ error: 'Agent is not running' }, { status: 400 })
  }
  pauseLoop()
  return NextResponse.json({ status: state.status })
}
