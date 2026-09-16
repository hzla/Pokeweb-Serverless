# Static BW2 building GLB import

## Workflow

1. Open **Maps → Buildings**, select a static building, and choose **Export for Blender (.glb)**. Export a fresh file: earlier exports lack the required import metadata.
2. In Blender, import the GLB and edit the mesh. Keep its original materials and vertex colors. One Blender unit represents one map tile (16 native units).
3. Export as GLB with **Include → Custom Properties** enabled, normals and color attributes included, and animations disabled. Keep the complete building scene; compression and external buffers are unsupported.
4. Select the same building in Pokeweb and choose **Import edited GLB**. Review **Show original / Show converted**. The converted preview decodes the newly written NSBMD.
5. Choose **Apply building import**. Map previews and ROM export now use the replacement. **Undo last import** restores the previous model while this editor remains open.
6. Export the ROM normally or use **Test ROM in game** to open the existing emulator with the current project and the Aspertia test save. In-game verification is performed by the user.

## Supported scope

- BW2, single-model static buildings; geometry, topology, UVs, vertex colors, and object transforms.
- Existing native materials, textures, hidden shadow geometry, metadata, doors, and collision are retained. GLB image and shader edits are not imported.
- Resource identity and a source hash prevent applying a file to the wrong or subsequently changed building.
- Replacing a resource affects every placement using that entry in that bundle. Copies in other bundles are separate.
- Unsupported animation, skinning, billboards, generated texture coordinates, and malformed geometry fail before project data is changed.
- The compiler caps each building at 2,048 native polygons and 6,144 submitted vertices, including preserved shadows. Compatible planar triangle pairs are reconstructed as quads. These are hardware ceilings, not a guarantee that the complete map fits its shared geometry budget. Keep edits close to the original complexity.
- The writer can produce larger models than the original converter. [Full map import](map-glb-import.md) is also available. New materials/textures, animation, collision editing, and further converter optimization remain future work.

No proprietary converter executable is required. Conversion runs in the browser, using the original model as a material/template source.

## Validation and local test asset

Automated coverage checks transform handling, malformed input, material/shadow preservation, archive member preservation, preview cache refresh, ROM export/reload, stale imports, and undo. An actual Blender edit was converted and parsed by both Pokeweb and local Apicula.

The local proof uses White 2 exterior bundle **52**, resource **29**, UID **305**, `c12_house_01`: the green-roof house in Aspertia. The upper story/roof was stretched upward in Blender, with visible triangle count unchanged at 170. It is shared by three Aspertia placements. Files are outside the application repository under `../tmp/building-import-proof/`: `edited-house.blend`, `edited.glb`, `converted.nsbmd`, and `building-import-proof.nds`. ROMs and extracted game assets must remain uncommitted.

The user confirmed that the pink building test worked in-game. Further emulator testing is left to the user.

A follow-up `pink-house-test.nds` / `pink-house.glb` uses magenta vertex colors on the same house for an obvious visual check. The converted colors survive ROM export/reload. The user's Aspertia savestate contains the first converted house (maximum native Y 129.265625, versus 87.796875 originally), confirming that model was loaded. Boot the pink ROM normally with an in-game save: the earlier emulator savestate contains the previous model in RAM.
