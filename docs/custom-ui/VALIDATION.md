# Custom UI native Learnset MVP validation

Date: 2026-09-29. Shared native companions: LEARNSET 1.5.0. Test ROMs: MVP 0.1.2.

This report separates automated CPU/browser checks from emulator acceptance. No emulator was run for this work. Original ROM files were read as inputs; no save files were modified.

## Automated checks

Focused test run: 54 tests passed (`customUi.test.ts`, `customUiNativePreview.test.ts`, and `learnsetViewerModel.test.ts`).

- Shared TypeScript tests cover document rejection, references/bounds, undo transactions, screen ID remapping, bundle/archive round trips, timestamp-independent ZIP bytes, RGB555/transparency/tile decoding, native glyph shadows, simulated navigation, empty/egg bindings, long lists, native-region compilation, geometry protection, unsupported launcher rejection, and preserving the applied program when saving a draft.
- Native preview regression checks ran against both local English retail ROMs: glyph foreground/shadow colors, three description lines, native row positions, category changes, complete icon cells, all cursor animation frames, footer placement, touch/button selection, scrolling, empty lists, measured ellipses, and archive metadata/resources. These ten tests use optional local ROM inputs (`CUSTOM_UI_W2_ROM` / `CUSTOM_UI_B2_ROM`); no retail assets are bundled with the tests.
- Browser verification of the corrected lower preview confirmed aligned text/icons and a touch-selected move updating the category, details, and native cursor. These are browser captures, not new emulator captures. The native runtime and previously delivered test ROMs were not changed for this preview correction.
- Existing LEARNSET module tests cover both game profiles and compatibility checks.
- `runtime/learnset-viewer/verify_runtime.py` passed for W2 and B2: hook register/stack preservation, shared command registration/capacity, custom request dispatch, read-only guards, request ownership, return path, navigation, and failure paths.
- `runtime/learnset-viewer/verify_info.py --custom-ui-only` passed for W2 and B2. For the species-30 fixture, the complete Custom UI preset produces byte-identical upper bitmap, tilemap, and palette to the ordinary current LEARNSET render. Visibility masks are exercised individually and together; animation ticks leave allocations stable; request bytes remain unchanged; end/double-end releases owned allocations. These are isolated CPU checks with game services stubbed, not whole-game captures.
- `scripts/verify-custom-ui-install.ts` passed on both clean English input ROMs: install, repeated Apply, changed region mask, failed staging preserving the prior installation, editable source recovery after ROM export/reload, disable after reload, unchanged native tutor artwork, and unchanged source hashes.
- White 2 additionally exercised Battle Log, Menu Evolution, and LEARNSET coexistence and a later LEARNSET install preserving CUSTOM UI. Black 2 companion coexistence was not exercised in this export run.
- Browser checks used a separate local development origin: More navigation, complete native import, region properties, visibility undo, enabling the native installation, and autosave recovery following development reload. Also verified Interact-mode keyboard B exit and disabling while retaining the design.
- CLI native-preset generation, validation, and native archive compilation passed.
- Production TypeScript/Vite build passed. Vite reports existing large output chunks.

## Input and output hashes

| File | SHA-256 |
| --- | --- |
| Clean White 2 input, IRDO | `3e50aec3db401332175a5d2b5fe2a68ac1a05ec63995dba9d1506b1b51837446` |
| Clean Black 2 input, IREO | `2e6b2415354aa41471bc7617068dce059a59931bf5c4348a264f8043f297683a` |
| White2-CustomUI-Learnset-MVP-0.1.2.nds | `205ccfbe309d33e0ed0ef1fc6debf3947b0aff8027e9fb4e411d06518bd4554f` |
| Black2-CustomUI-Learnset-MVP-0.1.2.nds | `7c5748bf6695e1d0a98cd7dcf1068acfe910a38f9c3afa6aa4da5a5939d7581b` |

Both separately named test ROMs are in the workspace's parent `Repos` directory. White 2 includes the companion patches listed above; Black 2 tests the adapter on the clean base. Use copies of saves for manual testing, and boot the new ROM normally rather than resuming a state made with another module layout.

## User emulator checklist — pending

- [ ] Both games: open CUSTOM UI from the overworld party menu for each eligible party slot.
- [ ] Compare the complete preset against the current LEARNSET viewer on both screens: font shadows, palettes, type icons, bars, evolution icons, description, and scroll controls.
- [ ] Test Up/Down move selection, touch selection/scroll/Exit, Left/Right party navigation, L/R evolution navigation, A requirement pages, and B return.
- [ ] Reopen repeatedly and check return destination/selection, flicker/corruption, and sustained memory behavior.
- [ ] Apply hidden upper regions and verify only those contents disappear; restore the full preset.
- [ ] Empty/short/long learnsets, long names, eggs, partial/full parties, added forms, and branching evolution families.
- [ ] Full native command menus preserve all existing commands and Cancel, omitting CUSTOM UI when no legal slot remains.
- [ ] Existing enhanced-party actions still work; normal tutor gameplay elsewhere remains unchanged.
- [ ] Disable, export, reload: the custom command is absent and the source design remains editable.

