import { expect, mock, test } from 'claude-code/testing'

import {
  addTask,
  advance,
  askUser,
  bar,
  collapseIfDue,
  didRun,
  elapsed,
  finishTurn,
  headlineOf,
  initialState,
  isLive,
  layoutOf,
  normalizeActivity,
  resumeWork,
  rowsOf,
  startTurn,
  taskIdOf,
  updateTask,
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
const radar = (on: any) => {
  on('ui.render', () => engineBand)
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
