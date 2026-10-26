import { expect, mock, test } from 'claude-code/testing'

import {
  STATUS_MIN_COLUMNS,
  TOKENS_MIN_COLUMNS,
  TURNS_MAX,
  activityOf,
  addTask,
  addTokens,
  advance,
  askSubagent,
  askUser,
  bar,
  compactTokens,
  didRun,
  elapsed,
  finishSubagent,
  finishTurn,
  forceArchive,
  hidesTools,
  initialState,
  isLive,
  layoutOf,
  normalizeActivity,
  paneButtonLabel as paneButtonLabelIn,
  paneOf as paneOfIn,
  resetSession,
  resumeWork,
  rowsOf as rowsOfIn,
  settleTurn,
  spawnSubagent,
  stepModel,
  shortModel,
  detailOf,
  startTurn,
  taskIdOf,
  tokensOf,
  updateTask,
  workSubagent,
  writeTodos
} from './claude-radar'
import { DEFAULT_LANG, TEXTS, detectLang } from './i18n'
import type { Texts } from './i18n'

const en = TEXTS.en
const es = TEXTS.es

// The reducers' views take the words of a language; these read English unless a test says otherwise.
const paneOf = (state: Parameters<typeof paneOfIn>[0], now: number, tick: number, t: Texts = en) => paneOfIn(state, now, tick, t)
const rowsOf = (checklist: Parameters<typeof rowsOfIn>[0], tick: number, t: Texts = en) => rowsOfIn(checklist, tick, t)
const paneButtonLabel = (isOpen: boolean, t: Texts = en) => paneButtonLabelIn(isOpen, t)

const BAND = {
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never
} as const

const engineBand = { type: 'Box' as const, props: {}, children: [] }

/** A `$.store` in memory that the test can look into; starts with `saved`, what an earlier session left. */
const memory = (on: any, saved: Record<string, unknown> = {}) => {
  const entries = new Map(Object.entries(saved))

  on('store.get', (_: unknown, e: { key: string }) => ({ value: entries.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    entries.set(e.key, e.value)

    return { value: undefined }
  })

  return entries
}

/** Observes `$.ui.toast`: every text the radar shows. */
const watchToasts = (on: any, toasts: string[] = []) => {
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  return toasts
}

test('starts on, with nothing running and nothing to show', async () => {
  const state = initialState()

  expect(state.claudeRadarEnabled).toBe(true)
  expect(state.checklist.tasks).toEqual([])
  expect(state.subagents).toEqual({})
  expect(state.turns).toEqual([])
})

test('the button shows ON at the start, on every surface that draws the band', async ($, on) => {
  on('ui.render', () => engineBand)
  memory(on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-radar', surface, ...BAND })

    expect(await ui.find({ type: 'Button', text: /Claude Radar: ON/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'toggle' })).toBeDefined()
    await ui.unmount()
  }
})

test('pressing the button turns it off and on, saves the choice and says so', async ($, on) => {
  on('ui.render', () => engineBand)

  const entries = memory(on)
  const toasts = watchToasts(on)
  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  await ui.press({ key: 'toggle' })

  expect(await ui.find({ type: 'Button', text: /Claude Radar: OFF/ })).toBeDefined()
  expect(entries.get('enabled')).toBe(false)
  expect(toasts).toEqual(['Claude Radar: OFF'])

  await ui.press({ key: 'toggle' })

  expect(await ui.find({ type: 'Button', text: /Claude Radar: ON/ })).toBeDefined()
  expect(entries.get('enabled')).toBe(true)
  expect(toasts).toEqual(['Claude Radar: OFF', 'Claude Radar: ON'])
  await ui.unmount()
})

test('a new session restores the saved choice: the button is still visible when it is off', async ($, on) => {
  on('ui.render', () => engineBand)
  memory(on, { enabled: false })
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Button', text: /Claude Radar: OFF/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'toggle' })).toBeDefined()
  await ui.unmount()
})

test('yields to a survey', async ($, on) => {
  on('ui.render', () => engineBand)
  memory(on)

  const ui = await $.ui.mount({
    plugin: 'agent-radar',
    surface: 'terminal',
    ...BAND,
    props: { hasSurvey: true, isWorking: false, maxRows: 10, bodyColumns: 80 } as never
  })

  expect(await ui.find({ type: 'Button', key: 'toggle' })).toBeUndefined()
  await ui.unmount()
})

test('registers one slash command, /agent-radar, and no other', async ($, on) => {
  const { commands } = radar(on)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  expect(commands).toEqual([{ name: 'agent-radar', description: 'Open or close the Claude Radar detail pane, or show or hide its band.', argumentHint: '[open|close|hide|show]' }])
  expect(commands.map(command => command.name)).not.toContain('radar')
  expect(commands.map(command => command.name)).not.toContain('simple')
})

test('elapsed reads seconds, minutes and hours', async () => {
  expect(elapsed(0)).toBe('0s')
  expect(elapsed(45_000)).toBe('45s')
  expect(elapsed(59_999)).toBe('59s')
  expect(elapsed(155_000)).toBe('2m 35s')
  expect(elapsed(3_723_000)).toBe('1h 02m 03s')
  expect(elapsed(-5)).toBe('0s')
  expect(elapsed(Number.NaN)).toBe('0s')
})

test('normalizeActivity takes out paths and code, collapses spaces and capitalizes', async () => {
  expect(normalizeActivity('fix   the   login')).toBe('Fix the login')
  expect(normalizeActivity('edit /src/auth/login.ts now')).toBe('Edit now')
  expect(normalizeActivity('open C:\\work\\app\\main.tsx please')).toBe('Open please')
  expect(normalizeActivity('rename `getUser()` to `fetchUser()`')).toBe('Rename to')
  expect(normalizeActivity('run ```ls -la``` today')).toBe('Run today')
  expect(normalizeActivity('line one\n\nline two')).toBe('Line one line two')
})

test('normalizeActivity cuts at 40 characters by words and falls back when nothing is left', async () => {
  const long = normalizeActivity('implement the authentication flow with refresh tokens and sessions')

  expect(long).toBe('Implement the authentication flow with')
  expect(long.length).toBeLessThanOrEqual(40)
  // A word that ends exactly at 40 stays whole.
  expect(normalizeActivity('a'.repeat(34) + ' bbbbb ccc')).toBe('a'.repeat(34).replace(/^a/, 'A') + ' bbbbb')
  // One word longer than the limit is cut hard.
  expect(normalizeActivity('x'.repeat(60))).toBe('X' + 'x'.repeat(39))
  expect(normalizeActivity('')).toBe('')
  expect(normalizeActivity('   ')).toBe('')
  expect(normalizeActivity('`only code` /only/a/path')).toBe('')
})

test('bar has 10 segments: a real percentage fills it, none moves a block of 3', async () => {
  expect(bar(0, 0)).toBe('░░░░░░░░░░')
  expect(bar(40, 7)).toBe('████░░░░░░')
  expect(bar(100, 0)).toBe('██████████')
  expect(bar(250, 0)).toBe('██████████')
  expect(bar(-5, 0)).toBe('░░░░░░░░░░')
  expect(bar(null, 0)).toBe('███░░░░░░░')
  expect(bar(null, 1)).toBe('░███░░░░░░')
  expect(bar(null, 8)).toBe('█░░░░░░░██')

  for (let tick = 0; tick < 25; tick++) {
    const frame = bar(null, tick)

    expect(frame).toHaveLength(10)
    expect(frame.split('█')).toHaveLength(4)
  }

  expect(bar(null, 10)).toBe(bar(null, 0))
})

test('a turn starts working with a title from the prompt, and nothing kept of the last one', async () => {
  const before = writeTodos(
    finishTurn(startTurn(initialState(), 'first', 1000), 'error', 2000),
    [{ content: 'old', status: 'pending' }]
  )
  const state = startTurn(before, 'Build the landing page at /site/index.html', 9000)

  expect(state.checklist).toEqual({
    title: 'Build the landing page at',
    phase: 'working',
    tasks: [],
    needsYouReason: null,
    stuckReason: null,
    startedAt: 9000,
    finishedAt: null
  })
  expect(startTurn(initialState(), '', 1).checklist.title).toBeNull()
  expect(startTurn(initialState(), '`code` /a/b', 1).checklist.title).toBeNull()
  // Only the checklist changes.
  expect(state.claudeRadarEnabled).toBe(before.claudeRadarEnabled)
  expect(state.tick).toBe(before.tick)
})

test('a turn ends done, stopped or stuck, and active tasks are left as they were', async () => {
  const working = writeTodos(startTurn(initialState(), 'go', 1000), [{ content: 'Step', status: 'in_progress', activeForm: 'Stepping' }])

  const done = finishTurn(working, 'answer', 4000)

  expect(done.checklist).toMatchObject({ phase: 'done', finishedAt: 4000, stuckReason: null })
  expect(done.checklist.tasks).toEqual(working.checklist.tasks)
  expect(done.checklist.tasks[0]?.status).toBe('active')

  expect(finishTurn(working, 'aborted', 4000).checklist).toMatchObject({ phase: 'stopped', stuckReason: null })
  expect(finishTurn(working, 'error', 4000).checklist).toMatchObject({
    phase: 'stuck',
    stuckReason: 'error'
  })
  expect(finishTurn(working, 'refusal', 4000).checklist).toMatchObject({
    phase: 'stuck',
    stuckReason: 'refusal'
  })

  const waiting = askUser(working)

  expect(finishTurn(waiting, 'answer', 4000).checklist.needsYouReason).toBeNull()
})

test('TodoWrite replaces the tasks: pending upcoming, in progress active, completed done', async () => {
  const state = writeTodos(startTurn(initialState(), 'go', 0), [
    { content: 'Analyze /src/project structure', status: 'completed', activeForm: 'Analyzing' },
    { content: 'Implement authentication', status: 'in_progress', activeForm: 'Implementing authentication' },
    { content: 'Run final tests', status: 'pending', activeForm: 'Running final tests' }
  ])

  expect(state.checklist.tasks).toEqual([
    { id: '0', name: 'Analyze structure', status: 'done', percent: null, hasReported: true },
    { id: '1', name: 'Implementing authentication', status: 'active', percent: null, hasReported: true },
    { id: '2', name: 'Run final tests', status: 'upcoming', percent: null, hasReported: true }
  ])

  // A new list replaces the old one whole.
  expect(writeTodos(state, [{ content: 'Only', status: 'pending' }]).checklist.tasks).toHaveLength(1)
  // No activeForm: the content names the active one.
  expect(writeTodos(state, [{ content: 'Only', status: 'in_progress' }]).checklist.tasks[0]?.name).toBe('Only')
})

test('TaskCreate adds an upcoming task and TaskUpdate moves, renames and removes it', async () => {
  let state = startTurn(initialState(), 'go', 0)

  state = addTask(state, '1', 'Write the parser')
  state = addTask(state, '2', 'Test it')
  // The same id again renames; it does not repeat.
  state = addTask(state, '2', 'Test the parser')

  expect(state.checklist.tasks.map(task => [task.id, task.name, task.status])).toEqual([
    ['1', 'Write the parser', 'upcoming'],
    ['2', 'Test the parser', 'upcoming']
  ])

  state = updateTask(state, '1', { status: 'in_progress' })
  expect(state.checklist.tasks[0]?.status).toBe('active')

  state = updateTask(state, '1', { status: 'completed', subject: 'Parser written' })
  expect(state.checklist.tasks[0]).toMatchObject({ name: 'Parser written', status: 'done' })

  state = updateTask(state, '2', { status: 'pending' })
  expect(state.checklist.tasks[1]?.status).toBe('upcoming')

  // An update with nothing to change, or for a task not there, changes nothing.
  expect(updateTask(state, '2', {})).toEqual(state)
  expect(updateTask(state, '9', { status: 'completed' })).toBe(state)

  state = updateTask(state, '1', { status: 'deleted' })
  expect(state.checklist.tasks.map(task => task.id)).toEqual(['2'])
})

test('the id of a created task comes from the result, else from the call', async () => {
  expect(taskIdOf({ task: { id: '7', subject: 's' } }, 'toolu_1')).toBe('7')
  expect(taskIdOf({ task: { id: 7 } }, 'toolu_1')).toBe('7')
  expect(taskIdOf({}, 'toolu_1')).toBe('toolu_1')
  expect(taskIdOf(undefined, 'toolu_1')).toBe('toolu_1')
  expect(taskIdOf({ task: { id: null } }, 'toolu_1')).toBe('toolu_1')
  expect(didRun({ result: {} } as never)).toBe(true)
  expect(didRun({ deny: 'no' })).toBe(false)
  expect(didRun({ isError: true })).toBe(false)
})

test('asking the person marks the working turn, and work lifts it; nothing else is touched', async () => {
  const working = startTurn(initialState(), 'go', 0)
  const waiting = askUser(working)

  expect(waiting.checklist).toMatchObject({ phase: 'needsYou', needsYouReason: 'permission' })
  expect(resumeWork(waiting).checklist).toMatchObject({ phase: 'working', needsYouReason: null })

  const done = finishTurn(working, 'answer', 5)

  expect(askUser(done)).toBe(done)
  expect(resumeWork(done)).toBe(done)
  expect(resumeWork(working)).toBe(working)
  expect(askUser(initialState()).checklist.phase).toBe('done')
})

test('the timer has something to move while a turn works or waits, or any subagent works', async () => {
  const working = startTurn(initialState(), 'go', 0)
  const done = finishTurn(working, 'answer', 10_000)

  expect(isLive(initialState())).toBe(false)
  expect(isLive(working)).toBe(true)
  expect(isLive(askUser(working))).toBe(true)
  // A finished turn is frozen: the pane shows its last state and nothing moves.
  expect(isLive(done)).toBe(false)
  expect(isLive(finishTurn(working, 'error', 1))).toBe(false)
  // A subagent at work keeps it alive after the main turn ended; a finished one is frozen.
  expect(isLive(spawnSubagent(done, { id: 'a1', name: 'x' }, 0))).toBe(true)
  expect(isLive(finishSubagent(spawnSubagent(done, { id: 'a1', name: 'x' }, 0), 'a1', 'answer', 1))).toBe(false)

  // A step of the timer only moves the animation.
  expect(advance(done)).toEqual({ ...done, tick: 1 })
  expect(advance(working)).toEqual({ ...working, tick: 1 })
})

test('the current run reads the phase: title and total time, needs you, stuck, stopped, all done', async () => {
  const working = startTurn(initialState(), 'Build my landing page', 1000)

  // At work the heading's mark is a pulsing dot: lit on the even ticks, dim on the odd ones.
  expect(paneOf(working, 156_000, 0).current).toMatchObject({
    title: 'Build my landing page',
    reason: null,
    time: '2m 35s',
    tone: 'working',
    mark: '●',
    isRunning: true,
    isLit: true,
    active: 0
  })
  expect(paneOf(working, 156_000, 1).current).toMatchObject({ isRunning: true, isLit: false })
  expect(paneOf(askUser(working), 156_000, 0).current).toMatchObject({
    reason: 'Waiting for your permission',
    tone: 'needsYou',
    mark: '●',
    isRunning: true
  })
  expect(paneOf(finishTurn(working, 'error', 5000), 999_000, 0).current).toMatchObject({
    reason: 'The turn ended with an error',
    tone: 'stuck',
    mark: '✗',
    isRunning: false,
    time: '4s'
  })
  expect(paneOf(finishTurn(working, 'aborted', 5000), 999_000, 0).current).toMatchObject({ reason: null, tone: 'stopped', mark: '■', isRunning: false })
  // The time freezes at the end, and the heading's mark stands still: `now` and `tick` no longer matter.
  expect(paneOf(finishTurn(working, 'answer', 191_000), 999_000, 3).current).toMatchObject({
    reason: null,
    time: '3m 10s',
    tone: 'done',
    mark: '✓',
    isRunning: false
  })
  // No title in the prompt: the default one, in the language.
  expect(paneOf(startTurn(initialState(), '', 0), 0, 0, es).current?.title).toBe('Trabajando en tu petición')
})

test('the rows are the tasks, or the one line that says the agent works; never invented steps', async () => {
  const working = startTurn(initialState(), 'go', 0)

  expect(rowsOf(working.checklist, 0)).toEqual([
    { mark: '▶', name: 'Working on your request', bar: '███░░░░░░░', label: 'Working', status: 'active' }
  ])
  expect(rowsOf(finishTurn(working, 'answer', 1).checklist, 0)).toEqual([])
  expect(rowsOf(askUser(working).checklist, 0)).toEqual([])

  const rows = rowsOf(
    writeTodos(working, [
      { content: 'Analyze', status: 'completed' },
      { content: 'Implement', status: 'in_progress' },
      { content: 'Test', status: 'pending' }
    ]).checklist,
    2
  )

  expect(rows.map(row => `${row.mark} ${row.name} ${row.bar} ${row.label.trim()}`)).toEqual([
    '✓ Analyze ██████████ Done',
    '▶ Implement ░░███░░░░░ Working',
    '○ Test ░░░░░░░░░░ Next'
  ])
  // The labels are padded to one width so the bars line up.
  expect(new Set(rows.map(row => row.label.length)).size).toBe(1)
})

test('the layout drops the bars below 40 columns and never lets a row pass the inner width', async () => {
  const rows = rowsOf(
    writeTodos(startTurn(initialState(), 'go', 0), [{ content: 'x'.repeat(40), status: 'in_progress' }]).checklist,
    0
  )

  for (const columns of [20, 30, 39, 40, 60, 80, 120]) {
    const { showBars, nameWidth } = layoutOf(rows, columns)

    expect(showBars).toBe(columns >= 40)
    // mark + name + bar and its gap + label and its gap
    const width = 2 + nameWidth + (showBars ? 12 : 0) + 9

    expect(nameWidth).toBeGreaterThanOrEqual(1)
    if (columns - 4 >= 2 + 1 + (showBars ? 12 : 0) + 9) expect(width).toBeLessThanOrEqual(columns - 4)
  }

  // A short name does not take the room of a long one.
  const short = rowsOf(writeTodos(startTurn(initialState(), 'go', 0), [{ content: 'Test', status: 'pending' }]).checklist, 0)

  expect(layoutOf(short, 120).nameWidth).toBe(4)
})

const MS = 1000

/** Whether the band draws a round frame: the root's first child is the block. The band has none. */
const isFramed = async (ui: { find: (query: { type: string }) => Promise<{ children: unknown[] } | undefined> }) => {
  const root = await ui.find({ type: 'Box' })

  return (root?.children ?? []).some(child => (child as { props?: { borderStyle?: string } })?.props?.borderStyle === 'round')
}

/** The bottom a register test stands on: the band, a store, the clock, the turn events and a surface that places panes, answering as the engine does. `calls` and `opened` tell what reached `ui.open` / `ui.close`. */
const radar = (on: any, draw: (...args: any[]) => unknown = () => engineBand, toasts: string[] = [], isPlaced = true) => {
  const calls: string[] = []
  const opened: unknown[] = []
  const commands: { name: string; description: string; argumentHint?: string }[] = []

  on('ui.render', draw)
  on('command.register', (_: unknown, e: { name: string; description: string; argumentHint?: string }) => {
    commands.push(e)

    return { value: { command: e.name } } as never
  })
  on('session.start', ($: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.start', ($: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', ($: unknown, e: { answer: string }) => ({ text: e.answer }))
  memory(on)
  watchToasts(on, toasts)
  panes(on, isPlaced, opened, calls)

  return { ...mock.clock(on, { now: Date.now() }), calls, opened, commands }
}

/** A tool answer as the engine gives it (the plugin relays it as it is). */
const answered = (result: unknown) => ({ ref: 1, result, text: 'ok' }) as never

const begin = ($: any, text = 'Build my landing page') => $.turn.start({ text, turnId: 't' })

const finish = ($: any, reason: 'answer' | 'aborted' | 'error' | 'refusal' = 'answer', agentId?: string) =>
  $.turn.complete({ answer: 'done', durationMs: 0, isAborted: reason === 'aborted', turnId: 't', reason, agentId })

const todos = (...items: [string, 'pending' | 'in_progress' | 'completed'][]) =>
  items.map(([content, status]) => ({ content, status, activeForm: content }))

/** The band, mounted. */
const band = ($: any, bodyColumns = 80, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({
    plugin: 'agent-radar',
    surface,
    ...BAND,
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns } as never
  })

/** The detail pane, mounted (its content is drawn whether or not the engine placed it). */
const paneView = ($: any, bodyColumns = 60, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({
    plugin: 'agent-radar',
    surface,
    component: 'Pane',
    requestId: 'agent-radar',
    props: { title: 'Claude Radar', isFocused: false, bodyColumns, placement: surface === 'desktop' ? 'dock' : 'inline' } as never
  } as never)

/** Opens the pane the way the person does, pressing the band's button; returns the band. */
const openPane = async ($: any) => {
  const ui = await band($)

  await ui.press({ key: 'pane' })

  return ui
}

/** Every text the band draws. */
const textsOf = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((node: { text: string }) => node.text)

test('the band is one line, the name and the two buttons, before any turn and whatever the width or the surface', async ($, on) => {
  radar(on)

  for (const surface of ['terminal', 'desktop'] as const) {
    for (const bodyColumns of [30, 80]) {
      const ui = await band($, bodyColumns, surface)

      expect(await textsOf(ui)).toEqual(['Claude Radar'])

      const name = await ui.find({ type: 'Text', text: /^Claude Radar$/ })

      expect(name?.props).toMatchObject({ bold: true, dimColor: true, wrap: 'truncate-end' })
      expect(await ui.find({ type: 'Button', key: 'pane', text: /^\[ ◧ Detail \]$/ })).toBeDefined()
      expect(await ui.find({ type: 'Button', key: 'toggle', text: /Claude Radar: ON/ })).toBeDefined()
      expect(await isFramed(ui)).toBe(false)
      await ui.unmount()
    }
  }
})

test('the band shows nothing of the work, in ON and in OFF: only the name and the buttons', async ($, on) => {
  squad(on, 'a1')
  on('tool.check', () => ({ decision: 'ask' }) as never)

  await begin($)
  await $.tool.call({ tool: 'TodoWrite', todos: todos(['Step one', 'in_progress'], ['Step two', 'pending']) })
  await spawn($, 'frontend-developer')
  await $.tool.check({ tool: 'Bash', input: { command: 'rm x' } })

  const ui = await band($)

  // Working, asking, with a checklist and a subagent: still the name alone.
  expect(await textsOf(ui)).toEqual(['Claude Radar'])
  expect(await isFramed(ui)).toBe(false)

  await finish($, 'error')
  expect(await textsOf(ui)).toEqual(['Claude Radar'])

  await ui.press({ key: 'toggle' })
  expect(await textsOf(ui)).toEqual(['Claude Radar'])
  expect(await ui.find({ type: 'Button', key: 'pane' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'toggle', text: /Claude Radar: OFF/ })).toBeDefined()
  await ui.unmount()
})

test('a turn shows its title, its time and the working line in the pane, on both surfaces', async ($, on) => {
  const clock = radar(on)

  await begin($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await paneView($, 60, surface)

    expect(await ui.find({ type: 'Text', text: /^Current run$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Build my landing page$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Working$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Main agent$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^0s$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Working on your request/ })).toBeDefined()
    await ui.unmount()
  }

  await clock.advance(155 * MS)

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /^2m 35s$/ })).toBeDefined()
  await ui.unmount()
})

