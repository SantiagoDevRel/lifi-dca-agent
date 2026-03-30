import Anthropic from '@anthropic-ai/sdk'
import { state, addLog, addError, type SwapRecord } from './agentState'
import { recordSwap, getSessionContext, clearSessionLog } from './sessionLog'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { executeTool } = require('../tools') as {
  executeTool: (name: string, input: unknown) => Promise<unknown>
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getWalletAddress, getETHBalance } = require('../wallet') as {
  getWalletAddress: () => string
  getETHBalance: () => Promise<string>
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const toolDefs = require('../toolDefs') as unknown[]

const SYSTEM_PROMPT = `You are an autonomous DCA (Dollar-Cost Averaging) agent on Base mainnet.

Rules:
- Call get_quote then IMMEDIATELY call execute_swap — quotes expire in ~30 seconds
- Base mainnet chain ID is 8453
- If fees > 10% of swap amount, skip and explain why
- For price conditions: call get_quote first to check price. If condition not met, respond "Skipping: price condition not met — current price is $X" and stop without executing
- Keep responses concise`

function categorizeError(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('insufficient') || m.includes('balance')) return `Insufficient balance: ${msg}`
  if (m.includes('expired') || m.includes('quote')) return `Quote expired: ${msg}`
  if (m.includes('li.fi') || m.includes('lifi')) return `LI.FI API error: ${msg}`
  if (m.includes('unsupported') || m.includes('token not found')) return `Unsupported token: ${msg}`
  return msg
}

async function runIteration(): Promise<void> {
  const config = state.config
  if (!config) return

  let walletAddress: string
  let balance: string
  try {
    walletAddress = getWalletAddress()
    balance = await getETHBalance()
  } catch (err: unknown) {
    addError(`Wallet error: ${(err as Error).message}`)
    return
  }

  const iterNum = state.swaps.length + 1
  addLog('info', `━━━ Iteration ${iterNum} ━━━`)
  addLog('info', `Wallet: ${walletAddress}  Balance: ${balance} ETH`)

  const sessionCtx = getSessionContext()

  let extraInstructions = ''
  if (config.rule_type === 'price_trigger' || config.rule_type === 'price_time_combo') {
    extraInstructions += `\nPrice condition: only execute if ${config.to_token} price is ${config.price_condition} $${config.price_threshold_usd}. Call get_quote first to check. If not met, say "Skipping: price condition not met" and stop.`
  }
  if (config.rule_type === 'target_accumulation' && config.target_amount) {
    extraInstructions += `\nTarget: accumulate ${config.target_amount} ${config.to_token}. Report if target is reached after swap.`
  }

  const userMessage = `Execute the DCA rule now.
Config: ${JSON.stringify(config)}
Wallet: ${walletAddress}
ETH balance: ${balance}
${sessionCtx}${extraInstructions}

Get a quote first, then execute if reasonable and conditions are met.`

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }]

  const swapAttempt: Partial<SwapRecord> & { id: string; timestamp: string } = {
    id: `${Date.now()}`,
    timestamp: new Date().toISOString(),
    from_token: config.from_token,
    to_token: config.to_token,
    from_amount: '',
    to_amount: '',
    price_usd: '',
    tx_hash: '',
    success: false,
  }

  let attempted = false

  try {
    const client = new Anthropic()

    while (true) {
      if (state.status !== 'running') {
        addLog('info', 'Iteration interrupted')
        break
      }

      const response = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: toolDefs as Anthropic.Tool[],
        messages,
      })

      if (response.stop_reason === 'end_turn') {
        const text = response.content.find((b) => b.type === 'text')
        if (text && text.type === 'text') addLog('claude', text.text)
        break
      }

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content })
        const toolResults: Anthropic.ToolResultBlockParam[] = []

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue
          addLog('tool', `▶ ${block.name}`)

          let result: unknown
          try {
            result = await executeTool(block.name, block.input)

            if (block.name === 'get_quote') {
              const q = result as Record<string, unknown>
              const estimate = q.estimate as Record<string, unknown> | undefined
              const toAmt = estimate?.toAmount
              if (toAmt) swapAttempt.to_amount = String(toAmt)
              // Derive price: if from=ETH (18 dec), to=USDC (6 dec)
              const fromInput = block.input as Record<string, string>
              const fromAmtWei = parseFloat(fromInput.fromAmount || config.amount_wei || '0')
              const toAmtRaw = parseFloat(String(toAmt || '0'))
              if (fromAmtWei > 0 && toAmtRaw > 0) {
                // ETH→USDC: price = (toAmt / 1e6) / (fromAmt / 1e18)
                const fromEth = fromAmtWei / 1e18
                const toUSDC = toAmtRaw / 1e6
                if (fromEth > 0) {
                  swapAttempt.price_usd = (toUSDC / fromEth).toFixed(2)
                  swapAttempt.from_amount = fromEth.toFixed(6)
                }
              }
              const summary = (q as { summary?: string }).summary
              addLog('tool', `Quote: ${summary ?? JSON.stringify({ toAmount: toAmt })}`)
            } else if (block.name === 'execute_swap') {
              attempted = true
              const s = result as { txHash?: string; success?: boolean }
              if (s.txHash) {
                swapAttempt.tx_hash = s.txHash
                swapAttempt.success = true
                addLog('tx', `TX: ${s.txHash}`)
              } else {
                addLog('tool', `✓ ${JSON.stringify(result)}`)
              }
            } else if (block.name === 'get_status') {
              const st = result as { status?: string; substatus?: string; txLink?: string }
              addLog('info', `Status: ${st.status} (${st.substatus})${st.txLink ? ' → ' + st.txLink : ''}`)
            } else {
              addLog('tool', `✓ ${JSON.stringify(result)}`)
            }
          } catch (err: unknown) {
            result = { error: (err as Error).message }
            swapAttempt.error = (err as Error).message
            addError(categorizeError((err as Error).message))
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          })
        }

        messages.push({ role: 'user', content: toolResults })
      }
    }
  } catch (err: unknown) {
    swapAttempt.error = (err as Error).message
    addError(categorizeError((err as Error).message))
    attempted = true
  }

  // Record swap if an execution was attempted
  if (attempted || swapAttempt.tx_hash) {
    recordSwap(swapAttempt as SwapRecord)
  }
}

