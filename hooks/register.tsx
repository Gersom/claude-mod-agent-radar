import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ClaudeRadarState } from '../types'

import {
  PANE_COLUMNS,
  PANE_ID,
  PANE_ROWS,
  PANE_TITLE,
  TICK_MS,
  activityOf,
  addTask,
  advance,
  askSubagent,
  askUser,
  buttonLabel,
  collapseIfDue,
  didRun,
  finishSubagent,
  finishTurn,
  headlineOf,
  hidesTools,
  initialState,
  isLive,
  layoutOf,
  paneButtonLabel,
  paneOf,
  pruneFinished,
  resetSession,
  resumeWork,
  rowsOf,
  spawnSubagent,
  startTurn,
  subagentViewOf,
  taskIdOf,
  updateTask,
  workSubagent,
  writeTodos
} from './claude-radar'
import type { PaneAgent } from './claude-radar'

/** The key of `$.store` that keeps the ON/OFF choice between sessions. */
const STORE_KEY = 'enabled'

const BORDER_COLOR = '#4b5563'

/** The colour of the header's first words by phase; `undefined` leaves the default. */
const TONE = {
  working: undefined,
  needsYou: '#facc15',
  stuck: '#ef4444',
  stopped: '#fb923c',
  done: '#22c55e'
} as const

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

/** The radar's state: what the header and the next panels draw from. */
const radar = atom({ plugin: 'agent-radar', key: 'claudeRadarState' } as const, initialState())

/** Whether the tool rows are hidden: the one value the transcript's rows read, so they redraw when it flips and not on every tick of the state. */
const hideTools = atom({ plugin: 'agent-radar', key: 'claudeRadarHidesTools' } as const, false)

/** Whether the detail pane is open: set when the button opens it, cleared when it closes, whoever closes it. */
const paneOpen = atom({ plugin: 'agent-radar', key: 'claudeRadarPaneOpen' } as const, false)

/** Applies `fn` to the radar's state and keeps `hideTools` in step with it, written only when it changes. */
const change = async ($: EngineInterface, fn: (state: ClaudeRadarState) => ClaudeRadarState) => {
  const state = await update($, radar, fn)
  const hides = hidesTools(await read($, radar))

  if ((await read($, hideTools)) !== hides) await update($, hideTools, () => hides)

  return state
}

/** The one restore of the saved choice per load of the module (a reload starts it over); shared, so no draw reads the flag before it ends. */
let restoring: Promise<void> | null = null

/** Puts the saved ON/OFF choice into the state; a store that cannot be read leaves the default, ON. */
const ensureEnabled = ($: EngineInterface) => {
  restoring ??= (async () => {
    let saved: unknown

    try {
      saved = await $.store.get(STORE_KEY)
    } catch {
      // No store to read: the default, ON.
    }

    if (typeof saved === 'boolean') {
      const enabled = saved

      await change($, state => ({ ...state, claudeRadarEnabled: enabled }))
    }
  })()

  return restoring
}

/** The one timer that moves the animation, folds the finished panel and retires finished subagents; a reload starts the module over, without it. */
let ticker: { cancel: () => void } | null = null

const stop = () => {
  ticker?.cancel()
  ticker = null
}

/** Starts the timer unless it runs or the radar is OFF (nothing moves then); it stops itself once there is nothing left to move. */
const start = async ($: EngineInterface) => {
  if (ticker !== null) return

  await ensureEnabled($)

  if (ticker !== null || !(await read($, radar)).claudeRadarEnabled) return

  ticker = $.clock.every(TICK_MS, async () => {
    const time = await $.clock.now()
    const state = await change($, current => advance(current, time))

    if (!state.claudeRadarEnabled || !isLive(state)) stop()
  })
}

/** Closes the detail pane if it is open and clears the flag here: the engine leaves a plugin's own hook out of the close the plugin makes, so the `ui.close` hook below only hears the person's. */
const closePane = async ($: EngineInterface) => {
  if (!(await read($, paneOpen))) return

  await $.ui.close({ id: PANE_ID })
  await update($, paneOpen, () => false)
}

/** The detail button: opens the pane, or closes it if it is open. Only a press opens it, never the radar on its own. A surface that places no panes gets a toast and no pane left waiting. */
const togglePane = async ($: EngineInterface) => {
  if (await read($, paneOpen)) return closePane($)

  const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE, rows: PANE_ROWS, columns: PANE_COLUMNS })

  if (opened.isPlaced) {
    await update($, paneOpen, () => true)
  } else {
    // Open but undrawn: leave nothing waiting to pop up later on its own.
    await $.ui.close({ id: PANE_ID })
    $.ui.toast('The detail pane is not available here')
  }
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

  if (!enabled) {
    stop()
  } else if (isLive(await read($, radar))) {
    // Back ON in the middle of a turn: what folded or retired while nobody looked goes now, and the timer goes on.
    const time = await $.clock.now()

    await change($, state => pruneFinished(collapseIfDue(state, time), time))
    await start($)
  }

  $.ui.toast(`Claude Radar: ${enabled ? 'ON' : 'OFF'}`)
}