test('the indeterminate bar moves with the timer while the pane is open', async ($, on) => {
  const clock = radar(on)

  await begin($)

  const opener = await openPane($)
  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /^███░░░░░░░$/ })).toBeDefined()

  await clock.advance(250)
  expect(await ui.find({ type: 'Text', text: /^░███░░░░░░$/ })).toBeDefined()

  await clock.advance(250)
  expect(await ui.find({ type: 'Text', text: /^░░███░░░░░$/ })).toBeDefined()
  await ui.unmount()
  await opener.unmount()
})

test('a title keeps up to 80 characters, cut by words, and the pane cuts it to its width', async ($, on) => {
  radar(on)
  // 70 characters once the path is out: whole, where 40 used to cut it.
  await begin($, 'implement the authentication flow with refresh tokens and sessions in /src/auth')

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /^Implement the authentication flow with refresh tokens and sessions in$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\/src/ })).toBeUndefined()
  await ui.unmount()

  const long = startTurn(initialState(), `${'word '.repeat(30)}end`, 0).checklist.title!

  expect(long.length).toBeLessThanOrEqual(80)
  // Sixteen words of four letters are 79 characters; a seventeenth would pass 80.
  expect(long).toBe(['Word', ...Array(15).fill('word')].join(' '))
  // A word that ends exactly on the limit stays whole.
  expect(startTurn(initialState(), `${'a'.repeat(78)} b more`, 0).checklist.title).toBe(`A${'a'.repeat(77)} b`)
  // The names of tasks and activities keep their 40.
  expect(normalizeActivity('word '.repeat(30)).length).toBeLessThanOrEqual(40)

  // The drawing cuts the title to the width of the pane.
  const narrow = await paneView($, 24)

  expect((await narrow.find({ type: 'Text', text: /^Implement the authentication/ }))?.props?.wrap).toBe('truncate-end')
  await narrow.unmount()
})

test('TodoWrite appears as the checklist in the pane, and the call goes through untouched', async ($, on) => {
  radar(on)

  const seen: unknown[] = []
  const result = answered({ oldTodos: [], newTodos: [] })

  on('tool.call', (_: unknown, e: unknown) => {
    seen.push(e)

    return result
  })

  await begin($)

  const input = todos(['Analyze project structure', 'completed'], ['Implement authentication', 'in_progress'], ['Run final tests', 'pending'])
  const ran = await $.tool.call({ tool: 'TodoWrite', todos: input })

  expect(ran).toEqual(result)
  expect(seen).toHaveLength(1)
  expect((seen[0] as { todos: unknown }).todos).toEqual(input)

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /^Analyze project structure$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Implement authentication$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Run final tests$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^✓$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^▶$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^○$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^██████████$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^░░░░░░░░░░$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Done\s*$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Working\s*$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Next\s*$/ })).toBeDefined()
  // The real list replaces the one line that said nothing.
  expect(await ui.find({ type: 'Text', text: /Working on your request/ })).toBeUndefined()

  const active = await ui.find({ type: 'Text', text: /^Implement authentication$/ })
  const done = await ui.find({ type: 'Text', text: /^Analyze project structure$/ })

  expect(active?.props?.bold).toBe(true)
  expect(done?.props?.dimColor).toBe(true)
  await ui.unmount()
})

test('TaskCreate and TaskUpdate build and move the checklist; the id comes from the result', async ($, on) => {
  radar(on)

  let created = 0

  on('tool.call', (_: unknown, e: { tool: string }) => {
    if (e.tool === 'TaskCreate') return answered({ task: { id: `id-${++created}`, subject: 's' } })

    return answered({ success: true, taskId: 'x', updatedFields: [] })
  })

  await begin($)

  const create = (subject: string) => $.tool.call({ tool: 'TaskCreate', subject, description: 'd' })

  expect(await create('Write the parser')).toEqual(answered({ task: { id: 'id-1', subject: 's' } }))
  await create('Test the parser')

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /^Write the parser$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Test the parser$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Next\s*$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Working on your request/ })).toBeUndefined()

  await $.tool.call({ tool: 'TaskUpdate', taskId: 'id-1', status: 'in_progress' })
  expect((await ui.find({ type: 'Text', text: /^Write the parser$/ }))?.props?.bold).toBe(true)

  await $.tool.call({ tool: 'TaskUpdate', taskId: 'id-1', status: 'completed', subject: 'Parser written' })
  expect(await ui.find({ type: 'Text', text: /^Parser written$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Done\s*$/ })).toBeDefined()

  await $.tool.call({ tool: 'TaskUpdate', taskId: 'id-2', status: 'deleted' })
  expect(await ui.find({ type: 'Text', text: /^Test the parser$/ })).toBeUndefined()
  await ui.unmount()
})

test('a task call that was refused or failed adds nothing', async ($, on) => {
  radar(on)
  on('tool.call', () => ({ deny: 'no' }) as never)

  await begin($)
  expect(await $.tool.call({ tool: 'TaskCreate', subject: 'Nope', description: 'd' })).toEqual({ deny: 'no' })

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /Nope/ })).toBeUndefined()
  await ui.unmount()
})

test('a tool call does not rewrite what the tool answered, for any tool', async ($, on) => {
  radar(on)

  const result = { ref: 3, result: { stdout: 'hi' }, text: 'hi', isReadOnly: true } as never

  on('tool.call', () => result)

  await begin($)
  expect(await $.tool.call({ tool: 'Bash', command: 'echo hi' })).toEqual(result)
})

test('a turn that ends is archived: the pane says it is ready and the history has its group with the total time', async ($, on) => {
  const clock = radar(on)

  on('tool.call', () => answered({ oldTodos: [], newTodos: [] }))

  await begin($)
  await $.tool.call({ tool: 'TodoWrite', todos: todos(['Analyze', 'completed'], ['Implement', 'pending']) })
  await clock.advance(190 * MS)
  await finish($)

  const ui = await paneView($)

  // Nothing runs: the current run says so, and the checklist went with the turn.
  expect(await ui.find({ type: 'Text', text: /^Current run$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^All done, ready for more instructions$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Implement$/ })).toBeUndefined()
  // The group: title, final state and duration; the main agent with its tasks done.
  expect(await ui.find({ type: 'Text', text: /^History$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1 run$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Build my landing page$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Done$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^3m 10s$/ })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: /^Main agent$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1\/2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^No finished turns yet$/ })).toBeUndefined()

  // The time is frozen at the end, however long it takes.
  await clock.advance(60 * MS)
  expect(await ui.findAll({ type: 'Text', text: /^3m 10s$/ })).toHaveLength(2)
  await ui.unmount()
})

test('a stopped, failed or refused turn goes to the history with its final state, the most recent first', async ($, on) => {
  const clock = radar(on)

  await begin($, 'first job')
  await finish($, 'aborted')
  await clock.advance(1 * MS)
  await begin($, 'second job')
  await finish($, 'error')
  await clock.advance(1 * MS)
  await begin($, 'third job')
  await finish($, 'refusal')

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /^3 runs$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^Failed$/ })).toHaveLength(2)
  expect(await ui.findAll({ type: 'Text', text: /^Stopped$/ })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: /^✗$/ })).toHaveLength(4)
  expect(await ui.findAll({ type: 'Text', text: /^■$/ })).toHaveLength(2)

  const titles = (await ui.findAll({ type: 'Text', text: /job$/ })).map((node: { text: string }) => node.text)

  expect(titles).toEqual(['Third job', 'Second job', 'First job'])
  await ui.unmount()
})

test('a new turn starts clean: the last one is in the history, without its checklist', async ($, on) => {
  const clock = radar(on)

  on('tool.call', () => answered({ oldTodos: [], newTodos: [] }))

  await begin($, 'first job')
  await $.tool.call({ tool: 'TodoWrite', todos: todos(['Old step', 'completed']) })
  await finish($)
  await clock.advance(6 * MS)
  await begin($, 'second job')

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /Second job/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /First job/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Old step/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Working on your request/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /All done, ready/ })).toBeUndefined()
  await ui.unmount()
})

test('a permission question shows Needs you with its reason in the pane, and the next tool call lifts it', async ($, on) => {
  radar(on)
  on('tool.check', () => ({ decision: 'ask' }) as never)
  on('tool.call', () => answered({ stdout: '' }))

  await begin($)

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /Needs you/ })).toBeUndefined()

  expect(await $.tool.check({ tool: 'Bash', input: { command: 'rm x' } })).toMatchObject({ decision: 'ask' })
  expect(await ui.find({ type: 'Text', text: /^Needs you$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Waiting for your permission/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Build my landing page$/ })).toBeDefined()

  await $.tool.call({ tool: 'Bash', command: 'rm x' })
  expect(await ui.find({ type: 'Text', text: /Needs you/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Waiting for your permission/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Working$/ })).toBeDefined()
  await ui.unmount()
})

test('a question that ends the turn leaves needs you behind', async ($, on) => {
  radar(on)
  on('tool.check', () => ({ decision: 'ask' }) as never)

  await begin($)
  await $.tool.check({ tool: 'Bash', input: { command: 'rm x' } })
  await finish($, 'aborted')

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /Needs you/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Stopped$/ })).toBeDefined()
  await ui.unmount()
})

test('allowed and denied checks leave the turn working, and the verdict goes through as it is', async ($, on) => {
  radar(on)

  let decision = 'allow'

  on('tool.check', () => ({ decision, reason: 'because' }) as never)
  await begin($)

  const ui = await paneView($)

  expect(await $.tool.check({ tool: 'Read', input: {} })).toEqual({ decision: 'allow', reason: 'because' })
  decision = 'deny'
  expect(await $.tool.check({ tool: 'Read', input: {} })).toEqual({ decision: 'deny', reason: 'because' })
  expect(await ui.find({ type: 'Text', text: /Needs you/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Working$/ })).toBeDefined()
  await ui.unmount()
})

test('a subagent turn does not end the main one', async ($, on) => {
  radar(on)
  await begin($)
  await finish($, 'answer', 'sub-1')

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /All done/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Working$/ })).toBeDefined()
  await ui.unmount()
})

test('turn events pass through with their answer as it is', async ($, on) => {
  radar(on)

  expect(await begin($)).toEqual({ turnId: 't' })
  expect(await finish($)).toEqual({ text: 'done' })
})

