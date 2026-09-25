# Following Pokémon — current validation

| Profile | Bundled package | Automated status | Human visual status |
|---|---|---|---|
| Stock White 2 IRDO | 0.6.64-alpha | Exact-ROM build, packaged ARM and Pokeweb install/update checks passed | Current draw and mount changes pending cold boot |
| Stock Black 2 IREO | 0.6.38-alpha | Exact-ROM build, packaged ARM and Pokeweb update checks passed | Current draw and mount changes pending cold boot |
| Italian White 2 IRDI | 0.6.39-alpha | Exact-ROM/PMC audit, packaged ARM and Pokeweb update checks passed | Current draw and mount changes pending cold boot |
| White2Upgrade | 0.7.33-alpha | Pinned-ROM build, packaged ARM and Pokeweb update checks passed | Current draw and mount changes pending cold boot |

During the 2026-09-24 repository cleanup, non-publishing pinned-ROM builds passed for all four profiles. Each rebuilt profile’s three DLLs matched the shipped bundle byte-for-byte. The focused follower web suite passed 39 tests; the full Pokeweb suite passed 1423 tests with 3 skipped, and the production build passed. No game emulator was run.

On 2026-09-25, the installer stopped using a whole-ROM SHA as an eligibility gate. It now checks the exact follower hook/native-adapter bytes, follower archive layout, owned-file receipts, and actual DLL hook write spans. When PMC is absent, its boot hooks and imported ARM9 entries are checked too. Clean US White 2, US Black 2, and Italian White 2 passed this new eligibility check. The supplied `vw2qol.nds` passed, installed, exported, and reopened with its existing DLLs and all message/script NARC member bytes intact. Its EdgeEXP DLL writes a separate script-table entry and does not overlap a follower hook. One message NARC and the script NARC gained only container padding during normal export. No emulator was run; White2Upgrade ROM hacks still require the audited Upgrade modules and binary sites.

The supplied `walkdown.mln` frame placed Arceus one world tile behind a south-facing player. Ordinary depth policy chose follower-behind, but later shadow clearance advanced the submitted follower quad past the player's draw depth. The current code moves only the player's submitted quad toward the camera for that overlap and restores it immediately. State-derived projection and packaged ARM946 tests cover final follower/player order, follower/shadow clearance, repeated draws, and restoration. The same shared fix was built for all four profiles. No emulator was run for this correction.

Packaged checks also cover module relocations and ABI, movement/scene policy, conversations and gifts, L/R cycling, land-rider input and draw, Surf selection and shoreline transitions, and owned resource teardown. Pokeweb tests cover install, recognized upgrades, export/reopen, enable/disable, removal, and authored-data retention. These are host or isolated CPU checks with simulated native services; they cannot establish live-game presentation or peak native heap usage. Use [TEST-MAP.md](TEST-MAP.md) for the actual build gates and manual diagnostics, and [MEMORY-AUDIT.md](MEMORY-AUDIT.md) for memory accounting boundaries.

The delivered stock test ROM is `Repos/White2-Following-0.6.64-alpha.nds` (SHA-256 `30bba56ab65b2460bc83c8038e1e1ccf01dd7240d8426915562ead7b2255b346`), with a separately copied matching save. The other three packages are bundled for Pokeweb export from their matching clean ROMs. Old test ROMs and saved states are not evidence for a new DLL: cold boot the new export with an ordinary same-profile save.

Human acceptance remains open for shadows, player/follower overlap in all directions, buildings, stairs, terrain, land/Surf handoff, conversations and gifts, Repel, menus/PC, NPCs/signs, battles, transitions, and repeated cycles. Results belong in the profile checklists. Git history retains the per-alpha investigations and prior validation records; absence of a historical section here is not a claim that it was rerun.
