'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentStatus = 'idle' | 'running' | 'paused'
type LogLevel = 'info' | 'tool' | 'error' | 'claude' | 'tx'
type IntervalUnit = 'seconds' | 'minutes' | 'hours'

interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  message: string
}

interface CostSnapshot {
  iterationInputTokens: number
  iterationOutputTokens: number
  iterationCostUSD: number
  sessionCostUSD: number
  sessionIterations: number
  lastGasCostUSD: string
}

interface AgentConfig {
  instruction: string
  interval_minutes: number
  from_token: string
  to_token: string
  amount_wei: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: 'text-slate-300',
  tool: 'text-blue-400',
  error: 'text-red-400',
  claude: 'text-emerald-400',
  tx: 'text-yellow-400',
}

const LEVEL_PREFIX: Record<LogLevel, string> = {
  info: '   ',
  tool: '⚙  ',
  error: '✗  ',
  claude: '◈  ',
  tx: '⛓  ',
}

const DEFAULT_COSTS: CostSnapshot = {
  iterationInputTokens: 0,
  iterationOutputTokens: 0,
  iterationCostUSD: 0,
  sessionCostUSD: 0,
  sessionIterations: 0,
  lastGasCostUSD: '—',
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AgentStatus }) {
  const dot =
    status === 'running'
      ? 'bg-emerald-500 animate-pulse'
      : status === 'paused'
        ? 'bg-yellow-500'
        : 'bg-slate-600'
  const label = { idle: 'Idle', running: 'Running', paused: 'Paused' }[status]
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      {label}
    </span>
  )
}

