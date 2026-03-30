import { NextResponse } from 'next/server'
import { state } from '@/lib/agentState'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    status: state.status,
    config: state.config,
    costs: state.costs,
    errors: state.errors,
    logCount: state.logs.length,
  })
}
