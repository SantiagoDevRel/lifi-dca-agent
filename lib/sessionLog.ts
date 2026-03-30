import fs from 'fs'
import path from 'path'
import { state, addSwap, type SwapRecord } from './agentState'

const LOG_PATH = path.join(process.cwd(), 'session_log.json')

export function loadSessionLog() {
  try {
    if (fs.existsSync(LOG_PATH)) {
      const data = JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8'))
      if (Array.isArray(data.swaps)) state.swaps = data.swaps
    }
  } catch {
    // ignore read errors
  }
}

export function saveSessionLog() {
  try {
    fs.writeFileSync(
      LOG_PATH,
      JSON.stringify(
        {
          session_id: state.sessionStartedAt,
          rule_type: state.config?.rule_type,
          updated_at: new Date().toISOString(),
          swaps: state.swaps,
        },
        null,
        2,
      ),
    )
  } catch {
    // ignore — read-only filesystem on Vercel
  }
}

export function recordSwap(swap: SwapRecord) {
  addSwap(swap)
  saveSessionLog()
}

export function clearSessionLog() {
  state.swaps = []
  try {
    if (fs.existsSync(LOG_PATH)) fs.unlinkSync(LOG_PATH)
  } catch {
    /* ignore */
  }
}

export function getSessionContext(): string {
  const swaps = state.swaps
  const config = state.config
  if (swaps.length === 0) return 'No swaps executed yet in this session.'

  const successful = swaps.filter((s) => s.success)
  const failed = swaps.filter((s) => !s.success)

  const totalSpent = successful.reduce((sum, s) => sum + parseFloat(s.from_amount || '0'), 0)
  const totalReceived = successful.reduce((sum, s) => sum + parseFloat(s.to_amount || '0'), 0)
  const prices = successful
    .map((s) => parseFloat(s.price_usd || '0'))
    .filter((p) => p > 0)
  const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0

  let ctx = `Session so far: ${successful.length} swaps completed (${failed.length} failed).`
  ctx += ` Total spent: ${totalSpent.toFixed(6)} ${config?.from_token ?? ''}.`
  ctx += ` Total received: ~${totalReceived.toFixed(4)} ${config?.to_token ?? ''}.`
  if (avgPrice > 0) ctx += ` Avg price: $${avgPrice.toFixed(2)}.`

  if (config?.duration_minutes && state.sessionStartedAt) {
    const elapsed = (Date.now() - state.sessionStartedAt) / 60000
    const remaining = Math.max(0, config.duration_minutes - elapsed)
    ctx += ` Time remaining: ${remaining.toFixed(1)} min.`
  }
  if (config?.total_swaps_planned) {
    const remaining = config.total_swaps_planned - successful.length
    ctx += ` Swaps remaining: ${remaining}.`
  }
  if (config?.target_amount) {
    ctx += ` Target: ${config.target_amount} ${config.to_token}.`
  }

  return ctx
}
