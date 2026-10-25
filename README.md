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
Claude Radar                         [ ◧ Detail ] [ ● Claude Radar: ON ] [ ✕ Hide ]
```

- El botón `[ ◧ Detail ]` abre el panel de detalle (y pasa a `[ ◧ Close ]` mientras está abierto). Solo se ve con el radar en `ON`.
- Con el radar en `OFF`: `Claude Radar`, `[ ● Claude Radar: OFF ]` y `[ ✕ Hide ]`.
- El botón `[ ✕ Hide ]` quita la banda de la barra del prompt (no apaga el radar: el panel y el ocultar filas técnicas siguen según ON/OFF). Para devolverla: `/agent-radar show`. La elección se guarda en `$.store` (clave `bandHidden`) y sobrevive a las sesiones.
- Si falta ancho se corta el nombre (`…`) antes que los botones: los botones nunca se encogen.
- Cede ante una encuesta (`hasSurvey`) y respeta lo que dibujen debajo otros hooks de la banda.

### El panel de detalle

El panel se organiza por **turnos**. Un turno empieza cuando le pides algo a Claude y dura hasta que el agente principal **y todos sus subagentes** terminan (o hasta que lo cancelas). Arriba va la **ejecución actual**, el turno en curso; debajo, el **historial**, con un grupo por cada turno terminado.

Con el radar en `ON` y Claude trabajando (en inglés, el idioma por defecto; ver «Idioma»):

```text
Current run
Build my landing page
███░░░░░░░  Working                                  2m 35s
● Main agent · opus-4-5 · high                       2m 35s
  1/3                                ███░░░░░░░  Working
  ✓ Analyze project structure        ██████████  Done
  ▶ Implement authentication         ███░░░░░░░  Working
  ○ Run final tests                  ░░░░░░░░░░  Next
● frontend-developer · haiku · low                   1m 20s
  Building the login components
  Reading project files              ███░░░░░░░  Working
  ● backend-developer                                   45s
    Reviewing authentication routes
    Working                          ███░░░░░░░  Working
✓ code-reviewer · haiku                                 30s
                                     ██████████  Done

History                                                  1
✗ Fix the login bug                          Failed  4m 02s
  ✗ Main agent · opus-4-5 · high                1/2  4m 02s
  ✓ Explore · haiku                                  1m 10s
    Done · Mapping the repo
```

Cuando termina todo, la ejecución actual pasa al historial y queda el mensaje `All done, ready for more instructions`.

## Cómo se abre el panel (y por qué solo con el botón)

**El panel solo se abre pulsando `[ ◧ Detail ]`. El radar nunca lo abre por su cuenta.** Mientras no lo abras, no verás el progreso: la banda es solo el nombre y los botones.

El motor coloca un panel que abre el plugin sin que nadie lo pida solo desde 144 columnas de terminal; uno abierto por una pulsación se coloca con cualquier ancho. Por eso la apertura sale siempre de una pulsación. Si la superficie no coloca paneles, el mod muestra el aviso `The detail pane is not available here` y no deja ningún panel esperando.

Se cierra con el mismo botón (`[ ◧ Close ]`), con el comando `/agent-radar` o con la marca o la tecla de cierre del propio panel; entonces el botón vuelve a `Detail`. Apagar el radar (`OFF`) también lo cierra.

## Comando `/agent-radar`

Abre y cierra el mismo panel de detalle, para quien prefiere teclear, y muestra u oculta la banda (`hide` / `show`). Es una petición de la persona, así que el panel se coloca con cualquier ancho (como con el botón).

| Comando | Efecto | Respuesta |
|---|---|---|
| `/agent-radar` | alterna: abre si está cerrado, cierra si está abierto | `Detail pane opened` / `Detail pane closed` |
| `/agent-radar open` | solo abre; con el panel ya abierto no hace nada | `Detail pane opened` |
| `/agent-radar close` | solo cierra; con el panel ya cerrado no hace nada | `Detail pane closed` |
| `/agent-radar hide` | quita la banda de la barra del prompt (con el radar en `ON` u `OFF`) | `Band hidden. Bring it back with /agent-radar show` |
| `/agent-radar show` | devuelve la banda | `Band shown` |
| `/agent-radar <otra cosa>` | no cambia nada | `Usage: /agent-radar [open|close|hide|show]. With no argument, it toggles the pane.` |

- Con el radar en `OFF` responde `Claude Radar is OFF. Turn it on with its button.` y no abre nada.
- Si la superficie no coloca paneles, la respuesta y un aviso dicen el motivo (`The detail pane is not available here: <motivo>`) y no queda ningún panel esperando.
- Las respuestas y la descripción del comando van en el idioma detectado (ver «Idioma»); en español: `Panel de detalle abierto` / `Panel de detalle cerrado`, `Uso: /agent-radar [open|close]. Sin argumento, alterna el panel.` y `Claude Radar está apagado (OFF). Enciéndelo con su botón.`
- Se registra al empezar la sesión (`session.start`) y se atiende con un hook `command.run`. **Es el único comando del mod**: la especificación original prohibía crear comandos (`/simple`, `/radar` y similares) y el control era solo por botones; este comando lo pidió expresamente el operador. `/simple` y `/radar` siguen sin existir, y el radar no se enciende ni se apaga con comandos: eso es solo del botón ON/OFF.
- **Cómo decide sin leer el estado:** para que el motor cuente la apertura como petición de la persona, `$.ui.open` tiene que ser el primer paso asíncrono del comando. Por eso decide con dos variables del módulo (si el panel está abierto y si el radar está en `ON`) que reflejan los átomos; `session.start` las vuelve a leer tras una recarga del mod. Si quedaran desfasadas, el peor caso es un `$.ui.open` sobre un panel ya abierto, que el motor solo retitula.
- La respuesta del comando es una línea que queda en la conversación y el modelo lee con el siguiente mensaje (unos pocos tokens, solo cuando tú lo ejecutas); el resto del mod no escribe nada en la conversación.

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
Claude Radar                         [ ◧ Detalle ] [ ● Claude Radar: ON ] [ ✕ Ocultar ]
```

