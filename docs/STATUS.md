# STATUS

The running log for ORBITAL. If you are resuming this project, read this file
first, then `docs/ARCHITECTURE.md`. The orchestrator updates it at every
milestone boundary and whenever a decision is made.

## Current milestone

**M5 done: Jupyter parity, round one.** Kernel-backed autocomplete and hover
docs, Shift+Tab inspect, a live variable inspector, multiple notebooks in
tabs, a full notebook toolbar with kernel picker, per-cell hover toolbar,
cut/copy/paste/undo/merge/split/collapse, a command palette (Ctrl+K), and a
single mode dropdown replacing the segmented dial.

**M6 and M7 done, awaiting owner test.** M6: file browser with text-file
tabs, in-app terminal (Git Bash via Jupyter terminals), `clear_output` and
`update_display_data`, ANSI colors, sandboxed HTML outputs, large-output
truncation, autosave, movable/resizable docks that always fit the window,
keyboard rework per `docs/KEYBOARD.md`. M7: agent sidecar on the Claude Agent
SDK using Claude login, with an in-app panel, notebook tools, and permission
prompts.

**Next up:** owner testing of M6, M6.5 and M7, then M8 (Map view).

## How to run

One command from the project root:

```
scripts/dev.ps1     # Windows
scripts/dev.sh       # macOS/Linux
```

It starts whichever of Jupyter (:8888), the agent sidecar (:8787), and the
app (:5173) aren't already running — each in its own window/process, from
`scripts/jupyter.ps1`/`.sh`, `scripts/agent.ps1`/`.sh`, `scripts/app.ps1`/`.sh`
— prints `<service>: already running` or `<service>: started` for each, then
opens http://localhost:5173 once the app answers. Run those three scripts
directly only if you need one service on its own.

Agent login (once, in the ORBITAL terminal or any shell):

```
npx -y @anthropic-ai/claude-code@latest auth login
```

The panel shows this command itself when the sidecar reports no login.

Open http://localhost:5173, click Connect (defaults: `http://localhost:8888`,
token `orbital-dev`, editable in Settings), pick `hull-stress-analysis.ipynb`,
Run all. `?mode=bridge&fixture=1` on the URL loads a canned notebook without
a server, for screenshots.

Checks:

```
cd app && npx tsc -p tsconfig.app.json --noEmit && npm test && npm run build
```

`npm test` runs 178 tests; the live-kernel ones skip if the server is not up.
See `docs/HANDOFF.md` for the resume guide.

## Milestones

| # | Milestone | Owner tier | State |
|---|---|---|---|
| M0 | Docs, scaffold, venv, Jupyter config | Fable | done 2026-09-13 |
| M1 | Theme system, app shell, mode dial, placeholder views, Bridge sky | Sonnet | done 2026-09-13 |
| M2 | Session layer over `@jupyterlab/services` | Opus | done 2026-09-13 |
| M3 | Notebook UI: cells, CodeMirror, outputs, markdown, ipynb load/save | Sonnet | done 2026-09-13 |
| M4 | Integration, live run, audit, first commit | Fable | done 2026-09-13 |
| M5 | Parity 1: completion, inspect, inspector, cell ops, kernel picker, tabs, palette, mode dropdown | Opus + Sonnet | done 2026-09-13 |
| M6 | Parity 2: file browser, terminal, clear_output, sandboxed outputs, ANSI, autosave, docks, keyboard | Sonnet + Opus | done 2026-09-14 |
| M7 | AI harness: Agent SDK sidecar + panel (Claude login) | Opus + Sonnet | done 2026-09-14, untested with a live login |
| M6.5 | Usability: one launcher, rail activity bar, Home page, layout menu, service dots, honest agent connection states, first-run hint | Sonnet | done 2026-09-14 |
| M8 | Map view, minimal first, orbit mode second | Opus | not started |
| M9 | Hub: accounts, presence, shared projects, Yjs co-editing | Opus | not started |
| M10 | Hardening: Playwright e2e, virtualized cells, packaging | Sonnet | not started |

## What M4 verified live (2026-09-13)

