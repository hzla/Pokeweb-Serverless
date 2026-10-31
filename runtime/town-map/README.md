# BW2 Town Map

Open **Maps → Town Map** on a US revision-0 Black 2 or White 2 ROM. Choose **Areas** in the map toolbar to select an area on the map, or use the table. **Handles** toggles editor overlays; turning it off returns to artwork selection. The editor starts with artwork selection and handles hidden. Marker, cursor and capsule endpoints move together by default; choose a different move target to edit them independently. Habitat coordinates are independent. The inspector edits the map header, type, conditions, descriptions and six landmark lines. Shared text is copied when edited unless **Edit shared text** is checked.

The editor keeps a draft with undo/redo. **Apply** validates and stages the complete change before publishing it to the project. Save the project and export its ROM normally. New areas use existing valid map headers; original record indices remain stable. Appended records can be removed, and existing areas can be disabled. Black City and White Forest must remain an adjacent pair.

**Fly Destinations** remains a separate page under **Headers & Overworlds**, with links from Headers and Town Map. It controls eligibility, visit flags and landing overrides. Route 4 and Join Avenue have independent overrides. Grid positions use signed 16-bit X/Y/Z; rail destinations use component, position and side offset. The destination preview shows spring terrain and does not validate collision, height or rail points. Test arrivals in-game.

## Artwork

The native layers are 256 × 256 pixels. PNG/BMP imports show a conversion preview, tile usage and changed pixels before acceptance. Conversion uses the existing palette; edit palette colors separately. Export each layer or the composite as PNG. Tile placement, fill, flips, pixels, palettes and existing animation frame cells/timing are editable. Map layers share their extended palette; changing a shared color affects both. Transparent index zero, palette banks, source compression types and untouched resources are retained.

Choose **Select** in the map toolbar to drag a rectangular selection directly on the assembled map. Drag inside it to move the art, or **Copy → Paste** to place a copy. **Active layer / Both map layers** chooses the scope; **Snap 8 px** aligns selections and moves to tile boundaries. **Move area handles** also moves the marker, cursor and touch region of areas whose marker or cursor lies inside the selection. Habitat positions remain independent. Copies contain artwork only. Layer and Zoom use active-state buttons.

The toolbar provides Areas (V), Select (S), Pencil (B), Fill (F) and Picker (I); its buttons show the active tool. With the canvas or toolbar focused, these letter keys switch tools. With the canvas focused, use **Ctrl/Cmd+C**, **Ctrl/Cmd+V**, **Enter** to place a paste, **Esc** to cancel/deselect, **Delete** to clear selected art, and arrow keys to move selections (Shift moves 8 pixels). Artwork and linked handles undo/redo together. A move clears its source to transparency; pastes preserve destination pixels under transparent clipboard pixels. Shared tiles are isolated as needed. Edits exceeding tile capacity or combining colors that cannot share a native palette bank are rejected together; tile-aligned placement avoids many such palette conflicts.

The front layer supports 256 tiles, the back layer 768 and the information background 1024. These limits accommodate the Pokédex renderer as well as the main map. Marker and habitat tilesets keep their native dimensions. Cell and animation resources must each fit 8 KiB. Apply checks referenced tiles, cells, animations and palettes, actor and sprite budgets, and a conservative 384 KiB main-map heap budget. The 128-record limit does not provide 128 simultaneous visible markers.

## Runtime and formats

Areas are 27 little-endian 16-bit words in `a/0/8/5`, member 0; habitat X/Y are signed. Graphics use `a/0/8/4`, and habitat shapes use `a/1/5/7`. Descriptions and landmarks use system text bank 377. Words 13/14 remain raw values; their interpretation is uncertain. Conditions 61440–61442 retain their native predicates; 61443 means disabled and requires the runtime. Ordinary saved flags are 1–3059; 65535 means no condition (and cannot unlock Fly).

Existing-record artwork, text and ordinary property edits work without installing this runtime. Expansion, changed header identities, disabled areas and custom Fly capabilities install one versioned `TownMapB2.dll` or `TownMapW2.dll`. Supported legacy Fly modules are migrated atomically, retaining their landing overrides. Unknown native bindings or conflicting hooks are rejected.

The runtime supports 85–128 records across the main map, Fly selection, species habitat map and the shared lookup used by beacon details. Species habitat members in `a/1/7/6` use a 128-place seasonal stride after installation. The original 85 habitat positions keep their native ordering; linked encounter pools supply additional/relinked areas. The habitat completion checklist and save format remain unchanged. The native Black City/White Forest predicate and Join Avenue information remain in use. New field maps, larger canvases and additional region pages are unsupported.

## Build

The adapter and generated runtime are GPL-3.0; see [LICENSE](LICENSE). They use the [public pokebw2 source](https://github.com/fuddlesworth/pokebw2) at commit `851ad6466bf44f7eb6a0323fd79f355ba77b8977`. Supply an unmodified checkout at that commit, clean local US revision-0 ROMs, Python with ndspy/pyelftools, GNU Arm Embedded GCC and Java/RPMTool. No ROMs are included or downloaded.

```sh
ARM_TOOLCHAIN_BIN=/path/to/arm-none-eabi/bin \
RPM_TOOL_JAR=/path/to/CTRMap.jar \
python3 runtime/town-map/build.py --source /path/to/pokebw2 \
  --black2 /path/to/black2.nds --white2 /path/to/white2.nds
```

The build generates both native modules and their checked binding contract. Generated inputs and diagnostics stay in the ignored `build/` directory. `runtime/town-map/verify-rom.ts` checks binary round trips, project persistence and ROM export/reimport against a supplied ROM. `runtime/town-map/emulator.ts` uses a copied bundled fixture to inspect native allocations and optional Fly arrivals; screenshots still need assessment. These checks do not establish every visibility predicate, special-location interaction or gameplay path. Use a fresh boot from an in-game save when testing exported resources; savestates can retain old code and data.
