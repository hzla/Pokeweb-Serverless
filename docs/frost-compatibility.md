# Frost compatibility export

Pokeweb's Frost export reserves an unnamed PMC overlay slot before the named filesystem and aligns Frost's overlay/FNT indices. It retains native code, named assets, and DSi resources.

## Frost 5.0.1 large-ROM reader overflow

Frost reads the digest-table pointer at header `0x1f0` as the start of its retained ROM tail. Its reader caps the end at `0x12000000` (288 MiB), then subtracts that pointer. When the pointer lies beyond the cap but inside the file, the array length becomes negative and .NET raises `Arithmetic operation resulted in an overflow.`

For the reported `snew.nds`:

| Field | Value |
|---|---:|
| File length | 321,831,936 bytes |
| Table offset | 314,861,568 bytes (`0x12c46800`) |
| Frost's capped end | 301,989,888 bytes |
| Calculated legacy tail length | **−12,871,680 bytes** |
| Actual tail length | 6,970,368 bytes |

The installed Frost 5.0.1 parser reproduced the overflow in `NDSFileSystem.FromRom` after reading every native archive. The ROM's native sections, overlay/FNT indices, and authenticated DSi tables passed validation. A temporary Frost copy with the cap raised parsed the same untouched file successfully.

### Why 288 MiB?

Frost's [initial implementation](https://github.com/FrostFalcon/FrostsGen5Editor/blob/97d6ea8b/Data/NDSFileSystem.cs) already trimmed output to 288 MiB. The cap was added to the reader in the [July 2024 BW1 compatibility change](https://github.com/FrostFalcon/FrostsGen5Editor/commit/9847c251463e006cd3326162972ba602e4706569). A December 2024 change added a check for pointers beyond the file, leaving the capped-end case unchecked. The current writer no longer has the old 288 MiB output trim.

The likely purpose was avoiding unused cartridge padding; the commit messages do not explicitly state the reason. The local clean Black 2 dump occupies 512 MiB but declares about 280.92 MiB of used data. Reading its entire tail would retain about 237.35 MiB, versus 13.35 MiB with the cap. Thus the cutoff spared roughly 224 MiB of padding and associated memory/save work for retail dumps. Expanded ROMs can legitimately place their DSi tail past that cutoff.

### Reader fix

The [source patch](frost-large-rom-reader.patch) replaces the fixed cutoff with `int.MaxValue`, retaining the full tail for supported ROMs below 2 GiB. The equivalent constant change was tested on a separate executable copy; the installed application was not changed.

This patch fixes opening. Frost's writer is a separate path and does not rebuild native DSi integrity tables; the reader fix alone does not establish DSi-safe Frost saves. Revalidate or donor-repair externally edited ROMs before DSi testing.

Pokeweb now reports this specific reader limitation during Frost export. It preserves the ROM and its metadata. Altering or clearing `0x1f0` to evade the exception would discard or misidentify DSi data.

### Temporary editing copy

A separate DS-only editing copy can avoid this reader limitation while retaining native game code, assets, and installed patches. Remove its DSi boot/tail metadata and repack the native sections; Frost then has no DSi tail to read. Keep the intact original as a backup and matching donor. After Frost editing, donor-repair the output to restore DSi programs and metadata and rebuild integrity tables for the edited native content.

The editing copy temporarily lacks DSi support. This is an explicit editing workflow, not the behavior of ordinary or Frost exports. Changes to DSi programs themselves require a different workflow.

The installed, unmodified Frost parser accepted the header-masked editing view of `snew.nds`. A separately repacked copy retained every native section and named file unchanged. Repairing that unedited copy with the intact original as donor reproduced the original ROM byte-for-byte. This verifies the conversion round trip; it does not establish game behavior after arbitrary Frost edits.

## Verification

The reported ROM re-exported byte-for-byte unchanged, retaining all native sections/files and authenticated DSi metadata. The Frost warning callback fired once. Focused Frost/PMC/DSi regressions passed (118 tests), and the production build passed. No new test ROM files were saved.

The editing-copy investigation also corrected repair staging for inputs shorter than the donor's declared native digest region. Regression coverage checks that case for English Black, White, Black 2, and White 2. The subsequent focused Frost/DSi suite passed all 69 tests.
