import { EventEmitter } from 'events'

export type AgentStatus = 'idle' | 'running' | 'paused'
export type LogLevel = 'info' | 'tool' | 'error' | 'claude' | 'tx'

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  message: string
}

export interface AgentConfig {
  instruction: string
  interval_minutes: number
  from_token: string
  to_token: string
  amount_wei: string
  active: boolean
}

export interface CostSnapshot {
  iterationInputTokens: number
  iterationOutputTokens: number
  iterationCostUSD: number
  sessionCostUSD: number
  sessionIterations: number
  lastGasCostUSD: string
}

interface AgentStateShape {
  status: AgentStatus
  config: AgentConfig | null
  logs: LogEntry[]
  costs: CostSnapshot
  errors: string[]
  intervalHandle: ReturnType<typeof setInterval> | null
  emitter: EventEmitter
}

declare global {
  // eslint-disable-next-line no-var
  var __agentState: AgentStateShape | undefined
}

function createState(): AgentStateShape {
  return {
    status: 'idle',
    config: null,
    logs: [],
    costs: {
      iterationInputTokens: 0,
      iterationOutputTokens: 0,
      iterationCostUSD: 0,
      sessionCostUSD: 0,
      sessionIterations: 0,
      lastGasCostUSD: '—',
    },
    errors: [],
    intervalHandle: null,
    emitter: new EventEmitter(),
  }
}

// Persist across Next.js hot reloads in development
if (!global.__agentState) {
  global.__agentState = createState()
}

export const state = global.__agentState!

// Per-token prices as specified
const INPUT_COST_PER_TOKEN = 0.000003
const OUTPUT_COST_PER_TOKEN = 0.000015
const LOG_CAP = 500

export function addLog(level: LogLevel, message: string): LogEntry {
  const entry: LogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
    level,
    message,
  }
  state.logs.push(entry)
  // Drop oldest 50 when cap is hit
  if (state.logs.length > LOG_CAP) state.logs.splice(0, 50)
  state.emitter.emit('log', entry)
  return entry
}

export function addError(message: string) {
  state.errors.unshift(message)
  if (state.errors.length > 20) state.errors.pop()
  addLog('error', message)
}

export function updateIterationCosts(
  inputTokens: number,
  outputTokens: number,
  gasCostUSD?: string,
) {
  const iterCost =
    inputTokens * INPUT_COST_PER_TOKEN + outputTokens * OUTPUT_COST_PER_TOKEN
  state.costs.iterationInputTokens = inputTokens
  state.costs.iterationOutputTokens = outputTokens
  state.costs.iterationCostUSD = iterCost
  state.costs.sessionCostUSD += iterCost
  state.costs.sessionIterations += 1
  if (gasCostUSD !== undefined) state.costs.lastGasCostUSD = `$${gasCostUSD}`
}
