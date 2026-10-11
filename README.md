# agent-radar

Hook para Claude Code que muestra el trabajo en curso de Claude y de sus subagentes en un **panel de detalle** y deja sobre el prompt solo una línea mínima: el nombre «Claude Radar» y dos botones. Mientras Claude trabaja, oculta visualmente las filas técnicas (llamadas a herramientas y sus resultados) y las devuelve al terminar. El título visible es **Claude Radar**.

## Nombre

El identificador del plugin es `agent-radar`: el prefijo `claude-` está reservado. En pantalla se llama «Claude Radar» (el botón dice `Claude Radar: ON/OFF`). La especificación original lo nombra `claude-radar`; ese es el nombre de su documento y del archivo de lógica (`hooks/claude-radar.tsx`), no el del plugin.

## Por qué

Con muchas llamadas a herramientas y varios subagentes en paralelo, la conversación se llena de filas técnicas y cuesta ver qué está haciendo Claude. El radar reúne lo observable en un solo panel y no cuesta tokens: no llama a ningún modelo, no agrega nada al contexto y no cambia lo que Claude hace.

## Cómo se ve

### La banda sobre el prompt

Una sola línea, sin borde: el nombre a la izquierda y los botones a la derecha. Nada más: ni título, ni tiempo, ni estados, ni listas.

```
Claude Radar                                    [ ◧ Detail ] [ ● Claude Radar: ON ]
```

- El botón `[ ◧ Detail ]` abre el panel de detalle (y pasa a `[ ◧ Close ]` mientras está abierto). Solo se ve con el radar en `ON`.
- Con el radar en `OFF`: `Claude Radar` y `[ ● Claude Radar: OFF ]`.
- Si falta ancho se corta el nombre (`…`) antes que los botones: los botones nunca se encogen.
- Cede ante una encuesta (`hasSurvey`) y respeta lo que dibujen debajo otros hooks de la banda.

### El panel de detalle

Con el radar en `ON` y Claude trabajando (en inglés, el idioma por defecto; ver «Idioma»):

```text
Now
Build my landing page
Working                                  2m 35s
✓ Analyze project structure  ██████████  Done
▶ Implement authentication   ███░░░░░░░  Working
○ Run final tests            ░░░░░░░░░░  Next

Subagents                              2 active
● frontend-developer                     1m 20s
  Building the login components
  Reading project files                 Working
  ● backend-developer                       45s
    Reviewing authentication routes
    Working                             Working

History                                       1
✗ code-reviewer                             45s
  Failed · Reviewing the diff
```

## Cómo se abre el panel (y por qué solo con el botón)

**El panel solo se abre pulsando `[ ◧ Detail ]`. El radar nunca lo abre por su cuenta.** Mientras no lo abras, no verás el progreso: la banda es solo el nombre y los botones.

El motor coloca un panel que abre el plugin sin que nadie lo pida solo desde 144 columnas de terminal; uno abierto por una pulsación se coloca con cualquier ancho. Por eso la apertura sale siempre de una pulsación. Si la superficie no coloca paneles, el mod muestra el aviso `The detail pane is not available here` y no deja ningún panel esperando.

Se cierra con el mismo botón (`[ ◧ Close ]`) o con la marca o la tecla de cierre del propio panel; entonces el botón vuelve a `Detail`. Apagar el radar (`OFF`) también lo cierra.

## Idioma

La interfaz habla español o inglés, con diccionarios fijos en `hooks/i18n.ts`: ningún agente traduce nada, no hay llamadas a modelos y no consume tokens. **No hay botón ni comando de idioma**: se detecta solo.

- **Automático:** lee `settings.language` (`$.settings.read()`) una vez por carga del mod y otra vez en cada sesión nueva (`session.end` lo olvida), y lo guarda en el estado (`claudeRadarLang`). Si cambias el ajuste a mitad de una sesión, no se recarga hasta la siguiente. Es texto libre, así que reconoce el español en varias formas (`Español`, `spanish`, `es`, `es-MX`, `castellano`, sin importar mayúsculas ni tildes).
- **Por defecto, inglés:** si no hay `settings.language`, no se puede leer o nombra un idioma que el mod no tiene, va en inglés.
- **El nombre propio no se traduce:** «Claude Radar» es igual en ambos idiomas.
- **Lo que viene del texto de la persona o de los agentes no se traduce:** el título del turno, los nombres de las tareas, los nombres de los agentes y las tareas delegadas se muestran tal cual.
- **El estado no guarda frases:** las razones (`permission`, `error`, `refusal`) y las actividades (`reading`, `searching`, `updating`, `testing`, `command`, `delegating`) son códigos, y el título por defecto y los nombres vacíos son `null` o vacío; el dibujo los pone en palabras en el idioma vigente.
- **Agregar otro idioma:** un diccionario más en `TEXTS` (`hooks/i18n.ts`), su código en `Lang` (`types/index.d.ts`) y cómo se reconoce en `detectLang`.