async function checkTermination(): Promise<boolean> {
  const config = state.config
  if (!config || !state.sessionStartedAt) return false

  if (config.rule_type === 'budget_session') {
    if (config.duration_minutes) {
      const elapsed = (Date.now() - state.sessionStartedAt) / 60000
      if (elapsed >= config.duration_minutes) {
        addLog('info', `Budget session: duration of ${config.duration_minutes}min reached`)
        return true
      }
    }
    if (config.total_swaps_planned) {
      const done = state.swaps.filter((s) => s.success).length
      if (done >= config.total_swaps_planned) {
        addLog('info', `Budget session: all ${config.total_swaps_planned} swaps complete`)
        return true
      }
    }
  }

  return false
}

async function autoStop(reason: 'completed' | 'error') {
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle)
    state.intervalHandle = null
  }
  state.status = 'idle'
  addLog('info', `Session ${reason} — generating summary...`)
  await generateSummary(reason)
}

export function startLoop() {
  if (!state.config) throw new Error('No config. Configure first.')
  if (state.status === 'running') return

  state.status = 'running'
  state.sessionStartedAt = Date.now()
  state.summary = null
  clearSessionLog()

  addLog('info', `▶ Session started — ${state.config.rule_type}`)
  addLog('info', `   ${state.config.instruction}`)

  const intervalMs = Math.max(state.config.interval_minutes * 60 * 1000, 30_000)

  const tick = async () => {
    if (state.status !== 'running') return
    const done = await checkTermination()
    if (done) { await autoStop('completed'); return }
    await runIteration()
  }

  void tick()

  if (state.intervalHandle) clearInterval(state.intervalHandle)
  state.intervalHandle = setInterval(async () => {
    if (state.status !== 'running') return
    const done = await checkTermination()
    if (done) { await autoStop('completed'); return }
    void runIteration()
  }, intervalMs)
}

