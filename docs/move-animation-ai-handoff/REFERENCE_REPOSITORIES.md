# Reference Repositories

The bundle is intentionally small. Use this list to reconstruct the surrounding
workspace when another developer needs to build or deeply debug an animation.

## Required

### Pokeweb Serverless

- URL: `https://github.com/hzla/Pokeweb-Serverless.git`
- Audited commit: `08fd839d0bf2d1787956104cb868ee0536d2460f`
- Purpose: move script compiler/decompiler, SPA parser/editor, browser preview,
  donor index, staging workflow, and built-ROM verification.

Privacy-sanitized archives replace the account component of this URL with
`PROJECT_OWNER`. The sender should provide the correct repository URL through
the team's normal access channel.

The handoff archive includes a curated snapshot of relevant files, including
changes newer than the audited commit. Use the complete repository for running
the tools.

### White2Upgrade Project Snapshot

- Public upstream: `https://github.com/ds-pokemon-hacking/White2Upgrade.git`
- Local base commit when audited: `c730d7cebaf353f14a7ed0feaae25dc4105f9852`
- Local branch when audited: `pokeweb-migration`
- Purpose: stages animation member `a/0/6/5`, SPA member `a/0/0/6`, applies
  expanded-move routing, and builds the test ROM.

The audited branch does not track a public remote and contains substantial
working-tree changes. A collaborator needs a project-owned branch, Git bundle,
or source snapshot of that exact build repository. Cloning public upstream is
not sufficient to reproduce the current ROM.

### Clean White 2 ROM

- Expected game: US Pokemon White 2 (`IRDO`)
- SHA-256 used by the build documentation:
  `3e50aec3db401332175a5d2b5fe2a68ac1a05ec63995dba9d1506b1b51837446`

This is a user-supplied prerequisite, not a repository, and must never be added
to the handoff archive.

## Included As A Curated Excerpt

### Swan Move-Effect Runtime

- Related public headers/symbols: `https://github.com/ds-pokemon-hacking/swan.git`
- Public repository commit when audited:
  `4324f73a7659353a21bf4c523905c5d09cf6a066`
- Local excerpt source: `reference_repos/swan_export`
- Purpose: retail VM command behavior, selectors, task completion, camera and
  sprite cleanup, emitter positioning, and hardware/runtime limits.

The public Swan repository contains interface headers and symbol databases but
not the full `btlv_effvm.c` behavior used for preview parity investigations.
The handoff therefore includes only the relevant local source files. The full
Swan export is not required.

## Optional

### nitroefx

- URL: `https://github.com/Fexty12573/nitroefx.git`
- Audited commit: `debccaf9caba9aa6593870796b699a46a3e318ec`
- Use: independent visual inspection of Nintendo DS particle files.

### DeSmuME

- URL: `https://github.com/TASEmulators/desmume.git`
- Audited commit: `e96b11fa27b36f6f4dabdbf405fcc7f38db8bd9f`
- Use: renderer behavior and emulator-side debugging when browser output differs
  from the game.

### NitroPaint

- URL: `https://github.com/Garhoogin/NitroPaint.git`
- Audited commit: `fca031fabf62ad0002866b098cdc7bdfb9f75179`
- Use: DS texture, palette, background, and tiled graphics inspection.

### CTRMap Community Edition

- URL: `https://github.com/kingdom-of-ds-hacking/CTRMap-CE.git`
- Use: White2Upgrade VFS/build preparation and broader Gen 5 ROM inspection.

Clone optional repositories only for a problem that needs them. They are not
part of the normal donor-edit-preview-stage-build loop.
