import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  TICK_MS,
  addTask,
  advance,
  askUser,
  buttonLabel,
  collapseIfDue,
  didRun,
  finishTurn,
  headlineOf,
  initialState,
  isLive,
  layoutOf,
  resumeWork,
  rowsOf,
  startTurn,
  taskIdOf,
  updateTask,
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

/** The radar's state: what the header and the next panels draw from. */
const radar = atom({ plugin: 'agent-radar', key: 'claudeRadarState' } as const, initialState())

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

      await update($, radar, state => ({ ...state, claudeRadarEnabled: enabled }))
    }
  })()

  return restoring
}

/** The one timer that moves the animation and folds the finished panel; a reload starts the module over, without it. */
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
    const state = await update($, radar, current => advance(current, time))

    if (!state.claudeRadarEnabled || !isLive(state)) stop()
  })
}

/** Turns the radar ON or OFF, saves the choice and says so with a brief toast. */
const setEnabled = async ($: EngineInterface, enabled: boolean) => {
  await update($, radar, state => ({ ...state, claudeRadarEnabled: enabled }))

  try {
    await $.store.set(STORE_KEY, enabled)
  } catch {
    // Not saved: the choice still holds for this session.
  }

  if (!enabled) {
    stop()
  } else if (isLive(await read($, radar))) {
    // Back ON in the middle of a turn: what folded while nobody looked folds now, and the timer goes on.
    const time = await $.clock.now()

    await update($, radar, state => collapseIfDue(state, time))
    await start($)
  }

  $.ui.toast(`Claude Radar: ${enabled ? 'ON' : 'OFF'}`)
}

/** Claude Radar: a passive monitor of the main agent. It only watches the events go by and draws; nothing it sees is changed. */
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

    await update($, radar, state => startTurn(state, e.text, time))
    await start($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's turn is not the main one's: the next step watches those.
    if (e.agentId === undefined) {
      const time = await $.clock.now()

      await update($, radar, state => finishTurn(state, e.reason, time))
      await start($)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)

    if (e.agentId !== undefined) return ran

    // The call is over, whether the person allowed it or not: Claude is working again.
    await update($, radar, state => resumeWork(state))

    if (didRun(ran)) {
      if (e.tool === 'TodoWrite') {
        await update($, radar, state => writeTodos(state, e.todos))
      } else if (e.tool === 'TaskCreate') {
        const id = taskIdOf(ran.result, e.tool_use_id)

        await update($, radar, state => addTask(state, id, e.subject))
      } else if (e.tool === 'TaskUpdate') {
        await update($, radar, state => updateTask(state, e.taskId, { status: e.status, subject: e.subject }))
      }
    }

    return ran
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)

    // `ask` puts the call to the person (in some modes to a classifier); the tool.call that follows lifts the mark.
    // Only the model's own calls count: another plugin's `$.tool.check` query asks, it does not wait for anyone.
    if (e.agentId === undefined && next.origin.plugin === 'engine' && verdict.decision === 'ask') {
      await update($, radar, state => askUser(state))
    }

    return verdict
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Other hooks' bands stay; a survey keeps the band to itself.
    const below = await next(e)

    if (e.props.hasSurvey) return below

    const { claudeRadarEnabled: enabled, checklist, tick } = await read($, radar)
    const { Box, Button, Text } = $.ui.resolve(e)

    // The button stays visible whether the radar is ON or OFF, and whether Claude is idle or working.
    const button = (
      <Button key="toggle" plain dimColor onPress={() => void setEnabled($, !enabled)}>
        {buttonLabel(enabled)}
      </Button>
    )

    // OFF, or an agent that never worked: the button alone, as before.
    if (!enabled || checklist.startedAt === null) {
      return (
        <Box flexDirection="column">
          <Box justifyContent="flex-end">{button}</Box>
          {below}
        </Box>
      )
    }

    const head = headlineOf(checklist, await $.clock.now())
    // Working: the title gives way to the time; otherwise the reason gives way to the label.
    const isTitleFirst = head.tone === 'working'

    const header = (
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

    // Folded: one line, no frame.
    if (checklist.isCollapsed) {
      return (
        <Box flexDirection="column">
          {header}
          {below}
        </Box>
      )
    }

    const rows = rowsOf(checklist, tick)
    const { showBars, nameWidth } = layoutOf(rows, e.props.bodyColumns)

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
