# ORBITAL architecture

ORBITAL is a sci-fi notebook environment. It owns the entire frontend and
borrows execution from Jupyter Server. This document is the source of truth
for stack, layout, and the interfaces between parts. Subagents build to it;
they do not change it. Changes go through the orchestrator and are logged in
`docs/STATUS.md`.

## Decision summary

| Concern | Decision | Why |
|---|---|---|
| Frontend | Vite 5 + React 18 + TypeScript, in `app/` | Full control of the shell; Node 18 on the dev machine pins Vite 5 |
| State | zustand | Small, no boilerplate, works outside React for session events |
| Code editor | CodeMirror 6 | Light, themeable via CSS vars, Python mode available |
| Kernel & files | Jupyter Server via `@jupyterlab/services` | Kernel protocol, sessions, contents API already solved and battle-tested |
| Execution host | Local Jupyter Server from `.venv` (Python 3.11) | Zero hosting cost; remote servers plug in through the same session layer |
| Effects | CSS for the notebook; SVG + `requestAnimationFrame` for the map, not PixiJS | Keep the notebook cheap; the map is tens of bodies, not thousands, so SVG gives token theming and crisp text for free with no new dependency |
| Social layer | Separate FastAPI service in `hub/` (later) | Jupyter Server is single-user; accounts, presence, and projects live elsewhere |
| Desktop | Tauri wrapper in `desktop/` (later) | Same web build, lighter than Electron, can bundle the Python env |

## Repository layout

```
Jupyter Nice UI/
  CLAUDE.md              model routing and working rules
  docs/
    ARCHITECTURE.md      this file
    DESIGN.md            modes, skins, tokens, component rules
    STATUS.md            progress log, current milestone, how to resume
  styleguide/            static mockups and CATALOG.md (reference only)
  app/                   the frontend (Vite)
  jupyter/               Jupyter Server config for local dev
  scripts/               dev helpers (start server, start app)
  workspace/             notebooks the dev server serves (git-ignored contents)
  .venv/                 Python env with jupyter_server + ipykernel (git-ignored)
```

## Frontend layout (`app/src`)

```
main.tsx                 mounts <App/> inside <ThemeProvider/>
App.tsx                  routes rail selection to a view

theme/
  tokens.ts              TokenName union, ThemeTokens type, Mode, Skin, registry helpers
  skins/*.ts             one file per skin, exports a Skin (see DESIGN.md)
  ThemeProvider.tsx      writes tokens to :root as CSS vars, sets data-mode/data-skin, persists choice
  base.css               resets and shared component styles using only CSS vars
  modes.css              per-mode layout deltas via [data-mode="..."] (density, radii, chrome)

session/
  types.ts               SessionProvider, KernelSession, CellOutput, KernelStatus (the seam)
  jupyter.ts             JupyterSessionProvider over @jupyterlab/services
  store.ts               zustand: server config, connection status, active kernel status

notebook/
  model.ts               NotebookModel, Cell, nbformat 4 read/write helpers
  store.ts               zustand: open notebook, cells, selection, execution queue, dirty flag
  Notebook.tsx           list of cells, keyboard handling, run/queue logic
  Cell.tsx               gutter + body; delegates to CodeCell or MarkdownCell
  CodeEditor.tsx         CodeMirror 6 wrapper bound to a cell's source
  Output.tsx             renders CellOutput[] (stream, text/plain, text/html, image/png, error)
  MarkdownCell.tsx       rendered markdown with click-to-edit

map/
  model.ts               geometry and classification: band/orbit/phase/period/scale, pure functions
  store.ts               zustand: current system, mode, per-mode style override, selection, query,
                         explorer/children/descendant hooks, body/status hooks, fixture seam
  renderer.ts            the renderer seam: MapRendererProps, MapMethod, rendererForMode, MAP_METHODS
  renderers.ts           MapMethod -> component: cartography | zoom | chart
  MapExplorer.tsx        the explorer column: one folder's listing, facts, create row
  MapCanvas.tsx          the chart style (the original M8 view): rings, star, bodies, moons, trails, flight path, sweep
  MapHud.tsx             HTML overlays: breadcrumb, legend (toolbar and detail card moved to MapExplorer)
  map.css                all map styling, tokens only, per-mode deltas via [data-mode]
  fixture.ts             canned system tree for ?fixture=1
  commands.ts            palette commands, registered at import (like notebook/commands.ts)
  cartography/
    layout.ts             the composition solver: golden-angle seeds, relaxation, uniform fit
    sigils.ts              world faces: Bridge's five painted characters, Paper's five sigil families
    CartographyMap.tsx     the renderer: composition, interaction, the bead-walk frame loop
    cartography.css        paint, keyed by [data-mode]
  zoom/
    camera.ts              the fly-in/out nesting-matrix math and the depth rule
    clusters.ts             galaxy-level geometry: seeded star clusters, the cosmic web
    ZoomMap.tsx             the renderer: four depths, the camera, interaction
    zoom.css                paint, keyed by [data-mode]

shell/
  AppShell.tsx           grid: topbar / rail / view / inspector / statusbar
  TopBar.tsx             logo, project name, ModeDial, KernelStatus
  ModeDial.tsx           four-mode segmented control; skin picker in a popover
  Rail.tsx               Map, Notebook, Crew, Comms, Settings
  Inspector.tsx          variables panel (v1: names/types/values from a kernel introspection call)
  StatusBar.tsx          cell counts, star date clock
  NotConnectedCard.tsx   "not connected" card (Connect / Settings), shared by Home and Map

views/
  NotebookView.tsx       open/create notebooks from the workspace, hosts <Notebook/>
  MapView.tsx            the map: composes map/store + the renderer seam + MapExplorer + MapHud, handles fixture / not-connected / loading / empty
  CrewView.tsx           placeholder
  CommsView.tsx          placeholder
  SettingsView.tsx       server URL + token, skin per mode, reduced motion

effects/
  Sky.tsx                Bridge-only animated background; mounted only when mode === 'bridge'
```

