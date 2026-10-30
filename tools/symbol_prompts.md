# Map symbol sheets: prompts for Gemini (or any image model)

Image models don't output real transparency. If you ask for a "transparent background" they usually paint a
fake grey checkerboard into the picture. So we ask for a **flat magenta background** and key it out afterwards
with `tools/process_sheet.mjs` (see the bottom of this file).

## Workflow that keeps the style consistent

1. Generate the **mountains** sheet first. Iterate until you love it.
2. For every other sheet, attach that approved sheet as a **style reference** and add:
   *"Match the exact art style, line weight, colour palette and lighting of the attached reference sheet."*
3. Ask for one category per sheet (a whole sheet in one generation stays consistent; separate generations drift).
4. Save each result as PNG into `original_data/symbols/` (e.g. `mountains.png`).

## Shared style brief (paste at the start of every prompt)

> Hand-inked fantasy map symbols in the style of a classic hand-drawn fantasy atlas (think Wonderdraft /
> Campaign Cartographer default symbols). Bold dark-brown ink outlines (#3b2f22) of even weight, flat watercolour
> fill in muted earthy tones, subtle cel shading on the right side of each shape only, light coming from the
> upper left. Oblique three-quarter map view. No cast shadows on the ground. No text, no labels, no frames, no
> grid lines, no border.
>
> **Background: one perfectly flat, solid magenta (#FF00FF) fill, edge to edge. No gradient, no texture, no
> vignette, no floor, no shadow beneath the symbols, no checkerboard.** Never use magenta, pink or purple inside
> the symbols themselves.
>
> Lay the symbols out as an evenly spaced grid, with a wide empty magenta margin (at least 15% of a symbol's
> width) between every symbol so none touch or overlap. Each symbol is a single separate object, fully visible,
> centred in its own cell. All symbols in the sheet are drawn at the same scale unless noted.

## Sheet prompts (append to the brief)

**Mountains** (`mountains.png`)
> A sheet of 12 different single mountain peaks and small ridges in a 4×3 grid. Mix of tall sharp peaks, rounded
> old peaks, and double-peak ridges. Snow caps on about half of them. Grey-brown rock, white snow.

**Hills** (`hills.png`)
> A sheet of 8 different rolling hill symbols in a 4×2 grid: low rounded green-tan mounds, some with a few tufts
> of grass, one or two with a small rocky outcrop.

**Deciduous trees** (`trees.png`)
> A sheet of 16 different single broad-leaf trees in a 4×4 grid, drawn as compact round-crowned map trees with a
> short visible trunk. Vary crown shape and height slightly. Green palette with a few olive and autumn-tinged
> trees.

**Conifers** (`pines.png`)
> A sheet of 16 different single pine/fir trees in a 4×4 grid. Dark blue-green, varied heights and widths.

**Marsh** (`marsh.png`)
> A sheet of 8 different marsh/swamp tufts in a 4×2 grid: clumps of reeds and cattails over a small patch of
> blue-green water, some with lily pads.

**Desert** (`desert.png`)
> A sheet of 8 different desert symbols in a 4×2 grid: sand dunes with crest lines, a couple with a lone cactus
> or dry shrub. Warm sand yellow and ochre.

**Settlements** (`settlements.png`) — **keep this exact order, left to right, top to bottom** (the processor names
them in this order)
> A sheet of 12 different settlement symbols in a 4×3 grid, each a small cluster of buildings seen from an
> oblique angle, in increasing size: 1 hamlet (2–3 huts), 2 village (about 6 houses), 3 town (a walled cluster
> with a church tower), 4 large city (dense roofs, tall walls, many towers), 5 capital (city with a big palace
> and spires), 6 port town (houses by a pier with a small ship), 7 castle (keep with four towers), 8 fortress
> (low thick walls, flag), 9 lone watchtower, 10 temple (columned building), 11 mine entrance (cave mouth with
> timber frame and cart), 12 ruins (broken walls and a fallen column).

## Turning sheets into map symbols

```bash
cd tools
node process_sheet.mjs ../original_data/symbols/mountains.png mtn
node process_sheet.mjs ../original_data/symbols/hills.png hill
node process_sheet.mjs ../original_data/symbols/trees.png tree
node process_sheet.mjs ../original_data/symbols/pines.png tree --append   # adds to the same tree set
node process_sheet.mjs ../original_data/symbols/marsh.png marsh
node process_sheet.mjs ../original_data/symbols/settlements.png poi --names hamlet,village,town,city,capital,port,castle,fort,tower,temple,mine,ruin
```

The script removes the magenta, slices each symbol, trims it, sizes it, and writes the PNGs plus a manifest into
`atlas/symbols/`. Reload the atlas and any category that has PNGs uses them; categories without PNGs keep the
code-drawn symbols.

Options: `--key #RRGGBB` if the model used a different flat colour, `--size 128` for the longest side in pixels,
`--tolerance 90` if the background isn't perfectly flat, `--debug` to also write the keyed sheet.
