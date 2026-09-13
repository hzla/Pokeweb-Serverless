# PWAN battle sprites

Status: **source-copied**.

Bundled artifacts: `PokewebPwanBattleB2.dll`, `PokewebPwanBattleW2.dll`.

Sources are grouped by DLL family. Shared implementation files are deliberately copied into each family. B2 build-time address substitutions remain in the canonical build recipe; these copies are not an independent build tree.

These are bookkeeping copies only. Existing source/build locations remain authoritative. Shared headers and metadata are in [../shared](../shared/). See the root manifest for file hashes and repo-relative origins.

## Original source references

- `White2Upgrade-Original-pokeweb: src/pwan_animation/w2u_pwan_frame_scratch.cpp`
- `White2Upgrade-Original-pokeweb: src/pwan_animation/w2u_pwan_archive.cpp`
- `White2Upgrade-Original-pokeweb: src/pwan_animation/w2u_battle_anim.cpp`
- `White2Upgrade-Original-pokeweb: src/pwan_animation/w2u_battle_hooks.s`
- `White2Upgrade-Original-pokeweb: src/pwan_animation/b2_battle_hooks.s`
- `White2Upgrade-Original-pokeweb: src/pwan_animation/pwan_types.h`
- `White2Upgrade-Original-pokeweb: src/pwan_animation/w2u_pwan_archive.h`
