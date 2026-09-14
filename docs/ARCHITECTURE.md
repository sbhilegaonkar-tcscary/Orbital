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
| Effects | CSS first; PixiJS later for the map | Keep the notebook cheap; the map is the only thing that needs a canvas |
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

shell/
  AppShell.tsx           grid: topbar / rail / view / inspector / statusbar
  TopBar.tsx             logo, project name, ModeDial, KernelStatus
  ModeDial.tsx           four-mode segmented control; skin picker in a popover
  Rail.tsx               Map, Notebook, Crew, Comms, Settings
  Inspector.tsx          variables panel (v1: names/types/values from a kernel introspection call)
  StatusBar.tsx          cell counts, star date clock

views/
  NotebookView.tsx       open/create notebooks from the workspace, hosts <Notebook/>
  MapView.tsx            placeholder until the map milestone
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

## Later milestones (not designed yet)

- **Map view**: PixiJS canvas, projects as bodies, minimalist and full modes.
- **Sprite customizer**: layered SVG parts, exported sprite sheet, state-driven animations.
- **Hub service**: FastAPI, accounts, presence over WebSocket, project metadata, shared sessions.
- **Desktop**: Tauri shell that starts the local Jupyter Server and opens the app.

Each gets its own section here when it is designed.
