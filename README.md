English | [Español](./README.es.md)

# agent-radar

A Claude Code hook that shows the work in progress of Claude and its subagents in a **detail pane** and leaves only a minimal line above the prompt: the name "Agent Radar" and two buttons. While Claude works, it visually hides the technical rows (tool calls and their results) and brings them back when it finishes. The visible title is **Agent Radar**.

## Name

The plugin identifier is `agent-radar`: the `claude-` prefix is reserved. On screen it is called "Agent Radar" (the button says `ON`/`OFF`). The original specification names it `claude-radar`; that is the name of its document and of the logic file (`hooks/claude-radar.tsx`), not of the plugin.

## Why

With many tool calls and several subagents in parallel, the conversation fills up with technical rows and it is hard to see what Claude is doing. The radar gathers what can be observed in a single pane and costs no tokens: it calls no model, adds nothing to the context and does not change what Claude does.

## How it looks

### The band above the prompt

A single line, no border: the name on the left and the buttons on the right. Nothing else: no title, no time, no states, no lists.

```
Agent Radar                         [ ◧ Detail ] [ ● ON ] [ ✕ Hide ]
```

- The `[ ◧ Detail ]` button opens the detail pane (and becomes `[ ◧ Close ]` while it is open). It is only visible with the radar `ON`.
- With the radar `OFF`: `Agent Radar`, `[ ● OFF ]` and `[ ✕ Hide ]`.
- The `[ ✕ Hide ]` button removes the band from the prompt bar (it does not turn the radar off: the pane and the hiding of technical rows continue according to ON/OFF). To bring it back: `/agent-radar show`. The choice is saved in `$.store` (key `bandHidden`) and survives across sessions.
- If width is short, the name is cut (`…`) before the buttons: the buttons never shrink.
- It yields to a survey (`hasSurvey`) and respects what other hooks draw below the band.

### The detail pane

The pane is organized by **turns**. A turn starts when you ask Claude for something and lasts until the main agent, **all its subagents and their background tasks** finish (or until you cancel it). At the top goes the **current run**, the turn in progress; below it, the **history**, with one group for each finished turn. Everything is always expanded: there are no collapsible sections or buttons inside the pane; if there is more than fits, the engine scrolls the pane.

With the radar `ON` and Claude working (in English, the default language; see "Language"):

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

Each agent (the main one and every subagent) is drawn the same way, in vertical lines one below the other and with no columns on the right: the pane is too narrow for so much data on a single line. It is the same layout in the current run and in the history. See "Each agent in lines" for the details.

When everything finishes, the current run moves to the history and the message `All done, ready for more instructions` remains.

## How the pane opens (and why only with the button)

**The pane only opens when you press `[ ◧ Detail ]`. The radar never opens it on its own.** As long as you do not open it, you will not see the progress: the band is just the name and the buttons.

The engine only places a pane that the plugin opens without anyone asking from 144 terminal columns; one opened by a keypress is placed at any width. That is why opening always comes from a keypress. If the surface does not place panes, the mod shows the notice `The detail pane is not available here` and leaves no pane waiting.

It closes with the same button (`[ ◧ Close ]`), with the `/agent-radar` command, or with the pane's own close mark or key; the button then goes back to `Detail`. Turning the radar off (`OFF`) also closes it.

## `/agent-radar` command

It opens and closes the same detail pane, for those who prefer to type, and shows or hides the band (`hide` / `show`). It is a request from the person, so the pane is placed at any width (as with the button).

| Command | Effect | Response |
|---|---|---|
| `/agent-radar` | toggles: opens if closed, closes if open | `Detail pane opened` / `Detail pane closed` |
| `/agent-radar open` | only opens; with the pane already open it does nothing | `Detail pane opened` |
| `/agent-radar close` | only closes; with the pane already closed it does nothing | `Detail pane closed` |
| `/agent-radar hide` | removes the band from the prompt bar (with the radar `ON` or `OFF`) | `Band hidden. Bring it back with /agent-radar show` |
| `/agent-radar show` | brings the band back | `Band shown` |
| `/agent-radar <anything else>` | changes nothing | `Usage: /agent-radar [open|close|hide|show]. With no argument, it toggles the pane.` |

