# Keyboard

The contract for every shortcut in ORBITAL. Implementations conform to this
file; the in-app help overlay is generated from `app/src/shell/shortcuts.ts`,
which must match it.

## The two modes

A cell is either in **edit mode** (the cursor is inside its editor; typing
inserts text) or **command mode** (the cell itself is focused; single keys are
commands). The rule that keeps typing where you expect it:

- Single-letter command shortcuts fire **only** when `document.activeElement`
  is a `.cell` element. Never when focus is in an editor, an input, a select,
  or on `body`. If focus is nowhere in particular, letters do nothing.
- Entering edit mode focuses the editor and places the cursor at its last
  position (or the end). Leaving edit mode focuses the cell element.
- A cell in edit mode shows a visible edit indicator (accent left rule on the
  gutter); in command mode the selected cell shows the selection ring only.

## Running

| Keys | Edit mode | Command mode |
|---|---|---|
| Shift+Enter | Run cell, then move to the next cell **in edit mode** with its editor focused. Creates a new code cell if this was the last. | Same. |
| Ctrl+Enter | Run cell, stay in place, stay in edit mode. | Run cell, stay in command mode. |
| Alt+Enter | Run cell, insert a new code cell below, edit it. | Same. |
| Ctrl+Shift+A | Run all cells above (exclusive). | Same. |
| Ctrl+Shift+B | Run this cell and all below. | Same. |

Shift+Enter deliberately differs from classic Jupyter (which lands in command
mode): the owner wants typing to continue in the next box.

## Edit mode only

| Keys | Action |
|---|---|
| Esc | Leave edit mode (command mode on this cell). If a completion popup or inspect tooltip is open, Esc closes that first and stays in edit mode. |
| Tab | Indent at line start or after whitespace; otherwise open completions. |
| Shift+Tab | Inspect the symbol at the cursor (signature/docstring tooltip). |
| Ctrl+Space | Open completions explicitly. |
| Ctrl+F | Find in this cell. |
| Ctrl+Z / Ctrl+Y | Undo / redo text. |
| Ctrl+Shift+- | Split the cell at the cursor. |
| Ctrl+/ | Toggle comment on the selected lines. |

## Command mode only

| Keys | Action |
|---|---|
| Enter | Edit mode on the selected cell (markdown cells too). |
| ↑ / ↓ or K / J | Select previous / next cell. |
| A / B | Insert code cell above / below and select it. |
| D D | Delete the selected cell (two presses within 500 ms). |
| Z | Undo the last delete. |
| X / C / V | Cut / copy / paste below. |
| M / Y | Change to markdown / code. |
| Shift+M | Merge with the cell below. |
| O | Toggle output collapse. |
| Shift+O | Toggle output collapse for all cells. |
| L | Toggle line numbers in this cell. |
| ? or H | Keyboard help overlay. |

## Map view

Active when the Map view has focus and no text input does. Single letters
follow the notebook rule: they fire only when focus is on the map container or
on a body, never in an input.

| Keys | Action |
|---|---|
| Tab / Shift+Tab | Next / previous body (orbit order: inner to outer, then by angle). |
| Enter or Space | Open the selection, or enter the folder. |
| Esc | Deselect; if nothing is selected, go up one level. |
| Backspace | Go up one level. |
| / | Focus the filter. Esc in the filter clears it and returns focus to the map. |
| O | Toggle Chart / Orbit (chart style only). |
| H | Toggle hidden files. |
| ? | Keyboard help overlay. |

The map is drawn larger than the stage that shows it, so the stage is a window
onto the plate rather than a frame around it. The camera that moves that window
is shared by every renderer (`app/src/map/viewport.ts`), and so are its
controls:

| Keys | Action |
|---|---|
| Drag / wheel | Pan the plate / zoom about the cursor. |
| Double-click empty stage | Fit the whole plate in view. |
| F | Fit to view (also the HUD's ⤢ fit button and "Map: fit to view"). |
| + / - | Zoom in / out about the middle of the stage. |
| 0 | Reset the camera to where the system opened. |
| ← ↑ → ↓ | Pan by 48 px, when the stage has focus. |

Entering a folder re-opens the camera on the new system; selecting a body does
not move it. Zooming never changes the size of a label: type is drawn at a
constant size on screen and stays welded to its body's rim.

Tab is captured by the map so the bodies form their own ring of focus stops;
the explorer column's own controls (filter, hidden, the create row) tab
normally among themselves.

Inside the explorer's listing:

| Keys | Action |
|---|---|
| ↑ / ↓ | Move between rows (one row at a time is a tab stop). |
| Enter | Open the row's notebook or file, or enter its folder. |
| Esc | Return focus to the map. |

Arrows move the focus ring only; clicking a row or pressing Enter is what
changes the selection, so arrowing past a folder never re-lists the column
underneath you.

## Global (any focus, unless typing in a text input)

| Keys | Action |
|---|---|
| Ctrl+S | Save the active notebook or file. |
| Ctrl+K or Ctrl+Shift+P | Command palette. |
| Ctrl+B | Toggle the file browser. |
| Ctrl+` | Toggle the terminal dock. |
| Ctrl+Shift+I | Toggle the inspector. |
| Ctrl+Shift+L | Toggle the agent panel. |
| Ctrl+W | Close the active tab (confirms if dirty). |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab. |
| Ctrl+, | Settings view. |
| Ctrl+Shift+M | Mode menu. |

Ctrl means Cmd on macOS. Browser shortcuts that ORBITAL overrides (Ctrl+S,
Ctrl+W, Ctrl+K, Ctrl+Tab) are prevented only when the app has focus. In the
Tauri build these become native.
