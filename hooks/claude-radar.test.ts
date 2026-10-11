import { expect, mock, test } from 'claude-code/testing'

import {
  activityOf,
  addTask,
  advance,
  askSubagent,
  askUser,
  bar,
  collapseIfDue,
  didRun,
  elapsed,
  finishSubagent,
  finishTurn,
  headlineOf,
  hidesTools,
  initialState,
  isLive,
  layoutOf,
  normalizeActivity,
  pruneFinished,
  resumeWork,
  rowsOf,
  spawnSubagent,
  startTurn,
  subagentRowOf,
  subagentRowsOf,
  subagentViewOf,
  taskIdOf,
  updateTask,
  workSubagent,
  writeTodos
} from './claude-radar'

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
const watchToasts = (on: any) => {
  const toasts: string[] = []

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
  expect(normalizeActivity('')).toBe('Working on it')
  expect(normalizeActivity('   ')).toBe('Working on it')
  expect(normalizeActivity('`only code` /only/a/path')).toBe('Working on it')
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
    finishedAt: null,
    isCollapsed: false
  })
  expect(startTurn(initialState(), '', 1).checklist.title).toBe('Working on your request')
  expect(startTurn(initialState(), '`code` /a/b', 1).checklist.title).toBe('Working on your request')
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
    stuckReason: 'The turn ended with an error'
  })
  expect(finishTurn(working, 'refusal', 4000).checklist).toMatchObject({
    phase: 'stuck',
    stuckReason: 'The model declined to answer'
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

  expect(waiting.checklist).toMatchObject({ phase: 'needsYou', needsYouReason: 'Waiting for your permission' })
  expect(resumeWork(waiting).checklist).toMatchObject({ phase: 'working', needsYouReason: null })

  const done = finishTurn(working, 'answer', 5)

  expect(askUser(done)).toBe(done)
  expect(resumeWork(done)).toBe(done)
  expect(resumeWork(working)).toBe(working)
  expect(askUser(initialState()).checklist.phase).toBe('done')
})

test('a finished panel folds after 5 seconds, and the timer is live only until then', async () => {
  const working = startTurn(initialState(), 'go', 0)
  const done = finishTurn(working, 'answer', 10_000)

  expect(isLive(initialState())).toBe(false)
  expect(isLive(working)).toBe(true)
  expect(isLive(askUser(working))).toBe(true)
  expect(isLive(done)).toBe(true)

  expect(collapseIfDue(done, 14_999)).toBe(done)
  expect(collapseIfDue(done, 15_000).checklist.isCollapsed).toBe(true)
  expect(collapseIfDue(working, 999_999)).toBe(working)
  expect(isLive(collapseIfDue(done, 15_000))).toBe(false)

  expect(advance(done, 12_000)).toEqual({ ...done, tick: 1 })
  expect(advance(done, 15_000)).toMatchObject({ tick: 1, checklist: { isCollapsed: true } })
  expect(advance(working, 999_999).checklist.isCollapsed).toBe(false)
})

