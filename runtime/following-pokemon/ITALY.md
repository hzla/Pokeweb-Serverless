# Italian White 2 Following Pokémon

The IRDI revision-0 port is installed through Pokeweb's Following Pokémon page. It includes stock species 1–649, movement, scenes, interactions, gifts and the existing Gen 5 art bundle.

The current test ROM is available:

- `White2Italy-Following-0.6.38-alpha.nds`: keeps A+B land riding, Gen 1–5 custom Surf sprites and Italian dialogue, and corrects Pokémon/shadow overdraw while walking or mounted; SHA-256 `415baeeeedcd5231c1d634bf95fa8ea8b11d35691f34397e4cb4d81733c3c835`.

Only the exact clean IRDI revision-0 source ROM is accepted. Italian saves use the `White2Italy-Following-*.sav` family; no US save is copied into it. If no Italian save is present, create one normally in the emulator.

## Rebuild and verify

Set `ITALIAN_W2_ROM` to the exact clean IRDI ROM and `ITALIAN_HGSS_ROM` to the Italian HeartGold ROM before running these commands from the Pokeweb repository root.

```sh
python3 runtime/following-pokemon/italy_port.py ../cleanwhite2.nds "$ITALIAN_W2_ROM"
python3 runtime/following-pokemon/generate_italian_pmc_contract.py ../cleanwhite2.nds "$ITALIAN_W2_ROM"
npx vite-node scripts/build-italian-pmc.ts
python3 runtime/following-pokemon/import_interactions.py "$ITALIAN_HGSS_ROM" --language it
python3 runtime/following-pokemon/build_italy_language.py --language it --rom "$ITALIAN_W2_ROM"
python3 runtime/following-pokemon/verify_italian_binary.py ../cleanwhite2.nds "$ITALIAN_W2_ROM"
FOLLOWING_PROFILE=white2italy python3 runtime/following-pokemon/build.py "$ITALIAN_W2_ROM" --publish
npx vite-node scripts/verify-following-install.ts ../../White2Italy-Following-0.6.38-alpha.nds
npx vite-node scripts/verify-following-installed-upgrade.ts ../../White2Italy-Following-0.6.37-alpha.nds
npx vite-node scripts/verify-following-italy-assets.ts "$ITALIAN_W2_ROM"
npx vite-node scripts/verify-following-grounding.ts ../../White2Italy-Following-0.6.38-alpha.nds
python3 runtime/following-pokemon/audit_italy_memory.py ../../White2Italy-Following-0.6.38-alpha.nds
```

The 0.6.37 ROM in `Repos/` is used for upgrade verification. The commands above build the current 0.6.38 package without overwriting saves.

## Verification limits

Static audit: 391 follower sites, 755 script-table entries, 170 allowed commands, 6 PMC hooks and 24 PMC imports checked.
Packaged ARM946 instruction and relocation tests passed; clean install, reinstall, export/reopen, disable, removal and English-to-Italian update passed without launching an emulator. Italian retail message/script archives and stock object-code rows were preserved in the exported ROM.
Packaged field tests include 100 simulated follower conversations and 100 retained-actor scene cycles, including both Repel choices. Land-input, rider draw, and Surf handoff tests use the translated final W2I modules. A replacement artwork test passed through export/reopen without recompiling a DLL. The descriptor audit checks grounded/Flying offsets and unchanged retail rows; visual alignment remains for melonDS acceptance.
A later Pokeweb install report exposed a W2I/W2 DLL identity error after project persistence. Pokeweb now uses the loaded IRDI code when in-memory ROM bytes are absent and passes the retrieved source ROM to module staging. A focused identity test and clean-ROM installation/export round trip with a browser-storage stand-in pass; live browser confirmation remains pending.
Game-emulator and DS hardware behavior are unverified. Use the separate human checklist for acceptance; a clean boot is required because a saved emulator state contains old runtime code.