test('with little width the pane drops the bars and cuts the names to fit', async ($, on) => {
  radar(on)
  on('tool.call', () => answered({ oldTodos: [], newTodos: [] }))

  await begin($)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: todos(['Implement a very long authentication flow with tokens', 'in_progress'], ['Next thing', 'pending'])
  })

  const narrow = await paneView($, 30)

  expect(await narrow.find({ type: 'Text', text: /[█░]/ })).toBeUndefined()
  expect(await narrow.find({ type: 'Text', text: /^Working\s*$/ })).toBeDefined()

  const name = await narrow.find({ type: 'Text', text: /Implement a very/ })

  expect(name?.props?.wrap).toBe('truncate-end')
  await narrow.unmount()

  const wide = await paneView($, 60)

  expect(await wide.find({ type: 'Text', text: /[█░]{10}/ })).toBeDefined()
  await wide.unmount()
})

test('OFF leaves the band with the name and the ON/OFF button, keeps the state, and ON brings it back to the pane', async ($, on) => {
  radar(on)
  await begin($)

  const ui = await band($)
  const pane = await paneView($)

  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Button', text: /Claude Radar: OFF/ })).toBeDefined()
  expect(await textsOf(ui)).toEqual(['Claude Radar'])
  expect(await isFramed(ui)).toBe(false)

  // The state is kept while it is off.
  await finish($)
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Button', text: /Claude Radar: ON/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^All done, ready for more instructions$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Build my landing page$/ })).toBeDefined()
  await ui.unmount()
  await pane.unmount()
})

test('while OFF the timer does not run, and ON with the pane opened in the middle of a turn starts it again', async ($, on) => {
  const clock = radar(on)

  await begin($)

  const ui = await openPane($)

  await ui.press({ key: 'toggle' })
  await clock.advance(10 * MS)
  await ui.press({ key: 'toggle' })
  await ui.press({ key: 'pane' })

  const pane = await paneView($)

  expect(await pane.find({ type: 'Text', text: /^10s$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^███░░░░░░░$/ })).toBeDefined()

  await clock.advance(250)
  expect(await pane.find({ type: 'Text', text: /^░███░░░░░░$/ })).toBeDefined()
  await ui.unmount()
  await pane.unmount()
})

test('a turn that finished while OFF is in the history as it ended when it is back ON', async ($, on) => {
  const clock = radar(on)

  await begin($)

  const ui = await band($)

  await ui.press({ key: 'toggle' })
  await finish($)
  await clock.advance(30 * MS)
  await ui.press({ key: 'toggle' })

  const pane = await paneView($)

  expect(await pane.find({ type: 'Text', text: /^Done$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^30s$/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /^Build my landing page$/ })).toBeDefined()
  await pane.unmount()
  await ui.unmount()
})

test('with the pane closed the timer does not tick: no redraw writes, and the pane starts them when opened', async ($, on) => {
  const clock = squad(on, 'a1')
  let writes = 0

  ;(on as any)('state.set', (_: unknown, e: { key: string }, next: (e: unknown) => unknown) => {
    if (e.key === 'claudeRadarState') writes++

    return next(e)
  })

  await begin($)
  await spawn($, 'frontend-developer')
  await clock.advance(2 * MS)

  const idle = writes

  // A working turn and a working subagent, and a minute goes by: the state is not touched.
  await clock.advance(60 * MS)
  expect(writes).toBe(idle)

  const ui = await openPane($)
  const open = writes

  await clock.advance(2 * MS)
  expect(writes).toBeGreaterThanOrEqual(open + 8)

  // Closed again: the ticks stop.
  await ui.press({ key: 'pane' })

  const closed = writes

  await clock.advance(60 * MS)
  expect(writes).toBe(closed)
  await ui.unmount()
})

test('a finished subagent stays in the current run however long it takes, and a new call revives it', async ($, on) => {
  const clock = squad(on, 'a1', 'a2')

  await begin($)
  await spawn($, 'one')
  await spawn($, 'two')
  await finish($, 'answer', 'a1')
  await clock.advance(60 * MS)

  const ui = await paneView($)

  // Nothing retires it: it is listed, done, with its time frozen.
  expect(await ui.findAll({ type: 'Text', text: /^one$/ })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: /^Done$/ })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: /^✓$/ })).toHaveLength(1)

  // A new call wakes it up.
  await $.tool.call({ tool: 'Read', file_path: 'x', agentId: 'a1' } as never)
  expect(await ui.findAll({ type: 'Text', text: /^Done$/ })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: /^Reading project files$/ })).toBeDefined()

  // Once the turn is archived the subagents go with it, and a late call finds nobody to wake.
  await finish($, 'answer', 'a1')
  await finish($, 'answer', 'a2')
  await finish($)
  await $.tool.call({ tool: 'Read', file_path: 'x', agentId: 'a1' } as never)
  expect(await ui.find({ type: 'Text', text: /^Reading project files$/ })).toBeUndefined()
  expect(await ui.findAll({ type: 'Text', text: /^one$/ })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /^All done, ready for more instructions$/ })).toBeDefined()
  await ui.unmount()
})

test('yields to a survey in the middle of a turn', async ($, on) => {
  radar(on)
  await begin($)

  const ui = await $.ui.mount({
    plugin: 'agent-radar',
    surface: 'terminal',
    ...BAND,
    props: { hasSurvey: true, isWorking: true, maxRows: 10, bodyColumns: 80 } as never
  })

  expect(await ui.find({ type: 'Button', key: 'toggle' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Claude Radar/ })).toBeUndefined()
  await ui.unmount()
})

// Another plugin that draws in the band beneath this one, as usage-meter does.
const other = {
  name: 'other-band',
  tier: 'append' as const,
  register: (on: any) => {
    on('ui.render', { component: 'AbovePrompt' }, () => ({
      type: 'Box',
      props: {},
      children: [{ type: 'Text', props: {}, children: ['OTHER BAND'] }]
    }))
  }
}

test('keeps what another hook of the band draws, working or finished', { plugins: [other] }, async ($, on) => {
  radar(on)

  await begin($)

  const ui = await band($)

  expect(await ui.find({ type: 'Text', text: /OTHER BAND/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Claude Radar$/ })).toBeDefined()

  await finish($)
  expect(await ui.find({ type: 'Text', text: /OTHER BAND/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'toggle' })).toBeDefined()
  await ui.unmount()
})

const spawned = (state: ReturnType<typeof initialState>, id: string, name = 'frontend-developer', now = 0, extra: object = {}) =>
  spawnSubagent(state, { id, name, task: 'Building login components', ...extra }, now)

/** The subagents of a state as the pane's current run draws them; a turn is opened first when the state has none. */
const agentsOf = (state: ReturnType<typeof initialState>, now = 99, t: Texts = en) =>
  paneOf(state.checklist.startedAt === null ? startTurn(state, 'go', 0) : state, now, 0, t).current!.agents

test('a spawn adds a working subagent under its own id, with its real name and task', async () => {
  const state = spawnSubagent(initialState(), { id: 'a1', name: 'frontend-developer', task: 'Building login components' }, 5000)

  expect(state.subagents['a1']).toEqual({
    id: 'a1',
    sessionId: '',
    name: 'frontend-developer',
    task: 'Building login components',
    activity: null,
    status: 'working',
    startedAt: 5000,
    finishedAt: null
  })
  expect(spawnSubagent(initialState(), { id: 'a1', name: 'Explore' }, 0).subagents['a1']?.task).toBeNull()
  expect(spawnSubagent(initialState(), { id: 'a1', name: 'Explore', task: '  ' }, 0).subagents['a1']?.task).toBeNull()
  // Only the subagents change.
  expect(state.checklist).toEqual(initialState().checklist)
})

test('runs of the same agent are independent entries, and a repeated id changes nothing', async () => {
  let state = spawned(initialState(), 'a1', 'code-reviewer', 1000)

  state = spawned(state, 'a2', 'code-reviewer', 2000)
  state = workSubagent(state, 'a1', 'reading')

  expect(Object.keys(state.subagents)).toEqual(['a1', 'a2'])
  expect(state.subagents['a1']?.activity).toBe('reading')
  expect(state.subagents['a2']?.activity).toBeNull()
  expect(state.subagents['a1']?.name).toBe(state.subagents['a2']?.name)
  expect(spawned(state, 'a1', 'other', 9000)).toBe(state)

  state = finishSubagent(state, 'a1', 'answer', 3000)
  expect(state.subagents['a1']?.status).toBe('done')
  expect(state.subagents['a2']?.status).toBe('working')
})

test('the parent is kept only when the spawn names one, and the hierarchy shows only where it is known', async () => {
  const shape = (state: ReturnType<typeof initialState>) => agentsOf(state, 9).map(agent => [agent.name, agent.depth])
  const flat = spawned(spawned(initialState(), 'a1', 'one', 1), 'a2', 'two', 2)

  expect('parentId' in flat.subagents['a1']!).toBe(false)
  expect(shape(flat)).toEqual([
    ['one', 0],
    ['two', 0]
  ])

  const nested = spawned(spawned(spawned(initialState(), 'a1', 'lead', 1), 'a3', 'solo', 2), 'a2', 'helper', 3, { parentId: 'a1' })

  expect(nested.subagents['a2']?.parentId).toBe('a1')
  // The child follows its parent, one level in, whatever the start order.
  expect(shape(nested)).toEqual([
    ['lead', 0],
    ['helper', 1],
    ['solo', 0]
  ])

  // A parent that is not listed (the main loop's id, or one not followed): flat.
  expect(shape(spawned(initialState(), 'a2', 'helper', 3, { parentId: 'gone' }))).toEqual([['helper', 0]])

  // Parents pointing at each other lose nothing.
  const loop = spawned(spawned(initialState(), 'x', 'x', 1, { parentId: 'y' }), 'y', 'y', 2, { parentId: 'x' })

  expect(shape(loop)).toHaveLength(2)
})

test('the activity comes from the tool, in plain words and never a path or a command', async () => {
  expect(activityOf('Read')).toBe('reading')
  for (const tool of ['Glob', 'Grep', 'WebSearch', 'WebFetch']) expect(activityOf(tool)).toBe('searching')
  for (const tool of ['Edit', 'Write', 'NotebookEdit']) expect(activityOf(tool)).toBe('updating')
  for (const tool of ['Agent', 'Task']) expect(activityOf(tool)).toBe('delegating')

  for (const command of ['npm test', 'bun run test', 'npx vitest run', 'pytest -q', 'npx jest', 'npm run test:unit'])
    expect(activityOf('Bash', command)).toBe('testing')

  for (const command of ['ls -la /secret/path', 'git status', 'cat latest.log', ''])
    expect(activityOf('Bash', command)).toBe('command')

  expect(activityOf('Bash')).toBe('command')
  expect(activityOf('TodoWrite')).toBeNull()
  expect(activityOf('mcp__x__y')).toBeNull()
})

test('a tool call sets the activity; an unknown tool or agent changes nothing', async () => {
  const state = spawned(initialState(), 'a1')

  expect(workSubagent(state, 'a1', 'updating').subagents['a1']?.activity).toBe('updating')
  expect(workSubagent(workSubagent(state, 'a1', 'testing'), 'a1', null).subagents['a1']?.activity).toBe('testing')
  expect(workSubagent(state, 'a1', null)).toBe(state)
  expect(workSubagent(state, 'nobody', 'testing')).toBe(state)
  expect(workSubagent(state, 'constructor', 'testing')).toBe(state)
  expect(workSubagent(state, 'a1', 'testing')).not.toBe(state)
})

test('a subagent ends done, stopped or failed with its time frozen; the first end stands, a new call revives it', async () => {
  const state = spawned(initialState(), 'a1', 'x', 1000)

  expect(finishSubagent(state, 'a1', 'answer', 4000).subagents['a1']).toMatchObject({ status: 'done', finishedAt: 4000 })
  expect(finishSubagent(state, 'a1', 'aborted', 4000).subagents['a1']?.status).toBe('stopped')
  expect(finishSubagent(state, 'a1', 'error', 4000).subagents['a1']?.status).toBe('failed')
  expect(finishSubagent(state, 'a1', 'refusal', 4000).subagents['a1']?.status).toBe('failed')
  expect(finishSubagent(state, 'nobody', 'answer', 4000)).toBe(state)

  const done = finishSubagent(state, 'a1', 'answer', 4000)

  // A second end does not rewrite the first.
  expect(finishSubagent(done, 'a1', 'error', 9000)).toBe(done)
  expect(agentsOf(done, 999_000)[0]?.time).toBe('3s')

  const back = workSubagent(done, 'a1', 'reading')

  expect(back.subagents['a1']).toMatchObject({ status: 'working', finishedAt: null })
  // The main turn is not touched by any of it.
  expect(done.checklist).toEqual(state.checklist)
})

test('a subagent waits for the person only while it works, and its next call or end lifts it', async () => {
  const state = spawned(initialState(), 'a1')
  const waiting = askSubagent(state, 'a1')

  expect(waiting.subagents['a1']?.status).toBe('needsYou')
  expect(askSubagent(state, 'nobody')).toBe(state)
  expect(askSubagent(waiting, 'a1')).toBe(waiting)
  expect(askSubagent(finishSubagent(state, 'a1', 'answer', 1), 'a1').subagents['a1']?.status).toBe('done')
  expect(workSubagent(waiting, 'a1', null).subagents['a1']?.status).toBe('working')
  expect(finishSubagent(waiting, 'a1', 'aborted', 1).subagents['a1']?.status).toBe('stopped')
  // The main checklist stays as it was.
  expect(waiting.checklist.phase).toBe(state.checklist.phase)
})

test('finished subagents stay listed, the timer lives while any works, and a step of it touches only the tick', async () => {
  let state = spawned(spawned(initialState(), 'a1', 'one', 0), 'a2', 'two', 0)

  expect(isLive(state)).toBe(true)

  state = finishSubagent(state, 'a1', 'answer', 10_000)
  // Nothing retires the finished one, however long it takes.
  expect(advance(state)).toEqual({ ...state, tick: 1 })
  expect(Object.keys(advance(state).subagents)).toEqual(['a1', 'a2'])
  expect(isLive(state)).toBe(true)

  const last = finishSubagent(state, 'a2', 'error', 10_000)

  expect(Object.keys(last.subagents)).toEqual(['a1', 'a2'])
  expect(isLive(last)).toBe(false)
})

/** The bottom for subagents: the radar's, plus an `agent.spawn` that starts the agents the test names, in order. */
const squad = (on: any, ...ids: string[]) => {
  const clock = radar(on)

  on('agent.spawn', () => ({ model: 'm', agentId: ids.shift() }))
  on('tool.call', () => answered({ stdout: '' }))

  return clock
}

const spawn = ($: any, subagentType: string, description = 'Building login components', extra: object = {}) =>
  $.agent.spawn({ prompt: 'p', description, subagentType, ...extra })

/** The subagents are drawn in the pane. */
const mount = ($: any, bodyColumns = 60) => paneView($, bodyColumns)

test('a spawn goes through untouched and the subagent shows in the pane with its name, time, task and state', async ($, on) => {
  const clock = squad(on, 'a1')

  await begin($)

  const result = await spawn($, 'frontend-developer')

  expect(result).toEqual({ model: 'm', agentId: 'a1' })

  await clock.advance(80 * MS)

  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /^frontend-developer$/ })).toBeDefined()
  // The main agent's time and the subagent's; the turn's is in the heading, with its label.
  expect(await ui.findAll({ type: 'Text', text: /^1m 20s$/ })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: /^Total time · 1m 20s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Building login components$/ })).toBeDefined()
  // The main agent's status, the checklist's line, the subagent's activity and its status.
  expect(await ui.findAll({ type: 'Text', text: /^Working$/ })).toHaveLength(4)
  // The heading's mark, the main agent's and the subagent's.
  expect(await ui.findAll({ type: 'Text', text: /^●$/ })).toHaveLength(3)
  // The block of the subagents counts the ones at work.
  expect(await ui.find({ type: 'Text', text: /^Subagents$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1 active$/ })).toBeDefined()
  await ui.unmount()
})

test('a refused spawn adds nothing, and its answer goes through as it is', async ($, on) => {
  radar(on)
  on('agent.spawn', () => ({ deny: 'no' }) as never)

  await begin($)
  expect(await spawn($, 'Explore')).toEqual({ deny: 'no' })

  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /Explore/ })).toBeUndefined()
  await ui.unmount()
})

test('two parallel subagents with the same name are kept apart', async ($, on) => {
  const clock = squad(on, 'a1', 'a2')

  await begin($)
  await spawn($, 'code-reviewer', 'Reviewing the auth module')
  await clock.advance(30 * MS)
  await spawn($, 'code-reviewer', 'Reviewing the billing module')

  const ui = await mount($)

  expect(await ui.findAll({ type: 'Text', text: /^code-reviewer$/ })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: /^Reviewing the auth module$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Reviewing the billing module$/ })).toBeDefined()
  // The main agent's time and the first subagent's.
  expect(await ui.findAll({ type: 'Text', text: /^30s$/ })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: /^0s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2 active$/ })).toBeDefined()

  // Finishing one leaves the other working; the finished one stays in the run, done.
  await finish($, 'answer', 'a1')
  expect(await ui.findAll({ type: 'Text', text: /^Done$/ })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /^1 active$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^code-reviewer$/ })).toHaveLength(2)
  await ui.unmount()
})