test('the header reads the phase: title and time, needs you, stuck, stopped, all done', async () => {
  const working = startTurn(initialState(), 'Build my landing page', 1000)

  expect(headlineOf(working.checklist, 156_000)).toEqual({ label: 'Build my landing page', detail: '2m 35s', tone: 'working' })
  expect(headlineOf(askUser(working).checklist, 156_000)).toEqual({
    label: 'Needs you',
    detail: 'Waiting for your permission',
    tone: 'needsYou'
  })
  expect(headlineOf(finishTurn(working, 'error', 5000).checklist, 999_000)).toEqual({
    label: 'Stuck',
    detail: 'The turn ended with an error',
    tone: 'stuck'
  })
  expect(headlineOf(finishTurn(working, 'aborted', 5000).checklist, 999_000)).toEqual({
    label: 'Stopped',
    detail: null,
    tone: 'stopped'
  })
  // The time freezes at the end: `now` no longer matters.
  expect(headlineOf(finishTurn(working, 'answer', 191_000).checklist, 999_000)).toEqual({
    label: 'All done',
    detail: '3m 10s',
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

/** Whether the band draws the radar's round frame: the root's first child is the block, or the header alone. */
const isFramed = async (ui: { find: (query: { type: string }) => Promise<{ children: unknown[] } | undefined> }) => {
  const root = await ui.find({ type: 'Box' })

  return (root?.children ?? []).some(child => (child as { props?: { borderStyle?: string } })?.props?.borderStyle === 'round')
}

/** The bottom a register test stands on: the band, a store, the clock and the turn events answering as the engine does. */
const radar = (on: any, draw: (...args: any[]) => unknown = () => engineBand) => {
  on('ui.render', draw)
  on('session.start', ($: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.start', ($: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', ($: unknown, e: { answer: string }) => ({ text: e.answer }))
  memory(on)
  watchToasts(on)

  return mock.clock(on, { now: Date.now() })
}

/** A tool answer as the engine gives it (the plugin relays it as it is). */
const answered = (result: unknown) => ({ ref: 1, result, text: 'ok' }) as never

const begin = ($: any, text = 'Build my landing page') => $.turn.start({ text, turnId: 't' })

const finish = ($: any, reason: 'answer' | 'aborted' | 'error' | 'refusal' = 'answer', agentId?: string) =>
  $.turn.complete({ answer: 'done', durationMs: 0, isAborted: reason === 'aborted', turnId: 't', reason, agentId })

const todos = (...items: [string, 'pending' | 'in_progress' | 'completed'][]) =>
  items.map(([content, status]) => ({ content, status, activeForm: content }))

test('before any turn only the button is drawn, whatever the width', async ($, on) => {
  radar(on)

  for (const bodyColumns of [30, 80]) {
    const ui = await $.ui.mount({
      plugin: 'agent-radar',
      surface: 'terminal',
      ...BAND,
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns } as never
    })

    expect(await ui.find({ type: 'Button', key: 'toggle' })).toBeDefined()
    expect(await isFramed(ui)).toBe(false)
    await ui.unmount()
  }
})

test('a turn shows its title and the time, with the working line when there are no tasks', async ($, on) => {
  const clock = radar(on)

  await begin($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-radar', surface, ...BAND })

    expect(await ui.find({ type: 'Text', text: /Build my landing page/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /0s/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Working on your request/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'toggle', text: /Claude Radar: ON/ })).toBeDefined()
    expect(await isFramed(ui)).toBe(true)
    await ui.unmount()
  }

  await clock.advance(155 * MS)

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Text', text: /2m 35s/ })).toBeDefined()
  await ui.unmount()
})

test('the indeterminate bar moves with the timer', async ($, on) => {
  const clock = radar(on)

  await begin($)

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Text', text: /^███░░░░░░░$/ })).toBeDefined()

  await clock.advance(250)
  expect(await ui.find({ type: 'Text', text: /^░███░░░░░░$/ })).toBeDefined()

  await clock.advance(250)
  expect(await ui.find({ type: 'Text', text: /^░░███░░░░░$/ })).toBeDefined()
  await ui.unmount()
})

test('a long title is cut by words', async ($, on) => {
  radar(on)
  await begin($, 'implement the authentication flow with refresh tokens and sessions in /src/auth')

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Text', text: /Implement the authentication flow with/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /refresh|\/src/ })).toBeUndefined()
  await ui.unmount()
})

test('TodoWrite appears as the checklist, and the call goes through untouched', async ($, on) => {
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

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

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

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

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

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

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

test('all done shows the total time, then folds into one line after 5 seconds', async ($, on) => {
  const clock = radar(on)

  on('tool.call', () => answered({ oldTodos: [], newTodos: [] }))

  await begin($)
  await $.tool.call({ tool: 'TodoWrite', todos: todos(['Analyze', 'completed'], ['Implement', 'pending']) })
  await clock.advance(190 * MS)
  await finish($)

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Text', text: /All done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /3m 10s/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Implement$/ })).toBeDefined()

  // The time is frozen at the end.
  await clock.advance(4 * MS)
  expect(await ui.find({ type: 'Text', text: /3m 10s/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Implement$/ })).toBeDefined()

  await clock.advance(1 * MS)
  expect(await ui.find({ type: 'Text', text: /All done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /3m 10s/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Implement$/ })).toBeUndefined()
  expect(await isFramed(ui)).toBe(false)
  expect(await ui.find({ type: 'Button', key: 'toggle' })).toBeDefined()
  await ui.unmount()
})

test('a stopped or failed turn says so, and also folds', async ($, on) => {
  const clock = radar(on)

  await begin($)
  await finish($, 'aborted')

  const stopped = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await stopped.find({ type: 'Text', text: /^Stopped$/ })).toBeDefined()
  await stopped.unmount()

  await begin($)
  await finish($, 'error')

  const stuck = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await stuck.find({ type: 'Text', text: /^Stuck$/ })).toBeDefined()
  expect(await stuck.find({ type: 'Text', text: /The turn ended with an error/ })).toBeDefined()

  await clock.advance(5 * MS)
  expect(await stuck.find({ type: 'Text', text: /The turn ended with an error/ })).toBeDefined()
  expect(await isFramed(stuck)).toBe(false)
  await stuck.unmount()

  await begin($)
  await finish($, 'refusal')

  const refused = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await refused.find({ type: 'Text', text: /The model declined to answer/ })).toBeDefined()
  await refused.unmount()
})

test('a new turn opens the folded panel again, with nothing of the last one', async ($, on) => {
  const clock = radar(on)

  on('tool.call', () => answered({ oldTodos: [], newTodos: [] }))

  await begin($, 'first job')
  await $.tool.call({ tool: 'TodoWrite', todos: todos(['Old step', 'completed']) })
  await finish($)
  await clock.advance(6 * MS)
  await begin($, 'second job')

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Text', text: /Second job/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Old step/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Working on your request/ })).toBeDefined()
  await ui.unmount()
})

test('a permission question shows Needs you, and the next tool call lifts it', async ($, on) => {
  radar(on)
  on('tool.check', () => ({ decision: 'ask' }) as never)
  on('tool.call', () => answered({ stdout: '' }))

  await begin($)

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Text', text: /Needs you/ })).toBeUndefined()

  expect(await $.tool.check({ tool: 'Bash', input: { command: 'rm x' } })).toMatchObject({ decision: 'ask' })
  expect(await ui.find({ type: 'Text', text: /^Needs you$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Waiting for your permission/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Build my landing page/ })).toBeUndefined()

  await $.tool.call({ tool: 'Bash', command: 'rm x' })
  expect(await ui.find({ type: 'Text', text: /Needs you/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Build my landing page/ })).toBeDefined()
  await ui.unmount()
})

test('a question that ends the turn leaves needs you behind', async ($, on) => {
  radar(on)
  on('tool.check', () => ({ decision: 'ask' }) as never)

  await begin($)
  await $.tool.check({ tool: 'Bash', input: { command: 'rm x' } })
  await finish($, 'aborted')

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Text', text: /Needs you/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Stopped$/ })).toBeDefined()
  await ui.unmount()
})

test('allowed and denied checks leave the turn working, and the verdict goes through as it is', async ($, on) => {
  radar(on)

  let decision = 'allow'

  on('tool.check', () => ({ decision, reason: 'because' }) as never)
  await begin($)

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await $.tool.check({ tool: 'Read', input: {} })).toEqual({ decision: 'allow', reason: 'because' })
  decision = 'deny'
  expect(await $.tool.check({ tool: 'Read', input: {} })).toEqual({ decision: 'deny', reason: 'because' })
  expect(await ui.find({ type: 'Text', text: /Needs you/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Build my landing page/ })).toBeDefined()
  await ui.unmount()
})

test('a subagent turn does not end the main one', async ($, on) => {
  radar(on)
  await begin($)
  await finish($, 'answer', 'sub-1')

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Text', text: /All done/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Build my landing page/ })).toBeDefined()
  await ui.unmount()
})

test('turn events pass through with their answer as it is', async ($, on) => {
  radar(on)

  expect(await begin($)).toEqual({ turnId: 't' })
  expect(await finish($)).toEqual({ text: 'done' })
})

test('with little width the bars go and the names are cut to fit', async ($, on) => {
  radar(on)
  on('tool.call', () => answered({ oldTodos: [], newTodos: [] }))

  await begin($)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: todos(['Implement a very long authentication flow with tokens', 'in_progress'], ['Next thing', 'pending'])
  })

  const ui = await $.ui.mount({
    plugin: 'agent-radar',
    surface: 'terminal',
    ...BAND,
    props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 36 } as never
  })

  expect(await ui.find({ type: 'Text', text: /[█░]/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Working\s*$/ })).toBeDefined()

  const name = await ui.find({ type: 'Text', text: /Implement a very/ })

  expect(name?.props?.wrap).toBe('truncate-end')
  await ui.unmount()

  const wide = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await wide.find({ type: 'Text', text: /[█░]{10}/ })).toBeDefined()
  await wide.unmount()
})

