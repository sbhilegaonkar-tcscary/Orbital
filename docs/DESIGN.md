# ORBITAL design system

Four modes, several skins per mode, one token vocabulary. Mockups for every
skin are in `styleguide/`, catalogued in `styleguide/CATALOG.md`.

## Modes

A mode is a *behavior* profile: density, chrome, and whether effects run.
A skin is a *palette and type* profile that belongs to one mode.

| Mode | Density | Chrome | Motion | Purpose |
|---|---|---|---|---|
| `paper` | comfortable | hairlines, no shadows | none | daytime, long sessions, reading |
| `night-ops` | comfortable | soft surfaces, glow on focus only | none | late-night, calm |
| `cockpit` | dense | framed panels, LEDs, tab headers | running-cell indicator only | monitoring, many cells on screen |
| `bridge` | comfortable | translucent panels, glow | ambient background + running sweep | the show |

Mode-level layout differences are expressed in `app/src/theme/modes.css`
through `[data-mode="..."]` selectors: font sizes, paddings, radii overrides,
whether the cell tab header renders. Skins never change layout.

## Skins

Default skin per mode, and the alternates registered from the exploration:

| Mode | Default skin | Alternates registered |
|---|---|---|
| paper | `clinical-terminal` (E) | `clinical` (B), `terminal-light` (D) |
| night-ops | `deep-space` (A) | `aurora` (E), `graphite` (B) |
| cockpit | `glass-deck` (E) | `glass-cockpit` (D) |
| bridge | `nebula-drift` (E) | `nebula` (A), `synthwave` (D), `retro-crt` (B) |

Token values for each come straight from the `:root` block of the matching
file in `styleguide/`. Parked variants are not registered but remain in the
catalog and can be added in one file.

## Tokens

Every skin defines exactly these. Components use them as CSS variables
(`var(--accent)`) and nothing else.

| Token | Meaning |
|---|---|
| `bg` | page background |
| `surface` | panels and cells |
| `surface-2` | raised or nested surface |
| `border` | hairlines |
| `text` | primary text |
| `text-muted` | secondary text, labels |
| `accent` | primary interactive and highlight color |
| `accent-2` | secondary highlight (data types, links in markdown) |
| `success` | kernel idle, ok states |
| `warning` | running, pending |
| `danger` | errors |
| `font-ui` | interface font stack |
| `font-mono` | code font stack |
| `font-display` | logo and display headings; may equal `font-ui` |
| `radius` | panel and cell corner radius |
| `glow` | box-shadow for focus and active states; `none` allowed |

Derived colors (tints, translucent panels, hover states) are produced with
`color-mix(in srgb, var(--token) N%, transparent)` in CSS. No skin needs to
ship `-rgb` helper tokens.

Skin shape in TypeScript:

```ts
export interface Skin {
  id: string;                 // 'deep-space'
  mode: Mode;                 // 'night-ops'
  name: string;               // 'Deep Space'
  description: string;        // one sentence, shown in the picker
  tokens: ThemeTokens;        // all 16, as CSS values
  fontsUrl?: string;          // Google Fonts stylesheet URL, optional
}
```

## Component rules (carried from the hand-written round)

- **Gutter column** on every cell: execution count right-aligned, `out` /
  `err` label beneath it. The cell body is one surface; code and output are
  separated by a rule, not nested boxes.
- **Error state** colors the gutter count and tints only the traceback. The
  failing `---->` line gets its own highlight. The cell border may warm toward
  danger; the cell does not turn red.
- **Running state** is `[*]` in the gutter plus a thin top-edge indicator:
  dotted border in paper, static two-tone rule in night-ops, sweeping light in
  cockpit and bridge.
- **Tabular numerals** on every table and value column
  (`font-variant-numeric: tabular-nums`).
- **Icons** are inline SVG, stroke-only, `currentColor`, 1.3px stroke.
- **Type scale**: 10.5 / 12 / 13.5 / 15 / 22 px. Code is 13.5px, except
  12.5px in cockpit. Small labels are the only place for uppercase and letter
  spacing.
- **Mode dial** is a segmented control with the active segment filled or
  underlined per skin; it never uses per-item borders in paper or night-ops.
- **Statusbar** is mono, 11px, muted, with middle-dot separators.

## Effects budget

- Bridge background lives in one fixed layer behind the app, `pointer-events:
  none`, animated with `transform` and `opacity` only.
- Star fields are `box-shadow` lists, generated once with a fixed seed.
- The whole effects layer unmounts outside bridge mode.
- `[data-motion="reduced"]` disables every animation and hides the shooting
  star; the running indicator becomes a static bar.
