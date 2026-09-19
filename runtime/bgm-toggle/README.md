# Background music runtime

`BgmToggleB2.dll` and `BgmToggleW2.dll` provide the shared background-music
runtime for the matching US Black 2 or White 2 revision. Their versioned
configuration supports a shortcut, any number of distinct streamed-BGM
mappings within native ID/export limits, or both. Version 3.0.0 uses a
variable-length ABI 2 mapping table and migrates ABI 1 single-track installs.

On the Music page, choose a target and import audio to **Add Replacement**.
Choosing an already installed target changes the action to **Update Selected
Replacement**; it replaces only that track. The installed table has per-track
Select/Remove actions. Remove All restores every original sequence reference.
Adding/removing a track automatically installs the matching current runtime;
**Update Music Runtime** upgrades existing tracks without reconverting them.
Export and fresh-boot; do not load an old emulator state to test new runtime code.

The separate **Native streamed music** panel edits an existing SDAT `STRM`
directly. Retail US Black 2 and White 2 expose stream 0 (`STRM_TITLE`) for the
title/opening presentation. Imported MP3/WAV audio can replace it as PCM16 or
IMA ADPCM, with optional looping, without installing a sequence redirect, the
background-music DLL, or its 32 KiB gameplay replacement buffer. The categorized
stream reference lists the retail title stream, streams appended by sequence
replacements, and any other streams found in the active ROM. Appended custom
streams are read-only there and remain managed by their sequence entries.

Direct-stream removal verifies the current and original audio hashes, then
restores bytes from the ROM loaded for the saved project. Its management metadata
is project state rather than an embedded ROM marker. If an exported ROM is later
imported as a new project, that ROM becomes the new restoration baseline.

Each mapping uses a private silent SSEQ and native STRM. The installer verifies
the owned tail, rebuilds it in one transaction, and renumbers surviving owned
IDs when a middle entry is removed. Unrelated content and title stream 0 are
preserved. Unexpected external references or changed owned files cause an error
instead of an unsafe removal. Runtime configuration includes a sorted table,
relative offset, count, ABI marker, and FNV-1a integrity checksum. Audio hashes
are checked against saved project metadata. Export/reimport reconstructs all
mappings, although original source filenames are not stored in the ROM.

There is no fixed application track-count cap. Native IDs are 16-bit with
0xffff reserved; each target can have one replacement. The installer still
enforces its **512 MiB export safety limit**; this is not a claim about the
SDK's maximum addressable ROM size. Multi-track support does not raise that
limit or establish 2 GiB exporter/flashcart compatibility.

Press **L + R + Select** to mute or unmute BGM. This changes volume rather than
pausing the sequence player, so battle scripts waiting on music state continue
normally. Genuine game pause requests save a native stream offset and resume
there. This offset is block-granular rather than a sample-accurate DAC cursor.

For streamed replacement, the update hook performs a constant-time sequence
and state check while the ID is unchanged. A changed ID or explicit play request
uses binary search through the sorted mapping table, stops the previous stream,
and selects the next one. Sequence play, pause, fade, and volume calls are mirrored to
BW2's native stream player. The DLL has 36 bytes of BSS, including a four-byte
native handle separate from the title screen's temporary handle. It initializes
native streaming on demand, using the existing sound heap. Configured DLLs
materialize BSS as zero bytes before appending the table, preserving all existing
relocation addresses. The table costs **10 resident bytes per replacement**,
plus a fixed header and two cached IDs; native SDAT INFO/FAT metadata also grows.
There is still only **one shared playback buffer**, not one buffer per song.
The buffering policy introduced in version 2.0.3 requests
a **32 KiB native stereo output buffer**, about 250 ms at 32,728 Hz, instead of
the retail 4 KiB / 31 ms buffer. That is **28 KiB additional sound-heap use**, not
the size of the imported song. The fixed US sound heap is 628 KiB; it is not an
expandable allocation from all remaining DS RAM.

The allocation-site hook applies only during replacement initialization. It
keeps the native allocator, 32-byte alignment, dispose callback and heap section.
It requires at least 8 KiB payload headroom after the larger allocation and its
bookkeeping, and falls back to 4 KiB on low capacity or allocation failure.
Fallback favors preserving playback over removing every hitch. The reserve is
not proof that every future sound allocation in every game mode will fit.

