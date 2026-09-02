# AI Move Animation Handoff

This bundle gives another developer or AI agent the durable documentation,
general tooling, donor index, and retail-engine references used to author Gen 5
move animations for this project.

It intentionally excludes completed `work/<slug>/` generators and inspectors.
Those are move-specific history and should be consulted only when revisiting the
same move. It also excludes ROMs, generated move binaries, build outputs,
toolchains, and the full Swan source export.

## What The Recipient Needs

1. A clone of the Pokeweb repository listed in
   `REFERENCE_REPOSITORIES.md`.
2. The project's actual White2Upgrade build-repository snapshot. The public
   upstream repository alone does not contain the current unpublished
   `pokeweb-migration` state.
3. A legally obtained clean US Pokemon White 2 ROM. Never put it in this bundle
   or commit it.
4. Node.js and npm for Pokeweb, plus the Java, Meson, and Ninja environment
   required by the supplied White2Upgrade snapshot.

The files under `snapshot/` preserve their workspace-relative paths. They are a
curated reference and overlay for the full repositories, not a standalone copy
of Pokeweb or White2Upgrade.

## Read First

Read these in order before changing an animation:

1. `snapshot/docs/move-animation-workflow-review.md`
2. `snapshot/White2Upgrade/data/graphics/move_animations/README.md`
3. `snapshot/White2Upgrade/data/graphics/move_spas/README.md`
4. `snapshot/Pokeweb-Serverless/docs/move-animation-editor/ai-agent-orientation.md`
5. `snapshot/Pokeweb-Serverless/docs/move-animation-editor/script-vs-spa.md`
6. `snapshot/Pokeweb-Serverless/docs/move-animation-editor/spa-particle-reference.md`

Use the command reference, SPA editing reference, donor index, and Swan excerpt
as lookup material rather than loading all of them into the initial context.
`move-animation-tooling-improvements.md` is a roadmap; commands described there
may not be implemented yet.

## Initial Commands

From the recipient's full Pokeweb clone:

```bash
npm ci
npm run moveanim:workflow -- brief
npm run moveanim:workflow -- next-spa \
  --repo /path/to/White2Upgrade \
  --repo /path/to/White2Upgrade-build
```

The current workflow still requires explicit paths on a new machine. The local
configuration resolver described in the tooling roadmap has not been built.

For an active move, create `work/<slug>/` beside `Pokeweb-Serverless` and keep
its generator authoritative while iterating. Do not hand-edit generated binary
animations or SPAs. Do not search archived move work unless the task involves
that exact move.

## Non-Negotiable Rules

- Visible battle animation belongs in the move-animation VM script and SPA
  assets, not C or C++.
- Target camera position is selector `11`; target sprite is selector `16`.
- A cloned SPA must deliberately preserve, scrub, or replace donor color,
  alpha, scale, texture, child, start-delay, rotation, and behavior fields.
- Browser preview is an iteration tool, not proof of retail behavior.
- Stage generated files, build White2Upgrade, verify the built ROM, and test in
  an emulator before accepting a move.
- Never distribute a clean or patched commercial ROM in this handoff.

## Bundle Integrity

`manifest.json` records the size, SHA-256 digest, and category of every bundled
source file. `FILES.sha256` can be checked with:

```bash
shasum -a 256 -c FILES.sha256
```

Review the source and licensing status of the Swan excerpts before sharing the
archive outside a team that is already authorized to access them.
