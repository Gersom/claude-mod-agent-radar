import type { ClaudeRadarState } from '../types'

/** The radar's state before anything has happened: on by default, nothing running, nothing to show. */
export const initialState = (): ClaudeRadarState => ({
  claudeRadarEnabled: true,
  checklist: {
    title: '',
    phase: 'done',
    tasks: [],
    needsYouReason: null,
    stuckReason: null,
    startedAt: null,
    finishedAt: null,
    isCollapsed: true
  },
  subagents: {},
  tick: 0
})

/** The label of the header's button. */
export const buttonLabel = (enabled: boolean) => `[ ● Claude Radar: ${enabled ? 'ON' : 'OFF'} ]`