```text
Ejecución actual
Build my landing page
███░░░░░░░  Trabajando                               2m 35s
● Agente principal · opus-4-5 · high                 2m 35s
  1/3                                ███░░░░░░░  Trabajando
  ✓ Analyze project structure        ██████████  Hecho
  ▶ Implement authentication         ███░░░░░░░  En curso
  ○ Run final tests                  ░░░░░░░░░░  Siguiente
● frontend-developer · haiku · low                   1m 20s
  Building the login components
  Leyendo archivos del proyecto      ███░░░░░░░  Trabajando

Historial                                                1
✗ Fix the login bug                          Falló  4m 02s
  ✗ Agente principal · opus-4-5 · high          1/2  4m 02s
  ✓ Explore · haiku                                  1m 10s
    Hecho · Mapping the repo
```

Sin nada en marcha, la ejecución actual dice `Todo listo, esperando instrucciones`.

## Qué muestra el panel

Título `Claude Radar`; sin límite de filas (el motor lo desplaza); todo se trunca con `…` al ancho del panel, sin barras por debajo de 38 columnas (el checklist va sangrado dos columnas bajo el agente principal) y sin la etiqueta de estado por debajo de 36. Dos secciones, separadas por una línea en blanco:

- **Current run** (ejecución actual): el turno en curso.
  - El **título del turno** (del prompt, sin rutas ni código, de 40 caracteres como máximo y cortado por palabras) y una línea de estado: barra, fase (con su razón si la hay) y tiempo total. La barra se mueve mientras algo corre (el agente principal trabajando o esperándote, o algún subagente activo) y queda llena y quieta al terminar.
  - El **agente principal** (`Main agent`): su modelo y esfuerzo (`opus-4-5 · high`), el tiempo del turno, su barra de estado, `hechas/total` si hay checklist y, debajo, el checklist completo.
  - Los **subagentes del turno**, los que trabajan y los que ya terminaron, con su jerarquía (ver «Subagentes»).
  - Sin turno en curso: `All done, ready for more instructions`.
- **History** (historial): un grupo por turno terminado, el más reciente primero, con el número de turnos en el encabezado (ver «Historial»). Vacío: `No finished turns yet`.

Sin ningún turno, ni en curso ni terminado: `Nothing running yet`.

### Fase del turno

La línea de estado del turno usa la fase del agente principal, con una salvedad: mientras un subagente sigue activo, el turno sigue `Working` (o `Needs you` si es el subagente quien espera), aunque el agente principal ya haya terminado. El agente principal conserva su propio estado en su fila.

