# Custom UI editor and native Learnset adapter

The first installable adapter imports the current read-only LEARNSET viewer. It reuses its native move-tutor host, controls, glyphs, palettes, icons, and resource lifecycle. It is not a generic converter for arbitrary game screens.

## Use it

1. Load a supported English White 2 or Black 2 ROM in Pokeweb. Include Personal Data, Moves, Learnsets, Evolutions, and message text for useful preview data.
2. Open **More → Custom UI → Import native UI → Use complete Learnset screen**.
3. Select a named region in the component list. Optional upper regions can be shown or hidden. Native geometry is locked.
4. In the **Configure Accessibility** panel to the right of the previews, enable **Party menu command**, keep its label **Custom UI**, and assign the Learnset screen. Leave the overworld access methods disabled for this native adapter.
5. Choose **Enable in ROM**, then export a separately named ROM. Open **CUSTOM UI** from an eligible Pokémon's overworld party command menu.
6. Use **Apply Changes** for subsequent edits. **Disable** removes the custom launch command while retaining the editable design.

The original LEARNSET command remains available if it was already installed. Both commands share a registration path. Existing commands and Cancel retain their slots; CUSTOM UI is omitted if the native menu has no legal capacity. Installing the adapter alone does not enable a redundant LEARNSET command.

## Native regions

| Region | Supported customization |
| --- | --- |
| Background and panels | Required; native artwork and placement |
| Species header and types | Show/hide |
| Base stats | Show/hide |
| Evolution family | Show/hide; existing animation and navigation |
| Abilities | Show/hide |
| Evolution requirements | Show/hide; existing A-button paging |
| Lower move list, details, Exit | Required; existing read-only controls |

**Live regions** include behavior and resource ownership. Importing only their pixels would produce artwork without scrolling, selection, touch handling, or data updates. New adapters must describe these dependencies explicitly. Learnset regions retain their native geometry. Custom components can be layered over them in the browser preview; installing those overlays into the native host is not implemented. Summary pages additionally have a layout-authoring catalog, described below.

## Editor and preview

The editor also provides freeform panels, text, images, Pokémon icons, buttons, and lists; dual 256×192 canvases; drag/resize; numeric properties; snapping; alignment; layering; multi-selection; duplication; keyboard nudging; and undo/redo. A completed drag is one transaction. These freeform designs can be edited and previewed but **cannot currently be installed as native screens**.

With **Interactable** off, the previews edit the document. The **Interactable** switch above the previews enables simulation of bottom-screen touch and buttons: arrows, Enter/Z for A, Escape/X for B, Q/W for L/R. Empty/full/long/egg fixtures and sample JSON support preview experiments. Summary and learnset actions in freeform preview are simulations, not implemented native handoffs.

The lower-screen preview decodes the loaded ROM’s tutor type/category icons, animated selection cursor, footer controls, font glyphs, and font palette. Text uses the native window origins, 16-pixel line spacing, dark detail/PP colors, white move labels, and authored glyph shadows. The level/name label follows the installed viewer’s measured truncation rule. Native cell origins and tile mapping are preserved, including the final row/column of each sprite.

The upper panel remains a layout reconstruction. Browser captures and graphics estimates are not proof of whole-game behavior or allocations. The installed full preset calls the current native renderer directly. Runtime parity is checked separately in the isolated ARM harness; see [validation](VALIDATION.md).

## Access settings

The **Configure Accessibility** panel stays below the properties card on the right. Assign destinations independently, then choose **Save accessibility**:

- **Overworld key combination:** choose 2–4 DS buttons. Reserved reset and opposite D-pad combinations are rejected. The intended trigger is a newly completed chord while overworld input is available.
- **Party menu command:** choose the destination and command label. The installed Learnset adapter currently supports its existing **Custom UI** label only.
- **Overworld touch button:** set the label, rectangle and colors, drag it on the 256×192 placement guide, and choose whether it is available with C-Gear off. The guide is not a C-Gear screenshot. A future native launcher must consume only its own hit region.

All three configurations are saved in bundles and autosave. Saving accessibility is one undoable change. Unsaved settings remain in the panel when selecting components or changing screens; **Reset changes** restores the saved settings. **Key and C-Gear launchers are authoring-only: their native hooks are not implemented.** Enable/Apply is disabled with an explanation when the design exceeds the installed adapter's capabilities. These settings never silently install as no-ops.

The optional `access` object extends version 1. Old `launchers` assignments still load. Saving accessibility synchronizes the party assignment and replaces the obsolete field-menu assignment. Deleting a destination clears its access references.

## Summary layout authoring

Under **Existing game screens**, choose **Information**, **Stats & ability**, **Move details**, or **Ribbons**. Each is a single native-page layout, with the two physical screens shown together. The existing Summary action remains its entry point; Summary layouts cannot be assigned as custom launcher destinations.