- With the radar `OFF` it answers `Agent Radar is OFF. Turn it on with its button.` and opens nothing.
- If the surface does not place panes, the response and a notice give the reason (`The detail pane is not available here: <reason>`) and no pane is left waiting.
- The command's responses and description are in the detected language (see "Language"); in Spanish: `Panel de detalle abierto` / `Panel de detalle cerrado`, `Uso: /agent-radar [open|close]. Sin argumento, alterna el panel.` and `Agent Radar está apagado (OFF). Enciéndelo con su botón.`
- It is registered when the session starts (`session.start`) and served by a `command.run` hook. **It is the mod's only command**: the original specification forbade creating commands (`/simple`, `/radar` and the like) and control was by buttons only; the operator explicitly asked for this command. `/simple` and `/radar` still do not exist, and the radar is not turned on or off with commands: that belongs only to the ON/OFF button.
- **How it decides without reading the state:** for the engine to count the opening as a request from the person, `$.ui.open` has to be the command's first asynchronous step. That is why it decides with two module variables (whether the pane is open and whether the radar is `ON`) that mirror the atoms; `session.start` reads them again after a mod reload. If they were out of sync, the worst case is a `$.ui.open` on an already open pane, which the engine only retitles.
- The command's response is a line that stays in the conversation and that the model reads with the next message (a few tokens, only when you run it); the rest of the mod writes nothing to the conversation.

## Language

The interface speaks Spanish or English, with fixed dictionaries in `hooks/i18n.ts`: no agent translates anything, there are no model calls and it consumes no tokens. **There is no language button or command**: it is detected automatically.

- **Automatic:** it reads `settings.language` (`$.settings.read()`) once per mod load and again in each new session (`session.end` forgets it), and saves it in the state (`claudeRadarLang`). If you change the setting in the middle of a session, it is not reloaded until the next one. It is free text, so it recognizes Spanish in several forms (`Español`, `spanish`, `es`, `es-MX`, `castellano`, regardless of case or accents).
- **English by default:** if there is no `settings.language`, it cannot be read, or it names a language the mod does not have, it goes in English.
- **The proper name is not translated:** "Agent Radar" is the same in both languages.
- **What comes from the person's text or from the agents is not translated:** the turn title, the task names, the agent names and the delegated tasks are shown as they are.
- **The state stores no phrases:** the reasons (`permission`, `error`, `refusal`) and the activities (`reading`, `searching`, `updating`, `testing`, `command`, `delegating`) are codes, and the default title and the empty names are `null` or empty; the drawing puts them into words in the current language.
- **Adding another language:** one more dictionary in `TEXTS` (`hooks/i18n.ts`), its code in `Lang` (`types/index.d.ts`) and how it is recognized in `detectLang`.

With `settings.language` in Spanish, the band and the pane look like this:

