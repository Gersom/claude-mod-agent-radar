import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ClaudeRadarState, Lang, ModelInfo, SubagentStatus } from '../types'

import {
  PANE_COLUMNS,
  PANE_ID,
  PANE_ROWS,
  STATUS_MIN_COLUMNS,
  TICK_MS,
  TOKENS_MIN_COLUMNS,
  activityOf,
  addTask,
  addTokens,
  advance,
  askSubagent,
  askUser,
  buttonLabel,
  didRun,
  finishSubagent,
  finishTurn,
  forceArchive,
  hideButtonLabel,
  hidesTools,
  initialState,
  isLive,
  layoutOf,
  paneButtonLabel,
  paneOf,
  resetSession,
  resumeWork,
  settleTurn,
  spawnSubagent,
  stepModel,
  startTurn,
  taskIdOf,
  tokensOf,
  updateTask,
  workSubagent,
  writeTodos
} from './claude-radar'
import type { PaneCurrent, PaneRow, PaneTurn } from './claude-radar'
import { NAME, detectLang, textsOf } from './i18n'

/** The key of `$.store` that keeps the ON/OFF choice between sessions. */
const STORE_KEY = 'enabled'

/** The key of `$.store` that keeps whether the band is hidden between sessions. */
const BAND_KEY = 'bandHidden'

/** The colour of the pane's phase label by phase; `undefined` leaves the default. */
const TONE = {
  working: undefined,
  needsYou: '#facc15',
  stuck: '#ef4444',
  stopped: '#fb923c',
  done: '#22c55e'
} as const

/** The character of the faint line under a section's title: lighter than the `─` of the lines inside the run. */
const TITLE_RULE = '╌'

const GREEN = '#22c55e'
const ACTIVE = '#38bdf8'

/** The colour of a subagent's mark and status label. */
const SUBAGENT_TONE = {
  working: GREEN,
  needsYou: '#facc15',
  done: GREEN,
  failed: '#ef4444',
  stopped: '#fb923c'
} as const

/** The colour of a status bar: the moving one in blue, a finished one in its status colour. */
const barColor = (status: SubagentStatus) => (status === 'working' ? ACTIVE : SUBAGENT_TONE[status])

/** The radar's state: what the band and the pane draw from. */
const radar = atom({ plugin: 'agent-radar', key: 'claudeRadarState' } as const, initialState())

/** Whether the tool rows are hidden: the one value the transcript's rows read, so they redraw when it flips and not on every tick of the state. */
const hideTools = atom({ plugin: 'agent-radar', key: 'claudeRadarHidesTools' } as const, false)

/** Whether the detail pane is open: set when the button opens it, cleared when it closes, whoever closes it. */
const paneOpen = atom({ plugin: 'agent-radar', key: 'claudeRadarPaneOpen' } as const, false)

/** Whether the band is taken off the prompt: only the drawing of the band goes, the pane and the hidden tool rows follow ON/OFF as ever. */
const bandHidden = atom({ plugin: 'agent-radar', key: 'claudeRadarBandHidden' } as const, false)

/** The radar's language, settled from settings.language the first time (and again in a new session); `null` until then. */
const langMode = atom({ plugin: 'agent-radar', key: 'claudeRadarLang' } as const, null as Lang | null)

/** The language settings.language names; the default when the settings cannot be read or name none the radar has. */
const readLang = async ($: EngineInterface) => {
  let language: unknown

  try {
    language = (await $.settings.read()).language
  } catch {
    // No settings to read: the default language.
  }

  return detectLang(language)
}

/** Settles the language once, from the settings; events call it, a draw cannot write. */
const ensureLang = async ($: EngineInterface) => {
  if ((await read($, langMode)) !== null) return

  const lang = await readLang($)

  await update($, langMode, current => current ?? lang)
}

/** The words of the language in force. Before an event settled it a draw reads the settings itself, without writing. */
const textsFor = async ($: EngineInterface) => textsOf((await read($, langMode)) ?? (await readLang($)))

/**
 * Whether the pane is open and the radar is ON, as plain module variables: the `/agent-radar` command has to decide what to do without an
 * `await` before `$.ui.open` (the engine counts an open as the person's own only when it is the handler's first asynchronous step, as the
 * button's press showed), so it cannot `read` the atoms. They follow the atoms: every write below sets both, and `session.start` reads them
 * again, so a reload of the module (which loses variables, not atoms) is mended with the next session. A stale value costs a redundant
 * `ui.open` of an open pane, which the engine only retitles.
 */