- Select native elements in the list or canvas. Edit x/y/width/height, drag, resize, hide, lock, or **Reset native layout**. Background artwork stays at native size. Width and height define a content region; glyphs are not stretched.
- Choose **Add to: Top / Bottom**, or click **Add to bottom** above its canvas, then add an overlay component. The insertion target also follows the last canvas clicked.
- **Add EV values** and **Add IV values** create six selected, editable text components. Position them as a group or edit them individually. Each binding is also available in any text component's binding picker.
- Bindings `pokemon.ev.{hp,attack,defense,spAttack,spDefense,speed}`, `pokemon.iv.*`, `pokemon.stat.*`, and `pokemon.ev.total` use the selected preview Pokémon. Unknown values and egg stats are blank, not fabricated zeroes. Fixtures include example EVs/IVs; **Edit sample JSON** changes them.
- Turn on **Interactable** to animate the native background grid up and left, one pixel every four frames. Panels use the DS's RGB555 blend coefficients (13/16 foreground, 16/16 background); text and sprites stay fixed. Edit mode holds the background still.
- The preview decodes the Summary backgrounds, move plates, type/category icons, HP gauge, Poké Ball, markings, footer controls, native glyphs and font palettes. Stat labels use the nature's red/blue shadows. Ability descriptions come from the loaded ROM; nickname, level and held-item windows use their native positions.
- Pokémon use a **static front sprite**, with form/gender/shiny selection where the ROM provides it. Supported custom front-sprite overrides use their first frame. Preview Pokémon can specify `gender`, `ball` (native artwork index, default 3 for Poké Ball), `markings`, `maxPp` on each move, `abilityDescription`, `speciesName`, `dexNumber`, and `experienceProgress` (0–1). Sample stats and PP are editable example data, not an emulated save.
- Untouched regions in older Summary documents migrate to corrected defaults; manually changed rectangles, IDs, visibility and overlays are preserved. **Reset native layout** restores a selected region to the current baseline.
- Ribbon actors, Egg artwork, live 3D sprite/shadow effects and native Summary navigation remain outside this preview. Ribbon labels/outlines are editor guides. This is not a claim of complete native-screen parity.

**Summary changes are not installable yet.** English binary layout hooks, dynamic overlay allocation/rendering, native lifecycle integration, and coexistence with existing Summary companions still need implementation and verification. No Summary ARM code is changed by these authoring controls.

## Editing controls

Shift-click for multiple selections; drag the lower-right handle to resize. Arrow keys nudge, Shift moves eight pixels, Ctrl/Cmd+A selects movable elements on the active physical screen, Ctrl/Cmd+D duplicates, and Ctrl/Cmd+Z undoes. Duplication remaps internal list/focus links. Locked items are protected from canvas/keyboard movement, resizing and deletion; numeric properties remain directly editable. Multi-selected custom elements can be transferred between screens. Button state colors, explicit focus neighbors, text case, list columns, data meters, transparent fills, PNGs and native icons are available in Properties.

The preview includes clickable D-pad/A/B/L/R controls, selectable sample Pokémon, and a selected-move picker for Summary details. Only the bottom canvas receives simulated touch.

## Source and compiled data

- `ProjectState.customUi` contains a version-1 data-only document, imported PNG bytes, and installation metadata.
- Autosave preserves the document. Selection, zoom, and undo history stay outside exported game data.
- Bundle exchange is available through the shared CLI; the graphical editor does not expose bundle import/export buttons. A `.pwui.zip` contains `project.json` and declared `assets/*.png` files. ZIP timestamps are fixed for stable hashes. There is no executable user code.
- [project.schema.json](project.schema.json) describes authoring structure. Shared `validate` also checks bounds, references, limits, and supported values.
- `pokeweb/custom-ui.narc` stores an ownership header, source bundle, native program, and compiled preview resources. Source changes exported without Apply retain the last applied runtime program.
- Reopening an exported ROM recovers the source design. Disabling retains that source.

The native program is currently a bounded 32-byte `PWUN` record: ABI 1, adapter 1, byte length, and upper-region visibility mask. It owns no new dynamic graphics buffers and delegates lifecycle/input/rendering to the shared LEARNSET companion. Ordinary visibility edits change archive data without rebuilding ARM code. The runtime reads only its small program; source metadata and preview graphics are not loaded into its heap. A malformed or missing program falls back to the complete existing native viewer.

Installation stages text, module, and archive changes in an isolated project copy. Validation or staging failure leaves the working installation intact. Known shared party hooks are coordinated; unknown modifications at the verified hooks are rejected. Compatible hacks must retain the supported hook signatures and asset/data conventions. This is not blanket compatibility with every hack.

## Shared interfaces and CLI

Canonical implementation: `src/customUi`, `src/pokeweb/customUiModel.ts`, `src/ui/customUiEditor.ts`, and `runtime/learnset-viewer`.

`validate(document)`, `compile(document, assets)`, and `preview(compilation, assets, data, interaction)` are shared by editor and CLI. `compileLearnsetNative(document)` is the separate native capability check. A valid preview compilation does not imply native installability. Generic resource budgets are estimates, not a native allocation guarantee.

```sh
npm run customui -- learnset-template --out design.pwui.zip
npm run customui -- summary-template --out summary-layouts.pwui.zip
npm run customui -- validate design.pwui.zip
npm run customui -- unpack design.pwui.zip --out design
npm run customui -- pack design/project.json --out revised.pwui.zip
npm run customui -- compile-native design.pwui.zip --rom game.nds --out compiled
npm run customui -- preview design.pwui.zip --rom game.nds --out preview --fixture full
```

`compile` packages preview resources and reports `nativeInstallable`; `compile-native` fails unless the design has a supported native adapter. Neither CLI command installs a ROM. Installation uses the editor. The [native preset bundle](learnset-native.pwui.zip) contains references and metadata, with no game artwork.

## Remaining original-plan work

The full graphical-editor release is not complete. Remaining work includes the overworld key/C-Gear launchers, a general native component renderer, runtime support for movable/composable live regions and Summary layouts, native read-only summary handoff, exact browser/native preview parity, and the broader compatibility/resource/edge-case acceptance matrix. `runtime/custom-ui/lifecycle.h` is an unwired contract experiment; it is not the installed runtime.