Rules:

- Components import tokens only through CSS variables. No color literals in
  `.tsx` or `.css` outside `theme/skins/*`.
- `session/` knows nothing about React. `notebook/store.ts` is the only thing
  that calls it.
- `views/` compose `shell/` and `notebook/`; they hold no execution logic.

## The session seam (`session/types.ts`)

This is the interface the notebook talks to. Everything Jupyter-specific
stays behind it so remote kernels, JupyterHub, or a non-Jupyter runtime can be
swapped in later.

```ts
export type KernelStatus =
  | 'disconnected' | 'connecting' | 'starting'
  | 'idle' | 'busy' | 'restarting' | 'dead';

export interface ServerConfig {
  baseUrl: string;       // e.g. http://localhost:8888
  token: string;
}

export interface KernelSpecInfo { name: string; displayName: string; language: string; }

export type CellOutput =
  | { type: 'stream'; name: 'stdout' | 'stderr'; text: string }
  | { type: 'display_data' | 'execute_result'; data: Record<string, string>; executionCount?: number }
  | { type: 'error'; ename: string; evalue: string; traceback: string[] };

export interface ExecuteHandlers {
  onOutput(out: CellOutput): void;
  onExecutionCount(n: number): void;
  onDone(status: 'ok' | 'error' | 'aborted'): void;
}

export interface ExecuteHandle { readonly done: Promise<void>; cancel(): void; }

export interface KernelSession {
  readonly path: string;
  readonly status: KernelStatus;
  onStatus(cb: (s: KernelStatus) => void): () => void;
  execute(code: string, handlers: ExecuteHandlers): ExecuteHandle;
  interrupt(): Promise<void>;
  restart(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface ContentsApi {
  list(dir: string): Promise<{ name: string; path: string; type: 'notebook' | 'directory' | 'file'; lastModified: string }[]>;
  getNotebook(path: string): Promise<unknown>;   // raw nbformat JSON
  saveNotebook(path: string, nb: unknown): Promise<void>;
  createNotebook(dir: string, name?: string): Promise<string>;  // returns path
}

export interface SessionProvider {
  connect(cfg: ServerConfig): Promise<void>;
  disconnect(): Promise<void>;
  listKernelSpecs(): Promise<KernelSpecInfo[]>;
  openNotebookSession(path: string, kernelName?: string): Promise<KernelSession>;
  readonly contents: ContentsApi;
}
```

Stream outputs with the same `name` arriving consecutively are merged by the
notebook store, not by the provider.

M5 added to `KernelSession`: `complete`, `inspect`, `executeSilent`, and
`changeKernel`. See `session/types.ts` for the exact shapes; that file is
authoritative.

## Notebook store (M5 shape: many open documents)

`notebook/store.ts` holds every open notebook, keyed by path. Kernel sessions
live in a module-level `Map<path, KernelSession>` beside the store, never in
state. The session store's `kernelStatus` mirrors the **active** document's
session; activating another tab re-pushes that session's status.

