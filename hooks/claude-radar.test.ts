import { expect, mock, test } from 'claude-code/testing'

import { initialState } from './claude-radar'

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