## Unmet full-release acceptance

Field launches, arbitrary authored native components, native summary round trips, arbitrary screen/chunk import, pixel-exact browser reconstruction, and the complete original compatibility matrix are not implemented or verified. The native Learnset adapter is the installable MVP; it does not satisfy the entire original generalized-editor release definition.

## Graphical authoring additions — 2026-09-29

This pass changes the editor, shared document/schema, browser/CLI preview, and authoring validation. It does not change the native runtime DLLs or produce new emulator-test ROMs. The 0.1.2 ROMs above still exercise the earlier Learnset adapter only.

- **74 focused tests passed:** `customUi.test.ts`, `customUiAuthoring.test.ts`, `customUiNativePreview.test.ts`, and `learnsetViewerModel.test.ts`.
- Access tests cover legacy-document loading, all three methods in bundle/archive round trips, one-transaction undo, detached draft ownership, deleted destinations, reserved/impossible chords, invalid rectangles, Summary destination rejection, input gating in the shared trigger contract, and native-install rejection for unsupported settings. Trigger-contract tests do not establish native launcher behavior.
- Summary tests decode the loaded English B2 and W2 backgrounds for Information, Stats, Move Details and Ribbons; compile resized native content regions; preview EV/IV overlays; and recover editable source from the private archive. The later Summary preview checks below cover the new static actors and background animation. Ribbon actors and native navigation remain unverified.
- Binding tests cover six EVs, six IVs, EV totals, zero-valued stats, missing values and eggs. These values come from preview fixtures, not a live emulated save.
- Graphical-operation tests cover native-window movement/resize/reset, locked selections, duplication with remapped control references, and reference cleanup when deleting components.
- Learnset preview regressions verify an authored lower-screen overlay renders above the native region, and moving it behind that region restores the original pixels, on both English ROMs.
- Browser checks on a separate local origin exercised direct bottom-screen insertion, enabling all three access methods, saving Access, undo/redo, opening a Summary page, resizing an existing window, adding an EV group, and autosave/reload.
- CLI `summary-template` and White 2 Summary preview generation passed. The generated source bundle contains metadata only; ROM artwork is resolved locally.
- Production TypeScript/Vite build passed with existing chunk-size/dynamic-import warnings. No emulator was run and no source ROM/save was written.

Pending native work remains: general component rendering, overworld input hooks, C-Gear button ownership/scheduling, Summary window-allocation/layout hooks, dynamic overlay lifecycle, existing Summary-patch coexistence, and full native entry/exit acceptance. Enable/Apply are unavailable for designs requiring those features.

## Summary preview fidelity — 2026-09-29

- Read the user-supplied Summary save state without running an emulator. Its Information-page top background was reconstructed from saved VRAM, palette, scroll and blend registers. The ROM-based preview at that scroll position matched all 49,152 background pixels. This comparison excludes text, sprites and transitions.
- Native Summary backgrounds remain separate compiled grid/panel/title resources. Automated checks cover one-pixel up-left movement every four frames, 256-pixel wrapping, RGB555 saturation/blending, glyph shadows, nature colors, ability descriptions and static sprite/actor pixels in English B2 and W2.
- First/last move plates retain their complete native cell bounds. The HP frame, type/category icons, nickname/gender/ball, level, held-item and footer resources use native origins. Static front sprites use the existing ROM sprite/form resolver; supported front overrides use their first frame.
- Fixed the move cards' missing right caps: the centered cell-decoding canvas now includes every OAM extent before cropping. English B2/W2 regressions compare the final eight columns of all four normal and selected cards with a larger reference render, including their placement in the finished preview. The regression failed before the correction; all 22 native-preview tests now pass.
- Regression checks cover preserving user-edited rectangles during migration, resource metadata in archive round trips, resized allocations and authored overlays. Tests also reject unknown layout versions.
- The isolated browser check opened a newly added Stats page, enabled Interactable, and inspected both physical screens with the scrolling grid, static Pokémon, nature shadows, ability description and native move plates.
- Focused Custom UI suites passed: 57 tests, including the local English B2/W2 asset checks. The production TypeScript/Vite build passed with the existing chunk-size and mixed-import warnings.
- No emulator testing or ROM/save writes were performed. Summary installation, ribbon actors, Egg artwork and live 3D sprite/shadow effects remain incomplete.