| Fase | Se muestra | Cuándo |
|---|---|---|
| Trabajando | `Working` · tiempo corriendo | hay un turno en curso |
| `Needs you` | `Needs you · Waiting for your permission` (amarillo) | el motor pregunta a la persona si permite una llamada |
| `Stuck` | `Stuck · The turn ended with an error` o `· The model declined to answer` (rojo) | el agente principal terminó por un error o una negativa del modelo |
| `Stopped` | `Stopped` (naranja) | el turno se interrumpió |
| `All done` | `All done` (verde) · tiempo total | el agente principal y todos los subagentes terminaron bien |

`Stuck`, `Stopped` y `All done` no llegan a verse en la ejecución actual: en cuanto el agente principal terminó y no queda ningún subagente activo, el turno se archiva y pasa al historial con ese estado final (ver «Historial»).

### El checklist

Sale solo de lo que Claude ya crea por su cuenta: `TodoWrite`, `TaskCreate` y `TaskUpdate`. El radar no obliga a crear planes ni pide reportes. Las hechas llevan `✓` verde, nombre atenuado, barra llena y `Done`; la actual, `▶`, nombre destacado y barra indeterminada (un bloque de 3 segmentos que se mueve) con `Working`; las pendientes, `○`, barra vacía y `Next`. El radar **nunca inventa porcentajes**. Si no hay lista y el agente trabaja, muestra una sola fila `Working on your request`.

### Subagentes

- **Alta:** el hook `agent.spawn` guarda cada ejecución con su `agentId` y devuelve el resultado del motor tal cual.
- **Nombre real:** el `subagentType` (`frontend-developer`, `Explore`, un agente de un plugin…), nunca una etiqueta genérica; solo se trunca visualmente.
- **Dentro del turno:** los subagentes de un turno se quedan en la ejecución actual, con su estado (`Done`, `Failed` o `Stopped`) y su tiempo congelado, hasta que el turno se archiva. Ya no se retiran a los pocos segundos.
- **Fila:** nombre, modelo y esfuerzo, tiempo, una barra de estado y, debajo, la tarea delegada y la actividad con la etiqueta de estado. La barra **nunca lleva porcentaje**: se mueve mientras el subagente trabaja o te espera y queda llena al terminar (el color y la etiqueta dicen cómo). De un subagente terminado se ve la tarea y la etiqueta, no la actividad.
- **Modelo y esfuerzo:** junto al nombre, atenuados (`Explore · haiku · low`). Salen de `turn.step` (cada petición al modelo, del agente principal o de un subagente por su `agentId`); antes de la primera petición de un subagente se muestra el modelo que dio su spawn. El id se acorta (`claude-opus-4-5-20251101` es `opus-4-5`; un alias como `haiku` queda igual). Si el modelo no admite esfuerzo, solo se ve el modelo; si aún no se sabe nada, nada.
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
- La finalización de un subagente no cierra el turno principal ni al revés: el turno sigue abierto mientras alguno de los dos esté activo. Un subagente en segundo plano que sigue trabajando después de que el agente principal responda mantiene el turno en la ejecución actual.

### Historial

Un turno se **archiva** cuando el agente principal terminó (bien, con error o interrumpido) y no queda ningún subagente activo; al cancelarlo (`aborted`) se archiva de inmediato, aunque queden subagentes activos: pasan a `Stopped` con el turno. Se guarda en el estado (`turns`, hasta 10 turnos, el más reciente primero; el más viejo se descarta al pasar de 10) como un registro con:

- el **título** del turno y su **estado final**: `Done` si se respondió, `Stopped` si se canceló, `Failed` si terminó con un error o una negativa del modelo;
- cuándo empezó y cuándo terminaron el agente principal y todos sus subagentes (la duración es la diferencia);
- el **agente principal**: modelo y esfuerzo, y cuántas tareas del checklist se hicieron del total;
- los **subagentes** del turno, en orden de inicio, cada uno con su estado final, duración y tarea.

El panel dibuja un grupo por turno: una cabecera (título, estado final con su color y duración) y debajo el agente principal (`hechas/total` si había tareas) y sus subagentes con su estado final y su tarea. Un turno sin subagentes muestra solo la fila del agente principal. El checklist y el motivo exacto de un error no se conservan en el historial.