test('the activity follows the tools of that subagent only', async ($, on) => {
  squad(on, 'a1', 'a2')

  await begin($)
  await spawn($, 'one', 'Task one')
  await spawn($, 'two', 'Task two')

  const ui = await mount($)

  // The main agent's status and the checklist's line, and the activity and status of each subagent.
  expect(await ui.findAll({ type: 'Text', text: /^Working$/ })).toHaveLength(2 + 4)

  await $.tool.call({ tool: 'Read', file_path: '/secret/file.ts', agentId: 'a1' } as never)
  expect(await ui.findAll({ type: 'Text', text: /^Reading project files$/ })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /^Task one$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Task two$/ })).toBeDefined()
  // The main turn's two, both statuses, and the activity of the other subagent, which has none of its own yet.
  expect(await ui.findAll({ type: 'Text', text: /^Working$/ })).toHaveLength(2 + 2 + 1)

  await $.tool.call({ tool: 'Bash', command: 'npm test -- /secret/dir', agentId: 'a1' } as never)
  expect(await ui.find({ type: 'Text', text: /^Running tests$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /secret/ })).toBeUndefined()

  // A tool the radar does not know leaves the activity as it was.
  await $.tool.call({ tool: 'TodoWrite', todos: [], agentId: 'a1' } as never)
  expect(await ui.find({ type: 'Text', text: /^Running tests$/ })).toBeDefined()
  await ui.unmount()
})

test('a subagent call neither changes the main checklist nor goes through altered', async ($, on) => {
  radar(on)
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))

  const result = { ref: 3, result: { stdout: 'hi' }, text: 'hi' } as never

  on('tool.call', () => result)

  await begin($)
  await spawn($, 'one')
  expect(await $.tool.call({ tool: 'TodoWrite', todos: todos(['Sub step', 'pending']), agentId: 'a1' } as never)).toEqual(result)

  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /Sub step/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Working on your request/ })).toBeDefined()
  await ui.unmount()
})

test('a subagent that ends keeps its time frozen in the run, and in the turn group once the turn is archived', async ($, on) => {
  const clock = squad(on, 'a1')

  await begin($)
  await spawn($, 'frontend-developer')
  await clock.advance(65 * MS)

  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /No finished turns yet/ })).toBeDefined()

  await finish($, 'answer', 'a1')
  // Still in the run, done; the main agent works on, so the turn is open.
  expect(await ui.find({ type: 'Text', text: /^✓$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^frontend-developer$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Done$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No finished turns yet/ })).toBeDefined()

  // The main agent's time and the subagent's.
  expect(await ui.findAll({ type: 'Text', text: /^1m 05s$/ })).toHaveLength(2)
  await clock.advance(30 * MS)

  // The main agent ends: the turn goes to the history with the subagent's final state, task and time.
  await finish($)
  expect(await ui.find({ type: 'Text', text: /No finished turns yet/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^All done, ready for more instructions$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^frontend-developer$/ })).toBeDefined()
  // Its task under its name and its final state in its row, next to the group's own.
  expect(await ui.find({ type: 'Text', text: /^Building login components$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^Done$/ })).toHaveLength(2)
  expect(await ui.findAll({ type: 'Text', text: /^1m 05s$/ })).toHaveLength(1)
  await ui.unmount()
})

test('an error ends the subagent as Failed, an interrupt as Stopped', async ($, on) => {
  squad(on, 'a1', 'a2')

  await begin($)
  await spawn($, 'one')
  await spawn($, 'two')
  await finish($, 'error', 'a1')
  await finish($, 'aborted', 'a2')

  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /^Failed$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^✗$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Stopped$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^■$/ })).toBeDefined()
  await ui.unmount()
})

test('a permission question of a subagent shows Needs you for it alone, until its next call', async ($, on) => {
  squad(on, 'a1', 'a2')
  on('tool.check', () => ({ decision: 'ask' }) as never)

  await begin($)
  await spawn($, 'one')
  await spawn($, 'two')

  const ui = await mount($)

  await $.tool.check({ tool: 'Bash', input: { command: 'rm x' }, agentId: 'a1' } as never)
  expect(await ui.findAll({ type: 'Text', text: /^Needs you$/ })).toHaveLength(1)
  // The main turn did not ask.
  expect(await ui.find({ type: 'Text', text: /Waiting for your permission/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Build my landing page$/ })).toBeDefined()

  await $.tool.call({ tool: 'Bash', command: 'rm x', agentId: 'a1' } as never)
  expect(await ui.find({ type: 'Text', text: /^Needs you$/ })).toBeUndefined()
  await ui.unmount()
})

test('the main turn ending does not close the subagents, nor they it: a subagent in the background keeps the turn open', async ($, on) => {
  const clock = squad(on, 'a1')

  await begin($)
  await spawn($, 'frontend-developer')
  await finish($, 'answer')
  await clock.advance(6 * MS)

  // The main agent is over; the subagent, still working, keeps the turn open: the run is still there, working.
  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /^Current run$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Build my landing page$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^frontend-developer$/ })).toBeDefined()
  // The subagent still works, the main agent's own status is Done, and the heading's mark is still running.
  expect(await ui.find({ type: 'Text', text: /^Working$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Done$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1 active$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ready for more/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /No finished turns yet/ })).toBeDefined()

  // Then it finishes: the turn is archived, with the main agent's end and the subagent's.
  await finish($, 'answer', 'a1')
  expect(await ui.find({ type: 'Text', text: /^All done, ready for more instructions$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No finished turns yet/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^1 active$/ })).toBeUndefined()
  expect(await ui.findAll({ type: 'Text', text: /^Done$/ })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: /^Building login components$/ })).toBeDefined()
  await ui.unmount()
})

test('the main turn is still running when a subagent ends: the turn stays open', async ($, on) => {
  squad(on, 'a1')

  await begin($)
  await spawn($, 'one')
  await finish($, 'answer', 'a1')

  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /All done/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Build my landing page$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^one$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No finished turns yet/ })).toBeDefined()
  await ui.unmount()
})

test('OFF keeps the subagents in the state, and ON brings them back to the pane', async ($, on) => {
  squad(on, 'a1')

  await begin($)
  await spawn($, 'frontend-developer')

  const ui = await band($)
  const pane = await mount($)

  await ui.press({ key: 'toggle' })
  expect(await textsOf(ui)).toEqual(['Claude Radar'])

  await ui.press({ key: 'toggle' })
  expect(await pane.find({ type: 'Text', text: /^frontend-developer$/ })).toBeDefined()
  await ui.unmount()
  await pane.unmount()
})

test('with little width the subagent rows lose the status column and are cut with an ellipsis', async ($, on) => {
  squad(on, 'a1')

  await begin($)
  await spawn($, 'a-very-long-custom-agent-name-for-the-frontend', 'A long delegated task that goes on and on')

  const narrow = await mount($, 30)

  // The checklist's line and the activity; the statuses join them only when they fit.
  expect(await narrow.findAll({ type: 'Text', text: /^Working$/ })).toHaveLength(2)

  for (const text of await narrow.findAll({ type: 'Text', text: /agent-name|delegated/ })) {
    expect(text.props?.wrap).toBe('truncate-end')
  }
  await narrow.unmount()

  const wide = await mount($, 60)

  // Plus the main agent's status and the subagent's.
  expect(await wide.findAll({ type: 'Text', text: /^Working$/ })).toHaveLength(4)
  await wide.unmount()
})

test('a nested subagent shows under its parent only when the spawn names a parent that is listed', async ($, on) => {
  squad(on, 'a1', 'a2')

  await begin($)
  await spawn($, 'lead')
  await spawn($, 'helper', 'Helping', { parentAgentId: 'a1' })

  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /^helper$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^lead$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Box', props: { paddingLeft: 2 } } as never)).not.toHaveLength(0)
  await ui.unmount()
})

// Settings that say Spanish: the radar speaks it.
const spanish = () => ({ value: { language: 'Español' } }) as never

test('with settings.language in Spanish the band and the pane speak Spanish, names and titles untouched', async ($, on) => {
  squad(on, 'a1', 'a2')
  on('settings.read', spanish)
  on('tool.check', () => ({ decision: 'ask' }) as never)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await begin($, 'Build my landing page')
  await $.tool.call({ tool: 'TodoWrite', todos: todos(['Analyze structure', 'completed'], ['Implement it', 'in_progress'], ['Run tests', 'pending']) })
  await spawn($, 'frontend-developer', 'Building login components')
  await spawn($, 'code-reviewer', 'Reviewing the diff')
  await $.tool.call({ tool: 'Read', file_path: 'x', agentId: 'a1' } as never)
  await finish($, 'error', 'a2')

  const ui = await band($)

  // The proper name stays; the buttons speak Spanish.
  expect(await textsOf(ui)).toEqual(['Claude Radar'])
  expect(await ui.find({ type: 'Button', key: 'pane', text: /^\[ ◧ Detalle \]$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'toggle', text: /^\[ ● Claude Radar: ON \]$/ })).toBeDefined()
  await ui.unmount()

  const pane = await paneView($)

  for (const text of [/^Ejecución actual$/, /^Trabajando$/, /^Hecho\s*$/, /^En curso\s*$/, /^Siguiente\s*$/, /^Agente principal$/, /^Historial$/]) {
    expect(await pane.find({ type: 'Text', text })).toBeDefined()
  }
  // The heading's total time and the block of the subagents, with the one still at work.
  for (const text of [/^Tiempo total · /, /^Subagentes$/, /^1 activo$/]) {
    expect(await pane.find({ type: 'Text', text })).toBeDefined()
  }
  expect(await pane.find({ type: 'Text', text: /^Leyendo archivos del proyecto$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Falló$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Aún no hay turnos terminados$/ })).toBeDefined()
  // What comes from the person's text or the agents' own names is not translated.
  for (const text of [/^Build my landing page$/, /^Analyze structure$/, /^frontend-developer$/, /^Building login components$/, /^code-reviewer$/, /^Reviewing the diff$/]) {
    expect(await pane.find({ type: 'Text', text })).toBeDefined()
  }
  // None of the English words is left.
  expect(await pane.find({ type: 'Text', text: /^(Current run|Main agent|Working|Done|Next|History|Failed|No finished)\b/ })).toBeUndefined()
  await pane.unmount()

  // The turn ends: the group of the history says it in Spanish too.
  await $.tool.call({ tool: 'Read', file_path: 'x', agentId: 'a1' } as never)
  await finish($, 'answer', 'a1')
  await finish($)

  const archived = await paneView($)

  expect(await archived.find({ type: 'Text', text: /^Todo listo, esperando instrucciones$/ })).toBeDefined()
  expect(await archived.find({ type: 'Text', text: /^1 ejecución$/ })).toBeDefined()
  expect(await archived.findAll({ type: 'Text', text: /^Hecho$/ })).toHaveLength(2)
  expect(await archived.findAll({ type: 'Text', text: /^Falló$/ })).toHaveLength(1)
  expect(await archived.find({ type: 'Text', text: /^Reviewing the diff$/ })).toBeDefined()
  expect(await archived.find({ type: 'Text', text: /^Building login components$/ })).toBeDefined()
  expect(await archived.find({ type: 'Text', text: /^1\/3$/ })).toBeDefined()
  expect(await archived.find({ type: 'Text', text: /ready|Main agent|Done|Failed/ })).toBeUndefined()
  await archived.unmount()
})

