import type { ActivityCode, AgentPhase, ChecklistTask, ClaudeRadarState, ModelInfo, ReasonCode, SubagentState, SubagentStatus, TurnRecord } from '../types'

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
  turns: [],
  tick: 0
})

/** A session that ended: everything the radar followed is gone, the archived turns too; only the ON/OFF choice stays. */
export const resetSession = (state: ClaudeRadarState): ClaudeRadarState => ({ ...initialState(), claudeRadarEnabled: state.claudeRadarEnabled })

/** The label of the ON/OFF button. */
export const buttonLabel = (enabled: boolean) => `[ ● ${enabled ? 'ON' : 'OFF'} ]`

/** How often the one timer ticks, in milliseconds: the animation's step. */
export const TICK_MS = 250

/** The segments of a progress bar. */
export const BAR_WIDTH = 10

/** The segments the indeterminate bar's moving block fills. */
const BLOCK_WIDTH = 3

/** The most characters of an activity's name. */
const NAME_MAX = 40

/** The most characters of a turn's title; the drawing cuts it again to the width of the pane. */
const TITLE_MAX = 80

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

/** The tidied text cut to at most `max` characters by words; empty when nothing is left. */
const clean = (text: string, max = NAME_MAX) => {
  const named = tidy(text)

  if (named.length <= max) return named

  // One character past the limit: a word that ends exactly on it stays whole.
  const head = named.slice(0, max + 1)
  const space = head.lastIndexOf(' ')

  return (space > 0 ? head.slice(0, space) : named.slice(0, max)).replace(/[\s:;,\-–]+$/, '')
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

/** The same state without the main agent's tokens: a turn starts counting from zero. */
const withoutLeaderTokens = (state: ClaudeRadarState): ClaudeRadarState => {
  const { leaderTokens: _, ...rest } = state

  return rest
}

/** A new turn: working from `now`, nothing kept of the last one (one still open is archived first, see `forceArchive`), its title made from the prompt (80 characters at most). */
export const startTurn = (state: ClaudeRadarState, text: string, now: number): ClaudeRadarState =>
  patchChecklist(withoutLeaderTokens(forceArchive(state, now)), {
    title: clean(text, TITLE_MAX) || null,
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

/** One step of the timer: the animation moves on. */
export const advance = (state: ClaudeRadarState): ClaudeRadarState => ({ ...state, tick: state.tick + 1 })

/** Whether the timer has something to move while the pane is open: a turn at work or waiting, or any subagent at work (a finished one is frozen). */
export const isLive = (state: ClaudeRadarState) => {
  const { phase } = state.checklist

  return phase === 'working' || phase === 'needsYou' || activeCount(state.subagents) > 0
}

/** Whether the tool rows (calls, results, groups, progress) are hidden now: the radar is ON and work goes on (the main turn working, or any subagent at work), and nobody waits for the person: a call that asks permission stays in view. */
export const hidesTools = (state: ClaudeRadarState) => {
  if (!state.claudeRadarEnabled) return false

  const { phase } = state.checklist

  if (phase === 'needsYou' || Object.values(state.subagents).some(agent => agent.status === 'needsYou')) return false

  return phase === 'working' || activeCount(state.subagents) > 0
}

/** A line of the checklist, as text: the mark and the name, nothing else (no bar, no label of its status). */
export type TaskRow = {
  mark: '✓' | '▶' | '○'
  name: string
  status: ChecklistTask['status']
}

const MARKS = { done: '✓', active: '▶', upcoming: '○' } as const

/** The row of a task. */
export const rowOf = (task: ChecklistTask, t: Texts): TaskRow => ({
  mark: MARKS[task.status],
  name: task.name || t.workingOnIt,
  status: task.status
})

/** The rows to draw: the tasks, or, when there are none and the agent is working, the one line that says so. */
export const rowsOf = (checklist: Checklist, t: Texts): TaskRow[] => {
  if (checklist.tasks.length > 0) return checklist.tasks.map(task => rowOf(task, t))
  if (checklist.phase !== 'working') return []

  return [rowOf({ id: 'request', name: t.defaultTitle, status: 'active', percent: null, hasReported: false }, t)]
}

/** The most turns the archive keeps. */
export const TURNS_MAX = 10

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

/** The counts of a model request that make up its tokens; a missing one reads as zero. */
type TokenCounts = { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number } | null | undefined

/**
 * The tokens a model request cost, as the API reported them: input, output and what it wrote to the cache. What the cache served
 * (`cache_read_input_tokens`) is left out: the same prompt prefix is read again on every step and would inflate the figure.
 */
export const tokensOf = (usage: TokenCounts) => {
  const count = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)

  return count(usage?.input_tokens) + count(usage?.output_tokens) + count(usage?.cache_creation_input_tokens)
}

/** A figure of tokens in short form: `850`, `1.2k`, `18.4k` (one decimal below 100k), `150k` (whole from 100k), `1.2M`. */
export const compactTokens = (n: number) => {
  const whole = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
  const scaled = (value: number, unit: string) => `${value < 100 ? Math.round(value * 10) / 10 : Math.round(value)}${unit}`

  if (whole < 1000) return String(whole)
  // Past 999.5k the figure would read `1000k`: it is millions already.
  if (whole < 999_500) return scaled(whole / 1000, 'k')

  return scaled(whole / 1_000_000, 'M')
}

/** The tokens of a request added to the main agent's (`id` undefined) or to a subagent's. The same state when there is nothing to add or the subagent is not followed. */
export const addTokens = (state: ClaudeRadarState, id: string | undefined, tokens: number): ClaudeRadarState => {
  if (!(tokens > 0) || !Number.isFinite(tokens)) return state
  if (id === undefined) return { ...state, leaderTokens: (state.leaderTokens ?? 0) + tokens }
  if (!isKnown(state, id)) return state

  return patchSubagent(state, id, { tokens: (state.subagents[id]!.tokens ?? 0) + tokens })
}

/** The tokens of the whole turn that runs: the main agent's and every subagent's. */
const turnTokens = (leader: number | undefined, agents: Iterable<SubagentState>) => {
  let total = leader ?? 0

  for (const agent of agents) total += agent.tokens ?? 0

  return total
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

/** How many subagents are at work (running or waiting for the person). */
export const activeCount = (subagents: Subagents) => Object.values(subagents).filter(agent => isActive(agent.status)).length

/** The turn, closed and put at the front of the archive (at most `TURNS_MAX`) with its tokens; the current turn is left empty, tokens included. Subagents still at work are stopped at `now`. The model of the main agent, the ON/OFF choice and the tick stay. */
const archiveTurn = (state: ClaudeRadarState, now: number): ClaudeRadarState => {
  const { checklist } = state
  const agents = Object.values(state.subagents)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((agent): SubagentState => (isActive(agent.status) ? { ...agent, status: 'stopped', finishedAt: now } : { ...agent }))
  // The turn lasts until the main agent and every subagent have ended.
  const finishedAt = Math.max(checklist.finishedAt ?? now, ...agents.map(agent => agent.finishedAt ?? 0))
  // A turn cut off while it still worked counts as stopped.
  const status: TurnRecord['status'] = checklist.phase === 'done' ? 'done' : checklist.phase === 'stuck' ? 'failed' : 'stopped'
  let id = String(checklist.startedAt)

  while (state.turns.some(turn => turn.id === id)) id += '+'

  const record: TurnRecord = {
    id,
    title: checklist.title,
    status,
    startedAt: checklist.startedAt!,
    finishedAt,
    tokens: turnTokens(state.leaderTokens, agents),
    leader: {
      ...(state.leaderModel === undefined ? {} : { modelInfo: state.leaderModel }),
      tasksDone: checklist.tasks.filter(task => task.status === 'done').length,
      tasksTotal: checklist.tasks.length,
      tokens: state.leaderTokens ?? 0,
      finishedAt: checklist.finishedAt ?? now
    },
    agents
  }

  return { ...withoutLeaderTokens(state), checklist: initialState().checklist, subagents: {}, turns: [record, ...state.turns].slice(0, TURNS_MAX) }
}

/** Archives the turn at once, whatever is still going on; the same state when there is no turn. */
export const forceArchive = (state: ClaudeRadarState, now: number): ClaudeRadarState =>
  state.checklist.startedAt === null ? state : archiveTurn(state, now)

/** Archives the turn once it is over: the main agent has ended (done, stuck or stopped) and no subagent is at work. Otherwise the same state: a subagent in the background keeps the turn open. */
export const settleTurn = (state: ClaudeRadarState, now: number): ClaudeRadarState => {
  const { phase, startedAt } = state.checklist

  if (startedAt === null || phase === 'working' || phase === 'needsYou' || activeCount(state.subagents) > 0) return state

  return archiveTurn(state, now)
}

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

/** What every agent line of the pane has, the main agent's and a subagent's alike. */
export type PaneRow = {
  id: string
  mark: '●' | '✓' | '✗' | '■'
  status: SubagentStatus
  name: string
  time: string
  label: string
  /** `opus-4-5 · high`, or null while the model is unknown. */
  detail: string | null
  /** The status bar, one per agent: the moving block while it works or waits, null once it ended (no bar then). Never a percentage. */
  bar: string | null
  /** `2/3`, the tasks done of the checklist; null when there is none. */
  tasks: string | null
  /** The tokens it used so far, short (`18.4k`); null while there are none. */
  tokens: string | null
}

/** A subagent in the pane: live or finished, with the whole task (one line, tidied) and the activity, in words (null while none is known; the pane draws it only while the agent is at work). */
export type PaneAgent = PaneRow & {
  task: string | null
  activity: string | null
  depth: number
}

/** The turn that runs now: its title, its total time and tokens, the main agent with its whole checklist, and the subagents of the turn (at work or finished) with their hierarchy. */
export type PaneCurrent = {
  title: string
  /** Why it waits or is stuck, in words; null when there is no reason to give. */
  reason: string | null
  /** The time of the whole turn: running while anything works, frozen with the last one to end. */
  time: string
  /** The tokens of the whole turn (the main agent's and every subagent's), short; null while there are none. */
  tokens: string | null
  tone: AgentPhase
  /** The mark of the heading: `●` while anything runs, the end mark (`✓`, `✗`, `■`) once all ended. */
  mark: PaneRow['mark']
  /** Whether anything runs: the heading's mark pulses then. */
  isRunning: boolean
  /** Half of the ticks: the heading's mark is lit in them and dim in the others. */
  isLit: boolean
  leader: PaneRow
  tasks: TaskRow[]
  agents: PaneAgent[]
  /** How many of the subagents are at work (running or waiting for the person). */
  active: number
}

/** A turn in the archive: how it ended and how long it took, the main agent and the subagents, each in its final state. */
export type PaneTurn = {
  id: string
  title: string
  status: TurnRecord['status']
  mark: PaneRow['mark']
  label: string
  time: string
  /** The tokens of the whole turn, short; null when there were none. */
  tokens: string | null
  leader: PaneRow
  agents: PaneAgent[]
}

/** A count of tokens as the pane writes it, or null when there are none (nothing is drawn then). */
const tokensText = (tokens: number | undefined) => (tokens !== undefined && tokens > 0 ? compactTokens(tokens) : null)

/** The mark and the status bar of an agent by its status: only an agent at work has a bar. */
const looksOf = (status: SubagentStatus, tick: number) => ({
  mark: SUBAGENT_MARKS[status],
  bar: isActive(status) ? bar(null, tick) : null
})

/**
 * The fields that follow an agent's (or a turn's) status word on its line, in this order: the tasks done of the checklist (the main agent, when it has one),
 * the time and the tokens with their unit (when there are any). The drawing joins them with ` · `.
 */
export const statusFields = (fields: { tasks?: string | null; time: string; tokens: string | null }, t: Texts) => [
  ...(fields.tasks ? [fields.tasks] : []),
  fields.time,
  ...(fields.tokens === null ? [] : [`${fields.tokens} ${t.tokens}`])
]

/** The pane's row of a subagent. */
const paneAgentOf = (agent: SubagentState, now: number, depth: number, tick: number, t: Texts): PaneAgent => ({
  id: agent.id,
  ...looksOf(agent.status, tick),
  status: agent.status,
  name: agent.name,
  time: elapsed((agent.finishedAt ?? now) - agent.startedAt),
  task: (agent.task === null ? '' : tidy(agent.task)) || null,
  activity: agent.activity === null ? null : t.activity[agent.activity],
  label: t.agent[agent.status],
  detail: detailOf(agent.modelInfo),
  tasks: null,
  tokens: tokensText(agent.tokens),
  depth
})

/** The subagents as pane rows, in start order with their hierarchy. */
const paneAgentsOf = (subagents: Subagents, now: number, tick: number, t: Texts) =>
  orderedSubagents(subagents).map(({ agent, depth }) => paneAgentOf(agent, now, depth, tick, t))

/** The main agent's row: `status` is where it stands, `time` how long it has gone. */
const paneLeaderOf = (
  status: SubagentStatus,
  model: ModelInfo | undefined,
  tasks: { done: number; total: number },
  time: string,
  tokens: number,
  tick: number,
  t: Texts
): PaneRow => ({
  id: 'main',
  ...looksOf(status, tick),
  status,
  name: t.mainAgent,
  time,
  label: t.agent[status],
  detail: detailOf(model),
  tasks: tasks.total > 0 ? `${tasks.done}/${tasks.total}` : null,
  tokens: tokensText(tokens)
})

/** Where the main agent stands, as a subagent's status is told. */
const LEADER_STATUS: Record<AgentPhase, SubagentStatus> = { working: 'working', needsYou: 'needsYou', stuck: 'failed', stopped: 'stopped', done: 'done' }

/** The turn's phase: the main agent's, but a turn whose main agent has ended is still working (or waiting for the person) while a subagent is. */
const turnPhaseOf = (state: ClaudeRadarState): AgentPhase => {
  const { phase } = state.checklist

  if (phase === 'working' || phase === 'needsYou') return phase

  const agents = Object.values(state.subagents)

  if (agents.some(agent => agent.status === 'needsYou')) return 'needsYou'

  return agents.some(agent => isActive(agent.status)) ? 'working' : phase
}

/** The reason the turn waits or is stuck, in words; null in any other phase. */
const reasonOf = (checklist: Checklist, phase: AgentPhase, t: Texts) => {
  const code = phase === 'needsYou' ? (checklist.needsYouReason ?? 'permission') : phase === 'stuck' ? checklist.stuckReason : null

  return code === null ? null : t.reason[code]
}

/** The current turn as the pane draws it; null when there is none. */
const currentOf = (state: ClaudeRadarState, now: number, tick: number, t: Texts): PaneCurrent | null => {
  const { checklist } = state

  if (checklist.startedAt === null) return null

  const phase = turnPhaseOf(state)
  const isRunning = phase === 'working' || phase === 'needsYou'
  const agents = Object.values(state.subagents)
  // At work the time runs; once all ended it stops with the last one to end.
  const end = isRunning ? now : Math.max(checklist.finishedAt ?? now, ...agents.map(agent => agent.finishedAt ?? 0))
  const time = elapsed(end - checklist.startedAt)

  return {
    title: checklist.title ?? t.defaultTitle,
    reason: reasonOf(checklist, phase, t),
    time,
    tokens: tokensText(turnTokens(state.leaderTokens, agents)),
    tone: phase,
    mark: isRunning ? '●' : SUBAGENT_MARKS[LEADER_STATUS[phase]],
    isRunning,
    isLit: Math.floor(tick) % 2 === 0,
    leader: paneLeaderOf(
      LEADER_STATUS[checklist.phase],
      state.leaderModel,
      { done: checklist.tasks.filter(task => task.status === 'done').length, total: checklist.tasks.length },
      elapsed((checklist.finishedAt ?? now) - checklist.startedAt),
      state.leaderTokens ?? 0,
      tick,
      t
    ),
    tasks: rowsOf(checklist, t),
    agents: paneAgentsOf(state.subagents, now, tick, t),
    active: activeCount(state.subagents)
  }
}

/** An archived turn as the pane draws it. */
const turnOf = (turn: TurnRecord, now: number, tick: number, t: Texts): PaneTurn => {
  const time = elapsed(turn.finishedAt - turn.startedAt)

  return {
    id: turn.id,
    title: turn.title ?? t.defaultTitle,
    status: turn.status,
    mark: SUBAGENT_MARKS[turn.status],
    label: t.agent[turn.status],
    time,
    tokens: tokensText(turn.tokens),
    leader: paneLeaderOf(
      turn.status,
      turn.leader.modelInfo,
      { done: turn.leader.tasksDone, total: turn.leader.tasksTotal },
      elapsed(turn.leader.finishedAt - turn.startedAt),
      turn.leader.tokens,
      tick,
      t
    ),
    agents: paneAgentsOf(Object.fromEntries(turn.agents.map(agent => [agent.id, agent])), now, tick, t)
  }
}

/**
 * What the detail pane draws, from the state alone and in the language of `t`: the current run (the turn in progress with its main agent, its
 * whole checklist and its subagents, or nothing when none) and the archived turns, the most recent first. `isEmpty` when there is nothing at all.
 */
export const paneOf = (state: ClaudeRadarState, now: number, tick: number, t: Texts) => {
  const current = currentOf(state, now, tick, t)
  const turns = state.turns.map(turn => turnOf(turn, now, tick, t))

  return { isEmpty: current === null && turns.length === 0, current, turns }
}
