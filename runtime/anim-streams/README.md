# Animated sprite streaming runtime (Black, White, Black 2, White 2)

`PokewebAnimStreams{B,W,B2,W2}.dll`: Pokeweb's runtime for animated battle-style sprites (PWAN GIF support),
replacing the split PWAN runtimes (`PokewebPwan{Battle,Summary,Misc,Trainer}`, Black 2 / White 2 only). A C port of White2Upgrade's w2anim streamer
(`src/w2anim/w2u_anim_streams.cpp`, itself from MegaB2W2's AnimSprites; pokebw2 has the same design as
`src/w2u/graphics/anim_stream.c`).

- Data: `w2anim/streams.bin` (W2AS v1 index of MANI v2 streams, keyed by {arc, sheet file}); the format is
  documented at the top of `src/anim_streams.c` and implemented in Pokeweb by `src/pokeweb/w2animCodec.ts`.
  Pokeweb also writes `w2anim/pokeweb_index.bin` (PWNC rows: species, form, sides, sprite asset) so a reload
  restores its overrides; the runtime does not read it.
- Hooks (all `THUMB_BRANCH_LINK`): the three calls that load a sprite's files (register), the sprite's removal
  (release), every caller of the MCSS update (tick: battle, trade, summary, Hall of Fame, evolution, intro, Pokédex
  forms, egg hatch); Black 2 / White 2 also hook the evolution scene's sprite adds and morph renderer (16 hooks;
  Black / White 12: their evolution particle grid is built from the sprite's static sheet, the carrier's first
  frame). `build.py` finds each call site by caller and callee and checks it in the game's retail binary, then records
  the retail bytes in `src/assets/codeinjection/animStreamsManifest.json` (Pokeweb checks them before installing).
- Symbols: Black 2 / White 2 from pokebw2 (`LoadMCSSGraphicsData`, `MCSSSys_Update`, `MCSSSys_Remove` ...);
  Black / White from the aletheia decomp (`MCSS_LoadResource`, `MCSS_Main`, `MCSS_Del` ..., `bw1.py`: Black
  addresses from `layout/function_addrs.tsv`, White's from `layout/matched_white/`). MCSS's structures (system,
  sprite, upload task, TCB) are the same in both generations; the C source uses neutral extern names that
  `build.py` binds per family. Black / White upload through the main task list (`GFL_USE_AddMainTask`), where MCSS's
  own texture uploads run.
- Memory: a resident ARM9 DLL (~7 KB); each animated sprite's buffers (timeline, one compressed frame, one decoded
  frame) are allocated on that sprite's own heap (the battle / scene heap); at most 8 at once.
- Entry flags: 1 = W2U carrier (pokegra block), 2 = Pokeweb trainer carrier (the trainer graphic Pokeweb appends to
  the trainer sprite archive, the PWAN runtime's carrier; arc 71 in Black 2 / White 2, 72 in Black / White).
- MANI flags: TEX4 (96x96 PWAN frames into the native 4 bpp sheet) or A3I5 + morph (full size, up to 128x128,
  `src/pokeweb/animStreamsFullSize.ts`).

Build (Black 2 / White 2: pokebw2's `config/{w2_us,b2_us}` symbols and extracted retail binaries with every overlay,
see `runtime/item-expansion/build.py` for the variables; Black / White: `ALETHEIA` (default `../aletheia`) and clean
ROMs `BW1_ROM_B` / `BW1_ROM_W` (default `../cleanblack.nds`, `../cleanwhite.nds`)):

    python3 runtime/anim-streams/build.py [--game B|W|B2|W2 ...] [--test]

Emulator check (local ROMs, not committed):

    npx vite-node scripts/verify-anim-streams-emulator.ts ROM.nds SPECIES_NAME [TRAINER_ID] [--keep-pwan]
      [--pokemon-gif SPECIES:front.gif:back.gif] [--full-size] [--trainer-gif trainer.gif] [--keys ...]