```ts
export interface NotebookState {
  docs: Record<string, NotebookModel>;
  dirty: Record<string, boolean>;
  openPaths: string[];                 // tab order
  activePath: string | null;
  selectedCellId: string | null;       // within the active doc
  loading: boolean;
  error: string | null;
  clipboard: Cell[] | null;
  lastDeleted: { path: string; index: number; cell: Cell } | null;
  kernelSpecs: KernelSpecInfo[];

  // documents
  open(path: string): Promise<void>;        // opens or activates
  activate(path: string): void;
  close(path?: string): Promise<void>;      // default: active; shuts its kernel down
  save(path?: string): Promise<void>;
  saveAll(): Promise<void>;

  // execution (active doc)
  runCell(id: string): Promise<void>;
  runAndAdvance(id: string): Promise<void>;
  runAll(): Promise<void>;
  runAbove(id: string): Promise<void>;      // cells before id, exclusive
  runBelow(id: string): Promise<void>;      // id and after
  interrupt(): Promise<void>;
  restartKernel(): Promise<void>;
  restartAndRunAll(): Promise<void>;
  changeKernel(kernelName: string): Promise<void>;
  refreshKernelSpecs(): Promise<void>;

  // editing (active doc)
  setSource(id: string, source: string): void;
  insertCell(afterId: string | null, type: Cell['type'], source?: string): string;
  deleteCell(id: string): void;             // records lastDeleted
  undoDelete(): void;
  moveCell(id: string, direction: -1 | 1): void;
  setCellType(id: string, type: Cell['type']): void;
  select(id: string | null): void;
  cutCells(ids: string[]): void;
  copyCells(ids: string[]): void;
  pasteCells(afterId: string | null): void;
  mergeWithBelow(id: string): void;
  splitCell(id: string, offset: number): void;
  clearOutputs(id?: string): void;          // default: all cells
  toggleCollapse(id: string);               // metadata.collapsed, nbformat convention
}

export function useActiveNotebook(): NotebookModel | null;
export function getActiveSession(): KernelSession | null;   // for the editor's completion/hover
export function onExecutionSettled(cb: (path: string) => void): () => void;  // inspector refresh hook
```

Consumers never read `docs[activePath]` by hand; they use `useActiveNotebook()`.

## Layout (M6): docks and panels

`shell/layout.ts` owns where things sit. The shell is a fixed 100vw × 100vh
grid that never scrolls; every region scrolls internally and has
`min-width: 0; min-height: 0`.

```
[topbar                                                      ]
[rail][left dock][ tabs bar                     ][right dock ]
[    ][          ][ active view                 ][           ]
[    ][          ][ bottom dock (terminal)       ][           ]
[statusbar                                                   ]
```

```ts
export type PanelId = 'files' | 'inspector' | 'terminal';
export type DockSide = 'left' | 'right' | 'bottom';

export interface PanelState {
  visible: boolean;
  side: DockSide;      // files/inspector: left|right; terminal: bottom only
  size: number;        // px; width for side docks, height for bottom
}

export interface LayoutState {
  panels: Record<PanelId, PanelState>;
  setVisible(id: PanelId, visible: boolean): void;
  toggle(id: PanelId): void;
  setSize(id: PanelId, px: number): void;      // clamped to [min, 50% of viewport]
  setSide(id: PanelId, side: DockSide): void;  // "move to other side"
  reset(): void;
}
export const useLayoutStore;   // persisted under localStorage 'orbital.layout'
```

Defaults: files left 260px hidden, inspector right 280px visible, terminal
bottom 240px hidden. A dock with no visible panels collapses to zero width.
Resizers are 6px hit areas between regions; dragging updates `size` live and
respects min sizes (files 180, inspector 220, terminal 120). Below 900px
viewport width, side docks render as overlays over the view instead of
columns, so the notebook never drops under ~480px wide.

## Files (M6)

`files/store.ts` holds the tree cache (`entries: Record<dir, ContentsEntry[]>`,
`expanded: Set<dir>`, `selected: path|null`) and text-file documents
(`files: Record<path, { text: string; dirty: boolean; language: string }>`).
Text files open as tabs beside notebooks: `TabsBar` renders
`useTabsStore().tabs`, a merged ordered list `{ kind: 'notebook'|'file',
path }` maintained by both stores through `shell/tabs.ts`.

## Terminal (M6)

`terminal/` wraps `@xterm/xterm` with the fit addon. One xterm instance per
open terminal, kept alive while the dock is hidden (display: none), disposed
on close. Colors come from the theme tokens: xterm's `theme` object is rebuilt
from `getComputedStyle(document.documentElement)` on every skin change.

## Outputs (M6)

