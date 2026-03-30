'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentStatus = 'idle' | 'running' | 'paused'
type RuleType = 'time_dca' | 'budget_session' | 'price_trigger' | 'price_time_combo' | 'target_accumulation'
type LogLevel = 'info' | 'tool' | 'error' | 'claude' | 'tx'

interface LogEntry { id: string; timestamp: string; level: LogLevel; message: string }
interface SwapRecord {
  id: string; timestamp: string; from_token: string; to_token: string
  from_amount: string; to_amount: string; price_usd: string; tx_hash: string
  success: boolean; error?: string
}
interface SessionSummary {
  total_swaps: number; successful_swaps: number
  total_spent: string; total_spent_token: string
  total_received: string; total_received_token: string
  avg_price_usd: string
  best_swap: { price: string; tx_hash: string } | null
  worst_swap: { price: string; tx_hash: string } | null
  duration_minutes: number; started_at: string; ended_at: string
  end_reason: string; narrative: string
}
interface AgentConfig {
  instruction: string; rule_type: RuleType; from_token: string; to_token: string
  amount_wei: string; amount_per_swap_display: string; interval_minutes: number
  duration_minutes?: number; total_swaps_planned?: number
  price_condition?: 'above' | 'below'; price_threshold_usd?: number; target_amount?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RULE_LABELS: Record<RuleType, string> = {
  time_dca: 'Time DCA',
  budget_session: 'Budget Session',
  price_trigger: 'Price Trigger',
  price_time_combo: 'Price + Time',
  target_accumulation: 'Target Accumulation',
}
const RULE_DESCRIPTIONS: Record<RuleType, string> = {
  time_dca: 'Swap a fixed amount at regular intervals, indefinitely.',
  budget_session: 'Swap at regular intervals for a fixed duration.',
  price_trigger: 'Execute a swap when price crosses a threshold.',
  price_time_combo: 'Swap at intervals, but skip if price condition is not met.',
  target_accumulation: 'Buy at intervals until you hold a target balance.',
}
const RULE_BADGE: Record<RuleType, string> = {
  time_dca: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  budget_session: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  price_trigger: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  price_time_combo: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  target_accumulation: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
}
const LOG_COLOR: Record<LogLevel, string> = {
  info: 'text-zinc-400', tool: 'text-sky-400', error: 'text-red-400',
  claude: 'text-emerald-400', tx: 'text-amber-400',
}
const LOG_PREFIX: Record<LogLevel, string> = {
  info: '  ', tool: '⚙ ', error: '✗ ', claude: '◈ ', tx: '⛓ ',
}
const TOKENS = ['ETH', 'USDC', 'WBTC', 'cbETH', 'USDbC', 'DAI', 'USDT']

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  fromToken: string; toToken: string; amount: string
  intervalValue: string; intervalUnit: 'seconds' | 'minutes' | 'hours'
  durationValue: string; durationUnit: 'minutes' | 'hours'
  condition: 'above' | 'below'; priceThreshold: string; targetAmount: string
}
const DEFAULT_FORM: FormState = {
  fromToken: 'ETH', toToken: 'USDC', amount: '0.001',
  intervalValue: '5', intervalUnit: 'minutes',
  durationValue: '1', durationUnit: 'hours',
  condition: 'below', priceThreshold: '', targetAmount: '',
}

function buildInstruction(tab: RuleType, f: FormState): string {
  const { fromToken, toToken, amount, intervalValue, intervalUnit,
          durationValue, durationUnit, condition, priceThreshold, targetAmount } = f
  switch (tab) {
    case 'time_dca':
      return `swap ${amount} ${fromToken} to ${toToken} every ${intervalValue} ${intervalUnit}`
    case 'budget_session':
      return `swap ${amount} ${fromToken} to ${toToken} every ${intervalValue} ${intervalUnit} for ${durationValue} ${durationUnit}`
    case 'price_trigger':
      return `swap ${amount} ${fromToken} to ${toToken} when ${fromToken} price is ${condition} $${priceThreshold}`
    case 'price_time_combo':
      return `swap ${amount} ${fromToken} to ${toToken} every ${intervalValue} ${intervalUnit} only if ${fromToken} price is ${condition} $${priceThreshold}`
    case 'target_accumulation':
      return `buy ${toToken} every ${intervalValue} ${intervalUnit} using ${amount} ${fromToken} until I hold ${targetAmount} ${toToken}`
  }
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const field = 'h-10 w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500 focus:border-zinc-500'

// ─── Atom components ──────────────────────────────────────────────────────────

function Fl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-zinc-500">{label}</Label>
      {children}
    </div>
  )
}

