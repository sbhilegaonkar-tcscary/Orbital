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

## Later milestones (not designed yet)

- **Map view**: PixiJS canvas, projects as bodies, minimalist and full modes.
- **Sprite customizer**: layered SVG parts, exported sprite sheet, state-driven animations.
- **Hub service**: FastAPI, accounts, presence over WebSocket, project metadata, shared sessions.
- **Desktop**: Tauri shell that starts the local Jupyter Server and opens the app.

Each gets its own section here when it is designed.