test('OFF draws only the button, even in the middle of a turn, and ON brings the panel back', async ($, on) => {
  radar(on)
  await begin($)

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Text', text: /Build my landing page/ })).toBeDefined()

  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Button', text: /Claude Radar: OFF/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Build my landing page/ })).toBeUndefined()
  expect(await isFramed(ui)).toBe(false)

  // The state is kept while it is off.
  await finish($)
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Button', text: /Claude Radar: ON/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /All done/ })).toBeDefined()
  await ui.unmount()
})

test('while OFF the timer does not run, and ON in the middle of a turn starts it again', async ($, on) => {
  const clock = radar(on)

  await begin($)

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  await ui.press({ key: 'toggle' })
  await clock.advance(10 * MS)
  await ui.press({ key: 'toggle' })

  expect(await ui.find({ type: 'Text', text: /10s/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^███░░░░░░░$/ })).toBeDefined()

  await clock.advance(250)
  expect(await ui.find({ type: 'Text', text: /^░███░░░░░░$/ })).toBeDefined()
  await ui.unmount()
})

test('a panel that finished while OFF comes back folded, not open', async ($, on) => {
  const clock = radar(on)

  await begin($)

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  await ui.press({ key: 'toggle' })
  await finish($)
  await clock.advance(30 * MS)
  await ui.press({ key: 'toggle' })

  expect(await ui.find({ type: 'Text', text: /All done/ })).toBeDefined()
  expect(await isFramed(ui)).toBe(false)
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
  expect(await ui.find({ type: 'Text', text: /Build my landing page/ })).toBeUndefined()
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

test('keeps what another hook of the band draws, with the panel open and folded', { plugins: [other] }, async ($, on) => {
  const clock = radar(on)

  await begin($)

  const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Text', text: /OTHER BAND/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Build my landing page/ })).toBeDefined()

  await finish($)
  await clock.advance(5 * MS)

  expect(await ui.find({ type: 'Text', text: /OTHER BAND/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /All done/ })).toBeDefined()
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
  state = workSubagent(state, 'a1', 'Reading project files')

  expect(Object.keys(state.subagents)).toEqual(['a1', 'a2'])
  expect(state.subagents['a1']?.activity).toBe('Reading project files')
  expect(state.subagents['a2']?.activity).toBeNull()
  expect(state.subagents['a1']?.name).toBe(state.subagents['a2']?.name)
  expect(spawned(state, 'a1', 'other', 9000)).toBe(state)

  state = finishSubagent(state, 'a1', 'answer', 3000)
  expect(state.subagents['a1']?.status).toBe('done')
  expect(state.subagents['a2']?.status).toBe('working')
})

test('the parent is kept only when the spawn names one, and the hierarchy shows only where it is known', async () => {
  const flat = spawned(spawned(initialState(), 'a1', 'one', 1), 'a2', 'two', 2)

  expect('parentId' in flat.subagents['a1']!).toBe(false)
  expect(subagentRowsOf(flat.subagents, 3).map(row => row.depth)).toEqual([0, 0])

  const nested = spawned(spawned(spawned(initialState(), 'a1', 'lead', 1), 'a3', 'solo', 2), 'a2', 'helper', 3, { parentId: 'a1' })

  expect(nested.subagents['a2']?.parentId).toBe('a1')
  // The child follows its parent, one level in, whatever the start order.
  expect(subagentRowsOf(nested.subagents, 4).map(row => [row.name, row.depth])).toEqual([
    ['lead', 0],
    ['helper', 1],
    ['solo', 0]
  ])

  // A parent that is not listed (the main loop's id, or one already retired): flat.
  const orphan = spawned(initialState(), 'a2', 'helper', 3, { parentId: 'gone' })

  expect(subagentRowsOf(orphan.subagents, 4).map(row => row.depth)).toEqual([0])

  // Parents pointing at each other lose nothing.
  const loop = spawned(spawned(initialState(), 'x', 'x', 1, { parentId: 'y' }), 'y', 'y', 2, { parentId: 'x' })

  expect(subagentRowsOf(loop.subagents, 3)).toHaveLength(2)
})

test('the activity comes from the tool, in plain words and never a path or a command', async () => {
  expect(activityOf('Read')).toBe('Reading project files')
  for (const tool of ['Glob', 'Grep', 'WebSearch', 'WebFetch']) expect(activityOf(tool)).toBe('Searching project information')
  for (const tool of ['Edit', 'Write', 'NotebookEdit']) expect(activityOf(tool)).toBe('Updating project files')
  for (const tool of ['Agent', 'Task']) expect(activityOf(tool)).toBe('Delegating work')

  for (const command of ['npm test', 'bun run test', 'npx vitest run', 'pytest -q', 'npx jest', 'npm run test:unit'])
    expect(activityOf('Bash', command)).toBe('Running tests')

  for (const command of ['ls -la /secret/path', 'git status', 'cat latest.log', ''])
    expect(activityOf('Bash', command)).toBe('Running a command')

  expect(activityOf('Bash')).toBe('Running a command')
  expect(activityOf('TodoWrite')).toBeNull()
  expect(activityOf('mcp__x__y')).toBeNull()
})

test('a tool call sets the activity; an unknown tool or agent changes nothing', async () => {
  const state = spawned(initialState(), 'a1')

  expect(workSubagent(state, 'a1', 'Updating project files').subagents['a1']?.activity).toBe('Updating project files')
  expect(workSubagent(workSubagent(state, 'a1', 'Running tests'), 'a1', null).subagents['a1']?.activity).toBe('Running tests')
  expect(workSubagent(state, 'a1', null)).toBe(state)
  expect(workSubagent(state, 'nobody', 'Running tests')).toBe(state)
  expect(workSubagent(state, 'constructor', 'Running tests')).toBe(state)
  expect(workSubagent(state, 'a1', 'Running tests')).not.toBe(state)
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
  expect(subagentRowOf(done.subagents['a1']!, 999_000).time).toBe('3s')

  const back = workSubagent(done, 'a1', 'Reading project files')

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

test('the rows show the name, its own time, the activity (or task, or Working) and the status', async () => {
  let state = spawned(initialState(), 'a1', 'frontend-developer', 0)

  state = spawned(state, 'a2', 'backend-developer', 35_000, { task: null })
  state = workSubagent(state, 'a1', 'Reading project files')

  expect(subagentRowsOf(state.subagents, 80_000).map(row => `${row.mark} ${row.name} ${row.time} | ${row.activity} | ${row.label}`)).toEqual([
    '● frontend-developer 1m 20s | Reading project files | Working',
    '● backend-developer 45s | Working | Working'
  ])
  // Before any tool is seen the task shows, cleaned of paths and code.
  expect(subagentRowsOf(spawned(initialState(), 'a1', 'x', 0, { task: 'Fix `foo()` in /src/a.ts please' }).subagents, 1)[0]?.activity).toBe('Fix in please')
  expect(subagentRowsOf(spawned(initialState(), 'a1', 'x', 0, { task: '/src/a.ts' }).subagents, 1)[0]?.activity).toBe('Working')

  const marks = (status: 'needsYou' | 'done' | 'failed' | 'stopped') => {
    const base = spawned(initialState(), 'a1')
    const next =
      status === 'needsYou'
        ? askSubagent(base, 'a1')
        : finishSubagent(base, 'a1', status === 'done' ? 'answer' : status === 'failed' ? 'error' : 'aborted', 1)

    return subagentRowsOf(next.subagents, 2).map(row => `${row.mark} ${row.label}`)[0]
  }

  expect(marks('needsYou')).toBe('● Needs you')
  expect(marks('done')).toBe('✓ Done')
  expect(marks('failed')).toBe('✗ Failed')
  expect(marks('stopped')).toBe('■ Stopped')
})

test('with little room the active subagents come first and the rest is counted; narrow drops the status', async () => {
  let state = spawned(initialState(), 'a1', 'old-one', 0)

  state = finishSubagent(state, 'a1', 'answer', 1)
  state = spawned(spawned(state, 'a2', 'busy-1', 2), 'a3', 'busy-2', 3)

  expect(subagentViewOf(initialState().subagents, 0, 10, 80)).toBeNull()

  const roomy = subagentViewOf(state.subagents, 10, 7, 80)

  expect(roomy).toMatchObject({ active: 2, hidden: 0, showStatus: true })
  expect(roomy?.rows.map(row => row.name)).toEqual(['old-one', 'busy-1', 'busy-2'])

  // Header + 2 subagents + the "more" row: the finished one is the one left out.
  const tight = subagentViewOf(state.subagents, 10, 6, 80)

  expect(tight?.rows.map(row => row.name)).toEqual(['busy-1', 'busy-2'])
  expect(tight?.hidden).toBe(1)

  expect(subagentViewOf(state.subagents, 10, 4, 80)?.rows.map(row => row.name)).toEqual(['busy-1'])
  expect(subagentViewOf(state.subagents, 10, 4, 80)?.hidden).toBe(2)
  // No room for even one: the header and the count remain.
  expect(subagentViewOf(state.subagents, 10, 3, 80)).toMatchObject({ rows: [], hidden: 3, active: 2 })
  expect(subagentViewOf(state.subagents, 10, -4, 80)).toMatchObject({ rows: [], hidden: 3 })
  expect(subagentViewOf(state.subagents, 10, 7, 39)?.showStatus).toBe(false)
  expect(subagentViewOf(state.subagents, 10, 7, 40)?.showStatus).toBe(true)
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

const mount = ($: any, bodyColumns = 80, maxRows = 10) =>
  $.ui.mount({
    plugin: 'agent-radar',
    surface: 'terminal',
    ...BAND,
    props: { hasSurvey: false, isWorking: true, maxRows, bodyColumns } as never
  })

test('a spawn goes through untouched and the subagent shows with its name, time and state', async ($, on) => {
  const clock = squad(on, 'a1')

  await begin($)

  const result = await spawn($, 'frontend-developer')

  expect(result).toEqual({ model: 'm', agentId: 'a1' })

  await clock.advance(80 * MS)

  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /^Subagents$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1 active$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^frontend-developer$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1m 20s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Building login components$/ })).toBeDefined()
  // The main checklist's line and the subagent's own status.
  expect(await ui.findAll({ type: 'Text', text: /^Working$/ })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: /^●$/ })).toBeDefined()
  // Inside the same frame as the checklist, not in another block.
  expect(await isFramed(ui)).toBe(true)
  expect((await ui.findAll({ type: 'Box' })).filter((box: { props?: { borderStyle?: string } }) => box.props?.borderStyle === 'round')).toHaveLength(1)
  await ui.unmount()
})

test('a refused spawn adds nothing, and its answer goes through as it is', async ($, on) => {
  radar(on)
  on('agent.spawn', () => ({ deny: 'no' }) as never)

  await begin($)
  expect(await spawn($, 'Explore')).toEqual({ deny: 'no' })

  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /Subagents/ })).toBeUndefined()
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
  expect(await ui.find({ type: 'Text', text: /^30s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^0s$/ })).toBeDefined()

  // Finishing one leaves the other working.
  await finish($, 'answer', 'a1')
  expect(await ui.find({ type: 'Text', text: /^1 active$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Done$/ })).toBeDefined()
  // The main checklist's line and the one subagent still working.
  expect(await ui.findAll({ type: 'Text', text: /^Working$/ })).toHaveLength(2)
  await ui.unmount()
})

