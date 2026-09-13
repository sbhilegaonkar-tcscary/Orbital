# STATUS

The running log for ORBITAL. If you are resuming this project, read this file
first, then `docs/ARCHITECTURE.md`. The orchestrator updates it at every
milestone boundary and whenever a decision is made.

## Current milestone

**M4 done: a working notebook.** Connect to the local Jupyter Server, open a
notebook from `workspace/`, run cells, see tables, tracebacks, and streams,
save back to disk, switch between four modes and twelve skins.

**Next up: M5, the Map view.** Needs a mockup round first (minimalist vs full
orbit view), same process as the notebook style guide.

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

`npm test` runs 4 model tests and 10 live session tests; the live ones skip
if the server is not up.

## Milestones

| # | Milestone | Owner tier | State |
|---|---|---|---|
| M0 | Docs, scaffold, venv, Jupyter config | Fable | done 2026-09-13 |
| M1 | Theme system, app shell, mode dial, placeholder views, Bridge sky | Sonnet | done 2026-09-13 |
| M2 | Session layer over `@jupyterlab/services` | Opus | done 2026-09-13 |
| M3 | Notebook UI: cells, CodeMirror, outputs, markdown, ipynb load/save | Sonnet | done 2026-09-13 |
| M4 | Integration, live run, audit, first commit | Fable | done 2026-09-13 |
| M5 | Map view (PixiJS), minimalist + full | Opus | not started |
| M6 | Sprite customizer | Sonnet + Opus | not started |
| M7 | Hub service: accounts, presence, shared projects | Opus | not started |
| M8 | Tauri desktop build | Sonnet | not started |

## What M4 verified live (2026-09-13)

- Connect → notebook list from the contents API → open → kernel `python3 · idle` in the topbar.
- Run all: pandas `describe()` renders as an HTML table, `NameError` renders as a traceback with the `---->` line highlighted, a 3-iteration print loop merges into one stream block.
- Statusbar counts `4 cells · 3 executed · 1 error(s)`.
- Save writes execution counts, outputs, and cell ids to `workspace/hull-stress-analysis.ipynb`; kernelspec metadata preserved.
- Mode switching live with no console errors; Bridge sky mounts only in bridge; theme persists in `localStorage` under `orbital.theme`.

## Decisions log

- **2026-09-13** Custom web frontend on Jupyter Server, not a JupyterLab or VS Code extension. Reason: whole-shell control; kernel protocol and ipynb are the durable parts.
- **2026-09-13** Style exploration done: 20 mockups, 4 modes. Defaults: paper→Clinical Terminal, night-ops→Deep Space, cockpit→Glass Deck, bridge→Nebula Drift. Alternates registered as skins. See `styleguide/CATALOG.md`.
- **2026-09-13** Model routing: Fable orchestrates and audits; Opus for the session layer and complex engines; Sonnet for UI and bulk. Hand-written vs generated comparison showed little difference; normal routing applies.
- **2026-09-13** Vite pinned to 5.x (Node 18 on the dev machine). vitest pinned to 2.x for the same reason.
- **2026-09-13** Python 3.11 venv at `.venv` with jupyter_server 2.21, ipykernel 7.3, numpy, pandas.
- **2026-09-13** Switching notebooks leaves the previous kernel running (Jupyter convention; `openNotebookSession` reuses it on return). Explicit Close shuts it down.
- **2026-09-13** Execution count arrives from `execute_reply` at the end, so a cell shows `[*]` until it finishes. Early fill from `execute_input` is a known small improvement, not done.

## Known gaps / debt

- **Cockpit cell chrome**: cells use the shared gutter layout in every mode. The Glass Deck mockup's tab header with LED, count, language, and timing is not built yet; `modes.css` has `.led` and `.tab-header` classes waiting for it.
- **Inspector** shows a placeholder. v1 plan: a hidden kernel call that lists globals with type and repr.
- **No `clear_output` handling** in the session layer (dropped with a TODO); progress bars that rely on it will stack.
- **Markdown cell edit mode** exists but has had no live use yet.
- **Fixture notebook** (`notebook/fixture.ts`) is lazy-imported only under `?fixture=1`; it is dev tooling living in `src/`.
- The `useUiStore` lives in `App.tsx` and `Rail.tsx` imports it back, a harmless circular import worth moving to `shell/uiStore.ts`.
- Styleguide table numbers differ slightly between modes (cosmetic).

## Open questions for the owner

- Map view: want a mockup round (3–4 directions for minimalist and for full) before building, or go straight to one direction?
- Should the desktop (Tauri) build come before the social hub, or after?

## Session log

- **2026-09-13 session 1** — CLAUDE.md; ideas list; architecture recommendation accepted; 16 mockups generated and audited (flex-shrink clipping fix); 4 hand-written E variants; CATALOG.md; docs; venv + Vite scaffold; M1–M3 dispatched in parallel and landed; M4 integration: fixed initial kernel status push, cockpit code size via `--code-size`, fixture path moved into NotebookView; live end-to-end verified; first commit.
