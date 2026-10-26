import type { ActivityCode, Lang, ReasonCode, SubagentStatus } from '../types'

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
  /** `Current run` (`Ejecución actual`): the pane's section on the turn that runs now. */
  currentRun: string
  /** `Main agent` (`Agente principal`): the name of the agent the person talks to. */
  mainAgent: string
  /** What the current run says when no turn is open. */
  ready: string
  /** `History` (`Historial`): the pane's section on the turns that ended. */
  history: string
  /** What the pane says when there is nothing at all to show. */
  nothing: string
  /** What the history says while it is empty. */
  noFinished: string
  /** `tokens`: the unit written after a figure of tokens. */
  tokens: string
  /** `Subagents` (`Subagentes`): the title of the block of the turn's subagents. */
  subagents: string
  /** `3 active` (`3 activos`): how many subagents are at work, in the title of their block. */
  active: (count: number) => string
  /** `6 runs` (`6 ejecuciones`): how many turns the history holds, in its heading. */
  runs: (count: number) => string
  /** Why the turn waits or is stuck. */
  reason: Record<ReasonCode, string>
  /** A subagent's status. */
  agent: Record<SubagentStatus, string>
  /** What a subagent is doing, from its tools. */
  activity: Record<ActivityCode, string>
  /** The title of a turn whose prompt leaves nothing to name it by, and the checklist's one line when there are no tasks. */
  defaultTitle: string
  /** The name of a task whose text leaves nothing valid. */
  workingOnIt: string
  /** `Hide` (`Ocultar`): the band's button that takes the band off the prompt. */
  hide: string
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
  /** What `/agent-radar hide` answers (and the button's toast): the band is gone, and how to bring it back. */
  bandHidden: string
  /** What `/agent-radar show` answers: the band is back. */
  bandShown: string
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
    hide: 'Ocultar',
    toggle: enabled => `Claude Radar: ${enabled ? 'ON' : 'OFF'}`,
    paneUnavailable: reason => `El panel de detalle no está disponible aquí${reason ? `: ${reason}` : ''}`,
    currentRun: 'Ejecución actual',
    mainAgent: 'Agente principal',
    ready: 'Todo listo, esperando instrucciones',
    history: 'Historial',
    nothing: 'Aún no hay nada en marcha',
    noFinished: 'Aún no hay turnos terminados',
    tokens: 'tokens',
    subagents: 'Subagentes',
    active: count => (count === 1 ? '1 activo' : `${count} activos`),
    runs: count => (count === 1 ? '1 ejecución' : `${count} ejecuciones`),
    reason: {
      permission: 'Esperando tu permiso',
      error: 'El turno terminó con un error',
      refusal: 'El modelo se negó a responder'
    },
    agent: { working: 'Trabajando', needsYou: 'Te necesita', done: 'Hecho', failed: 'Falló', stopped: 'Detenido' },
    activity: {
      reading: 'Leyendo archivos del proyecto',
      searching: 'Buscando información del proyecto',
      updating: 'Actualizando archivos del proyecto',
      testing: 'Ejecutando pruebas',
      command: 'Ejecutando un comando',
      delegating: 'Delegando trabajo'
    },
    defaultTitle: 'Trabajando en tu petición',
    workingOnIt: 'En ello',
    commandDescription: 'Abre o cierra el panel de detalle de Claude Radar, o muestra u oculta su banda.',
    commandUsage: 'Uso: /agent-radar [open|close|hide|show]. Sin argumento, alterna el panel.',
    paneOpened: 'Panel de detalle abierto',
    paneClosed: 'Panel de detalle cerrado',
    radarOff: 'Claude Radar está apagado (OFF). Enciéndelo con su botón.',
    bandHidden: 'Banda oculta. Vuelve a mostrarla con /agent-radar show',
    bandShown: 'Banda visible'
  },
  en: {
    lang: 'en',
    name: NAME,
    detail: 'Detail',
    close: 'Close',
    hide: 'Hide',
    toggle: enabled => `Claude Radar: ${enabled ? 'ON' : 'OFF'}`,
    paneUnavailable: reason => `The detail pane is not available here${reason ? `: ${reason}` : ''}`,
    currentRun: 'Current run',
    mainAgent: 'Main agent',
    ready: 'All done, ready for more instructions',
    history: 'History',
    nothing: 'Nothing running yet',
    noFinished: 'No finished turns yet',
    tokens: 'tokens',
    subagents: 'Subagents',
    active: count => `${count} active`,
    runs: count => (count === 1 ? '1 run' : `${count} runs`),
    reason: {
      permission: 'Waiting for your permission',
      error: 'The turn ended with an error',
      refusal: 'The model declined to answer'
    },
    agent: { working: 'Working', needsYou: 'Needs you', done: 'Done', failed: 'Failed', stopped: 'Stopped' },
    activity: {
      reading: 'Reading project files',
      searching: 'Searching project information',
      updating: 'Updating project files',
      testing: 'Running tests',
      command: 'Running a command',
      delegating: 'Delegating work'
    },
    defaultTitle: 'Working on your request',
    workingOnIt: 'Working on it',
    commandDescription: 'Open or close the Claude Radar detail pane, or show or hide its band.',
    commandUsage: 'Usage: /agent-radar [open|close|hide|show]. With no argument, it toggles the pane.',
    paneOpened: 'Detail pane opened',
    paneClosed: 'Detail pane closed',
    radarOff: 'Claude Radar is OFF. Turn it on with its button.',
    bandHidden: 'Band hidden. Bring it back with /agent-radar show',
    bandShown: 'Band shown'
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
