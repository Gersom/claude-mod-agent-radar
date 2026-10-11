import { expect, mock, test } from 'claude-code/testing'

import {
  HISTORY_MAX,
  activityOf,
  addTask,
  advance,
  askSubagent,
  askUser,
  bar,
  didRun,
  elapsed,
  finishSubagent,
  finishTurn,
  hidesTools,
  initialState,
  isLive,
  layoutOf,
  normalizeActivity,
  paneButtonLabel as paneButtonLabelIn,
  paneOf as paneOfIn,
  pruneFinished,
  recordHistory,
  resetSession,
  resumeWork,
  rowsOf as rowsOfIn,
  spawnSubagent,
  startTurn,
  taskIdOf,
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

test('registers no slash command', async ($, on) => {
  const commands: unknown[] = []

  on('command.register', (_: unknown, e: unknown) => {
    commands.push(e)

    return { value: { command: 'x' } } as never
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  memory(on)
  mock.clock(on, { now: Date.now() })

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  expect(commands).toEqual([])
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

test('the timer has something to move while a turn works or waits, or any subagent is listed', async () => {
  const working = startTurn(initialState(), 'go', 0)
  const done = finishTurn(working, 'answer', 10_000)

  expect(isLive(initialState())).toBe(false)
  expect(isLive(working)).toBe(true)
  expect(isLive(askUser(working))).toBe(true)
  // A finished turn is frozen: the pane shows its last state and nothing moves.
  expect(isLive(done)).toBe(false)
  expect(isLive(finishTurn(working, 'error', 1))).toBe(false)

  expect(advance(done, 12_000)).toEqual({ ...done, tick: 1 })
  expect(advance(working, 999_999)).toEqual({ ...working, tick: 1 })
})

test('the pane reads the phase: title and time, needs you, stuck, stopped, all done', async () => {
  const working = startTurn(initialState(), 'Build my landing page', 1000)

  expect(paneOf(working, 156_000, 0).now).toEqual({
    title: 'Build my landing page',
    label: 'Working',
    reason: null,
    time: '2m 35s',
    tone: 'working'
  })
  expect(paneOf(askUser(working), 156_000, 0).now).toMatchObject({
    label: 'Needs you',
    reason: 'Waiting for your permission',
    tone: 'needsYou'
  })
  expect(paneOf(finishTurn(working, 'error', 5000), 999_000, 0).now).toMatchObject({
    label: 'Stuck',
    reason: 'The turn ended with an error',
    tone: 'stuck',
    time: '4s'
  })
  expect(paneOf(finishTurn(working, 'aborted', 5000), 999_000, 0).now).toMatchObject({ label: 'Stopped', reason: null, tone: 'stopped' })
  // The time freezes at the end: `now` no longer matters.
  expect(paneOf(finishTurn(working, 'answer', 191_000), 999_000, 0).now).toMatchObject({
    label: 'All done',
    reason: null,
    time: '3m 10s',
    tone: 'done'
  })
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

  on('ui.render', draw)
  on('session.start', ($: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.start', ($: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', ($: unknown, e: { answer: string }) => ({ text: e.answer }))
  memory(on)
  watchToasts(on, toasts)
  panes(on, isPlaced, opened, calls)

  return { ...mock.clock(on, { now: Date.now() }), calls, opened }
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

    expect(await ui.find({ type: 'Text', text: /^Now$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Build my landing page$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Working$/ })).toBeDefined()
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

test('a long title is cut by words', async ($, on) => {
  radar(on)
  await begin($, 'implement the authentication flow with refresh tokens and sessions in /src/auth')

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /^Implement the authentication flow with$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /refresh|\/src/ })).toBeUndefined()
  await ui.unmount()
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

test('all done shows the total time and the last state in the pane, and nothing folds', async ($, on) => {
  const clock = radar(on)

  on('tool.call', () => answered({ oldTodos: [], newTodos: [] }))

  await begin($)
  await $.tool.call({ tool: 'TodoWrite', todos: todos(['Analyze', 'completed'], ['Implement', 'pending']) })
  await clock.advance(190 * MS)
  await finish($)

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /^All done$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^3m 10s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Implement$/ })).toBeDefined()

  // The time is frozen at the end and the checklist stays, however long it takes.
  await clock.advance(60 * MS)
  expect(await ui.find({ type: 'Text', text: /^All done$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^3m 10s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Implement$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Analyze$/ })).toBeDefined()
  await ui.unmount()
})

test('a stopped or failed turn says so in the pane, with its reason, and stays', async ($, on) => {
  const clock = radar(on)

  await begin($)
  await finish($, 'aborted')

  const stopped = await paneView($)

  expect(await stopped.find({ type: 'Text', text: /^Stopped$/ })).toBeDefined()
  expect(await stopped.find({ type: 'Text', text: /^Build my landing page$/ })).toBeDefined()
  await stopped.unmount()

  await begin($)
  await finish($, 'error')

  const stuck = await paneView($)

  expect(await stuck.find({ type: 'Text', text: /^Stuck$/ })).toBeDefined()
  expect(await stuck.find({ type: 'Text', text: /The turn ended with an error/ })).toBeDefined()

  await clock.advance(30 * MS)
  expect(await stuck.find({ type: 'Text', text: /The turn ended with an error/ })).toBeDefined()
  await stuck.unmount()

  await begin($)
  await finish($, 'refusal')

  const refused = await paneView($)

  expect(await refused.find({ type: 'Text', text: /The model declined to answer/ })).toBeDefined()
  await refused.unmount()
})

test('a new turn replaces the last one in the pane, with nothing of it', async ($, on) => {
  const clock = radar(on)

  on('tool.call', () => answered({ oldTodos: [], newTodos: [] }))

  await begin($, 'first job')
  await $.tool.call({ tool: 'TodoWrite', todos: todos(['Old step', 'completed']) })
  await finish($)
  await clock.advance(6 * MS)
  await begin($, 'second job')

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /Second job/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Old step/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Working on your request/ })).toBeDefined()
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
  expect(await pane.find({ type: 'Text', text: /^All done$/ })).toBeDefined()
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

test('a turn that finished while OFF shows as it ended in the pane when it is back ON', async ($, on) => {
  const clock = radar(on)

  await begin($)

  const ui = await band($)

  await ui.press({ key: 'toggle' })
  await finish($)
  await clock.advance(30 * MS)
  await ui.press({ key: 'toggle' })

  const pane = await paneView($)

  expect(await pane.find({ type: 'Text', text: /^All done$/ })).toBeDefined()
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

test('a finished subagent leaves the live list after 5 seconds with the pane closed, and a late call does not bring it back', async ($, on) => {
  const clock = squad(on, 'a1', 'a2')

  await begin($)
  await spawn($, 'one')
  await spawn($, 'two')
  await finish($, 'answer', 'a1')
  await clock.advance(4 * MS)

  // Within the 5 seconds a new call revives it.
  await $.tool.call({ tool: 'Read', file_path: 'x', agentId: 'a1' } as never)

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /^2 active$/ })).toBeDefined()

  await finish($, 'answer', 'a1')
  expect(await ui.find({ type: 'Text', text: /^1 active$/ })).toBeDefined()
  await clock.advance(6 * MS)
  await $.tool.call({ tool: 'Read', file_path: 'x', agentId: 'a1' } as never)
  // Retired: it stays in the history, and a late call finds nobody to wake.
  expect(await ui.find({ type: 'Text', text: /^1 active$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^one$/ })).toHaveLength(1)
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
  const shape = (state: ReturnType<typeof initialState>) => paneOf(state, 9, 0).live.map(agent => [agent.name, agent.depth])
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

  // A parent that is not listed (the main loop's id, or one already retired): flat.
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
  expect(paneOf(done, 999_000, 0).history[0]?.time).toBe('3s')

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

test('finished subagents are retired after 5 seconds, and the timer lives while any is listed', async () => {
  let state = spawned(spawned(initialState(), 'a1', 'one', 0), 'a2', 'two', 0)

  expect(isLive(state)).toBe(true)

  state = finishSubagent(state, 'a1', 'answer', 10_000)
  expect(pruneFinished(state, 14_999)).toBe(state)
  expect(Object.keys(pruneFinished(state, 15_000).subagents)).toEqual(['a2'])
  // One still working is never retired, however long it takes.
  expect(Object.keys(pruneFinished(state, 999_999).subagents)).toEqual(['a2'])

  expect(isLive(pruneFinished(state, 15_000))).toBe(true)
  expect(advance(state, 15_000)).toMatchObject({ tick: 1, subagents: { a2: { status: 'working' } } })
  expect('a1' in advance(state, 15_000).subagents).toBe(false)

  const last = pruneFinished(finishSubagent(state, 'a2', 'error', 10_000), 15_000)

  expect(last.subagents).toEqual({})
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

  expect(await ui.find({ type: 'Text', text: /^Subagents$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1 active$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^frontend-developer$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^1m 20s$/ })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: /^Building login components$/ })).toBeDefined()
  // The main turn's label, the checklist's line, the subagent's activity and its status.
  expect(await ui.findAll({ type: 'Text', text: /^Working$/ })).toHaveLength(4)
  expect(await ui.find({ type: 'Text', text: /^●$/ })).toBeDefined()
  await ui.unmount()
})

test('a refused spawn adds nothing, and its answer goes through as it is', async ($, on) => {
  radar(on)
  on('agent.spawn', () => ({ deny: 'no' }) as never)

  await begin($)
  expect(await spawn($, 'Explore')).toEqual({ deny: 'no' })

  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /Subagents/ })).toBeUndefined()
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
  expect(await ui.find({ type: 'Text', text: /^2 active$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Reviewing the auth module$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Reviewing the billing module$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^30s$/ })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: /^0s$/ })).toBeDefined()

  // Finishing one leaves the other working; the finished one moves to the history.
  await finish($, 'answer', 'a1')
  expect(await ui.find({ type: 'Text', text: /^1 active$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Done · Reviewing the auth module$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^code-reviewer$/ })).toHaveLength(2)
  await ui.unmount()
})