function CostRow({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-500">{label}</span>
      <span className={highlight ? 'text-white font-semibold' : 'text-slate-300'}>{value}</span>
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">
      {children}
    </h2>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [costs, setCosts] = useState<CostSnapshot>(DEFAULT_COSTS)
  const [errors, setErrors] = useState<string[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])

  // Form state
  const [instruction, setInstruction] = useState('')
  const [intervalValue, setIntervalValue] = useState('5')
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>('minutes')

  // UI state
  const [configuring, setConfiguring] = useState(false)
  const [apiError, setApiError] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)

  const logRef = useRef<HTMLDivElement>(null)

  // ── Fetch initial status on mount ────────────────────────────────────────
  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((data) => {
        setStatus(data.status)
        setConfig(data.config)
        setCosts(data.costs ?? DEFAULT_COSTS)
        setErrors(data.errors ?? [])
      })
      .catch(console.error)
  }, [])

  // ── SSE log stream ────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/api/logs')

    es.onmessage = (e) => {
      try {
        const entry: LogEntry = JSON.parse(e.data)
        setLogs((prev) => {
          const next = [...prev, entry]
          return next.length > 500 ? next.slice(-500) : next
        })
        if (entry.level === 'error') {
          setErrors((prev) => [entry.message, ...prev.slice(0, 19)])
        }
      } catch {
        // ignore malformed events
      }
    }

    es.onerror = () => {
      // EventSource reconnects automatically — no action needed
    }

    return () => es.close()
  }, [])

  // ── Poll status while running ─────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'running') return
    const id = setInterval(() => {
      fetch('/api/status')
        .then((r) => r.json())
        .then((data) => {
          setStatus(data.status)
          setCosts(data.costs ?? DEFAULT_COSTS)
        })
        .catch(console.error)
    }, 3000)
    return () => clearInterval(id)
  }, [status])

  // ── Auto-scroll log feed ──────────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  // ── Handlers ──────────────────────────────────────────────────────────────

  const intervalToSeconds = useCallback((): number => {
    const n = parseFloat(intervalValue) || 5
    if (intervalUnit === 'seconds') return n
    if (intervalUnit === 'minutes') return n * 60
    return n * 3600
  }, [intervalValue, intervalUnit])

  const handleConfigure = async () => {
    if (!instruction.trim()) return
    setConfiguring(true)
    setApiError('')

    try {
      const res = await fetch('/api/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, intervalSeconds: intervalToSeconds() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setApiError(data.error ?? 'Configure failed')
      } else {
        setConfig(data.config)
        setApiError('')
      }
    } catch (err: unknown) {
      setApiError((err as Error).message)
    } finally {
      setConfiguring(false)
    }
  }

  const handleRun = async () => {
    setApiError('')
    const res = await fetch('/api/run', { method: 'POST' })
    const data = await res.json()
    if (res.ok) {
      setStatus('running')
    } else {
      setApiError(data.error ?? 'Failed to start')
    }
  }

  const handlePause = async () => {
    const res = await fetch('/api/pause', { method: 'POST' })
    if (res.ok) setStatus('paused')
  }

  const handleStop = async () => {
    const res = await fetch('/api/stop', { method: 'POST' })
    if (res.ok) {
      setStatus('idle')
      setConfig(null)
      setCosts(DEFAULT_COSTS)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-white">LiFi DCA Agent</h1>
          <p className="text-xs text-slate-500 mt-0.5">Autonomous dollar-cost averaging on Base mainnet</p>
        </div>
        <StatusBadge status={status} />
      </header>

      {/* ── Configuration panel ── */}
      <section className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-4">
        <SectionHeader>Configuration</SectionHeader>

        <div className="space-y-3">
          {/* Instruction input */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Natural language instruction</label>
            <input
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !configuring && handleConfigure()}
              placeholder="e.g. swap 0.001 ETH to USDC every 5 minutes"
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100
                         placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1
                         focus:ring-blue-500 transition-colors"
            />
          </div>

          {/* Interval override + parsed config */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Interval override</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={intervalValue}
                  onChange={(e) => setIntervalValue(e.target.value)}
                  min="1"
                  className="w-20 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100
                             focus:outline-none focus:border-blue-500 transition-colors"
                />
                <select
                  value={intervalUnit}
                  onChange={(e) => setIntervalUnit(e.target.value as IntervalUnit)}
                  className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100
                             focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
                >
                  <option value="seconds">seconds</option>
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                </select>
              </div>
            </div>

            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Parsed config</label>
              {config ? (
                <div className="flex items-center gap-2 h-9 px-3 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300">
                  <span className="text-blue-400">{config.from_token}</span>
                  <span className="text-slate-600">→</span>
                  <span className="text-emerald-400">{config.to_token}</span>
                  <span className="text-slate-600">·</span>
                  <span>{config.interval_minutes}min interval</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-500 truncate">{config.amount_wei} wei</span>
                </div>
              ) : (
                <div className="flex items-center h-9 px-3 bg-slate-800 border border-slate-700 border-dashed rounded text-xs text-slate-600">
                  not configured
                </div>
              )}
            </div>
          </div>

          {/* API error */}
          {apiError && (
            <div className="flex items-start gap-2 text-xs text-red-400 bg-red-950/40 border border-red-800/50 rounded px-3 py-2">
              <span className="shrink-0 mt-0.5">✗</span>
              <span>{apiError}</span>
            </div>
          )}

          {/* Control buttons */}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={handleConfigure}
              disabled={configuring || !instruction.trim()}
              className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600
                         disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed
                         transition-colors font-medium"
            >
              {configuring ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
                  Parsing...
                </span>
              ) : (
                'Configure'
              )}
            </button>

            <button
              onClick={handleRun}
              disabled={!config || status === 'running'}
              className="px-4 py-2 text-sm rounded bg-emerald-700 hover:bg-emerald-600
                         disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed
                         transition-colors font-semibold"
            >
              ▶ Run
            </button>

            <button
              onClick={handlePause}
              disabled={status !== 'running'}
              className="px-4 py-2 text-sm rounded bg-yellow-700 hover:bg-yellow-600
                         disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed
                         transition-colors"
            >
              ⏸ Pause
            </button>

            <button
              onClick={handleStop}
              disabled={status === 'idle'}
              className="px-4 py-2 text-sm rounded bg-red-800 hover:bg-red-700
                         disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed
                         transition-colors"
            >
              ■ Stop
            </button>
          </div>
        </div>
      </section>

      {/* ── Main grid: log feed + side panel ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Log feed */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-lg flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
            <SectionHeader>Live Log</SectionHeader>
            <div className="flex items-center gap-4 -mt-3">
              <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="w-3 h-3 accent-blue-500"
                />
                Auto-scroll
              </label>
              <button
                onClick={() => setLogs([])}
                className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
              >
                Clear
              </button>
              <span className="text-xs text-slate-700">{logs.length} lines</span>
            </div>
          </div>

          <div
            ref={logRef}
            className="log-scroll overflow-y-auto p-3 min-h-72 max-h-[480px] space-y-0.5 text-xs leading-5"
          >
            {logs.length === 0 ? (
              <div className="text-slate-700 text-center py-12">
                No logs yet — configure and run the agent
              </div>
            ) : (
              logs.map((entry) => (
                <div key={entry.id} className={`flex gap-2 ${LEVEL_COLOR[entry.level]}`}>
                  <span className="shrink-0 text-slate-700 tabular-nums">{entry.timestamp}</span>
                  <span className="shrink-0">{LEVEL_PREFIX[entry.level]}</span>
                  <span className="break-all">{entry.message}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Side panel */}
        <div className="flex flex-col gap-4">
          {/* Cost tracker */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <SectionHeader>Cost Tracker</SectionHeader>

            <div className="space-y-4">
              {/* This iteration */}
              <div>
                <p className="text-xs text-slate-600 mb-2">This iteration</p>
                <div className="space-y-1.5">
                  <CostRow
                    label="Input tokens"
                    value={costs.iterationInputTokens.toLocaleString()}
                  />
                  <CostRow
                    label="Output tokens"
                    value={costs.iterationOutputTokens.toLocaleString()}
                  />
                  <CostRow
                    label="Claude cost"
                    value={`$${costs.iterationCostUSD.toFixed(5)}`}
                    highlight
                  />
                </div>
              </div>

              <div className="border-t border-slate-800 pt-3">
                <p className="text-xs text-slate-600 mb-2">Session total</p>
                <div className="space-y-1.5">
                  <CostRow
                    label="Claude cost"
                    value={`$${costs.sessionCostUSD.toFixed(5)}`}
                    highlight
                  />
                  <CostRow label="Iterations" value={String(costs.sessionIterations)} />
                  <CostRow
                    label="Avg / iteration"
                    value={
                      costs.sessionIterations > 0
                        ? `$${(costs.sessionCostUSD / costs.sessionIterations).toFixed(5)}`
                        : '—'
                    }
                  />
                </div>
              </div>

              <div className="border-t border-slate-800 pt-3">
                <p className="text-xs text-slate-600 mb-2">Last transaction</p>
                <CostRow label="Gas cost (USD)" value={costs.lastGasCostUSD} highlight />
              </div>
            </div>
          </div>

          {/* Error panel */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <SectionHeader>Errors</SectionHeader>
              {errors.length > 0 && (
                <button
                  onClick={() => setErrors([])}
                  className="text-xs text-slate-600 hover:text-slate-400 -mt-3 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>

            {errors.length === 0 ? (
              <div className="text-xs text-slate-700">No errors</div>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto log-scroll">
                {errors.map((err, i) => (
                  <div
                    key={i}
                    className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded px-2.5 py-2 break-all leading-relaxed"
                  >
                    {err}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Vercel note */}
          <div className="bg-slate-900/50 border border-slate-800/50 rounded-lg p-3 text-xs text-slate-600 leading-relaxed">
            <span className="text-slate-500 font-medium">Note:</span> The agent loop runs in the
            server process. On Vercel Serverless, the loop lives while this tab is open. For
            persistent 24/7 operation, deploy to Railway, Render, or Fly.io.
          </div>
        </div>
      </div>
    </div>
  )
}
