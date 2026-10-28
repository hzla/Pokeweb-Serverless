# Local Map Studio

**Maps → Map Studio** is available only when Pokeweb runs on `localhost`, `127.0.0.1`, or IPv6 loopback. Hosted deployments hide the menu and reject the route.

The workspace follows PDSMS's control arrangement with Pokeweb styling: layers and editing tools on the left, the terrain viewport in the center, and heights, tile palette, and matrix controls on the right. Toolbar icons are original inline SVGs.

## Open, edit, and save

Choose **Open folder** for a PDSMS project directory, or open a ZIP containing one `.pdsmap`, its `.pdsts` tileset, texture images, and sidecars. Multiple selected files also work when their names resolve unambiguously. Project references resolve exclusively against selected files; the editor does not fetch texture URLs.

Gen 4 and Gen 5 authoring projects can be loaded. All nine tile and height layers, chunk coordinates, area/export-group metadata, original tileset bytes, images, and ancillary files are retained.

- **Paint (B)** places the selected tile and height. **Erase (E)** removes it. **Bucket (F)** fills connected cells with the same tile and height.
- **Pick (I)** selects an existing tile and height. **Height (H)** changes the elevation of painted cells. The Z rail or numeric field sets the brush height; brackets adjust it by one.
- Each pointer stroke is one undo command. Use Ctrl/Command Z and Ctrl/Command Shift Z, or the toolbar.
- Layer checkboxes control visibility; the neighboring layer buttons select the editing layer. Middle drag pans, right drag rotates, and scrolling zooms.
- Search filters the entire tile library. Large palettes display tiles in batches, with thumbnails generated only for visible entries.

**Save project bundle** downloads a ZIP containing the updated PDSMAP and unchanged source assets. Extract the bundle to open it in desktop PDSMS. **Save PDSMAP only** downloads the map grids separately. Browser drafts use a separate Map Studio database; they are not embedded in the ROM project's ordinary autosave.

## Insert into a Gen 5 ROM

1. Load a Black/White or Black 2/White 2 ROM in Pokeweb and open the authoring project.
2. Select the source chunk. Its project game must match the ROM family.
3. Choose **Insert selected chunk into ROM**, then choose a destination header, matrix cell, and season.
4. Choose a walking-height source. A terrain layer generates native slopes/heights and blocks uncovered cells. A valid project Gen 5 PER can instead be retained. Existing PER terrain classes and flags are preserved when regenerating heights.
5. Review, then **Apply to ROM**. Export the ROM normally. **Undo ROM insertion** is available until dependent resources change.

Replacing a populated cell isolates the chosen season from other uses of its original map. New cells are added in every season. The importer requires an existing matrix and header; use the matrix editor to resize or create layouts first.

Native models and texture resources are generated in the browser without an external SDK executable. Texture images used for insertion must currently be PNGs with power-of-two dimensions from 8 to 1024. Unsupported generated UV modes, invalid drawn UVs, unrepresentable walking surfaces, and native geometry/texture limits block insertion with a diagnostic. The native compiler does not currently merge repeated tiles as extensively as desktop PDSMS.

Opening a Gen 4 project does not automatically convert its gameplay sidecars. To use its terrain in Gen 5, explicitly change the project game and generate walking heights from a suitable terrain layer. Gen 4 building, sound, camera, and collision sidecars remain archived; NPCs, scripts, warps, and other gameplay resources are not converted by Map Studio.

## Performance and validation

Map Studio's UI and CSS are loaded only on entry. File parsing, ZIP creation, and native compilation use workers created on demand. Only the selected chunk is rendered; texture loading and thumbnail generation are lazy. Leaving the view terminates workers, stops scheduled rendering, removes listeners, and disposes GPU resources. Ordinary project saves do not traverse authoring data.

Verification includes format round trips, painting/height undo, native compilation, and ROM export/reload. A 297-chunk HGSS project with 9,527 tiles and 3,631 source files loaded in the browser and survived save/reopen checks. A generated White 2 terrain chunk also rendered beneath the player during an isolated emulator smoke run. These checks do not establish compatibility for every tile, walking surface, game revision, or map hardware budget.

Developer checks: `npm test -- src/test/mapStudio.test.ts`; `npx vite-node scripts/verify-map-studio.ts <local-gen5-rom>`; `npx vite-node scripts/verify-map-studio-emulator.ts <local-us-white2-rom> <temporary-output-directory>`. The verification scripts do not overwrite source ROMs or user saves.
