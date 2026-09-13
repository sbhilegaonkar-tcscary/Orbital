# Style catalog

Every visual direction explored for ORBITAL, with its tokens, its defining
moves, and where it stands. Add new entries at the bottom of the relevant mode
when a new variant is made; do not delete parked ones, they are cheap to keep
and expensive to rediscover.

Files live in `styleguide/<mode>/`. The gallery is `styleguide/index.html`.
The layout and content every mockup must share is in `styleguide/SPEC.md`.

Status vocabulary:

- **chosen** — the direction we are building toward for that mode
- **candidate** — in the running, awaiting a decision
- **borrow** — not chosen as a whole, but specific details are earmarked
- **future** — liked, will be offered as an alternate skin later
- **parked** — explored, not pursued now

Rounds: A–D were generated from a written spec (round 1). E variants were
hand-written as a quality comparison (round 2).

---

## Paper (light, readable, no motion)

| | Variant | Status | bg | surface | text | accent | accent-2 | ui / mono / display | radius |
|---|---|---|---|---|---|---|---|---|---|
| A | Lab Notebook | parked | `#f6f1e4` | `#fbf8f0` | `#241f14` | `#0f6f66` | `#a15c1f` | Source Sans 3 / IBM Plex Mono / Fraunces | 4px |
| B | Clinical | chosen (basis) | `#ffffff` | `#ffffff` | `#111417` | `#0057ff` | `#0a8f7a` | Inter / IBM Plex Mono / Inter | 2px |
| C | Blueprint | parked | `#dfeef6` | `#e9f4fa` | `#0c2c47` | `#cf6a1f` | `#1f6f8f` | IBM Plex Mono ×3 | 0 |
| D | Terminal Light | chosen (basis) | `#f4f2ee` | `#faf9f6` | `#232019` | `#a05a00` | `#4f6b52` | JetBrains Mono ×3 | 2px |
| E | Clinical Terminal | candidate | `#fafaf9` | `#ffffff` | `#17181a` | `#0a5cff` | `#b3620d` | JetBrains Mono ×3 | 2px |

Defining moves:

- **A Lab Notebook** — cream page with a dot grid, serif display, warm teal. The most "paper" of the set.
- **B Clinical** — hairline borders, no shadows, one electric blue. Reads as an instrument.
- **C Blueprint** — cyan grid ground, corner ticks on panels, orange for the one thing that matters.
- **D Terminal Light** — a single monospace face everywhere, `//` panel titles, `>` prompts, amber accent.
- **E Clinical Terminal** — D's voice on B's whiteness. Execution counts in a right-aligned gutter, `out`/`err` labels under them, dashed rule between code and output, failing traceback line highlighted instead of the whole cell going red, amber reserved for prompt marks only.

Owner notes: likes B and D; asked for D lighter to sit closer to B. E is that merge.

---

## Night Ops (dark, calm, no motion, glow only on focus)

| | Variant | Status | bg | surface | text | accent | accent-2 | ui / mono / display | radius |
|---|---|---|---|---|---|---|---|---|---|
| A | Deep Space | chosen (favorite) | `#0a0e16` | `#0f1420` | `#e3e8f0` | `#5fb3c4` | `#6c86b8` | Inter / JetBrains Mono / Inter | 6px |
| B | Graphite | future | `#1c1c1e` | `#232325` | `#ece7df` | `#cf9a44` | `#9a958c` | IBM Plex Sans / IBM Plex Mono / IBM Plex Sans | 3px |
| C | Phosphor | parked | `#000000` | `#040a04` | `#b9ffb4` | `#7fe08a` | `#57b563` | IBM Plex Mono ×3 | 2px |
| D | Midnight Violet | borrow | `#17102a` | `#1e1633` | `#ded7ec` | `#cd7fda` | `#8f83d6` | Inter / JetBrains Mono / Poppins | 16px |
| E | Aurora | candidate | `#0b0d18` | `#12152a` | `#dde2f1` | `#6cc4d6` | `#a892f0` | Inter / JetBrains Mono / Inter | 8px |

Defining moves:

- **A Deep Space** — navy, not black. One muted cyan. Faint vignette. The reference dark theme.
- **B Graphite** — zero color tint in the greys, single amber. The most conservative option.
- **C Phosphor** — three brightness levels of green instead of a separate muted color; dim non-glowing red for errors.
- **D Midnight Violet** — indigo ground, magenta accent, 16px radii. Warmer and softer than the others.
- **E Aurora** — A's navy with D's violet let in at the edges as two static radial washes. Cyan for interaction, violet for data types, green for health, all at low saturation. A 2px aurora gradient runs along the top of the topbar. Inspector types are color-coded by kind.

Owner notes: A is the favorite, B also liked (future skin), wanted violet mixed with A's colors and "multicolored but easy on the eyes." E is that.

---

## Cockpit (dense HUD, motion only on the running cell)