Con `settings.language` en español, la banda y el panel se ven así:

```
Claude Radar                                    [ ◧ Detalle ] [ ● Claude Radar: ON ]
```

```text
Ahora
Build my landing page
Trabajando                               2m 35s
✓ Analyze project structure  ██████████  Hecho
▶ Implement authentication   ███░░░░░░░  En curso
○ Run final tests            ░░░░░░░░░░  Siguiente

Subagentes                             2 activos
● frontend-developer                     1m 20s
  Building the login components
  Leyendo archivos del proyecto         Trabajando

Historial                                     1
✗ code-reviewer                             45s
  Falló · Reviewing the diff
```

## Qué muestra el panel

Título `Claude Radar`; sin límite de filas (el motor lo desplaza); todo se trunca con `…` al ancho del panel, sin barras por debajo de 36 columnas. Siempre muestra el último estado: no se pliega ni se vacía al terminar el turno.

- **Now:** el título del turno (del prompt, sin rutas ni código, de 40 caracteres como máximo y cortado por palabras), su fase y su tiempo, y el checklist completo.
- **Subagents:** los que están trabajando o esperándote (ver abajo).
- **History:** los subagentes terminados, el más reciente primero. Vacío: `No finished subagents yet`. Sin nada que mostrar: `Nothing running yet`.

### Fase del agente principal

| Fase | Se muestra | Cuándo |
|---|---|---|
| Trabajando | `Working` · tiempo corriendo | hay un turno en curso |
| `Needs you` | `Needs you · Waiting for your permission` (amarillo) | el motor pregunta a la persona si permite una llamada |
| `Stuck` | `Stuck · The turn ended with an error` o `· The model declined to answer` (rojo) | el turno terminó por un error o una negativa del modelo |
| `Stopped` | `Stopped` (naranja) | el turno se interrumpió |
| `All done` | `All done` (verde) · tiempo total | el turno terminó bien; el tiempo queda congelado |

### El checklist

Sale solo de lo que Claude ya crea por su cuenta: `TodoWrite`, `TaskCreate` y `TaskUpdate`. El radar no obliga a crear planes ni pide reportes. Las hechas llevan `✓` verde, nombre atenuado, barra llena y `Done`; la actual, `▶`, nombre destacado y barra indeterminada (un bloque de 3 segmentos que se mueve) con `Working`; las pendientes, `○`, barra vacía y `Next`. El radar **nunca inventa porcentajes**. Si no hay lista y el agente trabaja, muestra una sola fila `Working on your request`.

### Subagentes

- **Alta:** el hook `agent.spawn` guarda cada ejecución con su `agentId` y devuelve el resultado del motor tal cual.
- **Nombre real:** el `subagentType` (`frontend-developer`, `Explore`, un agente de un plugin…), nunca una etiqueta genérica; solo se trunca visualmente.
- **Instancias independientes:** dos ejecuciones del mismo agente son dos entradas, con su tiempo y su estado propios.
- **Tarea y actividad:** la tarea delegada completa en una línea (sin rutas ni código) y, debajo, la actividad actual. La actividad sale de los `tool.call` con el `agentId` del subagente, descrita con palabras locales y sin rutas, comandos ni código:

  | Herramienta | Actividad |
  |---|---|
  | `Read` | `Reading project files` |
  | `Glob`, `Grep`, `WebSearch`, `WebFetch` | `Searching project information` |
  | `Edit`, `Write`, `NotebookEdit` | `Updating project files` |
  | `Bash` con `test`, `jest`, `vitest` o `pytest` al inicio de una palabra | `Running tests` |
  | otro `Bash` | `Running a command` |
  | `Agent`, `Task` | `Delegating work` |
  | cualquier otra | la actividad no cambia |

  Mientras no haya ninguna, la actividad es `Working`.