let paneIsOpen = false
let radarIsOn = true

/** Sets the band's hidden flag, atom and saved choice together; a store that cannot be written leaves the choice for this session only. */
const setBandHidden = async ($: EngineInterface, value: boolean) => {
  await update($, bandHidden, () => value)

  try {
    await $.store.set(BAND_KEY, value)
  } catch {
    // Not saved: the choice still holds for this session.
  }
}

/** Sets the pane's flag, atom and mirror together. */
const setPaneOpen = async ($: EngineInterface, value: boolean) => {
  paneIsOpen = value
  await update($, paneOpen, () => value)
}

/** Applies `fn` to the radar's state and keeps `hideTools` in step with it, written only when it changes. */
const change = async ($: EngineInterface, fn: (state: ClaudeRadarState) => ClaudeRadarState) => {
  const state = await update($, radar, fn)

  radarIsOn = state.claudeRadarEnabled
  const hides = hidesTools(await read($, radar))

  if ((await read($, hideTools)) !== hides) await update($, hideTools, () => hides)

  return state
}

/** The model and effort (the latest) and the tokens (all) of requests of a subagent seen before its spawn was answered, by `agentId`; at most `EARLY_MAX`, emptied when it fills or the session ends. */
const earlySteps = new Map<string, { info: ModelInfo; tokens: number }>()
const EARLY_MAX = 50

/** Keeps a request of a subagent not listed yet for its spawn: its model and effort replace the earlier ones, its tokens add up. */
const rememberEarly = (id: string, info: ModelInfo, tokens: number) => {
  if (!earlySteps.has(id) && earlySteps.size >= EARLY_MAX) earlySteps.clear()
  earlySteps.set(id, { info, tokens: (earlySteps.get(id)?.tokens ?? 0) + tokens })
}

/** Whether the radar follows this agent: the main one always, a subagent once its spawn is listed. */
const isFollowed = (state: ClaudeRadarState, id: string | undefined) => id === undefined || Object.prototype.hasOwnProperty.call(state.subagents, id)

/** The one restore of the saved choice per load of the module (a reload starts it over); shared, so no draw reads the flag before it ends. */
let restoring: Promise<void> | null = null

/** Puts the saved ON/OFF choice into the state; a store that cannot be read leaves the default, ON. */
const ensureEnabled = ($: EngineInterface) => {
  restoring ??= (async () => {
    let saved: unknown
    let savedBand: unknown

    try {
      saved = await $.store.get(STORE_KEY)
      savedBand = await $.store.get(BAND_KEY)
    } catch {
      // No store to read: the defaults, ON and the band shown.
    }

    if (savedBand === true) await update($, bandHidden, () => true)

    if (typeof saved === 'boolean') {
      const enabled = saved

      await change($, state => ({ ...state, claudeRadarEnabled: enabled }))
    }
  })()

  return restoring
}

/** The one timer, only while the pane is open: it moves the animation and the times in the pane; a reload starts the module over, without it. */
let ticker: { cancel: () => void } | null = null

const stop = () => {
  ticker?.cancel()
  ticker = null
}

/** Starts the timer unless it runs, the radar is OFF, the pane is closed (nobody sees a tick then: nothing is redrawn) or there is nothing to move; it stops itself when any of those stops holding. */
const start = async ($: EngineInterface) => {
  if (ticker !== null) return

  await ensureEnabled($)

  if (ticker !== null || !(await read($, paneOpen))) return

  const state = await read($, radar)

  if (!state.claudeRadarEnabled || !isLive(state)) return

  ticker = $.clock.every(TICK_MS, async () => {
    const current = await change($, previous => advance(previous))

    if (!current.claudeRadarEnabled || !isLive(current) || !(await read($, paneOpen))) stop()
  })
}

/** Closes the detail pane if it is open and clears the flag here: the engine leaves a plugin's own hook out of the close the plugin makes, so the `ui.close` hook below only hears the person's. */
const closePane = async ($: EngineInterface) => {
  if (!(await read($, paneOpen))) return

  await $.ui.close({ id: PANE_ID })
  await setPaneOpen($, false)
  stop()
}

/**
 * Opens the pane: `$.ui.open` is the first asynchronous step, so the engine still sees it as the person's own press or command and places it
 * at any width. Resolves `null` once it is on screen, or the engine's reason when this surface places no panes; nothing is left waiting then.
 */
