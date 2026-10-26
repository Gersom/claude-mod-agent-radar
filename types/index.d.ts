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
  /** The tokens its model requests used, as the API reported them (`turn.step`'s usage, see `tokensOf`); absent until one is seen. */
  tokens?: number
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

/** A turn that ended and was archived: what the person asked, how it ended, the main agent's share and the subagents it started. */
export type TurnRecord = {
  /** The turn's start time as text, made unique among the archived ones. */
  id: string
  /** The title from the prompt, tidied; null when it left nothing to name the turn by (the drawing says so in the language). */
  title: string | null
  /** Done when it was answered, stopped when it was cut off, failed when an error or a refusal ended it. */
  status: 'done' | 'stopped' | 'failed'
  startedAt: number
  /** When the main agent and every subagent had ended. */
  finishedAt: number
  /** The tokens of the whole turn: the main agent's and every subagent's. */
  tokens: number
  /** The main agent: its model and effort, how many of its checklist's tasks were done and the tokens it used. */
  leader: { modelInfo?: ModelInfo; tasksDone: number; tasksTotal: number; tokens: number; finishedAt: number }
  /** The subagents of the turn, in start order, each in its final state. */
  agents: SubagentState[]
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
  /** The tokens the main agent used in the current turn, from its model requests; absent (zero) until one is seen, and gone again when the turn starts or is archived. */
  leaderTokens?: number
  /** The subagents of the current turn, working or finished, until the turn is archived. */
  subagents: Record<string, SubagentState>
  /** The turns that ended, the most recent first, at most 10; the detail pane lists them. */
  turns: TurnRecord[]
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
