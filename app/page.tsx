'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
const RULE_BADGE_CLASS: Record<RuleType, string> = {
  time_dca: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  budget_session: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  price_trigger: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  price_time_combo: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  target_accumulation: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
}
const LOG_COLOR: Record<LogLevel, string> = {
  info: 'text-zinc-400', tool: 'text-blue-400', error: 'text-red-400',
  claude: 'text-emerald-400', tx: 'text-yellow-400',
}
const LOG_PREFIX: Record<LogLevel, string> = {
  info: '   ', tool: '⚙  ', error: '✗  ', claude: '◈  ', tx: '⛓  ',
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
      return `swap ${amount} ${fromToken} to ${toToken} when price is ${condition} $${priceThreshold}`
    case 'price_time_combo':
      return `swap ${amount} ${fromToken} to ${toToken} every ${intervalValue} ${intervalUnit} only if price is ${condition} $${priceThreshold}`
    case 'target_accumulation':
      return `buy ${toToken} every ${intervalValue} ${intervalUnit} using ${amount} ${fromToken} until I hold ${targetAmount} ${toToken}`
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AgentStatus }) {
  if (status === 'running') return <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse">● Running</Badge>
  if (status === 'paused') return <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/40">⏸ Paused</Badge>
  return <Badge variant="secondary">○ Idle</Badge>
}