const openPane = async ($: EngineInterface) => {
  const opened = await $.ui.open({ id: PANE_ID, title: NAME, rows: PANE_ROWS, columns: PANE_COLUMNS })

  if (opened.isPlaced) {
    await setPaneOpen($, true)
    // The pane is on screen: the times and the animation move while there is work.
    await start($)

    return null
  }

  // Open but undrawn: leave nothing waiting to pop up later on its own.
  await $.ui.close({ id: PANE_ID })

  return opened.reason
}

/** The detail button: opens the pane, or closes it if it is open. Only a press or the command opens it, never the radar on its own. A surface that places no panes gets a toast. */
const togglePane = async ($: EngineInterface, isOpen: boolean) => {
  // `isOpen` is what the band drew, so the open call is the handler's first await.
  if (isOpen) return closePane($)

  const reason = await openPane($)

  if (reason !== null) $.ui.toast((await textsFor($)).paneUnavailable(reason))
}

/** Turns the radar ON or OFF, saves the choice and says so with a brief toast. */
const setEnabled = async ($: EngineInterface, enabled: boolean) => {
  await change($, state => ({ ...state, claudeRadarEnabled: enabled }))

  // OFF leaves only the ON/OFF button: no pane stays open.
  if (!enabled) await closePane($)

  try {
    await $.store.set(STORE_KEY, enabled)
  } catch {
    // Not saved: the choice still holds for this session.
  }

  if (!enabled) stop()

  await ensureLang($)
  $.ui.toast((await textsFor($)).toggle(enabled))
}

/** The hide button: takes the band off the prompt, saves it and says how to bring it back. The radar keeps working. */
const hideBand = async ($: EngineInterface) => {
  await setBandHidden($, true)
  await ensureLang($)
  $.ui.toast((await textsFor($)).bandHidden)
}

