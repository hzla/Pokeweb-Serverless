# Black2Upgrade field companion

Status: **source-copied**.

Bundled artifacts: `Black2UpgradeField.dll`.

This is a separate bundled companion, not the excluded Black2Upgrade.dll monolith. It imports core helpers from that monolith. Original hook inputs and generated B2 assembly are both retained; no ELF/DLL build outputs are copied.

These are bookkeeping copies only. Existing source/build locations remain authoritative. Shared headers and metadata are in [../shared](../shared/). See the root manifest for file hashes and repo-relative origins.

## Original source references

- `White2Upgrade-Original-pokeweb: src/black2upgrade_metadata.cpp`
- `White2Upgrade-Original-pokeweb: src/pokeweb_gameplay/w2u_field_items.cpp`
- `White2Upgrade-Original-pokeweb: src/pokeweb_gameplay/w2u_field_item_hooks.s`
- `White2Upgrade-Original-pokeweb: build-stripped/src/b2u_field_hooks.s`