test('the activity follows the tools of that subagent only', async ($, on) => {
  squad(on, 'a1', 'a2')

  await begin($)
  await spawn($, 'one', 'Task one')
  await spawn($, 'two', 'Task two')

  const ui = await mount($)

  await $.tool.call({ tool: 'Read', file_path: '/secret/file.ts', agentId: 'a1' } as never)
  expect(await ui.find({ type: 'Text', text: /^Reading project files$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Task two$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Task one$/ })).toBeUndefined()

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

test('a subagent that ends shows Done, then is gone after 5 seconds and the section with it', async ($, on) => {
  const clock = squad(on, 'a1')

  await begin($)
  await spawn($, 'frontend-developer')
  await clock.advance(65 * MS)
  await finish($, 'answer', 'a1')

  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /^Done$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^✓$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^0 active$/ })).toBeDefined()

  // The time is frozen at the end.
  await clock.advance(4 * MS)
  expect(await ui.find({ type: 'Text', text: /^1m 05s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^frontend-developer$/ })).toBeDefined()

  await clock.advance(1 * MS)
  expect(await ui.find({ type: 'Text', text: /frontend-developer/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Subagents$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'toggle' })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /^2 active$/ })).toBeDefined()
  // The main turn did not ask.
  expect(await ui.find({ type: 'Text', text: /Waiting for your permission/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Build my landing page/ })).toBeDefined()

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

  // The main panel folded; the subagent, still working, stays in view inside the frame.
  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /All done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^frontend-developer$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Working$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1 active$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'toggle' })).toBeDefined()
  expect(await isFramed(ui)).toBe(true)
  // Folded: no checklist rows.
  expect(await ui.find({ type: 'Text', text: /Working on your request/ })).toBeUndefined()

  // Then it finishes; the main turn keeps its own end, and once retired the panel is the folded line again.
  await finish($, 'answer', 'a1')
  expect(await ui.find({ type: 'Text', text: /^Done$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /All done/ })).toBeDefined()
  await clock.advance(5 * MS)
  expect(await ui.find({ type: 'Text', text: /frontend-developer/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /All done/ })).toBeDefined()
  expect(await isFramed(ui)).toBe(false)
  await ui.unmount()
})

