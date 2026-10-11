# agent-radar

Hook para Claude Code que dibuja sobre el prompt un monitor pasivo del trabajo en curso: el título de la tarea, el tiempo, una lista de pasos con barras de progreso y, debajo, los subagentes con su nombre real, su actividad y su estado. Mientras Claude trabaja, oculta visualmente las filas técnicas (llamadas a herramientas y sus resultados) y las devuelve al terminar. El título visible es **Claude Radar**.

## Nombre

El identificador del plugin es `agent-radar`: el prefijo `claude-` está reservado. En pantalla se llama «Claude Radar» (el botón dice `Claude Radar: ON/OFF`). La especificación original lo nombra `claude-radar`; ese es el nombre de su documento y del archivo de lógica (`hooks/claude-radar.tsx`), no el del plugin.

## Por qué

Con muchas llamadas a herramientas y varios subagentes en paralelo, la conversación se llena de filas técnicas y cuesta ver qué está haciendo Claude. El radar resume lo observable en un solo bloque y no cuesta tokens: no llama a ningún modelo, no agrega nada al contexto y no cambia lo que Claude hace.

## Cómo se ve

Con el radar en `ON` y Claude trabajando:

```
╭────────────────────────────────────────────────────────────────────────╮
│ Build my landing page · 2m 35s                  [ ● Claude Radar: ON ] │
│ ✓ Analyze project structure     ██████████  Done                       │
│ ▶ Implement authentication      ███░░░░░░░  Working                    │
│ ○ Run final tests               ░░░░░░░░░░  Next                       │
│ Subagents                                                    2 active  │
│ ● frontend-developer                                           1m 20s  │
│   Building login components                                   Working  │
│ ● backend-developer                                               45s  │
│   Reviewing authentication routes                             Working  │
╰────────────────────────────────────────────────────────────────────────╯
```

- Los textos de la interfaz están en inglés; este README, en español.
- La barra de la tarea activa es siempre indeterminada (un bloque de 3 segmentos que se mueve): el radar **nunca inventa porcentajes**. Las hechas llevan la barra llena y las pendientes, vacía.
- Con menos de 40 columnas desaparecen las barras (y, en los subagentes, la columna de estado); los nombres se cortan con `…`, nunca pasan a otra línea.
- Cede ante una encuesta (`hasSurvey`): mientras haya una no dibuja nada.
- Antes del primer turno, o con el radar en `OFF`, solo se ve el botón.

## Comportamiento por estados

El encabezado dice qué pasa con el agente principal:

| Estado | Encabezado | Cuándo |
|---|---|---|
| Trabajando | título de la tarea · tiempo | hay un turno en curso; el título sale del prompt, sin rutas ni código, de 40 caracteres como máximo, cortado por palabras |
| `Needs you` | `Needs you · Waiting for your permission` (amarillo) | el motor pregunta a la persona si permite una llamada |
| `Stuck` | `Stuck · The turn ended with an error` o `· The model declined to answer` (rojo) | el turno terminó por un error o una negativa del modelo |
| `Stopped` | `Stopped` (naranja) | el turno se interrumpió |
| `All done` | `All done · tiempo total` (verde) | el turno terminó bien; el tiempo queda congelado |

Al terminar (cualquiera de los tres últimos) el panel se queda abierto 5 s y luego se pliega a una sola línea, sin marco. Un turno nuevo lo vuelve a abrir sin nada del anterior.

**La lista de pasos** sale solo de lo que Claude ya crea por su cuenta: `TodoWrite`, `TaskCreate` y `TaskUpdate`. El radar no obliga a crear planes ni pide reportes. Si no hay lista, muestra una sola fila `Working on your request` con la barra indeterminada.

## Botón ON/OFF