test('the activity follows the tools of that subagent only', async ($, on) => {
  squad(on, 'a1', 'a2')

  await begin($)
  await spawn($, 'one', 'Task one')
  await spawn($, 'two', 'Task two')

  const ui = await mount($)

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

test('a subagent that ends moves to the history with its time frozen, and stays there', async ($, on) => {
  const clock = squad(on, 'a1')

  await begin($)
  await spawn($, 'frontend-developer')
  await clock.advance(65 * MS)

  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /^Subagents$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No finished subagents yet/ })).toBeDefined()

  await finish($, 'answer', 'a1')
  expect(await ui.find({ type: 'Text', text: /^Subagents$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^✓$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^frontend-developer$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Done · Building login components$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No finished subagents yet/ })).toBeUndefined()

  // The time is frozen at the end, and past the five seconds the history still has it.
  await clock.advance(30 * MS)
  expect(await ui.findAll({ type: 'Text', text: /^1m 05s$/ })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /^frontend-developer$/ })).toBeDefined()
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

  expect(await ui.find({ type: 'Text', text: /^Failed · / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^✗$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Stopped · / })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /^2 active$/ })).toBeDefined()
  // The main turn did not ask.
  expect(await ui.find({ type: 'Text', text: /Waiting for your permission/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Build my landing page$/ })).toBeDefined()

  await $.tool.call({ tool: 'Bash', command: 'rm x', agentId: 'a1' } as never)
  expect(await ui.find({ type: 'Text', text: /^Needs you$/ })).toBeUndefined()
  await ui.unmount()
})

