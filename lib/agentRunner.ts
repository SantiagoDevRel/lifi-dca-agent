/**
 * agentRunner.ts
 * Wraps the existing DCA agent loop for use by Next.js API routes.
 * - Lazy-requires tools.js and wallet.js (avoids wallet.js module-load crash if PRIVATE_KEY missing)
 * - Uses setInterval instead of node-cron for seconds/minutes/hours flexibility
 * - Emits LogEntry events via state.emitter for SSE streaming
 *
 * NOTE on Vercel: setInterval lives as long as the Node.js process.
 * On Vercel Serverless, the process is frozen after the response is sent,
 * which means the interval stops. For persistent loops, deploy to a
 * long-running server (Railway, Render, Fly.io) or use Vercel Cron Jobs.
 */
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { state, addLog, addError, updateIterationCosts } from './agentState'

// Lazy CJS imports — deferred until run time so wallet.js module-load
// (which reads PRIVATE_KEY) only happens when the user actually clicks Run
function getTools() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(process.cwd(), 'tools.js')) as {
    executeTool: (name: string, input: unknown) => Promise<unknown>
  }
}

function getWallet() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(process.cwd(), 'wallet.js')) as {
    getWalletAddress: () => string
    getETHBalance: () => Promise<string>
  }
}

function getToolDefs() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(process.cwd(), 'toolDefs.js')) as unknown[]
}

const SYSTEM_PROMPT = `You are an autonomous DCA (Dollar-Cost Averaging) agent managing a crypto wallet on Base mainnet.

Your job:
- When running autonomously, call get_quote to check the current swap, then call execute_swap to execute it
- After executing, optionally call get_status to confirm the transfer

Rules:
- Always call get_quote then IMMEDIATELY call execute_swap in the same response — no intermediate reasoning between them
- Never call get_quote and wait — quotes expire in ~30 seconds
- Base mainnet chain ID is 8453
- Keep responses concise — you are logging to a terminal, not chatting
- If a quote looks unreasonable (fees > 10% of amount), skip and log why`

function categorizeError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('insufficient') || m.includes('balance')) return `Insufficient balance: ${message}`
  if (m.includes('expired') || m.includes('quote')) return `Quote expired: ${message}`
  if (m.includes('li.fi') || m.includes('lifi')) return `LI.FI API error: ${message}`
  if (m.includes('unsupported') || m.includes('token not found')) return `Unsupported token: ${message}`
  return message
}

async function runIteration() {
  const { executeTool } = getTools()
  const { getWalletAddress, getETHBalance } = getWallet()
  const toolDefs = getToolDefs()
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

  const iterNum = state.costs.sessionIterations + 1
  addLog('info', `━━━ Iteration ${iterNum} ━━━`)
  addLog('info', `Wallet: ${walletAddress}  Balance: ${balance} ETH`)

  const userMessage = `Run the DCA rule now.
Config: ${JSON.stringify(config)}
Wallet address: ${walletAddress}
Current ETH balance: ${balance} ETH
Execute the swap as configured. Get a quote first, then execute if reasonable.`

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }]
  let totalInput = 0
  let totalOutput = 0
  let lastGasCost: string | undefined

  try {
    const client = new Anthropic()

    while (true) {
      if (state.status !== 'running') {
        addLog('info', 'Iteration interrupted (agent paused or stopped)')
        break
      }

      const response = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: toolDefs as Anthropic.Tool[],
        messages,
      })

      totalInput += response.usage.input_tokens
      totalOutput += response.usage.output_tokens

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

          addLog('tool', `▶ ${block.name}(${JSON.stringify(block.input)})`)

          let result: unknown
          try {
            result = await executeTool(block.name, block.input)

            if (block.name === 'get_quote') {
              const q = result as { gasCostUSD?: string; summary?: string }
              if (q.gasCostUSD) lastGasCost = String(q.gasCostUSD)
              addLog('tool', `Quote: ${q.summary ?? JSON.stringify(result)}`)
            } else if (block.name === 'execute_swap') {
              const s = result as { txHash?: string }
              if (s.txHash) addLog('tx', `TX: ${s.txHash}`)
              else addLog('tool', `✓ ${JSON.stringify(result)}`)
            } else if (block.name === 'get_status') {
              const st = result as { status?: string; substatus?: string; txLink?: string }
              addLog('info', `Status: ${st.status} (${st.substatus})${st.txLink ? ' — ' + st.txLink : ''}`)
            } else {
              addLog('tool', `✓ ${JSON.stringify(result)}`)
            }
          } catch (err: unknown) {
            result = { error: (err as Error).message }
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
    addError(categorizeError((err as Error).message))
  }

  updateIterationCosts(totalInput, totalOutput, lastGasCost)
}

export function startLoop() {
  if (!state.config) throw new Error('No config set. Configure first.')
  if (state.status === 'running') return

  state.status = 'running'
  addLog('info', `Agent started — ${state.config.instruction}`)
  addLog('info', `Interval: every ${state.config.interval_minutes} min`)

  // Minimum 30 seconds to avoid hammering APIs
  const intervalMs = Math.max(state.config.interval_minutes * 60 * 1000, 30_000)

  // Fire first iteration immediately (background — don't block the HTTP response)
  void runIteration()

  if (state.intervalHandle) clearInterval(state.intervalHandle)
  state.intervalHandle = setInterval(() => {
    if (state.status === 'running') void runIteration()
  }, intervalMs)
}

export function pauseLoop() {
  if (state.status !== 'running') return
  state.status = 'paused'
  // Interval keeps ticking but runIteration() is skipped while paused
  addLog('info', 'Agent paused — config preserved, next tick skipped until resumed')
}

export function resumeLoop() {
  if (state.status !== 'paused' || !state.config) return
  state.status = 'running'
  addLog('info', 'Agent resumed')
  // Fire an iteration immediately on resume
  void runIteration()
}

export function stopLoop() {
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle)
    state.intervalHandle = null
  }
  addLog('info', 'Agent stopped — config cleared')
  state.status = 'idle'
  state.config = null
  state.errors = []
}