- Se controla **solo con el botón** `[ ● Claude Radar: ON ]`, a la derecha del encabezado. No hay comandos `/simple`, `/radar` ni ningún otro.
- El botón se ve siempre: en `OFF`, sin turno y con Claude inactivo.
- Al pulsarlo muestra un aviso breve (`Claude Radar: ON` / `Claude Radar: OFF`).
- Estado inicial: `ON`. La elección se guarda en `$.store` (clave `enabled`, el almacén propio del mod, local de cada equipo) y se restaura al empezar la sesión. Si el almacén no se puede leer o escribir, rige `ON` y el cambio vale igual para la sesión.
- En `OFF` se restaura la interfaz normal de Claude Code (las filas técnicas vuelven) y el temporizador se detiene. El botón controla el checklist, los subagentes y la ocultación.

## Subagentes

Debajo del checklist, y solo si hay subagentes, aparece la sección `Subagents` con el contador `N active` (los que trabajan o esperan a la persona).

- **Alta:** el hook `agent.spawn` guarda cada ejecución con su `agentId`; devuelve el resultado del motor tal cual.
- **Nombre real:** el `subagentType` (`frontend-developer`, `Explore`, un agente de un plugin…), nunca una etiqueta genérica; solo se trunca visualmente.
- **Instancias independientes:** dos ejecuciones del mismo agente son dos filas, con su tiempo y su estado propios.
- **Actividad** (dos líneas por subagente: nombre y tiempo, actividad y estado). Sale de los `tool.call` con el `agentId` del subagente, descrita con palabras locales y sin rutas, comandos ni código:

  | Herramienta | Actividad |
  |---|---|
  | `Read` | `Reading project files` |
  | `Glob`, `Grep`, `WebSearch`, `WebFetch` | `Searching project information` |
  | `Edit`, `Write`, `NotebookEdit` | `Updating project files` |
  | `Bash` con `test`, `jest`, `vitest` o `pytest` al inicio de una palabra | `Running tests` |
  | otro `Bash` | `Running a command` |
  | `Agent`, `Task` | `Delegating work` |
  | cualquier otra | la actividad no cambia |

  Mientras no haya ninguna, la fila muestra la tarea delegada (normalizada) o `Working`.
- **Estados:** `●` verde `Working`, `●` amarillo `Needs you`, `✓` `Done`, `✗` `Failed`, `■` `Stopped`. Termina con el `turn.complete` del subagente: `answer` es Done, `aborted` es Stopped, `error` o `refusal` es Failed. El tiempo individual se congela al terminar. La primera finalización manda; si ese agente vuelve a llamar a una herramienta, regresa a `Working`.
- **Retiro:** los terminados se ven ~5 s y salen de la lista. La sección desaparece cuando no queda ninguno.
- **Poco espacio:** se priorizan los activos y se cuenta el resto en `+N more`. Con el panel principal plegado, la sección de subagentes sigue visible, dentro del mismo marco.
- **Jerarquía:** solo si el spawn trae `parentAgentId` y ese padre sigue en la lista; entonces el hijo va debajo de su padre, un nivel adentro. Si no, la lista es plana.
- La finalización de un subagente no cierra el turno principal ni al revés.

## Ocultar información técnica

Con el radar en `ON`, mientras el agente principal trabaja (o haya subagentes activos), el radar dibuja una fila vacía en lugar de `ToolUse`, `ToolResult`, `ToolGroup` y los indicadores de `ToolProgress`. Vuelven solas cuando:

- el turno termina y no queda ningún subagente activo,
- el radar pasa a `OFF`,
- alguien (el principal o un subagente) espera tu permiso: la herramienta que pide permiso queda a la vista.

Es **solo dibujo**: no bloquea, modifica ni cancela herramientas, los resultados de `tool.call` llegan intactos y el historial no se toca. Las filas de una llamada que falló o se interrumpió no se ocultan.

### Protección de la respuesta final

El radar **no engancha** `AssistantMessage`, `UserMessage`, `TurnDuration`, `InfoNotice`, `SessionMode`, `AskUserQuestion`, `PromptHint` ni `CommandOutput`: la respuesta final, los reportes de archivos, los resultados de pruebas, las advertencias y los errores los dibuja siempre el motor. `All done` convive con la respuesta, no la sustituye. Los únicos `ui.render` del mod son `AbovePrompt`, `ToolUse`, `ToolResult`, `ToolGroup` y `ToolProgress`; `claude plugin validate` los lista.

