import { expect, test } from 'claude-code/testing'

import { initialState } from './claude-radar'

test('starts on, with nothing running and nothing to show', async () => {
  const state = initialState()

  expect(state.claudeRadarEnabled).toBe(true)
  expect(state.checklist.tasks).toEqual([])
  expect(state.subagents).toEqual({})
})