```
Agent Radar                         [ ◧ Detalle ] [ ● ON ] [ ✕ Ocultar ]
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

With nothing running, the current run says `Todo listo, esperando instrucciones`.

## What the pane shows

No row limit (the engine scrolls it); everything is truncated with `…` to the pane's width. Two sections, separated by a blank row (no line); each title has below it a line of underscores (`_`, dimmed, 30 columns: equally long in both sections, and longer than any title), from the start of the row, that separates it from its content, and a blank row below. Both titles have the same format, `<title> · <subtitles>`, with the subtitles in gray (the turn's time and tokens, or the number of runs). There are no more thin lines: agents are separated by a blank row.

- **Current run**: the turn in progress.
  - **Heading:** the `●` and the section title, followed by its subtitles in gray with the same format as the history, `<title> · <subtitle>`: the turn's total time and its tokens (`Current run · 3m 36s · 19.8k tokens`; tokens only if there are any). The `●` is green and blinks with the timer while something runs (yellow if someone is waiting for you); when everything has finished it stays still and dimmed with the closing mark (`✓`, `✗` or `■`), which is hardly seen because the turn is archived at that moment. With no turn in progress, the `●` is dimmed.
  - The **turn title** (from the prompt, without paths or code, 80 characters at most and cut at word boundaries; the drawing cuts it with `…` to the real width). If the turn is waiting for your permission or ended with an error, the reason goes next to it, dimmed (`· Waiting for your permission`).
  - The **main agent** (`Main agent`): its lines (see below) and, at the end of them, its full checklist.
  - The block of the **turn's subagents** (those working and those already finished), a blank row lower and with their hierarchy (see "Subagents"): a `Subagents · 2 active` heading (`<title> · <active>`; the counter in green if there is any, dimmed if not) and, below it, each agent indented two columns, separated from the next by a blank row.
  - The block of the **background tasks** (commands that Bash left running, the main agent's and a subagent's), a blank row lower and only if there are any: a `Background tasks · 1 active` heading (`Tareas en segundo plano` in Spanish; it counts only its own, apart from the subagents) and, below it, one row per task with its state and its time. They are named by the call's description, never by the command (which may carry secrets); with no description, `Background command`. A subagent's task carries, dimmed next to the name, the name of the subagent that launched it (`Gradle build · executor`), if that subagent is in the turn; a task whose subagent is not followed is shown all the same, without a name. They close with their notification or with `TaskStop`; a live task continues in the new turn if you start another, and is only archived as `Stopped` when the turn is cancelled. A task that dies with the final response (`backgroundEndsWithFinalResponse`) becomes `Stopped` when the agent that launched it finishes: the main one or that subagent.
  - With no turn in progress: `All done, ready for more instructions`.
- **History**: the title with the number of turns as a gray subtitle, attached to the title (`History · 2 runs`; `History · 1 run` in the singular) and one group per finished turn, the most recent first, separated by a blank row, without lines (see "History"). Empty: `No finished turns yet`.

With no turn at all, neither in progress nor finished: `Nothing running yet`.

### Each agent in lines

The main agent and each subagent are drawn with the same lines, one below the other (in the current run and in the history). Everything below is indented two columns with respect to the mark of the first line:

1. **Header:** the status mark, the name (bold while working) and `· model · effort` dimmed (`● Explore · haiku · low`).
2. **Task and activity** (subagent only): the delegated task and, below it, the current activity, each on its own line and dimmed. The activity is only visible while the subagent works or is waiting for you, and only if it is already known (with no tool call yet, there is no line: the status label already says `Working`). A finished subagent shows the task, not the activity.
3. **Status:** the status label with its color and, dimmed, separated by ` · ` and in this order: `done/total` of the tasks (main agent only, and only if it has a checklist), the time and the tokens with their unit (only if there are any): `Working · 1/3 · 3m 36s · 230 tokens`.
4. **Bar:** at the end of the status line, separated from its fields by two spaces (`Working · 1/3 · 3m 36s · 230 tokens  ███░░░░░░░`), only while the agent works or is waiting for you (see "Bars").
5. **Checklist** (main agent only): one `mark name` row per task (see "The checklist").

The history has the same layout with the turn as the header: `mark title` and, below it, its final status, time and tokens; the turn's main agent and subagents go inside, indented four columns, with no blank rows between them and without bars.

### Bars

There is **one bar for the main agent and one for each active subagent or background task, and no more**: not on the checklist tasks, not on finished agents, not in the history, and not one for the turn. It is the usual indeterminate bar (a 3-segment block that moves with the timer, `bar(null, tick)`); **the radar never invents percentages**. It goes at the end of the agent's status line, not on a line of its own. It is blue while the agent works and yellow if it is waiting for you; when it finishes (`Done`, `Failed` or `Stopped`) it disappears.

### Width

Everything is truncated with `…` to the width of the pane's body; there are no width thresholds or fields that disappear for lack of room. In a narrow pane everything yields at once and is cut with `…`: the agent's name and its `· model · effort` (which shrink together), the task, the turn title and its reason, the subtitles of the section titles and the checklist names; the status line (label, time, tokens) and the bar at its end are always drawn and only the status line's fields are cut from the end if not even they fit (the bar is not cut). The line of underscores under the titles is also cut to the width if the pane is narrower than 30.

### Turn state

The current run's heading no longer carries a phase label of its own: each agent's state is on its status line (`Working`, `Needs you`, `Done`, `Failed`, `Stopped`) and the heading's `●` says whether something runs. A turn stays open, and its `●` blinking, while the main agent or any subagent remain active, even if the main one has already finished. With the engine asking you for a permission, the status line of whoever is asking says `Needs you` and the turn title shows `· Waiting for your permission`.

When the main agent has finished and no subagent is active, the turn is archived and moves to the history with its final status `Done`, `Stopped` or `Failed` (see "History").

### The checklist

It comes only from what Claude already creates on its own: `TodoWrite`, `TaskCreate` and `TaskUpdate`. The radar does not force plans to be created or ask for reports. Each task is a simple row, the mark and the name, with no bar or status label: finished ones carry a green `✓` and the name dimmed; the current one, `▶` (in the active agent's color) and the name highlighted; the pending ones, `○` and the name dimmed. Names are cut with `…` to the width. If there is no list and the agent is working, it shows a single row `Working on your request`. Progress is read in the `done/total` of the main agent's status line; the radar **never invents percentages**.

### Subagents

- **Registration:** the `agent.spawn` hook saves each run with its `agentId` and returns the engine's result as it is.
- **Real name:** the `subagentType` (`frontend-developer`, `Explore`, a plugin's agent...), never a generic label; it is only truncated visually.
- **Inside the turn:** a turn's subagents stay in the current run, with their state (`Done`, `Failed` or `Stopped`) and their time frozen, until the turn is archived. They are no longer removed after a few seconds.
- **Lines:** the same as the main agent's (see "Each agent in lines"): the header (status mark, name, model and effort), the delegated task, the activity, the status line (label, time and tokens) with the bar at the end. The bar **never carries a percentage**: it moves while the subagent works or is waiting for you and disappears when it finishes (the color and the status label say how it ended). For a finished subagent the task is shown, not the activity.
- **Model and effort:** next to the name, dimmed (`Explore · haiku · low`). They come from `turn.step` (each request to the model, from the main agent or from a subagent by its `agentId`); before a subagent's first request, the model given by its spawn is shown. The id is shortened (`claude-opus-4-5-20251101` becomes `opus-4-5`; an alias like `haiku` stays the same). If the model does not support effort, only the model is shown; if nothing is known yet, nothing.
- **Tokens:** see "Tokens" below.
- **Independent instances:** two runs of the same agent are two entries, with their own time and state.
- **Task and activity:** the full delegated task (without paths or code, cut with `…` to the width) and, below it, the current activity, each on its own dimmed line indented under the name. The activity comes from the `tool.call`s with the subagent's `agentId`, described in local words and without paths, commands or code:

  | Tool | Activity |
  |---|---|
  | `Read` | `Reading project files` |
  | `Glob`, `Grep`, `WebSearch`, `WebFetch` | `Searching project information` |
  | `Edit`, `Write`, `NotebookEdit` | `Updating project files` |
  | `Bash` with `test`, `jest`, `vitest` or `pytest` at the start of a word | `Running tests` |
  | other `Bash` | `Running a command` |
  | `Agent`, `Task` | `Delegating work` |
  | any other | the activity does not change |

  As long as there is none, the subagent has no activity line (the `Working` state already says it works).
- **States:** green `●` `Working`, yellow `●` `Needs you`, `✓` `Done`, `✗` `Failed`, `■` `Stopped`. It ends with the subagent's `turn.complete`: `answer` is Done, `aborted` is Stopped, `error` or `refusal` is Failed. The individual time freezes when it finishes. The first completion rules; if that agent calls a tool again, it goes back to `Working`.
- **Hierarchy:** only if the spawn carries `parentAgentId` and that parent is still in the list; then the child goes below its parent, indented two more columns for each level. Otherwise, the list is flat. The whole block goes under the `Subagents` heading, each agent two columns inside.
- A subagent's completion does not close the main turn nor the other way around: the turn stays open while either of them is active. A background subagent that keeps working after the main agent responds keeps the turn in the current run.

### Tokens

The pane shows each agent's tokens, the turn's in the heading and those of each archived turn. They are real figures, not estimates, and the radar still calls no model or reads transcripts:

- **Where they come from:** from the `usage` that the engine delivers with the result of each request to the model (`turn.step`), as the API reported it. The hook captures the stream's result, reads `usage` and returns it **intact** (it remains observation-only). The request is the main agent's or, if it carries `agentId`, a subagent's.
- **What they add up:** `input_tokens + output_tokens + cache_creation_input_tokens`. They do **not** add `cache_read_input_tokens`: the prompt prefix that the cache serves is read again on every step and would inflate the figure. This is a choice of this mod (`tokensOf`); the figure does not claim to match an invoice.
- **How they accumulate:** the main agent's in `leaderTokens` (reset when each turn starts) and each subagent's in its `tokens`; the turn's total is the main agent plus all the subagents. When the turn is archived they are saved in its record (`tokens`, `leader.tokens`, and those of each subagent). A subagent's request that arrives before its spawn is listed is saved apart (along with its model and effort) and applied when it is listed.
- **What is not used:** the `usage` that `turn.complete` carries (the turn's sum) is not read, so as not to count twice what the steps already added up.
- **Format:** `850`, `1.2k` (one decimal below 100k), `150k` (whole from 100k), `1.2M` (`compactTokens`). With no tokens yet, the figure is not shown. The word (`tokens`, also in Spanish) accompanies the heading's figure and that of the status line of each agent and of each history turn; it is the last field of the line.

### History

A turn is **archived** when the main agent has finished (successfully, with an error or interrupted) and no subagent or background task remains active; when it is cancelled (`aborted`) it is archived immediately, even if subagents or tasks remain active: they become `Stopped` with the turn. It is saved in the state (`turns`, up to 10 turns, the most recent first; the oldest is discarded when going past 10) as a record with:

- the turn's **title** and its **final state**: `Done` if it was answered, `Stopped` if it was cancelled, `Failed` if it ended with an error or a refusal from the model;
- when it started and when the main agent, all its subagents and its background tasks finished (the duration is the difference);
- the turn's **tokens** (the total of the main agent and the subagents);
- the **main agent**: model and effort, how many checklist tasks were done out of the total, and its tokens;
- the turn's **subagents**, in order of start, each with its final state, duration, tokens and task.

The pane draws one group per turn, always open, with the same vertical layout as the current run (see "Each agent in lines"): a header (`mark title`) and below it, indented two columns, its final state with its color, duration and tokens (`Done · 3m 10s · 1.3k tokens`; the turn's state uses its own label and color). Inside, indented four columns, the main agent (header with model and effort and its status line with `done/total` if there were tasks, time and tokens) and its subagents with their hierarchy, each with its final state, duration, tokens and, on its line, its task (the activity is not kept). No bars: no finished agent carries one. A turn with no subagents shows only the main agent. Between one group and the next goes a blank row, without lines. The checklist and the exact reason for an error are not kept in the history.

The history **does not use green**: a turn or an agent finished successfully (`✓` and `Done`) is drawn in the text's normal color, and the other colors are kept (red for `Failed`, orange for `Stopped`). The current run keeps its colors, including the green of what is working.

If a new turn starts while the previous one is still open (the main agent has finished but a subagent is still active), the previous one is archived by force: the still-active subagents become `Stopped` and the new turn starts empty; active background tasks are not archived: they continue in the new turn. When the session ends (`session.end`, also with `/clear`) everything the radar was following is erased, the history included; only the ON/OFF choice is kept.

## ON/OFF button

- The radar is turned on and off **only with its button**: there are no `/simple` or `/radar` commands, and `/agent-radar` only opens and closes the pane.
- The `[ ● ON ]` button is always visible: in `OFF`, with no turn and with Claude idle.
- Pressing it shows a brief notice (`Agent Radar: ON` / `Agent Radar: OFF`).
- Initial state: `ON`. The choice is saved in `$.store` (key `enabled`, the mod's own store, local to each machine) and restored when the session starts. If the store cannot be read or written, `ON` rules and the change is valid for the session all the same.
- In `OFF` Claude Code's normal interface is restored (the technical rows come back), the pane is closed and the detail button disappears.

## Hiding technical information

With the radar `ON`, while the main agent works (or there are active subagents), the radar draws an empty row in place of `ToolUse`, `ToolResult`, `ToolGroup` and the `ToolProgress` indicators. They come back on their own when:

- the turn ends and no subagent remains active,
- the radar goes to `OFF`,
- someone (the main agent or a subagent) is waiting for your permission: the tool asking for permission stays in view.

It is **drawing only**: it does not block, modify or cancel tools, the `tool.call` results arrive intact and the conversation is not touched. The rows of a call that failed or was interrupted are not hidden.

### Final response protection

The radar **does not hook** `AssistantMessage`, `UserMessage`, `TurnDuration`, `InfoNotice`, `SessionMode`, `AskUserQuestion`, `PromptHint` or `CommandOutput`: the final response, the file reports, the test results, the warnings and the errors are always drawn by the engine. `All done` coexists with the response, it does not replace it. The mod's only `ui.render`s are `AbovePrompt` (the band), `Pane` (the detail pane), `ToolUse`, `ToolResult`, `ToolGroup` and `ToolProgress`; `claude plugin validate` lists them.

## The mod's token usage: practically zero

What the mod spends, not what it shows (the tokens the pane sees are those of Claude and its subagents; see "Tokens"). The mod only observes events and draws:

- it calls no model (not for titles, percentages or activities);
- it hooks neither `prompt.compose` nor any other `prompt.*`, and injects no instructions or messages into the conversation;
- it registers no tools or agents, and creates no supervision subagents; its only command is `/agent-radar` (opens and closes the pane), whose response is the only line it writes to the conversation;
- it reads no transcripts or agent files; the state is updated with the events that already pass by;
- the event hooks return `next(e)` or the result of `await next(e)` without touching it (the `turn.step` one, a generator, captures the result with `yield* next(e)`, reads its `usage` and returns that same result);
- a single 250 ms timer (animation and pane times) that runs **only with the pane open** and while there is something to move, and is cancelled when it closes, when it goes idle or in `OFF`. With the pane closed there are no ticks: the state is updated only by events. There is no longer any one-shot timer: subagents are not removed by time, the turn is archived with the event that ends it.

## Type and data source

- **Type:** hook (Claude Code plugin).
- **Events:** `session.start` (registers the command), `command.run` of `/agent-radar`, `session.end` (erases the session state), `ui.close` of the detail pane, `turn.start` (opens the turn; if one was still open, archives it by force), `turn.step` (observes only: the model, the effort and, once the request is answered, the tokens from its `usage`), `turn.complete` (ends the main agent or a subagent and archives the turn when nothing remains active), `tool.call`, `tool.check` (for `Needs you`: only a question of `engine` origin counts), `agent.spawn`.
- **Drawing:** `ui.render` on `AbovePrompt` (the band), on `Pane` with `requestId` `agent-radar` (the detail pane) and on the four technical rows. The pane is opened and closed with `$.ui.open` / `$.ui.close`.
- **State:** `$.state` with five keys: `claudeRadarState` (the whole state: the current turn with its subagents and tokens, and `turns`, the archived turns), `claudeRadarHidesTools` (whether the rows are hidden; separate so that the transcript is redrawn when the phase changes and not on every tick), `claudeRadarPaneOpen` (whether the pane is open, for the button and the timer), `claudeRadarBandHidden` (whether the band is removed) and `claudeRadarLang` (the language, or `null` until it is read).
- **Store, settings and clock:** `$.store` (keys `enabled` and `bandHidden`), `$.settings.read()` (key `language`), `$.clock.now()` and `$.clock.every(250, …)`.

## Installation

It is installed in one step:

```
/plugin install agent-radar --marketplace Gersom/claude-mod-agent-radar
```

Or in two steps:

```
/plugin marketplace add Gersom/claude-mod-agent-radar
/plugin install agent-radar@agent-radar
```

To try it from a local folder, without installing, in a terminal session:

```bash
claude --plugin-dir .
```

The mod runs with your permissions, like any plugin; `claude plugin validate` lists the hooks and the calls it makes before you install it. Developed and tested with Claude Code 2.1.296.

### Moving it to another computer

The mod is a folder with no dependencies:

1. Clone the repository (`git clone https://github.com/Gersom/claude-mod-agent-radar`) or copy the whole `agent-radar/` folder.
2. On the other computer, install it with the commands above, or load it with `claude --plugin-dir <folder>`.

