import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { buttonLabel, initialState } from './claude-radar'

/** The key of `$.store` that keeps the ON/OFF choice between sessions. */
const STORE_KEY = 'enabled'

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

/** Turns the radar ON or OFF, saves the choice and says so with a brief toast. */
const setEnabled = async ($: EngineInterface, enabled: boolean) => {
  await update($, radar, state => ({ ...state, claudeRadarEnabled: enabled }))

  try {
    await $.store.set(STORE_KEY, enabled)
  } catch {
    // Not saved: the choice still holds for this session.
  }

  $.ui.toast(`Claude Radar: ${enabled ? 'ON' : 'OFF'}`)
}

/** Claude Radar: a passive monitor. This step draws the header with the ON/OFF button; the rest comes in the next steps. */
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await ensureEnabled($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Other hooks' bands stay; a survey keeps the band to itself.
    const below = await next(e)

    if (e.props.hasSurvey) return below

    const enabled = (await read($, radar)).claudeRadarEnabled
    const { Box, Button } = $.ui.resolve(e)

    // The button stays visible whether the radar is ON or OFF, and whether Claude is idle or working.
    const header = (
      <Box justifyContent="flex-end">
        <Button key="toggle" plain dimColor onPress={() => void setEnabled($, !enabled)}>
          {buttonLabel(enabled)}
        </Button>
      </Box>
    )

    return (
      <Box flexDirection="column">
        {header}
        {below}
      </Box>
    )
  })
}
