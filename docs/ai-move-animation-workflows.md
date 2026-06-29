# AI Move Animation And SPA Workflow Guide

This guide is for creating Gen 5 move animations with AI assistance for Pokeweb Serverless. The default workflow is to reuse existing move animation scripts and existing `.spa` particle files, then output a raw move animation binary that can be imported in the Move Animation editor.

For custom SPA particle editing, donor particle cleanup, texture import format choices, and lessons from the custom Mega Evolution animation workflow, read [`spa-editing-reference.md`](spa-editing-reference.md) before editing particle resources.

## Current Scope

- Output raw move animation `.bin` files for import through the editor UI.
- Reuse existing move animation commands, camera commands, background commands, and existing SPA particle archives.
- Extract source move scripts and referenced SPA files directly from a ROM when available.
- Append new `.spa` files to the ROM only when future workflows require edited/custom SPA files.
- Do not create new sound banks or sound effects. Existing sound commands may be reused, removed, or left untouched depending on the requested animation.

## Recommended Prompt Shape

Use this structure when asking for a generated move animation:

```text
Create a Gen 5 BW2 move animation binary for <New Move Name> using <rom file>.

Source moves:
- Base motion/effect: Move ID <id>, <move name>
- Impact/effect donor: Move ID <id>, <move name>
- Optional extra donor: Move ID <id>, <move name>

Desired result:
- Use <specific part> from <source move>.
- Remove/omit <specific unwanted part>.
- Add <specific effect> from <donor move> at <timing/target>.
- Backgrounds: none / keep default / use donor background <id>.
- Camera: default/minimal / reuse source camera / describe desired camera.
- Sounds: no new sound banks or effects; remove donor sounds unless explicitly useful.

Output:
- A raw move animation binary importable through the Pokeweb Move Animation editor.
- If edited/custom SPA files are required, also output those `.spa` files and list which new or replacement SPA IDs the script expects.
```

For timing-sensitive requests, include screenshots or a short frame description. Example: "the impact should happen exactly when the fist reaches the target" or "the splash should appear behind the target, not centered on the user."

## Helper Script

Use the helper from the Pokeweb Serverless root:

```bash
npm run moveanim:helper -- --help
```

Extract source move binaries, decompiled scripts, and referenced SPA files:

```bash
npm run moveanim:helper -- extract \
  --rom ../cleanwhite2.nds \
  --moves 8,127 \
  --out work/jet-punch-sources
```

This writes:

- `move_<id>_animation.bin`: original raw animation binary.
- `move_<id>_animation.s`: decompiled editable script.
- `spa_<id>.spa`: every referenced SPA archive.
- `manifest.json`: source paths, move IDs, file indices, and referenced SPA IDs.

Compile an edited/generated script into an importable raw animation binary:

```bash
npm run moveanim:helper -- compile \
  --script work/jet-punch.s \
  --out work/jet-punch.bin \
  --move 8
```

Future custom SPA workflow: append SPA files to the ROM and report new SPA IDs:

```bash
npm run moveanim:helper -- append-spa \
  --rom ../cleanwhite2.nds \
  --spa work/custom-impact.spa \
  --out work/cleanwhite2-custom-spa.nds \
  --manifest work/appended-spa.json
```

Use the printed/appended SPA IDs in `LoadSPA` and `Emit*` commands.

Build a searchable reference index from a ROM plus the local exported docs:

```bash
npm run moveanim:index -- \
  --rom ../cleanwhite2.nds \
  --docs ../moveanimationdocs \
  --out move-animation-reference
```

This writes generated, gitignored reference files:

- `move-animation-reference.json`: move scripts, command usage, SPA/background references, tags, and summaries.
- `spa-reference.json`: parsed SPA documentation rows and per-SPA metadata discovered from the ROM.
- `background-reference.json`: parsed background documentation rows.
- `move-animation-reference.md`: a compact human-readable index for searching by move, effect type, SPA, or background.

The index also includes each move's in-game description from the message text bank (`402` for BW2, `202` for BW). This gives later AI enrichment passes both the intended move concept and the actual script/particle/background assets used by the ROM.

## AI Composition Process

1. Extract all source moves named in the prompt.
2. Read `manifest.json` and the decompiled `.s` scripts.
3. Identify command groups by purpose:
   - Setup: camera, background, shadow, palette, sound container commands.
   - Asset load: `LoadSPA`, `LoadBackground`.
   - Main effect: `Emit`, `EmitProjectile*`, `EmitFromCoordinates`, `EmitCircle`, and related `Emit*` commands.
   - Timing: `Wait`, `LetCMDsFinish`.
   - Cleanup: background hide/show, shadow restore, freeze restore, termination.
4. Keep only the requested visual sections.
5. Ensure every referenced SPA ID has a matching `LoadSPA` before use.
6. Remove donor background and sound commands unless the prompt explicitly asks for them.
7. Compile the final script to `.bin`.
8. Import the `.bin` into the editor and preview it.

## Practical Rules

- Preserve terminating commands. Every script label referenced in the header must end with `TerminateMoveScript` or another terminating command.
- Preserve header shape unless intentionally changing multi-script behavior.
- Keep `Wait` and `LetCMDsFinish` near copied effect groups; removing them often collapses timing.
- When mixing two moves, prefer changing timing in small increments of 2 to 6 frames.
- If an effect appears at the wrong side, check the source/target parameters in `Emit` or `EmitProjectile*` before changing particle data.
- If a move uses background commands and the new move should not, remove the full background setup and cleanup group together.
- If copied particles are invisible, confirm the right SPA ID and resource ID were copied, not just the visible command name.

## Output Contract For AI-Generated Animations

Each generated result should include:

- Final `.bin` file path.
- Source moves used.
- SPA IDs referenced by the final script.
- Whether the final output requires only the binary or also appended/replaced SPA files.
- A short summary of major changes from the donor scripts.
- Any known preview limitations or manual checks needed.

Example:

```text
Output: work/jet-punch.bin
Sources: Move 8 Ice Punch, Move 127 Waterfall
Referenced SPA IDs: 172, 296
Requires SPA changes: no
Summary: reused Ice Punch fist timing, removed ice particle commands, inserted Waterfall impact particles at frame 22, removed donor background commands.
Manual check: verify splash appears centered on target at impact.
```

## When SPA Edits Become Necessary

Stay binary-only when an existing particle resource already looks correct and only needs different timing, scale, target, or camera context.

Use SPA edits or appended SPA files when:

- The needed texture does not exist in the ROM.
- A particle must permanently change color, lifetime, spawn shape, gravity, or child behavior beyond script parameters.
- A donor particle is close but includes unwanted child particles or texture animation.
- Multiple generated moves need a new shared particle archive without overwriting an existing move's SPA.

When using custom SPA files, append them with `append-spa`, then update the generated script to reference the new SPA ID.