What is saved with the button (ON/OFF) lives in each machine's local store: it does not travel with the folder; on the other computer it starts at `ON`.

## Usage

```bash
claude plugin validate .
claude plugin test .
```

The tests cover the pure logic and the hooks under the engine's test kit, on terminal and desktop.

## Structure

```
agent-radar/
├── LICENSE                      # MIT license
├── .claude-plugin/
│   ├── plugin.json              # plugin manifest
│   └── marketplace.json         # single-plugin marketplace (standalone installation)
├── hooks/
│   ├── hooks.json               # points to register.tsx
│   ├── register.tsx             # hooks, atoms and every use of $: the minimal band, the detail pane, the language and the hidden rows
│   ├── i18n.ts                  # Spanish and English texts and language detection (pure logic)
│   ├── i18n.test.ts             # tests for the detection and the dictionaries
│   ├── claude-radar.tsx         # pure logic: reducers, turn archive, tokens, bars, times, hiding, detail pane view
│   └── claude-radar.test.ts     # tests (logic and render)
└── types/index.d.ts             # state contract ($.state): ClaudeRadarState, TurnRecord, SubagentState, Lang, claudeRadarHidesTools, claudeRadarPaneOpen, claudeRadarLang
```

`tsconfig.json` and `.claude-plugin/types/` are generated by Claude Code when it loads the mod and are in `.gitignore`.