test('the phases and their reasons are put in Spanish when drawn, from codes the state keeps', async ($, on) => {
  radar(on)
  on('settings.read', spanish)
  on('tool.check', () => ({ decision: 'ask' }) as never)
  on('tool.call', () => answered({ stdout: '' }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const pane = await paneView($)

  expect(await pane.find({ type: 'Text', text: /^Aún no hay nada en marcha$/ })).toBeDefined()

  await begin($, '')
  expect(await pane.find({ type: 'Text', text: /^Trabajando en tu petición$/ })).toBeDefined()

  await $.tool.check({ tool: 'Bash', input: { command: 'rm x' } })
  expect(await pane.find({ type: 'Text', text: /^Te necesita$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Esperando tu permiso/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Aún no hay turnos terminados$/ })).toBeDefined()

  // The phases a turn can end in, from the codes the state keeps (once archived, the history names how it ended).
  const working = startTurn(initialState(), 'go', 0)

  expect(paneOf(finishTurn(working, 'error', 1), 1, 0, es).current).toMatchObject({ reason: 'El turno terminó con un error', leader: { label: 'Falló' } })
  expect(paneOf(finishTurn(working, 'refusal', 1), 1, 0, es).current).toMatchObject({ reason: 'El modelo se negó a responder' })
  expect(paneOf(finishTurn(working, 'aborted', 1), 1, 0, es).current).toMatchObject({ reason: null, leader: { label: 'Detenido' } })
  expect(paneOf(finishTurn(working, 'answer', 1), 1, 0, es).current).toMatchObject({ reason: null, leader: { label: 'Hecho' } })

  await finish($, 'error')
  expect(await pane.find({ type: 'Text', text: /^Todo listo, esperando instrucciones$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Falló$/ })).toBeDefined()

  await begin($)
  await finish($, 'aborted')
  expect(await pane.find({ type: 'Text', text: /^Detenido$/ })).toBeDefined()

  await begin($)
  await finish($)
  expect(await pane.find({ type: 'Text', text: /^Hecho$/ })).toBeDefined()
  await pane.unmount()
})

test('a task with no valid text is named in the language when drawn', async ($, on) => {
  radar(on)
  on('tool.call', () => answered({ oldTodos: [], newTodos: [] }))

  await begin($)
  await $.tool.call({ tool: 'TodoWrite', todos: todos(['/only/a/path', 'pending']) })

  const english = await paneView($)

  expect(await english.find({ type: 'Text', text: /^Working on it$/ })).toBeDefined()
  await english.unmount()

  // The state keeps no phrase: the same task reads in the other language too.
  expect(rowsOf(writeTodos(startTurn(initialState(), 'go', 0), [{ content: '/only/a/path', status: 'pending' }]).checklist, 0, es)[0]?.name).toBe('En ello')
})

test('the activities are put in Spanish: every one the tools can say', async () => {
  const state = (activity: Parameters<typeof workSubagent>[2]) => workSubagent(spawned(initialState(), 'a1', 'x', 0, { task: null }), 'a1', activity)

  expect(agentsOf(state('reading'), 1, es)[0]?.activity).toBe('Leyendo archivos del proyecto')
  expect(agentsOf(state('searching'), 1, es)[0]?.activity).toBe('Buscando información del proyecto')
  expect(agentsOf(state('updating'), 1, es)[0]?.activity).toBe('Actualizando archivos del proyecto')
  expect(agentsOf(state('testing'), 1, es)[0]?.activity).toBe('Ejecutando pruebas')
  expect(agentsOf(state('command'), 1, es)[0]?.activity).toBe('Ejecutando un comando')
  expect(agentsOf(state('delegating'), 1, es)[0]?.activity).toBe('Delegando trabajo')
  expect(agentsOf(state(null), 1, es)[0]?.activity).toBe('Trabajando')
  expect(agentsOf(state(null), 1, en)[0]?.activity).toBe('Working')
  // The same state, two languages.
  expect(agentsOf(state('testing'), 1, en)[0]?.activity).toBe('Running tests')
})

test('without settings, with unreadable settings or with a language the radar lacks, everything is English', async ($, on) => {
  radar(on)
  on('settings.read', () => ({ value: { language: 'japanese' } }) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await begin($)

  const pane = await paneView($)

  expect(await pane.find({ type: 'Text', text: /^Current run$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Main agent$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Working$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Ejecución|Agente|Trabajando/ })).toBeUndefined()
  await pane.unmount()

  const ui = await band($)

  expect(await ui.find({ type: 'Button', key: 'pane', text: /Detail/ })).toBeDefined()
  await ui.unmount()
})

test('the language is read once per session, kept while it runs, and read again in the next', async ($, on) => {
  radar(on)
  on('session.end', () => ({ sessionId: 's' }) as never)

  let reads = 0
  let language = 'Español'

  on('settings.read', () => {
    reads++

    return { value: { language } } as never
  })

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await begin($)

  const pane = await paneView($)
  const ui = await band($)

  expect(await pane.find({ type: 'Text', text: /^Ejecución actual$/ })).toBeDefined()
  expect(reads).toBe(1)

  // A change of the setting does not move the session that runs.
  language = 'English'
  await finish($)
  await begin($)
  expect(await pane.find({ type: 'Text', text: /^Ejecución actual$/ })).toBeDefined()
  expect(reads).toBe(1)
  await ui.unmount()
  await pane.unmount()

  await $.session.end({ sessionId: 's' } as never)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await begin($)

  const next = await paneView($)

  expect(await next.find({ type: 'Text', text: /^Current run$/ })).toBeDefined()
  expect(reads).toBe(2)
  await next.unmount()
})

test('the toasts speak the language: the ON/OFF change and the pane that cannot be placed', async ($, on) => {
  const toasts: string[] = []
  const { calls } = radar(on, undefined, toasts, false)

  on('settings.read', spanish)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const ui = await band($)

  await ui.press({ key: 'pane' })
  expect(calls).toEqual(['open agent-radar', 'close agent-radar'])
  expect(toasts).toEqual(['El panel de detalle no está disponible aquí: no panes here'])

  await ui.press({ key: 'toggle' })
  await ui.press({ key: 'toggle' })
  expect(toasts.slice(1)).toEqual(['Claude Radar: OFF', 'Claude Radar: ON'])
  await ui.unmount()
})

test('the toasts are in English without a language', async ($, on) => {
  const toasts: string[] = []

  radar(on, undefined, toasts, false)

  const ui = await band($)

  await ui.press({ key: 'pane' })
  expect(toasts).toEqual(['The detail pane is not available here: no panes here'])
  await ui.unmount()
})

const agentRadar = ($: any, args = '') => $.command.run({ command: 'agent-radar', args })

test('/agent-radar with no argument toggles the pane, and the answer says which way', async ($, on) => {
  const { calls } = radar(on)
  const ui = await band($)

  expect(await agentRadar($)).toEqual({ text: 'Detail pane opened' })
  expect(calls).toEqual(['open agent-radar'])
  expect(await ui.find({ type: 'Button', key: 'pane', text: /Close/ })).toBeDefined()

  expect(await agentRadar($)).toEqual({ text: 'Detail pane closed' })
  expect(calls).toEqual(['open agent-radar', 'close agent-radar'])
  expect(await ui.find({ type: 'Button', key: 'pane', text: /Detail/ })).toBeDefined()
  await ui.unmount()
})

test('open only opens and close only closes: the other way round it does nothing', async ($, on) => {
  const { calls } = radar(on)
  const ui = await band($)

  expect(await agentRadar($, 'close')).toEqual({ text: 'Detail pane closed' })
  expect(calls).toEqual([])

  expect(await agentRadar($, 'open')).toEqual({ text: 'Detail pane opened' })
  expect(await agentRadar($, ' OPEN ')).toEqual({ text: 'Detail pane opened' })
  expect(calls).toEqual(['open agent-radar'])
  expect(await ui.find({ type: 'Button', key: 'pane', text: /Close/ })).toBeDefined()

  expect(await agentRadar($, 'close')).toEqual({ text: 'Detail pane closed' })
  expect(calls).toEqual(['open agent-radar', 'close agent-radar'])
  expect(await ui.find({ type: 'Button', key: 'pane', text: /Detail/ })).toBeDefined()
  await ui.unmount()
})

test('the button and the command work the same pane: each sees what the other did', async ($, on) => {
  const { calls } = radar(on)
  const ui = await band($)

  await ui.press({ key: 'pane' })
  expect(await agentRadar($)).toEqual({ text: 'Detail pane closed' })
  expect(await agentRadar($)).toEqual({ text: 'Detail pane opened' })
  await ui.press({ key: 'pane' })
  expect(calls).toEqual(['open agent-radar', 'close agent-radar', 'open agent-radar', 'close agent-radar'])
  await ui.unmount()
})

test('an argument it does not know answers with the usage and changes nothing', async ($, on) => {
  const { calls } = radar(on)
  const ui = await band($)

  expect(await agentRadar($, 'toggle')).toEqual({ text: 'Usage: /agent-radar [open|close|hide|show]. With no argument, it toggles the pane.' })
  expect(await agentRadar($, 'open now')).toEqual({ text: 'Usage: /agent-radar [open|close|hide|show]. With no argument, it toggles the pane.' })
  expect(calls).toEqual([])
  expect(await ui.find({ type: 'Button', key: 'pane', text: /Detail/ })).toBeDefined()
  await ui.unmount()
})

test('with the radar OFF the command says so and opens nothing; back ON it opens', async ($, on) => {
  const { calls } = radar(on)
  const ui = await band($)

  await ui.press({ key: 'toggle' })

  for (const args of ['', 'open', 'close']) {
    expect(await agentRadar($, args)).toEqual({ text: 'Claude Radar is OFF. Turn it on with its button.' })
  }
  expect(calls).toEqual([])
  expect(await agentRadar($, 'bogus')).toEqual({ text: 'Usage: /agent-radar [open|close|hide|show]. With no argument, it toggles the pane.' })

  await ui.press({ key: 'toggle' })
  expect(await agentRadar($)).toEqual({ text: 'Detail pane opened' })
  expect(calls).toEqual(['open agent-radar'])
  await ui.unmount()
})

test('turning the radar OFF closes the pane the command opened, and the command then finds it closed', async ($, on) => {
  const { calls } = radar(on)
  const ui = await band($)

  await agentRadar($)
  await ui.press({ key: 'toggle' })
  expect(calls).toEqual(['open agent-radar', 'close agent-radar'])

  await ui.press({ key: 'toggle' })
  expect(await agentRadar($)).toEqual({ text: 'Detail pane opened' })
  expect(calls).toEqual(['open agent-radar', 'close agent-radar', 'open agent-radar'])
  await ui.unmount()
})

test('a surface that places no panes: the answer and the toast give the reason, and nothing is left waiting', async ($, on) => {
  const toasts: string[] = []
  const { calls } = radar(on, undefined, toasts, false)
  const ui = await band($)

  expect(await agentRadar($)).toEqual({ text: 'The detail pane is not available here: no panes here' })
  expect(toasts).toEqual(['The detail pane is not available here: no panes here'])
  expect(calls).toEqual(['open agent-radar', 'close agent-radar'])
  expect(await ui.find({ type: 'Button', key: 'pane', text: /Detail/ })).toBeDefined()
  await ui.unmount()
})

test('opening is the first asynchronous step of the command: the language is read after it', async ($, on) => {
  const { calls } = radar(on)
  const readsAfter: number[] = []

  on('settings.read', () => {
    readsAfter.push(calls.length)

    return { value: { language: 'Español' } } as never
  })

  // Nothing settled the language yet, as with a command typed before any other event.
  expect(await agentRadar($)).toEqual({ text: 'Panel de detalle abierto' })
  expect(readsAfter[0]).toBe(1)
})

test('the command speaks the language of settings.language: its description and its answers', async ($, on) => {
  const { commands } = radar(on)

  on('settings.read', spanish)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  expect(commands[0]).toEqual({ name: 'agent-radar', description: 'Abre o cierra el panel de detalle de Claude Radar, o muestra u oculta su banda.', argumentHint: '[open|close|hide|show]' })
  expect(await agentRadar($)).toEqual({ text: 'Panel de detalle abierto' })
  expect(await agentRadar($)).toEqual({ text: 'Panel de detalle cerrado' })
  expect(await agentRadar($, 'otra')).toEqual({ text: 'Uso: /agent-radar [open|close|hide|show]. Sin argumento, alterna el panel.' })

  const ui = await band($)

  await ui.press({ key: 'toggle' })
  expect(await agentRadar($)).toEqual({ text: 'Claude Radar está apagado (OFF). Enciéndelo con su botón.' })
  await ui.unmount()
})

test('the hide button takes the band off, saves the choice and says how to bring it back', async ($, on) => {
  on('ui.render', () => engineBand)

  const entries = memory(on)
  const toasts = watchToasts(on)
  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  await ui.press({ key: 'hide' })

  expect(await ui.find({ type: 'Button', key: 'toggle' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'hide' })).toBeUndefined()
  expect(entries.get('bandHidden')).toBe(true)
  expect(toasts).toEqual(['Band hidden. Bring it back with /agent-radar show'])
  await ui.unmount()
})

test('/agent-radar hide and show take the band off and bring it back, whether the radar is ON or OFF', async ($, on) => {
  const { calls } = radar(on)
  const ui = await band($)

  expect(await agentRadar($, 'hide')).toEqual({ text: 'Band hidden. Bring it back with /agent-radar show' })
  expect(await ui.find({ type: 'Button', key: 'toggle' })).toBeUndefined()
  expect(await agentRadar($, 'show')).toEqual({ text: 'Band shown' })
  expect(await ui.find({ type: 'Button', key: 'toggle', text: /ON/ })).toBeDefined()

  await ui.press({ key: 'toggle' })
  expect(await agentRadar($, 'hide')).toEqual({ text: 'Band hidden. Bring it back with /agent-radar show' })
  expect(await agentRadar($, 'show')).toEqual({ text: 'Band shown' })
  expect(await ui.find({ type: 'Button', key: 'toggle', text: /OFF/ })).toBeDefined()
  expect(calls).toEqual([])
  await ui.unmount()
})

test('hiding the band leaves the radar working: the pane still opens by command and the radar stays ON', async ($, on) => {
  const { calls } = radar(on)
  const ui = await band($)

  await ui.press({ key: 'hide' })
  expect(await agentRadar($)).toEqual({ text: 'Detail pane opened' })
  expect(calls).toEqual(['open agent-radar'])
  expect(await agentRadar($, 'show')).toEqual({ text: 'Band shown' })
  expect(await ui.find({ type: 'Button', key: 'toggle', text: /ON/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'pane', text: /Close/ })).toBeDefined()
  await ui.unmount()
})

test('a new session restores a hidden band', async ($, on) => {
  on('ui.render', () => engineBand)
  memory(on, { bandHidden: true })
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Button', key: 'toggle' })).toBeUndefined()
  await ui.unmount()
})

test('hidesTools: only with the radar ON, work going on and nobody waiting for the person', async () => {
  const working = startTurn(initialState(), 'go', 0)
  const withAgent = spawned(initialState(), 'a1')

  expect(hidesTools(initialState())).toBe(false)
  expect(hidesTools(working)).toBe(true)
  expect(hidesTools({ ...working, claudeRadarEnabled: false })).toBe(false)
  expect(hidesTools(askUser(working))).toBe(false)
  expect(hidesTools(finishTurn(working, 'answer', 1))).toBe(false)
  expect(hidesTools(finishTurn(working, 'error', 1))).toBe(false)
  expect(hidesTools(finishTurn(working, 'aborted', 1))).toBe(false)
  // Subagents at work keep the rows hidden after the main turn ended; one that waits for the person shows them.
  expect(hidesTools(withAgent)).toBe(true)
  expect(hidesTools(finishTurn(spawned(working, 'a1'), 'answer', 1))).toBe(true)
  expect(hidesTools(askSubagent(withAgent, 'a1'))).toBe(false)
  expect(hidesTools(askSubagent(spawned(working, 'a1'), 'a1'))).toBe(false)
  expect(hidesTools(finishSubagent(withAgent, 'a1', 'answer', 1))).toBe(false)
  expect(hidesTools({ ...withAgent, claudeRadarEnabled: false })).toBe(false)
})

/** What the engine draws for any component, so a test can tell it from nothing. */
const drawing = (_: unknown, e: { component: string }) => ({
    type: 'Box' as const,
    props: {},
    children: [{ type: 'Text' as const, props: {}, children: [`ENGINE ${e.component}`] }]
  })

/** The props each tool row takes, as the kit mounts them. */
const ROWS = {
  ToolUse: { tool_use_id: 't1', tool: 'Bash', input: { command: 'ls' }, isRunning: true, isErrored: false, isInterrupted: false },
  ToolResult: { tool_use_id: 't1', tool: 'Bash', output: { stdout: 'files' }, isErrored: false },
  ToolGroup: {
    calls: [{ tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false }],
    isActive: true,
    isExpanded: false
  },
  ToolProgress: { tool_use_id: 't1', kind: 'background_hint', hint: '(ctrl+b to run in background)' }
} as const

const row = ($: any, component: string, props: object = {}) =>
  $.ui.mount({
    plugin: 'agent-radar',
    surface: 'terminal',
    component,
    requestId: `row-${component}`,
    props: { ...(ROWS as Record<string, object>)[component], ...props } as never
  })

test('with the radar ON and the agent working the tool rows draw nothing', async ($, on) => {
  radar(on, drawing)
  await begin($)

  for (const component of Object.keys(ROWS)) {
    const ui = await row($, component)

    expect(await ui.find({ type: 'Text', text: /ENGINE/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the tool rows draw as the engine does before work, after it, when OFF and when the person is asked', async ($, on) => {
  radar(on, drawing)
  on('tool.check', () => ({ decision: 'ask' }) as never)
  on('tool.call', () => answered({ stdout: '' }))

  const seen = async (component: string) => {
    const ui = await row($, component)
    const found = await ui.find({ type: 'Text', text: new RegExp(`ENGINE ${component}`) })

    await ui.unmount()

    return found !== undefined
  }

  for (const component of Object.keys(ROWS)) expect(await seen(component)).toBe(true)

  await begin($)
  expect(await seen('ToolUse')).toBe(false)

  // The person is asked: the call that asks stays in view.
  await $.tool.check({ tool: 'Bash', input: { command: 'rm x' } })
  for (const component of Object.keys(ROWS)) expect(await seen(component)).toBe(true)

  await $.tool.call({ tool: 'Bash', command: 'rm x' })
  expect(await seen('ToolUse')).toBe(false)

  await finish($)
  for (const component of Object.keys(ROWS)) expect(await seen(component)).toBe(true)

  // OFF in the middle of work.
  await begin($)
  expect(await seen('ToolResult')).toBe(false)

  const band = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  await band.press({ key: 'toggle' })
  for (const component of Object.keys(ROWS)) expect(await seen(component)).toBe(true)

  await band.press({ key: 'toggle' })
  expect(await seen('ToolGroup')).toBe(false)
  await band.unmount()
})

test('a mounted row hides and comes back by itself when the phase changes', async ($, on) => {
  radar(on, drawing)

  const ui = await row($, 'ToolUse')

  expect(await ui.find({ type: 'Text', text: /ENGINE ToolUse/ })).toBeDefined()

  await begin($)
  expect(await ui.find({ type: 'Text', text: /ENGINE ToolUse/ })).toBeUndefined()

  await finish($)
  expect(await ui.find({ type: 'Text', text: /ENGINE ToolUse/ })).toBeDefined()
  await ui.unmount()
})

test('the rows stay hidden while a subagent works after the main turn, and come back when it ends or asks', async ($, on) => {
  const clock = radar(on, drawing)

  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  on('tool.call', () => answered({ stdout: '' }))
  on('tool.check', () => ({ decision: 'ask' }) as never)

  await begin($)
  await spawn($, 'frontend-developer')
  await finish($)

  const ui = await row($, 'ToolUse')

  expect(await ui.find({ type: 'Text', text: /ENGINE/ })).toBeUndefined()

  await $.tool.check({ tool: 'Bash', input: { command: 'rm x' }, agentId: 'a1' } as never)
  expect(await ui.find({ type: 'Text', text: /ENGINE ToolUse/ })).toBeDefined()

  await $.tool.call({ tool: 'Bash', command: 'rm x', agentId: 'a1' } as never)
  expect(await ui.find({ type: 'Text', text: /ENGINE/ })).toBeUndefined()

  await finish($, 'answer', 'a1')
  expect(await ui.find({ type: 'Text', text: /ENGINE ToolUse/ })).toBeDefined()
  await clock.advance(6 * MS)
  await ui.unmount()
})

test('a call that failed or was cut keeps its row in view', async ($, on) => {
  radar(on, drawing)
  await begin($)

  for (const [component, props] of [
    ['ToolUse', { isErrored: true }],
    ['ToolUse', { isInterrupted: true }],
    ['ToolResult', { isErrored: true }],
    ['ToolGroup', { calls: [{ ...ROWS.ToolGroup.calls[0], isErrored: true }] }]
  ] as const) {
    const ui = await row($, component, props)

    expect(await ui.find({ type: 'Text', text: new RegExp(`ENGINE ${component}`) })).toBeDefined()
    await ui.unmount()
  }
})

test('the reply and everything else the radar must not touch is drawn by the engine, working or not', async ($, on) => {
  radar(on, drawing)
  await begin($)

  for (const component of [
    'AssistantMessage',
    'UserMessage',
    'TurnDuration',
    'InfoNotice',
    'SessionMode',
    'PromptHint',
    'CommandOutput'
  ]) {
    const ui = await $.ui.mount({
      plugin: 'agent-radar',
      surface: 'terminal',
      component,
      requestId: `row-${component}`,
      props: { text: 'final answer' } as never
    } as never)

    expect(await ui.find({ type: 'Text', text: new RegExp(`^ENGINE ${component}$`) })).toBeDefined()
    await ui.unmount()
  }
})

test('a whole session of work registers nothing, calls no model and injects nothing into the context', async ($, on) => {
  const clock = radar(on)
  const { commands } = clock
  const seen: string[] = []
  let spawns = 0

  // Every way the radar could cost tokens or add to the session: a tool, a command, an agent, a model call, a prompt, a message.
  for (const event of ['tool.register', 'agent.register', 'model.complete', 'prompt.submit', 'session.send', 'session.compact']) {
    ;(on as any)(event, () => {
      seen.push(event)

      return {} as never
    })
  }

  on('agent.spawn', () => ({ model: 'm', agentId: `a${++spawns}` }))
  on('tool.call', () => answered({ oldTodos: [], newTodos: [] }))
  on('tool.check', () => ({ decision: 'ask' }) as never)
  on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'SYSTEM', scope: 'shared' }] }) as never)
  on('prompt.context', () => ({ blocks: [{ name: 'currentDate', text: 'today' }] }) as never)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await begin($)
  await $.tool.call({ tool: 'TodoWrite', todos: todos(['Step', 'in_progress']) })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Another', description: 'd' })
  await spawn($, 'frontend-developer')
  await spawn($, 'frontend-developer')
  await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'a1' } as never)
  await $.tool.check({ tool: 'Bash', input: { command: 'rm x' }, agentId: 'a2' } as never)
  await finish($, 'answer', 'a1')

  const band = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  await band.press({ key: 'toggle' })
  await band.press({ key: 'toggle' })
  await finish($)
  await clock.advance(10 * MS)
  await band.unmount()

  // Only the two spawns the test itself made, and nothing else of the list.
  expect(spawns).toBe(2)
  expect(seen).toEqual([])
  // The only thing it registers is the command that opens the pane.
  expect(commands.map(command => command.name)).toEqual(['agent-radar'])
  // What the model would read, as the layers beneath made it: untouched by the radar.
  expect(await $.prompt.compose({} as never)).toEqual({ sections: [{ id: 'base', text: 'SYSTEM', scope: 'shared' }] })
  expect(await $.prompt.context({ blocks: [] } as never)).toEqual({ blocks: [{ name: 'currentDate', text: 'today' }] })
})

