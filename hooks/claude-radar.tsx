import type { ActivityCode, AgentPhase, ChecklistTask, ClaudeRadarState, ModelInfo, ReasonCode, SubagentState, SubagentStatus } from '../types'

import type { Texts } from './i18n'

/** The radar's state before anything has happened: on by default, nothing running, nothing to show. */
export const initialState = (): ClaudeRadarState => ({
  claudeRadarEnabled: true,
  checklist: {
    title: '',
    phase: 'done',
    tasks: [],
    needsYouReason: null,
    stuckReason: null,
    startedAt: null,
    finishedAt: null
  },
  subagents: {},
  history: [],
  tick: 0
})

/** A session that ended: everything the radar followed is gone; only the ON/OFF choice stays. */
export const resetSession = (state: ClaudeRadarState): ClaudeRadarState => ({ ...initialState(), claudeRadarEnabled: state.claudeRadarEnabled })

/** The label of the ON/OFF button. */
export const buttonLabel = (enabled: boolean, t: Texts) => `[ ● ${t.toggle(enabled)} ]`

/** How often the one timer ticks, in milliseconds: the animation's step. */
export const TICK_MS = 250

/** The segments of a progress bar. */
export const BAR_WIDTH = 10

/** The segments the indeterminate bar's moving block fills. */
const BLOCK_WIDTH = 3

/** Below this many columns the checklist drops its bars. */
export const BARS_MIN_COLUMNS = 40

/** The most characters of an activity's name. */
const NAME_MAX = 40

type Checklist = ClaudeRadarState['checklist']

/** What `turn.complete` says about why the turn ended. */
export type TurnReason = 'answer' | 'aborted' | 'refusal' | 'error'

/** One item of a `TodoWrite` list, as the tool takes it. */
export type Todo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

/** The same state with `patch` laid over its checklist. */
const patchChecklist = (state: ClaudeRadarState, patch: Partial<Checklist>): ClaudeRadarState => ({
  ...state,
  checklist: { ...state.checklist, ...patch }
})

/** How long a duration reads: `45s`, `2m 35s`, `1h 02m 03s`. */
export const elapsed = (ms: number) => {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const two = (n: number) => String(n).padStart(2, '0')

  if (hours > 0) return `${hours}h ${two(minutes)}m ${two(seconds)}s`
  if (minutes > 0) return `${minutes}m ${two(seconds)}s`

  return `${seconds}s`
}