## Engine constraints that shape the design

- **`$` does not cross imports:** `claude plugin validate` requires that `$` not be passed to imported functions. That is why the atoms and every use of `$` live in `register.tsx`, and `claude-radar.tsx` is pure logic only (reducers, formatting) that receives and returns data.
- **The state lives in `$.state`:** a reloaded module loses its variables; what must survive (the radar's state) goes in atoms. The timer and the restoration of the saved choice do belong to the module and start over on reload.
- **A pane the plugin opens without anyone asking is not placed under 144 columns:** hence the pane only opens with the button and, without opening it, the progress is not seen.
- **The engine does not hand the plugin its own close:** the `ui.close` hook only hears the person's closes, so the button lowers its mark when it closes the pane itself.
- **`ui.render` cannot return `null`:** the type requires a `RenderElement`, so "draw nothing" is a `<Box />` with no children.
- **Reading an atom from `ui.render` subscribes the row:** an atom that changes every 250 ms would redraw every technical row four times a second; hence the separate `claudeRadarHidesTools` atom, which is only written when the value changes.
- **The tests cannot read the source code** (there is no dynamic `import()` or `node:fs` in the hook modules): the guarantee that certain components are not hooked rests on rendering them with the radar `ON` and working, and on `validate`'s list of hooks.
- `validate` warns that `agent.spawn`, `tool.call`, `tool.check` and `ui.close` are hooks "without `.catch`". Here it is informational: they only observe and return the engine's result, they decide nothing.

## Real API limitations

What **could not be verified** against the real Claude Code (the tests use the engine's simulated kit):

- **Language:** `settings.language` is free text and only Spanish is recognized; any other value goes in English. The reason that accompanies the "the pane is not available" notice is given by the engine in its own words (in English) and is not translated. Both translations are checked by the tests with simulated settings, not with a real `settings.read`.
- **`/agent-radar`:** that the engine counts the command's opening as a request from the person (and therefore places the pane at any width) rests on `$.ui.open` being its first asynchronous step; the test kit does not distinguish requests from the person, so only the order of the calls was checked and not the real placement. If the pane were not placed, the command's response would say so.
- **Without opening the pane the progress is not seen.** It is a decision (see "How the pane opens"), not a shortcoming: a pane opened by the mod would not be placed under 144 columns.
- **Where the pane docks** (beside the transcript or over the prompt) and how it looks with `rows: 14` / `columns: 60`; that `isPlaced` is `false` on unsupported surfaces (only tested with a simulated `ui.open`).
- **Close by the user:** the `ui.close` hook that returns the button to `Detail` could not be exercised with the kit (the tests' `$` cannot close panes or simulate the person), so it rests on what the types say. If the engine did not deliver that event, the button would stay on `Close`; a keypress would call a close on an already closed pane, which the engine ignores, and it would return to `Detail`.
- **The band is redrawn with every write to the state:** it reads the state to know whether the radar is `ON`. With the pane closed there are only writes by events; with the pane open, one every 250 ms while there is work.
- **`Needs you` depends on the `engine` origin:** it is triggered by a `tool.check` with an `ask` decision made by the engine. In some modes that question goes to a classifier and not to a person, and the radar cannot tell the difference; the mark is lifted with the same agent's next `tool.call`. For a subagent it is the same.
- **Empty `<Box />` in Ink:** it is assumed to take up 0 rows; the margin of the containing row may remain.
- **Redrawing of the hidden rows:** that each transcript row reacts to the change of `claudeRadarHidesTools` was checked with the kit, not with the real engine. A race between two concurrent changes could leave it out of sync for a moment; it is corrected with the next state change.
- **Teammates:** a teammate that goes idle and wakes up emits one `turn.complete` per run. The radar marks it `Done`; if the turn is archived with that, it ignores its later calls, because it is no longer in the current turn's list (it stays in the turn's history).
- **Subagents with no `turn.complete`** (a remote agent of a workflow, for example) stay in `Working` until `session.end` (or until another turn starts, which archives the previous one by force and moves them to `Stopped`); meanwhile they keep the turn open and, with the pane open, the timer alive.
- **Tokens:** the tests feed the `usage` with a simulated `turn.step`; it was not seen with figures from a real Claude Code. Only the requests that pass through `turn.step` count: not those of other plugins (`$.model.complete`), nor a compaction summary, nor those of a subagent the radar does not follow (with no visible spawn). A request whose stream is cut before the end, or whose response carries no `usage`, does not add up. They are the tokens the API reports minus the cache read (see "Tokens"), so they are not what the provider charges.
- **Session identifier:** the spawn does not carry one; `sessionId` stays empty.
- **Hierarchy:** it rests on `parentAgentId` as the types describe it; it was not seen with real nested subagents.
- **Activity:** it is deduced only from the tool's name (and, in `Bash`, from whether the command looks like a test), not from its result. It is a hint, not a guarantee of what is happening. An unknown tool does not change the activity.
- **`AskUserQuestion`** cannot be mounted in the test kit (it demands a single engine node): the guarantee that the radar does not touch it is that there is no hook on it.
- **`CommandOutput`** is not hidden: it is the output of slash commands, not of tools in progress.
- **Earlier rows:** while the radar hides, the technical rows of previous turns are also hidden; they come back when it finishes. With subagents active after the main turn ends, they stay hidden until those finish.
- **`ToolProgress`** only exists on the terminal surface.
- **Pane width:** that each line is cut with `…` without overflowing rests on the engine's flexible layout. The test kit does not measure widths: the tests check the lines that are drawn (at 24, 40 and 60 columns) and that each text with words carries `truncate-end`, not the real cut. With very narrow panes (around 24 columns) and several levels of nested subagents, a subagent's header may be left with very little visible name.
- The tests do not cover the real painting (colors, widths, scrolling): they check the logic and the trees the hooks draw. Only the terminal and desktop surfaces were tested.

## License and support

[MIT](./LICENSE) © Gersom. If it is useful to you, you can support the project with a donation via [PayPal](https://paypal.me/gersomalaja).