- `stream` text is rendered through an ANSI converter (`notebook/ansi.ts`
  gains `ansiToSpans`) that maps the 16 colors plus bold/dim/underline to
  classes styled from tokens; no inline colors.
- `text/html` that contains `<script>` (or an `iframe`, `object`, `embed`)
  renders inside a sandboxed `<iframe sandbox="allow-scripts" srcdoc=…>` that
  reports its height via `postMessage`; plain HTML keeps the DOMPurify path.
- `clear_output(wait=True)` defers the clear until the next output; tqdm and
  progress bars therefore update in place.
- `update_display_data` replaces outputs by `displayId`.

## Notebook model (`notebook/model.ts`)

```ts
export type CellState = 'idle' | 'queued' | 'running' | 'ok' | 'error';

export interface Cell {
  id: string;
  type: 'code' | 'markdown';
  source: string;
  outputs: CellOutput[];          // code cells only
  executionCount: number | null;  // code cells only
  state: CellState;
  metadata: Record<string, unknown>;
}

export interface NotebookModel {
  path: string;
  cells: Cell[];
  metadata: Record<string, unknown>;   // nbformat metadata, kernelspec preserved
  nbformat: 4;
  nbformatMinor: number;
}

export function fromNbformat(raw: unknown, path: string): NotebookModel;
export function toNbformat(nb: NotebookModel): unknown;
```

`fromNbformat` must preserve unknown metadata and output fields it does not
understand, so round-tripping a notebook through ORBITAL does not strip
anything.

## Theme system

See `docs/DESIGN.md` for tokens and skins. The mechanism:

- `ThemeProvider` holds `{ mode, skinByMode }` in zustand, persisted to
  `localStorage` under `orbital.theme`.
- On change it sets `document.documentElement.dataset.mode` and `.skin`, and
  writes every token as `--<name>` on `:root`.
- It injects the skin's Google Fonts `<link>` once per skin and never removes
  fonts, so switching back is instant.
- `prefers-reduced-motion` and a user toggle both set `data-motion="reduced"`;
  all animation in CSS is gated on `:root:not([data-motion="reduced"])`.
- `effects/Sky.tsx` mounts only when `mode === 'bridge'`; unmounting tears the
  canvas and timers down completely. No effect runs in any other mode.

## Jupyter Server for development

`jupyter/jupyter_server_config.py`:

- `root_dir` = `../workspace`
- token = `orbital-dev` (dev only; Settings view lets the user change it)
- `allow_origin` = `http://localhost:5173`, `disable_check_xsrf = True`
- no browser auto-open, port 8888

`scripts/jupyter.ps1` and `scripts/jupyter.sh` start it from `.venv`.
`scripts/app.ps1` and `scripts/app.sh` run `npm run dev` in `app/`.

## Agent harness (M7)

A coding agent inside ORBITAL, built on the Claude Agent SDK (Claude Code as
a library) using the user's **Claude login**, never an API key.

```
agent/                      the sidecar (Node, ESM JavaScript, no build step)
  server.mjs                WebSocket server on :8787; one SDK query per run
  tools.mjs                 in-process MCP server exposing the orbital_* tools
  auth.mjs                  login probe + loginCommand for the UI
  package.json              @anthropic-ai/claude-agent-sdk, ws
app/src/agent/
  protocol.ts               wire contract (source of truth)
  store.ts                  ws client, run state, transcript, permissions
  AgentPanel.tsx            dockable panel: transcript, tool cards, prompt box
  ToolCard.tsx, DiffView.tsx, PermissionBar.tsx, agent.css
  executor.ts               runs orbital_* tool requests against the notebook/inspector stores
```

Flow: the panel sends `start` with the prompt and context. The sidecar runs
`query()` with `cwd = workspace/`, built-in tools (Read, Write, Edit, Glob,
Grep, Bash) plus the `orbital_*` MCP tools. Every `orbital_*` call is relayed
to the browser as `tool_request`; `executor.ts` performs it through the
notebook store (so the user watches cells appear and run) and replies with
`tool_result`. Permissions: the SDK's `canUseTool` hook forwards mutating
tools to the browser as `permission_request`; the panel shows Allow / Deny /
Always allow for this session. Text streams as `delta`; completed turns
arrive as `blocks`. `result` carries cost and the SDK session id, which the
panel passes back as `sessionId` on the next `start` to continue the
conversation.

Auth: the sidecar never handles credentials. On connect it reports
`auth.status`; when not logged in the panel shows the `loginCommand` and a
button that opens the ORBITAL terminal with it typed in. The SDK's bundled
runtime reads the same credentials as the Claude Code CLI.