test('the main turn ending does not close the subagents, nor they it', async ($, on) => {
  const clock = squad(on, 'a1')

  await begin($)
  await spawn($, 'frontend-developer')
  await finish($, 'answer')
  await clock.advance(6 * MS)

  // The main turn is over and stays so; the subagent, still working, stays in the list.
  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /^All done$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Subagents$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1 active$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^frontend-developer$/ })).toBeDefined()

  // Then it finishes; the main turn keeps its own end.
  await finish($, 'answer', 'a1')
  expect(await ui.find({ type: 'Text', text: /^1 active$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Done · / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^All done$/ })).toBeDefined()
  await ui.unmount()
})

test('the main turn is still running when a subagent ends, and the section is hidden without subagents', async ($, on) => {
  squad(on, 'a1')

  await begin($)

  const before = await mount($)

  expect(await before.find({ type: 'Text', text: /^Subagents$/ })).toBeUndefined()
  await before.unmount()

  await spawn($, 'one')
  await finish($, 'answer', 'a1')

  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /All done/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Build my landing page$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Subagents$/ })).toBeUndefined()
  await ui.unmount()
})

test('subagents alone, before any turn, are in the pane without a turn block', async ($, on) => {
  squad(on, 'a1')

  await spawn($, 'Explore', 'Mapping the repo')

  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /^Explore$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Now$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /All done/ })).toBeUndefined()
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

  // The main label, the checklist's line and the activity; the status joins them only when it fits.
  expect(await narrow.findAll({ type: 'Text', text: /^Working$/ })).toHaveLength(3)

  for (const text of await narrow.findAll({ type: 'Text', text: /agent-name|delegated/ })) {
    expect(text.props?.wrap).toBe('truncate-end')
  }
  await narrow.unmount()

  const wide = await mount($, 60)

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

  for (const text of [/^Ahora$/, /^Trabajando$/, /^Hecho\s*$/, /^En curso\s*$/, /^Siguiente\s*$/, /^Subagentes$/, /^1 activo$/, /^Historial$/]) {
    expect(await pane.find({ type: 'Text', text })).toBeDefined()
  }
  expect(await pane.find({ type: 'Text', text: /^Leyendo archivos del proyecto$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Falló · Reviewing the diff$/ })).toBeDefined()
  // What comes from the person's text or the agents' own names is not translated.
  for (const text of [/^Build my landing page$/, /^Analyze structure$/, /^frontend-developer$/, /^Building login components$/, /^code-reviewer$/]) {
    expect(await pane.find({ type: 'Text', text })).toBeDefined()
  }
  // None of the English words is left.
  expect(await pane.find({ type: 'Text', text: /^(Now|Working|Done|Next|Subagents|History|Failed)\b/ })).toBeUndefined()
  await pane.unmount()
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
  expect(await pane.find({ type: 'Text', text: /^Aún no hay subagentes terminados$/ })).toBeDefined()

  await finish($, 'error')
  expect(await pane.find({ type: 'Text', text: /^Atascado$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /El turno terminó con un error/ })).toBeDefined()

  await begin($)
  await finish($, 'refusal')
  expect(await pane.find({ type: 'Text', text: /El modelo se negó a responder/ })).toBeDefined()

  await begin($)
  await finish($, 'aborted')
  expect(await pane.find({ type: 'Text', text: /^Detenido$/ })).toBeDefined()

  await begin($)
  await finish($)
  expect(await pane.find({ type: 'Text', text: /^Todo listo$/ })).toBeDefined()
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

  expect(paneOf(state('reading'), 1, 0, es).live[0]?.activity).toBe('Leyendo archivos del proyecto')
  expect(paneOf(state('searching'), 1, 0, es).live[0]?.activity).toBe('Buscando información del proyecto')
  expect(paneOf(state('updating'), 1, 0, es).live[0]?.activity).toBe('Actualizando archivos del proyecto')
  expect(paneOf(state('testing'), 1, 0, es).live[0]?.activity).toBe('Ejecutando pruebas')
  expect(paneOf(state('command'), 1, 0, es).live[0]?.activity).toBe('Ejecutando un comando')
  expect(paneOf(state('delegating'), 1, 0, es).live[0]?.activity).toBe('Delegando trabajo')
  expect(paneOf(state(null), 1, 0, es).live[0]?.activity).toBe('Trabajando')
  expect(paneOf(state(null), 1, 0, en).live[0]?.activity).toBe('Working')
  // The same state, two languages.
  expect(paneOf(state('testing'), 1, 0, en).live[0]?.activity).toBe('Running tests')
})