- **Estados:** `●` verde `Working`, `●` amarillo `Needs you`, `✓` `Done`, `✗` `Failed`, `■` `Stopped`. Termina con el `turn.complete` del subagente: `answer` es Done, `aborted` es Stopped, `error` o `refusal` es Failed. El tiempo individual se congela al terminar. La primera finalización manda; si ese agente vuelve a llamar a una herramienta, regresa a `Working`.
- **Jerarquía:** solo si el spawn trae `parentAgentId` y ese padre sigue en la lista; entonces el hijo va debajo de su padre, con sangría. Si no, la lista es plana.
- La finalización de un subagente no cierra el turno principal ni al revés.

### Historial

Se guarda en el estado (`history`, hasta 50 entradas, una por id, la más reciente primero) en cuanto un subagente termina: nombre, estado final (`Done`, `Failed` o `Stopped`), duración y tarea. Los terminados salen de la lista viva a los ~5 s; el historial los conserva. Un subagente que vuelve a trabajar sale del historial. Al terminar la sesión (`session.end`, también con `/clear`) se borra todo lo que el radar seguía, el historial incluido; solo se conserva la elección ON/OFF.

## Botón ON/OFF

- Se controla **solo con botones**. No hay comandos `/simple`, `/radar` ni ningún otro.
- El botón `[ ● Claude Radar: ON ]` se ve siempre: en `OFF`, sin turno y con Claude inactivo.
- Al pulsarlo muestra un aviso breve (`Claude Radar: ON` / `Claude Radar: OFF`).
- Estado inicial: `ON`. La elección se guarda en `$.store` (clave `enabled`, el almacén propio del mod, local de cada equipo) y se restaura al empezar la sesión. Si el almacén no se puede leer o escribir, rige `ON` y el cambio vale igual para la sesión.
- En `OFF` se restaura la interfaz normal de Claude Code (las filas técnicas vuelven), se cierra el panel y desaparece el botón de detalle.

## Ocultar información técnica

Con el radar en `ON`, mientras el agente principal trabaja (o haya subagentes activos), el radar dibuja una fila vacía en lugar de `ToolUse`, `ToolResult`, `ToolGroup` y los indicadores de `ToolProgress`. Vuelven solas cuando:

- el turno termina y no queda ningún subagente activo,
- el radar pasa a `OFF`,
- alguien (el principal o un subagente) espera tu permiso: la herramienta que pide permiso queda a la vista.

Es **solo dibujo**: no bloquea, modifica ni cancela herramientas, los resultados de `tool.call` llegan intactos y el historial no se toca. Las filas de una llamada que falló o se interrumpió no se ocultan.

### Protección de la respuesta final

El radar **no engancha** `AssistantMessage`, `UserMessage`, `TurnDuration`, `InfoNotice`, `SessionMode`, `AskUserQuestion`, `PromptHint` ni `CommandOutput`: la respuesta final, los reportes de archivos, los resultados de pruebas, las advertencias y los errores los dibuja siempre el motor. `All done` convive con la respuesta, no la sustituye. Los únicos `ui.render` del mod son `AbovePrompt` (la banda), `Pane` (el panel de detalle), `ToolUse`, `ToolResult`, `ToolGroup` y `ToolProgress`; `claude plugin validate` los lista.

## Consumo de tokens: cero

El mod solo observa eventos y dibuja:

- no llama a ningún modelo (ni para títulos, porcentajes o actividades);
- no engancha `prompt.compose` ni ningún otro `prompt.*`, no inyecta instrucciones ni mensajes en la conversación;
- no registra herramientas, comandos ni agentes, y no crea subagentes de supervisión;
- no lee transcripciones ni archivos de agentes; el estado se actualiza con los eventos que ya pasan;
- los hooks de eventos devuelven `next(e)` o el resultado de `await next(e)` sin tocarlos;
- un único temporizador de 250 ms (animación y tiempos del panel) que corre **solo con el panel abierto** y mientras hay algo que mover, y se cancela al cerrarlo, al quedar inactivo o en `OFF`. Con el panel cerrado no hay tics: el estado se actualiza solo por eventos, y los subagentes terminados salen de la lista viva a los 5 s con un temporizador de un solo disparo.

