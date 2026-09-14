# BW2 overworld test warp

Select a tile in the Overworld Editor and click **Test Warp to Here**. The
browser emulator starts with the bundled Aspertia City save. Press Down to
enter the warp one tile south of the player. This feature is only shown for
BW2 projects and also accepts selections from the Permissions Matrix.

The build uses the existing temporary-ROM export and emulator launcher, with
the appropriate vanilla, White2Upgrade, or Black2Upgrade save. Editor changes
are included in the build. Test warp changes are applied only to the exported
ROM and a copy of the save.

## ROM and save changes

- Resolve Aspertia's event archive through zone 427's exported header, whose
  matrix is 0. Use the exported NitroFS paths so file ID shifts during code
  injection are respected.
- Append a 20-byte `CONNECT_DATA` with transition type 5 (`EXIT_TYPE_WARP`),
  grid position, one-tile dimensions, and destination exit ID `0x100`.
- Exit ID `0x100` selects the save's `SITUATION.special_loc`. Store the chosen
  zone and direct coordinates there. Scene offsets are added back to the
  selected tile; each tile is 16 world units, centered at +8, using fx32.
- Update both save copies (separated by `0x26000`). `SITUATION` starts at
  `0x19500`; its third 28-byte `LOCATION` starts at `+0x38`. Refresh the CRC
  over `0xa8` bytes, its local checksum at `0x195aa`, checksum-table entry 28,
  and the checksum table's CRC.

BW2 loads event data from the ROM on Continue. Warps do not need the cached
NPC save-slot patch used by trainer tests. The destination is direct, so no
destination warp record is required. The grid-map runtime resolves ground
height when initializing the player.

## Save reference and checks

- `reference_repos/PKHeX/PKHeX.Core/Saves/Access/SaveBlockAccessor5B2W2.cs`:
  save-block offsets and checksum locations.

Focused tests cover event/script preservation, exact warp bytes, scene
offsets, BW2 gating, and both copies/checksums of all three bundled BW2 saves.