function TokenSelect({ value, onChange, exclude }: { value: string; onChange: (v: string) => void; exclude?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-28 bg-zinc-800 border-zinc-700 h-9 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="bg-zinc-800 border-zinc-700">
        {TOKENS.filter(t => t !== exclude).map(t => (
          <SelectItem key={t} value={t} className="text-sm">{t}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function IntervalPicker({ f, onChange }: { f: FormState; onChange: (patch: Partial<FormState>) => void }) {
  return (
    <div className="flex gap-2">
      <Input type="number" min="1" value={f.intervalValue} onChange={e => onChange({ intervalValue: e.target.value })}
        className="w-20 bg-zinc-800 border-zinc-700 h-9 text-sm" />
      <Select value={f.intervalUnit} onValueChange={v => onChange({ intervalUnit: v as FormState['intervalUnit'] })}>
        <SelectTrigger className="w-28 bg-zinc-800 border-zinc-700 h-9 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent className="bg-zinc-800 border-zinc-700">
          <SelectItem value="seconds">seconds</SelectItem>
          <SelectItem value="minutes">minutes</SelectItem>
          <SelectItem value="hours">hours</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

function TokenPairRow({ f, onChange }: { f: FormState; onChange: (patch: Partial<FormState>) => void }) {
  return (
    <div className="flex items-end gap-3">
      <div className="space-y-1">
        <Label className="text-xs text-zinc-400">From</Label>
        <TokenSelect value={f.fromToken} onChange={v => onChange({ fromToken: v })} exclude={f.toToken} />
      </div>
      <span className="text-zinc-500 mb-2">→</span>
      <div className="space-y-1">
        <Label className="text-xs text-zinc-400">To</Label>
        <TokenSelect value={f.toToken} onChange={v => onChange({ toToken: v })} exclude={f.fromToken} />
      </div>
    </div>
  )
}

function AmountRow({ f, onChange }: { f: FormState; onChange: (patch: Partial<FormState>) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-zinc-400">Amount per swap</Label>
      <div className="flex gap-2 items-center">
        <Input type="number" step="0.0001" value={f.amount} onChange={e => onChange({ amount: e.target.value })}
          className="w-32 bg-zinc-800 border-zinc-700 h-9 text-sm" />
        <span className="text-xs text-zinc-500">{f.fromToken}</span>
      </div>
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

  // Form
  const [activeTab, setActiveTab] = useState<RuleType>('time_dca')
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const patchForm = (patch: Partial<FormState>) => setForm(f => ({ ...f, ...patch }))

  // UI state
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

  // ── Initial status ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(d => {
      setStatus(d.status); setConfig(d.config); setErrors(d.errors ?? [])
      setSwapCount(d.swapCount ?? 0); setSuccessfulSwaps(d.successfulSwaps ?? 0)
      if (d.summary) setSummary(d.summary)
    }).catch(console.error)
  }, [])

  // ── SSE log stream ────────────────────────────────────────────────────────
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

  // ── Poll status while running ─────────────────────────────────────────────
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

  // ── Swap history polling ──────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'running' && status !== 'paused') return
    const id = setInterval(async () => {
      const r = await fetch('/api/status')
      const d = await r.json()
      // Swap records come from status for simplicity
      if (d.swaps) setSwaps(d.swaps)
    }, 5000)
    return () => clearInterval(id)
  }, [status])

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll) logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, autoScroll])

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleParse = async () => {
    const instruction = buildInstruction(activeTab, form)
    if (!instruction) return
    setParsing(true); setApiError('')
    try {
      const res = await fetch('/api/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  const handlePause = async () => {
    const r = await fetch('/api/pause', { method: 'POST' })
    if (r.ok) setStatus('paused')
  }

  const handleResume = async () => {
    const r = await fetch('/api/run', { method: 'POST' })
    if (r.ok) setStatus('running')
  }

  const handleStop = async () => {
    const r = await fetch('/api/stop', { method: 'POST' })
    if (r.ok) {
      const d = await r.json()
      setStatus('idle')
      if (d.summary) setSummary(d.summary)
    }
  }

  const handleUpdate = async () => {
    if (!updateText.trim()) return
    setUpdating(true); setUpdateResult('')
    try {
      const res = await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: updateText }),
      })
      const data = await res.json()
      if (!res.ok) setUpdateResult(`Error: ${data.error}`)
      else { setUpdateResult(data.message ?? 'Updated'); setUpdateText('') }
    } catch (e: unknown) { setUpdateResult((e as Error).message) }
    finally { setUpdating(false) }
  }

  // ── Budget progress ───────────────────────────────────────────────────────
  const budgetProgress = config?.total_swaps_planned
    ? Math.min(100, (successfulSwaps / config.total_swaps_planned) * 100)
    : config?.duration_minutes
      ? Math.min(100, (elapsedMin / config.duration_minutes) * 100)
      : 0

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto p-4 md:p-6">

        {/* Header */}
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight">LiFi DCA Agent</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Autonomous dollar-cost averaging on Base mainnet</p>
          </div>
          <StatusBadge status={status} />
        </header>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* ── LEFT COLUMN ─────────────────────────────────────────────── */}
          <div className="space-y-5">

            {/* Rule Configurator */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Rule Configurator
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Tabs value={activeTab} onValueChange={v => setActiveTab(v as RuleType)}>
                  <TabsList className="grid grid-cols-5 h-9 text-xs bg-zinc-800/60 w-full">
                    <TabsTrigger value="time_dca" className="text-xs px-1">Time</TabsTrigger>
                    <TabsTrigger value="budget_session" className="text-xs px-1">Budget</TabsTrigger>
                    <TabsTrigger value="price_trigger" className="text-xs px-1">Price</TabsTrigger>
                    <TabsTrigger value="price_time_combo" className="text-xs px-1">Combo</TabsTrigger>
                    <TabsTrigger value="target_accumulation" className="text-xs px-1">Target</TabsTrigger>
                  </TabsList>

                  {/* Time DCA */}
                  <TabsContent value="time_dca" className="space-y-3 pt-3">
                    <p className="text-xs text-muted-foreground">Swap a fixed amount at regular intervals.</p>
                    <TokenPairRow f={form} onChange={patchForm} />
                    <AmountRow f={form} onChange={patchForm} />
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-400">Interval</Label>
                      <IntervalPicker f={form} onChange={patchForm} />
                    </div>
                  </TabsContent>

                  {/* Budget Session */}
                  <TabsContent value="budget_session" className="space-y-3 pt-3">
                    <p className="text-xs text-muted-foreground">Swap at regular intervals for a fixed duration.</p>
                    <TokenPairRow f={form} onChange={patchForm} />
                    <AmountRow f={form} onChange={patchForm} />
                    <div className="flex gap-4">
                      <div className="space-y-1 flex-1">
                        <Label className="text-xs text-zinc-400">Interval</Label>
                        <IntervalPicker f={form} onChange={patchForm} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-400">Duration</Label>
                      <div className="flex gap-2">
                        <Input type="number" min="1" value={form.durationValue}
                          onChange={e => patchForm({ durationValue: e.target.value })}
                          className="w-20 bg-zinc-800 border-zinc-700 h-9 text-sm" />
                        <Select value={form.durationUnit} onValueChange={v => patchForm({ durationUnit: v as 'minutes' | 'hours' })}>
                          <SelectTrigger className="w-28 bg-zinc-800 border-zinc-700 h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-zinc-800 border-zinc-700">
                            <SelectItem value="minutes">minutes</SelectItem>
                            <SelectItem value="hours">hours</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {/* Calculated totals */}
                    {(() => {
                      const intMin = parseFloat(form.intervalValue) * (form.intervalUnit === 'hours' ? 60 : form.intervalUnit === 'seconds' ? 1/60 : 1)
                      const durMin = parseFloat(form.durationValue) * (form.durationUnit === 'hours' ? 60 : 1)
                      const numSwaps = intMin > 0 ? Math.floor(durMin / intMin) : 0
                      const total = (parseFloat(form.amount) * numSwaps).toFixed(6)
                      return numSwaps > 0 ? (
                        <div className="rounded-md bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400 space-y-0.5">
                          <div className="flex justify-between"><span>Total swaps</span><span className="text-zinc-200">{numSwaps}</span></div>
                          <div className="flex justify-between"><span>Total {form.fromToken}</span><span className="text-zinc-200">{total}</span></div>
                        </div>
                      ) : null
                    })()}
                  </TabsContent>

                  {/* Price Trigger */}
                  <TabsContent value="price_trigger" className="space-y-3 pt-3">
                    <p className="text-xs text-muted-foreground">Execute a swap when price crosses a threshold.</p>
                    <TokenPairRow f={form} onChange={patchForm} />
                    <AmountRow f={form} onChange={patchForm} />
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-400">Price condition</Label>
                      <div className="flex gap-2 items-center">
                        <Select value={form.condition} onValueChange={v => patchForm({ condition: v as 'above' | 'below' })}>
                          <SelectTrigger className="w-28 bg-zinc-800 border-zinc-700 h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-zinc-800 border-zinc-700">
                            <SelectItem value="above">above</SelectItem>
                            <SelectItem value="below">below</SelectItem>
                          </SelectContent>
                        </Select>
                        <span className="text-zinc-500 text-sm">$</span>
                        <Input type="number" placeholder="e.g. 3000" value={form.priceThreshold}
                          onChange={e => patchForm({ priceThreshold: e.target.value })}
                          className="w-36 bg-zinc-800 border-zinc-700 h-9 text-sm" />
                      </div>
                    </div>
                  </TabsContent>

                  {/* Price + Time Combo */}
                  <TabsContent value="price_time_combo" className="space-y-3 pt-3">
                    <p className="text-xs text-muted-foreground">Swap at regular intervals, but only if price condition is met.</p>
                    <TokenPairRow f={form} onChange={patchForm} />
                    <AmountRow f={form} onChange={patchForm} />
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-400">Interval</Label>
                      <IntervalPicker f={form} onChange={patchForm} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-400">Only execute if price is</Label>
                      <div className="flex gap-2 items-center">
                        <Select value={form.condition} onValueChange={v => patchForm({ condition: v as 'above' | 'below' })}>
                          <SelectTrigger className="w-28 bg-zinc-800 border-zinc-700 h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-zinc-800 border-zinc-700">
                            <SelectItem value="above">above</SelectItem>
                            <SelectItem value="below">below</SelectItem>
                          </SelectContent>
                        </Select>
                        <span className="text-zinc-500 text-sm">$</span>
                        <Input type="number" placeholder="e.g. 3000" value={form.priceThreshold}
                          onChange={e => patchForm({ priceThreshold: e.target.value })}
                          className="w-36 bg-zinc-800 border-zinc-700 h-9 text-sm" />
                      </div>
                    </div>
                  </TabsContent>

                  {/* Target Accumulation */}
                  <TabsContent value="target_accumulation" className="space-y-3 pt-3">
                    <p className="text-xs text-muted-foreground">Buy at regular intervals until you hold a target amount.</p>
                    <TokenPairRow f={form} onChange={patchForm} />
                    <AmountRow f={form} onChange={patchForm} />
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-400">Interval</Label>
                      <IntervalPicker f={form} onChange={patchForm} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-400">Target balance ({form.toToken})</Label>
                      <Input type="number" placeholder="e.g. 100" value={form.targetAmount}
                        onChange={e => patchForm({ targetAmount: e.target.value })}
                        className="w-36 bg-zinc-800 border-zinc-700 h-9 text-sm" />
                    </div>
                  </TabsContent>
                </Tabs>

                {/* Error alert */}
                {apiError && (
                  <Alert variant="destructive" className="py-2">
                    <AlertDescription className="text-xs">{apiError}</AlertDescription>
                  </Alert>
                )}

                {/* Control buttons */}
                <Separator className="my-1" />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleParse} disabled={parsing || status === 'running'}
                    variant="secondary" size="sm" className="gap-1.5">
                    {parsing ? <><span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />Parsing...</> : 'Configure'}
                  </Button>
                  <Button onClick={status === 'paused' ? handleResume : () => {}}
                    disabled={!config || status === 'running' || status === 'idle'}
                    size="sm" className="bg-emerald-700 hover:bg-emerald-600 text-white gap-1">
                    ▶ Resume
                  </Button>
                  <Button onClick={handlePause} disabled={status !== 'running'}
                    size="sm" className="bg-yellow-700 hover:bg-yellow-600 text-white">
                    ⏸ Pause
                  </Button>
                  <Button onClick={handleStop} disabled={status === 'idle'}
                    variant="destructive" size="sm">
                    ■ Stop
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Active Session */}
            {(status === 'running' || status === 'paused') && config && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Active Session</CardTitle>
                    <Badge className={RULE_BADGE_CLASS[config.rule_type]}>{RULE_LABELS[config.rule_type]}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-zinc-400 font-mono">{config.instruction}</p>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-md bg-zinc-800/50 py-2">
                      <div className="text-lg font-bold">{successfulSwaps}</div>
                      <div className="text-xs text-muted-foreground">Swaps done</div>
                    </div>
                    <div className="rounded-md bg-zinc-800/50 py-2">
                      <div className="text-lg font-bold">{config.total_swaps_planned ?? '∞'}</div>
                      <div className="text-xs text-muted-foreground">Total planned</div>
                    </div>
                    <div className="rounded-md bg-zinc-800/50 py-2">
                      <div className="text-lg font-bold">{elapsedMin.toFixed(0)}m</div>
                      <div className="text-xs text-muted-foreground">Elapsed</div>
                    </div>
                  </div>
                  {config.rule_type === 'budget_session' && config.total_swaps_planned && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Budget consumed</span>
                        <span>{successfulSwaps} / {config.total_swaps_planned} swaps</span>
                      </div>
                      <Progress value={budgetProgress} className="h-1.5" />
                    </div>
                  )}
                  {config.rule_type === 'budget_session' && config.duration_minutes && !config.total_swaps_planned && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Time elapsed</span>
                        <span>{elapsedMin.toFixed(1)} / {config.duration_minutes} min</span>
                      </div>
                      <Progress value={budgetProgress} className="h-1.5" />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Mid-session Update */}
            {(status === 'running' || status === 'paused') && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Mid-Session Update</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-muted-foreground">Update interval, amount, or duration while running. Cannot switch rule type.</p>
                  <div className="flex gap-2">
                    <Input value={updateText} onChange={e => setUpdateText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !updating && handleUpdate()}
                      placeholder='e.g. "change interval to 3 minutes"'
                      className="bg-zinc-800 border-zinc-700 text-sm h-9 flex-1" />
                    <Button onClick={handleUpdate} disabled={updating || !updateText.trim()}
                      size="sm" variant="secondary">
                      {updating ? '...' : 'Send'}
                    </Button>
                  </div>
                  {updateResult && (
                    <p className={`text-xs ${updateResult.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
                      {updateResult}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Session Summary */}
            {summary && (
              <Card className="border-zinc-700">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Session Summary</CardTitle>
                    <Badge variant={summary.end_reason === 'completed' ? 'default' : 'secondary'} className="text-xs">
                      {summary.end_reason}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-zinc-300 leading-relaxed">{summary.narrative}</p>
                  <Separator />
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Swaps</span><span>{summary.successful_swaps}/{summary.total_swaps}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Duration</span><span>{summary.duration_minutes}m</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Spent</span><span>{summary.total_spent} {summary.total_spent_token}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Received</span><span>~{summary.total_received} {summary.total_received_token}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Avg price</span><span>${summary.avg_price_usd}</span></div>
                    {summary.best_swap && <div className="flex justify-between"><span className="text-muted-foreground">Best price</span><span className="text-emerald-400">${summary.best_swap.price}</span></div>}
                    {summary.worst_swap && <div className="flex justify-between"><span className="text-muted-foreground">Worst price</span><span className="text-red-400">${summary.worst_swap.price}</span></div>}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Errors */}
            {errors.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs space-y-1">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-semibold">Errors ({errors.length})</span>
                    <button onClick={() => setErrors([])} className="text-xs opacity-60 hover:opacity-100">Clear</button>
                  </div>
                  {errors.slice(0, 3).map((e, i) => <div key={i} className="break-all">{e}</div>)}
                  {errors.length > 3 && <div className="opacity-60">+{errors.length - 3} more</div>}
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* ── RIGHT COLUMN ────────────────────────────────────────────── */}
          <div className="space-y-5">

            {/* Live Log */}
            <Card className="flex flex-col">
              <CardHeader className="pb-2 shrink-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Live Log</CardTitle>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                      <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} className="w-3 h-3" />
                      Auto-scroll
                    </label>
                    <button onClick={() => setLogs([])} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
                    <span className="text-xs text-muted-foreground">{logs.length}</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-72 px-3 pb-3">
                  {logs.length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-10">
                      No logs — configure and start a session
                    </div>
                  ) : (
                    <div className="space-y-0.5 font-mono text-xs leading-5">
                      {logs.map(e => (
                        <div key={e.id} className={`flex gap-2 ${LOG_COLOR[e.level]}`}>
                          <span className="shrink-0 text-zinc-600 tabular-nums">{e.timestamp}</span>
                          <span className="shrink-0">{LOG_PREFIX[e.level]}</span>
                          <span className="break-all">{e.message}</span>
                        </div>
                      ))}
                      <div ref={logEndRef} />
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Swap History */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Swap History <span className="text-xs font-normal normal-case">({swaps.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-64">
                  {swaps.length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-10">No swaps recorded yet</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="border-zinc-800 hover:bg-transparent">
                          <TableHead className="text-xs h-8 pl-4">Time</TableHead>
                          <TableHead className="text-xs h-8">From</TableHead>
                          <TableHead className="text-xs h-8">To</TableHead>
                          <TableHead className="text-xs h-8">Price</TableHead>
                          <TableHead className="text-xs h-8 pr-4">Tx</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...swaps].reverse().map(s => (
                          <TableRow key={s.id} className="border-zinc-800 hover:bg-zinc-800/30">
                            <TableCell className="text-xs pl-4 text-muted-foreground py-2 font-mono">
                              {new Date(s.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                            </TableCell>
                            <TableCell className="text-xs py-2">
                              {s.from_amount ? `${parseFloat(s.from_amount).toFixed(5)} ${s.from_token}` : s.from_token}
                            </TableCell>
                            <TableCell className="text-xs py-2">
                              {s.to_amount ? `${parseFloat(s.to_amount).toFixed(2)} ${s.to_token}` : s.to_token}
                            </TableCell>
                            <TableCell className="text-xs py-2">
                              {s.price_usd ? `$${parseFloat(s.price_usd).toLocaleString()}` : '—'}
                            </TableCell>
                            <TableCell className="text-xs py-2 pr-4">
                              {s.success && s.tx_hash ? (
                                <a href={`https://basescan.org/tx/${s.tx_hash}`} target="_blank" rel="noopener noreferrer"
                                  className="text-blue-400 hover:text-blue-300 font-mono">
                                  {s.tx_hash.slice(0, 6)}…{s.tx_hash.slice(-4)}
                                </a>
                              ) : s.error ? (
                                <span className="text-red-400 text-xs">failed</span>
                              ) : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Session</DialogTitle>
            <DialogDescription className="text-zinc-400 pt-2 leading-relaxed text-sm">
              {confirmationText}
            </DialogDescription>
          </DialogHeader>
          {pendingConfig && (
            <div className="rounded-md bg-zinc-800 px-3 py-2 text-xs font-mono text-zinc-300 space-y-1">
              <div className="flex justify-between"><span className="text-zinc-500">Rule</span><Badge className={RULE_BADGE_CLASS[pendingConfig.rule_type]} >{RULE_LABELS[pendingConfig.rule_type]}</Badge></div>
              <div className="flex justify-between"><span className="text-zinc-500">Pair</span><span>{pendingConfig.from_token} → {pendingConfig.to_token}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Amount</span><span>{pendingConfig.amount_per_swap_display || pendingConfig.amount_wei + ' wei'}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Interval</span><span>{pendingConfig.interval_minutes}min</span></div>
              {pendingConfig.duration_minutes && <div className="flex justify-between"><span className="text-zinc-500">Duration</span><span>{pendingConfig.duration_minutes}min</span></div>}
              {pendingConfig.total_swaps_planned && <div className="flex justify-between"><span className="text-zinc-500">Total swaps</span><span>{pendingConfig.total_swaps_planned}</span></div>}
              {pendingConfig.price_threshold_usd && <div className="flex justify-between"><span className="text-zinc-500">Price {pendingConfig.price_condition}</span><span>${pendingConfig.price_threshold_usd}</span></div>}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}
              className="border-zinc-700 bg-transparent hover:bg-zinc-800">Cancel</Button>
            <Button size="sm" onClick={handleConfirm} disabled={confirming}
              className="bg-emerald-700 hover:bg-emerald-600 text-white">
              {confirming ? 'Starting...' : 'Confirm & Run'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
