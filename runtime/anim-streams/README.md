# Animated sprite streaming runtime (Black 2 / White 2)

`PokewebAnimStreams{W2,B2}.dll`: Pokeweb's runtime for animated battle-style sprites (PWAN GIF support), replacing
the split PWAN runtimes (`PokewebPwan{Battle,Summary,Misc,Trainer}`). A C port of White2Upgrade's w2anim streamer
(`src/w2anim/w2u_anim_streams.cpp`, itself from MegaB2W2's AnimSprites; pokebw2 has the same design as
`src/w2u/graphics/anim_stream.c`).

- Data: `w2anim/streams.bin` (W2AS v1 index of MANI v2 streams, keyed by {arc, sheet file}); the format is
  documented at the top of `src/anim_streams.c` and implemented in Pokeweb by `src/pokeweb/w2animCodec.ts`.
  Pokeweb also writes `w2anim/pokeweb_index.bin` (PWNC rows: species, form, sides, sprite asset) so a reload
  restores its overrides; the runtime does not read it.
- Hooks (16, all `THUMB_BRANCH_LINK`): the three `LoadMCSSGraphicsData` calls (register), `MCSSSys_Remove`
  (release), every caller of `MCSSSys_Update` (tick: battle, trade, summary, Hall of Fame, evolution, intro, Pokédex
  forms, egg hatch) and the evolution scene's sprite adds and morph renderer. `build.py` finds each call site from
  pokebw2's symbols by caller and callee, checks it in both games' retail binaries and records the retail bytes in
  `src/assets/codeinjection/animStreamsManifest.json` (Pokeweb checks them before installing).
- Memory: a resident ARM9 DLL (~7 KB); each animated sprite's buffers (timeline, one compressed frame, one decoded
  frame) are allocated on that sprite's own heap (the battle / scene heap); at most 8 at once.
- Entry flags: 1 = W2U carrier (pokegra block), 2 = Pokeweb trainer carrier (the trainer graphic Pokeweb appends to
  the trainer sprite archive, the PWAN runtime's carrier).
- MANI flags: TEX4 (96x96 PWAN frames into the native 4 bpp sheet) or A3I5 + morph (full size, up to 128x128,
  `src/pokeweb/animStreamsFullSize.ts`).

Build (needs pokebw2's `config/{w2_us,b2_us}` symbols and extracted retail binaries with every overlay; see
`runtime/item-expansion/build.py` for the variables):

    python3 runtime/anim-streams/build.py [--game W2|B2] [--test]

Emulator check (local ROMs, not committed):

    npx vite-node scripts/verify-anim-streams-emulator.ts ROM.nds SPECIES_NAME [TRAINER_ID] [--keep-pwan]
      [--pokemon-gif SPECIES:front.gif:back.gif] [--full-size] [--trainer-gif trainer.gif] [--keys ...]