- Connect → notebook list from the contents API → open → kernel `python3 · idle` in the topbar.
- Run all: pandas `describe()` renders as an HTML table, `NameError` renders as a traceback with the `---->` line highlighted, a 3-iteration print loop merges into one stream block.
- Statusbar counts `4 cells · 3 executed · 1 error(s)`.
- Save writes execution counts, outputs, and cell ids to `workspace/hull-stress-analysis.ipynb`; kernelspec metadata preserved.
- Mode switching live with no console errors; Bridge sky mounts only in bridge; theme persists in `localStorage` under `orbital.theme`.

## What M5 verified live (2026-09-13)

- Typing `np.ar` in a cell opens kernel completions (`arange`, `arccos`, ...); Shift+Tab on `np.arange` shows its signature.
- After Run all the inspector lists `df DataFrame 48,000 × 3`, `np module`, `rng Generator`, and the loop counter.
- Ctrl+K opens the palette with 34 commands; typing `restart` narrows to the two restart commands.
- The mode dropdown lists all four modes with their skins and switches both.
- Checks: tsc clean, build clean, 53 tests (22 store, 15 live session, 7+1 inspector, 4 model, 4 completion).

## What M6/M7 verified (2026-09-14)

- Checks: tsc clean, build clean, 168 frontend tests, 5 sidecar tests, no color literals.
- Live: connect → open → Shift+Enter runs the cell and moves focus into the next cell's editor; typing lands there; Escape returns to command mode (verified by a CDP-driven headless run, see session log).
- Terminal: Git Bash prompt visible in the bottom dock; `echo` round-trips.
- `clear_output(wait=True)` loops render one line that updates in place.
- Fit: `scrollWidth === clientWidth` and `scrollHeight === clientHeight` at 1280×800, 1024×700, 800×600; side docks become overlays under 900px.
- Agent panel: connects to the sidecar and shows the login gate with the exact `auth login` command when no Claude login exists (the state on this machine).

## Decisions log