The agent is a peer of the notebook, not a wrapper around it: closing the
panel never affects a running notebook, and the notebook store has no
knowledge of the agent.

## Map (M8.5 shape: one map per mode, plus the explorer column)

M8.5 replaced the single chart with **one renderer per theme mode**, plus a
persistent explorer column beside the stage. `map/renderer.ts` is the seam
between them and everything else, and it is authoritative — subagents build
to it, they do not change it:

```ts
export type MapMethod = 'cartography' | 'zoom' | 'chart';

/** Paper and Bridge draw charts; Night Ops and Cockpit fly — unless `override` pins this mode to something else. */
export function rendererForMode(mode: Mode, override?: Partial<Record<Mode, MapMethod>>): MapMethod;

/** The three map styles, for Settings' per-mode pickers. */
export const MAP_METHODS: { id: MapMethod; label: string; blurb: string }[];

export interface MapRendererProps {
  dir: string;                                   // the system on screen; '' is the workspace root
  bodies: Body[];                                // laid out by model.layoutSystem (a renderer may ignore orbit/phase)
  childrenOf: Record<string, BodyInput[]>;       // cached, hidden-filtered listings of this system's folder bodies
  descendants: Record<string, number>;           // known descendant counts per folder path; partial, grows as listings arrive
  statuses: Record<string, BodyStatus>;
  flightPath: string[];                          // recent notebooks in this system, newest first
  selected: string | null;
  hovered: string | null;
  query: string;                                 // filter text; non-matching bodies dim, matching ones light up
  themeMode: Mode;
  reduced: boolean;
  connected: boolean;
  anyBusy: boolean;
  systemLabel: string;                           // basename of dir, or "workspace" at the root

  onSelect(path: string | null): void;           // click, or keyboard focus + Space; null clears
  onHover(path: string | null): void;
  onOpen(path: string, kind: BodyKind): void;    // double click or Enter on a notebook/file
  onDive(dir: string): void;                     // double click or Enter on a folder: it becomes the system on screen
}
```

The interaction rule every renderer follows, so the map and the explorer
never disagree (`RENDERER_INTERACTION_RULE`): click a body selects, click
empty stage clears; double-click or Enter opens a notebook/file or dives into
a folder; a selected folder is the renderer's "focused" body — cartography
fans its children out as moons, zoom brightens the cluster — **selection is
focus**; Esc is handled by the view, not the renderer. Renderers never touch
the stores: everything they need arrives as props, everything they decide
goes back through the callbacks, which is what lets each one be built and
tested against one fixture in isolation.

`map/renderers.ts` maps `MapMethod` to a component: `cartography` →
`CartographyMap`, `zoom` → `ZoomMap`, `chart` → `ChartMap` (the original M8
orbital chart, now living in `MapCanvas.tsx`, kept as a third style with its
own Chart/Orbit setting). The default is per theme mode — Paper and Bridge
get cartography, Night Ops and Cockpit get zoom — but the owner can override
any mode from Settings' "Map style" section (one select per mode, default
marked); the override lives in `useMapStore().methodByMode`
(`setMethodForMode(mode, method | null)`, `null` clears back to the default),
persisted under `orbital.map`, and is also reachable from the palette
(`map.cycleStyle`). `useMapMethod()` reads the effective method for the
current theme mode.

`views/MapView.tsx` is the one place that talks to the map store: it composes
the data hooks into `MapRendererProps`, picks the component with
`rendererForMode(themeMode)`, and renders `<CartographyMap/>` |
`<ZoomMap/>` | `<ChartMap/>` in `.map-stage` beside `<MapExplorer/>` in
`.map-explorer` — a real flex column (320px, a bottom strip under 720px),
not an overlay, so renderers center in the stage without reserving HUD
space. The breadcrumb and legend still overlay the stage's corners
(`MapHud.tsx`); the toolbar and detail card moved into the explorer.

### The viewport camera (`map/viewport.ts`, `map/useViewport.ts`)

