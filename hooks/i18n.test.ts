import { expect, test } from 'claude-code/testing'

import { DEFAULT_LANG, NAME, TEXTS, detectLang, textsOf } from './i18n'

const es = TEXTS.es
const en = TEXTS.en

/** Every path to a text in a dictionary, so two dictionaries can be compared key by key. */
const paths = (value: unknown, prefix = ''): string[] =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, inner]) => paths(inner, prefix === '' ? key : `${prefix}.${key}`))
    : [prefix]

test('Spanish, however the setting names it', async () => {
  for (const value of ['Español', 'español', 'ESPAÑOL', 'Spanish', 'spanish', 'es', 'es-MX', 'es_ES', 'Castellano', ' spanish (Spain) ']) {
    expect(detectLang(value)).toBe('es')
  }
})

test('English, and any language the radar does not have, give English', async () => {
  for (const value of ['English', 'english', 'en', 'en-US', 'japanese', '日本語', 'french', 'Estonian', 'português', 'esperanto']) {
    expect(detectLang(value)).toBe('en')
  }
})

test('no setting, or one that is not text, gives the default: English', async () => {
  expect(DEFAULT_LANG).toBe('en')
  expect(detectLang(undefined)).toBe('en')
  expect(detectLang(null)).toBe('en')
  expect(detectLang(42)).toBe('en')
  expect(detectLang({ language: 'es' })).toBe('en')
  expect(detectLang('')).toBe('en')
  expect(detectLang('   ')).toBe('en')
})

test('each language has its own texts, and a word for everything', async () => {
  expect(textsOf('es')).toBe(es)
  expect(textsOf('en')).toBe(en)
  expect(paths(en).sort()).toEqual(paths(es).sort())
  expect(es.lang).toBe('es')
  expect(en.lang).toBe('en')

  // No text is empty, in either language.
  for (const texts of [es, en]) {
    for (const key of ['name', 'detail', 'close', 'now', 'subagents', 'history', 'nothing', 'noFinished', 'working', 'defaultTitle', 'workingOnIt'] as const) {
      expect(texts[key].length).toBeGreaterThan(0)
    }
    for (const group of [texts.phase, texts.reason, texts.task, texts.agent, texts.activity]) {
      for (const text of Object.values(group)) expect(text.length).toBeGreaterThan(0)
    }
  }
})

test('the name is a proper name: the same in both languages', async () => {
  expect(NAME).toBe('Claude Radar')
  expect(es.name).toBe(NAME)
  expect(en.name).toBe(NAME)
})

test('the buttons and the toast say ON and OFF the way the button does', async () => {
  for (const texts of [es, en]) {
    expect(texts.toggle(true)).toBe('Claude Radar: ON')
    expect(texts.toggle(false)).toBe('Claude Radar: OFF')
  }
  expect([es.detail, es.close]).toEqual(['Detalle', 'Cerrar'])
  expect([en.detail, en.close]).toEqual(['Detail', 'Close'])
})

test('the counter and the unavailable pane are put in each language', async () => {
  expect(en.active(2)).toBe('2 active')
  expect(es.active(1)).toBe('1 activo')
  expect(es.active(2)).toBe('2 activos')
  expect(en.paneUnavailable(null)).toBe('The detail pane is not available here')
  expect(en.paneUnavailable('narrow')).toBe('The detail pane is not available here: narrow')
  expect(es.paneUnavailable(null)).toBe('El panel de detalle no está disponible aquí')
  expect(es.paneUnavailable('narrow')).toBe('El panel de detalle no está disponible aquí: narrow')
})

test('the English texts are the ones the radar always had', async () => {
  expect(en.phase).toEqual({ working: 'Working', needsYou: 'Needs you', stuck: 'Stuck', stopped: 'Stopped', done: 'All done' })
  expect(en.reason).toEqual({
    permission: 'Waiting for your permission',
    error: 'The turn ended with an error',
    refusal: 'The model declined to answer'
  })
  expect(en.task).toEqual({ done: 'Done', active: 'Working', upcoming: 'Next' })
  expect(en.agent).toEqual({ working: 'Working', needsYou: 'Needs you', done: 'Done', failed: 'Failed', stopped: 'Stopped' })
  expect(en.activity).toEqual({
    reading: 'Reading project files',
    searching: 'Searching project information',
    updating: 'Updating project files',
    testing: 'Running tests',
    command: 'Running a command',
    delegating: 'Delegating work'
  })
  expect([en.working, en.defaultTitle, en.workingOnIt]).toEqual(['Working', 'Working on your request', 'Working on it'])
})

test('the command has a description, answers and a usage in each language, naming both arguments', async () => {
  expect(en.commandDescription).toBe('Open or close the Claude Radar detail pane.')
  expect(es.commandDescription).toBe('Abre o cierra el panel de detalle de Claude Radar.')
  expect(en.commandUsage).toBe('Usage: /agent-radar [open|close]. With no argument, it toggles the pane.')
  expect(es.commandUsage).toBe('Uso: /agent-radar [open|close]. Sin argumento, alterna el panel.')
  expect([en.paneOpened, en.paneClosed]).toEqual(['Detail pane opened', 'Detail pane closed'])
  expect([es.paneOpened, es.paneClosed]).toEqual(['Panel de detalle abierto', 'Panel de detalle cerrado'])
  expect(en.radarOff).toBe('Claude Radar is OFF. Turn it on with its button.')
  expect(es.radarOff).toMatch(/OFF/)
})