## Consumo de tokens: cero

El mod solo observa eventos y dibuja:

- no llama a ningún modelo (ni para títulos, porcentajes o actividades);
- no engancha `prompt.compose` ni ningún otro `prompt.*`, no inyecta instrucciones ni mensajes en la conversación;
- no registra herramientas, comandos ni agentes, y no crea subagentes de supervisión;
- no lee transcripciones ni archivos de agentes; el estado se actualiza con los eventos que ya pasan;
- los hooks de eventos devuelven `next(e)` o el resultado de `await next(e)` sin tocarlos;
- un único temporizador de 250 ms (animación, plegado y retiro) que corre solo mientras hay algo que mover y se cancela al quedar inactivo o en `OFF`.

## Tipo y fuente de datos

- **Tipo:** hook (plugin de Claude Code).
- **Eventos:** `session.start`, `session.end`, `turn.start`, `turn.complete`, `tool.call`, `tool.check` (para `Needs you`: solo cuenta una pregunta de origen `engine`), `agent.spawn`.
- **Dibujo:** `ui.render` sobre `AbovePrompt` (el panel) y sobre las cuatro filas técnicas.
- **Estado:** `$.state` con dos claves: `claudeRadarState` (todo el estado) y `claudeRadarHidesTools` (si las filas están ocultas; aparte para que la transcripción se redibuje al cambiar de fase y no en cada tic).
- **Almacén y reloj:** `$.store` (clave `enabled`), `$.clock.now()` y `$.clock.every(250, …)`.

## Instalación

Se instala en un paso:

```
/plugin install agent-radar --marketplace Gersom/claude-mod-agent-radar
```

O en dos pasos:

```
/plugin marketplace add Gersom/claude-mod-agent-radar
/plugin install agent-radar@agent-radar
```

Para probarlo desde una carpeta local, sin instalar, en una sesión de terminal:

```bash
claude --plugin-dir .
```

El mod corre con tus permisos, como cualquier plugin; `claude plugin validate` lista los hooks y las llamadas que hace antes de instalarlo. Desarrollado y probado con Claude Code 2.1.296.

### Trasladarlo a otra computadora

El mod es una carpeta sin dependencias:

1. Clona el repositorio (`git clone https://github.com/Gersom/claude-mod-agent-radar`) o copia la carpeta `agent-radar/` completa.
2. En la otra computadora, instálalo con los comandos de arriba, o cárgalo con `claude --plugin-dir <carpeta>`.

Lo que se guarda con el botón (ON/OFF) vive en el almacén local de cada equipo: no viaja con la carpeta; en la otra computadora empieza en `ON`.

## Uso

```bash
claude plugin validate .
claude plugin test .
```

Los tests (77) cubren la lógica pura y los hooks bajo el kit de pruebas del motor, en terminal y escritorio.

## Estructura

```
agent-radar/
├── LICENSE                      # licencia MIT
├── .claude-plugin/
│   ├── plugin.json              # manifiesto del plugin
│   └── marketplace.json         # marketplace de un solo plugin (instalación suelta)
├── hooks/
│   ├── hooks.json               # apunta a register.tsx
│   ├── register.tsx             # hooks, átomos y todo uso de $: dibuja el panel, los subagentes y las filas ocultas
│   ├── claude-radar.tsx         # lógica pura: reducers, formato de filas, barras, tiempos, ocultación
│   └── claude-radar.test.ts     # tests (lógica y render)
└── types/index.d.ts             # contrato del estado ($.state): ClaudeRadarState, SubagentState, claudeRadarHidesTools
```

`tsconfig.json` y `.claude-plugin/types/` los genera Claude Code al cargar el mod y están en `.gitignore`.

## Restricciones del motor que condicionan el diseño

