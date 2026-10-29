# Background music runtime

Supports checked US revision-0 Black/White and Black 2/White 2. Configure BGM
replacements and standalone streams in the Music editor. Adding a standalone
song does not redirect a game sequence. Each native target ID has at most one
replacement; 0xffff is reserved. The exporter retains its 512 MiB safety limit.

**L + R + Select** toggles BGM volume without pausing the sequence player. C-Gear
mute controls share that state. Native pause/resume and fades remain supported.
BW1 uses a bounded buffered stream player; BW2 delegates to its native player.
They have separate DLLs and bindings. The installer checks ARM9 signatures and
conflicting relocations and preserves existing mappings when settings change.

The BW1 standalone Thumb API exports `PokewebStreamPlay(streamId)` (1 accepts,
0 rejects an invalid 16-bit ID), `PokewebStreamStop()`, `PokewebStreamPause(paused)`,
`PokewebStreamSetVolume(volume)` (0–127), `PokewebStreamPosition()` (source PCM
frames), and `PokewebBgmMute(request)` (0 query, 1 toggle). Callers manage mixing
with other game music. Play starts at zero and then uses the encoded loop point.

Build with `python3 runtime/bgm-toggle/build.py` for BW2 or `build_bw1.py` for
BW1. Use `python3 runtime/bgm-toggle/verify.py`, `npm run bgmtoggle:test` and
`npm run streamedbgm:verify-rom -- /path/black2.nds /path/white2.nds` as applicable.
Hardware timing, other regions/revisions and compatibility with arbitrary sound
engine modifications require independent testing.
