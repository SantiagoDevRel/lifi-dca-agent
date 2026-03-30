import { EventEmitter } from 'events'

export type AgentStatus = 'idle' | 'running' | 'paused'
export type LogLevel = 'info' | 'tool' | 'error' | 'claude' | 'tx'
export type RuleType =
  | 'time_dca'
  | 'budget_session'
  | 'price_trigger'
  | 'price_time_combo'
  | 'target_accumulation'

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  message: string
}

export interface AgentConfig {
  instruction: string
  rule_type: RuleType
  from_token: string
  to_token: string
  amount_wei: string
  amount_per_swap_display: string
  interval_minutes: number
  active: boolean
  // Budget session
  duration_minutes?: number
  total_swaps_planned?: number
  // Price trigger / combo
  price_condition?: 'above' | 'below'
  price_threshold_usd?: number
  // Target accumulation
  target_amount?: string
}

export interface SwapRecord {
  id: string
  timestamp: string
  from_token: string
  to_token: string
  from_amount: string
  to_amount: string
  price_usd: string
  tx_hash: string
  success: boolean
  error?: string
}

export interface SessionSummary {
  total_swaps: number
  successful_swaps: number
  total_spent: string
  total_spent_token: string
  total_received: string
  total_received_token: string
  avg_price_usd: string
  best_swap: { price: string; tx_hash: string } | null
  worst_swap: { price: string; tx_hash: string } | null
  duration_minutes: number
  started_at: string
  ended_at: string
  end_reason: 'completed' | 'stopped' | 'error'
  narrative: string
}

interface AgentStateShape {
  status: AgentStatus
  config: AgentConfig | null
  pendingConfig: AgentConfig | null
  pendingConfirmation: string | null
  logs: LogEntry[]
  errors: string[]
  swaps: SwapRecord[]
  summary: SessionSummary | null
  sessionStartedAt: number | null
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
    pendingConfig: null,
    pendingConfirmation: null,
    logs: [],
    errors: [],
    swaps: [],
    summary: null,
    sessionStartedAt: null,
    intervalHandle: null,
    emitter: new EventEmitter(),
  }
}

if (!global.__agentState) {
  global.__agentState = createState()
}

export const state = global.__agentState!

const LOG_CAP = 500

export function addLog(level: LogLevel, message: string): LogEntry {
  const entry: LogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
    level,
    message,
  }
  state.logs.push(entry)
  if (state.logs.length > LOG_CAP) state.logs.splice(0, 50)
  state.emitter.emit('log', entry)
  return entry
}

export function addError(message: string) {
  state.errors.unshift(message)
  if (state.errors.length > 20) state.errors.pop()
  addLog('error', message)
}

export function addSwap(swap: SwapRecord) {
  state.swaps.push(swap)
  state.emitter.emit('swap', swap)
}