## Tipo y fuente de datos

- **Tipo:** hook (plugin de Claude Code).
- **Eventos:** `session.start`, `session.end` (borra el estado de la sesión), `ui.close` del panel de detalle, `turn.start`, `turn.complete`, `tool.call`, `tool.check` (para `Needs you`: solo cuenta una pregunta de origen `engine`), `agent.spawn`.
- **Dibujo:** `ui.render` sobre `AbovePrompt` (la banda), sobre `Pane` con `requestId` `agent-radar` (el panel de detalle) y sobre las cuatro filas técnicas. El panel se abre y cierra con `$.ui.open` / `$.ui.close`.
- **Estado:** `$.state` con cuatro claves: `claudeRadarState` (todo el estado, el historial incluido), `claudeRadarHidesTools` (si las filas están ocultas; aparte para que la transcripción se redibuje al cambiar de fase y no en cada tic), `claudeRadarPaneOpen` (si el panel está abierto, para el botón y el temporizador) y `claudeRadarLang` (el idioma, o `null` hasta que se lee).
- **Almacén, ajustes y reloj:** `$.store` (clave `enabled`), `$.settings.read()` (clave `language`), `$.clock.now()`, `$.clock.every(250, …)` y `$.clock.after(5000, …)`.

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

Los tests cubren la lógica pura y los hooks bajo el kit de pruebas del motor, en terminal y escritorio.

## Estructura

```
agent-radar/
├── LICENSE                      # licencia MIT
├── .claude-plugin/
│   ├── plugin.json              # manifiesto del plugin
│   └── marketplace.json         # marketplace de un solo plugin (instalación suelta)
├── hooks/
│   ├── hooks.json               # apunta a register.tsx
│   ├── register.tsx             # hooks, átomos y todo uso de $: la banda mínima, el panel de detalle, el idioma y las filas ocultas
│   ├── i18n.ts                  # textos en español e inglés y detección del idioma (lógica pura)
│   ├── i18n.test.ts             # tests de la detección y de los diccionarios
│   ├── claude-radar.tsx         # lógica pura: reducers, historial, barras, tiempos, ocultación, vista del panel de detalle
│   └── claude-radar.test.ts     # tests (lógica y render)
└── types/index.d.ts             # contrato del estado ($.state): ClaudeRadarState, SubagentState, Lang, claudeRadarHidesTools, claudeRadarPaneOpen, claudeRadarLang
```

`tsconfig.json` y `.claude-plugin/types/` los genera Claude Code al cargar el mod y están en `.gitignore`.

## Restricciones del motor que condicionan el diseño

- **`$` no cruza imports:** `claude plugin validate` exige que `$` no se pase a funciones importadas. Por eso los átomos y todo uso de `$` viven en `register.tsx`, y `claude-radar.tsx` es solo lógica pura (reducers, formato) que recibe y devuelve datos.
- **El estado vive en `$.state`:** un módulo recargado pierde sus variables; lo que debe sobrevivir (estado del radar) va en átomos. El temporizador y la restauración de la elección guardada sí son del módulo y empiezan de nuevo al recargar.
- **Un panel que abre el plugin sin que nadie lo pida no se coloca bajo 144 columnas:** de ahí que el panel solo se abra con el botón y que, sin abrirlo, no se vea el progreso.
- **El motor no entrega al plugin su propio cierre:** el hook `ui.close` solo oye los cierres de la persona, así que el botón baja su marca al cerrar él mismo.
- **`ui.render` no puede devolver `null`:** el tipo exige un `RenderElement`, así que «no dibujar» es un `<Box />` sin hijos.
- **Leer un átomo desde `ui.render` suscribe la fila:** un átomo que cambia cada 250 ms redibujaría cada fila técnica cuatro veces por segundo; de ahí el átomo aparte `claudeRadarHidesTools`, que solo se escribe al cambiar de valor.
- **Los tests no pueden leer el código fuente** (no hay `import()` dinámico ni `node:fs` en los módulos de hooks): la garantía de que no se enganchan ciertos componentes se apoya en renderizarlos con el radar `ON` y trabajando, y en la lista de hooks de `validate`.
- `validate` avisa de que `agent.spawn`, `tool.call`, `tool.check` y `ui.close` son hooks «sin `.catch`». Aquí es informativo: solo observan y devuelven el resultado del motor, no deciden nada.