/** Claude Radar: a passive monitor of the main agent and its subagents. It only watches the events go by and draws; nothing it sees is changed. */
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await ensureEnabled($)
    await ensureLang($)

    // The command's mirrors follow the atoms again (a reload loses them).
    paneIsOpen = await read($, paneOpen)
    radarIsOn = (await read($, radar)).claudeRadarEnabled

    await $.command.register({
      name: 'agent-radar',
      description: (await textsFor($)).commandDescription,
      argumentHint: '[open|close|hide|show]'
    })

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stop()
    earlySteps.clear()
    // A new session starts clean: what was followed, the archived turns included, goes; the ON/OFF choice stays.
    await change($, state => resetSession(state))
    // The next session reads the language again.
    await update($, langMode, () => null)

    return next(e)
  })

  // The person's close mark or key leaves the flag, and so the button, in step with the pane (the button's own close clears it in `closePane`).
  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    const closed = await next(e)

    await setPaneOpen($, false)
    stop()

    return closed
  })

  // `/agent-radar` opens or closes the detail pane: with no argument it toggles, `open` only opens, `close` only closes. Its person's own
  // request places the pane at any width. The decision uses the mirrors, so `$.ui.open` is the first `await` of an opening.
  on('command.run', { command: 'agent-radar' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const isKnown = arg === '' || arg === 'open' || arg === 'close' || arg === 'hide' || arg === 'show'

    if (isKnown && radarIsOn && !paneIsOpen && (arg === '' || arg === 'open')) {
      const reason = await openPane($)
      const t = await textsFor($)

      if (reason === null) return { text: t.paneOpened }

      $.ui.toast(t.paneUnavailable(reason))

      return { text: t.paneUnavailable(reason) }
    }

    await ensureLang($)

    const t = await textsFor($)

    if (!isKnown) return { text: t.commandUsage }

    // The band is the only thing these two touch: they work whether the radar is ON or OFF.
    if (arg === 'hide' || arg === 'show') {
      await setBandHidden($, arg === 'hide')

      return { text: arg === 'hide' ? t.bandHidden : t.bandShown }
    }

    if (!radarIsOn) return { text: t.radarOff }

    // Open already (`open`, or the toggle's turn to close), or closed already (`close`).
    if (arg !== 'open') await closePane($)

    return { text: arg === 'open' || paneIsOpen ? t.paneOpened : t.paneClosed }
  })

  on('turn.start', async ($, e, next) => {
    // A subagent's or teammate's run starts a turn of its own: only the main loop's start is the person's request.
    if (e.agentId !== undefined) return next(e)

    const time = await $.clock.now()

    await ensureLang($)

    await change($, state => startTurn(state, e.text, time))
    await start($)

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const id = result.agentId

    // A refused spawn started nothing; every run that did start is its own entry, by its id.
    if (id !== undefined) {
      const time = await $.clock.now()

      const model = 'model' in result ? result.model : undefined
      const early = earlySteps.get(id)

      earlySteps.delete(id)
      await change($, state => {
        const spawned = spawnSubagent(state, { id, name: e.subagentType, task: e.description, parentId: e.parentAgentId, model }, time)

        // Requests that came before the spawn was answered are applied now: the model and effort, and the tokens.
        return early === undefined ? spawned : addTokens(stepModel(spawned, id, early.info), id, early.tokens)
      })
      await start($)
    }

    return result
  })

  // Each model request names the model and the effort it runs with, and, once answered, what it cost: the main agent's, or a subagent's
  // (`agentId`). The turn's own `usage` (turn.complete) is not read: the steps already add up to it. Observe only: the result goes up as it came.
  on('turn.step', async function* ($, e, next) {
    const info = { model: e.model, effort: e.effort === undefined ? null : String(e.effort) }
    const id = e.agentId

    if (isFollowed(await read($, radar), id)) {
      await change($, previous => stepModel(previous, id, info))
    } else if (id !== undefined) {
      // Not listed yet (its spawn is still being answered, or it is not followed): kept for the spawn, a few at most.
      rememberEarly(id, info, 0)
    }

    const result = yield* next(e)
    const tokens = tokensOf(result.usage)

    if (tokens > 0) {
      // The spawn may have been answered while the request ran: then the subagent is listed and takes the tokens; if not, they wait for it.
      if (isFollowed(await read($, radar), id)) {
        await change($, previous => addTokens(previous, id, tokens))
      } else if (id !== undefined) {
        rememberEarly(id, info, tokens)
      }
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const time = await $.clock.now()

    // Each end may be the last one of the turn: once the main agent and every subagent have ended, the turn is archived in the same write.
    if (e.agentId === undefined) {
      // Cutting the turn off ends it whole: the subagents still at work are stopped with it.
      await change($, state => {
        const ended = finishTurn(state, e.reason, time)

        return e.reason === 'aborted' ? forceArchive(ended, time) : settleTurn(ended, time)
      })
    } else {
      // A subagent's turn ends that subagent, never the main one; an agent not followed changes nothing.
      const id = e.agentId

      await change($, state => settleTurn(finishSubagent(state, id, e.reason, time), time))
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      // A subagent's call: its activity, said in plain words, and the wait for the person (if any) is over.
      const id = e.agentId
      const activity = activityOf(e.tool, e.tool === 'Bash' ? e.command : undefined)

      await change($, state => workSubagent(state, id, activity))

      return next(e)
    }

    const ran = await next(e)

    // The call is over, whether the person allowed it or not: Claude is working again.
    await change($, state => resumeWork(state))

    if (didRun(ran)) {
      if (e.tool === 'TodoWrite') {
        await change($, state => writeTodos(state, e.todos))
      } else if (e.tool === 'TaskCreate') {
        const id = taskIdOf(ran.result, e.tool_use_id)

        await change($, state => addTask(state, id, e.subject))
      } else if (e.tool === 'TaskUpdate') {
        await change($, state => updateTask(state, e.taskId, { status: e.status, subject: e.subject }))
      }
    }

    return ran
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)

    // `ask` puts the call to the person (in some modes to a classifier); the tool.call that follows lifts the mark.
    // Only the model's own calls count: another plugin's `$.tool.check` query asks, it does not wait for anyone.
    if (next.origin.plugin === 'engine' && verdict.decision === 'ask') {
      if (e.agentId === undefined) {
        await change($, state => askUser(state))
      } else {
        const id = e.agentId

        await change($, state => askSubagent(state, id))
      }
    }

    return verdict
  })

  // The tool rows give way to the radar while work goes on; they come back when it ends, waits for the person or the radar is OFF.
  // Only drawing: the calls, their results and the history are not touched. A row of a call that failed or was cut stays in view.
  // Never hooked here: the reply (`AssistantMessage`), `UserMessage`, `TurnDuration`, `InfoNotice`, `SessionMode`, `AskUserQuestion`, `PromptHint`.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.isErrored || e.props.isInterrupted || !(await read($, hideTools))) return next(e)

    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.isErrored || !(await read($, hideTools))) return next(e)

    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.calls.some(call => call.isErrored || call.isInterrupted) || !(await read($, hideTools))) return next(e)

    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (!(await read($, hideTools))) return next(e)

    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  // The band is one line: the name and the two buttons. All the content is in the detail pane, which only a press of the button opens:
  // a pane the mod opened by itself would not be placed under 144 columns, so nothing is ever opened unasked.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Other hooks' bands stay; a survey keeps the band to itself.
    const below = await next(e)

    if (e.props.hasSurvey || (await read($, bandHidden))) return below

    const { claudeRadarEnabled: enabled } = await read($, radar)
    const isPaneOpen = await read($, paneOpen)
    const t = await textsFor($)
    const { Box, Button, Text } = $.ui.resolve(e)

    // The ON/OFF button stays visible whether the radar is ON or OFF; the detail button only when ON, to its left.
    const toggle = (
      <Button key="toggle" plain dimColor onPress={() => void setEnabled($, !enabled)}>
        {buttonLabel(enabled, t)}
      </Button>
    )

    return (
      <Box flexDirection="column">
        <Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end" bold dimColor>
              {t.name}
            </Text>
          </Box>
          {enabled ? (
            <Box flexShrink={0} marginLeft={2} marginRight={1}>
              <Button key="pane" plain dimColor onPress={() => void togglePane($, isPaneOpen)}>
                {paneButtonLabel(isPaneOpen, t)}
              </Button>
            </Box>
          ) : null}
          <Box flexShrink={0} marginLeft={enabled ? 0 : 2}>
            {toggle}
          </Box>
          <Box flexShrink={0} marginLeft={1}>
            <Button key="hide" plain dimColor onPress={() => void hideBand($)}>
              {hideButtonLabel(t)}
            </Button>
          </Box>
        </Box>
        {below}
      </Box>
    )
  })

  // The detail pane, opened only by the band's button: the current run (the turn in progress, with its total time and tokens, its main agent with
  // its whole checklist and its subagents) and the history of the turns that ended, one group each, always open. It only reads.
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const state = await read($, radar)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const t = await textsFor($)

    const view = paneOf(state, now, state.tick, t)

    if (view.isEmpty) {
      return (
        <Box flexDirection="column">
          <Text wrap="truncate-end" dimColor>
            {t.nothing}
          </Text>
        </Box>
      )
    }

    // The body has no frame of its own to take off: four columns are added back for `layoutOf`, which counts the border and padding of a framed block; the checklist sits two columns in.
    const { showBars, nameWidth } = layoutOf(view.current?.tasks ?? [], columns + 2)
    const showStatus = columns >= STATUS_MIN_COLUMNS
    const showTokens = columns >= TOKENS_MIN_COLUMNS
    // The status labels share one width so the columns of the agents line up.
    const statusWidth = Math.max(...Object.values(t.agent).map(label => label.length))

    /** The widths of the time and tokens columns of a block, so its rows line up; the tokens column is gone in a narrow pane, or when no row has tokens. */
    const widthsOf = (times: string[], tokens: (string | null)[]) => ({
      time: Math.max(0, ...times.map(time => time.length)),
      tokens: showTokens ? Math.max(0, ...tokens.map(text => text?.length ?? 0)) : 0
    })

    /** A thin line across the pane, `indent` columns shorter; the text cuts it to the width. */
    const rule = (indent = 0) => (
      <Text wrap="truncate-end" dimColor>
        {'─'.repeat(Math.max(1, columns - indent))}
      </Text>
    )

    /** The two-column cell of a mark. */
    const markCell = (mark: string, color?: string, isDim = false) => (
      <Box flexShrink={0} width={2}>
        <Text color={color} dimColor={isDim}>
          {mark}
        </Text>
      </Box>
    )

    /** A section's title, with an optional figure at the right and a mark before it, and a faint line under the whole row that sets it apart from its content. */
    const heading = (mark: ReturnType<typeof markCell> | null, title: string, figure?: string) => (
      <Box flexDirection="column">
        <Box>
          {mark}
          <Box flexGrow={1} flexShrink={0}>
            <Text wrap="truncate-end" bold>
              {title}
            </Text>
          </Box>
          {figure === undefined ? null : (
            <Box flexShrink={1} marginLeft={2}>
              <Text wrap="truncate-end" dimColor>
                {figure}
              </Text>
            </Box>
          )}
        </Box>
        <Text wrap="truncate-end" dimColor>
          {TITLE_RULE.repeat(Math.max(1, columns))}
        </Text>
      </Box>
    )

    /** The right side of an agent line, which never shrinks: the status label (in its colour), the time, the tokens and, if `withBar`, the status bar. Each drops out when the pane is too narrow for it. */
    const cells = (
      fields: { status: SubagentStatus; time: string; tokens: string | null; bar: string },
      widths: { time: number; tokens: number },
      label: { text: string; color?: string },
      withBar: boolean
    ) => (
      <Box flexShrink={0}>
        {showStatus ? (
          <Box flexShrink={0} marginLeft={2} width={statusWidth}>
            <Text color={label.color} dimColor={label.color === undefined}>
              {label.text}
            </Text>
          </Box>
        ) : null}
        <Box flexShrink={0} marginLeft={2} width={widths.time} justifyContent="flex-end">
          <Text dimColor>{fields.time}</Text>
        </Box>
        {widths.tokens === 0 ? null : (
          <Box flexShrink={0} marginLeft={2} width={widths.tokens} justifyContent="flex-end">
            {fields.tokens === null ? null : <Text dimColor>{fields.tokens}</Text>}
          </Box>
        )}
        {withBar && showBars ? (
          <Box flexShrink={0} marginLeft={2}>
            <Text color={barColor(fields.status)}>{fields.bar}</Text>
          </Box>
        ) : null}
      </Box>
    )

    /** The line of an agent, the main one or a subagent: its mark, name and model on the left (they give way to the width) and `right` after them. */
    const agentLine = (row: PaneRow, right: ReturnType<typeof cells>) => (
      <Box>
        {markCell(row.mark, SUBAGENT_TONE[row.status])}
        <Box flexGrow={1} flexShrink={1}>
          <Box flexShrink={1}>
            <Text wrap="truncate-end" bold={row.status === 'working' || row.status === 'needsYou'}>
              {row.name}
            </Text>
          </Box>
          {row.detail === null ? null : (
            <Box flexShrink={1} marginLeft={1}>
              <Text wrap="truncate-end" dimColor>
                {`· ${row.detail}`}
              </Text>
            </Box>
          )}
        </Box>
        {right}
      </Box>
    )

    /** A dim line under an agent's name, indented past the mark. */
    const noteLine = (text: string) => (
      <Box>
        <Box flexShrink={0} width={2} />
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end" dimColor>
            {text}
          </Text>
        </Box>
      </Box>
    )

    /** The heading of the current run: a pulsing green mark while anything runs (yellow while it waits for the person), the end mark dimmed once all ended; the total time and tokens at the right. */
    const runHeading = (current: PaneCurrent | null) => {
      if (current === null) return heading(markCell('●', undefined, true), t.currentRun)

      const total = [`${t.totalTime} · ${current.time}`, ...(current.tokens !== null && showTokens ? [`${current.tokens} ${t.tokens}`] : [])].join(' · ')

      return heading(markCell(current.mark, current.tone === 'working' ? GREEN : TONE[current.tone], !current.isRunning || !current.isLit), t.currentRun, total)
    }

    /** The whole run of the turn in progress. */
    const currentBlock = (current: PaneCurrent) => {
      const agents = [current.leader, ...current.agents]
      const widths = widthsOf(
        agents.map(row => row.time),
        agents.map(row => row.tokens)
      )

      return (
        <Box flexDirection="column">
          <Box>
            <Box flexShrink={1}>
              <Text wrap="truncate-end">{current.title}</Text>
            </Box>
            {current.reason === null ? null : (
              <Box flexShrink={0}>
                <Text wrap="truncate-end" dimColor>
                  {` · ${current.reason}`}
                </Text>
              </Box>
            )}
          </Box>
          <Box key="leader" flexDirection="column">
            {agentLine(current.leader, cells(current.leader, widths, { text: current.leader.label, color: SUBAGENT_TONE[current.leader.status] }, true))}
            {current.leader.tasks === null ? null : noteLine(current.leader.tasks)}
          </Box>
          <Box key="checklist" flexDirection="column" marginLeft={2}>
            {current.tasks.map((row, index) => (
              <Box key={`task-${index}`}>
                <Box flexShrink={0} width={2}>
                  <Text color={row.status === 'done' ? GREEN : row.status === 'active' ? ACTIVE : undefined} dimColor={row.status === 'upcoming'}>
                    {row.mark}
                  </Text>
                </Box>
                <Box flexShrink={0} width={nameWidth}>
                  <Text wrap="truncate-end" bold={row.status === 'active'} dimColor={row.status !== 'active'}>
                    {row.name}
                  </Text>
                </Box>
                {showBars ? (
                  <Box flexShrink={0} marginLeft={2}>
                    <Text color={row.status === 'done' ? GREEN : row.status === 'active' ? ACTIVE : undefined} dimColor={row.status === 'upcoming'}>
                      {row.bar}
                    </Text>
                  </Box>
                ) : null}
                <Box flexShrink={0} marginLeft={2}>
                  <Text dimColor={row.status !== 'active'}>{row.label}</Text>
                </Box>
              </Box>
            ))}
          </Box>
          {current.agents.length === 0 ? null : (
            <Box key="subagents" flexDirection="column" marginLeft={2}>
              {rule(2)}
              <Box>
                <Box flexGrow={1} flexShrink={1}>
                  <Text wrap="truncate-end" bold dimColor>
                    {t.subagents}
                  </Text>
                </Box>
                <Box flexShrink={0} marginLeft={2}>
                  <Text color={current.active > 0 ? GREEN : undefined} dimColor={current.active === 0}>
                    {t.active(current.active)}
                  </Text>
                </Box>
              </Box>
              {current.agents.map((agent, index) => (
                <Box key={`agent-${agent.id}`} flexDirection="column" paddingLeft={agent.depth * 2}>
                  {index === 0 ? null : rule(2 + agent.depth * 2)}
                  {agentLine(agent, cells(agent, widths, { text: agent.label, color: SUBAGENT_TONE[agent.status] }, true))}
                  {agent.task === null ? null : noteLine(agent.task)}
                  {agent.status === 'working' || agent.status === 'needsYou' ? noteLine(agent.activity) : null}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )
    }

    /** A turn's total tokens with their unit: the group's heading is where the figures are named. */
    const turnTokens = (turn: PaneTurn) => (turn.tokens === null ? null : `${turn.tokens} ${t.tokens}`)

    /** The archived turns, one open group each: the turn's title and final state, then the main agent and the subagents in their final state. */
    const historyBlock = () => {
      const rows = view.turns.flatMap(turn => [turn.leader, ...turn.agents])
      const widths = widthsOf(
        [...rows.map(row => row.time), ...view.turns.map(turn => turn.time)],
        [...rows.map(row => row.tokens), ...view.turns.map(turnTokens)]
      )

      return view.turns.map((turn, index) => (
        <Box key={`turn-${turn.id}`} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
          <Box>
            {markCell(turn.mark, SUBAGENT_TONE[turn.status])}
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end" bold>
                {turn.title}
              </Text>
            </Box>
            {cells({ status: turn.status, time: turn.time, tokens: turnTokens(turn), bar: '' }, widths, { text: turn.label, color: SUBAGENT_TONE[turn.status] }, false)}
          </Box>
          <Box flexDirection="column" paddingLeft={2}>
            {agentLine(turn.leader, cells(turn.leader, widths, { text: turn.leader.tasks ?? '' }, false))}
            {turn.agents.map(agent => (
              <Box key={`turn-${turn.id}-${agent.id}`} flexDirection="column" paddingLeft={agent.depth * 2}>
                {agentLine(agent, cells(agent, widths, { text: agent.label, color: SUBAGENT_TONE[agent.status] }, false))}
                {agent.task === null ? null : noteLine(agent.task)}
              </Box>
            ))}
          </Box>
        </Box>
      ))
    }

    return (
      <Box flexDirection="column">
        <Box key="current-block" flexDirection="column">
          {runHeading(view.current)}
          {view.current === null ? (
            <Text wrap="truncate-end" dimColor>
              {t.ready}
            </Text>
          ) : (
            currentBlock(view.current)
          )}
        </Box>
        <Box key="history-block" flexDirection="column" marginTop={1}>
          {heading(null, t.history, view.turns.length === 0 ? undefined : t.runs(view.turns.length))}
          {view.turns.length === 0 ? (
            <Text wrap="truncate-end" dimColor>
              {t.noFinished}
            </Text>
          ) : (
            historyBlock()
          )}
        </Box>
      </Box>
    )
  })
}
