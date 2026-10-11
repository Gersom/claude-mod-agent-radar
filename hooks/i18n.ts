import type { ActivityCode, AgentPhase, ChecklistTask, Lang, ReasonCode, SubagentStatus } from '../types'

/** Every word the radar writes itself, in one language. Names and titles that come from the person's text are never in here. */
export type Texts = {
  lang: Lang
  /** The mod's proper name: the same in every language. */
  name: string
  /** `Detail` (`Detalle`): the band's button that opens the pane. */
  detail: string
  /** `Close` (`Cerrar`): the same button while the pane is open. */
  close: string
  /** `Claude Radar: ON`: the ON/OFF button's text, and the toast that says the choice changed. */
  toggle: (enabled: boolean) => string
  /** The toast for a surface that places no panes; `reason` is the engine's own words, as it gave them. */
  paneUnavailable: (reason: string | null) => string
  /** `Now` (`Ahora`): the pane's section on the turn. */
  now: string
  /** `Subagents` (`Subagentes`). */
  subagents: string
  /** `2 active` (`2 activos`). */
  active: (count: number) => string
  /** `History` (`Historial`). */
  history: string
  /** What the pane says when there is nothing at all to show. */
  nothing: string
  /** What the history says while it is empty. */
  noFinished: string
  /** The main turn's phase. */
  phase: Record<AgentPhase, string>
  /** Why the turn waits or is stuck. */
  reason: Record<ReasonCode, string>
  /** A checklist task's status. */
  task: Record<ChecklistTask['status'], string>
  /** A subagent's status. */
  agent: Record<SubagentStatus, string>
  /** What a subagent is doing, from its tools. */
  activity: Record<ActivityCode, string>
  /** A subagent's activity while none is known. */
  working: string
  /** The title of a turn whose prompt leaves nothing to name it by, and the checklist's one line when there are no tasks. */
  defaultTitle: string
  /** The name of a task whose text leaves nothing valid. */
  workingOnIt: string
  /** The one line the typeahead shows for `/agent-radar`. */
  commandDescription: string
  /** What `/agent-radar` answers to an argument it does not know. */
  commandUsage: string
  /** What `/agent-radar` answers once the pane is open. */
  paneOpened: string
  /** What `/agent-radar` answers once the pane is closed. */
  paneClosed: string
  /** What `/agent-radar` answers while the radar is OFF: it opens nothing. */
  radarOff: string
}

/** The mod's proper name, which is not translated; also the pane's title. */
export const NAME = 'Claude Radar'

/** The language the radar speaks when settings.language names none it knows. */
export const DEFAULT_LANG: Lang = 'en'

export const TEXTS: Record<Lang, Texts> = {
  es: {
    lang: 'es',
    name: NAME,
    detail: 'Detalle',
    close: 'Cerrar',
    toggle: enabled => `Claude Radar: ${enabled ? 'ON' : 'OFF'}`,
    paneUnavailable: reason => `El panel de detalle no está disponible aquí${reason ? `: ${reason}` : ''}`,
    now: 'Ahora',
    subagents: 'Subagentes',
    active: count => `${count} ${count === 1 ? 'activo' : 'activos'}`,
    history: 'Historial',
    nothing: 'Aún no hay nada en marcha',
    noFinished: 'Aún no hay subagentes terminados',
    phase: { working: 'Trabajando', needsYou: 'Te necesita', stuck: 'Atascado', stopped: 'Detenido', done: 'Todo listo' },
    reason: {
      permission: 'Esperando tu permiso',
      error: 'El turno terminó con un error',
      refusal: 'El modelo se negó a responder'
    },
    task: { done: 'Hecho', active: 'En curso', upcoming: 'Siguiente' },
    agent: { working: 'Trabajando', needsYou: 'Te necesita', done: 'Hecho', failed: 'Falló', stopped: 'Detenido' },
    activity: {
      reading: 'Leyendo archivos del proyecto',
      searching: 'Buscando información del proyecto',
      updating: 'Actualizando archivos del proyecto',
      testing: 'Ejecutando pruebas',
      command: 'Ejecutando un comando',
      delegating: 'Delegando trabajo'
    },
    working: 'Trabajando',
    defaultTitle: 'Trabajando en tu petición',
    workingOnIt: 'En ello',
    commandDescription: 'Abre o cierra el panel de detalle de Claude Radar.',
    commandUsage: 'Uso: /agent-radar [open|close]. Sin argumento, alterna el panel.',
    paneOpened: 'Panel de detalle abierto',
    paneClosed: 'Panel de detalle cerrado',
    radarOff: 'Claude Radar está apagado (OFF). Enciéndelo con su botón.'
  },
  en: {
    lang: 'en',
    name: NAME,
    detail: 'Detail',
    close: 'Close',
    toggle: enabled => `Claude Radar: ${enabled ? 'ON' : 'OFF'}`,
    paneUnavailable: reason => `The detail pane is not available here${reason ? `: ${reason}` : ''}`,
    now: 'Now',
    subagents: 'Subagents',
    active: count => `${count} active`,
    history: 'History',
    nothing: 'Nothing running yet',
    noFinished: 'No finished subagents yet',
    phase: { working: 'Working', needsYou: 'Needs you', stuck: 'Stuck', stopped: 'Stopped', done: 'All done' },
    reason: {
      permission: 'Waiting for your permission',
      error: 'The turn ended with an error',
      refusal: 'The model declined to answer'
    },
    task: { done: 'Done', active: 'Working', upcoming: 'Next' },
    agent: { working: 'Working', needsYou: 'Needs you', done: 'Done', failed: 'Failed', stopped: 'Stopped' },
    activity: {
      reading: 'Reading project files',
      searching: 'Searching project information',
      updating: 'Updating project files',
      testing: 'Running tests',
      command: 'Running a command',
      delegating: 'Delegating work'
    },
    working: 'Working',
    defaultTitle: 'Working on your request',
    workingOnIt: 'Working on it',
    commandDescription: 'Open or close the Claude Radar detail pane.',
    commandUsage: 'Usage: /agent-radar [open|close]. With no argument, it toggles the pane.',
    paneOpened: 'Detail pane opened',
    paneClosed: 'Detail pane closed',
    radarOff: 'Claude Radar is OFF. Turn it on with its button.'
  }
}

export const textsOf = (lang: Lang) => TEXTS[lang]

/** The first word of the setting's value in lowercase letters, accents and case gone: `Español` is `espanol`. */
const firstWord = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .find(word => word !== '') ?? ''

const SPANISH = ['es', 'esp', 'spa', 'spanish', 'espanol', 'castellano']

/**
 * The radar's language for the value of `settings.language` (free text: `spanish`, `Español`, `es-MX`...).
 * Spanish when it names Spanish; any other value, or none, gives the default, English.
 */
export const detectLang = (language: unknown): Lang =>
  typeof language === 'string' && SPANISH.includes(firstWord(language)) ? 'es' : DEFAULT_LANG