Live native buffers are reused on restarts, avoiding another allocation each
time. The game's sound-heap rollback frees them and clears the native pointer;
the patch does not retain a pointer to rolled-back memory. Stopping the stream
alone does not free a frame-heap allocation. Title-screen and toggle-only calls
retain the retail allocation policy. There is no new audio thread, alarm,
patch-owned sample buffer or streaming heap.

Tradeoffs are less free sound-heap capacity and a larger initial prefill/read
burst. Steady-state audio bitrate and the update hook are unchanged. Genuine
pause/resume subtracts the added prefetch duration from the native read-head
offset, clamped at zero; it remains approximate near block/loop boundaries.
Shortcut mute/unmute does not stop or seek the stream. Both PCM16 and generated
ADPCM feed this PCM16 output buffer; the generated ADPCM blocks remain at most
484 bytes, fitting the native 512-byte decode scratch space even during a large
prefill.

Version 2.0.2 resolves all five hook destinations to ARM9 addresses, initializes
streaming during gameplay even when Quick Launch skips the title, treats a
prepared handle at playback position zero as valid, and preserves the native
track-mask/volume argument order. Existing installations can use **Update Music
Runtime** on the Music page without reconverting their audio.

Version 2.0.3 adds a sixth, version-specific native allocation-site hook and
the guarded buffering policy above. Use **Update Music Runtime**, export, and
fresh-boot the ROM using a normal battery save. Loading an old emulator state
restores the old runtime and its buffers.

The earlier 2.0.2 playback was checked in fresh Route 19 wild battles on both US revisions using
the browser emulator core, with recorded output matched against the imported
track. White 2 shortcut testing also confirmed silent output while muted and
continued playback position across mute/unmute. This is not a complete gameplay
validation: catching tutorials, captures, battle exit/re-entry, lid resume, and
the other transition cases still need dedicated checks. **No emulator gameplay
tests were run for 2.0.3.** Its verification covers host-native allocation-policy
tests with address/undefined-behavior sanitizers, both retail ROM signatures,
DLL relocations, installer conflict rejection, and audio-preserving upgrades.
Battle-start dropout removal still needs user gameplay verification. Also check
repeat encounters, capture/flee endings, cries/SE, and genuine pause/resume.

**No emulator gameplay tests were run for 3.0.0.** Host tests cover mapping
lookup, configuration migration/integrity, preserved relocations, transactional
failure handling, per-track edits, export/reimport, and shortcut coexistence.
The full retail B2/W2 sound archives were each checked with all 273 BGM targets
mapped, partial removal to 182, unchanged original files/title stream, and
byte-exact full uninstall. These are archive checks, not playback validation.
User gameplay checks should include mapped overworld → mapped battle → mapped
overworld, switching to an unmapped theme, low-HP/victory music, repeated battles,
the catching tutorial, native fades/pause/resume, and mute/unmute.

The Music editor chooses encoding per target. New targets default to
block-seekable stereo IMA ADPCM at 32,728 Hz, which is about 75% smaller than
PCM16; maximum-quality stereo PCM16 remains available. Existing targets reopen
with their installed encoding selected. Programmatic callers that omit an
encoding retain the earlier 128 MiB automatic compression policy; that threshold
is a storage policy, not a native SDAT limit.
ROM export updates the DS-accessible region boundary when files grow, so the
game can still open gameplay archives displaced by a larger sound archive.

Run `python3 runtime/bgm-toggle/build.py` from the application repository to
rebuild the two bundled DLLs. The build emits reports in `runtime/bgm-toggle/build/`;
those reports are generated and are not source inputs.

Use `python3 runtime/bgm-toggle/verify.py` to verify every patched retail ARM9
call site and native entry point against local Black 2 and White 2 inputs. Use
`npm run bgmtoggle:test` for host-only allocator tests (no DS emulation). Use
`npm run streamedbgm:verify-rom -- <b2.nds> <w2.nds>` to round-trip SDAT
installation and removal on full ROM sound archives.