/** Claude Radar: a passive monitor of the main agent and its subagents. It only watches the events go by and draws; nothing it sees is changed. */
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await ensureEnabled($)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stop()
    // A new session starts clean: what was followed, the history included, goes; the ON/OFF choice stays.
    await change($, state => resetSession(state))

    return next(e)
  })

  // The person's close mark or key leaves the flag, and so the button, in step with the pane (the button's own close clears it in `closePane`).
  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    const closed = await next(e)

    await update($, paneOpen, () => false)

    return closed
  })

  on('turn.start', async ($, e, next) => {
    const time = await $.clock.now()

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

      await change($, state =>
        spawnSubagent(state, { id, name: e.subagentType, task: e.description, parentId: e.parentAgentId }, time)
      )
      await start($)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const time = await $.clock.now()

    if (e.agentId === undefined) {
      await change($, state => finishTurn(state, e.reason, time))
      await start($)
    } else {
      // A subagent's turn ends that subagent, never the main one; an agent not followed changes nothing.
      const id = e.agentId

      await change($, state => finishSubagent(state, id, e.reason, time))
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Other hooks' bands stay; a survey keeps the band to itself.
    const below = await next(e)

    if (e.props.hasSurvey) return below

    const { claudeRadarEnabled: enabled, checklist, subagents, tick } = await read($, radar)
    const isPaneOpen = await read($, paneOpen)
    const { Box, Button, Text } = $.ui.resolve(e)

    // The button stays visible whether the radar is ON or OFF, and whether Claude is idle or working.
    const button = (
      <Button key="toggle" plain dimColor onPress={() => void setEnabled($, !enabled)}>
        {buttonLabel(enabled)}
      </Button>
    )

    // ON: the detail button beside it, to its left. OFF: the ON/OFF button alone.
    const controls = enabled ? (
      <Box>
        <Box flexShrink={0} marginRight={1}>
          <Button key="pane" plain dimColor onPress={() => void togglePane($)}>
            {paneButtonLabel(isPaneOpen)}
          </Button>
        </Box>
        {button}
      </Box>
    ) : (
      button
    )

    // OFF, or an agent that never worked and no subagent to show: the buttons alone, as before.
    if (!enabled || (checklist.startedAt === null && Object.keys(subagents).length === 0)) {
      return (
        <Box flexDirection="column">
          <Box justifyContent="flex-end">{controls}</Box>
          {below}
        </Box>
      )
    }

    const now = await $.clock.now()
    const head = headlineOf(checklist, now)
    // Working: the title gives way to the time; otherwise the reason gives way to the label.
    const isTitleFirst = head.tone === 'working'

    const titled = (
      <Box>
        <Box flexGrow={1} flexShrink={1}>
          <Box flexShrink={isTitleFirst ? 1 : 0}>
            <Text wrap="truncate-end" bold={!isTitleFirst} color={TONE[head.tone]}>
              {head.label}
            </Text>
          </Box>
          {head.detail === null ? null : (
            <Box flexShrink={isTitleFirst ? 0 : 1}>
              <Text wrap="truncate-end" dimColor>
                {` · ${head.detail}`}
              </Text>
            </Box>
          )}
        </Box>
        <Box flexShrink={0} marginLeft={2}>
          {controls}
        </Box>
      </Box>
    )

    // No turn yet (only subagents to show): there is no title, the button alone heads the block.
    const header = checklist.startedAt === null ? <Box justifyContent="flex-end">{controls}</Box> : titled

    // Folded, the checklist and the main status are one line; the subagents keep their rows.
    const rows = checklist.isCollapsed ? [] : rowsOf(checklist, tick)
    // What the band may take, less the frame, the header and the checklist.
    const view = subagentViewOf(subagents, now, e.props.maxRows - 3 - rows.length, e.props.bodyColumns)

    // Folded and no subagents: one line, no frame.
    if (checklist.isCollapsed && view === null) {
      return (
        <Box flexDirection="column">
          {header}
          {below}
        </Box>
      )
    }

    const { showBars, nameWidth } = layoutOf(rows, e.props.bodyColumns)

    const section =
      view === null ? null : (
        <Box key="subagents" flexDirection="column">
          <Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end" bold>
                Subagents
              </Text>
            </Box>
            <Box flexShrink={0} marginLeft={2}>
              <Text dimColor>{`${view.active} active`}</Text>
            </Box>
          </Box>
          {view.rows.map(row => {
            const isActive = row.status === 'working' || row.status === 'needsYou'

            return (
              <Box key={`sub-${row.id}`} flexDirection="column" paddingLeft={row.depth * 2}>
                <Box>
                  <Box flexShrink={0} width={2}>
                    <Text color={SUBAGENT_TONE[row.status]}>{row.mark}</Text>
                  </Box>
                  <Box flexGrow={1} flexShrink={1}>
                    <Text wrap="truncate-end" bold={isActive} dimColor={!isActive}>
                      {row.name}
                    </Text>
                  </Box>
                  <Box flexShrink={0} marginLeft={2}>
                    <Text dimColor>{row.time}</Text>
                  </Box>
                </Box>
                <Box>
                  <Box flexShrink={0} width={2} />
                  <Box flexGrow={1} flexShrink={1}>
                    <Text wrap="truncate-end" dimColor>
                      {row.activity}
                    </Text>
                  </Box>
                  {view.showStatus ? (
                    <Box flexShrink={0} marginLeft={2}>
                      <Text color={SUBAGENT_TONE[row.status]}>{row.label}</Text>
                    </Box>
                  ) : null}
                </Box>
              </Box>
            )
          })}
          {view.hidden > 0 ? (
            <Text wrap="truncate-end" dimColor>
              {`+${view.hidden} more`}
            </Text>
          ) : null}
        </Box>
      )

    const panel = (
      <Box flexDirection="column" borderStyle="round" borderColor={BORDER_COLOR} paddingX={1}>
        {header}
        {rows.map((row, index) => (
          <Box key={`row-${index}`}>
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
        {section}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {panel}
        {below}
      </Box>
    )
  })

  // The detail pane, opened only by the band's button: the turn, its whole checklist, the subagents at work and the history. It only reads.
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const state = await read($, radar)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)
    const columns = e.props.bodyColumns

    const view = paneOf(state, now, state.tick)

    if (view.isEmpty) {
      return (
        <Box flexDirection="column">
          <Text wrap="truncate-end" dimColor>
            Nothing running yet
          </Text>
        </Box>
      )
    }

    // The body has no frame of its own to take off: the band's four columns of border and padding are added back for `layoutOf`.
    const { showBars, nameWidth } = layoutOf(view.tasks, columns + 4)
    const showStatus = columns + 4 >= 40

    /** A section's title, with an optional figure at the right. */
    const heading = (key: string, title: string, figure?: string) => (
      <Box key={key} marginTop={key === 'now' ? 0 : 1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end" bold>
            {title}
          </Text>
        </Box>
        {figure === undefined ? null : (
          <Box flexShrink={0} marginLeft={2}>
            <Text dimColor>{figure}</Text>
          </Box>
        )}
      </Box>
    )

    /** The name and time line of a subagent, live or finished. */
    const nameLine = (agent: PaneAgent) => (
      <Box>
        <Box flexShrink={0} width={2}>
          <Text color={SUBAGENT_TONE[agent.status]}>{agent.mark}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end" bold={agent.status === 'working' || agent.status === 'needsYou'}>
            {agent.name}
          </Text>
        </Box>
        <Box flexShrink={0} marginLeft={2}>
          <Text dimColor>{agent.time}</Text>
        </Box>
      </Box>
    )

    /** A dim line under a name, indented past the mark. */
    const detailLine = (text: string, status?: PaneAgent) => (
      <Box>
        <Box flexShrink={0} width={2} />
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end" dimColor>
            {text}
          </Text>
        </Box>
        {status === undefined || !showStatus ? null : (
          <Box flexShrink={0} marginLeft={2}>
            <Text color={SUBAGENT_TONE[status.status]}>{status.label}</Text>
          </Box>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {view.now === null ? null : (
          <Box key="now-block" flexDirection="column">
            {heading('now', 'Now')}
            <Text wrap="truncate-end" bold>
              {view.now.title}
            </Text>
            <Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text wrap="truncate-end" color={TONE[view.now.tone]}>
                  {view.now.label}
                </Text>
              </Box>
              <Box flexShrink={0} marginLeft={2}>
                <Text dimColor>{view.now.time}</Text>
              </Box>
            </Box>
            {view.tasks.map((row, index) => (
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
        )}
        {view.live.length === 0 ? null : (
          <Box key="live-block" flexDirection="column">
            {heading('live', 'Subagents', `${view.live.length} active`)}
            {view.live.map(agent => (
              <Box key={`live-${agent.id}`} flexDirection="column" paddingLeft={agent.depth * 2}>
                {nameLine(agent)}
                {agent.task === null ? null : detailLine(agent.task)}
                {detailLine(agent.activity, agent)}
              </Box>
            ))}
          </Box>
        )}
        <Box key="history-block" flexDirection="column">
          {heading('history', 'History', view.history.length === 0 ? undefined : String(view.history.length))}
          {view.history.length === 0 ? (
            <Text wrap="truncate-end" dimColor>
              No finished subagents yet
            </Text>
          ) : (
            view.history.map(agent => (
              <Box key={`history-${agent.id}`} flexDirection="column">
                {nameLine(agent)}
                {detailLine(agent.task === null ? agent.label : `${agent.label} · ${agent.task}`)}
              </Box>
            ))
          )}
        </Box>
      </Box>
    )
  })
}