test('the timer stops when nothing is left to move', async ($, on) => {
  const clock = squad(on, 'a1')
  let writes = 0

  ;(on as any)('state.set', (_: unknown, e: { key: string }, next: (e: unknown) => unknown) => {
    if (e.key === 'claudeRadarState') writes++

    return next(e)
  })

  await begin($)
  await spawn($, 'frontend-developer')

  const opener = await openPane($)

  await clock.advance(2 * MS)
  expect(writes).toBeGreaterThan(0)

  await finish($, 'answer', 'a1')
  await finish($)
  // Both are over and the turn is archived; nothing writes the state from then on, the pane open or not.
  await clock.advance(6 * MS)

  const settled = writes

  await clock.advance(60 * MS)
  expect(writes).toBe(settled)
  await opener.unmount()
})

test('a subagent with no task and no tool seen shows Working', async ($, on) => {
  squad(on, 'a1')
  await begin($)
  await spawn($, 'Explore', '')

  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /^Explore$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^Working$/ })).toHaveLength(4)
  await ui.unmount()
})

test('settleTurn archives the turn only when the main agent has ended and no subagent is at work', async () => {
  const idle = initialState()
  const working = startTurn(initialState(), 'Build my landing page', 1000)
  const waiting = askUser(working)

  // No turn, a turn at work, a turn waiting for the person: the same state.
  expect(settleTurn(idle, 5000)).toBe(idle)
  expect(settleTurn(working, 5000)).toBe(working)
  expect(settleTurn(waiting, 5000)).toBe(waiting)

  const done = finishTurn(working, 'answer', 4000)
  const settled = settleTurn(done, 9000)

  expect(settled.turns).toEqual([
    {
      id: '1000',
      title: 'Build my landing page',
      status: 'done',
      startedAt: 1000,
      finishedAt: 4000,
      tokens: 0,
      leader: { tasksDone: 0, tasksTotal: 0, tokens: 0, finishedAt: 4000 },
      agents: []
    }
  ])
  // The current turn is empty again, as at the start.
  expect(settled.checklist).toEqual(initialState().checklist)
  expect(settled.subagents).toEqual({})
  // Archived once: there is nothing left to settle.
  expect(settleTurn(settled, 9500)).toBe(settled)
})

test('the archive keeps the model, the ON/OFF choice and the tick, and counts the main agent tasks', async () => {
  const info = { model: 'claude-opus-4-5-20251101', effort: 'high' }
  let state = writeTodos(startTurn(initialState(), 'go', 0), [
    { content: 'One', status: 'completed' },
    { content: 'Two', status: 'completed' },
    { content: 'Three', status: 'in_progress' }
  ])

  state = { ...stepModel(state, undefined, info), claudeRadarEnabled: false, tick: 7 }

  const settled = settleTurn(finishTurn(state, 'answer', 10), 10)

  expect(settled.turns[0]?.leader).toEqual({ modelInfo: info, tasksDone: 2, tasksTotal: 3, tokens: 0, finishedAt: expect.any(Number) })
  expect(settled).toMatchObject({ claudeRadarEnabled: false, tick: 7, leaderModel: info })
  expect(settled.checklist.tasks).toEqual([])
})

test('a turn is archived as done, stopped or failed by how the main agent ended', async () => {
  const working = startTurn(initialState(), 'go', 100)

  for (const [reason, status] of [
    ['answer', 'done'],
    ['aborted', 'stopped'],
    ['error', 'failed'],
    ['refusal', 'failed']
  ] as const) {
    const settled = settleTurn(finishTurn(working, reason, 700), 9000)

    expect(settled.turns[0]).toMatchObject({ status, startedAt: 100, finishedAt: 700 })
  }
})

test('a subagent in the background keeps the turn open, and the last one to end archives it', async () => {
  let state = spawned(startTurn(initialState(), 'go', 0), 'a1', 'one', 100)

  state = spawned(state, 'a2', 'two', 50)
  state = finishTurn(state, 'answer', 1000)
  // The main agent is done, but two subagents are at work.
  expect(settleTurn(state, 1000)).toBe(state)
  expect(state.checklist.phase).toBe('done')

  state = finishSubagent(state, 'a1', 'answer', 2000)
  expect(settleTurn(state, 2000)).toBe(state)

  state = finishSubagent(state, 'a2', 'error', 3000)

  const settled = settleTurn(state, 3000)

  // The turn lasts until everything ended; the subagents are in start order, each as it ended.
  expect(settled.turns[0]).toMatchObject({ status: 'done', startedAt: 0, finishedAt: 3000 })
  expect(settled.turns[0]?.agents.map(agent => [agent.id, agent.status, agent.finishedAt])).toEqual([
    ['a2', 'failed', 3000],
    ['a1', 'done', 2000]
  ])
  expect(settled.subagents).toEqual({})

  // A subagent that ended first leaves the turn to end with the main agent.
  const early = finishSubagent(spawned(startTurn(initialState(), 'go', 0), 'a1', 'one', 10), 'a1', 'answer', 500)

  expect(settleTurn(early, 600)).toBe(early)
  expect(settleTurn(finishTurn(early, 'answer', 1000), 1000).turns[0]?.finishedAt).toBe(1000)
})

test('a subagent that wakes up in the background before the turn is archived keeps it open', async () => {
  let state = finishSubagent(spawned(startTurn(initialState(), 'go', 0), 'a1', 'one', 10), 'a1', 'answer', 500)

  state = finishTurn(state, 'answer', 600)
  state = workSubagent(state, 'a1', 'reading')
  expect(settleTurn(state, 700)).toBe(state)
})

test('the archive keeps at most 10 turns, the most recent first, and drops the oldest', async () => {
  let state = initialState()

  for (let i = 0; i < 12; i++) state = settleTurn(finishTurn(startTurn(state, `job ${i}`, i * 10), 'answer', i * 10 + 5), i * 10 + 5)

  expect(TURNS_MAX).toBe(10)
  expect(state.turns).toHaveLength(10)
  expect(state.turns[0]?.title).toBe('Job 11')
  expect(state.turns[9]?.title).toBe('Job 2')
  expect(new Set(state.turns.map(turn => turn.id)).size).toBe(10)

  // Two turns that began in the same instant are still two records.
  const twice = settleTurn(finishTurn(startTurn(settleTurn(finishTurn(startTurn(initialState(), 'a', 0), 'answer', 1), 1), 'b', 0), 'answer', 2), 2)

  expect(twice.turns.map(turn => turn.title)).toEqual(['B', 'A'])
  expect(new Set(twice.turns.map(turn => turn.id)).size).toBe(2)
})

test('a new turn archives by force the one still open: subagents at work are stopped', async () => {
  let state = spawned(startTurn(initialState(), 'first', 0), 'a1', 'one', 10)

  state = spawned(state, 'a2', 'two', 20)
  state = finishSubagent(state, 'a2', 'answer', 30)
  state = finishTurn(state, 'answer', 100)
  // The main agent is done, a1 still works: the turn is open.
  expect(state.turns).toEqual([])

  const next = startTurn(state, 'second', 500)

  expect(next.turns).toHaveLength(1)
  expect(next.turns[0]).toMatchObject({ title: 'First', status: 'done', startedAt: 0, finishedAt: 500 })
  expect(next.turns[0]?.agents.map(agent => [agent.id, agent.status, agent.finishedAt])).toEqual([
    ['a1', 'stopped', 500],
    ['a2', 'done', 30]
  ])
  // The new turn begins empty.
  expect(next.subagents).toEqual({})
  expect(next.checklist).toEqual({ ...initialState().checklist, title: 'Second', phase: 'working', startedAt: 500 })

  // A turn that never ended counts as stopped.
  expect(startTurn(startTurn(initialState(), 'first', 0), 'second', 50).turns[0]).toMatchObject({ status: 'stopped', finishedAt: 50 })
  // With no turn open nothing is archived.
  expect(startTurn(initialState(), 'go', 0).turns).toEqual([])

  const idle = initialState()

  expect(forceArchive(idle, 5)).toBe(idle)
})

test('a session that ends is cleared, the archived turns too, and only the ON/OFF choice stays', async () => {
  const archived = settleTurn(finishTurn(startTurn(initialState(), 'old', 0), 'answer', 5), 5)
  const state = { ...spawned(startTurn(archived, 'go', 10), 'a1', 'one', 11), claudeRadarEnabled: false }

  expect(state.turns).toHaveLength(1)

  const fresh = resetSession(state)

  expect(fresh).toEqual({ ...initialState(), claudeRadarEnabled: false })
  expect(fresh.turns).toEqual([])
})

test('the pane rows read the status: mark, label, bar, activity (or Working) and whole task', async () => {
  const row = (state: ReturnType<typeof initialState>) => {
    const agent = agentsOf(state, 80_000)[0]!

    return `${agent.mark} ${agent.label} | ${agent.activity} | ${agent.time} | ${agent.bar}`
  }
  const base = spawned(initialState(), 'a1', 'x', 0)

  // At work or waiting the bar moves; once it ended it is full. The radar never invents a percentage.
  expect(row(base)).toBe('● Working | Working | 1m 20s | ███░░░░░░░')
  expect(row(workSubagent(base, 'a1', 'reading'))).toBe('● Working | Reading project files | 1m 20s | ███░░░░░░░')
  expect(row(askSubagent(base, 'a1'))).toBe('● Needs you | Working | 1m 20s | ███░░░░░░░')
  expect(row(finishSubagent(base, 'a1', 'answer', 5000))).toBe('✓ Done | Working | 5s | ██████████')
  expect(row(finishSubagent(base, 'a1', 'error', 5000))).toBe('✗ Failed | Working | 5s | ██████████')
  expect(row(finishSubagent(base, 'a1', 'aborted', 5000))).toBe('■ Stopped | Working | 5s | ██████████')
  expect(paneOf(startTurn(base, 'go', 0), 1, 3).current?.agents[0]?.bar).toBe(bar(null, 3))
  // The task shows whole, tidied of paths and code, and none when there is none.
  expect(agentsOf(spawned(initialState(), 'a1', 'x', 0, { task: 'Fix `foo()` in /src/a.ts please' }), 1)[0]?.task).toBe('Fix in please')
  expect(agentsOf(spawned(initialState(), 'a1', 'x', 0, { task: '/src/a.ts' }), 1)[0]?.task).toBeNull()
})

test('the pane view has the current run (main agent, checklist, subagents with their hierarchy) and the archived turns', async () => {
  expect(paneOf(initialState(), 0, 0)).toEqual({ isEmpty: true, current: null, turns: [] })

  let state = writeTodos(startTurn(initialState(), 'Build my landing page', 1000), [
    { content: 'Analyze', status: 'completed' },
    { content: 'Implement', status: 'in_progress' }
  ])

  state = stepModel(state, undefined, { model: 'claude-opus-4-5-20251101', effort: 'high' })
  state = spawned(state, 'a1', 'lead', 2000, { model: 'haiku', task: 'Review the login flow in /src/auth and the refresh token handling of the session store' })
  state = spawned(state, 'a2', 'helper', 3000, { parentId: 'a1', task: null })
  state = workSubagent(state, 'a2', 'testing')
  state = finishSubagent(spawned(state, 'a3', 'reviewer', 3500, { task: 'Review' }), 'a3', 'answer', 4000)

  const view = paneOf(state, 61_000, 0)

  expect(view.isEmpty).toBe(false)
  expect(view.turns).toEqual([])

  const current = view.current!

  expect(current).toMatchObject({ title: 'Build my landing page', reason: null, time: '1m 00s', tokens: null, tone: 'working', active: 2 })
  // The main agent: name, model and effort, the turn's time, a moving bar, the tasks done of the total, no tokens yet.
  expect(current.leader).toEqual({
    id: 'main',
    mark: '●',
    status: 'working',
    name: 'Main agent',
    time: '1m 00s',
    label: 'Working',
    detail: 'opus-4-5 · high',
    bar: '███░░░░░░░',
    tasks: '1/2',
    tokens: null
  })
  expect(current.tasks.map(row => row.name)).toEqual(['Analyze', 'Implement'])
  // Every subagent of the turn, at work or finished, the child under its parent.
  expect(current.agents.map(agent => [agent.name, agent.depth, agent.status, agent.activity])).toEqual([
    ['lead', 0, 'working', 'Working'],
    ['helper', 1, 'working', 'Running tests'],
    ['reviewer', 0, 'done', 'Working']
  ])
  expect(current.agents.map(agent => agent.detail)).toEqual(['haiku', null, null])
  expect(current.agents.map(agent => agent.bar)).toEqual(['███░░░░░░░', '███░░░░░░░', '██████████'])
  // The whole task, tidied and not cut at 40.
  expect(current.agents[0]?.task).toBe('Review the login flow in and the refresh token handling of the session store')
  expect(current.agents[0]!.task!.length).toBeGreaterThan(40)
  expect(current.agents[1]?.task).toBeNull()

  // The same in Spanish: the names come from the state, the words from the language.
  expect(paneOf(state, 61_000, 0, es).current?.leader.name).toBe('Agente principal')

  // Once everything ended the turn is archived, hierarchy and final states included.
  const ended = settleTurn(
    finishSubagent(finishSubagent(finishTurn(state, 'answer', 91_000), 'a1', 'answer', 92_000), 'a2', 'error', 93_000),
    93_000
  )
  const after = paneOf(ended, 999_000, 0)

  expect(after.isEmpty).toBe(false)
  expect(after.current).toBeNull()
  expect(after.turns).toHaveLength(1)
  expect(after.turns[0]).toMatchObject({ title: 'Build my landing page', status: 'done', mark: '✓', label: 'Done', time: '1m 32s' })
  expect(after.turns[0]?.leader).toMatchObject({ name: 'Main agent', detail: 'opus-4-5 · high', tasks: '1/2', time: '1m 30s', mark: '✓' })
  expect(after.turns[0]?.agents.map(agent => [agent.name, agent.depth, agent.label, agent.time])).toEqual([
    ['lead', 0, 'Done', '1m 30s'],
    ['helper', 1, 'Failed', '1m 30s'],
    ['reviewer', 0, 'Done', '0s']
  ])

  expect(paneButtonLabel(false)).toBe('[ ◧ Detail ]')
  expect(paneButtonLabel(true)).toBe('[ ◧ Close ]')
})

test('a turn without subagents or tasks is the main agent alone; the title falls back to the default', async () => {
  const ended = settleTurn(finishTurn(startTurn(initialState(), '', 0), 'aborted', 9000), 9000)
  const turn = paneOf(ended, 99_000, 0).turns[0]!

  expect(turn).toMatchObject({ title: 'Working on your request', status: 'stopped', mark: '■', label: 'Stopped', time: '9s' })
  expect(turn.agents).toEqual([])
  expect(turn.leader).toMatchObject({ name: 'Main agent', detail: null, tasks: null, mark: '■', label: 'Stopped' })
  expect(paneOf(ended, 99_000, 0, es).turns[0]).toMatchObject({ title: 'Trabajando en tu petición', label: 'Detenido' })
})

test('the turn is still working while a subagent works after the main agent ended, and waits when the subagent asks', async () => {
  const state = finishTurn(spawned(startTurn(initialState(), 'go', 0), 'a1', 'one', 10), 'answer', 1000)
  const current = paneOf(state, 5000, 0).current!

  // The main agent is done; the turn is not, and its time keeps running.
  expect(current).toMatchObject({ tone: 'working', time: '5s', mark: '●', isRunning: true, active: 1 })
  expect(current.leader).toMatchObject({ status: 'done', label: 'Done', time: '1s', bar: '██████████' })
  expect(paneOf(askSubagent(state, 'a1'), 5000, 0).current).toMatchObject({ reason: 'Waiting for your permission', tone: 'needsYou', active: 1 })
})

