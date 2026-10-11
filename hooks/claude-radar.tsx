import type { AgentPhase, ChecklistTask, ClaudeRadarState, SubagentState, SubagentStatus } from '../types'

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
    finishedAt: null,
    isCollapsed: true
  },
  subagents: {},
  tick: 0
})

/** The label of the header's button. */
export const buttonLabel = (enabled: boolean) => `[ ● Claude Radar: ${enabled ? 'ON' : 'OFF'} ]`

/** How often the one timer ticks, in milliseconds: the animation's step. */
export const TICK_MS = 250

/** How long the finished panel stays open before it folds into one line, in milliseconds. */
export const COLLAPSE_MS = 5000

/** The segments of a progress bar. */
export const BAR_WIDTH = 10

/** The segments the indeterminate bar's moving block fills. */
const BLOCK_WIDTH = 3

/** Below this many columns the checklist drops its bars. */
export const BARS_MIN_COLUMNS = 40

/** The characters a label takes: the longest, `Working`; the others are padded to it so the bars line up. */
const LABEL_WIDTH = 7

/** The most characters of an activity's name. */
const NAME_MAX = 40

/** The title of a turn whose text leaves nothing to name it by. */
const DEFAULT_TITLE = 'Working on your request'

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

/** The text without file paths and code fragments, spaces collapsed, the first letter in capitals, and at most 40 characters cut by words; empty when nothing is left. */
const clean = (text: string) => {
  const kept = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/`/g, ' ')
    // Any word with a slash in it is a path (or a URL), `C:\dir\file` included.
    .replace(/\S*[\\/]\S*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;,.\-–]+|[\s:;,\-–]+$/g, '')

  if (kept === '') return ''

  const named = kept.charAt(0).toUpperCase() + kept.slice(1)

  if (named.length <= NAME_MAX) return named

  // One character past the limit: a word that ends exactly on it stays whole.
  const head = named.slice(0, NAME_MAX + 1)
  const space = head.lastIndexOf(' ')

  return (space > 0 ? head.slice(0, space) : named.slice(0, NAME_MAX)).replace(/[\s:;,\-–]+$/, '')
}

/** The short name of an activity: paths and code taken out, 40 characters at most; `Working on it` when nothing valid is left. */
export const normalizeActivity = (text: string) => clean(text) || 'Working on it'

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
    title: clean(text) || DEFAULT_TITLE,
    phase: 'working',
    tasks: [],
    needsYouReason: null,
    stuckReason: null,
    startedAt: now,
    finishedAt: null,
    isCollapsed: false
  })

/** The end of a turn: answered is done, interrupted is stopped, an error or a refusal is stuck. Tasks still active stay as they were. */
export const finishTurn = (state: ClaudeRadarState, reason: TurnReason, now: number): ClaudeRadarState => {
  const phase: AgentPhase = reason === 'answer' ? 'done' : reason === 'aborted' ? 'stopped' : 'stuck'
  const stuckReason =
    reason === 'error' ? 'The turn ended with an error' : reason === 'refusal' ? 'The model declined to answer' : null

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
  state.checklist.phase === 'working' ? patchChecklist(state, { phase: 'needsYou', needsYouReason: 'Waiting for your permission' }) : state

/** Back to work after a wait for the person; anything else stays as it is. */
export const resumeWork = (state: ClaudeRadarState): ClaudeRadarState =>
  state.checklist.phase === 'needsYou' ? patchChecklist(state, { phase: 'working', needsYouReason: null }) : state

/** Folds a finished panel into one line once `COLLAPSE_MS` have passed since it ended. */
export const collapseIfDue = (state: ClaudeRadarState, now: number): ClaudeRadarState => {
  const { finishedAt, isCollapsed } = state.checklist

  return finishedAt !== null && !isCollapsed && now - finishedAt >= COLLAPSE_MS ? patchChecklist(state, { isCollapsed: true }) : state
}

/** One step of the timer: the animation moves on, a panel that has been finished long enough folds and finished subagents are retired. */
export const advance = (state: ClaudeRadarState, now: number): ClaudeRadarState => {
  const next = pruneFinished(collapseIfDue(state, now), now)

  return { ...next, tick: next.tick + 1 }
}

/** Whether the timer has something to move: a turn at work or waiting, a finished panel not yet folded, or any subagent still listed (running, or finished and not yet retired). */
export const isLive = (state: ClaudeRadarState) => {
  const { phase, finishedAt, isCollapsed } = state.checklist

  return (
    phase === 'working' || phase === 'needsYou' || (finishedAt !== null && !isCollapsed) || Object.keys(state.subagents).length > 0
  )
}

/** Whether the tool rows (calls, results, groups, progress) are hidden now: the radar is ON and work goes on (the main turn working, or any subagent at work), and nobody waits for the person: a call that asks permission stays in view. */
export const hidesTools = (state: ClaudeRadarState) => {
  if (!state.claudeRadarEnabled) return false

  const { phase } = state.checklist

  if (phase === 'needsYou' || Object.values(state.subagents).some(agent => agent.status === 'needsYou')) return false

  return phase === 'working' || activeCount(state.subagents) > 0
}

/** How the header reads: what it says, the figure that goes with it and the tone that colours the first. */
export type Headline = {
  label: string
  detail: string | null
  tone: AgentPhase
}

/** The header's text for the phase: the title and the time while working (frozen when it ends), the reason when stuck or waiting. */
export const headlineOf = (checklist: Checklist, now: number): Headline => {
  const { phase, title, startedAt, finishedAt, needsYouReason, stuckReason } = checklist
  const since = startedAt ?? now
  const took = elapsed((finishedAt ?? now) - since)

  switch (phase) {
    case 'needsYou':
      return { label: 'Needs you', detail: needsYouReason, tone: phase }
    case 'stuck':
      return { label: 'Stuck', detail: stuckReason, tone: phase }
    case 'stopped':
      return { label: 'Stopped', detail: null, tone: phase }
    case 'done':
      return { label: 'All done', detail: took, tone: phase }
    default:
      return { label: title || DEFAULT_TITLE, detail: took, tone: phase }
  }
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
const LABELS = { done: 'Done', active: 'Working', upcoming: 'Next' } as const

/** The row of a task: a full bar when done, the real percentage or the moving block when active, an empty one when it waits. */
export const rowOf = (task: ChecklistTask, tick: number): TaskRow => ({
  mark: MARKS[task.status],
  name: task.name,
  bar: task.status === 'done' ? bar(100, tick) : task.status === 'active' ? bar(task.percent, tick) : bar(0, tick),
  label: LABELS[task.status].padEnd(LABEL_WIDTH),
  status: task.status
})

/** The rows to draw: the tasks, or, when there are none and the agent is working, the one line that says so. */
export const rowsOf = (checklist: Checklist, tick: number): TaskRow[] => {
  if (checklist.tasks.length > 0) return checklist.tasks.map(task => rowOf(task, tick))
  if (checklist.phase !== 'working') return []

  return [rowOf({ id: 'request', name: DEFAULT_TITLE, status: 'active', percent: null, hasReported: false }, tick)]
}

/** How the rows fit `bodyColumns`: whether the bars show, and how many columns a name may take. Nothing is wider than the block's inner width (`bodyColumns` less border and padding). */
export const layoutOf = (rows: readonly TaskRow[], bodyColumns: number) => {
  const inner = Math.max(0, bodyColumns - 4)
  const showBars = bodyColumns >= BARS_MIN_COLUMNS
  // The mark and its space, the gap and the bar, the gap and the label.
  const fixed = 2 + (showBars ? 2 + BAR_WIDTH : 0) + 2 + LABEL_WIDTH
  const longest = rows.reduce((most, row) => Math.max(most, row.name.length), 1)

  return { showBars, nameWidth: Math.max(1, Math.min(longest, inner - fixed)) }
}

/** How long a finished subagent stays listed before it is retired, in milliseconds. */
export const RETIRE_MS = 5000

/** Below this many columns the subagents drop their status column. */
export const STATUS_MIN_COLUMNS = 40

type Subagents = ClaudeRadarState['subagents']

/** What a spawn tells about the subagent it started. */
export type SubagentSpawn = {
  id: string
  name: string
  task?: string | null
  parentId?: string
  sessionId?: string
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

  return { ...state, subagents: { ...state.subagents, [spawn.id]: agent } }
}

/** Looks like a test run: `test`, `jest`, `vitest`, `pytest` at the start of a word (so `latest` does not count). */
const TEST_COMMAND = /(?<![a-z])(?:test|jest|vitest|pytest)/i

/** What a tool call says about the work, in plain words and never a path, a command or code; `null` for a tool the radar does not know, so the activity stays as it was. */
export const activityOf = (tool: string, command?: string): string | null => {
  switch (tool) {
    case 'Read':
      return 'Reading project files'
    case 'Glob':
    case 'Grep':
    case 'WebSearch':
    case 'WebFetch':
      return 'Searching project information'
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return 'Updating project files'
    case 'Bash':
      return TEST_COMMAND.test(command ?? '') ? 'Running tests' : 'Running a command'
    case 'Agent':
    case 'Task':
      return 'Delegating work'
    default:
      return null
  }
}

/** A call of the subagent's own: its activity becomes `activity` (kept when `null`), and a wait or a finish is over, the agent is working again. An agent not followed changes nothing. */
export const workSubagent = (state: ClaudeRadarState, id: string, activity: string | null): ClaudeRadarState => {
  if (!isKnown(state, id)) return state

  const agent = state.subagents[id]!
  const isChanged = (activity !== null && activity !== agent.activity) || agent.status !== 'working'

  if (!isChanged) return state

  return patchSubagent(state, id, {
    activity: activity ?? agent.activity,
    status: 'working',
    finishedAt: null
  })
}

/** The subagent waits for the person's permission; only while it is working. */
export const askSubagent = (state: ClaudeRadarState, id: string): ClaudeRadarState =>
  isKnown(state, id) && state.subagents[id]!.status === 'working' ? patchSubagent(state, id, { status: 'needsYou' }) : state

/** The end of a subagent's turn: answered is done, interrupted is stopped, an error or a refusal is failed. The first end stands: one already finished is left as it is (a new call revives it, see `workSubagent`). */
export const finishSubagent = (state: ClaudeRadarState, id: string, reason: TurnReason, now: number): ClaudeRadarState => {
  if (!isKnown(state, id) || !isActive(state.subagents[id]!.status)) return state

  const status: SubagentStatus = reason === 'answer' ? 'done' : reason === 'aborted' ? 'stopped' : 'failed'

  return patchSubagent(state, id, { status, finishedAt: now })
}

/** Takes out the subagents that finished `RETIRE_MS` ago or more; the same state when none is due. */
export const pruneFinished = (state: ClaudeRadarState, now: number): ClaudeRadarState => {
  const kept = Object.entries(state.subagents).filter(([, agent]) => agent.finishedAt === null || now - agent.finishedAt < RETIRE_MS)

  return kept.length === Object.keys(state.subagents).length ? state : { ...state, subagents: Object.fromEntries(kept) }
}

/** How many subagents are at work (running or waiting for the person). */
export const activeCount = (subagents: Subagents) => Object.values(subagents).filter(agent => isActive(agent.status)).length

/** The two lines of a subagent, as text: the mark, the name and the time, then the activity and the status. */
export type SubagentRow = {
  id: string
  mark: '●' | '✓' | '✗' | '■'
  name: string
  time: string
  activity: string
  label: string
  status: SubagentStatus
  /** 0 for a flat list or a root; one more per known ancestor. */
  depth: number
}

const SUBAGENT_MARKS = { working: '●', needsYou: '●', done: '✓', failed: '✗', stopped: '■' } as const
const SUBAGENT_LABELS = { working: 'Working', needsYou: 'Needs you', done: 'Done', failed: 'Failed', stopped: 'Stopped' } as const

/** The row of a subagent: its own time (frozen once it ended) and, as activity, what its tools say, else its task, else `Working`. */
export const subagentRowOf = (agent: SubagentState, now: number, depth = 0): SubagentRow => ({
  id: agent.id,
  mark: SUBAGENT_MARKS[agent.status],
  name: agent.name,
  time: elapsed((agent.finishedAt ?? now) - agent.startedAt),
  activity: (agent.activity ?? (agent.task === null ? '' : clean(agent.task))) || 'Working',
  label: SUBAGENT_LABELS[agent.status],
  status: agent.status,
  depth
})

/** The rows in start order. A hierarchy shows only where `parentId` names an agent still listed: its children follow it, one level in; otherwise the list is flat. */
export const subagentRowsOf = (subagents: Subagents, now: number): SubagentRow[] => {
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

  const rows: SubagentRow[] = []
  const seen = new Set<string>()

  const walk = (agent: SubagentState, depth: number) => {
    if (seen.has(agent.id)) return

    seen.add(agent.id)
    rows.push(subagentRowOf(agent, now, depth))
    for (const child of children.get(agent.id) ?? []) walk(child, depth + 1)
  }

  for (const agent of roots) walk(agent, 0)
  // Parents that point at each other have no root: list them flat rather than lose them.
  for (const agent of all) walk(agent, 0)

  return rows
}

/** What the subagents section draws in `lines` rows (its header included): the rows that fit, active ones first and in their order, how many were left out, and whether the status column fits. `null` when there are no subagents. */
export const subagentViewOf = (subagents: Subagents, now: number, lines: number, bodyColumns: number) => {
  const all = subagentRowsOf(subagents, now)

  if (all.length === 0) return null

  // Two rows each; when some are left out, one more row says how many.
  const room = Number.isFinite(lines) ? Math.max(0, lines) : 0
  const slots = Math.min(all.length, Math.max(0, Math.floor((room - (room - 1 >= all.length * 2 ? 1 : 2)) / 2)))
  const keep = new Set(
    all
      .map((row, index) => index)
      .sort((a, b) => Number(!isActive(all[a]!.status)) - Number(!isActive(all[b]!.status)) || a - b)
      .slice(0, slots)
  )

  return {
    active: activeCount(subagents),
    rows: all.filter((_, index) => keep.has(index)),
    hidden: all.length - slots,
    showStatus: bodyColumns >= STATUS_MIN_COLUMNS
  }
}
