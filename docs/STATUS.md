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

**M8 done, then M8.5 done, both awaiting owner test.** M8: the map draws the
current directory as a star system, where orbit radius encodes recency,
notebooks/directories/files are distinct body types, and open/active/dirty/
kernel/error state plus a flight path through recently opened notebooks are
drawn live on each body. It renders as SVG with a small `requestAnimationFrame`
loop rather than PixiJS, offers a still Chart mode and a moving Orbit mode
that default per theme mode and persist the user's override, and ships with a
`?fixture=1` canned system so it renders without a server. M8.5 replaced that
single chart with **one renderer per theme mode**: Paper and Bridge draw the
cartography method (worlds, an orrery ring, painted planet characters in
Bridge, abstract sigils in Paper), Night Ops and Cockpit draw the zoom method
(galaxy → system → moons, then the plain chart beyond depth 3), and the M8
chart survives as an overridable third style, all switchable per mode from
Settings. A new 320px explorer column beside the map replaces the old detail
card: it always lists one folder — the selection, its parent, or the system
on screen — and creates notebooks/folders/files in the folder it lists.

**Next up:** owner testing of M8.5 (M8 itself was never separately tested),
then M9 (Hub) or M10 (Hardening), owner's choice.

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
a server, for screenshots. `?fixture=1` on its own also gives the Map view a
canned system to render against; Map is the first item in the rail.

Checks:

```
cd app && npx tsc -p tsconfig.app.json --noEmit && npm test && npm run build
```

`npm test` runs 384 tests; the live-kernel ones skip if the server is not up.
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
| M8 | Map view: SVG star system, Chart/Orbit, live kernel state, flight path, fixture | Opus, Fable audit | done 2026-09-27, untested by owner |
| M8.5 | One map per mode + explorer column | Opus ×3 + Sonnet, Fable audit | done 2026-09-28, untested by owner |
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

## What M8 verified (2026-09-27)

- Checks: tsc clean, build clean, 191 frontend tests (26 in `map/model.test.ts`, 13 in `map/store.test.ts`) plus 28 live tests skipped with Jupyter down; no color literals in `app/src/map`.
- One pre-existing failure, unrelated to the map: `notebook/model.test.ts` expects 4 cells but `workspace/hull-stress-analysis.ipynb` has had 5 since the owner's 2026-09-14 session; fix by `git checkout -- workspace/hull-stress-analysis.ipynb` before running tests, per `docs/HANDOFF.md`.
- Fit: `scrollWidth === clientWidth` and `scrollHeight === clientHeight` at 1280×800, 1024×700, and 800×600 in all four modes.
- Frame loop measured at ~35 fps in Orbit; 0 when hidden, in Chart, reduced, or unmounted.
- Composition: card column at 1280×800 (R 263 with the inspector open, 278 closed); bottom strip and a centred system at 800×600 (R 183) and at 1024×700 with the inspector open (R 233). No ring or body under any HUD panel in any of the six cases.
- Live: the orchestrator drove the map in the desktop app's browser — selection by body and by label, the detail card, O/H keys, Tab through the HUD controls, Enter to dive into `experiments`, Esc back out.
- Live against a running Jupyter (later the same day): Connect succeeded, the real workspace rendered (5 notebooks, 1 folder, checkpoints hidden), Enter on `hull-stress-analysis` switched to the notebook with the kernel idle, and back on the map the body carried the open and active halos, a green kernel LED, and `kernel idle · python3 · cells 5 · executed 3` in the card. The create row (Notebook / Folder / File) was enabled; the owner had already made a folder and a notebook through the app.

## What M8.5 verified (2026-09-28)

