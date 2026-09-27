# ORBITAL handoff

Written 2026-09-27. For whoever picks this up next, human or agent. Read this,
then `docs/STATUS.md`, then `docs/ARCHITECTURE.md`.

## What it is

ORBITAL is a sci-fi themed notebook environment: a custom React frontend over
a local Jupyter Server, with four visual modes (Paper, Night Ops, Cockpit,
Bridge), each with several skins. It runs notebooks against real kernels, has
Jupyter-level editing, a file browser, a terminal, movable docks, and a built-in
coding agent on the Claude Agent SDK using the owner's Claude login.

Repo: `git@github.com:sbhilegaonkar-tcscary/Orbital.git`, branch `main`.
Everything through the seams pass is pushed. Working tree was clean at handoff.

## Where it lives

- Now: `C:\Users\Sujay Bhilegaonkar\Documents\ai-proj\Jupyter Nice UI`
- Planned: `C:\dev\active\orbital` (a home-folder reorg is moving all code to
  `C:\dev`; ORBITAL was deferred because its servers were running). Check both;
  whichever exists is current.
- After moving: **delete and recreate `.venv`** (absolute paths are baked in),
  then update the path in `docs/STATUS.md` and in the memory file
  `~/.claude/projects/C--Users-Sujay-Bhilegaonkar/memory/project_orbital.md`.
  `node_modules` move fine.

Pushing uses a dedicated deploy key with write access, routed through the SSH
host alias `github-orbital` (see `~/.ssh/config`; key `~/.ssh/id_ed25519_orbital`).
The owner's main key (`sujaybh`) has no access to that repo. Plain `git push`
works from the project.

## How to run

```
scripts/dev.ps1        # starts Jupyter :8888, agent sidecar :8787, app :5173, opens the browser
```

First time on a machine:

```
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install jupyter_server ipykernel numpy pandas
cd app && npm install
cd ../agent && npm install
npx -y @anthropic-ai/claude-code@latest auth login     # once, for the agent panel
```

Checks (run with no app tab open; live tests share the server):

```
cd app && npx tsc -p tsconfig.app.json --noEmit && npx vitest run && npm run build
cd agent && npm test
```

At handoff: type-check clean, build clean, 178 frontend tests, 5 sidecar tests.

## What is done

M0 through M7 plus a usability pass (M6.5). In one sentence each:

- **Theme system**: 4 modes, 12 skins, all colors from 16 CSS tokens; no
  literals anywhere outside `app/src/theme/skins/`.
- **Notebook**: CodeMirror cells, outputs (HTML, images, ANSI, sandboxed
  iframes for scripted HTML, truncation), nbformat round-trip byte-identical
  with Jupyter, autosave.
- **Kernel features**: completion, hover docs, Shift+Tab inspect, live variable
  inspector, kernel picker, interrupt/restart, `clear_output` and
  `update_display_data`.
- **Editing**: tabs for many notebooks and text files, toolbar, per-cell
  toolbar, cut/copy/paste/undo/merge/split/collapse, command palette (Ctrl+K),
  explicit edit/command modes per `docs/KEYBOARD.md`.
- **Shell**: rail activity bar, Home page, Layout menu, resizable and movable
  docks that always fit the window, file browser, terminal (Git Bash via
  Jupyter terminals), service status dots, first-run hint.
- **Agent**: sidecar in `agent/` relaying `orbital_*` notebook tools to the
  browser, permission prompts, honest connection and login states. Verified
  connecting and logged in; **a real agent conversation has not been exercised
  end to end**. That is the first thing to try.

## What is next

| # | Milestone | Notes |
|---|---|---|
| M8 | Map view | Projects as bodies, minimalist and orbit modes. Owner has not said whether to do a mockup round first (the notebook got one; see `styleguide/`). Ask. |
| M9 | Hub | Accounts, presence, shared projects, Yjs co-editing. Most invasive milestone; notebook model becomes a shared doc. |
| M10 | Hardening | Playwright e2e, virtualized cells, packaging (Tauri desktop or hosted JupyterHub). Owner has not chosen desktop-before-hub or after. |
| Later | ipywidgets, sprite customizer, gamification | Ideas list is in the first session's transcript; `styleguide/CATALOG.md` has the visual directions. |

## Known debt

- Inspector shows full module reprs instead of `name version`; IPython's
  injected `open` appears as a variable.
- Split-at-cursor uses the exact cursor now, but markdown cells do not
  respond to Enter-to-edit in command mode (double-click works).
- Cockpit cells use the shared gutter layout; the Glass Deck mockup's tab
  header with LEDs is not built.
- `changeKernel` writes `metadata.kernelspec` but needs a save to persist.
- Live tests can flake when a browser tab holds kernels on the dev server.
- Node 18 on the dev machine pins Vite 5 and vitest 2. Upgrading Node to 20+
  unblocks current versions.

## Gotchas learned the hard way

- **Never kill processes you did not spawn.** A subagent once force-killed
  every Chrome on the machine. Rule is in `CLAUDE.md`; every browser-driving
  subagent prompt restates it. Headless Chrome gets its own `--user-data-dir`.
- **One Jupyter Server.** Two once ran at the same time (one from system
  Python without ipykernel) and every kernel died at start. The config now
  refuses to start outside `.venv`. Jupyter reports a kernel as `starting`
  until a websocket client connects, so a REST probe is not a health check;
  the live vitest suite is.
- **Windows paths with spaces** broke `Start-Process -File`; script paths are
  quoted in `scripts/dev.ps1`. Git Bash rewrites `/F /T` flags into paths for
  `taskkill`; use PowerShell `Stop-Process -Id`.
- **Module-init import cycles** (`shell/commands.ts` ↔ `notebook/commands.ts`
  via `App.tsx`) caused "cannot access before initialization" errors.
  `useUiStore` lives in `shell/uiStore.ts` and `shell/commands.ts` must never
  import anything that imports `notebook/commands.ts`.
- **React StrictMode** double-mounts; anything that focuses a freshly created
  editor must look the handle up at frame time, not capture it.
- **Autosave will rewrite `workspace/hull-stress-analysis.ipynb`** during
  browser testing; `git checkout -- workspace/hull-stress-analysis.ipynb`
  afterward or the model round-trip test fails.
- The panel probed login once and cached the negative answer; now it
  re-checks every 8 s while the gate is showing.

## How the work was done (so the next agent can continue the same way)

`CLAUDE.md` in the project defines it: Fable orchestrates, writes contracts
and audits; Opus builds the session layer and engines; Sonnet builds UI and
bulk; Haiku does lookups. Every subagent gets exact files, interfaces by path,
acceptance criteria, and a return format. The orchestrator reviews the diff,
runs the checks, drives the app in a browser, and commits. `docs/STATUS.md`
is updated at every milestone boundary and holds the decisions log.

Owner preferences recorded along the way: Claude login for the agent, never
an API key. Shift+Enter lands in edit mode on the next cell. A dropdown for
modes, not a segmented dial. Skins are secondary; this is a coding interface
first. Panels must be movable and everything must fit the window.
