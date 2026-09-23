# Width-dependent follower spacing

Stock 0.6.15-alpha and White2Upgrade 0.7.6-alpha share this implementation.

## Artwork measurement

The installer and replacement importer decode the actual displayed resource,
measure opaque horizontal bounds in both side directions and both walk poses,
and use their maximum width. Transparent padding, species names and the nominal
32/64-pixel canvas size do not determine spacing. Mirrored and asymmetric profiles
use their native frame mappings; placeholders use their displayed art.

`extra = clamp(ceil((visibleWidth - 16) / 2), 0, 6)`

| Maximum opaque side width | Extra spacing |
|---|---:|
| 16 pixels or less | 0 |
| 17–18 | 1 |
| 19–20 | 2 |
| 21–22 | 3 |
| 23–24 | 4 |
| 25–26 | 5 |
| 27 or more | 6 |

The gap stays constant across idle and walk frames. These are native world
units, approximately pixels at the ordinary camera scale, not a guaranteed
screen-space pixel distance under camera rotation/zoom. East/west movement is
the widened axis; north/south distance remains one tile.

## Movement and interaction

The existing bounded trail uses the metric
`sqrt((16 * dx)^2 + ((16 + extra) * dz)^2)` with target
`16 * (16 + extra)` world units. Straight horizontal travel follows 16+extra
units behind; vertical travel follows 16. Mixed routes consume the same metric
through recorded positions, rather than switching a target distance at corners.
No render offset, depth bias or collision-coordinate divergence is introduced.
Recorded frame granularity can add less than one movement sample of separation.
Generation, rail-connectivity, overflow, terrain and NPC guards still apply.

Conversation reach admits the additional horizontal spacing, retaining native
adjacent-tile, elevation, obstruction and trail-corridor checks. North/south reach
does not increase. Existing render corrections, menu/PC retention and seamless
zone handling are retained. A changed appearance uses normal trail reseeding.

## Storage and compatibility

Full FWDB version 3 uses reserved byte 15 of each unchanged 24-byte row. Compact
version 4 uses bits 3–5 of byte 8 in each unchanged 12-byte row. Values above six
are rejected. Legacy versions 1/2 remain readable with zero added spacing; older
runtime validators reject the new versions. Modules and registry are staged
together. Upgrades recompute spacing from installed artwork while preserving
resources, descriptors and hashed zone policies.

On ARM32, the selected gap occupies a previously unused byte at follower offset
50; the trail remains at 52. The 64-record trail makes the current sidecar 1,852
bytes. Static assertions protect both offsets and size. The ROM page cache stays 1,024 bytes, the species
index stays 1,302/2,050 bytes, and conversation capacity stays 8,192 bytes. No new
heap allocation or per-frame artwork decoding/file I/O is added. Code size can
increase; see the generated [memory audit](MEMORY-AUDIT.md).

## Verification

Host tests cover every gap, direction, walk/run speed, repeated bends/reversals,
elevation, invalid input and history exhaustion. Packaged ARM946 tests cover
spacing and unobstructed/blocked conversations using mocked native services.
Registry checks cover each installed appearance, fallback selection, malformed
spacing, cache bounds and allocation-free reads. Import tests cover transparent
padding, maximum pose width, mirroring, asymmetric sides and legacy formats.
Executed results are recorded in [VALIDATION.md](VALIDATION.md).

Human acceptance is pending: run W01–W05 in [EMULATOR-CHECKLIST.md](EMULATOR-CHECKLIST.md)
on both profiles, including large sprites on stairs and near buildings, and
U16 for later generations. Cold boot with the matching ordinary save; older
emulator states contain older code and data. No game emulator or hardware testing
is performed by the build scripts.