/** A `ui.open` / `ui.close` beneath the plugin, and the calls that reached them. */
const panes = (on: any, isPlaced = true, opened: unknown[] = [], calls: string[] = []) => {
  on('ui.open', (_: unknown, e: { id: string }) => {
    calls.push(`open ${e.id}`)
    opened.push(e)

    return { value: isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'no panes here' } } as never
  })
  on('ui.close', (_: unknown, e: { id: string }) => {
    calls.push(`close ${e.id}`)

    return { value: undefined } as never
  })

  return calls
}

test('the detail button opens the pane and closes it, and its label follows', async ($, on) => {
  const { calls, opened } = radar(on)
  const ui = await band($)

  expect(await ui.find({ type: 'Button', key: 'pane', text: /^\[ ◧ Detail \]$/ })).toBeDefined()
  expect(calls).toEqual([])

  await ui.press({ key: 'pane' })
  expect(calls).toEqual(['open agent-radar'])
  expect(opened[0]).toMatchObject({ id: 'agent-radar', title: 'Claude Radar', rows: 14, columns: 60 })
  expect(await ui.find({ type: 'Button', key: 'pane', text: /^\[ ◧ Close \]$/ })).toBeDefined()

  await ui.press({ key: 'pane' })
  expect(calls).toEqual(['open agent-radar', 'close agent-radar'])
  expect(await ui.find({ type: 'Button', key: 'pane', text: /^\[ ◧ Detail \]$/ })).toBeDefined()
  // The detail button sits to the left of the ON/OFF button.
  expect(await ui.find({ type: 'Button', key: 'toggle', text: /Claude Radar: ON/ })).toBeDefined()
  await ui.unmount()
})

test('the detail button shows before any turn and in the middle of work, and the pane never opens by itself', async ($, on) => {
  const clock = radar(on)
  const { calls } = clock

  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  on('tool.call', () => answered({ oldTodos: [], newTodos: [] }))
  on('session.end', () => ({ sessionId: 's' }) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const before = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await before.find({ type: 'Button', key: 'pane' })).toBeDefined()
  await before.unmount()

  await begin($)
  await $.tool.call({ tool: 'TodoWrite', todos: todos(['Step', 'in_progress']) })
  await spawn($, 'frontend-developer')
  await finish($, 'answer', 'a1')
  await finish($)
  await clock.advance(10 * MS)

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Button', key: 'pane' })).toBeDefined()
  await ui.unmount()
  await $.session.end({ sessionId: 's' } as never)
  expect(calls).toEqual([])
})

test('a surface that places no panes gets a toast, and no pane is left waiting', async ($, on) => {
  const toasts: string[] = []
  const { calls } = radar(on, undefined, toasts, false)
  const ui = await band($)

  await ui.press({ key: 'pane' })
  expect(calls).toEqual(['open agent-radar', 'close agent-radar'])
  expect(toasts).toEqual(['The detail pane is not available here: no panes here'])
  expect(await ui.find({ type: 'Button', key: 'pane', text: /Detail/ })).toBeDefined()
  await ui.unmount()
})

test('OFF closes the pane and leaves only the ON/OFF button; ON brings the detail button back', async ($, on) => {
  const { calls } = radar(on)
  const ui = await band($)

  await ui.press({ key: 'pane' })
  await ui.press({ key: 'toggle' })
  expect(calls).toEqual(['open agent-radar', 'close agent-radar'])
  expect(await ui.find({ type: 'Button', key: 'pane' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'toggle', text: /Claude Radar: OFF/ })).toBeDefined()

  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Button', key: 'pane', text: /Detail/ })).toBeDefined()
  // OFF with the pane already closed asks nothing more of the engine.
  await ui.press({ key: 'toggle' })
  expect(calls).toEqual(['open agent-radar', 'close agent-radar'])
  await ui.unmount()
})

test('the pane says there is nothing running yet when there is nothing', async ($, on) => {
  radar(on)

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /^Nothing running yet$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^History$/ })).toBeUndefined()
  await ui.unmount()
})

test('the pane draws the turn, the whole checklist, the subagents at work and the history', async ($, on) => {
  const clock = squad(on, 'a1', 'a2', 'a3')

  await begin($)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: todos(['Analyze project structure', 'completed'], ['Implement authentication', 'in_progress'], ['Run final tests', 'pending'])
  })
  await spawn($, 'frontend-developer', 'Building the login components /src/ui')
  await spawn($, 'backend-developer', 'Reviewing authentication routes', { parentAgentId: 'a1' })
  await spawn($, 'code-reviewer', 'Reviewing the diff')
  await clock.advance(45 * MS)
  await finish($, 'error', 'a3')
  await $.tool.call({ tool: 'Read', file_path: '/secret/x.ts', agentId: 'a1' } as never)

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /^Current run$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Build my landing page$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Main agent$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1\/3$/ })).toBeDefined()
  for (const name of [/^Analyze project structure$/, /^Implement authentication$/, /^Run final tests$/]) {
    expect(await ui.find({ type: 'Text', text: name })).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: /^██████████$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^░░░░░░░░░░$/ })).toBeDefined()

  // The subagents of the turn: the finished one stays in the run, with its final state.
  expect(await ui.find({ type: 'Text', text: /^frontend-developer$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^backend-developer$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^code-reviewer$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Building the login components$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Reading project files$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Reviewing the diff$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Failed$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^✗$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^45s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /secret|\/src/ })).toBeUndefined()
  // The one under another is indented.
  expect(await ui.findAll({ type: 'Box', props: { paddingLeft: 2 } } as never)).not.toHaveLength(0)

  // Nothing has ended as a turn yet.
  expect(await ui.find({ type: 'Text', text: /^History$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^No finished turns yet$/ })).toBeDefined()

  // However long it goes on, the finished one is still in the run.
  await clock.advance(10 * MS)
  expect(await ui.find({ type: 'Text', text: /^code-reviewer$/ })).toBeDefined()
  await ui.unmount()
})

test('the pane draws both sections on both surfaces and in both languages, with the main agent by name', async ($, on) => {
  radar(on)
  on('session.end', () => ({ sessionId: 's' }) as never)

  let language = 'English'

  on('settings.read', () => ({ value: { language } }) as never)

  const words = {
    English: { run: /^Current run$/, main: /^Main agent$/, history: /^History$/, ready: /^All done, ready for more instructions$/, none: /^No finished turns yet$/, nothing: /^Nothing running yet$/ },
    Español: { run: /^Ejecución actual$/, main: /^Agente principal$/, history: /^Historial$/, ready: /^Todo listo, esperando instrucciones$/, none: /^Aún no hay turnos terminados$/, nothing: /^Aún no hay nada en marcha$/ }
  }

  for (const lang of ['English', 'Español'] as const) {
    language = lang
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

    const w = words[lang]

    for (const surface of ['terminal', 'desktop'] as const) {
      // Before anything: one message.
      const empty = await paneView($, 60, surface)

      expect(await empty.find({ type: 'Text', text: w.nothing })).toBeDefined()
      expect(await empty.find({ type: 'Text', text: w.run })).toBeUndefined()
      await empty.unmount()
    }

    await begin($)

    for (const surface of ['terminal', 'desktop'] as const) {
      const running = await paneView($, 60, surface)

      expect(await running.find({ type: 'Text', text: w.run })).toBeDefined()
      expect(await running.find({ type: 'Text', text: w.main })).toBeDefined()
      expect(await running.find({ type: 'Text', text: w.history })).toBeDefined()
      expect(await running.find({ type: 'Text', text: w.none })).toBeDefined()
      expect(await running.find({ type: 'Text', text: w.ready })).toBeUndefined()
      await running.unmount()
    }

    await finish($)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ready = await paneView($, 60, surface)

      expect(await ready.find({ type: 'Text', text: w.run })).toBeDefined()
      expect(await ready.find({ type: 'Text', text: w.ready })).toBeDefined()
      expect(await ready.find({ type: 'Text', text: w.history })).toBeDefined()
      expect(await ready.find({ type: 'Text', text: w.main })).toBeDefined()
      expect(await ready.find({ type: 'Text', text: w.none })).toBeUndefined()
      await ready.unmount()
    }

    await $.session.end({ sessionId: 's' } as never)
  }
})

test('the history groups each turn: its title, final state and duration, the main agent and the subagents', async ($, on) => {
  const clock = squad(on, 'a1', 'a2')

  on('turn.step', async function* ($: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
  })

  // The first turn has a main agent only.
  await begin($, 'quick question')
  await clock.advance(12 * MS)
  await finish($)

  // The second one has two subagents and a checklist.
  await begin($, 'Build my landing page')
  await $.tool.call({ tool: 'TodoWrite', todos: todos(['Analyze', 'completed'], ['Implement', 'completed'], ['Test', 'pending']) })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-4-5-20251101', effort: 'high', messageCount: 1 } as never)) {
    // The chunks are not the radar's concern.
  }
  await spawn($, 'frontend-developer', 'Building the login components')
  await spawn($, 'code-reviewer', 'Reviewing the diff')
  await clock.advance(45 * MS)
  await finish($, 'error', 'a2')
  await clock.advance(15 * MS)
  await finish($, 'answer', 'a1')
  await finish($)

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /^History$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2 runs$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^All done, ready for more instructions$/ })).toBeDefined()

  // Most recent first.
  const titles = (await ui.findAll({ type: 'Text', text: /^(Quick question|Build my landing page)$/ })).map((node: { text: string }) => node.text)

  expect(titles).toEqual(['Build my landing page', 'Quick question'])
  // The long turn: one minute (the header, the main agent and the first subagent), its main agent with model and tasks, and its two subagents in their final state.
  expect(await ui.findAll({ type: 'Text', text: /^1m 00s$/ })).toHaveLength(3)
  expect(await ui.find({ type: 'Text', text: /opus-4-5 · high/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2\/3$/ })).toBeDefined()
  // The subagents' tasks under their names, and their final state in their rows (the groups' own states are the other Done).
  expect(await ui.find({ type: 'Text', text: /^Building the login components$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Reviewing the diff$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^Done$/ })).toHaveLength(3)
  expect(await ui.findAll({ type: 'Text', text: /^Failed$/ })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /^45s$/ })).toBeDefined()
  // The short one has the main agent alone: no subagent rows, no tasks.
  expect(await ui.findAll({ type: 'Text', text: /^12s$/ })).toHaveLength(2)
  expect(await ui.findAll({ type: 'Text', text: /^Main agent$/ })).toHaveLength(2)
  expect(await ui.findAll({ type: 'Text', text: /^(frontend-developer|code-reviewer)$/ })).toHaveLength(2)
  // Nothing of the archived turns' checklist is drawn.
  expect(await ui.find({ type: 'Text', text: /^Analyze$/ })).toBeUndefined()
  await ui.unmount()
})

test('the pane fits its width: no bars when narrow, every name cut with an ellipsis and none wider than the body', async ($, on) => {
  squad(on, 'a1')
  await begin($)
  await $.tool.call({ tool: 'TodoWrite', todos: todos(['Implement a very long authentication flow with tokens', 'in_progress']) })
  await spawn($, 'a-very-long-custom-agent-name-for-the-frontend', 'A long delegated task that goes on and on')

  const narrow = await paneView($, 24)

  expect(await narrow.find({ type: 'Text', text: /[█░]/ })).toBeUndefined()

  for (const text of await narrow.findAll({ type: 'Text', text: /agent-name|authentication|delegated/ })) {
    expect(text.props?.wrap).toBe('truncate-end')
  }
  await narrow.unmount()

  const wide = await paneView($, 80)

  expect(await wide.find({ type: 'Text', text: /[█░]{10}/ })).toBeDefined()
  await wide.unmount()
})

test('the desktop surface draws the pane too, and it only reads: the state is as it was', async ($, on) => {
  squad(on, 'a1')
  await begin($)
  await spawn($, 'frontend-developer')

  const ui = await $.ui.mount({
    plugin: 'agent-radar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'agent-radar',
    props: { title: 'Claude Radar', isFocused: false, bodyColumns: 60, placement: 'dock' } as never
  } as never)

  expect(await ui.find({ type: 'Text', text: /^Current run$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Main agent$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^frontend-developer$/ })).toBeDefined()
  await ui.unmount()

  const again = await mount($)

  expect(await again.find({ type: 'Text', text: /^frontend-developer$/ })).toBeDefined()
  expect(await again.findAll({ type: 'Text', text: /^Working$/ })).toHaveLength(4)
  await again.unmount()
})


test('a model id is shortened: the prefix, the date and the context mark go; an alias stays', () => {
  expect(shortModel('claude-opus-4-5-20251101')).toBe('opus-4-5')
  expect(shortModel('claude-sonnet-5-5')).toBe('sonnet-5-5')
  expect(shortModel('claude-opus-5-5[1m]')).toBe('opus-5-5')
  expect(shortModel('us.anthropic.claude-haiku-5-5-20260101')).toBe('haiku-5-5')
  expect(shortModel('haiku')).toBe('haiku')
})

test('the detail is the short model and the effort when there is one; nothing known gives null', () => {
  expect(detailOf(undefined)).toBeNull()
  expect(detailOf({ model: 'claude-opus-4-5-20251101', effort: 'high' })).toBe('opus-4-5 · high')
  expect(detailOf({ model: 'haiku', effort: null })).toBe('haiku')
})

test('a model request sets the main agent model and effort; the same one changes nothing', () => {
  const info = { model: 'claude-opus-4-5', effort: 'high' }
  const state = stepModel(startTurn(initialState(), 'go', 0), undefined, info)

  expect(state.leaderModel).toEqual(info)
  expect(stepModel(state, undefined, { ...info })).toBe(state)
  expect(paneOf(state, 1000, 0, TEXTS.en).current?.leader.detail).toBe('opus-4-5 · high')
  expect(stepModel(state, undefined, { model: 'claude-opus-4-5', effort: 'low' }).leaderModel?.effort).toBe('low')
})

test('a subagent starts with the model of its spawn and takes the effort from its requests; one not followed changes nothing', () => {
  let state = spawned(initialState(), 'a1', 'Explore', 0, { model: 'haiku' })

  expect(agentsOf(state, 1000)[0]?.detail).toBe('haiku')

  state = stepModel(state, 'a1', { model: 'claude-haiku-5-5-20260101', effort: 'low' })
  expect(agentsOf(state, 1000)[0]?.detail).toBe('haiku-5-5 · low')
  expect(stepModel(state, 'zz', { model: 'x', effort: null })).toBe(state)
  expect(state.leaderModel).toBeUndefined()
})

test('a session that ends forgets the models', () => {
  const state = stepModel(initialState(), undefined, { model: 'opus', effort: 'high' })

  expect(resetSession(state).leaderModel).toBeUndefined()
})

test('the hook on turn.step records the model, the effort and the tokens of the main agent and of a subagent, and lets the request go on', async ($, on) => {
  squad(on, 'a1')

  const answers: unknown[] = []

  on('turn.step', async function* ($: any, e: any) {
    // The usage a request reports: 1 000 + 200 + 34 count; the 9 000 the cache served do not.
    const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 9000, cache_creation_input_tokens: 34, model: e.model }
    const answer = { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }

    answers.push(answer)

    return answer as never
  })

  await begin($)
  await spawn($, 'Explore')

  const results: unknown[] = []

  for (const input of [
    { turnId: 't', index: 0, model: 'claude-opus-4-5-20251101', effort: 'high', messageCount: 1 },
    { turnId: 'u', index: 0, model: 'haiku', effort: 'low', messageCount: 1, agentId: 'a1' }
  ]) {
    const stream = $.turn.step(input as never)

    // The chunks are not the radar's concern; the generator's return value is the result.
    for (;;) {
      const next = await stream.next()

      if (next.done) {
        results.push(next.value)
        break
      }
    }
  }

  // Each result goes up exactly as the engine gave it, `usage` included.
  expect(results).toEqual(answers)

  const view = await paneView($)

  expect(await view.find({ type: 'Text', text: /opus-4-5 · high/ })).toBeDefined()
  expect(await view.find({ type: 'Text', text: /haiku · low/ })).toBeDefined()
  // 1 234 for each of the two agents: 2.5k in all (2 468).
  expect(await view.findAll({ type: 'Text', text: /^1\.2k$/ })).toHaveLength(2)
  expect(await view.find({ type: 'Text', text: /· 2\.5k tokens$/ })).toBeDefined()
  await view.unmount()
})

/** Remembers the radar state each write leaves, so a test can look at it. */
const track = (on: any) => {
  const box: { state: ReturnType<typeof initialState> } = { state: initialState() }

  on('state.set', (_: unknown, e: { key: string; value: unknown }, next: (e: unknown) => unknown) => {
    if (e.key === 'claudeRadarState') box.state = e.value as never

    return next(e)
  })

  return box
}

test('a subagent starting its own turn does not split the turn of the person', async ($, on) => {
  squad(on, 'a1')

  const box = track(on)

  await begin($, 'Build my landing page')
  await spawn($, 'Explore')
  await $.turn.start({ text: 'Look for the login code', turnId: 'u', agentId: 'a1' })

  const state = box.state

  expect(state.turns).toEqual([])
  expect(state.checklist.title).toBe('Build my landing page')
  expect(Object.keys(state.subagents)).toEqual(['a1'])
})

