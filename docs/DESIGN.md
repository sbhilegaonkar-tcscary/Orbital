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
| `cockpit` | dense | framed panels, LEDs, tab headers | running-cell indicator; map in Orbit mode | monitoring, many cells on screen |
| `bridge` | comfortable | translucent panels, glow | ambient background + running sweep; map in Orbit mode | the show |

The map has its own Chart/Orbit presentation on top of this table, defaulting
per mode as shown above (Chart in Paper and Night Ops, Orbit in Cockpit and
Bridge), overridable by the user, and frozen back to Chart whenever reduced
motion is set.

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

## Map

Each mode's map is drawn by one of three renderer methods (`map/renderer.ts`),
chosen by mode and overridable per mode from Settings' "Map style" picker:

| Mode | Method (default) | The look |
|---|---|---|
| `paper` | cartography | abstract sigils on a plate — astrolabe, rosette, lattice, volvelle, constellation-disc — hatch and stipple only |
| `bridge` | cartography | five painted planet characters, atmosphere halos, light-thread connectors, a turning orrery ring |
| `night-ops` | zoom | calm, unlit star clusters and flat planets; glow only on hover or selection |
| `cockpit` | zoom | a tactical scope — range rings, bracketed contacts, corner brackets, mono uppercase `BRG`/`RNG` readouts |

Any mode can be set to `chart` instead from the same picker — the original
M8 rings-by-recency view (a notebook is a plain disc, a directory a ringed
planet with moon dots, a loose file a small irregular asteroid), with its own
Chart/Orbit setting.

Shared across all three methods: every color is a token, never a literal;
every fill, stroke, and opacity is a CSS class keyed by `[data-mode]` (the one
exception SVG forces is a `fill="url(#…)"` gradient or pattern reference); all
motion is gated on reduced motion (a `reduced` prop plus the
`[data-motion="reduced"]` CSS rule) and runs only while its renderer is
mounted and the tab is visible; and labels radiate from their body,
de-collide against each other, and always show for open, active, selected, or
hovered bodies, budgeted by system size otherwise — cartography's through
`model.placeLabels`, the others through their own version of the same rule.

**Paper is abstract, on purpose.** Sigils, not planets: no realistic bodies,
no shading, no terminator, no ambient motion — "more abstract, with no
realistic sprites," the owner's words, carried straight through from the
Vellum mockup into the built renderer.

The explorer column beside the map (any method, any mode) is `.map-panel`
styling applied to a real layout column rather than an overlay: a translucent
`--surface`, one hairline border, `--radius` corners, joining the `--panel` +
blur treatment the rest of the chrome uses in bridge so it reads as part of
the ship. The breadcrumb and legend remain small `.map-panel` overlays on the
stage itself.

## Effects budget

- Bridge background lives in one fixed layer behind the app, `pointer-events:
  none`, animated with `transform` and `opacity` only.
- Star fields are `box-shadow` lists, generated once with a fixed seed.
- The whole effects layer unmounts outside bridge mode.
- `[data-motion="reduced"]` disables every animation and hides the shooting
  star; the running indicator becomes a static bar.