export function pauseLoop() {
  if (state.status !== 'running') return
  state.status = 'paused'
  addLog('info', 'Agent paused — interval preserved')
}

export function resumeLoop() {
  if (state.status !== 'paused' || !state.config) return
  state.status = 'running'
  addLog('info', 'Agent resumed')
  void runIteration()
}

export async function stopLoop() {
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle)
    state.intervalHandle = null
  }
  addLog('info', 'Agent stopped — generating summary...')
  state.status = 'idle'
  await generateSummary('stopped')
  state.config = null
}

export async function generateSummary(
  endReason: 'completed' | 'stopped' | 'error' = 'stopped',
): Promise<void> {
  const swaps = state.swaps
  const config = state.config

  const successful = swaps.filter((s) => s.success)
  const failed = swaps.filter((s) => !s.success)

  const totalSpent = successful.reduce((sum, s) => sum + parseFloat(s.from_amount || '0'), 0)
  const totalReceived = successful.reduce((sum, s) => sum + parseFloat(s.to_amount || '0'), 0)

  const prices = successful.map((s) => parseFloat(s.price_usd || '0')).filter((p) => p > 0)
  const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0

  const byPrice = [...successful].sort(
    (a, b) => parseFloat(b.price_usd) - parseFloat(a.price_usd),
  )
  const bestSwap =
    byPrice[0] ? { price: byPrice[0].price_usd, tx_hash: byPrice[0].tx_hash } : null
  const worstSwap =
    byPrice[byPrice.length - 1]
      ? { price: byPrice[byPrice.length - 1].price_usd, tx_hash: byPrice[byPrice.length - 1].tx_hash }
      : null

  const durationMin = state.sessionStartedAt
    ? (Date.now() - state.sessionStartedAt) / 60000
    : 0

  let narrative = `Session ended (${endReason}). ${successful.length} of ${swaps.length} swaps successful.`

  try {
    const client = new Anthropic()
    const prompt = `Generate a brief plain-English summary (2-3 sentences) of this DCA session:
Rule: ${config?.rule_type ?? 'unknown'} — ${config?.instruction ?? ''}
Swaps: ${swaps.length} total, ${successful.length} successful, ${failed.length} failed
Spent: ${totalSpent.toFixed(6)} ${config?.from_token ?? ''}
Received: ${totalReceived.toFixed(4)} ${config?.to_token ?? ''}
Avg price: $${avgPrice.toFixed(2)}
Duration: ${durationMin.toFixed(1)} minutes
End reason: ${endReason}

Be factual and concise. Mention if any swaps failed.`

    const resp = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })
    const txt = resp.content.find((b) => b.type === 'text')
    if (txt && txt.type === 'text') narrative = txt.text
  } catch {
    // keep the fallback narrative
  }

  const now = new Date().toISOString()
  state.summary = {
    total_swaps: swaps.length,
    successful_swaps: successful.length,
    total_spent: totalSpent.toFixed(6),
    total_spent_token: config?.from_token ?? '',
    total_received: totalReceived.toFixed(4),
    total_received_token: config?.to_token ?? '',
    avg_price_usd: avgPrice > 0 ? avgPrice.toFixed(2) : '—',
    best_swap: bestSwap,
    worst_swap: worstSwap,
    duration_minutes: parseFloat(durationMin.toFixed(1)),
    started_at: state.sessionStartedAt ? new Date(state.sessionStartedAt).toISOString() : now,
    ended_at: now,
    end_reason: endReason,
    narrative,
  }

  state.emitter.emit('summary', state.summary)
  addLog('info', `Summary ready — ${narrative.slice(0, 80)}...`)
}
