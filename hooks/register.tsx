import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Plan, Step, StepStatus } from '../types'

// Observes task-list tool calls only. Nothing is added to the model's
// context and no model call is made, so the mod costs zero tokens.

const plan = atom({ plugin: 'task-progress', key: 'plan' } as const, null)
const isHidden = atom({ plugin: 'task-progress', key: 'isHidden' } as const, false)
// Set while a turn runs, so the band shows even before a task list exists.
const turnStartedAt = atom({ plugin: 'task-progress', key: 'turnStartedAt' } as const, null)

const BAR_CELLS = 20
const TICK_MS = 1000
// The lit block of the bar shown while no task list exists yet.
const SWEEP_CELLS = 4
// A step still running never counts as more than this share of itself.
const MAX_PARTIAL = 0.9

const STATUSES: readonly StepStatus[] = ['pending', 'in_progress', 'completed']

function asStatus(value: unknown): StepStatus {
  return STATUSES.includes(value as StepStatus) ? (value as StepStatus) : 'pending'
}

// Moves the plan to `steps`, crediting the time since the last change to
// every step that has just been completed.
function advanceTo(prev: Plan | null, steps: Step[], now: number): Plan {
  const isFresh = prev === null || prev.steps.every(s => s.status === 'completed')
  const base: Plan = isFresh
    ? { steps: [], startedAt: now, stepStartedAt: now, durations: [] }
    : prev
  const wasDone = new Set(base.steps.filter(s => s.status === 'completed').map(s => s.key))
  const wasActive = new Set(base.steps.filter(s => s.status === 'in_progress').map(s => s.key))
  const justDone = steps.filter(s => s.status === 'completed' && !wasDone.has(s.key))
  const justStarted = steps.some(s => s.status === 'in_progress' && !wasActive.has(s.key))

  const share = justDone.length > 0 ? (now - base.stepStartedAt) / justDone.length : 0
  // A bulk check-off of steps never started says nothing about their pace.
  const durations = isFresh && justDone.length === steps.length
    ? base.durations
    : [...base.durations, ...justDone.map(() => share)]

  return {
    steps,
    startedAt: base.startedAt,
    stepStartedAt: justDone.length > 0 || justStarted ? now : base.stepStartedAt,
    durations,
  }
}

function withStatus(steps: Step[], index: number, status: StepStatus): Step[] {
  return steps.map((s, i) => (i === index ? { ...s, status } : s))
}

// The desktop app's own task list: whole lists, `advance`, or `done`/`start`.
function fromUpdatePlan(steps: Step[], e: Record<string, unknown>): Step[] | null {
  if (Array.isArray(e.items)) {
    return e.items.map((item: { content?: unknown; status?: unknown }, i) => ({
      key: String(i),
      subject: String(item.content ?? ''),
      status: asStatus(item.status),
    }))
  }

  let next = steps
  if (e.advance === true) {
    const active = next.findIndex(s => s.status === 'in_progress')
    if (active >= 0) next = withStatus(next, active, 'completed')
    const pending = next.findIndex(s => s.status === 'pending')
    if (pending >= 0) next = withStatus(next, pending, 'in_progress')
  }
  if (Array.isArray(e.done)) {
    for (const n of e.done) {
      if (typeof n === 'number') next = withStatus(next, n - 1, 'completed')
    }
  }
  if (typeof e.start === 'number') {
    next = withStatus(next, e.start - 1, 'in_progress')
  }

  return next === steps ? null : next
}