- **2026-09-13** Custom web frontend on Jupyter Server, not a JupyterLab or VS Code extension. Reason: whole-shell control; kernel protocol and ipynb are the durable parts.
- **2026-09-13** Style exploration done: 20 mockups, 4 modes. Defaults: paper→Clinical Terminal, night-ops→Deep Space, cockpit→Glass Deck, bridge→Nebula Drift. Alternates registered as skins. See `styleguide/CATALOG.md`.
- **2026-09-13** Model routing: Fable orchestrates and audits; Opus for the session layer and complex engines; Sonnet for UI and bulk. Hand-written vs generated comparison showed little difference; normal routing applies.
- **2026-09-13** Vite pinned to 5.x (Node 18 on the dev machine). vitest pinned to 2.x for the same reason.
- **2026-09-13** Python 3.11 venv at `.venv` with jupyter_server 2.21, ipykernel 7.3, numpy, pandas.
- **2026-09-13** Switching notebooks leaves the previous kernel running (Jupyter convention; `openNotebookSession` reuses it on return). Explicit Close shuts it down.
- **2026-09-13** M5: multi-document store (`docs` by path, per-path execution queues, module-level kernel session map). Escape in an editor only leaves edit mode when CodeMirror did not consume it (popup/tooltip open).
- **2026-09-13** Jupyter Server reports `execution_state: "starting"` until the first websocket client connects, so a raw REST kernel probe is not a health check; the live vitest suite is. On Windows a venv's `python.exe` is a launcher, so the server's real process shows the base interpreter's path in the process list; that is normal. The config now refuses to start outside the venv.
- **2026-09-14** M7 AI harness will use **Claude login** (Agent SDK with the user's Claude account), not an API key. Owner decision.
- **2026-09-14** Shift+Enter lands in **edit mode** on the next cell (differs from classic Jupyter). Single-letter shortcuts fire only when a `.cell` element itself has focus. See `docs/KEYBOARD.md`.
- **2026-09-14** Owner feedback after M6/M7: the sidecar was never started (three scripts is unfriendly) and closed panels had no visible way back. M6.5 added `scripts/dev.ps1` (one launcher), rail toggles for every panel, the logo as a Home button, a Layout menu, and explicit "sidecar not running" state with the command and a Retry button. `Start-Process -File` needs the script path quoted because the project path contains a space.
- **2026-09-14** Panel sizes are stored as the user's preference and clamped only at render time (`effectiveSize`). Persisting clamped values made a briefly narrow window shrink every panel permanently.
- **2026-09-14** `useUiStore` moved to `shell/uiStore.ts`; `shell/commands.ts` must never import anything that imports `notebook/commands.ts` (module-init cycle caused TDZ errors).
- **2026-09-14** Sidecar auth probe: `claude auth status --json` from the SDK's bundled runtime first, a one-turn `query()` only when a credential exists but might be stale.
- **2026-09-14** A subagent force-killed all Chrome processes during a live check; CLAUDE.md now forbids killing processes not spawned by the agent.
- **2026-09-13** Execution count arrives from `execute_reply` at the end, so a cell shows `[*]` until it finishes. Early fill from `execute_input` is a known small improvement, not done.

## Known gaps / debt

- **Agent panel untested with a real login** on this machine; the login flow itself (`auth login`) opens a browser OAuth page the user completes.
- **Terminal text probe**: xterm renders to canvas, so `.xterm-rows` is empty; use screenshots to verify.
- **ipywidgets** still unsupported (widget comm protocol).
- **Live tests can flake** when another client (a browser tab, a headless verifier) holds kernels or terminals on the dev server at the same time; a clean re-run passes. Run `npm test` with no app tab open.

- **Inspector polish**: modules show their full repr instead of `name version`; IPython's injected `open` shows as a variable. Filter builtins and format modules.
- **Split at cursor** uses the DOM line under the selection (end of that line), not the exact character offset; CodeEditor needs to expose the cursor for a precise split.
- **`changeKernel`** writes `metadata.kernelspec` but the notebook must be saved for it to persist.
- **Markdown cells** do not respond to Enter-to-edit in command mode yet (double-click works).
- **Cockpit cell chrome**: cells use the shared gutter layout in every mode. The Glass Deck mockup's tab header with LED, count, language, and timing is not built yet.
- **No `clear_output` handling** in the session layer (dropped with a TODO); progress bars that rely on it will stack.
- **Markdown cell edit mode** exists but has had no live use yet.
- **Fixture notebook** (`notebook/fixture.ts`) is lazy-imported only under `?fixture=1`; it is dev tooling living in `src/`.
- The `useUiStore` lives in `App.tsx` and `Rail.tsx` imports it back, a harmless circular import worth moving to `shell/uiStore.ts`.
- Styleguide table numbers differ slightly between modes (cosmetic).

## Open questions for the owner

- Map view: mockup round or straight to one direction?

## Session log

- **2026-09-13 session 1** — CLAUDE.md; ideas list; architecture recommendation accepted; 16 mockups generated and audited (flex-shrink clipping fix); 4 hand-written E variants; CATALOG.md; docs; venv + Vite scaffold; M1–M3 dispatched in parallel and landed; M4 integration: fixed initial kernel status push, cockpit code size via `--code-size`, fixture path moved into NotebookView; live end-to-end verified; first commit.
- **2026-09-14 session 1, continued (M6+M7)** — M6 in two phases (A: Opus session additions + clear_output; Sonnet dock layout; Sonnet outputs/ANSI/iframe; Sonnet keyboard/autosave/help. B: Sonnet file browser + tabs; Sonnet terminal). M7 in parallel halves (Opus sidecar/store/executor; Sonnet panel UI). Audit fixes by the orchestrator: Shift+Enter advances immediately into edit mode; Ctrl+W/Ctrl+Tab route through the unified tabs store; layout clamp-persistence bug; import cycles (delegated). Committed.
- **2026-09-13 session 1, continued** — M5 in two phases: A (Opus: session `complete`/`inspect`/`executeSilent`/`changeKernel` + multi-doc store refactor; Sonnet: mode dropdown + palette; Sonnet: inspector module), B (Sonnet: toolbars, tabs, kernel picker, collapse, keyboard, commands; Sonnet: completion + hover + Shift+Tab). Diagnosed a dead-kernel scare (duplicate servers, one mine on 8889), hardened the Jupyter config, fixed the Escape conflict. Live E2E verified. Committed.
