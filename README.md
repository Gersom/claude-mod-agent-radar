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

El panel se organiza por **turnos**. Un turno empieza cuando le pides algo a Claude y dura hasta que el agente principal **y todos sus subagentes** terminan (o hasta que lo cancelas). Arriba va la **ejecución actual**, el turno en curso; debajo, el **historial**, con un grupo por cada turno terminado. Todo está siempre desplegado: no hay plegables ni botones dentro del panel; si hay más de lo que cabe, el motor desplaza el panel.

Con el radar en `ON` y Claude trabajando (en inglés, el idioma por defecto; ver «Idioma»):

```text
● Current run · 3m 36s · 19.8k tokens
______________________________

Build my landing page

● Main agent · opus-4-5 · high
  Working · 1/3 · 3m 36s · 230 tokens  ███░░░░░░░
  ✓ Analyze project structure
  ▶ Implement authentication
  ○ Run final tests

Subagents · 2 active
  ● frontend-developer · haiku
    Building the login components
    Reading project files
    Working · 3m 10s · 1.2k tokens  ███░░░░░░░

    ● backend-developer
      Reviewing authentication routes
      Working · 2m 05s · 18.4k tokens  ███░░░░░░░

History · 2 runs
______________________________

✗ Fix the login bug
  Failed · 4m 02s · 9.8k tokens
    ✗ Main agent · opus-4-5 · high
      Failed · 1/2 · 4m 02s · 6k tokens
    ✓ Explore · haiku
      Mapping the repo
      Done · 1m 10s · 3.8k tokens

✓ Quick question
  Done · 12s · 410 tokens
    ✓ Main agent · opus-4-5 · high
      Done · 12s · 410 tokens
```

Cada agente (el principal y cada subagente) se dibuja igual, en líneas verticales una bajo otra y sin columnas a la derecha: el ancho del panel es poco para tantos datos en una sola línea. Es el mismo diseño en la ejecución actual y en el historial. Ver «Cada agente en líneas» para el detalle.

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
● Ejecución actual · 3m 36s · 19.8k tokens
______________________________

Build my landing page

● Agente principal · opus-4-5 · high
  Trabajando · 1/3 · 3m 36s · 230 tokens  ███░░░░░░░
  ✓ Analyze project structure
  ▶ Implement authentication
  ○ Run final tests

Subagentes · 2 activos
  ● frontend-developer · haiku
    Building the login components
    Leyendo archivos del proyecto
    Trabajando · 3m 10s · 1.2k tokens  ███░░░░░░░

    ● backend-developer
      Reviewing authentication routes
      Trabajando · 2m 05s · 18.4k tokens  ███░░░░░░░

Historial · 2 ejecuciones
______________________________

✗ Fix the login bug
  Falló · 4m 02s · 9.8k tokens
    ✗ Agente principal · opus-4-5 · high
      Falló · 1/2 · 4m 02s · 6k tokens
    ✓ Explore · haiku
      Mapping the repo
      Hecho · 1m 10s · 3.8k tokens

✓ Quick question
  Hecho · 12s · 410 tokens
    ✓ Agente principal · opus-4-5 · high
      Hecho · 12s · 410 tokens
