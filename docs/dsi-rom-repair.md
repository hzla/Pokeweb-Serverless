# DSi ROM Repair

The homepage repair tool supports English **Black, White, Black 2, and White 2**, including compatible hacks. Upload the edited ROM and an intact clean ROM of the same game, language, and revision, then select **Download DSi-Repaired ROM**.

## What the old exporter damaged

The old serializer retained the extended header, moved the ARM9i and ARM7i programs, and omitted the digest tables and the complete TWL region. It updated the program offsets but left the digest-region, table, and Modcrypt encryption offsets pointing to their former locations. A readable extended header therefore does not establish that its DSi data is intact.

This was reproduced with the actual historical serializer and its dependencies from three Pokeweb commits, exporting an intact English Black ROM (`IRBO`, revision 0):

| Commit | Export length | Result |
|---|---:|---|
| `f34414e` | 201,538,296 bytes | Stale digest/encryption offsets; both digest tables extend beyond the file. The DSi boundary also retains its original position. |
| `ffa132f` | 201,695,480 bytes | Program relocation and boundary updated; digest/encryption offsets remain stale and both tables extend beyond the file. |
| `0612293` | 201,695,480 bytes | Same damaged output as `ffa132f`. |

All native ARM9/ARM7 programs, overlay tables, NitroFS filenames and files, and banner bytes survived these unedited exports unchanged. The input ROM remained unchanged. The original donor's integrity metadata authenticated successfully before reproduction.

## How repair works

The tool validates native DS sections and requires matching game/revision, native program addresses, and compatible DSi memory mapping. It authenticates the donor's integrity tables and locates compatible digest configuration in the edited ROM's own ARM9. Recognized missing mappings can be restored; unknown mappings or incompatible configuration are rejected.

It restores the donor's extended metadata at `0x180–0x1000`, encryption flags, authenticated tables, and complete TWL region, including the DSi programs, encrypted bytes, and padding. The exporter relocates these resources and rebuilds the native sector, block, and master hashes for the edited ROM. Native DS code and game assets come from the edited input.

Matching donors are mandatory: Black cannot use White or Black 2 as a donor. Damaged donors, changed native program addresses, and unsupported header layouts are rejected before producing a download. Original inputs are never overwritten. No additional BIOS or NAND upload is needed.

The current shared exporter already preserves DSi resources for BW1 as well as BW2. This change extends the repair tool and its messages to BW1; it does not introduce a separate BW1 serializer.

## Verification

- Historical English Black exports from all three commits were repaired in memory. Every native section and file was compared with the corresponding damaged input.
- Node crypto independently verified all 196,439 native sector hashes, 361 decrypted TWL sector hashes, 6,150 block hashes, the master hash, and header CRC for each repaired historical output. The unchanged secure area's expected cartridge hashes came from the authenticated donor. Decrypted TWL bytes matched the donor.
- A grown/modified native asset survived old export, warned DS export, donor repair, reload, and another ordinary export; all resulting integrity tables verified.
- An ordinary export of intact `cleanblack.nds` preserved all native content and produced valid DSi tables.
- 100 focused tests passed across DSi repair, digest, ROM export, and BW1 startup repair. Repair fixtures cover all four English game codes, stripped/truncated metadata, preserved edits, reload, and wrong-game/revision rejection.
- The production build passed. No generated test ROMs were saved, and no emulator/hardware testing was performed. Retail White was covered by synthetic fixtures rather than a local retail donor.

Run the focused tests with:

```sh
npx vitest run src/test/dsiRomRepair.test.ts src/test/dsiDigest.test.ts src/test/romExport.test.ts src/test/bw1StartupRepair.test.ts
npm run build
```
