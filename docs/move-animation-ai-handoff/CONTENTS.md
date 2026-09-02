# Bundle Contents

## Workflow Documentation

- The workflow review and reusable fresh-task prompt.
- The tooling-improvement roadmap, including archive policy.
- Pokeweb's move-animation editor orientation, workflow guides, script/SPA
  boundary guide, command reference, and particle-field reference.
- White2Upgrade's move-animation and SPA ownership ledgers, build guide, and
  migration notes.

## General Tooling

- `move-animation-helper.ts`: extract, decompile, compile, and append SPA data.
- `move-animation-index.ts`: build donor, background, and SPA indexes.
- `move-animation-workflow.ts`: brief, SPA allocation, staging, built-ROM
  verification, and active-workspace scaffolding.
- `enable-test-battle-move-animations.ts`: enables animations in test-battle
  saves.
- `generate-white2upgrade-gen6-animation-bundle.ts` and
  `verify-move-expansion-install.ts`: package and verify expanded-move assets.
- Core move script, SPA parser, semantic alias, diagnostics, camera, sprite, and
  particle-preview source files plus focused tests.

These files expect the rest of a full Pokeweb checkout. They are included so an
agent can inspect the exact implementation and overlay changed copies, not to
form an independent npm project.

## Searchable References

- The generated move, SPA, and background reference JSON/Markdown files.
- The concise legacy Move Animation Preview Reference Markdown document.
- White2Upgrade routing and staging files that explain where built assets go.

## Swan Excerpt

Only the following behavioral surface is included:

- Generic VM execution structures and command-result behavior.
- The battle move-effect VM dispatcher and all command handlers.
- Camera, sprite, background, sound, wait, and particle helper code used by the
  dispatcher.
- Command constants, selector values, limits, and generated SPA/background IDs.
- SPL particle and emitter structure definitions needed to understand SPA
  fields and runtime limits.

The excerpt preserves paths below `swan-export/` but omits unrelated game code,
assets, SDKs, tools, and build outputs. It is intended for source reading only
and will not compile independently.

## Deliberate Exclusions

- Clean or patched ROMs and emulator save states.
- Generated move animation and SPA binaries.
- `work/<slug>/`, donor extracts, and per-move generators or inspectors.
- `node_modules`, build directories, browser assets, and toolchains.
- The complete 3 GB Swan source export.
- Unrelated Gen 4, Pokemon sprite, terrain, editor, and gameplay repositories.
