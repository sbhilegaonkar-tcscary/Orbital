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

**Next up: M6, parity round two.** File browser, in-app terminal,
`clear_output` handling, sandboxed HTML outputs, ANSI colors, autosave.

## How to run

Two terminals from the project root:

```
scripts/jupyter.ps1     # Jupyter Server on :8888 from .venv, root = workspace/
scripts/app.ps1         # Vite on :5173
```

Open http://localhost:5173, click Connect (defaults: `http://localhost:8888`,
token `orbital-dev`, editable in Settings), pick `hull-stress-analysis.ipynb`,
Run all. `?mode=bridge&fixture=1` on the URL loads a canned notebook without
a server, for screenshots.

Checks:

```
cd app && npx tsc -p tsconfig.app.json --noEmit && npm test && npm run build
```

`npm test` runs 53 tests; the live-kernel ones (session, inspector, completion)
skip if the server is not up.

## Milestones

| # | Milestone | Owner tier | State |
|---|---|---|---|
| M0 | Docs, scaffold, venv, Jupyter config | Fable | done 2026-09-13 |
| M1 | Theme system, app shell, mode dial, placeholder views, Bridge sky | Sonnet | done 2026-09-13 |
| M2 | Session layer over `@jupyterlab/services` | Opus | done 2026-09-13 |
| M3 | Notebook UI: cells, CodeMirror, outputs, markdown, ipynb load/save | Sonnet | done 2026-09-13 |
| M4 | Integration, live run, audit, first commit | Fable | done 2026-09-13 |
| M5 | Parity 1: completion, inspect, inspector, cell ops, kernel picker, tabs, palette, mode dropdown | Opus + Sonnet | done 2026-09-13 |
| M6 | Parity 2: file browser, terminal, clear_output, sandboxed outputs, ANSI, autosave | Sonnet + Opus | not started |
| M7 | AI harness: Agent SDK sidecar + panel | Opus | not started |
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

## Decisions log

- **2026-09-13** Custom web frontend on Jupyter Server, not a JupyterLab or VS Code extension. Reason: whole-shell control; kernel protocol and ipynb are the durable parts.
- **2026-09-13** Style exploration done: 20 mockups, 4 modes. Defaults: paper→Clinical Terminal, night-ops→Deep Space, cockpit→Glass Deck, bridge→Nebula Drift. Alternates registered as skins. See `styleguide/CATALOG.md`.
- **2026-09-13** Model routing: Fable orchestrates and audits; Opus for the session layer and complex engines; Sonnet for UI and bulk. Hand-written vs generated comparison showed little difference; normal routing applies.
- **2026-09-13** Vite pinned to 5.x (Node 18 on the dev machine). vitest pinned to 2.x for the same reason.
- **2026-09-13** Python 3.11 venv at `.venv` with jupyter_server 2.21, ipykernel 7.3, numpy, pandas.
- **2026-09-13** Switching notebooks leaves the previous kernel running (Jupyter convention; `openNotebookSession` reuses it on return). Explicit Close shuts it down.
- **2026-09-13** M5: multi-document store (`docs` by path, per-path execution queues, module-level kernel session map). Escape in an editor only leaves edit mode when CodeMirror did not consume it (popup/tooltip open).
- **2026-09-13** Jupyter Server reports `execution_state: "starting"` until the first websocket client connects, so a raw REST kernel probe is not a health check; the live vitest suite is. On Windows a venv's `python.exe` is a launcher, so the server's real process shows the base interpreter's path in the process list; that is normal. The config now refuses to start outside the venv.
- **2026-09-13** Execution count arrives from `execute_reply` at the end, so a cell shows `[*]` until it finishes. Early fill from `execute_input` is a known small improvement, not done.

## Known gaps / debt

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

- M7 AI harness needs an Anthropic API key or Claude login at run time; confirm which before that milestone.
- Map view: mockup round or straight to one direction?

## Session log

- **2026-09-13 session 1** — CLAUDE.md; ideas list; architecture recommendation accepted; 16 mockups generated and audited (flex-shrink clipping fix); 4 hand-written E variants; CATALOG.md; docs; venv + Vite scaffold; M1–M3 dispatched in parallel and landed; M4 integration: fixed initial kernel status push, cockpit code size via `--code-size`, fixture path moved into NotebookView; live end-to-end verified; first commit.
- **2026-09-13 session 1, continued** — M5 in two phases: A (Opus: session `complete`/`inspect`/`executeSilent`/`changeKernel` + multi-doc store refactor; Sonnet: mode dropdown + palette; Sonnet: inspector module), B (Sonnet: toolbars, tabs, kernel picker, collapse, keyboard, commands; Sonnet: completion + hover + Shift+Tab). Diagnosed a dead-kernel scare (duplicate servers, one mine on 8889), hardened the Jupyter config, fixed the Escape conflict. Live E2E verified. Committed.
