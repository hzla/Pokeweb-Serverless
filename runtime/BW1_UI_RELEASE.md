# BW1 Graphical/UI release — 2026-10-08

The five Graphical/UI Enhancements support English US Black (`IRBO`) and
White (`IRAO`), revision 0. Each game has separately built DLLs, explicit native
ARM/Thumb bindings, hook/resource fingerprints and installer mappings.
The DS release record identifies the exact tested profiles and artifacts in
[`bw1-ui-acceptance.json`](bw1-ui-acceptance.json). Live DSi acceptance is pending.

## Acceptance evidence

Gameplay checks cold-booted separately named exports in the bundled DS emulator
with copied battery data. Screens and live RAM were inspected; installer,
compiled-runtime and gameplay results remain distinct. Validation NPC scripts,
trainer parties, evolution/KO records and copied saves provided controlled
cases. These checks do not claim stock trainer teams or a general heap-capacity
measurement. Source ROMs and existing user saves were preserved.

| Patch | DS observations in both games | Separate compiled checks |
| --- | --- | --- |
| Summary IV/EV Viewer | Native appearance, title pixels, Stats/IV/EV and IV-only controls, touch and Pokémon switching, forms/Egg restrictions, boxed Pokémon/Ribbons, native reminder/tutor restrictions, green/yellow/red/empty HP bars and Shedinja 1/1, repeated exit/re-entry, and menu/battle/menu transitions. Read-only party and all 720 boxed records remain unchanged. | Native draw/input/sound helpers and hook ABI; value order/extremes; allocation failures and repeated graphics cleanup; DS/extended pointers. |
| Type Icons | All three styles complete single/double/triple/rotation battles: 24 current-build game/style/format sessions. PSN/BRN labels, Heat Rotom, Illusion/reveal, Soak and transient Roost/restoration; eight wild/field cycles for each game/style, with cleared gauge references and stable palette ownership. | Native readers and palette ownership, all five conditions, native cell/palette preservation, fades, conflicts/failures, ABI and DS/extended pointers. |
| Move Effectiveness Preview | Independent installation; effective/resisted/immune colors, 12 custom-color sessions, and 12 double/triple enemy/ally/spread target sessions across both games/styles. Confirmation reaches the next native command screen; type changes refresh the preview. | Retail current-type, ability/suppression, item, grounding, condition, field and affinity readers; neutral/custom-mechanic and excluded-move fallback; native target mapping and rotation cache. |
| Learnset Viewer | Both companion installation orders with Enhanced Party Menu; PP/scroll/read-only controls, selected-icon animation, forms/Egg skip, seven Eevee branches and their requirements, terminal/empty/truncated records, six-member/eight-command menus, repeated entry/exit, and return after battles, KO evolution and cold save reload. | Native command capacity, prologue/graphics ABI, party/family refresh rollback, allocation failure and repeated owned-resource cleanup; DS/extended pointers. |
| Enhanced Party Menu | EVOLVE success/cancellation; native full-slot RELEARN; level and entered/used counter evolution methods; immediate level-100 zero-EXP KO learning and post-battle KO evolution; decline/cancellation; native field-script counters; save/cold reload; retail Heart Scale reminder and ordinary Draco Meteor tutor afterward. | Retail PK5 crypto/block/getter routines across all 32 permutations, native script dispatch, native precedence and seven-argument handoff, malformed/missing KO data, native learning veneers and allocation failure cleanup; DS/extended pointers. |

Combined exports contain all five patches plus BW1 Battle Log runtime 8.
Encrypted Pokémon checksums and counter values were checked after battles,
learning, evolution, save/reload and tutor sessions. Read-only menu checks
compare complete party records. Summary coexists with the Battle Log display.

Installer suites cover PMC absent/present, dependencies, altered native
hooks/resources, duplicate/conflicting modules, install/update/reinstall,
staged removal and rollback. Export/reopen retains options, colors, private
message IDs/text and recognized DLL paths. Battle Log cannot be removed while
its party-menu companion remains installed. BW1 keeps the existing save-log,
PK5-counter and KO-learnset formats; BW2 retains its runtime-11 dependency.

Final clean-source Black/White exports also install all five with the shipped
support flags, without an acceptance override, and reopen with retained
settings. Both cold-boot and open native Learnset and Stats/IV/EV pages; all six
party records remain unchanged and valid, and Summary releases its handles.
Across the nine focused installer/UI suites, 216 tests pass and two optional
export tests remain skipped; the separate normal-export and gameplay checks
above ran explicitly. The production build, source provenance, privacy,
BW1 dependency artifacts and acceptance-ledger checks pass.

## Rebuild and availability

Existing build/bundle commands retain their names. Bundlers grant `dsAccepted`
only when both game records are accepted and the native profile and every
required DLL match the ledger. Changed bindings, graphics fingerprints,
companions or BW1 party-menu dependencies disable the changed build until its
acceptance record is renewed. Build output alone never grants acceptance.

Run `npm run bw1ui:check` to verify bundled hashes, source profiles, support
flags and rejection of changed/incomplete acceptance inputs. The existing BW1
Code Injection filter shows the five supported entries by default; its
unsupported-patches toggle continues to expose other unavailable entries.

Other regions/revisions and incompatible modified native hooks remain
unsupported. Extended DSi RAM is allowed through the independently verified
native mode getter and compiled pointer tests; no 4 MiB blanket limit is
introduced. Live DSi boot, native extended-heap allocation and visual/gameplay
acceptance remain open and are not represented as completed DS checks.
