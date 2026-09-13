# Style guide mockup spec

Purpose: static HTML mockups so the owner can pick a visual direction for each
of the four UI modes. Every variant shows the **same mock notebook screen** with
the **same content**, so only the styling differs. These are not functional.

## Files

One self-contained HTML file per variant:

```
styleguide/<mode>/<mode>-<letter>-<slug>.html
```

Examples: `styleguide/paper/paper-a-lab-notebook.html`,
`styleguide/bridge/bridge-c-holodeck.html`.

Rules:
- All CSS inline in a `<style>` block. No external CSS, images, or JS libraries.
- Google Fonts via `<link>` to fonts.googleapis.com is allowed. Every font must
  have a real fallback stack (e.g. `'JetBrains Mono', Consolas, monospace`).
- Zero JavaScript unless a Bridge variant needs a tiny script for a canvas
  effect. If so, keep it under 60 lines and make it degrade to nothing.
- Must render correctly at 1280x800 with no horizontal scrollbar. Vertical
  scroll inside the notebook column is fine.
- All colors, fonts, radii, and spacing come from CSS custom properties on
  `:root`. No hardcoded colors below the token block. This is checked in review.
- Respect `@media (prefers-reduced-motion: reduce)`: all animation off.
- Full `<!DOCTYPE html>` documents with `<title>` set to
  `<Mode> / <Variant name>`.

## Required token block

Every file defines at least these on `:root`, in this order, with a comment
naming the variant:

```css
:root {
  /* Mode: Paper — Variant A: Lab Notebook */
  --bg: ...;            /* page background */
  --surface: ...;       /* panels, cells */
  --surface-2: ...;     /* raised or nested surface */
  --border: ...;
  --text: ...;
  --text-muted: ...;
  --accent: ...;        /* primary interactive / highlight */
  --accent-2: ...;      /* secondary highlight */
  --success: ...;
  --warning: ...;
  --danger: ...;
  --font-ui: ...;
  --font-mono: ...;
  --font-display: ...;  /* headings, logo; may equal --font-ui */
  --radius: ...;
  --glow: ...;          /* box-shadow used for focus/active; may be "none" */
}
```

## Required page structure

Use exactly this structure and these class names so the pages are comparable.
Styling is entirely up to the variant; the DOM is not.

```
body
  .spec-strip            (top of page, above the app frame; see below)
  .app                   (the mock application, fills the rest of the viewport)
    .topbar
      .logo              text: "ORBITAL"  (the working name; style freely)
      .project-name      text: "hull-stress-analysis"
      .mode-dial         four items: Paper, Night Ops, Cockpit, Bridge;
                         the current mode gets class .active
      .kernel-status     a dot + text "Python 3.12 · idle"
    .rail                (left, narrow vertical nav)
      .rail-item x5      labels: Map, Notebook, Crew, Comms, Settings;
                         "Notebook" gets .active
    .notebook            (center column, scrolls)
      .cell.cell-md      rendered markdown, see content below
      .cell.cell-code    code + output, see content
      .cell.cell-code.cell-error   code + error output, see content
      .cell.cell-code.cell-running code with no output yet; shows a running state
    .inspector           (right panel)
      .inspector-title   text: "Variables"
      .var-row x4        name / type / value rows, see content
    .statusbar
      left:  "3 cells · 2 executed · 1 error"
      right: "Star date 2026.256 · 14:32"
```

The `.rail` may be icons, text, or both. If icons, use inline SVG or Unicode,
not an icon font.

## Required content (identical in every variant)

**Markdown cell:**

```
# Hull stress analysis
Load the strain-gauge telemetry, fit a simple model, and flag panels above the
yield threshold. Data comes from `sensors/deck-4/` sampled at 200 Hz.
```

**Code cell 1** (executed, shows a count `[1]` and output):

```python
import numpy as np
import pandas as pd

df = pd.read_parquet("sensors/deck-4/strain.parquet")
df["stress_mpa"] = df["strain"] * 210_000  # steel, E in MPa
df.describe()
```

Output: a small 4-row, 3-column table with header `strain | stress_mpa | temp_c`
and rows `mean`, `std`, `min`, `max` with plausible numbers.

**Code cell 2** (error, count `[2]`):

```python
threshold = config["yield_mpa"]
flagged = df[df.stress_mpa > threshold]
```

Error output (render as a traceback block):

```
NameError                                 Traceback (most recent call last)
Cell In[2], line 1
----> 1 threshold = config["yield_mpa"]

NameError: name 'config' is not defined
```

**Code cell 3** (running, count `[*]`):

```python
model = fit_panel_model(df, order=3)
```

**Inspector rows:**

| name | type | value |
|------|------|-------|
| df | DataFrame | 48,000 × 3 |
| threshold | — | not defined |
| np | module | numpy 2.1 |
| model | — | computing… |

## Spec strip (top of every page)

A thin band above `.app`, visually separate from the mock, containing:

- Variant name and mode, e.g. **Paper · A · Lab Notebook**
- One sentence describing the intent of the variant
- Twelve small swatches labeled: bg, surface, surface-2, border, text, muted,
  accent, accent-2, success, warning, danger, glow
- Font names for ui / mono / display

This strip exists so the owner can read the tokens at a glance. Keep it
neutral and compact (under 80px tall).

## Mode intent

**Paper** — light mode, maximum readability, long-session comfort. Sci-fi
lives in typography, line work, and small details, not in glow or motion.
No animation.

**Night Ops** — dark mode, calm, low-contrast surfaces, one restrained accent.
The mode you use at 2am. No animation. Glow allowed only on focus states.

**Cockpit** — dense HUD. Small type, tight spacing, framed panels, corner
brackets, readouts. Dark by default. Motion limited to a running-cell
indicator. Feels like an instrument panel.

**Bridge** — the full show. Animated backgrounds, glow, holographic panels,
particles or orbit rings, scanlines if it fits. Must still be usable as a
notebook: code stays legible and the animations sit behind content, not on it.

## Definition of done per variant

- Opens from disk with no console errors.
- No horizontal scroll at 1280x800.
- All 16 tokens defined and used; no hardcoded colors below the token block.
- Spec strip present and accurate.
- All four cells, the inspector, rail, topbar, and statusbar present with the
  exact required text.
- Running cell visibly differs from executed cells. Error output is visibly
  distinct from normal output.