test('without settings, with unreadable settings or with a language the radar lacks, everything is English', async ($, on) => {
  radar(on)
  on('settings.read', () => ({ value: { language: 'japanese' } }) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await begin($)

  const pane = await paneView($)

  expect(await pane.find({ type: 'Text', text: /^Now$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Working$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Ahora|Trabajando/ })).toBeUndefined()
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

  expect(await pane.find({ type: 'Text', text: /^Ahora$/ })).toBeDefined()
  expect(reads).toBe(1)

  // A change of the setting does not move the session that runs.
  language = 'English'
  await finish($)
  await begin($)
  expect(await pane.find({ type: 'Text', text: /^Ahora$/ })).toBeDefined()
  expect(reads).toBe(1)
  await ui.unmount()
  await pane.unmount()

  await $.session.end({ sessionId: 's' } as never)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await begin($)

  const next = await paneView($)

  expect(await next.find({ type: 'Text', text: /^Now$/ })).toBeDefined()
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
  const seen: string[] = []
  let spawns = 0

  // Every way the radar could cost tokens or add to the session: a tool, a command, an agent, a model call, a prompt, a message.
  for (const event of ['tool.register', 'command.register', 'agent.register', 'model.complete', 'prompt.submit', 'session.send', 'session.compact']) {
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
  // Both are over and the subagent is retired after 5 seconds; nothing writes the state from then on, the pane open or not.
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

const finishedAgent = (state: ReturnType<typeof initialState>, id: string, at: number, reason: 'answer' | 'error' | 'aborted' = 'answer') =>
  finishSubagent(spawned(state, id, `agent-${id}`, 0), id, reason, at)

test('a subagent that finishes goes into the history with its final state, the most recent first, one entry per id', async () => {
  let state = finishedAgent(initialState(), 'a1', 1000)

  state = finishedAgent(state, 'a2', 2000, 'error')
  state = finishedAgent(state, 'a3', 3000, 'aborted')

  expect(state.history.map(agent => [agent.id, agent.status, agent.finishedAt])).toEqual([
    ['a3', 'stopped', 3000],
    ['a2', 'failed', 2000],
    ['a1', 'done', 1000]
  ])
  // The band's list is as before: the history is another record.
  expect(Object.keys(state.subagents)).toEqual(['a1', 'a2', 'a3'])
  // A copy: later changes to the live entry do not rewrite it.
  expect(state.history[2]).not.toBe(state.subagents['a1'])
  expect(recordHistory(state.history, { ...state.history[2]!, status: 'failed' }).map(agent => agent.id)).toEqual(['a1', 'a3', 'a2'])
  expect(recordHistory(state.history, state.history[1]!)).toHaveLength(3)
})

test('the history keeps 50 at most, drops the oldest, and is not touched by an agent that is still working', async () => {
  let state = initialState()

  for (let i = 0; i < 53; i++) state = finishedAgent(state, `a${i}`, 1000 + i)

  expect(state.history).toHaveLength(HISTORY_MAX)
  expect(HISTORY_MAX).toBe(50)
  expect(state.history[0]?.id).toBe('a52')
  expect(state.history[49]?.id).toBe('a3')
  expect(new Set(state.history.map(agent => agent.id)).size).toBe(50)

  const busy = spawned(initialState(), 'b1')

  expect(busy.history).toEqual([])
  expect(workSubagent(busy, 'b1', 'testing').history).toEqual([])
})

test('retiring a finished subagent from the band keeps it in the history, once, and a revived one leaves it', async () => {
  const done = finishedAgent(initialState(), 'a1', 10_000)
  const retired = pruneFinished(done, 15_000)

  expect(retired.subagents).toEqual({})
  expect(retired.history.map(agent => agent.id)).toEqual(['a1'])
  // Retired by the timer with nothing recorded yet (the history was lost): recorded then, oldest first.
  const bare = { ...spawned(spawned(initialState(), 'x', 'x', 0), 'y', 'y', 0), history: [] }
  const ended = { ...bare, subagents: { x: { ...bare.subagents['x']!, status: 'done' as const, finishedAt: 9000 }, y: { ...bare.subagents['y']!, status: 'failed' as const, finishedAt: 8000 } } }

  expect(pruneFinished(ended, 20_000).history.map(agent => agent.id)).toEqual(['x', 'y'])
  expect(pruneFinished(done, 14_999)).toBe(done)

  const back = workSubagent(done, 'a1', 'reading')

  expect(back.history).toEqual([])
  expect(finishSubagent(back, 'a1', 'error', 20_000).history.map(agent => [agent.id, agent.status])).toEqual([['a1', 'failed']])
  // Finished twice in a row: still one entry.
  expect(finishSubagent(done, 'a1', 'error', 99_999).history).toBe(done.history)
})

test('a session that ends is cleared, the history too, and only the ON/OFF choice stays', async () => {
  const state = { ...finishedAgent(startTurn(initialState(), 'go', 0), 'a1', 1000), claudeRadarEnabled: false }
  const fresh = resetSession(state)

  expect(fresh).toEqual({ ...initialState(), claudeRadarEnabled: false })
  expect(fresh.history).toEqual([])
})

test('the pane rows read the status: mark, label, activity (or Working) and whole task', async () => {
  const row = (state: ReturnType<typeof initialState>) => {
    const agent = [...paneOf(state, 80_000, 0).live, ...paneOf(state, 80_000, 0).history][0]!

    return `${agent.mark} ${agent.label} | ${agent.activity} | ${agent.time}`
  }
  const base = spawned(initialState(), 'a1', 'x', 0)

  expect(row(base)).toBe('● Working | Working | 1m 20s')
  expect(row(workSubagent(base, 'a1', 'reading'))).toBe('● Working | Reading project files | 1m 20s')
  expect(row(askSubagent(base, 'a1'))).toBe('● Needs you | Working | 1m 20s')
  expect(row(finishSubagent(base, 'a1', 'answer', 5000))).toBe('✓ Done | Working | 5s')
  expect(row(finishSubagent(base, 'a1', 'error', 5000))).toBe('✗ Failed | Working | 5s')
  expect(row(finishSubagent(base, 'a1', 'aborted', 5000))).toBe('■ Stopped | Working | 5s')
  // The task shows whole, tidied of paths and code, and none when there is none.
  expect(paneOf(spawned(initialState(), 'a1', 'x', 0, { task: 'Fix `foo()` in /src/a.ts please' }), 1, 0).live[0]?.task).toBe('Fix in please')
  expect(paneOf(spawned(initialState(), 'a1', 'x', 0, { task: '/src/a.ts' }), 1, 0).live[0]?.task).toBeNull()
})

test('the pane view has the turn, its whole checklist, the subagents at work with their hierarchy, and the history', async () => {
  expect(paneOf(initialState(), 0, 0)).toMatchObject({ isEmpty: true, now: null, tasks: [], live: [], history: [] })

  let state = writeTodos(startTurn(initialState(), 'Build my landing page', 1000), [
    { content: 'Analyze', status: 'completed' },
    { content: 'Implement', status: 'in_progress' }
  ])

  state = spawned(state, 'a1', 'lead', 2000, { task: 'Review the login flow in /src/auth and the refresh token handling of the session store' })
  state = spawned(state, 'a2', 'helper', 3000, { parentId: 'a1', task: null })
  state = workSubagent(state, 'a2', 'testing')
  state = finishedAgent(state, 'a3', 4000)

  const view = paneOf(state, 61_000, 0)

  expect(view.isEmpty).toBe(false)
  expect(view.now).toEqual({ title: 'Build my landing page', label: 'Working', reason: null, time: '1m 00s', tone: 'working' })
  expect(view.tasks.map(row => row.name)).toEqual(['Analyze', 'Implement'])
  // Live: the ones at work (the finished one is in the history), indented under the parent.
  expect(view.live.map(agent => [agent.name, agent.depth, agent.activity])).toEqual([
    ['lead', 0, 'Working'],
    ['helper', 1, 'Running tests']
  ])
  // The whole task, tidied and not cut at 40.
  expect(view.live[0]?.task).toBe('Review the login flow in and the refresh token handling of the session store')
  expect(view.live[0]!.task!.length).toBeGreaterThan(40)
  expect(view.live[1]?.task).toBeNull()
  expect(view.history.map(agent => [agent.name, agent.label, agent.time])).toEqual([['agent-a3', 'Done', '4s']])

  expect(paneOf(finishTurn(state, 'answer', 91_000), 999_000, 0).now).toMatchObject({ label: 'All done', time: '1m 30s', tone: 'done' })
  expect(paneButtonLabel(false)).toBe('[ ◧ Detail ]')
  expect(paneButtonLabel(true)).toBe('[ ◧ Close ]')
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

  expect(await ui.find({ type: 'Text', text: /^Now$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Build my landing page$/ })).toBeDefined()
  for (const name of [/^Analyze project structure$/, /^Implement authentication$/, /^Run final tests$/]) {
    expect(await ui.find({ type: 'Text', text: name })).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: /^██████████$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^░░░░░░░░░░$/ })).toBeDefined()

  expect(await ui.find({ type: 'Text', text: /^Subagents$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2 active$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Building the login components$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Reading project files$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /secret|\/src/ })).toBeUndefined()
  // The one at work under another is indented.
  expect(await ui.findAll({ type: 'Box', props: { paddingLeft: 2 } } as never)).not.toHaveLength(0)

  expect(await ui.find({ type: 'Text', text: /^History$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Failed · Reviewing the diff$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^No finished subagents yet$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^✗$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^45s$/ })).toBeDefined()

  // Past the band's five seconds the finished one is still there, and the live list is unchanged.
  await clock.advance(10 * MS)
  expect(await ui.find({ type: 'Text', text: /^code-reviewer$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2 active$/ })).toBeDefined()
  await ui.unmount()
})

test('the pane says so when no subagent has finished, and keeps the history after the live list retired it', async ($, on) => {
  const clock = squad(on, 'a1')

  await begin($)
  await spawn($, 'Explore', 'Mapping the repo')

  const ui = await paneView($)

  expect(await ui.find({ type: 'Text', text: /^No finished subagents yet$/ })).toBeDefined()

  await finish($, 'answer', 'a1')
  await clock.advance(6 * MS)

  // Gone from the live list, kept in the history.
  expect(await ui.find({ type: 'Text', text: /^Subagents$/ })).toBeUndefined()
  expect(await ui.findAll({ type: 'Text', text: /^Explore$/ })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /^Done · Mapping the repo$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^No finished subagents yet$/ })).toBeUndefined()
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

  expect(await ui.find({ type: 'Text', text: /^frontend-developer$/ })).toBeDefined()
  await ui.unmount()

  const again = await mount($)

  expect(await again.find({ type: 'Text', text: /^1 active$/ })).toBeDefined()
  await again.unmount()
})

