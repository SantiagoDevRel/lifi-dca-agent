/**
 * POST /api/configure
 * Parses a natural language instruction, identifies one of 5 rule types,
 * and returns a pending config + confirmation text for the user to approve.
 * Config is NOT saved until POST /api/confirm.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { state, addLog, type AgentConfig, type RuleType } from '@/lib/agentState'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PARSE_TOOL: Anthropic.Tool = {
  name: 'parse_dca_instruction',
  description: 'Parse a DCA instruction into structured parameters. Call this for every instruction, whether it matches a rule type or not.',
  input_schema: {
    type: 'object' as const,
    properties: {
      rule_type: {
        type: 'string',
        enum: ['time_dca', 'budget_session', 'price_trigger', 'price_time_combo', 'target_accumulation'],
        description: 'The matched rule type',
      },
      from_token: { type: 'string', description: 'Source token (e.g. ETH, USDC)' },
      to_token: { type: 'string', description: 'Destination token' },
      amount_wei: { type: 'string', description: 'Amount per swap in wei (18 decimals for ETH, 6 for USDC)' },
      amount_per_swap_display: { type: 'string', description: 'Human-readable amount, e.g. "0.001 ETH"' },
      interval_minutes: { type: 'number', description: 'Interval between swaps in minutes' },
      duration_minutes: { type: 'number', description: 'budget_session only: total session duration in minutes' },
      total_swaps_planned: { type: 'number', description: 'budget_session only: total number of swaps (duration / interval)' },
      price_condition: { type: 'string', enum: ['above', 'below'] },
      price_threshold_usd: { type: 'number', description: 'USD price threshold for price_trigger/combo' },
      target_amount: { type: 'string', description: 'target_accumulation only: target balance in to_token units' },
      confirmation_text: {
        type: 'string',
        description: 'Human-readable confirmation. For valid rules: "I understood this as a [Rule Type]: [details]. Confirm?". For invalid: list supported types with examples.',
      },
      clarification_needed: {
        type: 'string',
        description: 'Set this if the instruction does NOT match any supported rule type. Explain what is needed.',
      },
    },
    required: ['confirmation_text'],
  },
}

const SYSTEM_PROMPT = `You parse DCA (Dollar-Cost Averaging) instructions and identify which of 5 supported rule types they match.

Supported rule types:
1. time_dca — "swap X token every N minutes" (regular interval, no end condition)
2. budget_session — "swap X token every N minutes for Y hours/minutes" (fixed duration or budget)
3. price_trigger — "buy/sell X amount when price drops/rises above/below $N" (condition-based, no interval)
4. price_time_combo — "swap X token every N minutes only if price is above/below $N" (interval + price condition)
5. target_accumulation — "buy X token every N minutes until I hold Y amount" (interval until target)

If the instruction matches a rule type:
- Extract all parameters
- Convert amounts to wei (ETH: multiply by 1e18, USDC: multiply by 1e6)
- Set confirmation_text like: "I understood this as a Budget Session: swap 0.001 ETH → USDC every 5 minutes for 1 hour (12 swaps, 0.012 ETH total). Confirm?"

If the instruction does NOT clearly match any type:
- Set clarification_needed explaining what's wrong
- Set confirmation_text listing the 5 supported types with one example each

Always call parse_dca_instruction.`

export async function POST(req: NextRequest) {
  try {
    const { instruction } = (await req.json()) as { instruction: string }

    if (!instruction?.trim()) {
      return NextResponse.json({ error: 'Instruction is required' }, { status: 400 })
    }

    addLog('info', `Parsing: "${instruction}"`)

    const client = new Anthropic()
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [PARSE_TOOL],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: instruction }],
    })

    const toolCall = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === 'tool_use' && b.name === 'parse_dca_instruction',
    )

    if (!toolCall) {
      return NextResponse.json({ error: 'Failed to parse instruction' }, { status: 422 })
    }

    const parsed = toolCall.input as {
      rule_type?: RuleType
      from_token?: string
      to_token?: string
      amount_wei?: string
      amount_per_swap_display?: string
      interval_minutes?: number
      duration_minutes?: number
      total_swaps_planned?: number
      price_condition?: 'above' | 'below'
      price_threshold_usd?: number
      target_amount?: string
      confirmation_text: string
      clarification_needed?: string
    }

    // Instruction didn't match any rule type
    if (parsed.clarification_needed || !parsed.rule_type) {
      addLog('info', `Clarification needed: ${parsed.clarification_needed ?? 'unknown rule type'}`)
      return NextResponse.json({
        clarification: parsed.clarification_needed ?? parsed.confirmation_text,
        confirmation_text: parsed.confirmation_text,
      })
    }

    const config: AgentConfig = {
      instruction,
      rule_type: parsed.rule_type,
      from_token: parsed.from_token ?? 'ETH',
      to_token: parsed.to_token ?? 'USDC',
      amount_wei: parsed.amount_wei ?? '1000000000000000',
      amount_per_swap_display: parsed.amount_per_swap_display ?? '',
      interval_minutes: parsed.interval_minutes ?? 5,
      active: true,
      duration_minutes: parsed.duration_minutes,
      total_swaps_planned: parsed.total_swaps_planned,
      price_condition: parsed.price_condition,
      price_threshold_usd: parsed.price_threshold_usd,
      target_amount: parsed.target_amount,
    }

    // Store as pending — not confirmed yet
    state.pendingConfig = config
    state.pendingConfirmation = parsed.confirmation_text

    addLog('info', `Parsed as ${config.rule_type}: ${parsed.confirmation_text.slice(0, 80)}`)

    return NextResponse.json({
      pending_config: config,
      confirmation_text: parsed.confirmation_text,
      rule_type: config.rule_type,
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