test('cutting the turn off archives it at once as stopped, and the subagents still at work stop with it', async ($, on) => {
  squad(on, 'a1')

  const box = track(on)

  await begin($)
  await spawn($, 'Explore')
  await finish($, 'aborted')

  const state = box.state

  expect(state.turns).toHaveLength(1)
  expect(state.turns[0]).toMatchObject({ status: 'stopped' })
  expect(state.turns[0]?.agents.map(agent => agent.status)).toEqual(['stopped'])
  expect(state.subagents).toEqual({})
})

test('tokensOf adds the input, the output and what was written to the cache, and leaves out what the cache served', () => {
  expect(tokensOf({ input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 30 })).toBe(180)
  // `cache_read_input_tokens` is a field of the API's usage and is not counted.
  expect(tokensOf({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 30 } as never)).toBe(180)
  // Nothing reported, or a count missing, reads as zero.
  expect(tokensOf(null)).toBe(0)
  expect(tokensOf(undefined)).toBe(0)
  expect(tokensOf({ output_tokens: 7 })).toBe(7)
  expect(tokensOf({ input_tokens: Number.NaN, output_tokens: -4, cache_creation_input_tokens: 2 })).toBe(2)
})

test('compactTokens writes a figure short: whole under 1000, one decimal under 100k, whole from 100k, millions after', () => {
  const cases: [number, string][] = [
    [0, '0'],
    [850, '850'],
    [999, '999'],
    [1000, '1k'],
    [1234, '1.2k'],
    [9949, '9.9k'],
    [18_400, '18.4k'],
    [99_949, '99.9k'],
    [99_960, '100k'],
    [150_000, '150k'],
    [999_499, '999k'],
    [999_500, '1M'],
    [1_200_000, '1.2M'],
    [12_345_678, '12.3M'],
    [123_456_789, '123M']
  ]

  for (const [figure, text] of cases) expect(compactTokens(figure)).toBe(text)

  // Nothing sensible to write reads as zero.
  expect(compactTokens(Number.NaN)).toBe('0')
  expect(compactTokens(-5)).toBe('0')
})

test('addTokens adds to the main agent or to a followed subagent; nothing to add, or an agent not followed, changes nothing', () => {
  const state = spawned(startTurn(initialState(), 'go', 0), 'a1')

  for (const n of [0, -3, Number.NaN]) {
    expect(addTokens(state, undefined, n)).toBe(state)
    expect(addTokens(state, 'a1', n)).toBe(state)
  }
  expect(addTokens(state, 'zz', 100)).toBe(state)
  // An inherited name is not an agent.
  expect(addTokens(state, 'toString', 100)).toBe(state)

  const main = addTokens(addTokens(state, undefined, 100), undefined, 50)

  expect(main.leaderTokens).toBe(150)
  expect(main.subagents['a1']?.tokens).toBeUndefined()

  const sub = addTokens(addTokens(main, 'a1', 40), 'a1', 2)

  expect(sub.subagents['a1']?.tokens).toBe(42)
  expect(sub.leaderTokens).toBe(150)
  // The original is not touched.
  expect(state.leaderTokens).toBeUndefined()
})

test('the turn counts the tokens of the main agent and of every subagent, shows them short and keeps them in the archive', () => {
  let state = spawned(spawned(startTurn(initialState(), 'go', 0), 'a1', 'one', 10), 'a2', 'two', 20)

  state = addTokens(addTokens(addTokens(state, undefined, 230), 'a1', 1234), 'a2', 18_400)

  const current = paneOf(state, 1000, 0).current!

  // The turn's total is the main agent's plus the subagents'; each row has its own.
  expect(current.tokens).toBe('19.9k')
  expect(current.leader.tokens).toBe('230')
  expect(current.agents.map(agent => agent.tokens)).toEqual(['1.2k', '18.4k'])
  // No tokens yet: nothing to show.
  expect(paneOf(startTurn(initialState(), 'go', 0), 1000, 0).current).toMatchObject({ tokens: null, leader: { tokens: null } })

  const settled = settleTurn(finishSubagent(finishSubagent(finishTurn(state, 'answer', 500), 'a1', 'answer', 600), 'a2', 'answer', 700), 700)

  expect(settled.turns[0]).toMatchObject({ tokens: 19_864, leader: { tokens: 230 } })
  expect(settled.turns[0]?.agents.map(agent => agent.tokens)).toEqual([1234, 18_400])
  // The current turn starts over without them.
  expect(settled.leaderTokens).toBeUndefined()
  expect(settled.subagents).toEqual({})

  const turn = paneOf(settled, 1000, 0).turns[0]!

  expect(turn.tokens).toBe('19.9k')
  expect(turn.leader.tokens).toBe('230')
  expect(turn.agents.map(agent => agent.tokens)).toEqual(['1.2k', '18.4k'])
})

test('every turn starts its count of the main agent from zero, and a session that ends forgets it', () => {
  const counted = addTokens(startTurn(initialState(), 'first', 0), undefined, 500)

  // A new turn archives the open one with its tokens and begins empty.
  const next = startTurn(counted, 'second', 10)

  expect(next.leaderTokens).toBeUndefined()
  expect(next.turns[0]).toMatchObject({ title: 'First', tokens: 500, leader: { tokens: 500 } })
  // Tokens that arrive with no turn open still start the next one from zero.
  expect(startTurn(addTokens(initialState(), undefined, 40), 'go', 0).leaderTokens).toBeUndefined()
  expect(resetSession(counted)).toEqual(initialState())
})

/** A model response as the engine gives it, with the usage of the request. */
const response = (e: { turnId: string; index: number }, usage: object | null) =>
  ({ turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }) as never

/** The usage the API reports for a request: the cache read is large on purpose, it must not count. */
const usageOf = (input: number, output: number, cacheWrite: number) =>
  ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 50_000, cache_creation_input_tokens: cacheWrite, model: 'claude-opus-4-5' }) as const

/** One model request through the chain, to the end; resolves with the result the chain gives back. */
const step = async ($: any, agentId?: string) => {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-4-5', effort: 'high', messageCount: 1, agentId } as never)

  // The chunks are not the radar's concern; the value the generator returns is the result.
  for (;;) {
    const next = await stream.next()

    if (next.done) return next.value
  }
}

test('the hook on turn.step adds up the tokens of the main agent, of a subagent and of one that came before its spawn, and returns the result as it came', async ($, on) => {
  const clock = squad(on, 'a1')
  let usage: object | null = null
  let raw: unknown

  on('turn.step', async function* ($: any, e: any) {
    raw = response(e, usage)

    return raw as never
  })

  await begin($)

  // Two requests of the main agent: 100 + 10 + 5 each, the 50 000 the cache served left out.
  usage = usageOf(100, 10, 5)
  expect(await step($)).toEqual(raw)
  await step($)

  // A request of a subagent whose spawn has not been answered yet, and of one the radar will never see spawn.
  usage = usageOf(200, 10, 5)
  await step($, 'a1')
  await step($, 'zz')
  await spawn($, 'frontend-developer')
  // Another one once it is listed.
  usage = usageOf(20, 10, 5)
  await step($, 'a1')
  // A response that carries no usage adds nothing.
  usage = null
  await step($)
  await step($, 'a1')

  // The turn's own `usage` (turn.complete) is not read: the steps already added up to it.
  await $.turn.complete({
    answer: 'done',
    durationMs: 0,
    isAborted: false,
    turnId: 't',
    reason: 'answer',
    usage: usageOf(5000, 5000, 5000)
  } as never)
  await clock.advance(216 * MS)

  const ui = await paneView($)

  // 230 for the main agent, 250 for the subagent: 480 in all.
  expect(await ui.find({ type: 'Text', text: /^Total time · 3m 36s · 480 tokens$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^230$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^250$/ })).toBeDefined()
  // The model and effort of the early request reached the subagent too.
  expect(await ui.find({ type: 'Text', text: /opus-4-5 · high/ })).toBeDefined()
  await ui.unmount()

  // The subagent ends and the turn is archived with the same figures.
  await finish($, 'answer', 'a1')

  const history = await paneView($)

  expect(await history.find({ type: 'Text', text: /^480 tokens$/ })).toBeDefined()
  expect(await history.find({ type: 'Text', text: /^230$/ })).toBeDefined()
  expect(await history.find({ type: 'Text', text: /^250$/ })).toBeDefined()
  await history.unmount()
})

test('the main agent starts counting again with each turn, and a response with no usage adds nothing', async ($, on) => {
  squad(on, 'a1')

  const box = track(on)
  let usage: object | null = usageOf(10, 10, 10)

  on('turn.step', async function* ($: any, e: any) {
    return response(e, usage)
  })

  await begin($)
  await step($)
  expect(box.state.leaderTokens).toBe(30)

  // A second turn begins from zero; the first one is in the archive with its 30.
  await finish($)
  await begin($, 'second job')
  expect(box.state.leaderTokens).toBeUndefined()
  expect(box.state.turns[0]).toMatchObject({ tokens: 30 })

  usage = null
  await step($)
  expect(box.state.leaderTokens).toBeUndefined()
})

test('the pane draws the heading, the total time and tokens, the active count, the rows and the rules, on both surfaces and in both languages', async ($, on) => {
  const clock = squad(on, 'a1', 'a2', 'b1', 'b2')
  let language = 'English'
  let usage: object | null = null

  on('session.end', () => ({ sessionId: 's' }) as never)
  on('settings.read', () => ({ value: { language } }) as never)
  on('turn.step', async function* ($: any, e: any) {
    return response(e, usage)
  })

  const words = {
    English: { run: /^Current run$/, total: /^Total time · 3m 36s · 19\.9k tokens$/, subagents: /^Subagents$/, active: /^2 active$/, runs: /^1 run$/, none: /^No finished turns yet$/, reading: /^Reading project files$/ },
    Español: { run: /^Ejecución actual$/, total: /^Tiempo total · 3m 36s · 19\.9k tokens$/, subagents: /^Subagentes$/, active: /^2 activos$/, runs: /^1 ejecución$/, none: /^Aún no hay turnos terminados$/, reading: /^Leyendo archivos del proyecto$/ }
  }

  for (const [round, lang] of (['English', 'Español'] as const).entries()) {
    language = lang
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

    const w = words[lang]
    const [lead, helper] = round === 0 ? ['a1', 'a2'] : ['b1', 'b2']

    await begin($, 'Build my landing page')
    await spawn($, 'frontend-developer', 'Building the login components')
    await spawn($, 'backend-developer', 'Reviewing authentication routes', { parentAgentId: lead })
    // The main agent 230 tokens, the lead 1 234, the helper 18 400: 19 864 in all.
    usage = usageOf(200, 26, 4)
    await step($)
    usage = usageOf(1200, 30, 4)
    await step($, lead)
    usage = usageOf(18_000, 395, 5)
    await step($, helper)
    await $.tool.call({ tool: 'Read', file_path: '/secret/x.ts', agentId: lead } as never)
    await clock.advance(216 * MS)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await paneView($, 60, surface)

      // The heading: a green dot, the title at the left, the total time and tokens at the right.
      const mark = (await ui.findAll({ type: 'Text', text: /^●$/ }))[0]

      expect(mark?.props?.color).toBe('#22c55e')
      expect(mark?.props?.dimColor).not.toBe(true)
      expect(await ui.find({ type: 'Text', text: w.run })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: w.total })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Build my landing page$/ })).toBeDefined()
      // The block of the subagents, with the ones at work counted at the right.
      expect(await ui.find({ type: 'Text', text: w.subagents })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: w.active })).toBeDefined()
      // The rows, each with its own tokens, short.
      expect(await ui.find({ type: 'Text', text: /^230$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^1\.2k$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^18\.4k$/ })).toBeDefined()
      // The task of a subagent and its activity, each in its own line; the child is indented under its parent.
      expect(await ui.find({ type: 'Text', text: /^Building the login components$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Reviewing authentication routes$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: w.reading })).toBeDefined()
      expect(await ui.findAll({ type: 'Box', props: { paddingLeft: 2 } } as never)).not.toHaveLength(0)

      // The rules: before the subagents and between them (the run and the history are apart by a blank row); each cut to the width.
      const rules = await ui.findAll({ type: 'Text', text: /^─+$/ })

      expect(rules).toHaveLength(2)

      for (const rule of rules) {
        expect(rule.props?.wrap).toBe('truncate-end')
        expect(rule.props?.dimColor).toBe(true)
        expect(rule.text.length).toBeLessThanOrEqual(60)
      }
      expect(Math.max(...rules.map((rule: { text: string }) => rule.text.length))).toBe(58)
      expect(await ui.find({ type: 'Text', text: w.none })).toBeDefined()
      await ui.unmount()
    }

    // Everything ends: the group of the history is open, with the figures of the turn and of each agent.
    await finish($, 'answer', lead)
    await finish($, 'answer', helper)
    await finish($)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await paneView($, 60, surface)

      expect(await ui.find({ type: 'Text', text: w.runs })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^19\.9k tokens$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^230$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^1\.2k$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^18\.4k$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Building the login components$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Reviewing authentication routes$/ })).toBeDefined()
      // No rule at all: the run and the history are apart by a blank row, and the one group has none above it.
      expect(await ui.findAll({ type: 'Text', text: /^─+$/ })).toHaveLength(0)
      // Nothing runs any more: no activity line is left, and the run is back to waiting.
      expect(await ui.find({ type: 'Text', text: w.reading })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: w.none })).toBeUndefined()
      await ui.unmount()
    }

    await $.session.end({ sessionId: 's' } as never)
  }
})

test('the heading dot pulses with the timer while anything runs, and stands still once it ended', async ($, on) => {
  const clock = squad(on, 'a1')

  await begin($)
  await spawn($, 'one')

  const opener = await openPane($)
  const ui = await paneView($)
  const dot = async () => (await ui.findAll({ type: 'Text', text: /^●$/ }))[0]

  expect((await dot())?.props?.dimColor).not.toBe(true)
  await clock.advance(250)
  expect((await dot())?.props?.dimColor).toBe(true)
  await clock.advance(250)
  expect((await dot())?.props?.dimColor).not.toBe(true)
  await ui.unmount()
  await opener.unmount()
})

test('a narrow pane drops the tokens, then the status labels, then the bars; the rules and the names are cut to the width', async ($, on) => {
  squad(on, 'a1')

  let usage: object | null = usageOf(200, 26, 4)

  on('turn.step', async function* ($: any, e: any) {
    return response(e, usage)
  })

  await begin($, 'Build my landing page')
  await spawn($, 'a-very-long-custom-agent-name-for-the-frontend', 'A long delegated task')
  await step($)
  await step($, 'a1')
  await finish($, 'answer', 'a1')
  usage = null

  const shows = async (columns: number) => {
    const ui = await paneView($, columns)
    const seen = {
      tokens: (await ui.find({ type: 'Text', text: /^230$/ })) !== undefined,
      headerTokens: (await ui.find({ type: 'Text', text: /tokens$/ })) !== undefined,
      label: (await ui.find({ type: 'Text', text: /^Done$/ })) !== undefined,
      bar: (await ui.find({ type: 'Text', text: /^[█░]{10}$/ })) !== undefined,
      widest: Math.max(...(await ui.findAll({ type: 'Text', text: /^─+$/ })).map((rule: { text: string }) => rule.text.length))
    }

    for (const text of await ui.findAll({ type: 'Text', text: /agent-name|delegated|Build my/ })) expect(text.props?.wrap).toBe('truncate-end')
    await ui.unmount()

    return seen
  }

  expect(TOKENS_MIN_COLUMNS).toBeGreaterThan(STATUS_MIN_COLUMNS)
  expect(await shows(TOKENS_MIN_COLUMNS)).toMatchObject({ tokens: true, headerTokens: true, label: true, bar: true, widest: TOKENS_MIN_COLUMNS - 2 })
  expect(await shows(TOKENS_MIN_COLUMNS - 1)).toMatchObject({ tokens: false, headerTokens: false, label: true, bar: true })
  expect(await shows(STATUS_MIN_COLUMNS)).toMatchObject({ tokens: false, label: true })
  expect(await shows(STATUS_MIN_COLUMNS - 1)).toMatchObject({ tokens: false, label: false, widest: STATUS_MIN_COLUMNS - 3 })
  expect(await shows(24)).toMatchObject({ tokens: false, label: false, bar: false, widest: 22 })
})

test('each section title has a faint line under it, cut to the width', async ($, on) => {
  squad(on, 'a1')

  await begin($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await paneView($, 40, surface)
    const lines = await ui.findAll({ type: 'Text', text: /^╌+$/ })

    // One under «Current run», one under «History».
    expect(lines).toHaveLength(2)

    for (const line of lines) {
      expect(line.props?.wrap).toBe('truncate-end')
      expect(line.props?.dimColor).toBe(true)
      expect(line.text.length).toBe(40)
    }
    await ui.unmount()
  }
})