- **`$` no cruza imports:** `claude plugin validate` exige que `$` no se pase a funciones importadas. Por eso los átomos y todo uso de `$` viven en `register.tsx`, y `claude-radar.tsx` es solo lógica pura (reducers, formato) que recibe y devuelve datos.
- **El estado vive en `$.state`:** un módulo recargado pierde sus variables; lo que debe sobrevivir (estado del radar) va en átomos. El temporizador y la restauración de la elección guardada sí son del módulo y empiezan de nuevo al recargar.
- **`ui.render` no puede devolver `null`:** el tipo exige un `RenderElement`, así que «no dibujar» es un `<Box />` sin hijos.
- **Leer un átomo desde `ui.render` suscribe la fila:** un átomo que cambia cada 250 ms redibujaría cada fila técnica cuatro veces por segundo; de ahí el átomo aparte `claudeRadarHidesTools`, que solo se escribe al cambiar de valor.
- **Los tests no pueden leer el código fuente** (no hay `import()` dinámico ni `node:fs` en los módulos de hooks): la garantía de que no se enganchan ciertos componentes se apoya en renderizarlos con el radar `ON` y trabajando, y en la lista de hooks de `validate`.
- `validate` avisa de que `agent.spawn`, `tool.call` y `tool.check` son hooks «sin `.catch`». Aquí es informativo: solo observan y devuelven el resultado del motor, no deciden nada.

## Limitaciones reales de las APIs

Lo que **no se pudo verificar** contra el Claude Code real (los tests usan el kit simulado del motor):

- **`Needs you` depende del origen `engine`:** se activa con un `tool.check` de decisión `ask` hecho por el motor. En algunos modos esa pregunta va a un clasificador y no a una persona, y el radar no puede distinguirlo; la marca se levanta con el siguiente `tool.call` del mismo agente. Para un subagente es igual.
- **`<Box />` vacío en Ink:** se supone que ocupa 0 filas; puede quedar el margen de la fila contenedora.
- **Redibujo de las filas ocultas:** que cada fila de la transcripción reaccione al cambio de `claudeRadarHidesTools` se comprobó con el kit, no con el motor real.
- **Una carrera entre dos cambios concurrentes** podría dejar `claudeRadarHidesTools` desfasado un instante; se corrige con el siguiente cambio de estado (cada 250 ms mientras hay trabajo).
- **Teammates:** un teammate que queda en reposo y despierta emite un `turn.complete` por ejecución. El radar lo marca `Done`, lo retira a los 5 s y después ignora sus llamadas, porque ya no está en la lista.
- **Subagentes sin `turn.complete`** (un agente remoto de un workflow, por ejemplo) se quedan en `Working` y mantienen vivo el temporizador hasta `session.end`. Con el radar en `OFF` el temporizador no corre y los terminados no se retiran hasta volver a `ON`.
- **Identificador de sesión:** el spawn no trae uno; `sessionId` queda vacío.
- **Jerarquía:** se apoya en `parentAgentId` tal como lo describen los tipos; no se vio con subagentes anidados reales.
- **Actividad:** se deduce solo del nombre de la herramienta (y, en `Bash`, de si el comando parece una prueba), no de su resultado. Es una pista, no una garantía de lo que ocurre. Una herramienta desconocida no cambia la actividad.
- **`AskUserQuestion`** no se puede montar en el kit de pruebas (exige un único nodo del motor): la garantía de que el radar no lo toca es que no hay ningún hook sobre él.
- **`CommandOutput`** no se oculta: es la salida de comandos slash, no de herramientas en curso.
- **Filas anteriores:** mientras el radar oculta, también se ocultan las filas técnicas de turnos previos; vuelven al terminar. Con subagentes activos después de acabar el turno principal, siguen ocultas hasta que terminen.
- **`ToolProgress`** solo existe en la superficie de terminal.
- **No hay línea en blanco** entre el checklist y `Subagents` para ahorrar filas.
- Los tests no cubren el pintado real (colores, bordes, anchos): comprueban la lógica y los árboles que dibujan los hooks.

## Licencia y apoyo

[MIT](./LICENSE) © Gersom. Si te sirve, puedes apoyar el proyecto con una donación por [PayPal](https://paypal.me/gersomalaja).
