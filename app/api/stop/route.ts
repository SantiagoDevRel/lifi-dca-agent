import { NextResponse } from 'next/server'
import { stopLoop } from '@/lib/agentRunner'
import { state } from '@/lib/agentState'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  stopLoop()
  return NextResponse.json({ status: state.status })
}