## Limitaciones reales de las APIs

Lo que **no se pudo verificar** contra el Claude Code real (los tests usan el kit simulado del motor):

- **Idioma:** `settings.language` es texto libre y solo se reconoce el español; cualquier otro valor va en inglés. El motivo que acompaña al aviso «el panel no está disponible» lo da el motor con sus propias palabras (en inglés) y no se traduce. Las dos traducciones las comprueban los tests con ajustes simulados, no con un `settings.read` real.
- **Sin abrir el panel no se ve el progreso.** Es una decisión (ver «Cómo se abre el panel»), no una carencia: un panel abierto por el mod no se colocaría bajo 144 columnas.
- **Dónde se acopla el panel** (a un lado de la transcripción o sobre el prompt) y cómo se ve con `rows: 14` / `columns: 60`; que `isPlaced` sea `false` en las superficies sin soporte (solo se probó con un `ui.open` simulado).
- **Cierre por el usuario:** el hook `ui.close` que devuelve el botón a `Detail` no se pudo ejercitar con el kit (el `$` de los tests no puede cerrar paneles ni simular a la persona), así que se apoya en lo que dicen los tipos. Si el motor no entregara ese evento, el botón seguiría en `Close`; una pulsación llamaría a un cierre sobre un panel ya cerrado, que el motor ignora, y volvería a `Detail`.
- **La banda se redibuja con cada escritura del estado:** lee el estado para saber si el radar está en `ON`. Con el panel cerrado solo hay escrituras por eventos; con el panel abierto, una cada 250 ms mientras hay trabajo.
- **`Needs you` depende del origen `engine`:** se activa con un `tool.check` de decisión `ask` hecho por el motor. En algunos modos esa pregunta va a un clasificador y no a una persona, y el radar no puede distinguirlo; la marca se levanta con el siguiente `tool.call` del mismo agente. Para un subagente es igual.
- **`<Box />` vacío en Ink:** se supone que ocupa 0 filas; puede quedar el margen de la fila contenedora.
- **Redibujo de las filas ocultas:** que cada fila de la transcripción reaccione al cambio de `claudeRadarHidesTools` se comprobó con el kit, no con el motor real. Una carrera entre dos cambios concurrentes podría dejarlo desfasado un instante; se corrige con el siguiente cambio de estado.
- **Teammates:** un teammate que queda en reposo y despierta emite un `turn.complete` por ejecución. El radar lo marca `Done`, lo retira a los 5 s y después ignora sus llamadas, porque ya no está en la lista viva (queda en el historial).
- **Subagentes sin `turn.complete`** (un agente remoto de un workflow, por ejemplo) se quedan en `Working` hasta `session.end`; con el panel abierto mantienen vivo el temporizador.
- **Identificador de sesión:** el spawn no trae uno; `sessionId` queda vacío.
- **Jerarquía:** se apoya en `parentAgentId` tal como lo describen los tipos; no se vio con subagentes anidados reales.
- **Actividad:** se deduce solo del nombre de la herramienta (y, en `Bash`, de si el comando parece una prueba), no de su resultado. Es una pista, no una garantía de lo que ocurre. Una herramienta desconocida no cambia la actividad.
- **`AskUserQuestion`** no se puede montar en el kit de pruebas (exige un único nodo del motor): la garantía de que el radar no lo toca es que no hay ningún hook sobre él.
- **`CommandOutput`** no se oculta: es la salida de comandos slash, no de herramientas en curso.
- **Filas anteriores:** mientras el radar oculta, también se ocultan las filas técnicas de turnos previos; vuelven al terminar. Con subagentes activos después de acabar el turno principal, siguen ocultas hasta que terminen.
- **`ToolProgress`** solo existe en la superficie de terminal.
- Los tests no cubren el pintado real (colores, anchos, desplazamiento): comprueban la lógica y los árboles que dibujan los hooks. Solo se probaron las superficies terminal y escritorio.

## Licencia y apoyo

[MIT](./LICENSE) © Gersom. Si te sirve, puedes apoyar el proyecto con una donación por [PayPal](https://paypal.me/gersomalaja).
