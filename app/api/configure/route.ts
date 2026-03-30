/**
 * POST /api/configure
 * Sends the instruction to Claude with only the save_config tool.
 * Intercepts the tool_use result and stores parsed config in state —
 * never calls tools.js or wallet.js (avoids fs.writeFileSync on Vercel
 * and avoids wallet.js module-load crash if PRIVATE_KEY is not needed yet).
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { state, addLog, type AgentConfig } from '@/lib/agentState'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const allToolDefs = require('../../../toolDefs') as Anthropic.Tool[]

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { instruction, intervalSeconds } = body as {
      instruction: string
      intervalSeconds?: number
    }

    if (!instruction?.trim()) {
      return NextResponse.json({ error: 'Instruction is required' }, { status: 400 })
    }

    addLog('info', `Configuring: "${instruction}"`)

    const saveConfigTool = allToolDefs.find((t) => t.name === 'save_config')
    if (!saveConfigTool) {
      return NextResponse.json({ error: 'save_config tool definition not found' }, { status: 500 })
    }

    const client = new Anthropic()
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      tools: [saveConfigTool],
      tool_choice: { type: 'any' }, // force Claude to call the tool
      messages: [
        {
          role: 'user',
          content: `Parse this DCA instruction and call save_config with the correct parameters: "${instruction}"`,
        },
      ],
    })

    const toolCall = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'save_config',
    )

    if (!toolCall) {
      return NextResponse.json(
        { error: 'Claude could not parse the instruction. Try: "swap 0.001 ETH to USDC every 5 minutes"' },
        { status: 422 },
      )
    }

    const parsed = toolCall.input as {
      instruction: string
      interval_minutes: number
      from_token: string
      to_token: string
      amount_wei: string
    }

    // Override interval if the UI picker provided one
    let interval_minutes = parsed.interval_minutes
    if (intervalSeconds && intervalSeconds > 0) {
      interval_minutes = intervalSeconds / 60
    }

    const config: AgentConfig = {
      instruction,
      interval_minutes,
      from_token: parsed.from_token,
      to_token: parsed.to_token,
      amount_wei: parsed.amount_wei,
      active: true,
    }

    // Store in global state — no disk write (safe on Vercel)
    state.config = config

    addLog(
      'info',
      `Config: ${config.from_token} → ${config.to_token}, ${config.amount_wei} wei, every ${interval_minutes}min`,
    )

    return NextResponse.json({ config })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