Every renderer draws inside one `<g class="viewport">` whose CSS transform is
a `Camera { x, y, k }` (screen = world·k + (x, y)). `viewport.ts` is pure and
node-tested: `panBy`, `zoomAt` (about a screen point, k clamped to
`K_MIN` 0.35 … `K_MAX` 3), `centerOn`, `fitBox`, `clampToBounds` (content may
be pushed at most 60 % off the view), `screenToWorld`, `cameraTransform`.
`useViewport(opts)` owns the interaction: a pointer drag pans after a 4 px
threshold (pointer capture, touch too, `is-dragging` on the `<svg>` for the
cursor), the wheel zooms about the cursor through a native non-passive
listener, double-click on empty stage fits, and the click that ends a drag is
swallowed in the capture phase so a drag never selects or clears. `fit()`,
`reset()`, `zoomIn()`, `zoomOut()` tween over 280 ms unless motion is reduced;
a `resetKey` (the renderer passes `dir`) restores the `initial` camera on
dive. The hook subscribes to `useMapStore`'s `viewportNonce`, `resetNonce`,
`zoomNonce` and `panRequest`, which the HUD's `⤢ fit` button, the palette
(`map.fitView`) and the view's keys (`F`, `+`/`-`, `0`, arrows) drive, so no
renderer wires keys itself. Labels keep a constant screen size at k ≥ 1 by a
`--inv-k` custom property (`scale(min(1, 1/k))` about the label anchor);
`textPath` captions scale their font size instead.

Renderers lay out into a plate larger than the stage and open centred on the
star at 1:1, so the owner drags to explore: cartography spreads by 1.7 with
worlds at their full 90–170 px (the fit-to-stage shrink is gone and the layout
exports its bounds for fit and clamp), the zoom method spreads the galaxy by
1.5 and systems and moons by 1.25, the chart by 1. Label de-collision still
solves at k = 1 in world units.

### The explorer column (`map/MapExplorer.tsx`)