async function setSteps($: EngineInterface, steps: Step[]) {
  const now = await $.clock.now()
  await update($, plan, prev => advanceTo(prev, steps, now))
  await update($, isHidden, () => false)
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

type Estimate = { fraction: number; done: number; total: number; etaMs: number | null }

function estimate(p: Plan, now: number): Estimate {
  const total = p.steps.length
  const done = p.steps.filter(s => s.status === 'completed').length
  const isRunning = p.steps.some(s => s.status === 'in_progress')
  const avg = p.durations.length > 0
    ? p.durations.reduce((a, b) => a + b, 0) / p.durations.length
    : null
  const current = now - p.stepStartedAt
  const partial = isRunning && avg !== null && avg > 0 ? Math.min(MAX_PARTIAL, current / avg) : 0
  const etaMs = avg === null ? null : Math.max(0, (total - done) * avg - (isRunning ? Math.min(current, avg * MAX_PARTIAL) : 0))

  return { fraction: total === 0 ? 0 : (done + partial) / total, done, total, etaMs }
}

export const register: Register = on => {
  let ticking = false

  on('session.start', async ($, e, next) => {
    if (!ticking) {
      ticking = true
      // Keeps the elapsed time, ETA and sweep moving between tool calls.
      $.clock.every(TICK_MS, async () => {
        if ((await read($, plan)) !== null || (await read($, turnStartedAt)) !== null) {
          $.ui.invalidate('ui.render')
        }
      })
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // A subagent's turn is part of the main one, which is already shown.
    if (e.agentId !== undefined) return next(e)

    const now = await $.clock.now()
    await update($, turnStartedAt, () => now)
    await update($, isHidden, () => false)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // A subagent's own todo list is not the task the person is watching.
    if (e.agentId !== undefined) return next(e)

    const args = e as unknown as Record<string, unknown>
    const current = (await read($, plan))?.steps ?? []

    if (e.tool === 'TodoWrite' && Array.isArray(args.todos)) {
      await setSteps($, args.todos.map((t: { content?: unknown; status?: unknown }) => ({
        key: String(t.content ?? ''),
        subject: String(t.content ?? ''),
        status: asStatus(t.status),
      })))
      return next(e)
    }

    if (e.tool === 'TaskCreate') {
      const ran = await next(e)
      const id = (ran.result as { task?: { id?: unknown } } | undefined)?.task?.id
      if (ran.deny === undefined && !ran.isError && id !== undefined) {
        await setSteps($, [...current, { key: String(id), subject: String(args.subject ?? ''), status: 'pending' }])
      }
      return ran
    }

    if (e.tool === 'TaskUpdate' && typeof args.taskId === 'string') {
      const key = args.taskId
      const steps = args.status === 'deleted'
        ? current.filter(s => s.key !== key)
        : current.map(s => (s.key === key
          ? {
            ...s,
            subject: typeof args.subject === 'string' ? args.subject : s.subject,
            status: args.status === undefined ? s.status : asStatus(args.status),
          }
          : s))
      await setSteps($, steps)
      return next(e)
    }

    if (e.tool === 'mcp__ccd_turn__update_plan') {
      const steps = fromUpdatePlan(current, args)
      if (steps !== null) await setSteps($, steps)
      return next(e)
    }

    if (e.tool === 'mcp__ccd_turn__wrap_up' && current.length > 0) {
      await setSteps($, current.map(s => ({ ...s, status: 'completed' as const })))
    }

    return next(e)
  }).catch(($, e, next) =>
    // The mod only watches: a failure of its own never holds the call.
    next(e),
  )

  // A finished plan leaves the band once the turn that finished it ends.
  on('turn.complete', async ($, e, next) => {
    if ((e as { agentId?: string }).agentId !== undefined) return next(e)

    await update($, turnStartedAt, () => null)
    const p = await read($, plan)
    if (p !== null && p.steps.every(s => s.status === 'completed')) {
      await update($, plan, () => null)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await read($, plan)
    const startedAt = await read($, turnStartedAt)
    const hasPlan = p !== null && p.steps.length > 0
    // Shown only while Claude works; a list kept between turns waits for the next one.
    if (e.props.hasSurvey || startedAt === null || (await read($, isHidden))) {
      return next(e)
    }

    const now = await $.clock.now()
    const { Box, Button, Text } = $.ui.resolve(e)
    const hide = (
      <Button
        key="hide"
        label="Hide"
        onPress={() => update($, isHidden, () => true)}
      />
    )

    if (!hasPlan) {
      // No task list yet: a sweeping block and the turn's elapsed time.
      const span = BAR_CELLS - SWEEP_CELLS
      const step = Math.floor((now - (startedAt ?? now)) / TICK_MS) % (span * 2)
      const at = step <= span ? step : span * 2 - step

      return (
        <Box>
          <Text dimColor>{'░'.repeat(at)}</Text>
          <Text color="claude">{'█'.repeat(SWEEP_CELLS)}</Text>
          <Text dimColor>{'░'.repeat(span - at)}</Text>
          <Text> Working · </Text>
          <Text dimColor>{formatDuration(now - (startedAt ?? now))} · no task list yet </Text>
          {hide}
        </Box>
      )
    }

    const { fraction, done, total, etaMs } = estimate(p, now)
    const filled = Math.round(fraction * BAR_CELLS)
    const active = p.steps.find(s => s.status === 'in_progress')
      ?? p.steps.find(s => s.status === 'pending')
    const isFinished = done === total
    const label = isFinished ? 'Done' : active?.subject ?? ''
    const eta = isFinished
      ? ''
      : etaMs === null ? ' · ETA after first step' : ` · ~${formatDuration(etaMs)} left`

    return (
      <Box>
        <Text color={isFinished ? 'success' : 'claude'}>{'█'.repeat(filled)}</Text>
        <Text dimColor>{'░'.repeat(BAR_CELLS - filled)}</Text>
        <Text> {Math.round(fraction * 100)}% · {done}/{total} · </Text>
        <Text bold>{label}</Text>
        <Text dimColor>
          {' '}· {formatDuration(now - p.startedAt)}{eta}{' '}
        </Text>
        {hide}
      </Box>
    )
  })
}