- Checks: tsc clean, build clean, 348 tests pass (up from M8's 191) plus 28
  live tests skipped with Jupyter down; the one failure is the known
  pre-existing `notebook/model.test.ts` cell-count mismatch (see Known gaps).
- Live in the desktop app's browser at 1280×800: all four modes render
  through the seam (`rendererForMode`); Night Ops select → explorer lists 7
  rows, double-click dives, Esc returns to the stage; Bridge select `rigs`
  fans out 4 moons; Paper renders 6 sigil patterns, 0 gradients, 0
  animations; fit holds (nothing scrolls).
- A renderer mounted inside a 0×0 container (the browser pane collapsed) once
  failed to draw after the container came back. The zoom renderer now
  re-measures its host on every notification and, while it has no box, on
  each animation frame; verified with `ResizeObserver` stubbed to a no-op
  (22 bodies within a frame of restore, dive and fly-out intact). The
  cartography renderer already recovered (it writes every measurement through,
  including 0) and gained a comment naming that invariant.

## What landed after M8 (2026-09-27, same session)

- **Connection flow.** `connect()` retries with backoff until Jupyter answers (window 120 s), stops at once on 401/403/404, and can be cancelled. While connecting: a 2 px sweep at the top of the view, a three-state card (disconnected / connecting with elapsed seconds, attempt count and last error / error with Retry), a pulsing jupyter dot, a statusbar readout, and every store's "Not connected" becomes "Connecting to Jupyter…". After one successful connect the app auto-connects on load (`localStorage['orbital.autoconnect']`, cleared by an explicit Disconnect). Palette: Connect / Cancel connecting / Disconnect. The sweep is exempt from Paper and Night Ops' blanket `animation: none` because it is feedback, not ambience. Tests: `session/store.test.ts` (6).
- **Map create controls.** The system view of the detail card offers `＋ Notebook`, `＋ Folder`, `＋ File` in the folder on screen (disabled with a reason while connecting, not connected, or in fixture mode); palette commands `map.newNotebookHere` / `newFolderHere` / `newFileHere`. Shared helpers in `map/store.ts`, tested.
- **Map mockup round finished and built.** See `styleguide/CATALOG.md` under
  "Map directions" — Cartography A/B and Zoom A are now built into
  `app/src/map/` (M8.5); C (transit map) and D (star atlas) remain planned.

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
- **2026-09-27** M8 map renders as SVG + `requestAnimationFrame` instead of PixiJS: a workspace is tens of bodies, not thousands, and SVG gives token theming, crisp hairlines, and real text for free with no new dependency.
- **2026-09-27** Map orbit radius encodes recency (log-scaled age, clamped to 1 hour–2 years); reference rings sit at 1 day / 7 days / 30 days / 182 days / the rim; a body's angle comes from a hash of its path.
- **2026-09-27** Map defaults to Chart in Paper and Night Ops, Orbit in Cockpit and Bridge; the user's override persists under `localStorage['orbital.map']`.
- **2026-09-27** Small contract extensions for the map: `ContentsEntry.size` and `notebook/store.ts`'s `kernelByPath`.
- **2026-09-27** No mockup round before the first map: the owner said to continue straight to one direction, calling it the best part of the project so far. Later the same day the owner asked to see several different map treatments and chose to keep the "alien cartography" direction as a theme family (light and dark first), so a mockup round runs after the build, not before.
- **2026-09-27** Connecting is a retry loop with visible progress, not a single attempt, because `scripts/dev.ps1` opens the browser before Jupyter answers. Retry window 120 s; 401/403/404 stop immediately; auto-connect on load after one success. Owner's request.
- **2026-09-28** Map M8.5's per-mode renderer mapping is Paper + Bridge →
  cartography, Night Ops + Cockpit → zoom, both overridable from Settings.
  Reason: the owner wants each visual style to feel like its own map, not one
  chart re-skinned four ways ("the different styles ... are going to have
  different maps as well").
- **2026-09-28** The map has a camera. Owner: "make it so its kind of spread out, esp on the calligraphy type map, and i can drag to navigate around". One shared hook (`map/useViewport.ts`) gives every renderer drag-to-pan, wheel-to-zoom about the cursor, double-click / `F` / `⤢ fit` to fit, `0` to reset, arrows to pan; plates open centred on the star at 1:1 and are laid out larger than the stage (cartography ×1.7 with worlds at full size, galaxy ×1.5, systems ×1.25). Labels hold their pixel size when zooming in and recede with the plate when zooming out. Dive resets the camera. See ARCHITECTURE "The viewport camera".
- **2026-09-28** The explorer column replaces the map's detail card. Reason:
  the owner asked for clicking a body to "open the folder itself ... kind of
  a secondary file explorer ... instead of needing to (open in files)"; the
  column is a real flex sibling of the stage, not an overlay, so renderers no
  longer reserve HUD space for it.
- **2026-09-28** The M8 orbital chart was kept as a third style
  (`map/renderers.ts`'s `chart`, drawn by `MapCanvas.tsx`'s `ChartMap`) rather
  than deleted, even though M8 itself was still uncommitted. Reason: it is a
  working style in its own right and the owner had not rejected it, only
  asked for two more alongside it.
- **2026-09-28** Paper's cartography renders abstract sigils (astrolabe,
  rosette, lattice, volvelle, constellation-disc), never realistic planet
  sprites; Bridge keeps the painted planet characters from the Relic mockup.
  Owner's words: "for the paper ones i like it more abstract, with no
  realistic sprites."

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
- **Map labels** can still touch in very dense systems; systems over 40 bodies only show labels for the two innermost bands.
- **Map HUD**: the camera keeps the detail card (column or strip) and the legend clear of the rim; the breadcrumb and toolbar still overlay the top corners, which the rim's top padding keeps clear in practice. Under 900 px the inspector is a shell overlay and covers the right third of the map when open.
- **Map `dir`** is persisted (`localStorage['orbital.map']`), so the map reopens wherever it was left rather than always at the workspace root.
- **`notebook/model.test.ts`** expects 4 cells in `hull-stress-analysis.ipynb`, which has had 5 since the owner's 2026-09-14 session; run `git checkout -- workspace/hull-stress-analysis.ipynb` before `npm test` until this is reconciled.
- **Cartography root labels can collide with connector threads** at
  1280×800 (seen on the `trajectory-solver` and `hull-stress-analysis`
  captions, each sitting under a world).
- **Zoom's cosmic web is empty on the fixture tree** because each root folder
  sits in a different recency band; the web only joins same-band folders.
- **Hidden directory `.ipynb_checkpoints`** is drawn like any other folder
  when the hidden-files toggle is on.
- **No live-Jupyter pass of M8.5 yet.** 2026-09-27's live checks were all M8;
  M8.5 has only been checked against the fixture and the collapsed-pane case.

## Open questions for the owner

- M9 before M10, or desktop packaging first?

## Session log

- **2026-09-13 session 1** — CLAUDE.md; ideas list; architecture recommendation accepted; 16 mockups generated and audited (flex-shrink clipping fix); 4 hand-written E variants; CATALOG.md; docs; venv + Vite scaffold; M1–M3 dispatched in parallel and landed; M4 integration: fixed initial kernel status push, cockpit code size via `--code-size`, fixture path moved into NotebookView; live end-to-end verified; first commit.
- **2026-09-14 session 1, continued (M6+M7)** — M6 in two phases (A: Opus session additions + clear_output; Sonnet dock layout; Sonnet outputs/ANSI/iframe; Sonnet keyboard/autosave/help. B: Sonnet file browser + tabs; Sonnet terminal). M7 in parallel halves (Opus sidecar/store/executor; Sonnet panel UI). Audit fixes by the orchestrator: Shift+Enter advances immediately into edit mode; Ctrl+W/Ctrl+Tab route through the unified tabs store; layout clamp-persistence bug; import cycles (delegated). Committed.
- **2026-09-13 session 1, continued** — M5 in two phases: A (Opus: session `complete`/`inspect`/`executeSilent`/`changeKernel` + multi-doc store refactor; Sonnet: mode dropdown + palette; Sonnet: inspector module), B (Sonnet: toolbars, tabs, kernel picker, collapse, keyboard, commands; Sonnet: completion + hover + Shift+Tab). Diagnosed a dead-kernel scare (duplicate servers, one mine on 8889), hardened the Jupyter config, fixed the Escape conflict. Live E2E verified. Committed.
- **2026-09-27 session 2 (M8)** — Contract written by the orchestrator (now the "Map (M8)" section of ARCHITECTURE.md); one Opus build. Fable audit found two bugs (HUD keyboard hijack, stale loop refs) and three layout defects (caption/body collision, label overlaps, the rim running under the detail card). Two corrective passes: the first fixed those five and added clickable labels, a reserved caption sector, label de-collision with hysteresis, a label budget by system size, and the Map rows in the help overlay (it also caught captions vanishing off their text path at small sizes); the second replaced the fixed card column with a composition rule (column only while the star stays within 20 % of the width from centre, else a bottom strip) and moved `ShortcutsHelp` to `AppShell` so `?` works from the map. Live review in the desktop app's browser: selection by body and by label, detail card, O/H keys, Tab through the HUD, dive into `experiments` and back, strip form at 800×600. Docs updated. Not committed.
- **2026-09-28 session 2, continued (M8.5)** — Contract written by the
  orchestrator (`M8.5-MAP-PER-MODE-SPEC.md`, now folded into
  `docs/ARCHITECTURE.md`'s Map section): one renderer per theme mode plus an
  explorer column replacing the detail card. Three Opus builds in parallel
  (cartography's layout/sigils/component, zoom's camera/clusters/component,
  the hub agent's `MapView.tsx`/`MapExplorer.tsx`/store additions) plus one
  Sonnet pass, per the M8.5 milestone row; `docs/KEYBOARD.md`'s Map-view
  section was updated separately and is already current. Fable audit: scope,
  contract and fit checks passed; live review in the desktop app's browser
  confirmed all four modes render through the seam, Night Ops' and Bridge's
  selection/fan-out behavior, and Paper's sigil-only paint (6 patterns, 0
  gradients, 0 animations). Found one defect — a renderer mounted in a
  0×0 container failed to draw once resized — fixed in the zoom renderer and
  verified with resize notifications suppressed. Chart kept as a third style
  with a Settings override rather than deleted while uncommitted. Docs
  updated. Not committed; not yet tested by the owner.
- **2026-09-28 session 2, continued (camera)** — Owner asked for a spread-out
  cartography and drag navigation. Two Opus agents in parallel: one wrote the
  shared camera (`viewport.ts` + `useViewport.ts`, tested), spread the
  cartography plate (fit-to-stage shrink removed, bounds exported), added the
  fit button, palette command and keys; the other adopted the camera in the
  zoom and chart renderers with galaxy/system spreads. Verified in headless
  Chrome: 300 px drags pan exactly 300 px and never select, wheel zooms about
  the cursor with labels at constant pixel height, double-click and `F` fit,
  dive resets, selection and fan-out work at every zoom. A follow-up glides the
  camera to a selected world that is off-screen. 383 tests. Not committed.
