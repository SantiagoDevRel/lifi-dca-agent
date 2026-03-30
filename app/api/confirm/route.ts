/**
 * POST /api/confirm
 * Saves the pending config and immediately starts the agent loop.
 */
import { NextResponse } from 'next/server'
import { state, addLog } from '@/lib/agentState'
import { startLoop } from '@/lib/agentRunner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  if (!state.pendingConfig) {
    return NextResponse.json({ error: 'No pending config. Parse an instruction first.' }, { status: 400 })
  }
  if (state.status === 'running') {
    return NextResponse.json({ error: 'Agent is already running. Stop it first.' }, { status: 400 })
  }

  state.config = state.pendingConfig
  state.pendingConfig = null
  state.pendingConfirmation = null
  state.errors = []
  state.summary = null

  addLog('info', `Config confirmed: ${state.config.rule_type}`)

  startLoop()

  return NextResponse.json({ status: state.status, config: state.config })
}
