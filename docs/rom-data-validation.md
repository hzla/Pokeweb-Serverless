# Core ROM data validation

Run the read-only validator before sharing an export or investigating a broken
Pokémon, move, trainer or encounter entry:

```sh
npm run rom:validate -- /path/to/ROM.nds --json /path/to/new-report.json
```

Black, White, Black 2 and White 2 are supported. Paths and table layouts are
selected from the game code. Gen 4 inputs are rejected explicitly.

The command reads original ROM/NARC bytes without invoking Pokeweb’s repair,
encounter normalization or export routines. It never changes the ROM. A JSON
report must have a new filename; existing files, including links to the ROM,
are never overwritten. Reports include the input SHA-256 and byte length.

## Findings

Errors identify broken references, impossible level ranges, invalid known values,
missing related records or truncated data. Warnings identify unusual but possibly
intentional values, unknown engine extensions, inactive stale slots and container
metadata inconsistencies whose member data is physically intact.

Each finding includes its archive/path, member ID, field, member-relative byte
offset when available, actual value and expected constraint. Pokémon/move/item
names are included when their name bank supplies them.

| Archive | Checks |
| --- | --- |
| Personal | Record sizes; types; growth and egg groups; packed color flags; base-stat/height/weight/form-count/stage warnings; EV yields; held items and packed expanded ability IDs; declared alternate personal records |
| Moves | Record sizes; type/category; accuracy including native 101; chances; packed hit counts; signed priority, stat stages, recoil and healing; duration ordering; known effect/result/status/target/stat enums; PP and critical-stage warnings |
| Items | Record sizes; Natural Gift type including the native 31 sentinel; references from every other scanned table |
| Learnsets | Record alignment; terminators; move references; level bounds/order; records missing for existing Pokémon |
| Evolutions | Six-byte slots; targets; item/move/species parameters; levels and Beauty; inactive residue, self-evolutions and unknown-method warnings |
| Egg moves | Count/payload agreement and move references |
| Encounters | Single/four-season layouts; rates; every land/water slot; packed species/forms; level ranges; alternate-personal-ID warnings; inactive slot anomalies |
| Trainers and parties | Metadata sizes; class, party and item references; party size/layout; species/forms, levels, items and moves; gender/ability nibbles; trailing data and unsupported layout warnings |
| Baby species | Member sizes and species references |
| Shops and counts | Word alignment, item references and count/payload agreement |
| Hidden grottos | Record sizes; both versions’ species, levels, forms and gender chances; item references |
| In-game trades | Record sizes; received/requested Pokémon, forms, levels, held items and IVs; nature/gender/ability/condition warnings; native unspecified sentinels |
| Name banks | Structure of the six dependency banks used for species, moves, items, abilities, types and trainer classes |

References use the input ROM’s actual archives rather than fixed retail species,
move or item limits. Ability high bits in held-item words and form bits in wild
encounter words are decoded separately. The regional-Dex lookup member in
personal.narc is excluded from Pokémon validation. Cosmetic forms sharing one
personal record are not assigned an invented form-count limit.

Storage widths and semantic validity differ. Catch rates, IV quality, prices,
flags, packed tutor/TM compatibility, padding and unknown bytes may legitimately
use all their encoded bits. The scan checks the containing structure and known
constraints; it does not guess meanings for undocumented bits. Custom effect
code, forms implemented outside personal data, and runtime support for expanded
IDs still require engine-specific review. Scripts, graphics, maps/headers,
machine/tutor move tables, battle facilities and DLL behavior are outside this
core-data scan. A passing scan is not an exhaustive gameplay certificate.

## Automation

```sh
# Warnings also fail the command:
npm run rom:validate -- ROM.nds --strict

# Control terminal output and retained report details:
npm run rom:validate -- ROM.nds --json report.json --max-output 100 --max-issues 20000
```

Exit status is `0` for no errors, `1` for errors (or warnings with `--strict`), and
`2` for usage/input/report-writing failure. Findings are counted across the entire
scan even if retained details reach `--max-issues`; errors take precedence over
warnings in retained details. The report records omitted-detail counts explicitly.

The reusable implementation is `src/pokeweb/romDataValidation.ts`; the command
is `scripts/validate-rom-data.ts`. Tests include the `0x3FFF` held-item regression,
expanded references, native sentinels, seasonal/inactive encounters, malformed
archives, missing records, CLI exit statuses and input/overwrite protection.