```

Sin nada en marcha, la ejecución actual dice `Todo listo, esperando instrucciones`.

## Qué muestra el panel

Sin límite de filas (el motor lo desplaza); todo se trunca con `…` al ancho del panel. Dos secciones, separadas por una fila en blanco (sin línea); cada título lleva debajo una línea de guiones bajos (`_`, atenuada, de 30 columnas: igual de larga en las dos secciones, y más que cualquier título), desde el inicio de la fila, que lo separa de su contenido, y una fila en blanco debajo. Los dos títulos tienen el mismo formato, `<título> · <subtítulos>`, con los subtítulos en gris (el tiempo y los tokens del turno, o el número de ejecuciones). No hay más líneas finas: los agentes se separan con una fila en blanco.

- **Current run** (ejecución actual): el turno en curso.
  - **Encabezado:** el `●` y el título de la sección, seguido de sus subtítulos en gris con el mismo formato que el historial, `<título> · <subtítulo>`: el tiempo total del turno y sus tokens (`Current run · 3m 36s · 19.8k tokens`; los tokens solo si los hay). El `●` es verde y parpadea con el temporizador mientras algo corre (amarillo si alguien te espera); cuando todo terminó queda quieto y atenuado con la marca del final (`✓`, `✗` o `■`), cosa que casi no se ve porque el turno se archiva en ese momento. Sin turno en curso, el `●` va atenuado.
  - El **título del turno** (del prompt, sin rutas ni código, de 80 caracteres como máximo y cortado por palabras; el dibujo lo corta con `…` al ancho real). Si el turno espera tu permiso o terminó con un error, la razón va a su lado, atenuada (`· Waiting for your permission`).
  - El **agente principal** (`Main agent`): sus líneas (ver abajo) y, al final de ellas, su checklist completo.
  - El bloque de los **subagentes del turno** (los que trabajan y los que ya terminaron), una fila en blanco más abajo y con su jerarquía (ver «Subagentes»): un encabezado `Subagents · 2 active` (`<título> · <activos>`; el contador en verde si hay alguno, atenuado si no) y, bajo él, cada agente sangrado dos columnas, separado del siguiente por una fila en blanco.
  - Sin turno en curso: `All done, ready for more instructions`.
- **History** (historial): el título con el número de turnos como subtítulo en gris, pegado al título (`History · 2 runs`; `History · 1 run` en singular) y un grupo por turno terminado, el más reciente primero, separados por una fila en blanco, sin líneas (ver «Historial»). Vacío: `No finished turns yet`.

Sin ningún turno, ni en curso ni terminado: `Nothing running yet`.

### Cada agente en líneas

El agente principal y cada subagente se dibujan con las mismas líneas, una bajo otra (en la ejecución actual y en el historial). Todo lo de abajo está sangrado dos columnas respecto de la marca de la primera línea:

1. **Cabecera:** la marca de estado, el nombre (en negrita mientras trabaja) y `· modelo · esfuerzo` atenuado (`● Explore · haiku · low`).
2. **Tarea y actividad** (solo un subagente): la tarea delegada y, debajo, la actividad actual, cada una en su línea y atenuadas. La actividad se ve solo mientras el subagente trabaja o te espera, y solo si ya se conoce (sin ninguna llamada de herramienta aún, no hay línea: la etiqueta de estado ya dice `Working`). Un subagente terminado muestra la tarea, no la actividad.
3. **Estado:** la etiqueta de estado con su color y, atenuados, separados por ` · ` y en este orden: `hechas/total` de las tareas (solo el agente principal, y solo si tiene checklist), el tiempo y los tokens con su unidad (solo si hay): `Working · 1/3 · 3m 36s · 230 tokens`.
4. **Barra:** al final de la línea de estado, separada de sus campos por dos espacios (`Working · 1/3 · 3m 36s · 230 tokens  ███░░░░░░░`), solo mientras el agente trabaja o te espera (ver «Barras»).
5. **Checklist** (solo el agente principal): una fila `marca nombre` por tarea (ver «El checklist»).

El historial tiene el mismo diseño con el turno como cabecera: `marca título` y, debajo, su estado final, tiempo y tokens; el agente principal y los subagentes del turno van dentro, sangrados cuatro columnas, sin filas en blanco entre ellos y sin barras.

### Barras

Hay **una sola barra por el agente principal y una por cada subagente activo, y ninguna más**: ni en las tareas del checklist, ni en los agentes terminados, ni en el historial, ni una del turno. Es la barra indeterminada de siempre (un bloque de 3 segmentos que se mueve con el temporizador, `bar(null, tick)`); **el radar nunca inventa porcentajes**. Va al final de la línea de estado del agente, no en una línea propia. Es azul mientras el agente trabaja y amarilla si te espera; al terminar (`Done`, `Failed` o `Stopped`) desaparece.

### El ancho

Todo se trunca con `…` al ancho del cuerpo del panel; no hay umbrales de ancho ni campos que desaparezcan por falta de sitio. En un panel estrecho todo cede a la vez y se corta con `…`: el nombre del agente y su `· modelo · esfuerzo` (que se encogen juntos), la tarea, el título del turno y su motivo, los subtítulos de los títulos de sección y los nombres del checklist; la línea de estado (etiqueta, tiempo, tokens) y la barra que va a su final se dibujan siempre y solo los campos de la línea de estado se cortan por el final si ni siquiera ellos caben (la barra no se corta). La línea de guiones bajos de los títulos también se corta al ancho si el panel mide menos de 30.

### Estado del turno

El encabezado de la ejecución actual ya no lleva una etiqueta de fase propia: el estado de cada agente está en su línea de estado (`Working`, `Needs you`, `Done`, `Failed`, `Stopped`) y el `●` del encabezado dice si algo corre. Un turno sigue abierto, y su `●` parpadeando, mientras el agente principal o algún subagente sigan activos, aunque el principal ya haya terminado. Con el motor preguntándote un permiso, la línea de estado de quien pregunta dice `Needs you` y el título del turno muestra `· Waiting for your permission`.

Cuando el agente principal terminó y no queda ningún subagente activo, el turno se archiva y pasa al historial con su estado final `Done`, `Stopped` o `Failed` (ver «Historial»).

### El checklist

Sale solo de lo que Claude ya crea por su cuenta: `TodoWrite`, `TaskCreate` y `TaskUpdate`. El radar no obliga a crear planes ni pide reportes. Cada tarea es una fila simple, la marca y el nombre, sin barra ni etiqueta de estado: las hechas llevan `✓` verde y el nombre atenuado; la actual, `▶` (en el color del agente activo) y el nombre destacado; las pendientes, `○` y el nombre atenuados. Los nombres se cortan con `…` al ancho. Si no hay lista y el agente trabaja, muestra una sola fila `Working on your request`. El avance se lee en el `hechas/total` de la línea de estado del agente principal; el radar **nunca inventa porcentajes**.

### Subagentes

- **Alta:** el hook `agent.spawn` guarda cada ejecución con su `agentId` y devuelve el resultado del motor tal cual.
- **Nombre real:** el `subagentType` (`frontend-developer`, `Explore`, un agente de un plugin…), nunca una etiqueta genérica; solo se trunca visualmente.
- **Dentro del turno:** los subagentes de un turno se quedan en la ejecución actual, con su estado (`Done`, `Failed` o `Stopped`) y su tiempo congelado, hasta que el turno se archiva. Ya no se retiran a los pocos segundos.
- **Líneas:** las mismas que las del agente principal (ver «Cada agente en líneas»): la cabecera (marca de estado, nombre, modelo y esfuerzo), la tarea delegada, la actividad, la línea de estado (etiqueta, tiempo y tokens) con la barra al final. La barra **nunca lleva porcentaje**: se mueve mientras el subagente trabaja o te espera y desaparece al terminar (el color y la etiqueta de estado dicen cómo acabó). De un subagente terminado se ve la tarea, no la actividad.
- **Modelo y esfuerzo:** junto al nombre, atenuados (`Explore · haiku · low`). Salen de `turn.step` (cada petición al modelo, del agente principal o de un subagente por su `agentId`); antes de la primera petición de un subagente se muestra el modelo que dio su spawn. El id se acorta (`claude-opus-4-5-20251101` es `opus-4-5`; un alias como `haiku` queda igual). Si el modelo no admite esfuerzo, solo se ve el modelo; si aún no se sabe nada, nada.
- **Tokens:** ver «Tokens» más abajo.
- **Instancias independientes:** dos ejecuciones del mismo agente son dos entradas, con su tiempo y su estado propios.
- **Tarea y actividad:** la tarea delegada completa (sin rutas ni código, cortada con `…` al ancho) y, debajo, la actividad actual, cada una en su línea atenuada y sangrada bajo el nombre. La actividad sale de los `tool.call` con el `agentId` del subagente, descrita con palabras locales y sin rutas, comandos ni código:

  | Herramienta | Actividad |
  |---|---|
  | `Read` | `Reading project files` |
  | `Glob`, `Grep`, `WebSearch`, `WebFetch` | `Searching project information` |
  | `Edit`, `Write`, `NotebookEdit` | `Updating project files` |
  | `Bash` con `test`, `jest`, `vitest` o `pytest` al inicio de una palabra | `Running tests` |
  | otro `Bash` | `Running a command` |
  | `Agent`, `Task` | `Delegating work` |
  | cualquier otra | la actividad no cambia |

  Mientras no haya ninguna, el subagente no tiene línea de actividad (el estado `Working` ya dice que trabaja).
- **Estados:** `●` verde `Working`, `●` amarillo `Needs you`, `✓` `Done`, `✗` `Failed`, `■` `Stopped`. Termina con el `turn.complete` del subagente: `answer` es Done, `aborted` es Stopped, `error` o `refusal` es Failed. El tiempo individual se congela al terminar. La primera finalización manda; si ese agente vuelve a llamar a una herramienta, regresa a `Working`.
- **Jerarquía:** solo si el spawn trae `parentAgentId` y ese padre sigue en la lista; entonces el hijo va debajo de su padre, sangrado dos columnas más por cada nivel. Si no, la lista es plana. Todo el bloque va bajo el encabezado `Subagents`, cada agente dos columnas dentro.
- La finalización de un subagente no cierra el turno principal ni al revés: el turno sigue abierto mientras alguno de los dos esté activo. Un subagente en segundo plano que sigue trabajando después de que el agente principal responda mantiene el turno en la ejecución actual.

### Tokens

El panel muestra los tokens de cada agente, los del turno en el encabezado y los de cada turno archivado. Son cifras reales, no estimaciones, y el radar sigue sin llamar a ningún modelo ni leer transcripciones:

- **De dónde salen:** del `usage` que el motor entrega con el resultado de cada petición al modelo (`turn.step`), tal como lo reportó la API. El hook captura el resultado del flujo, lee `usage` y lo devuelve **intacto** (sigue siendo de solo observación). La petición es del agente principal o, si trae `agentId`, de un subagente.
- **Qué suman:** `input_tokens + output_tokens + cache_creation_input_tokens`. **No** suman `cache_read_input_tokens`: el prefijo del prompt que sirve la caché se vuelve a leer en cada paso y inflaría la cifra. Es una elección de este mod (`tokensOf`); la cifra no pretende coincidir con una factura.
- **Cómo se acumulan:** el principal en `leaderTokens` (se reinicia al empezar cada turno) y cada subagente en su `tokens`; el total del turno es el principal más todos los subagentes. Al archivar el turno se guardan en su registro (`tokens`, `leader.tokens`, y los de cada subagente). Una petición de un subagente que llega antes de que su spawn quede listado se guarda aparte (junto a su modelo y esfuerzo) y se aplica al listarse.
- **Lo que no se usa:** el `usage` que trae `turn.complete` (la suma del turno) no se lee, para no contar dos veces lo que los pasos ya sumaron.
- **Formato:** `850`, `1.2k` (un decimal por debajo de 100k), `150k` (entero desde 100k), `1.2M` (`compactTokens`). Sin tokens todavía, no se muestra la cifra. La palabra (`tokens`, también en español) acompaña la cifra del encabezado y la de la línea de estado de cada agente y de cada turno del historial; es el último campo de la línea.

### Historial

Un turno se **archiva** cuando el agente principal terminó (bien, con error o interrumpido) y no queda ningún subagente activo; al cancelarlo (`aborted`) se archiva de inmediato, aunque queden subagentes activos: pasan a `Stopped` con el turno. Se guarda en el estado (`turns`, hasta 10 turnos, el más reciente primero; el más viejo se descarta al pasar de 10) como un registro con:

- el **título** del turno y su **estado final**: `Done` si se respondió, `Stopped` si se canceló, `Failed` si terminó con un error o una negativa del modelo;
- cuándo empezó y cuándo terminaron el agente principal y todos sus subagentes (la duración es la diferencia);
- los **tokens** del turno (el total del principal y los subagentes);
- el **agente principal**: modelo y esfuerzo, cuántas tareas del checklist se hicieron del total y sus tokens;
- los **subagentes** del turno, en orden de inicio, cada uno con su estado final, duración, tokens y tarea.

El panel dibuja un grupo por turno, siempre abierto, con el mismo diseño vertical que la ejecución actual (ver «Cada agente en líneas»): una cabecera (`marca título`) y debajo, sangrado dos columnas, su estado final con su color, duración y tokens (`Done · 3m 10s · 1.3k tokens`; el estado del turno usa su propia etiqueta y color). Dentro, sangrados cuatro columnas, el agente principal (cabecera con modelo y esfuerzo y su línea de estado con `hechas/total` si había tareas, tiempo y tokens) y sus subagentes con su jerarquía, cada uno con su estado final, duración, tokens y, en su línea, su tarea (la actividad no se conserva). Sin barras: ningún agente terminado la lleva. Un turno sin subagentes muestra solo el agente principal. Entre un grupo y el siguiente va una fila en blanco, sin líneas. El checklist y el motivo exacto de un error no se conservan en el historial.

El historial **no usa el verde**: un turno o un agente terminado con éxito (`✓` y `Done`) se dibuja en el color normal del texto, y los demás colores se mantienen (rojo para `Failed`, naranja para `Stopped`). La ejecución actual conserva sus colores, incluido el verde de lo que trabaja.

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

## Consumo de tokens del mod: prácticamente cero

Lo que el mod gasta, no lo que muestra (los tokens que ve el panel son los de Claude y sus subagentes; ver «Tokens»). El mod solo observa eventos y dibuja:

- no llama a ningún modelo (ni para títulos, porcentajes o actividades);
- no engancha `prompt.compose` ni ningún otro `prompt.*`, no inyecta instrucciones ni mensajes en la conversación;
- no registra herramientas ni agentes, y no crea subagentes de supervisión; su único comando es `/agent-radar` (abre y cierra el panel), cuya respuesta es la única línea que escribe en la conversación;
- no lee transcripciones ni archivos de agentes; el estado se actualiza con los eventos que ya pasan;
- los hooks de eventos devuelven `next(e)` o el resultado de `await next(e)` sin tocarlos (el de `turn.step`, un generador, captura el resultado con `yield* next(e)`, lee su `usage` y devuelve ese mismo resultado);
- un único temporizador de 250 ms (animación y tiempos del panel) que corre **solo con el panel abierto** y mientras hay algo que mover, y se cancela al cerrarlo, al quedar inactivo o en `OFF`. Con el panel cerrado no hay tics: el estado se actualiza solo por eventos. Ya no hay ningún temporizador de un solo disparo: los subagentes no se retiran por tiempo, el turno se archiva con el evento que lo termina.

## Tipo y fuente de datos

- **Tipo:** hook (plugin de Claude Code).
- **Eventos:** `session.start` (registra el comando), `command.run` de `/agent-radar`, `session.end` (borra el estado de la sesión), `ui.close` del panel de detalle, `turn.start` (abre el turno; si uno seguía abierto, lo archiva a la fuerza), `turn.step` (solo observa: el modelo, el esfuerzo y, una vez respondida la petición, los tokens de su `usage`), `turn.complete` (termina al agente principal o a un subagente y archiva el turno cuando ya no queda nada activo), `tool.call`, `tool.check` (para `Needs you`: solo cuenta una pregunta de origen `engine`), `agent.spawn`.
- **Dibujo:** `ui.render` sobre `AbovePrompt` (la banda), sobre `Pane` con `requestId` `agent-radar` (el panel de detalle) y sobre las cuatro filas técnicas. El panel se abre y cierra con `$.ui.open` / `$.ui.close`.
- **Estado:** `$.state` con cinco claves: `claudeRadarState` (todo el estado: el turno actual con sus subagentes y sus tokens, y `turns`, los turnos archivados), `claudeRadarHidesTools` (si las filas están ocultas; aparte para que la transcripción se redibuje al cambiar de fase y no en cada tic), `claudeRadarPaneOpen` (si el panel está abierto, para el botón y el temporizador), `claudeRadarBandHidden` (si la banda está quitada) y `claudeRadarLang` (el idioma, o `null` hasta que se lee).
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
│   ├── claude-radar.tsx         # lógica pura: reducers, archivo de turnos, tokens, barras, tiempos, ocultación, vista del panel de detalle
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
- **Tokens:** los tests alimentan el `usage` con un `turn.step` simulado; no se vio con cifras de un Claude Code real. Solo cuentan las peticiones que pasan por `turn.step`: no las de otros plugins (`$.model.complete`), ni un resumen de compactación, ni las de un subagente que el radar no sigue (sin spawn visible). Una petición cuyo flujo se corta antes del final, o cuya respuesta no trae `usage`, no suma. Son los tokens que reporta la API menos la lectura de caché (ver «Tokens»), así que no son lo que cobra el proveedor.
- **Identificador de sesión:** el spawn no trae uno; `sessionId` queda vacío.
- **Jerarquía:** se apoya en `parentAgentId` tal como lo describen los tipos; no se vio con subagentes anidados reales.
- **Actividad:** se deduce solo del nombre de la herramienta (y, en `Bash`, de si el comando parece una prueba), no de su resultado. Es una pista, no una garantía de lo que ocurre. Una herramienta desconocida no cambia la actividad.
- **`AskUserQuestion`** no se puede montar en el kit de pruebas (exige un único nodo del motor): la garantía de que el radar no lo toca es que no hay ningún hook sobre él.
- **`CommandOutput`** no se oculta: es la salida de comandos slash, no de herramientas en curso.
- **Filas anteriores:** mientras el radar oculta, también se ocultan las filas técnicas de turnos previos; vuelven al terminar. Con subagentes activos después de acabar el turno principal, siguen ocultas hasta que terminen.
- **`ToolProgress`** solo existe en la superficie de terminal.
- **Ancho del panel:** que cada línea se corte con `…` sin desbordar se apoya en la disposición flexible del motor. El kit de pruebas no mide anchos: los tests comprueban las líneas que se dibujan (a 24, 40 y 60 columnas) y que cada texto con palabras lleve `truncate-end`, no el corte real. Con paneles muy estrechos (alrededor de 24 columnas) y varios niveles de subagentes anidados, la cabecera de un subagente puede quedar con muy poco nombre visible.
- Los tests no cubren el pintado real (colores, anchos, desplazamiento): comprueban la lógica y los árboles que dibujan los hooks. Solo se probaron las superficies terminal y escritorio.

## Licencia y apoyo

[MIT](./LICENSE) © Gersom. Si te sirve, puedes apoyar el proyecto con una donación por [PayPal](https://paypal.me/gersomalaja).
