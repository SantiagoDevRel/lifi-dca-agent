/**
 * POST /api/update
 * Mid-session natural language update. Only allows parameter changes within the
 * current rule type — switching rule types mid-session is rejected.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { state, addLog, addError } from '@/lib/agentState'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (state.status === 'idle') {
    return NextResponse.json({ error: 'No active session. Start a session first.' }, { status: 400 })
  }
  if (!state.config) {
    return NextResponse.json({ error: 'No active config.' }, { status: 400 })
  }

  const { instruction } = (await req.json()) as { instruction: string }
  if (!instruction?.trim()) {
    return NextResponse.json({ error: 'Instruction is required' }, { status: 400 })
  }

  addLog('info', `Mid-session update: "${instruction}"`)

  const UPDATE_TOOL: Anthropic.Tool = {
    name: 'apply_update',
    description: 'Apply a parameter update to the active DCA session',
    input_schema: {
      type: 'object' as const,
      properties: {
        rule_type_switch_attempt: {
          type: 'boolean',
          description: 'True if the user is trying to switch to a different rule type',
        },
        interval_minutes: { type: 'number' },
        amount_wei: { type: 'string' },
        amount_per_swap_display: { type: 'string' },
        duration_minutes: { type: 'number' },
        total_swaps_planned: { type: 'number' },
        price_threshold_usd: { type: 'number' },
        price_condition: { type: 'string', enum: ['above', 'below'] },
        target_amount: { type: 'string' },
        response_message: {
          type: 'string',
          description: 'Human-readable description of what changed, or why the update was rejected',
        },
      },
      required: ['response_message'],
    },
  }

  try {
    const client = new Anthropic()
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 512,
      system: `You process mid-session DCA updates. The active session is rule type: ${state.config.rule_type}.
You can only modify parameters of the SAME rule type. If the user tries to switch rule type, set rule_type_switch_attempt=true and explain.
Current config: ${JSON.stringify(state.config)}`,
      tools: [UPDATE_TOOL],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: instruction }],
    })

    const toolCall = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'apply_update',
    )

    if (!toolCall) {
      return NextResponse.json({ error: 'Could not process update' }, { status: 422 })
    }

    const update = toolCall.input as {
      rule_type_switch_attempt?: boolean
      interval_minutes?: number
      amount_wei?: string
      amount_per_swap_display?: string
      duration_minutes?: number
      total_swaps_planned?: number
      price_threshold_usd?: number
      price_condition?: 'above' | 'below'
      target_amount?: string
      response_message: string
    }

    if (update.rule_type_switch_attempt) {
      addLog('error', `Update rejected: cannot switch rule type mid-session`)
      return NextResponse.json(
        { error: `Cannot switch rule type mid-session. Current type: ${state.config.rule_type}. Stop and start a new session.`, message: update.response_message },
        { status: 400 },
      )
    }

    // Apply valid updates
    if (update.interval_minutes) state.config.interval_minutes = update.interval_minutes
    if (update.amount_wei) state.config.amount_wei = update.amount_wei
    if (update.amount_per_swap_display) state.config.amount_per_swap_display = update.amount_per_swap_display
    if (update.duration_minutes) state.config.duration_minutes = update.duration_minutes
    if (update.total_swaps_planned) state.config.total_swaps_planned = update.total_swaps_planned
    if (update.price_threshold_usd) state.config.price_threshold_usd = update.price_threshold_usd
    if (update.price_condition) state.config.price_condition = update.price_condition
    if (update.target_amount) state.config.target_amount = update.target_amount

    // Update interval timer if interval changed
    if (update.interval_minutes && state.intervalHandle) {
      clearInterval(state.intervalHandle)
      const newMs = Math.max(update.interval_minutes * 60 * 1000, 30_000)
      const { startLoop } = await import('@/lib/agentRunner')
      state.intervalHandle = setInterval(() => {
        if (state.status === 'running') void import('@/lib/agentRunner').then(m => m.resumeLoop())
      }, newMs)
    }

    addLog('info', `Update applied: ${update.response_message}`)
    return NextResponse.json({ message: update.response_message, config: state.config })
  } catch (err: unknown) {
    addError((err as Error).message)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