Si empieza un turno nuevo mientras el anterior sigue abierto (el principal ya terminó pero un subagente sigue activo), el anterior se archiva a la fuerza: los subagentes aún activos pasan a `Stopped` y el turno nuevo empieza vacío. Al terminar la sesión (`session.end`, también con `/clear`) se borra todo lo que el radar seguía, el historial incluido; solo se conserva la elección ON/OFF.

## Botón ON/OFF

- El radar se enciende y se apaga **solo con su botón**: no hay comandos `/simple` ni `/radar`, y `/agent-radar` solo abre y cierra el panel.
- El botón `[ ● Claude Radar: ON ]` se ve siempre: en `OFF`, sin turno y con Claude inactivo.
- Al pulsarlo muestra un aviso breve (`Claude Radar: ON` / `Claude Radar: OFF`).
- Estado inicial: `ON`. La elección se guarda en `$.store` (clave `enabled`, el almacén propio del mod, local de cada equipo) y se restaura al empezar la sesión. Si el almacén no se puede leer o escribir, rige `ON` y el cambio vale igual para la sesión.
- En `OFF` se restaura la interfaz normal de Claude Code (las filas técnicas vuelven), se cierra el panel y desaparece el botón de detalle.

## Ocultar información técnica

Con el radar en `ON`, mientras el agente principal trabaja (o haya subagentes activos), el radar dibuja una fila vacía en lugar de `ToolUse`, `ToolResult`, `ToolGroup` y los indicadores de `ToolProgress`. Vuelven solas cuando:

- el turno termina y no queda ningún subagente activo,
- el radar pasa a `OFF`,
- alguien (el principal o un subagente) espera tu permiso: la herramienta que pide permiso queda a la vista.

Es **solo dibujo**: no bloquea, modifica ni cancela herramientas, los resultados de `tool.call` llegan intactos y la conversación no se toca. Las filas de una llamada que falló o se interrumpió no se ocultan.

### Protección de la respuesta final

El radar **no engancha** `AssistantMessage`, `UserMessage`, `TurnDuration`, `InfoNotice`, `SessionMode`, `AskUserQuestion`, `PromptHint` ni `CommandOutput`: la respuesta final, los reportes de archivos, los resultados de pruebas, las advertencias y los errores los dibuja siempre el motor. `All done` convive con la respuesta, no la sustituye. Los únicos `ui.render` del mod son `AbovePrompt` (la banda), `Pane` (el panel de detalle), `ToolUse`, `ToolResult`, `ToolGroup` y `ToolProgress`; `claude plugin validate` los lista.

## Consumo de tokens: prácticamente cero

El mod solo observa eventos y dibuja:

- no llama a ningún modelo (ni para títulos, porcentajes o actividades);
- no engancha `prompt.compose` ni ningún otro `prompt.*`, no inyecta instrucciones ni mensajes en la conversación;
- no registra herramientas ni agentes, y no crea subagentes de supervisión; su único comando es `/agent-radar` (abre y cierra el panel), cuya respuesta es la única línea que escribe en la conversación;
- no lee transcripciones ni archivos de agentes; el estado se actualiza con los eventos que ya pasan;
- los hooks de eventos devuelven `next(e)` o el resultado de `await next(e)` sin tocarlos;
- un único temporizador de 250 ms (animación y tiempos del panel) que corre **solo con el panel abierto** y mientras hay algo que mover, y se cancela al cerrarlo, al quedar inactivo o en `OFF`. Con el panel cerrado no hay tics: el estado se actualiza solo por eventos. Ya no hay ningún temporizador de un solo disparo: los subagentes no se retiran por tiempo, el turno se archiva con el evento que lo termina.

## Tipo y fuente de datos