function TokenPick({ value, onChange, exclude }: { value: string; onChange: (v: string) => void; exclude?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={field}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="bg-zinc-800 border-zinc-700">
        {TOKENS.filter(t => t !== exclude).map(t => (
          <SelectItem key={t} value={t} className="text-zinc-200">{t}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Interval({ f, patch }: { f: FormState; patch: (p: Partial<FormState>) => void }) {
  return (
    <div className="flex gap-2">
      <input type="number" min="1" value={f.intervalValue}
        onChange={e => patch({ intervalValue: e.target.value })}
        className={`${field} w-24 flex-none`} />
      <Select value={f.intervalUnit} onValueChange={v => patch({ intervalUnit: v as FormState['intervalUnit'] })}>
        <SelectTrigger className={field}><SelectValue /></SelectTrigger>
        <SelectContent className="bg-zinc-800 border-zinc-700">
          <SelectItem value="seconds" className="text-zinc-200">seconds</SelectItem>
          <SelectItem value="minutes" className="text-zinc-200">minutes</SelectItem>
          <SelectItem value="hours" className="text-zinc-200">hours</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

function PairRow({ f, patch }: { f: FormState; patch: (p: Partial<FormState>) => void }) {
  return (
    <div className="flex items-end gap-3">
      <Fl label="From">
        <TokenPick value={f.fromToken} onChange={v => patch({ fromToken: v })} exclude={f.toToken} />
      </Fl>
      <div className="pb-2.5 text-zinc-600 text-base select-none shrink-0">→</div>
      <Fl label="To">
        <TokenPick value={f.toToken} onChange={v => patch({ toToken: v })} exclude={f.fromToken} />
      </Fl>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [swaps, setSwaps] = useState<SwapRecord[]>([])
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [swapCount, setSwapCount] = useState(0)
  const [successfulSwaps, setSuccessfulSwaps] = useState(0)
  const [elapsedMin, setElapsedMin] = useState(0)

  const [activeTab, setActiveTab] = useState<RuleType>('time_dca')
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const patch = (p: Partial<FormState>) => setForm(f => ({ ...f, ...p }))

  const [parsing, setParsing] = useState(false)
  const [apiError, setApiError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingConfig, setPendingConfig] = useState<AgentConfig | null>(null)
  const [confirmationText, setConfirmationText] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [updateText, setUpdateText] = useState('')
  const [updating, setUpdating] = useState(false)
  const [updateResult, setUpdateResult] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(d => {
      setStatus(d.status); setConfig(d.config); setErrors(d.errors ?? [])
      setSwapCount(d.swapCount ?? 0); setSuccessfulSwaps(d.successfulSwaps ?? 0)
      if (d.summary) setSummary(d.summary)
    }).catch(console.error)
  }, [])

  useEffect(() => {
    const es = new EventSource('/api/logs')
    es.onmessage = e => {
      try {
        const entry: LogEntry = JSON.parse(e.data)
        setLogs(prev => { const n = [...prev, entry]; return n.length > 500 ? n.slice(-500) : n })
        if (entry.level === 'error') setErrors(prev => [entry.message, ...prev.slice(0, 19)])
      } catch { /* ignore */ }
    }
    return () => es.close()
  }, [])

  useEffect(() => {
    if (status === 'idle' && !config) return
    const id = setInterval(() => {
      fetch('/api/status').then(r => r.json()).then(d => {
        setStatus(d.status); setConfig(d.config)
        setSwapCount(d.swapCount ?? 0); setSuccessfulSwaps(d.successfulSwaps ?? 0)
        setElapsedMin(d.elapsed_minutes ?? 0)
        if (d.errors) setErrors(d.errors)
        if (d.summary) setSummary(d.summary)
      }).catch(console.error)
    }, 3000)
    return () => clearInterval(id)
  }, [status, config])

  useEffect(() => {
    if (status !== 'running' && status !== 'paused') return
    const id = setInterval(async () => {
      const r = await fetch('/api/status')
      const d = await r.json()
      if (d.swaps) setSwaps(d.swaps)
    }, 5000)
    return () => clearInterval(id)
  }, [status])

  useEffect(() => {
    if (autoScroll) logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, autoScroll])

  const handleParse = async () => {
    const instruction = buildInstruction(activeTab, form)
    if (!instruction) return
    setParsing(true); setApiError('')
    try {
      const res = await fetch('/api/configure', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction }),
      })
      const data = await res.json()
      if (!res.ok) { setApiError(data.error ?? 'Parse failed'); return }
      if (data.clarification) { setApiError(data.clarification); return }
      setPendingConfig(data.pending_config)
      setConfirmationText(data.confirmation_text)
      setConfirmOpen(true)
    } catch (e: unknown) { setApiError((e as Error).message) }
    finally { setParsing(false) }
  }

  const handleConfirm = async () => {
    setConfirming(true)
    try {
      const res = await fetch('/api/confirm', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setApiError(data.error ?? 'Confirm failed') }
      else { setConfig(data.config); setStatus('running'); setSummary(null); setSwaps([]) }
    } catch (e: unknown) { setApiError((e as Error).message) }
    finally { setConfirming(false); setConfirmOpen(false) }
  }

  const handlePause = async () => { const r = await fetch('/api/pause', { method: 'POST' }); if (r.ok) setStatus('paused') }
  const handleResume = async () => { const r = await fetch('/api/run', { method: 'POST' }); if (r.ok) setStatus('running') }
  const handleStop = async () => {
    const r = await fetch('/api/stop', { method: 'POST' })
    if (r.ok) { const d = await r.json(); setStatus('idle'); if (d.summary) setSummary(d.summary) }
  }

  const handleUpdate = async () => {
    if (!updateText.trim()) return
    setUpdating(true); setUpdateResult('')
    try {
      const res = await fetch('/api/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: updateText }),
      })
      const data = await res.json()
      if (!res.ok) setUpdateResult(`Error: ${data.error}`)
      else { setUpdateResult(data.message ?? 'Updated'); setUpdateText('') }
    } catch (e: unknown) { setUpdateResult((e as Error).message) }
    finally { setUpdating(false) }
  }

  const budgetProgress = config?.total_swaps_planned
    ? Math.min(100, (successfulSwaps / config.total_swaps_planned) * 100)
    : config?.duration_minutes
      ? Math.min(100, (elapsedMin / config.duration_minutes) * 100)
      : 0

  const statusDot = status === 'running' ? 'bg-emerald-400 animate-pulse' : status === 'paused' ? 'bg-amber-400' : 'bg-zinc-600'

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-6xl mx-auto px-6 py-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-base font-semibold text-white tracking-tight">LiFi DCA Agent</h1>
            <p className="text-xs text-zinc-500 mt-0.5">Autonomous dollar-cost averaging on Base mainnet</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${statusDot}`} />
            <span className="text-sm text-zinc-400 capitalize">{status}</span>
          </div>
        </div>

        {/* ── Two columns ── */}
        <div className="grid grid-cols-2 gap-5">

          {/* ── LEFT ── */}
          <div className="flex flex-col gap-5">

            {/* Configurator card */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <p className="text-[11px] font-medium tracking-[0.15em] text-zinc-500 uppercase mb-4">Rule Configurator</p>

              <Tabs value={activeTab} onValueChange={v => setActiveTab(v as RuleType)}>
                {/* Tab list */}
                <TabsList className="w-full grid grid-cols-5 bg-zinc-800 rounded-lg p-1 h-auto gap-1">
                  {([
                    ['time_dca', 'Time'],
                    ['budget_session', 'Budget'],
                    ['price_trigger', 'Price'],
                    ['price_time_combo', 'Combo'],
                    ['target_accumulation', 'Target'],
                  ] as [RuleType, string][]).map(([val, label]) => (
                    <TabsTrigger key={val} value={val}
                      className="py-1.5 text-xs rounded-md
                        data-[state=active]:bg-zinc-700 data-[state=active]:text-white data-[state=active]:shadow-none
                        data-[state=inactive]:text-zinc-500 data-[state=inactive]:bg-transparent
                        hover:text-zinc-300 transition-colors">
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {/* Description below tabs */}
                <p className="text-xs text-zinc-500 mt-3 mb-4">{RULE_DESCRIPTIONS[activeTab]}</p>

                {/* ── Time DCA ── */}
                <TabsContent value="time_dca" className="mt-0 space-y-4">
                  <PairRow f={form} patch={patch} />
                  <Fl label="Amount per swap">
                    <div className="flex items-center gap-2">
                      <input type="number" step="0.0001" value={form.amount}
                        onChange={e => patch({ amount: e.target.value })}
                        className={`${field} flex-1`} />
                      <span className="text-sm text-zinc-500 w-10 shrink-0">{form.fromToken}</span>
                    </div>
                  </Fl>
                  <Fl label="Interval"><Interval f={form} patch={patch} /></Fl>
                </TabsContent>

                {/* ── Budget Session ── */}
                <TabsContent value="budget_session" className="mt-0 space-y-4">
                  <PairRow f={form} patch={patch} />
                  <Fl label="Amount per swap">
                    <div className="flex items-center gap-2">
                      <input type="number" step="0.0001" value={form.amount}
                        onChange={e => patch({ amount: e.target.value })}
                        className={`${field} flex-1`} />
                      <span className="text-sm text-zinc-500 w-10 shrink-0">{form.fromToken}</span>
                    </div>
                  </Fl>
                  <Fl label="Interval"><Interval f={form} patch={patch} /></Fl>
                  <Fl label="Total duration">
                    <div className="flex gap-2">
                      <input type="number" min="1" value={form.durationValue}
                        onChange={e => patch({ durationValue: e.target.value })}
                        className={`${field} w-24 flex-none`} />
                      <Select value={form.durationUnit} onValueChange={v => patch({ durationUnit: v as 'minutes' | 'hours' })}>
                        <SelectTrigger className={field}><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-zinc-800 border-zinc-700">
                          <SelectItem value="minutes" className="text-zinc-200">minutes</SelectItem>
                          <SelectItem value="hours" className="text-zinc-200">hours</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </Fl>
                  {(() => {
                    const iMin = parseFloat(form.intervalValue) * (form.intervalUnit === 'hours' ? 60 : form.intervalUnit === 'seconds' ? 1/60 : 1)
                    const dMin = parseFloat(form.durationValue) * (form.durationUnit === 'hours' ? 60 : 1)
                    const n = iMin > 0 ? Math.floor(dMin / iMin) : 0
                    return n > 0 ? (
                      <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/40 px-4 py-3 text-xs text-zinc-400 space-y-1">
                        <div className="flex justify-between"><span>Total swaps</span><span className="text-zinc-200 tabular-nums">{n}</span></div>
                        <div className="flex justify-between"><span>Total {form.fromToken}</span><span className="text-zinc-200 tabular-nums">{(parseFloat(form.amount) * n).toFixed(6)}</span></div>
                      </div>
                    ) : null
                  })()}
                </TabsContent>

                {/* ── Price Trigger ── */}
                <TabsContent value="price_trigger" className="mt-0 space-y-4">
                  <PairRow f={form} patch={patch} />
                  <Fl label="Amount per swap">
                    <div className="flex items-center gap-2">
                      <input type="number" step="0.0001" value={form.amount}
                        onChange={e => patch({ amount: e.target.value })}
                        className={`${field} flex-1`} />
                      <span className="text-sm text-zinc-500 w-10 shrink-0">{form.fromToken}</span>
                    </div>
                  </Fl>
                  <Fl label={`Execute when ${form.fromToken} price is`}>
                    <div className="flex items-center gap-2">
                      <Select value={form.condition} onValueChange={v => patch({ condition: v as 'above' | 'below' })}>
                        <SelectTrigger className={`${field} w-28 flex-none`}><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-zinc-800 border-zinc-700">
                          <SelectItem value="above" className="text-zinc-200">above</SelectItem>
                          <SelectItem value="below" className="text-zinc-200">below</SelectItem>
                        </SelectContent>
                      </Select>
                      <span className="text-zinc-500 text-sm shrink-0">USD $</span>
                      <input type="number" placeholder="3000" value={form.priceThreshold}
                        onChange={e => patch({ priceThreshold: e.target.value })}
                        className={`${field} flex-1`} />
                    </div>
                  </Fl>
                </TabsContent>

                {/* ── Price + Time ── */}
                <TabsContent value="price_time_combo" className="mt-0 space-y-4">
                  <PairRow f={form} patch={patch} />
                  <Fl label="Amount per swap">
                    <div className="flex items-center gap-2">
                      <input type="number" step="0.0001" value={form.amount}
                        onChange={e => patch({ amount: e.target.value })}
                        className={`${field} flex-1`} />
                      <span className="text-sm text-zinc-500 w-10 shrink-0">{form.fromToken}</span>
                    </div>
                  </Fl>
                  <Fl label="Interval"><Interval f={form} patch={patch} /></Fl>
                  <Fl label={`Skip if ${form.fromToken} price is`}>
                    <div className="flex items-center gap-2">
                      <Select value={form.condition} onValueChange={v => patch({ condition: v as 'above' | 'below' })}>
                        <SelectTrigger className={`${field} w-28 flex-none`}><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-zinc-800 border-zinc-700">
                          <SelectItem value="above" className="text-zinc-200">above</SelectItem>
                          <SelectItem value="below" className="text-zinc-200">below</SelectItem>
                        </SelectContent>
                      </Select>
                      <span className="text-zinc-500 text-sm shrink-0">USD $</span>
                      <input type="number" placeholder="3000" value={form.priceThreshold}
                        onChange={e => patch({ priceThreshold: e.target.value })}
                        className={`${field} flex-1`} />
                    </div>
                  </Fl>
                </TabsContent>

                {/* ── Target Accumulation ── */}
                <TabsContent value="target_accumulation" className="mt-0 space-y-4">
                  <PairRow f={form} patch={patch} />
                  <Fl label="Amount per swap">
                    <div className="flex items-center gap-2">
                      <input type="number" step="0.0001" value={form.amount}
                        onChange={e => patch({ amount: e.target.value })}
                        className={`${field} flex-1`} />
                      <span className="text-sm text-zinc-500 w-10 shrink-0">{form.fromToken}</span>
                    </div>
                  </Fl>
                  <Fl label="Interval"><Interval f={form} patch={patch} /></Fl>
                  <Fl label={`Stop when ${form.toToken} balance reaches`}>
                    <div className="flex items-center gap-2">
                      <input type="number" placeholder="100" value={form.targetAmount}
                        onChange={e => patch({ targetAmount: e.target.value })}
                        className={`${field} w-36 flex-none`} />
                      <span className="text-sm text-zinc-500">{form.toToken}</span>
                    </div>
                  </Fl>
                </TabsContent>
              </Tabs>

              {/* Error */}
              {apiError && (
                <div className="mt-4 rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-2.5 text-xs text-red-300">
                  {apiError}
                </div>
              )}

              {/* Buttons */}
              <Separator className="my-4 bg-zinc-800" />
              <div className="flex gap-2">
                <button onClick={handleParse} disabled={parsing || status === 'running'}
                  className="h-9 px-5 rounded-lg bg-white text-zinc-900 text-sm font-medium hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2">
                  {parsing && <span className="w-3.5 h-3.5 rounded-full border-2 border-zinc-400 border-t-transparent animate-spin" />}
                  Configure
                </button>
                <button onClick={status === 'paused' ? handleResume : () => {}}
                  disabled={!config || status !== 'paused'}
                  className="h-9 px-5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  Resume
                </button>
                <button onClick={handlePause} disabled={status !== 'running'}
                  className="h-9 px-5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  Pause
                </button>
                <button onClick={handleStop} disabled={status === 'idle'}
                  className="h-9 px-5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  Stop
                </button>
              </div>
            </div>

            {/* Session status card — always visible */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 flex-1">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[11px] font-medium tracking-[0.15em] text-zinc-500 uppercase">Session Status</p>
                {config && <Badge className={`text-[10px] px-2 py-0.5 ${RULE_BADGE[config.rule_type]}`}>{RULE_LABELS[config.rule_type]}</Badge>}
              </div>

              {!config || status === 'idle' ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <div className="text-3xl opacity-10">◎</div>
                  <p className="text-xs text-zinc-600">No active session</p>
                  <p className="text-xs text-zinc-700">Configure a rule above to begin</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-zinc-500 font-mono leading-relaxed break-all">{config.instruction}</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { value: successfulSwaps, label: 'Done' },
                      { value: config.total_swaps_planned ?? '∞', label: 'Planned' },
                      { value: `${elapsedMin.toFixed(0)}m`, label: 'Elapsed' },
                    ].map(({ value, label }) => (
                      <div key={label} className="rounded-lg bg-zinc-800/50 border border-zinc-700/30 py-3 text-center">
                        <div className="text-lg font-semibold tabular-nums text-zinc-100">{value}</div>
                        <div className="text-[11px] text-zinc-500 mt-0.5">{label}</div>
                      </div>
                    ))}
                  </div>
                  {config.rule_type === 'budget_session' && config.total_swaps_planned && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-zinc-500">
                        <span>Progress</span>
                        <span className="tabular-nums">{successfulSwaps} / {config.total_swaps_planned}</span>
                      </div>
                      <Progress value={budgetProgress} className="h-1 bg-zinc-800" />
                    </div>
                  )}
                  {config.rule_type === 'budget_session' && config.duration_minutes && !config.total_swaps_planned && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-zinc-500">
                        <span>Time</span>
                        <span className="tabular-nums">{elapsedMin.toFixed(1)} / {config.duration_minutes} min</span>
                      </div>
                      <Progress value={budgetProgress} className="h-1 bg-zinc-800" />
                    </div>
                  )}

                  {/* Mid-session update */}
                  <Separator className="bg-zinc-800" />
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium tracking-[0.15em] text-zinc-500 uppercase">Update Session</p>
                    <div className="flex gap-2">
                      <input value={updateText} onChange={e => setUpdateText(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !updating && handleUpdate()}
                        placeholder='e.g. "change interval to 3 minutes"'
                        className={`${field} flex-1`} />
                      <button onClick={handleUpdate} disabled={updating || !updateText.trim()}
                        className="h-10 px-4 rounded-lg bg-zinc-700 text-white text-sm hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0">
                        {updating ? '…' : 'Send'}
                      </button>
                    </div>
                    {updateResult && (
                      <p className={`text-xs ${updateResult.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
                        {updateResult}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Session summary */}
            {summary && (
              <div className="rounded-xl border border-zinc-700/60 bg-zinc-900 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium tracking-[0.15em] text-zinc-500 uppercase">Session Summary</p>
                  <Badge variant="secondary" className="text-[10px] px-2 py-0.5">{summary.end_reason}</Badge>
                </div>
                <p className="text-sm text-zinc-300 leading-relaxed">{summary.narrative}</p>
                <Separator className="bg-zinc-800" />
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  {[
                    ['Swaps', `${summary.successful_swaps}/${summary.total_swaps}`],
                    ['Duration', `${summary.duration_minutes}m`],
                    ['Spent', `${summary.total_spent} ${summary.total_spent_token}`],
                    ['Received', `~${summary.total_received} ${summary.total_received_token}`],
                    ['Avg price', `$${summary.avg_price_usd}`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-zinc-500">{k}</span>
                      <span className="tabular-nums text-zinc-200">{v}</span>
                    </div>
                  ))}
                  {summary.best_swap && (
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Best</span>
                      <span className="tabular-nums text-emerald-400">${summary.best_swap.price}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Errors */}
            {errors.length > 0 && (
              <div className="rounded-xl border border-red-900/30 bg-red-950/10 p-5">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-xs text-red-400 font-medium">Errors ({errors.length})</p>
                  <button onClick={() => setErrors([])} className="text-xs text-zinc-600 hover:text-zinc-400">Clear</button>
                </div>
                <div className="space-y-1">
                  {errors.slice(0, 3).map((e, i) => (
                    <p key={i} className="text-xs text-red-300 break-all">{e}</p>
                  ))}
                  {errors.length > 3 && <p className="text-xs text-zinc-600">+{errors.length - 3} more</p>}
                </div>
              </div>
            )}

          </div>

          {/* ── RIGHT ── */}
          <div className="flex flex-col gap-5">

            {/* Live Log */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 flex-1">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[11px] font-medium tracking-[0.15em] text-zinc-500 uppercase">Live Log</p>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer select-none">
                    <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} className="w-3 h-3" />
                    Auto-scroll
                  </label>
                  <button onClick={() => setLogs([])} className="text-xs text-zinc-600 hover:text-zinc-400">Clear</button>
                  <span className="text-xs text-zinc-700 tabular-nums w-5 text-right">{logs.length}</span>
                </div>
              </div>
              <div className="h-72 overflow-y-auto rounded-lg bg-zinc-950/60 border border-zinc-800/60">
                {logs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2">
                    <div className="text-2xl opacity-10">◈</div>
                    <p className="text-xs text-zinc-700">Waiting for logs…</p>
                  </div>
                ) : (
                  <div className="p-3 space-y-0.5 font-mono text-xs leading-5">
                    {logs.map(e => (
                      <div key={e.id} className={`flex gap-2 ${LOG_COLOR[e.level]}`}>
                        <span className="shrink-0 text-zinc-700 tabular-nums">{e.timestamp}</span>
                        <span className="shrink-0">{LOG_PREFIX[e.level]}</span>
                        <span className="break-all">{e.message}</span>
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                )}
              </div>
            </div>

            {/* Swap History */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[11px] font-medium tracking-[0.15em] text-zinc-500 uppercase">Swap History</p>
                <span className="text-xs text-zinc-700 tabular-nums">{swaps.length} swaps</span>
              </div>
              <div className="h-52 overflow-y-auto rounded-lg bg-zinc-950/60 border border-zinc-800/60">
                {swaps.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2">
                    <div className="text-2xl opacity-10">⛓</div>
                    <p className="text-xs text-zinc-700">No swaps yet</p>
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-800">
                        <th className="text-left text-zinc-600 font-normal px-3 py-2">Time</th>
                        <th className="text-left text-zinc-600 font-normal py-2">From</th>
                        <th className="text-left text-zinc-600 font-normal py-2">To</th>
                        <th className="text-left text-zinc-600 font-normal py-2">Price</th>
                        <th className="text-left text-zinc-600 font-normal py-2 pr-3">Tx</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...swaps].reverse().map(s => (
                        <tr key={s.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/20">
                          <td className="px-3 py-2 font-mono text-zinc-500">
                            {new Date(s.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                          </td>
                          <td className="py-2 text-zinc-300">
                            {s.from_amount ? `${parseFloat(s.from_amount).toFixed(5)} ${s.from_token}` : s.from_token}
                          </td>
                          <td className="py-2 text-zinc-300">
                            {s.to_amount ? `${parseFloat(s.to_amount).toFixed(2)} ${s.to_token}` : s.to_token}
                          </td>
                          <td className="py-2 tabular-nums text-zinc-300">
                            {s.price_usd ? `$${parseFloat(s.price_usd).toLocaleString()}` : '—'}
                          </td>
                          <td className="py-2 pr-3">
                            {s.success && s.tx_hash ? (
                              <a href={`https://basescan.org/tx/${s.tx_hash}`} target="_blank" rel="noopener noreferrer"
                                className="font-mono text-sky-400 hover:text-sky-300">
                                {s.tx_hash.slice(0, 6)}…{s.tx_hash.slice(-4)}
                              </a>
                            ) : s.error ? <span className="text-red-400">failed</span> : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── Confirm Dialog ── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="bg-zinc-900 border border-zinc-700 rounded-xl max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white text-base">Confirm Session</DialogTitle>
            <DialogDescription className="text-zinc-400 text-sm leading-relaxed pt-1">
              {confirmationText}
            </DialogDescription>
          </DialogHeader>
          {pendingConfig && (
            <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/40 p-4 text-xs space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">Rule</span>
                <Badge className={`text-[10px] ${RULE_BADGE[pendingConfig.rule_type]}`}>{RULE_LABELS[pendingConfig.rule_type]}</Badge>
              </div>
              {[
                ['Pair', `${pendingConfig.from_token} → ${pendingConfig.to_token}`],
                ['Amount', pendingConfig.amount_per_swap_display || `${pendingConfig.amount_wei} wei`],
                ['Interval', `${pendingConfig.interval_minutes} min`],
                ...(pendingConfig.duration_minutes ? [['Duration', `${pendingConfig.duration_minutes} min`]] : []),
                ...(pendingConfig.total_swaps_planned ? [['Total swaps', `${pendingConfig.total_swaps_planned}`]] : []),
                ...(pendingConfig.price_threshold_usd ? [[`${pendingConfig.from_token} price ${pendingConfig.price_condition}`, `$${pendingConfig.price_threshold_usd}`]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-zinc-500">{k}</span>
                  <span className="font-mono text-zinc-200">{v}</span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter className="gap-2">
            <button onClick={() => setConfirmOpen(false)}
              className="h-9 px-4 rounded-lg border border-zinc-700 bg-transparent text-zinc-400 text-sm hover:bg-zinc-800 transition-colors">
              Cancel
            </button>
            <button onClick={handleConfirm} disabled={confirming}
              className="h-9 px-5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 transition-colors">
              {confirming ? 'Starting…' : 'Confirm & Run'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