| | Variant | Status | bg | surface | text | accent | accent-2 | ui / mono / display | radius |
|---|---|---|---|---|---|---|---|---|---|
| A | Fighter HUD | parked | `#030a05` | `#071409` | `#baffd0` | `#39ff6a` | `#ffb020` | Rajdhani / Share Tech Mono / Rajdhani | 2px |
| B | Starship Console | borrow | `#0b1116` | `#131b22` | `#dbe6ec` | `#2dd4bf` | `#ff8a3d` | Titillium Web / IBM Plex Mono / Titillium Web | 4px |
| C | Mech | borrow | `#191919` | `#232323` | `#e9e7e0` | `#ffd400` | `#ff6a00` | Barlow Condensed / Space Mono / Barlow Condensed | 0 |
| D | Glass Cockpit | chosen | `#050810` | translucent `rgba(32,48,74,.38)` | `#eaf3ff` | `#5ec8ff` | `#8fe3d0` | Inter / JetBrains Mono / Inter | 12px |
| E | Glass Deck | candidate | `#060a14` | `#172439` at 55% | `#e6f0ff` | `#5ec8ff` | `#8fe3d0` | Inter / JetBrains Mono / Inter | 8px |

Defining moves:

- **A Fighter HUD** — phosphor-green wireframe brackets on every panel, all-caps condensed labels, a `KRN ▮▮▮▯` readout.
- **B Starship Console** — beveled slate, trapezoid tab headers on cells, status LEDs, teal and orange.
- **C Mech** — thick borders, hazard stripes on danger states, safety yellow, condensed type.
- **D Glass Cockpit** — translucent panels with backdrop blur, hairlines, rounded rectangles, cool blue-white.
- **E Glass Deck** — D's glass, plus B's tab headers (LED, count, language, timing) and B's LEDs in the topbar and statusbar, plus C's hazard stripe reduced to a single 5px edge on the error cell. Inspector rows carry a small type tag (DF, MOD). The running cell has a 1px light sweep along its top edge and a pulsing LED.

Owner notes: D chosen, wants Mech's ideas and liked Starship. E folds both in.

---

## Bridge (full effects, animation behind content)

| | Variant | Status | bg | surface | text | accent | accent-2 | ui / mono / display | radius |
|---|---|---|---|---|---|---|---|---|---|
| A | Nebula | chosen | `#0a0b16` | `#12142a` | `#e8e9fb` | `#4fd8e8` | `#b98af0` | Inter / JetBrains Mono / Orbitron | 10px |
| B | Retro CRT | future | `#050301` | `#0c0803` | `#ffb000` | `#ffcf5c` | `#7dffa0` | Share Tech Mono ×2 / VT323 | 2px |
| C | Holodeck | parked | `#060b14` | `#0d1826` | `#eaf3fb` | `#5ec8ff` | `#a9f0ff` | Titillium Web / JetBrains Mono / Exo 2 | 14px |
| D | Synthwave | future (loved) | `#180a2b` | `#251340` | `#f5ecff` | `#ff2fb0` | `#35e8ff` | Rajdhani / JetBrains Mono / Orbitron | 6px |
| E | Nebula Drift | candidate | `#090a17` | `#12142a` at 74% | `#e8e9fb` | `#4fd8e8` | `#b98af0` | Inter / JetBrains Mono / Orbitron | 10px |

Defining moves:

- **A Nebula** — drifting layered radial gradients, box-shadow starfield with twinkle, cyan and violet edge glow on panels.
- **B Retro CRT** — amber phosphor, 7% scanline overlay, vignette, flicker on the logo only.
- **C Holodeck** — frosted glass over two slowly rotating SVG orbit rings.
- **D Synthwave** — gradient sun with cut lines, perspective grid horizon scrolling toward the viewer, neon magenta and cyan. The animation the owner responded to most.
- **E Nebula Drift** — A's palette with more deliberate motion: three nebula clouds on 120–150s alternate cycles, two star layers moving at different speeds for parallax, one shooting star every 16 seconds, gradient-text logo, light sweep on the running cell. Stars are generated by a 20-line seeded script so the sky is identical on every load. Orbitron is used for the logo and inspector title only; markdown headings stay in Inter.

Owner notes: loves Synthwave (keep as a full mode later), moving forward with Nebula now, wants Retro CRT as a future option.

---

## Shared conventions the E round introduced

These are worth carrying into the real theme system regardless of which variants win:

- **Gutter column** for execution counts, right-aligned, with `out` / `err` labels beneath. Cells are one surface, not a box inside a box.
- **Errors mark the gutter and tint the traceback**, they do not repaint the whole cell. The failing `---->` line gets its own highlight.
- **Running state** is a count of `[*]` plus a thin top-edge indicator: static two-tone rule in Night Ops, sweeping light in Cockpit and Bridge, dotted border in Paper.
- **Tabular numerals** on every table and every value column.
- **Inline SVG icons** in the rail, stroke-only, `currentColor`, 1.3px.
- **Every translucent or derived color is `color-mix()` on a token**, so there are no `rgba()` literals below the `:root` block and a palette swap changes everything.
- **Font scale**: 10.5 / 12 / 13.5 / 15 / 22. Code at 13.5px except Cockpit at 12.5px.

## How to add a variant

1. Copy the closest E file as a starting point (they share one skeleton).
2. Change only the `:root` block first and look at it. Most of a direction is the palette.
3. Then adjust the four "defining move" areas: topbar, cell chrome, error treatment, running treatment.
4. Add a card to `index.html` and a row plus a bullet here.
5. Screenshot at 1280×800 and check nothing clips before showing it.