test('the main turn is still running when a subagent ends, and the section is hidden without subagents', async ($, on) => {
  squad(on, 'a1')

  await begin($)

  const before = await mount($)

  expect(await before.find({ type: 'Text', text: /Subagents/ })).toBeUndefined()
  await before.unmount()

  await spawn($, 'one')
  await finish($, 'answer', 'a1')

  const ui = await mount($)

  expect(await ui.find({ type: 'Text', text: /All done/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Build my landing page/ })).toBeDefined()
  await ui.unmount()
})

test('subagents alone, before any turn, are drawn under the button', async ($, on) => {
  squad(on, 'a1')

  await spawn($, 'Explore', 'Mapping the repo')

  const ui = await mount($)

  expect(await ui.find({ type: 'Button', key: 'toggle' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Explore$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /All done/ })).toBeUndefined()
  await ui.unmount()
})

test('OFF draws only the button, subagents or not, and ON brings them back', async ($, on) => {
  squad(on, 'a1')

  await begin($)
  await spawn($, 'frontend-developer')

  const ui = await mount($)

  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /frontend-developer/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /Claude Radar: OFF/ })).toBeDefined()

  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /^frontend-developer$/ })).toBeDefined()
  await ui.unmount()
})

test('with little room the status column goes and the rows are cut, the active first and the rest counted', async ($, on) => {
  squad(on, 'a1', 'a2', 'a3')

  await begin($)
  await spawn($, 'first-agent')
  await spawn($, 'second-agent')
  await spawn($, 'third-agent')
  await finish($, 'answer', 'a1')

  // 1 checklist row + frame and header = 4; 4 rows left: the header, one subagent and "+2 more".
  const tight = await mount($, 36, 8)

  // Only the main checklist's own label: the subagent has no status column.
  expect(await tight.findAll({ type: 'Text', text: /^Working$/ })).toHaveLength(1)
  expect(await tight.find({ type: 'Text', text: /^Done$/ })).toBeUndefined()
  expect(await tight.find({ type: 'Text', text: /^2 active$/ })).toBeDefined()
  expect(await tight.find({ type: 'Text', text: /^\+2 more$/ })).toBeDefined()
  expect(await tight.find({ type: 'Text', text: /^second-agent$/ })).toBeDefined()
  expect(await tight.find({ type: 'Text', text: /^first-agent$/ })).toBeUndefined()

  const name = await tight.find({ type: 'Text', text: /^second-agent$/ })

  expect(name?.props?.wrap).toBe('truncate-end')
  await tight.unmount()

  const wide = await mount($, 80, 20)

  expect(await wide.find({ type: 'Text', text: /^\+\d+ more$/ })).toBeUndefined()
  expect(await wide.find({ type: 'Text', text: /^first-agent$/ })).toBeDefined()
  expect(await wide.find({ type: 'Text', text: /^Done$/ })).toBeDefined()
  expect((await wide.findAll({ type: 'Text', text: /^Working$/ })).length).toBeGreaterThan(1)
  await wide.unmount()
})

test('a nested subagent shows under its parent only when the spawn names a parent that is listed', async ($, on) => {
  squad(on, 'a1', 'a2')

  await begin($)
  await spawn($, 'lead')
  await spawn($, 'helper', 'Helping', { parentAgentId: 'a1' })

  const ui = await mount($)
  const helper = await ui.find({ type: 'Text', text: /^helper$/ })
  const lead = await ui.find({ type: 'Text', text: /^lead$/ })

  expect(helper).toBeDefined()
  expect(lead).toBeDefined()
  expect(await ui.findAll({ type: 'Box', props: { paddingLeft: 2 } } as never)).not.toHaveLength(0)
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
