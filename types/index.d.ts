export type AgentPhase = 'working' | 'needsYou' | 'stuck' | 'stopped' | 'done'

export type SubagentStatus = 'working' | 'needsYou' | 'done' | 'failed' | 'stopped'

export type SubagentState = {
  /** The `agentId` the engine gives the run; two runs of the same agent have different ids. */
  id: string
  sessionId: string
  /** The agent's real name (`subagentType`), never a generic label. */
  name: string
  /** The delegated task, as the spawn gave it; null when it gave none. */
  task: string | null
  /** What it is doing now, from its own tool calls; null until one is seen. */
  activity: string | null
  status: SubagentStatus
  startedAt: number
  finishedAt: number | null
}

export type ChecklistTask = {
  id: string
  name: string
  status: 'done' | 'active' | 'upcoming'
  /** A real percentage only; null draws the indeterminate bar. */
  percent: number | null
  hasReported: boolean
}

export type ClaudeRadarState = {
  claudeRadarEnabled: boolean
  checklist: {
    title: string
    phase: AgentPhase
    tasks: ChecklistTask[]
    needsYouReason: string | null
    stuckReason: string | null
    startedAt: number | null
    finishedAt: number | null
    isCollapsed: boolean
  }
  subagents: Record<string, SubagentState>
  tick: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-radar': {
      claudeRadarState: ClaudeRadarState
    }
  }
}
