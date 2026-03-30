import { NextResponse } from 'next/server'
import { state } from '@/lib/agentState'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const successful = state.swaps.filter((s) => s.success).length
  const elapsed = state.sessionStartedAt
    ? (Date.now() - state.sessionStartedAt) / 60000
    : 0

  return NextResponse.json({
    status: state.status,
    config: state.config,
    errors: state.errors,
    logCount: state.logs.length,
    swapCount: state.swaps.length,
    successfulSwaps: successful,
    elapsed_minutes: parseFloat(elapsed.toFixed(1)),
    summary: state.summary,
    pendingConfirmation: state.pendingConfirmation,
  })
}
