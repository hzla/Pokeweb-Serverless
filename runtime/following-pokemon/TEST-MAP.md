# Following Pokémon test map

The profile build runs checks against a pinned clean ROM and the newly packaged modules. A passing CPU harness validates its modeled calls and memory, not rendered game behavior. See [validation](VALIDATION.md) for the latest recorded evidence and [human checklist](EMULATOR-CHECKLIST.md) for visual acceptance.

| Scope | Automatic build gates | Additional manual command |
|---|---|---|
| All four profiles | Exact binary contract, base and full DLL packaging/imports, module instruction/relocation checks (`verify_packaged.py`), Options hook-site and packaged menu checks (`verify_options.py`), variant hook sets, hook anchors (`verify_anchor.py`), bundle size and manifest checks | `npm run following:test` for Pokeweb installer/model tests; `npx vite-node scripts/verify-following-variants.ts CLEAN_ROM [PREVIOUS_FULL_ROM]` for base/full install, conversion, export/reopen, Options text ownership, and asset stripping |
| Stock White 2 | `verify_continuity.py` (including scene callback hold), `verify_render.py`, `verify_surf.py`, `verify_effects.py`, `verify_land.py`, `verify_land_draw.py`, `verify_positioning.py`, `verify_land_input.py`, `verify_cycle.py` (including movement hold), `verify_transition.py` | `verify_registry_stream.py ROM` for ROM-backed cache/FS cases; focused `verify_*.py` scripts as needed |
| Black 2 | `verify_profile_runtime.py black2 ROM` runs shared Surf, scene, render/lighting, land input/draw, transition, L/R cycle/input hold, positioning, and ambient terrain harnesses with Black 2 bindings | `verify_black2_mount_binary.py` and targeted port diagnostics as needed |
| Italian White 2 | `verify_profile_runtime.py white2italy ROM` runs the same harnesses with Italian bindings and localized data | Italian dialogue, accents, and native scene checks in [Italian checklist](ITALY-CHECKLIST.md) |
| White2Upgrade | `verify_interactions.py`, `verify_render.py`, `verify_surf_upgrade.py`, `verify_scenes.py`, `verify_land_input.py`, `verify_land_draw.py`, `verify_transition.py`, `verify_cycle.py`, `verify_positioning.py`, and `verify_ambient.py` | `verify_registry_stream.py --profile white2upgrade ROM` for expanded species and stream validation; [Upgrade checklist](WHITE2UPGRADE-CHECKLIST.md) |
| Web application | `npm test`, `npm run build` | Install, update, disable, removal, export/reopen with an audited revision-0 ROM, including a data-edited ROM |

The installer checks PMC boot/import signatures when adding PMC to an uninstalled ROM. Regenerate the US signature manifest only from pinned clean ROMs with `python3 runtime/following-pokemon/generate_bw2_pmc_contract.py CLEAN_W2.nds CLEAN_B2.nds`; this manifest is a compatibility reference, not a whole-ROM eligibility check.

`npm run following:build-rom -- ROM` makes a manual test ROM in the external local archive and delivers a versioned alpha copy to `Repos/`. It does not start an emulator. Human cases must cold boot the matching ordinary save; older states retain old loaded code. The emulator harness is opt-in and is not part of this cleanup's checks.