/** The text without file paths and code fragments, spaces collapsed and the first letter in capitals, whatever its length; empty when nothing is left. */
const tidy = (text: string) => {
  const kept = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/`/g, ' ')
    // Any word with a slash in it is a path (or a URL), `C:\dir\file` included.
    .replace(/\S*[\\/]\S*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;,.\-–]+|[\s:;,\-–]+$/g, '')

  return kept === '' ? '' : kept.charAt(0).toUpperCase() + kept.slice(1)
}

/** The tidied text cut to at most 40 characters by words; empty when nothing is left. */
const clean = (text: string) => {
  const named = tidy(text)

  if (named.length <= NAME_MAX) return named

  // One character past the limit: a word that ends exactly on it stays whole.
  const head = named.slice(0, NAME_MAX + 1)
  const space = head.lastIndexOf(' ')

  return (space > 0 ? head.slice(0, space) : named.slice(0, NAME_MAX)).replace(/[\s:;,\-–]+$/, '')
}

/** The short name of an activity: paths and code taken out, 40 characters at most; empty when nothing valid is left (the drawing puts `Working on it`, in its language, in its place). */
export const normalizeActivity = (text: string) => clean(text)

/** The progress bar of 10 segments: `percent` (0 to 100) fills it; `null` moves a block of 3 along it with `tick`. */
export const bar = (percent: number | null, tick: number) => {
  if (percent === null || !Number.isFinite(percent)) {
    const head = ((Math.floor(tick) % BAR_WIDTH) + BAR_WIDTH) % BAR_WIDTH

    return Array.from({ length: BAR_WIDTH }, (_, i) => ((i - head + BAR_WIDTH) % BAR_WIDTH < BLOCK_WIDTH ? '█' : '░')).join('')
  }

  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * BAR_WIDTH)

  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

/** A new turn: working from `now`, nothing kept of the last one, its title made from the prompt. */
export const startTurn = (state: ClaudeRadarState, text: string, now: number): ClaudeRadarState =>
  patchChecklist(state, {
    title: clean(text) || null,
    phase: 'working',
    tasks: [],
    needsYouReason: null,
    stuckReason: null,
    startedAt: now,
    finishedAt: null
  })

/** The end of a turn: answered is done, interrupted is stopped, an error or a refusal is stuck. Tasks still active stay as they were. */
export const finishTurn = (state: ClaudeRadarState, reason: TurnReason, now: number): ClaudeRadarState => {
  const phase: AgentPhase = reason === 'answer' ? 'done' : reason === 'aborted' ? 'stopped' : 'stuck'
  const stuckReason: ReasonCode | null = reason === 'error' ? 'error' : reason === 'refusal' ? 'refusal' : null

  return patchChecklist(state, { phase, needsYouReason: null, stuckReason, finishedAt: now })
}

/** The status a task takes from `TodoWrite`'s or `TaskUpdate`'s, or `null` for one that is gone. */
const statusOf = (status: string): ChecklistTask['status'] | null =>
  status === 'completed' ? 'done' : status === 'in_progress' ? 'active' : status === 'deleted' ? null : 'upcoming'

/** The checklist `TodoWrite` wrote, in place of what was there. */
export const writeTodos = (state: ClaudeRadarState, todos: readonly Todo[]): ClaudeRadarState =>
  patchChecklist(state, {
    tasks: todos.map((todo, index) => {
      const status = statusOf(todo.status) ?? 'upcoming'

      return {
        id: String(index),
        name: normalizeActivity(status === 'active' && todo.activeForm ? todo.activeForm : todo.content),
        status,
        percent: null,
        hasReported: true
      }
    })
  })

/** The id `TaskCreate` gave the new task, from its result; `fallback` when the result brings none. */
export const taskIdOf = (result: unknown, fallback: string) => {
  const id = (result as { task?: { id?: unknown } } | null | undefined)?.task?.id

  return typeof id === 'string' || typeof id === 'number' ? String(id) : fallback
}

/** Whether a tool's answer is one of a call that ran: not refused, not an error. */
export const didRun = (ran: { deny?: unknown; isError?: unknown }) => ran.deny === undefined && ran.isError !== true

/** A task `TaskCreate` added, upcoming; one with that id already there is renamed, not repeated. */
export const addTask = (state: ClaudeRadarState, id: string, subject: string): ClaudeRadarState => {
  const name = normalizeActivity(subject)
  const tasks = state.checklist.tasks

  if (tasks.some(task => task.id === id)) {
    return patchChecklist(state, { tasks: tasks.map(task => (task.id === id ? { ...task, name } : task)) })
  }

  return patchChecklist(state, { tasks: [...tasks, { id, name, status: 'upcoming', percent: null, hasReported: true }] })
}

/** What `TaskUpdate` changed in a task: its status (`deleted` takes it out) and its subject. */
export const updateTask = (
  state: ClaudeRadarState,
  taskId: string,
  change: { status?: string; subject?: string }
): ClaudeRadarState => {
  const tasks = state.checklist.tasks

  if (!tasks.some(task => task.id === taskId)) return state

  if (change.status === 'deleted') return patchChecklist(state, { tasks: tasks.filter(task => task.id !== taskId) })

  return patchChecklist(state, {
    tasks: tasks.map(task => {
      if (task.id !== taskId) return task

      return {
        ...task,
        status: change.status === undefined ? task.status : (statusOf(change.status) ?? task.status),
        name: change.subject === undefined ? task.name : normalizeActivity(change.subject)
      }
    })
  })
}

/** Claude waits for the person's permission; only while the turn is working. */
export const askUser = (state: ClaudeRadarState): ClaudeRadarState =>
  state.checklist.phase === 'working' ? patchChecklist(state, { phase: 'needsYou', needsYouReason: 'permission' }) : state

/** Back to work after a wait for the person; anything else stays as it is. */
export const resumeWork = (state: ClaudeRadarState): ClaudeRadarState =>
  state.checklist.phase === 'needsYou' ? patchChecklist(state, { phase: 'working', needsYouReason: null }) : state

/** One step of the timer: the animation moves on and finished subagents are retired. */
export const advance = (state: ClaudeRadarState, now: number): ClaudeRadarState => {
  const next = pruneFinished(state, now)

  return { ...next, tick: next.tick + 1 }
}

/** Whether the timer has something to move while the pane is open: a turn at work or waiting, or any subagent still listed (running, or finished and not yet retired). */
export const isLive = (state: ClaudeRadarState) => {
  const { phase } = state.checklist

  return phase === 'working' || phase === 'needsYou' || Object.keys(state.subagents).length > 0
}

/** Whether the tool rows (calls, results, groups, progress) are hidden now: the radar is ON and work goes on (the main turn working, or any subagent at work), and nobody waits for the person: a call that asks permission stays in view. */
export const hidesTools = (state: ClaudeRadarState) => {
  if (!state.claudeRadarEnabled) return false

  const { phase } = state.checklist

  if (phase === 'needsYou' || Object.values(state.subagents).some(agent => agent.status === 'needsYou')) return false

  return phase === 'working' || activeCount(state.subagents) > 0
}

/** A line of the checklist, as text: the mark, the name, the bar and the label of its status. */
export type TaskRow = {
  mark: '✓' | '▶' | '○'
  name: string
  bar: string
  label: string
  status: ChecklistTask['status']
}

const MARKS = { done: '✓', active: '▶', upcoming: '○' } as const

/** The characters a task's label takes: the longest of the language's three; the others are padded to it so the bars line up. */
const labelWidthOf = (t: Texts) => Math.max(...Object.values(t.task).map(label => label.length))

/** The row of a task: a full bar when done, the real percentage or the moving block when active, an empty one when it waits. */
export const rowOf = (task: ChecklistTask, tick: number, t: Texts): TaskRow => ({
  mark: MARKS[task.status],
  name: task.name || t.workingOnIt,
  bar: task.status === 'done' ? bar(100, tick) : task.status === 'active' ? bar(task.percent, tick) : bar(0, tick),
  label: t.task[task.status].padEnd(labelWidthOf(t)),
  status: task.status
})

/** The rows to draw: the tasks, or, when there are none and the agent is working, the one line that says so. */
export const rowsOf = (checklist: Checklist, tick: number, t: Texts): TaskRow[] => {
  if (checklist.tasks.length > 0) return checklist.tasks.map(task => rowOf(task, tick, t))
  if (checklist.phase !== 'working') return []

  return [rowOf({ id: 'request', name: t.defaultTitle, status: 'active', percent: null, hasReported: false }, tick, t)]
}

/** How the rows fit `bodyColumns`: whether the bars show, and how many columns a name may take. Nothing is wider than the block's inner width (`bodyColumns` less border and padding). */
export const layoutOf = (rows: readonly TaskRow[], bodyColumns: number) => {
  const inner = Math.max(0, bodyColumns - 4)
  const showBars = bodyColumns >= BARS_MIN_COLUMNS
  // The mark and its space, the gap and the bar, the gap and the label.
  const labelWidth = rows.reduce((most, row) => Math.max(most, row.label.length), 0)
  const fixed = 2 + (showBars ? 2 + BAR_WIDTH : 0) + 2 + labelWidth
  const longest = rows.reduce((most, row) => Math.max(most, row.name.length), 1)

  return { showBars, nameWidth: Math.max(1, Math.min(longest, inner - fixed)) }
}

/** How long a finished subagent stays listed before it is retired, in milliseconds. */
export const RETIRE_MS = 5000

/** The most finished subagents the history keeps. */
export const HISTORY_MAX = 50

/** Below this many columns of the pane body the subagents drop their status column. */
export const STATUS_MIN_COLUMNS = 36

type Subagents = ClaudeRadarState['subagents']

/** What a spawn tells about the subagent it started. */
export type SubagentSpawn = {
  id: string
  name: string
  task?: string | null
  parentId?: string
  sessionId?: string
  /** The model the spawn started it on, when the engine said. */
  model?: string
}

/** Whether the radar follows this agent; ids are keys, so inherited names do not count. */
const isKnown = (state: ClaudeRadarState, id: string) => Object.prototype.hasOwnProperty.call(state.subagents, id)

/** The same state with `patch` laid over one subagent. */
const patchSubagent = (state: ClaudeRadarState, id: string, patch: Partial<SubagentState>): ClaudeRadarState => ({
  ...state,
  subagents: { ...state.subagents, [id]: { ...state.subagents[id]!, ...patch } }
})

/** Whether a subagent is still at work: running or waiting for the person. */
const isActive = (status: SubagentStatus) => status === 'working' || status === 'needsYou'

/** A subagent that started: working from `now`, under its own id so two runs of one agent never merge. A second spawn with a known id changes nothing. */
export const spawnSubagent = (state: ClaudeRadarState, spawn: SubagentSpawn, now: number): ClaudeRadarState => {
  if (isKnown(state, spawn.id)) return state

  const agent: SubagentState = {
    id: spawn.id,
    sessionId: spawn.sessionId ?? '',
    name: spawn.name.trim() || 'agent',
    task: spawn.task?.trim() || null,
    activity: null,
    status: 'working',
    startedAt: now,
    finishedAt: null
  }

  if (spawn.parentId) agent.parentId = spawn.parentId
  if (spawn.model) agent.modelInfo = { model: spawn.model, effort: null }

  return { ...state, subagents: { ...state.subagents, [spawn.id]: agent } }
}

/** A model id in short form: `claude-opus-4-5-20251101` is `opus-4-5`; an alias (`haiku`) stays as it is. */
export const shortModel = (id: string) =>
  id
    .replace(/^.*claude-/i, '')
    .replace(/-[0-9]{8}(?![0-9])/, '')
    .replace(/\[[^\]]*\]$/, '')
    .trim() || id

/** `opus-4-5 · high`: the model, short, and the effort when the model has one; null when nothing is known. */
export const detailOf = (info: ModelInfo | undefined): string | null =>
  info === undefined ? null : [shortModel(info.model), info.effort].filter(part => part !== null && part !== '').join(' · ')

/** The model and effort of a request of `id` (the main agent when `id` is undefined). The same state when nothing changes or the subagent is not followed. */
export const stepModel = (state: ClaudeRadarState, id: string | undefined, info: ModelInfo): ClaudeRadarState => {
  const same = (current: ModelInfo | undefined) => current?.model === info.model && current.effort === info.effort

  if (id === undefined) return same(state.leaderModel) ? state : { ...state, leaderModel: info }
  if (!isKnown(state, id) || same(state.subagents[id]!.modelInfo)) return state

  return patchSubagent(state, id, { modelInfo: info })
}

/** Looks like a test run: `test`, `jest`, `vitest`, `pytest` at the start of a word (so `latest` does not count). */
const TEST_COMMAND = /(?<![a-z])(?:test|jest|vitest|pytest)/i

/** What a tool call says about the work, in plain words and never a path, a command or code; `null` for a tool the radar does not know, so the activity stays as it was. */
export const activityOf = (tool: string, command?: string): ActivityCode | null => {
  switch (tool) {
    case 'Read':
      return 'reading'
    case 'Glob':
    case 'Grep':
    case 'WebSearch':
    case 'WebFetch':
      return 'searching'
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return 'updating'
    case 'Bash':
      return TEST_COMMAND.test(command ?? '') ? 'testing' : 'command'
    case 'Agent':
    case 'Task':
      return 'delegating'
    default:
      return null
  }
}

/** A call of the subagent's own: its activity becomes `activity` (kept when `null`), and a wait or a finish is over, the agent is working again. An agent not followed changes nothing. */
export const workSubagent = (state: ClaudeRadarState, id: string, activity: ActivityCode | null): ClaudeRadarState => {
  if (!isKnown(state, id)) return state

  const agent = state.subagents[id]!
  const isChanged = (activity !== null && activity !== agent.activity) || agent.status !== 'working'

  if (!isChanged) return state

  const revived = patchSubagent(state, id, {
    activity: activity ?? agent.activity,
    status: 'working',
    finishedAt: null
  })

  // Alive again: it is no longer a finished one.
  return isActive(agent.status) ? revived : { ...revived, history: revived.history.filter(entry => entry.id !== id) }
}

/** The subagent waits for the person's permission; only while it is working. */
export const askSubagent = (state: ClaudeRadarState, id: string): ClaudeRadarState =>
  isKnown(state, id) && state.subagents[id]!.status === 'working' ? patchSubagent(state, id, { status: 'needsYou' }) : state

/** The end of a subagent's turn: answered is done, interrupted is stopped, an error or a refusal is failed. The first end stands: one already finished is left as it is (a new call revives it, see `workSubagent`). */
export const finishSubagent = (state: ClaudeRadarState, id: string, reason: TurnReason, now: number): ClaudeRadarState => {
  if (!isKnown(state, id) || !isActive(state.subagents[id]!.status)) return state

  const status: SubagentStatus = reason === 'answer' ? 'done' : reason === 'aborted' ? 'stopped' : 'failed'

  const ended = patchSubagent(state, id, { status, finishedAt: now })

  return { ...ended, history: recordHistory(ended.history, ended.subagents[id]!) }
}

/** The history with `agent` at the front: a copy of its final state, one entry per id, at most `HISTORY_MAX`. */
export const recordHistory = (history: readonly SubagentState[], agent: SubagentState): SubagentState[] =>
  [{ ...agent }, ...history.filter(entry => entry.id !== agent.id)].slice(0, HISTORY_MAX)

/** Takes out the subagents that finished `RETIRE_MS` ago or more, making sure each is in the history; the same state when none is due. The history is the pane's; nothing else reads it. */
export const pruneFinished = (state: ClaudeRadarState, now: number): ClaudeRadarState => {
  const entries = Object.entries(state.subagents)
  const isDue = (agent: SubagentState) => agent.finishedAt !== null && now - agent.finishedAt >= RETIRE_MS
  const due = entries.map(([, agent]) => agent).filter(isDue)

  if (due.length === 0) return state

  const history = due
    .filter(agent => !state.history.some(entry => entry.id === agent.id))
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
    .reduce(recordHistory, state.history)

  return { ...state, history, subagents: Object.fromEntries(entries.filter(([, agent]) => !isDue(agent))) }
}

/** How many subagents are at work (running or waiting for the person). */
export const activeCount = (subagents: Subagents) => Object.values(subagents).filter(agent => isActive(agent.status)).length

const SUBAGENT_MARKS = { working: '●', needsYou: '●', done: '✓', failed: '✗', stopped: '■' } as const

/** The subagents in start order, each with its depth. A hierarchy shows only where `parentId` names an agent still listed: its children follow it, one level in; otherwise the list is flat. */
const orderedSubagents = (subagents: Subagents): { agent: SubagentState; depth: number }[] => {
  const all = Object.values(subagents).sort((a, b) => a.startedAt - b.startedAt)
  const children = new Map<string, SubagentState[]>()
  const roots: SubagentState[] = []

  for (const agent of all) {
    const parent = agent.parentId

    if (parent !== undefined && parent !== agent.id && Object.prototype.hasOwnProperty.call(subagents, parent)) {
      children.set(parent, [...(children.get(parent) ?? []), agent])
    } else {
      roots.push(agent)
    }
  }

  const ordered: { agent: SubagentState; depth: number }[] = []
  const seen = new Set<string>()

  const walk = (agent: SubagentState, depth: number) => {
    if (seen.has(agent.id)) return

    seen.add(agent.id)
    ordered.push({ agent, depth })
    for (const child of children.get(agent.id) ?? []) walk(child, depth + 1)
  }

  for (const agent of roots) walk(agent, 0)
  // Parents that point at each other have no root: list them flat rather than lose them.
  for (const agent of all) walk(agent, 0)

  return ordered
}

/** The id of the detail pane (1-64 of letters, digits, `_`, `-`). */
export const PANE_ID = 'agent-radar'

/** The body rows and the columns the pane asks for. */
export const PANE_ROWS = 14
export const PANE_COLUMNS = 60

/** The label of the band's detail button. */
export const hideButtonLabel = (t: Texts) => `[ ✕ ${t.hide} ]`

export const paneButtonLabel = (isOpen: boolean, t: Texts) => `[ ◧ ${isOpen ? t.close : t.detail} ]`

/** The pane's `Now` block: the turn's title, its phase with the reason, and its time (frozen once it ended). */
export type PaneNow = {
  title: string
  label: string
  /** Why it waits or is stuck, in words; null when there is no reason to give. */
  reason: string | null
  /** `opus-4-5 · high`, or null while the model is unknown. */
  detail: string | null
  time: string| null
  time: string
  tone: AgentPhase
}

/** A subagent in the pane: live or finished, with the whole task (one line, tidied) and the activity, in words. */
export type PaneAgent = {
  id: string
  mark: '●' | '✓' | '✗' | '■'
  status: SubagentStatus
  name: string
  time: string
  task: string | null
  activity: string
  label: string
  /** `opus-4-5 · high`, or null while the model is unknown. */
  detail: string | null
  depth: number
}

/** The pane's row of a subagent. */
const paneAgentOf = (agent: SubagentState, now: number, depth: number, t: Texts): PaneAgent => ({
  id: agent.id,
  mark: SUBAGENT_MARKS[agent.status],
  status: agent.status,
  name: agent.name,
  time: elapsed((agent.finishedAt ?? now) - agent.startedAt),
  task: (agent.task === null ? '' : tidy(agent.task)) || null,
  activity: agent.activity === null ? t.working : t.activity[agent.activity],
  label: t.agent[agent.status],
  detail: detailOf(agent.modelInfo),
  depth
})

/** The reason the turn waits or is stuck, in words; null in any other phase. */
const reasonOf = (checklist: Checklist, t: Texts) => {
  const code = checklist.phase === 'needsYou' ? checklist.needsYouReason : checklist.phase === 'stuck' ? checklist.stuckReason : null

  return code === null ? null : t.reason[code]
}

/** What the detail pane draws, from the state alone and in the language of `t`: the turn (`Now`) and its whole checklist, the subagents at work with their hierarchy, and the history of the finished ones, the most recent first. `isEmpty` when there is nothing at all. */
export const paneOf = (state: ClaudeRadarState, now: number, tick: number, t: Texts) => {
  const { checklist } = state
  const hasTurn = checklist.startedAt !== null

  const current: PaneNow | null = hasTurn
    ? {
        title: checklist.title ?? t.defaultTitle,
        label: t.phase[checklist.phase],
        reason: reasonOf(checklist, t),
        detail: detailOf(state.leaderModel),
        time: elapsed((checklist.finishedAt ?? now) - checklist.startedAt!),
        tone: checklist.phase
      }
    : null

  // A finished one stays listed for a moment but is already in the history: the live list is the ones at work.
  const live = orderedSubagents(state.subagents)
    .filter(({ agent }) => isActive(agent.status))
    .map(({ agent, depth }) => paneAgentOf(agent, now, depth, t))
  const history = state.history.map(agent => paneAgentOf(agent, now, 0, t))

  return {
    isEmpty: !hasTurn && live.length === 0 && history.length === 0,
    now: current,
    tasks: hasTurn ? rowsOf(checklist, tick, t) : [],
    live,
    history
  }
}