Always lists exactly one folder, so the map and the column can never
disagree about what is on screen. The rule (`explorerFolder`, pure, tested):
the **selected folder**, else the **folder containing the selected
notebook/file**, else the **system on screen** (`dir`). Header: breadcrumb,
filter input (`/` focuses it), hidden-files toggle. Fact block: a selected
body's facts as the old detail card showed them (name, kind/size/modified,
kernel row with LED, cells, unsaved, open-in-a-tab), or the folder's own
counts when nothing is selected. Rows: kind glyph, display name, muted
relative time, a status LED when the entry has a kernel, a halo dot when
open; single click selects (the map's focus follows; a child of a selected
folder becomes the selection too, drawn as the renderer's focused moon),
double-click or Enter opens or dives. Rows are keyboard-navigable (roving
tabindex, ↑/↓, Enter, Esc back to the stage). A primary action row offers
Open/Enter for the selection, then `＋ Notebook` / `＋ Folder` / `＋ File`
acting in the **listed** folder — the `create*Here` helpers in `map/store.ts`
now take a target folder, defaulting to `dir` for the palette commands.
`Reveal in files` is gone from the map (the palette command remains).

### Store hooks added for the explorer

`map/store.ts` gained four hooks and a pure helper, alongside the existing
ones: `useChildrenOf(bodies)` returns cached, hidden-filtered listings of a
system's folder bodies keyed by path (a missing key means "not loaded yet",
which is what lets cartography draw an unopened world and zoom draw a
cluster's stars); `useDescendantCounts(bodies)` sums every cached level below
each folder body (via the pure `sumDescendants`) and prefetches one level
deeper than `useSystemBodies` already does, bounded by `PREFETCH_LIMIT`;
`useFolderListing(path)` is the explorer's own listing — whatever folder
`explorerFolder` picked, which is often not the system on screen — loading it
on demand and staying fixture-aware; `fixtureListing(tree, path, showHidden)`
is the pure per-folder read every one of these shares against `?fixture=1`'s
canned tree.

### The three renderers

**Cartography** (`map/cartography/layout.ts`, `sigils.ts`,
`CartographyMap.tsx`; Paper and Bridge) draws each folder as a **world**
(90–170px before an overall fit, log-scaled by descendant count), root
notebooks in the star's inner court, files along a drift belt, a star sigil,
and an orrery ring of seeded runes around the court. `layout.ts` is a pure,
deterministic composition solver, not a hand-placed picture: golden-angle
seeds on a tilted ellipse at a radius from `orbitFor(age)` (distance from the
star still encodes age), 60 Gauss–Seidel relaxation passes against the
worlds/court/belt, then an iterative uniform fit that only shrinks, with
labels through `model.placeLabels`. Connectors join same-band worlds
(capped at 8) plus up to 4 "wake" threads through consecutive flight-path
entries, each carrying glyph beads and a direction tick. Bridge paints five
characters by a hash of the name (storm, banded, ice-capped, ringed,
cratered) with atmosphere halos, light-thread connectors, and an orrery ring
that turns once per ten minutes in CSS, its beads walked by a
`requestAnimationFrame` loop that runs only in Bridge and never under
reduced motion. Paper paints **abstract sigils** instead — astrolabe,
rosette, lattice, volvelle, constellation-disc — in hatch and stipple fills
with ink hairlines and gold leaf (`accent-2`) reserved for the star sigil and
direction ticks; no shading, no motion. Selection is focus: the selected
world moves to the plate's centre at 1.4×, everything else dims to 15%, and
its `childrenOf` entries fan out as labelled moons (capped 10, `+n more`).

**Zoom** (`map/zoom/camera.ts`, `clusters.ts`, `ZoomMap.tsx`; Night Ops and
Cockpit) keys depth off `dir` (root = depth 1) and flies between four levels:
galaxy (folders as seeded spiral/elliptical clusters, points from
descendants capped at 160, tinted by band, a cosmic web between same-band
folders, a `loose files` field of individually selectable motes), system
(subfolders as painted planets sized by child count, bright notebooks,
asteroid files remapped onto an annulus so nothing hides under the local
star), moons (a large central disc, this folder's entries as labelled moons,
subfolders as outposts), and, beyond depth 3, the plain chart with
`textPath` captions. `camera.ts` is the pure math behind the fly-in/out: one
camera group, a nesting matrix so the arriving level starts pre-shrunk
inside the clicked body, an 800ms fly with a 600ms fade (200ms trail), and a
rebase back to identity that is pixel-identical (`cam · nest = I`) so
transitions never accumulate scale; reduced motion swaps instantly. Night
Ops paints calm and unlit, no CSS animation; Cockpit paints a tactical scope
— range rings with tick scales, bracketed contacts, corner brackets and LEDs
on planets, mono uppercase labels with `BRG`/`RNG` readouts for the
hovered/selected contact, a sweep on the selected ring, ambient rotation only
here via the `requestAnimationFrame` loop.

**Chart** (`MapCanvas.tsx`, exporting `ChartMap`; the original M8 view,
available from any mode as the third style) is unchanged: the current
directory as a star system, orbit radius encoding recency on the log scale
below, notebooks as discs, directories as ringed planets with moon dots,
files as asteroids, live open/active/error/dirty/kernel marks on the body
itself, a dashed flight path, and its own Chart/Orbit presentation
(`MapMode`) that defaults per theme mode and freezes to Chart under reduced
motion.

`map/model.ts` is pure geometry and classification — no React, no stores:

```ts
export type BodyKind = 'notebook' | 'directory' | 'file';
export type Band = 'today' | 'week' | 'month' | 'halfyear' | 'older';

export interface BodyInput {
  path: string;
  name: string;
  kind: BodyKind;
  modifiedAt: number;      // epoch ms
  bytes?: number;          // notebooks and files
  childCount?: number;     // directories, when their listing is cached
  moons?: string[];        // directories: names of notebooks inside (first 6), when cached
}

export interface Body extends BodyInput {
  band: Band;
  orbit: number;           // ORBIT_MIN..1, fraction of the system radius
  phase: number;           // radians, the body's angle in Chart mode
  periodMs: number;        // Kepler's third law from `orbit`
  scale: number;           // 0.75..1.5 visual multiplier
}

export function hashString(s: string): number;
export function seededRng(seed: number): () => number;
export function bandFor(ageMs: number): Band;
export function orbitFor(ageMs: number): number;              // log-scaled age → orbit
export function ringOrbit(band: Exclude<Band, 'older'>): number;
export function periodFor(orbit: number): number;
export function scaleFor(input: BodyInput): number;
export function makeBody(input: BodyInput, now: number): Body;
export function layoutSystem(inputs: BodyInput[], now: number): Body[];
export function angleAt(body: Body, t: number, tStart: number, motion: 'frozen' | 'orbit'): number;
export function positionAt(body: Body, t: number, tStart: number, motion: 'frozen' | 'orbit'): { x: number; y: number };
export function entriesToBodyInputs(
  entries: ContentsEntry[],
  entriesByDir: Record<string, ContentsEntry[]>,
  showHidden: boolean,
): BodyInput[];
export function displayName(body: Pick<Body, 'name' | 'kind'>): string;
export function formatBytes(n: number): string;
export function asteroidPath(path: string, r: number): string;  // 6-vertex outline, jittered by hashString(path)
```

`map/store.ts` is the zustand store and the derived hooks that feed the canvas:

```ts
export type MapMode = 'chart' | 'orbit';

export interface MapState {
  dir: string;                    // current system; '' = workspace root
  mode: MapMode | null;           // null → follow the theme mode (chart renderer only)
  methodByMode: Partial<Record<Mode, MapMethod>>;  // M8.5: per-mode style override; see "Map (M8.5 shape)" above
  showHidden: boolean;
  selected: string | null;
  hovered: string | null;
  query: string;
  dive(dir: string): void;
  up(): void;
  setMode(mode: MapMode | null): void;
  toggleMode(): void;             // flips relative to the effective mode and pins the result
  setMethodForMode(mode: Mode, method: MapMethod | null): void;  // null clears back to rendererForMode's default
  setShowHidden(v: boolean): void;
  select(path: string | null): void;
  hover(path: string | null): void;
  setQuery(q: string): void;
  open(path: string, kind: BodyKind): void;   // notebook/file → the matching store; directory → dive
}
export const useMapStore;         // persisted under 'orbital.map': { mode, methodByMode, showHidden, dir }
export function effectiveMapMode(mode: MapMode | null, themeMode: Mode): MapMode;
export function useEffectiveMapMode(): MapMode;
export function useMapMethod(): MapMethod;      // M8.5: which of the three styles draws the current theme mode
export function useSystemBodies(): { bodies: Body[]; loading: boolean; error: string | null };

export interface BodyStatus {
  open: boolean; active: boolean; dirty: boolean;
  kernel: KernelStatus | null;
  errors: number;
  running: number;
}
export function useBodyStatuses(bodies: Body[]): Record<string, BodyStatus>;
export function useFlightPath(bodies: Body[]): string[];       // ≤ 6 most recently opened notebooks, newest last
export function setMapFixture(tree: Record<string, BodyInput[]> | null, statuses?: Record<string, Partial<BodyStatus>>): void;
```

`useChildrenOf`, `useDescendantCounts`, `useFolderListing`, and
`fixtureListing` (M8.5, for the explorer column) are described above under
"Store hooks added for the explorer" rather than repeated here.

Rendering is SVG for structure, drawn by React, plus one `requestAnimationFrame`
loop for motion, not PixiJS — the same choice recorded in the decision summary
above, and the one every renderer makes independently (cartography's bead
walk, zoom's ambient rotation, chart's orbit motion). The chart renderer's
loop never touches React state: it mutates `transform` / `d` / `points` /
`class` directly on SVG elements held in a `Map<path, SVGGElement>` of refs,
and it runs only while `mode === 'orbit'`, motion is not reduced, the tab is
visible, and `MapCanvas` is mounted. Fills, strokes, and opacities live in
`map.css` (or `cartography.css` / `zoom.css`) as classes, never as SVG
presentation attributes, so `var()` and `color-mix()` keep working (the
gradient/pattern `fill="url(#…)"` references are the one exception; their
stops still pull color from CSS).

Data flow: `useSystemBodies()` reads the current directory's entries from
`files/store.ts` (loading them if not cached), prefetches up to 24 uncached
child directories so moon counts and child counts fill in, and re-lists the
current directory every 30 seconds while mounted. `useBodyStatuses()` derives
open/active/dirty/kernel/error/running state per body from the notebook,
files, and tabs stores. `MapHud.tsx` reads the same store for the breadcrumb
and legend; `MapExplorer.tsx` reads it for the folder listing, the fact
block, and the create row. The fixture seam: `?fixture=1` calls
`setMapFixture()` with a canned tree from `map/fixture.ts` so every renderer,
and the explorer, render with no server running; `setMapFixture(null)` on
unmount restores the real data path.

Small contract additions elsewhere:

- `session/types.ts`: `ContentsEntry` gains `size?: number` (bytes; undefined
  for directories); `session/jupyter.ts` passes it through from the contents
  listing.
- `notebook/store.ts`: `kernelByPath: Record<string, KernelStatus>`, written
  for every open notebook's session status (not just the active one) and
  cleared when that notebook closes, so the map can show kernel state for
  bodies that are not the active tab.
- `files/store.ts`: `revealPath(path)`, showing the file browser, expanding
  every ancestor of `path`, and selecting it; `shell/commands.ts`'s
  `files.revealActive` now calls it instead of carrying its own loop.
- `theme/ThemeProvider.tsx`: `useReducedMotion()`, exposing the same
  `motion`-store-plus-`prefers-reduced-motion` check the provider already
  applies internally, so the map (and anything else) can read it without
  duplicating the logic.

## Later milestones (not designed yet)

- **Sprite customizer**: layered SVG parts, exported sprite sheet, state-driven animations.
- **Hub service**: FastAPI, accounts, presence over WebSocket, project metadata, shared sessions.
- **Desktop**: Tauri shell that starts the local Jupyter Server and opens the app.

Each gets its own section here when it is designed.
