# Battle Type Icons and Move Effectiveness Preview

Status: **source-copied**. Type Icons **0.3.9**, Move Effectiveness **0.4.0**;
Pokeweb HUD catalog **0.4.9**.

Bundled artifacts: `TypeIconsB2.dll`, `TypeIconsW2.dll`,
`MoveEffectivenessB2.dll`, and `MoveEffectivenessW2.dll`.

These are two independent overlay-168 patches sharing low-level drawing and
ROM compatibility helpers. The snapshot includes their runtime code, generated
address/hook headers, icon/panel data, build/validation tools, installer models,
installer manifests, and focused Pokeweb tests.

Canonical Pokeweb snapshot: `Pokeweb-Serverless: runtime/battle-type-hud/`,
synchronized from `Port-Pokeweb: work/battle-type-hud/` by its existing publisher.
See [runtime notes](runtime-notes.md) for implementation and verification.

These are bookkeeping copies, not build inputs. Copied scripts retain their
canonical relative imports and dependency requirements. Generated headers under
`build/` are source dependencies, not bundled build products. No DLLs, ROMs,
saves, screenshots, or captured-memory reports are copied here. Machine-local
paths in supporting test tools are replaced with `<LOCAL_PATH>`; no tools are
run during this refresh. File origins and hashes are in the root manifest.