- **Tipo:** hook (plugin de Claude Code).
- **Eventos:** `session.start` (registra el comando), `command.run` de `/agent-radar`, `session.end` (borra el estado de la sesión), `ui.close` del panel de detalle, `turn.start` (abre el turno; si uno seguía abierto, lo archiva a la fuerza), `turn.step` (solo observa el modelo y el esfuerzo), `turn.complete` (termina al agente principal o a un subagente y archiva el turno cuando ya no queda nada activo), `tool.call`, `tool.check` (para `Needs you`: solo cuenta una pregunta de origen `engine`), `agent.spawn`.
- **Dibujo:** `ui.render` sobre `AbovePrompt` (la banda), sobre `Pane` con `requestId` `agent-radar` (el panel de detalle) y sobre las cuatro filas técnicas. El panel se abre y cierra con `$.ui.open` / `$.ui.close`.
- **Estado:** `$.state` con cinco claves: `claudeRadarState` (todo el estado: el turno actual con sus subagentes y `turns`, los turnos archivados), `claudeRadarHidesTools` (si las filas están ocultas; aparte para que la transcripción se redibuje al cambiar de fase y no en cada tic), `claudeRadarPaneOpen` (si el panel está abierto, para el botón y el temporizador), `claudeRadarBandHidden` (si la banda está quitada) y `claudeRadarLang` (el idioma, o `null` hasta que se lee).
- **Almacén, ajustes y reloj:** `$.store` (claves `enabled` y `bandHidden`), `$.settings.read()` (clave `language`), `$.clock.now()` y `$.clock.every(250, …)`.

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
│   ├── claude-radar.tsx         # lógica pura: reducers, archivo de turnos, barras, tiempos, ocultación, vista del panel de detalle
│   └── claude-radar.test.ts     # tests (lógica y render)
└── types/index.d.ts             # contrato del estado ($.state): ClaudeRadarState, TurnRecord, SubagentState, Lang, claudeRadarHidesTools, claudeRadarPaneOpen, claudeRadarLang
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
- **`/agent-radar`:** que el motor cuente la apertura del comando como petición de la persona (y por tanto coloque el panel con cualquier ancho) se apoya en que `$.ui.open` es su primer paso asíncrono; el kit de pruebas no distingue peticiones de la persona, así que solo se comprobó el orden de las llamadas y no la colocación real. Si el panel no se colocara, la respuesta del comando lo diría.
- **Sin abrir el panel no se ve el progreso.** Es una decisión (ver «Cómo se abre el panel»), no una carencia: un panel abierto por el mod no se colocaría bajo 144 columnas.
- **Dónde se acopla el panel** (a un lado de la transcripción o sobre el prompt) y cómo se ve con `rows: 14` / `columns: 60`; que `isPlaced` sea `false` en las superficies sin soporte (solo se probó con un `ui.open` simulado).
- **Cierre por el usuario:** el hook `ui.close` que devuelve el botón a `Detail` no se pudo ejercitar con el kit (el `$` de los tests no puede cerrar paneles ni simular a la persona), así que se apoya en lo que dicen los tipos. Si el motor no entregara ese evento, el botón seguiría en `Close`; una pulsación llamaría a un cierre sobre un panel ya cerrado, que el motor ignora, y volvería a `Detail`.
- **La banda se redibuja con cada escritura del estado:** lee el estado para saber si el radar está en `ON`. Con el panel cerrado solo hay escrituras por eventos; con el panel abierto, una cada 250 ms mientras hay trabajo.
- **`Needs you` depende del origen `engine`:** se activa con un `tool.check` de decisión `ask` hecho por el motor. En algunos modos esa pregunta va a un clasificador y no a una persona, y el radar no puede distinguirlo; la marca se levanta con el siguiente `tool.call` del mismo agente. Para un subagente es igual.
- **`<Box />` vacío en Ink:** se supone que ocupa 0 filas; puede quedar el margen de la fila contenedora.
- **Redibujo de las filas ocultas:** que cada fila de la transcripción reaccione al cambio de `claudeRadarHidesTools` se comprobó con el kit, no con el motor real. Una carrera entre dos cambios concurrentes podría dejarlo desfasado un instante; se corrige con el siguiente cambio de estado.
- **Teammates:** un teammate que queda en reposo y despierta emite un `turn.complete` por ejecución. El radar lo marca `Done`; si con eso el turno se archiva, ignora sus llamadas posteriores, porque ya no está en la lista del turno actual (queda en el historial del turno).
- **Subagentes sin `turn.complete`** (un agente remoto de un workflow, por ejemplo) se quedan en `Working` hasta `session.end` (o hasta que empiece otro turno, que archiva el anterior a la fuerza y los pasa a `Stopped`); mientras tanto mantienen abierto el turno y, con el panel abierto, vivo el temporizador.
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
