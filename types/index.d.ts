/** The languages the radar speaks. */
export type Lang = 'es' | 'en'

/** What a subagent is doing, as a code the drawing puts in words (so the state holds no phrase of any language). */
export type ActivityCode = 'reading' | 'searching' | 'updating' | 'testing' | 'command' | 'delegating'

/** Why the turn waits or is stuck, as a code the drawing puts in words. */
export type ReasonCode = 'permission' | 'error' | 'refusal'

export type AgentPhase = 'working' | 'needsYou' | 'stuck' | 'stopped' | 'done'

export type SubagentStatus = 'working' | 'needsYou' | 'done' | 'failed' | 'stopped'

/** The model a request names and how hard it asks it to think; `effort` is null for a model that takes none. */
export type ModelInfo = {
  model: string
  effort: string | null
}

export type SubagentState = {
  /** The `agentId` the engine gives the run; two runs of the same agent have different ids. */
  id: string
  sessionId: string
  /** The agent's real name (`subagentType`), never a generic label. */
  name: string
  /** The delegated task, as the spawn gave it; null when it gave none. */
  task: string | null
  /** What it is doing now, from its own tool calls; null until one is seen. */
  activity: ActivityCode | null
  status: SubagentStatus
  /** The id of the agent whose loop spawned it (`parentAgentId`); absent when the main loop did, so no hierarchy is drawn without it. */
  parentId?: string
  /** Its model and effort, from the spawn and then from each of its model requests (`turn.step`); absent until one is seen. */
  modelInfo?: ModelInfo
  startedAt: number
  finishedAt: number | null
}

export type ChecklistTask = {
  id: string
  /** The task as the text gave it, tidied; empty when nothing valid was left (the drawing says so in the language). */
  name: string
  status: 'done' | 'active' | 'upcoming'
  /** A real percentage only; null draws the indeterminate bar. */
  percent: number | null
  hasReported: boolean
}

export type ClaudeRadarState = {
  claudeRadarEnabled: boolean
  checklist: {
    /** The title from the prompt, tidied; null when it left nothing to name the turn by (the drawing says so in the language). */
    title: string | null
    phase: AgentPhase
    tasks: ChecklistTask[]
    needsYouReason: ReasonCode | null
    stuckReason: ReasonCode | null
    startedAt: number | null
    finishedAt: number | null
  }
  /** The main agent's model and effort, from its model requests; absent until one is seen. */
  leaderModel?: ModelInfo
  subagents: Record<string, SubagentState>
  /** The subagents that finished, the most recent first, at most 50, one entry per id; the detail pane lists it. */
  history: SubagentState[]
  tick: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-radar': {
      claudeRadarState: ClaudeRadarState
      /** Whether the tool rows are hidden now (see `hidesTools`); kept apart from the state so the transcript redraws on a change of phase, not on every tick. */
      claudeRadarHidesTools: boolean
      /** Whether the detail pane is open: set when the button opens it, cleared when it closes by any hand. */
      claudeRadarPaneOpen: boolean
      /** Whether the band is taken off the prompt (the radar itself keeps working); saved in the store between sessions. */
      claudeRadarBandHidden: boolean
      /** The radar's language, settled from settings.language the first time; null until then. */
      claudeRadarLang: Lang | null
    }
  }
}
