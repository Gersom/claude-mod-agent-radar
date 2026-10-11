import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ClaudeRadarState } from '../types'

import {
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
  pruneFinished,
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

      await change($,state => ({ ...state, claudeRadarEnabled: enabled }))
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
    const state = await change($,current => advance(current, time))

    if (!state.claudeRadarEnabled || !isLive(state)) stop()
  })
}

/** Turns the radar ON or OFF, saves the choice and says so with a brief toast. */
const setEnabled = async ($: EngineInterface, enabled: boolean) => {
  await change($,state => ({ ...state, claudeRadarEnabled: enabled }))

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

    await change($,state => pruneFinished(collapseIfDue(state, time), time))
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

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const time = await $.clock.now()

    await change($,state => startTurn(state, e.text, time))
    await start($)

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const id = result.agentId

    // A refused spawn started nothing; every run that did start is its own entry, by its id.
    if (id !== undefined) {
      const time = await $.clock.now()

      await change($,state =>
        spawnSubagent(state, { id, name: e.subagentType, task: e.description, parentId: e.parentAgentId }, time)
      )
      await start($)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const time = await $.clock.now()

    if (e.agentId === undefined) {
      await change($,state => finishTurn(state, e.reason, time))
      await start($)
    } else {
      // A subagent's turn ends that subagent, never the main one; an agent not followed changes nothing.
      const id = e.agentId

      await change($,state => finishSubagent(state, id, e.reason, time))
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      // A subagent's call: its activity, said in plain words, and the wait for the person (if any) is over.
      const id = e.agentId
      const activity = activityOf(e.tool, e.tool === 'Bash' ? e.command : undefined)

      await change($,state => workSubagent(state, id, activity))

      return next(e)
    }

    const ran = await next(e)

    // The call is over, whether the person allowed it or not: Claude is working again.
    await change($,state => resumeWork(state))

    if (didRun(ran)) {
      if (e.tool === 'TodoWrite') {
        await change($,state => writeTodos(state, e.todos))
      } else if (e.tool === 'TaskCreate') {
        const id = taskIdOf(ran.result, e.tool_use_id)

        await change($,state => addTask(state, id, e.subject))
      } else if (e.tool === 'TaskUpdate') {
        await change($,state => updateTask(state, e.taskId, { status: e.status, subject: e.subject }))
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
        await change($,state => askUser(state))
      } else {
        const id = e.agentId

        await change($,state => askSubagent(state, id))
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
    const { Box, Button, Text } = $.ui.resolve(e)

    // The button stays visible whether the radar is ON or OFF, and whether Claude is idle or working.
    const button = (
      <Button key="toggle" plain dimColor onPress={() => void setEnabled($, !enabled)}>
        {buttonLabel(enabled)}
      </Button>
    )

    // OFF, or an agent that never worked and no subagent to show: the button alone, as before.
    if (!enabled || (checklist.startedAt === null && Object.keys(subagents).length === 0)) {
      return (
        <Box flexDirection="column">
          <Box justifyContent="flex-end">{button}</Box>
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
          {button}
        </Box>
      </Box>
    )

    // No turn yet (only subagents to show): there is no title, the button alone heads the block.
    const header = checklist.startedAt === null ? <Box justifyContent="flex-end">{button}</Box> : titled

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
}
