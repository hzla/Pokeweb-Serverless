# Validation record

Status: **stock White 2/Black 2 0.6.27 and White2Upgrade 0.7.18 focused automated checks passed; follower-shadow appearance in melonDS and hardware testing pending.**
The user confirmed the preceding menu and PC fixes, but reported continued recall
at Floccesy Town / Route 20 in White2Upgrade. The supplied state was inspected
read-only; no game emulator was run.
The user reported that the preceding ambient-NPC fix worked. This is a user report, not completion of every checklist case.
The user confirmed that **0.3.1 fixed the melonDS overworld freeze**. This is a
user-reported result, separate from the automated checks below.
The earlier 0.2 walking module was exercised in the bundled Desmond DS emulator.
Those results do not validate the new 0.3 renderer/effects. The clean input
remains read-only. Hardware has not been tested.

## Stock 0.6.27 / White2Upgrade 0.7.18 native shadow registration

The user tested White2Upgrade 0.7.17 in melonDS and reported no follower
shadow. The supplied `noshadow.mln` state (SHA-256
`95e33ef0ee67d3e740c266d659c585b0026b00c8c8970df0112147cbc468ac25`)
contains a visible follower with a shadow-enabled descriptor, but its native
`SHADOW_SET` move bit is clear (`0x300802`); the player's bit is set
(`0x4602`). Its actor and player states meet the revised registration gate.
The earlier move-start flag did not invoke native shadow registration for the
follower's direct-coordinate movement callback.

The field module now calls the game's native shadow-registration helper after
a visible follower update when the player has an active shadow and the
follower has not registered one. The helper creates the game's normal field
effect and sets `SHADOW_SET`; subsequent frames do not register duplicates.
The exact helper bytes were verified at overlay 36 `0x02194DF4` for stock
White 2 and White2Upgrade, and `0x02194DB4` for Black 2. All three packaged
field modules contain one call target for their profile's helper. The actor
is still nonpersistent; the native shadow task checks actor identity and
visibility, and destroys its billboard when the actor is removed.

The exact-ROM contracts, packaged CPU/interaction/scene/render checks,
Pokeweb production build, three ROM exports, and install/reinstall/disable/
remove round trips passed. The fixed PMC payloads are 46,356 bytes for stock
White 2 and Black 2 and 47,340 bytes for White2Upgrade, an increase of 100
bytes from the previous release. Native effect-task allocation is outside the
fixed PMC payload and was not measured in game. No emulator or hardware test
was run for this revision.

Delivered ROM SHA-256:

- stock White 2 0.6.27-alpha: `bffc65f003b9aa8a2a40c3b5b206c73f56a3c2981892a3bfc67585b71cb93f61`.
- stock Black 2 0.6.27-alpha: `38d3a618a044afc8f77d2ba2d562e4034feed8908f95662ae7a6ef5fb957ab7f`.
- White2Upgrade 0.7.18-alpha: `062ef1494f4c4bb922c7a55dde2676a77385ecec00c8582f844ac9ed28c3c7b0`.

The same-basename `.sav` files were copied from the preceding alpha without
modifying them. Human shadow cases H01–H03, B14, and U19 remain NOT RUN for
this revision. Start with White2Upgrade U19 in melonDS using a cold boot.

## Previous stock 0.6.26 / White2Upgrade 0.7.17 shadow attempt — visual failure

The prior implementation described below passed static and package checks,
but the user tested White2Upgrade 0.7.17 in melonDS and saw no follower shadow.
Those checks did not establish live shadow registration. This historical
attempt must not be treated as visual acceptance.



HGSS follower resources include species-indexed shadow sizes and vertical
offsets. This release uses the existing White 2 field-shadow effect instead:
the follower-owned descriptor enables native shadow rendering, and its first
accepted movement requests the native movement-start attribute pass. A PC
return at a preserved visible pose requests the same pass. The native shadow
task owns positioning, terrain height, visibility, and deletion; the patch
does not allocate a new PMC shadow buffer or change sprite draw priority.

The stock White 2 model archive confirms shadow type 1 on all 620 retail
Pokémon-style descriptors. The built archive verifier and exported-ROM
install/reopen tests confirm shadow type 1 on every appended follower
descriptor across all three profiles. The stock package passed field,
interaction, scene, ambient, continuity, and draw checks; Black 2 passed
packaged branch checks, and White2Upgrade passed packaged interaction and
render checks. The Pokeweb
production build and install/reinstall/disable/remove round trips passed for
all three exported ROMs. White2Upgrade retained 1,023-species coverage and
rejected mismatched runtime fingerprints and hook conflicts. None of these
checks establishes that the shadow is visually correct in game.

The fixed packaged payload increased by 20 bytes in each profile compared
with the previous alpha: 46,256 bytes for stock White 2 and Black 2, and
47,240 bytes for White2Upgrade. Native shadow-task and billboard allocations
are outside this fixed PMC audit and have not been measured in game.

Delivered ROM SHA-256:

- stock White 2 0.6.26-alpha: `9d4f810fceb51dad5abca15e4a2e3cea28d4f5a2864e02e14836fdd0f328049d`.
- stock Black 2 0.6.26-alpha: `b5cf8973e21d9608428c4389b995f635f65d283b54a9934fbf554f41570a059b`.
- White2Upgrade 0.7.17-alpha: `70fe0ea1478c875f7f452adfa4fd62428b2e39df43c48b29edabf2bd42f45e7c`.

Existing stock White 2 and White2Upgrade saves were copied to matching new
filenames without changing their sources. Black 2 received a fresh sample
save because no preceding same-prefix alpha save was present. Emulator rows
H01–H03, B14, and U19 remain NOT RUN for the human tester.

## Stock White 2/Black 2 0.6.25 / White2Upgrade 0.7.16 trail reduction

The movement trail capacity is 64 samples instead of 256. The follower sidecar
is 1,852 bytes instead of 7,228 bytes, saving 5,376 bytes in each field module.
The generated memory audit measured total fixed code/data/BSS at 46,236 bytes
for stock White 2 and Black 2, and 47,220 bytes for White2Upgrade. The expanded
module image requirements are 52,208 and 53,200 bytes respectively. These are
packaged sizes, not measured game heap peaks; native graphics, loader bookkeeping,
allocator overhead, stack, and VRAM remain outside this audit.

Host movement tests passed reversals, repeated bends, elevation, overflow and
reseeding at the 64-record bound. Stock packaged checks passed 100 conversation,
scene, ambient-NPC, menu/PC and continuity cycles; the packaged draw fixture
passed 12,000 submissions. Black 2 passed its exact-ROM contract and packaged
branch checks. White2Upgrade passed packaged interaction and render checks.
All three prior installed alphas upgraded with authored zone-427 dialogue,
enabled state, and one copy of each matching module preserved. Each delivered
ROM passed export/reopen, reinstall, disable/re-enable and removal/reinstall.
No DS emulator or hardware was run for these versions.

Delivered ROM SHA-256:

- stock White 2 0.6.25-alpha: `25ac0299a89b1d4fae03a202f92ac27064949cb26acb4deb8c7824df280eb8be`.
- stock Black 2 0.6.25-alpha: `422cc2c73fad03b16efbc15add6309582e75d9fe0bafbd6c95ad5b449a19cd0e`.
- White2Upgrade 0.7.16-alpha: `6aab8eeff93ff966fce3c2a44162bfa10052511f3b7f69e000815852af05d1c9`.

Matching saves were copied from the respective immediately preceding alpha;
the source saves were not overwritten. Human acceptance should focus on M05,
B13 and U18, especially slow stairs and curves with wide followers.

## Stock 0.6.24 / White2Upgrade 0.7.15 sign and furniture correction

The supplied DeSmuME state was inspected read-only. Its `FollowingSceneDebug`
ring records the actual recall as reason 1 on opcode `0x276`, repeated before
the sign message. The later `0x43` value in the diagnostic header is the last
observed sign-window opcode after the actor had already been removed; it was not
the command that caused the recall.

Opcode `0x276` reports ordinary interaction progress to the Funfest mission
subsystem. Stock sign and static-furniture scripts execute it after actor pause
and before their sound/message presentation. It does not move actors, replace
field ownership, or enter a communication activity. The allowlist now includes
this command, and the binary contract pins its handler bytes in overlay 33.
Unknown commands remain recall-before-dispatch.

The packaged scene fixture now runs the observed `pause → 0x276 → sound → sign`
sequence and the equivalent furniture sequence while a random-movement actor
has a dormant crossing action. Both retain the same follower actor and trail for
100 cycles. A real coordinate write into the follower still recalls before the
write. Both profiles also pass exhaustive opcode classification, conversation,
ambient collision, continuity, render, relocation, stack-alignment, installer,
disable/re-enable, removal/reinstall, and export/reopen checks. The production
web build and 34 focused web tests pass. No DS emulator was run for this release.
Actual installed-ROM migrations from stock 0.6.23 and Upgrade 0.7.14 retain the
enabled state and authored zone-427 dialogue, export/reopen cleanly, and contain
each runtime module exactly once.

Delivered SHA-256:

- stock 0.6.24-alpha: `b30cc2093141e47a30e961501aed581da7e28330a8de682a4f37933d19034a6b`.
- White2Upgrade 0.7.15-alpha: `62d584d044d8232b9f3f48c7e5b96779603303f3d7c341418e0bd632590a1d77`.

The stock save was copied from 0.6.23 and the Upgrade save from 0.7.14. The
supplied failure state remains evidence for the old module and must not be
resumed to test these ROMs.

## Stock 0.6.23 / White2Upgrade 0.7.14 paused-actor correction

White 2's common field-event setup sets the native movement-pause bit on
ordinary actors. The earlier route predictor still evaluated a queued action on
such an actor and could recall the follower even though an NPC conversation,
sign, or static-furniture event prevented the autonomous movement from starting.
The action observer now defers paused non-player actors to the existing
position/world-step hooks. Those hooks run before real coordinate commits, so a
script that actually moves an actor into the follower still recalls before the
conflicting write. Forced player movement remains conservative regardless of the
pause bit.

The packaged ARM946 scene fixture covers three retained presentation sequences:
NPC facing/message, sign message, and generic static-object message. Each queues
a crossing route on a paused actor and requires the same follower actor and trail
to remain. A subsequent real world-step to the follower's position must still
recall with reason 4. The existing 100-cycle scene, conversation, ambient-NPC,
continuity, render, relocation, stack-alignment, and ARM/Thumb checks pass for
both profiles. Native services are mocked in CPU tests; no DS emulator was run.

HGSS inspection found visual ball-effect calls for ordinary appearance, recall,
PC recall, and warp recall, but no paired dedicated sound call in those callers
or in the effect implementation. No speculative White 2 sound was added.

Delivered SHA-256:

- stock 0.6.23-alpha: `4c5631fedd80f44ac5806dda49f9091819d228d9f36e379bc0342cbca282eea6`.
- White2Upgrade 0.7.14-alpha: `767ea9540562d0b20869687db71af08f0cdcc466fd55dd83776f5aa869e88544`.

Each same-basename save is byte-identical to the preceding profile release.

## Stock 0.6.22 / White2Upgrade 0.7.13 follower-gift correction

The supplied DeSmuME state showed a completed generic Mew conversation and no
selected gift rule, even though its authored zone-427/Mew rule should match.
The gift path passed the field event's `GameSystem*` to native Party and Bag
accessors whose audited ABI requires `GameData*`. The corrected field module
reads `GameData*` from `Field + 0x08`; event ownership continues to use the
separate `GameSystem*`. The Bag accessor signature is now recorded in the
binary contract. Fainted selected followers are no longer rejected during
identity revalidation, matching the stated follower selection policy.

The packaged ARM946 interaction test now installs a real one-rule follower-gift
NARC and requires a zone-427 Mew to call the Party and Bag adapters with
`GameData*`. It verifies full-Bag behavior leaves the claim clear, failed Bag
insertion restores the prior metadata word, successful insertion sets slot 0,
and a repeated conversation cannot grant it again. The existing 100-conversation,
continuity, scene, ambient-NPC, render, relocation, stack-alignment and
ARM/Thumb checks passed for both profiles. Host reaction tests, 29 focused web
tests, export/reopen/reinstall/disable/remove checks, and the production web
build passed. Native services are mocked in CPU tests; no DS emulator was run.

Delivered SHA-256:

- stock 0.6.22-alpha: `880780dbaf7dea774f1dbaa31df48c5baac8dded0cc870edb54a5debb4379218`.
- White2Upgrade 0.7.13-alpha: `c365e83863a7720a9e43c65ff5e58d7436e2312550b36a3bd6c1982cdba7cd35`.
- White2Upgrade zone-427/Mew gift fixture: `58ed9124a1e0ef3235bfedeec7e1bb1edcd1f7e2c56548d172fdba920183bbf2`.

Same-basename saves are byte-identical copies of the preceding releases. The
ordinary releases keep the intentional empty gift archive; the dedicated test
ROM contains slot 0, Master Ball ×1, zone 427, species 151.

## Stock 0.6.21 / White2Upgrade 0.7.12 contextual-zone correction

The supplied DeSmuME state contains a valid two-rule contextual archive. Rule 0
requires zone 427 and species 151 and contains the authored Aspertia City text;
rule 1 is the wildcard “Mew is looking around.” fallback. Runtime diagnostics
showed contextual rule 1 selected. The selected species was 151, but both player
and follower actor zone fields were zero. The live field object contained zone
427 at verified offset `0xE0` (and again in its current spawn state at `0xE8`).

The field interaction snapshot now reads the field object's 16-bit zone ID at
`0xE0`. The binary contract records this offset. A host regression constructs
the reported mismatch—actor zone zero, field zone 427—and requires the snapshot
adapter to return 427. Both packaged field modules passed hook, relocation,
ARM/Thumb, interaction, 100-conversation, scene, continuity and render checks.
The web tests passed 29 focused cases and the production build completed.

Migration checks updated installed 0.6.20 and 0.7.11 ROMs to 0.6.21 and 0.7.12,
respectively, while retaining an authored zone-427/Mew dialogue through export
and reopen. The exact in-game custom line remains pending the user's emulator
test. Same-basename saves are byte-identical to the preceding releases.

Delivered SHA-256:

- stock 0.6.21-alpha: `095425d5e95eea20555b25d9265a663826c6d7207d257b50809d2317943b438a`.
- White2Upgrade 0.7.12-alpha: `63f18530aded8506b5db63fab2a7db6f628dc8d318af301b8d5942725a128782`.
- White2Upgrade zone-427/Mew regression ROM: `e72d3c1916dd430ff21d4f8a40c2b3caaf0fda3de0b4f89ff5c9cc52df81ec19`.

## Stock 0.6.17 / White2Upgrade 0.7.8 stationary follower animation

See [IDLE.md](IDLE.md). A visible follower in ordinary `Following` state now
runs the existing native directional billboard loop while stationary. The native
animation-pause flag remains set during follower interaction, retained external
dialogue/menu/PC and safe-scene pauses, hidden/waiting/suppressed state, and
private send-out or recall effects. Returning to ordinary exploration resumes
the loop without changing the actor position, trail, spacing, depth policy,
collision policy, registry, asset resources, save data or heap buffers.

Executed on both final packaged profiles and ROM exports:

- Host follower logic and 23 project/model tests pass. The native ARM fixture
  checks every follower state with visible/hidden and effect-busy combinations
  at three load addresses; it verifies the only enabled combination is visible
  ordinary following.
- The 100-cycle conversation-return fixture verifies that a follower freezes
  throughout its own conversation and resumes idle immediately after the owned
  event returns. The 100-cycle retained-menu/scene fixture verifies the same
  pause/resume transition for an external menu while preserving the actor and
  trail. Native UI, event, rendering and geometry services are isolated spies.
- Both full package builds pass their existing hook, relocation, stack-alignment,
  movement, conversation, scene, continuity, render and asset validations.
  Stock export/reopen/reinstall/disable/reenable and removal/reinstall pass.
  Upgrade verification confirms 4,718 appearance records, 1,256 imported
  resources without visible sentinel magenta, 362 original payloads preserved,
  and its fingerprint/conflict checks.
- The web production build passes. The fixed code/data/BSS payload is 43,212 B
  stock (+60 B) and 44,192 B Upgrade (+60 B). No new dynamic allocation,
  follower sidecar field, registry record or buffer was added. Packaged module
  symbol names remain stripped.
- Delivered same-basename saves match the preceding profile release byte for
  byte: stock 0.6.15 and Upgrade 0.7.6 respectively.

Delivered SHA-256:

- stock 0.6.17-alpha: `0aff2f33662576d78ba492d2c5736576fe89a93c51eb4c34ad2ac7439324013f`.
- White2Upgrade 0.7.8-alpha: `d6707f7b75369c93c0f3c6b0a359124f02a6e0e61dedc462e4efa36bf87edac6`.

No DS emulator or hardware execution was performed. Cold boot the copied ROM
with its matching copied save and record I01–I05 in EMULATOR-CHECKLIST.md; for
Upgrade also record U17 in WHITE2UPGRADE-CHECKLIST.md.

## Stock 0.6.15 / White2Upgrade 0.7.6 width-dependent spacing

See [SPACING.md](SPACING.md). Maximum opaque width across both sideways walk
poses/directions determines 0–6 extra native world units. Existing registry
reserved bits and a sidecar padding byte hold the value. Record sizes, ROM
registry sizes, 256-sample trail capacity and all runtime buffers stay unchanged.
Widening uses recorded trail movement, with no new rendering offset or hook.

Executed on both final packages and ROMs:

- 23 focused project/model tests, sanitized movement/selection/suppression tests,
  eight import tests and reaction suites for both roster limits. Width tests
  cover transparency, padding, mirrored/asymmetric sides, pose maxima and formats.
- Every gap 0–6, both horizontal and vertical directions, walking/running,
  reversals, idle facing, elevation and repeated bends in host trail tests.
  Packaged ARM946 trail tests execute at three relocation addresses.
- 232 immediate packaged calls checked; 100 conversation, scene, menu/PC and
  identity-return cycles per profile. Wider horizontal conversation reach accepts
  both sides and rejects obstructions, excessive distance and vertical widening.
- 12,000 rendering submissions and 3,400 native initial-NPC placements per profile;
  existing scene, wandering-NPC, teardown, rail and zone continuity fixtures pass.
- All 2,574 stock / 4,718 Upgrade appearance records match spacing recalculated
  from delivered artwork. Zekrom/Koraidon use six extra units; narrow art uses less.
- Packaged ROM-backed selection checks each appearance and fallback, cached gap,
  legacy zero-gap formats, all 65,536 object mappings, 16 injected failures and
  100 registry lifecycles with zero registry heap allocations and balanced files.
- Both install/reinstall, disable/re-enable, remove/reinstall and export/reopen
  tests pass. Migrations from 0.6.14 / 0.7.5 preserve resources/descriptors and
  install one copy of each module with the updated spacing metadata.
- Upgrade retains 362 original payloads; 1,256 imported resources decode without
  visible sentinel-magenta pixels. Both delivered saves match previous saves.
- Production web build passes. The full suite had 1,396 passes, three skips and
  three map-import timeouts; an isolated rerun passed all 15 map-import tests.
  No unrelated test or timeout configuration was changed.

Fixed code/initialized-data/BSS totals are 43,152 bytes stock (+192) and 44,132
bytes Upgrade (+244). Sidecar and BSS buffer capacities are unchanged. These are
not whole-game peak heap measurements; native graphics/UI, loader bookkeeping,
stack and VRAM are separate. See [MEMORY-AUDIT.md](MEMORY-AUDIT.md).

Delivered SHA-256:

- stock 0.6.15-alpha: `d699a75d7173cb41b42c62f1f79776affc10073639c2f7718b300bbaf3ab3918`.
- white2upgrade 0.7.6-alpha: `114de93135ebcfa1a12bb78d16d07628af05db8500b84efcf6d289d9d69847b5`.

Evidence: `build/validation-spacing-0.6.15-0.7.6.json` and
`build/spacing-validation-logs/`. Native services and GPU calls use isolated
spies; these checks do not constitute a DS emulator run. Human acceptance is
pending W01–W05 in EMULATOR-CHECKLIST.md and U16 in WHITE2UPGRADE-CHECKLIST.md.
Cold boot the versioned ROM with its matching ordinary save.

## Stock 0.6.14 / White2Upgrade 0.7.5 seamless-zone correction

See [CONTINUITY.md](CONTINUITY.md). The preceding packages reproduced a false
initial-placement collision (reason 4) and unsupported `0x1D9` recall (reason 1)
in CPU fixtures. New actor placement now checks its endpoint; initialized
movement retains its swept collision check. The verified pending NPC placement
command is allowed. No new hook, bridge ABI, heap allocation, or render change.

Executed on both final packaged profiles:

- 100 passes through all 34 NPC initial placements from the reported zones:
  3,400 native position-initialization checks preserving the follower and trail.
- Direct spawn-on-follower still recalls before writing; genuine initialized
  movement still recalls when its route crosses the follower with a clear endpoint.
- Native spawn-data helper preserves live actors and rejects out-of-range
  indices and rail entities. Floccesy Town / Route 20 setup entries contain 16
  and 27 reachable commands respectively; all are covered by the reviewed policy.
- Existing 100 zone deletion, 100 menu/PC, 100 unchanged and 100 changed identity
  storage cycles; conversation, event, ambient-collision and teardown checks.
- 223 packaged immediate calls, relocations/ABI and 12,000 rendering submissions.
- All 21 project/model tests, sanitized host logic tests, production web build.
- Both final ROMs: reinstall, disable/re-enable, removal/reinstall, export/reopen;
  migrations from stock 0.6.13 and Upgrade 0.7.4. Upgrade preserves 362 original
  payloads; 1,256 imported resources decode without visible sentinel magenta.
- Delivered `.sav` files match their preceding profile's saves byte-for-byte.

Fixed code/data/BSS payload is 42,960 bytes stock and 43,888 bytes Upgrade:
20 bytes more per profile, with no new allocation or larger buffer. This excludes
native resources, loader bookkeeping, stack and VRAM.

Delivered SHA-256:

- stock 0.6.14-alpha: `4cf1e21f7b6e240d2badd214d17f963ce342819dad60b5ce4097bd3001e264e4`.
- white2upgrade 0.7.5-alpha: `84e00af01e3b6ec9f5b2afc5b51c1a6b999ff1be8bb052e8b9f40374568cf6a2`.

Receipts/logs: `build/validation-seam-0.6.14-0.7.5.json` and
`build/seam-validation-logs/`. The supplied pre-transition state was inspected,
not advanced. CPU fixtures isolate UI, geometry, allocation and rendering;
these results are not a DS emulator run. Cold boot using the copied `.sav`,
then test X07 between Floccesy Town and Route 20 in both directions, including
walking, running, stopping and turning. Repeat X01/X04/X05 and confirm doors and
warps still recall. Current-release emulator acceptance remains pending.

## Stock 0.6.13 / White2Upgrade 0.7.4 continuity

See [CONTINUITY.md](CONTINUITY.md) for causes and exact policy. No new native
hooks were required. The contract now verifies PC overlay 33 as well as ARM9,
12 and 36; the installer loads all contract-required overlay segments.
Resident event ABI 4 adds identity to the one-shot storage snapshot. Core ABI 2,
artwork, ROM registry cache and 8 KiB conversation capacity are unchanged.

Executed on both final packaged profiles:

- 223 valid immediate calls, relocations, preserved registers, stack alignment
  and previous ARM/Thumb regressions.
- 100 menu-close and 100 PC presentation/fade cycles; exact callback validation,
  recycled event identities, unknown children and unrelated fade rejection.
- 100 unchanged-identity and 100 changed-identity storage reconstructions.
  Identical species with a different personality rejects the old pose. Hidden
  followers cannot create visible-return snapshots; ABI mismatch fails closed.
- 100 native streamed-zone deletion cycles retaining the follower and its trail
  while deleting ordinary actors. Explicit follower deletion remains effective;
  created followers independently carry zone-retention and non-save flags.
- Existing conversation, completion-frame, scene and ambient collision checks;
  12,000 render submission frames per profile with GPU calls isolated as spies.
- The actual US PC bank 1244 has 37 reachable command types; normal storage
  paths are classified, while records/mailbox/manual applications remain
  conservative. Audited Upgrade input has the same relevant script coverage
  and native hook/adapter bytes.
- Sanitized host logic and all 21 project/model tests; TypeScript/Vite build.
- Fresh installation twice; actual-ROM reinstall, disable/re-enable,
  removal/reinstall, export/reopen; migrations from stock 0.6.12 and Upgrade
  0.7.3. Upgrade verification preserved 362 original payloads and decoded 1,256
  imported resources without visible sentinel magenta.
- Both delivered saves match the preceding release saves byte-for-byte. Source
  saves remain intact.

CPU fixtures mock UI, map/rail, allocation and rendering services as documented
in each harness. They are not DS emulator execution. Cold-boot tests X01, X04,
X05 and X07, and Upgrade U07a, remain assigned to the user. Full-screen storage
reconstructs the native field; it cannot retain the original actor allocation.

Fixed payload is 42,940 bytes stock and 43,868 bytes Upgrade (+532 each), with no
new heap allocation. These totals exclude native resources, loader overhead,
stack and VRAM. See [MEMORY-AUDIT.md](MEMORY-AUDIT.md).

Delivered SHA-256:

- stock 0.6.13-alpha: `f05119ea5742062ebd0bd4bba7c737467084f8b9b2889953d7ec0a055d4745e2`.
- white2upgrade 0.7.4-alpha: `1af5659bb58c580ebe1f426cdc81ca562e9a6ba14098d4531efceae39d250f71`.

Receipts/logs: `build/validation-continuity-0.6.13-0.7.4.json`,
`build/continuity-validation-logs/` and both versioned test-build directories.

## Stock 0.6.12 / White2Upgrade 0.7.3 ambient NPC collisions

Ordinary autonomous NPC collision queries now consider the visible follower.
Their native blocked-step behavior waits/retries; player movement, trainer sight
and queries outside that callback retain retail results. Tracked scripts retain
recall priority. Before moving, the follower checks native NPC current/previous
or reserved rail positions. A blocked follower recalls and reseeds from later
safe movement. Controllers ignoring collision results trigger recall before a
conflicting world-position write. Rail fallback uses native world separation,
including when two actors are in the same grid cell.

Three new binary boundaries are pinned: overlay 12 callback dispatcher
0x021671C8, four-argument grid collision 0x0215E538, and overlay 36 rail collision
call 0x02195714. The grid trampoline preserves its live Z argument and replays
the complete displaced prologue. Event bridge ABI 3 registrations are cleared on
field unload. Core ABI 2, rendering, registry format and artwork are unchanged.

Executed automated verification for both final packages:

- 218 packaged immediate-call checks, relocations, preserved registers and stack
  alignment, including the prior ARM/Thumb regression.
- 100 ambient callback cycles using the original native grid collision scan;
  player/outside-query/script exemptions; hidden, height, dimensions, old-tile
  reservations, follower blocked-trail handling and unload behavior.
- Original wandering state-machine blocked/retry branch, followed by successful
  movement when the follower vacates the destination. RNG and terrain conversion
  are isolated test services; NPC retry instructions are original ROM code.
- Resolved rail destinations, native sphere/elevation calculation, separate
  world positions within a grid cell, native reserved endpoints, and fallback
  recall before position writes. Rail/map evaluation services are mocked.
- Existing 100 conversation, 100 conversation-return and 100 scene cycles;
  12,000 rendering submissions with GPU draw spies. Gen 6–9 conversations remain
  included in the Upgrade package tests.
- Sanitized host tests and all 21 project/model tests; production web build.
- Actual ROM reinstall, disable/enable, removal/reinstall and export/reopen;
  stock 0.6.11 and Upgrade 0.7.2 migrations. Fingerprint/conflict checks and
  preservation of the original 362 Upgrade file payloads pass.

The new fixed payloads are 42,408 bytes stock and 43,336 bytes Upgrade: an increase
of 1,328 bytes each over the preceding memory-reduction release, including only
4 additional BSS bytes. The rest is code/initialized data. No new heap allocation
or large buffer is introduced; 1 KiB registry pages and 8 KiB conversation data
capacity remain. Loader overhead, stack, native resources and VRAM are separate.

Final ROM SHA-256:

- Stock: `665c84916d4bbacefe2cd5fb831ce44f0133766c7ca0e1ddb9865b13f71f9ef5`.
- Upgrade: `5b58226facdbc4468984a36ad917814212a13302e8120fba90e98628c93f092a`.

Detailed receipts are in `build/stock-0.6.12-test/`,
`build/upgrade-0.7.3-test/` and `build/validation-ambient-0.6.12-0.7.3.json`.
ROMs and matching copies of the preceding saves are in `Repos/`; source saves
remain intact. Artwork, descriptors, registry, effects and conversation data
fingerprints match the preceding releases. Human cases N01–N08 and Upgrade U15
are NOT RUN. Cold boot from an ordinary save rather than loading an older state.
No game emulator or hardware was run for this release.

## Stock 0.6.11 / White2Upgrade 0.7.2 memory reduction

Both profiles leave the complete appearance registry in ROM, stream validation
through a 1,024-byte cache, and retain only a 16-bit species index and current
page. Core bridge ABI 2 invokes the reader synchronously and retains no callback.
All open files close before returning. Field unload clears lookup bounds/cache.
The only newly used native adapter is the audited ARM9 FS seek wrapper; its
expected bytes, ABI and instruction boundary are recorded in the contract.
No movement-history, artwork, render-correction or save-format changes were made.

Conversation capacity is 8,192 bytes, with 3,852 bytes of current data. Build,
installation and runtime reject oversized data. Upgrade reaction selection now
supports 1–1023, while stock retains 1–649 and Eggs remain invalid. Later-species
cry calls receive the actual species; no new sound assets are included.

Measured fixed code/data/BSS plus separate registry payload:

| Profile | Previous | New |
|---|---:|---:|
| Stock | 143,964 B (0.6.10) | 41,080 B (0.6.11) |
| Upgrade | 102,612 B (0.7.1) | 42,008 B (0.7.2) |

There is no separate registry allocation in either new build. The included
index/cache sizes are 1,302/1,024 bytes stock and 2,050/1,024 Upgrade. Totals
exclude loader bookkeeping, allocator overhead, stack, native graphics/UI and
VRAM. They are not measured whole-game peaks. Both DLL packages remain stripped.
See MEMORY-AUDIT.json and its generator for reproducible object measurements.

Executed automated checks:

- Sanitized host logic/reaction/import checks for both species limits; every
  reaction rule, HP/status/friendship boundaries, names, 8,192-byte acceptance and
  8,193-byte rejection. All 21 project/model tests passed; production web build passed.
- Final packaged registry tests: all 2,574 stock and 4,718 Upgrade exact appearances,
  3,872/6,764 total lookup cases, multi-page stock Unown, cache hits without reads,
  all 65,536 object codes, 100 setup/cache/unload cycles per profile, 15 failure
  cases each, zero registry allocations and balanced file opens/closes. Native
  FS seek instructions execute; the synchronous filesystem dispatcher is mocked.
- Packaged reaction selection for every species 1–649/1–1023, rejecting Eggs;
  100 Upgrade conversations rotate species 25, 649, 650, 722, 810 and 1023.
  Native message, cry, actor and effect services are mocked.
- Both builds pass 207 immediate-call checks, ARM/Thumb relocation/ABI execution,
  100 conversations, 100 conversation-return cycles, 100 scene cycles, and
  12,000 render submissions. These use CPU execution and native-service spies,
  not a DS GPU or game emulator.
- Isolated original Upgrade-state regression: three setup/cache/unload cycles
  retain all 100,332 bytes free on application heap 1 throughout. Registry heap
  allocation count is zero. This excludes actor/graphics and loader peaks.
- Both actual ROMs pass reinstall, disable/enable, export/reopen, removal and
  reinstall. Real stock 0.6.10 and Upgrade 0.7.1 migrations preserve appearance
  data, descriptors and artwork. Upgrade fingerprint/hook conflict rejection,
  all 362 original file payloads and 1,256 imported resource palette checks pass.

Delivered ROM hashes:

- Stock 0.6.11: `67be3e20df382512cba8310bebd8ede45a9f00a0eb0708a0b13731510ebcbc37`.
- Upgrade 0.7.2: `cfc2aa971ed2189661e52b6358f516eb02012da7f29998e9af397284b4612f0d`.

Build receipts, stream tests and snapshot evidence are in
`build/stock-0.6.11-test/`, `build/upgrade-0.7.2-test/` and
`build/validation-memory-0.6.11-0.7.2.json`. ROMs are copied to `Repos/` with
matching saves copied from stock 0.6.10 and Upgrade 0.7.1; originals are preserved.
Cold boot from those ordinary saves, not older emulator states. Begin with
M01–M04 in EMULATOR-CHECKLIST.md and U01/U02/U06/U13/U14 in the Upgrade checklist.
No game emulator or hardware was run for this release.

## White2Upgrade 0.7.1 startup memory correction

The user reported no follower in 0.7.0 and supplied `nofollowers.mln`. Read-only
inspection found 2,821 follower updates, no actor creations, suppression reason
1 (configuration failure), cached failed configuration, a null registry buffer,
and a live event bridge. The captured application heap has 100,332 free bytes;
0.7.0 required 146,032 bytes including its safety reserve. The previous lifecycle
test used a mocked 1 MiB heap and did not establish actual game headroom.

The 0.7.1 runtime uses lossless FWDB v2 packing: 4,718 appearance records occupy
56,648 bytes including the header. All keys, descriptor/resource references,
placeholder/size/animation flags, signed offsets and zone diagnostics survive
conversion. Sprites and descriptor archive hashes are unchanged. Stock runtime
packaging remains 0.6.10 and uses v1. Upgrade installation recognizes 0.7.0,
preserves its assets and enabled state, and stages the converted registry with
all three matching modules. `FWCG` diagnostics report setup stage and heap use.

Executed automated checks:

- 21 project/model tests, including packed metadata, corruption and v1/v2 conversion.
- Packaged runtime tests: 100 conversation, 100 scene and 100 registry lifecycle
  cycles; 12,000 render submissions; all 65,536 object mappings; species 1–1023;
  NULL/low-heap and missing/short/corrupt registry failures. Heap fixtures now use
  the captured 100,332-byte budget. 103 allocations match 103 frees.
- Isolated native heap regression using copied state RAM: the final packaged
  configuration succeeds in three load/cache/unload cycles, leaves 43,640 bytes
  free while loaded, and restores 100,332 on unload. Native allocation/free code
  and heap metadata execute; filesystem responses come from the exported ROM.
  No actor creation, GPU rendering or game emulator runs in this test.
- Real 0.7.0 upgrade/export/reopen, lossless registry migration, unchanged artwork;
  fresh install, reinstall, disable/enable, removal/reopen/reinstall; conflict
  rejection; 362 original Upgrade file payloads preserved. Production web build.

ROM SHA-256: `9986c0a6b8ed0f7f3b2242509d7521a99fe2ee9e2149f54eb23f0f259c29301f`.
Detailed receipt and snapshot evidence are under
`build/white2upgrade-0.7.1-test/` and `build/validation-white2upgrade-0.7.1-alpha.json`.
The preceding 0.7.0 ordinary save is copied to the new basename, without modifying
the original. Cold boot the new ROM and walk at least two tiles; then check doors,
PC return and battle return. User emulator acceptance and hardware remain pending.

## White2Upgrade 0.7.0 expansion profile

The user accepted stock 0.6.10 as good enough. This is a user-reported result,
not evidence that every earlier emulator checklist row was executed.

The expansion profile preserves that follower behavior and adds species 1–1023.
The installer requires the audited Upgrade runtime fingerprints, unchanged
native adapters and nonconflicting PMC relocations. No reference/source ROM
was rebuilt or modified. Existing Upgrade modules and original file payloads
are preserved; standard NARC header normalization may change container bytes.

The supplied fan-game sheets now provide normal/shiny base artwork for all 374
supported Gen 6–9 species. Converted data contains 904 PNG resources and four
HG-engine resources, covering 1,658 appearance keys with 120 explicit alternate
form substitutions. Of the PNG resources, 177 use deterministic 15-color
reduction without dithering; index zero follows alpha, not RGB. All 904 were
regenerated and compared byte-for-byte, then decoded to verify each source crop,
up/down/left/right mapping, transparency and exact unquantized palettes. A
22-species contact sheet was visually reviewed. This is asset review, not a DS
rendering result. The coverage/checklist generator was regenerated after the
new source pack replaced the earlier missing Gen 9 placeholders.

A pre-delivery memory audit caught the enlarged static registry exceeding the
small PMC heap. The expansion DLL now allocates its 113,264-byte registry from
application heap 1 with a free-space guard and the verified non-asserting core
allocator. Field code/BSS totals 43,796 bytes. Packaged CPU tests exercised 100
load/cache/unload cycles: 103 allocations and 103 frees including missing,
short and corrupt reads; low heap and NULL allocation fail safely. Actual game
heap headroom remains a human emulator check.

Additional executed checks passed:

- Packaged ARM946 instruction/relocation checks and the previous ARM/Thumb
  regression, including 206 immediate calls; 100 conversation and 100 scene
  cycles; 12,000 render submission frames and retail main-pass routing.
- Selection for all species through 1023, rejection of reserved Egg IDs, the
  complete 4,718-entry registry and all 65,536 object-code mappings.
- 1,256 imported resources decoded in all directions/animation frames with no
  visible sentinel magenta; 362 original file payloads preserved.
- Actual installation/export/reopen/reinstall, disable/reenable, removal and
  reinstall on the expansion ROM, plus the stock 0.6.10 installation regression.
- Modified expansion runtime and conflicting hook rejection before mutation.
- Twenty project tests, host logic/projection tests and production web build.

Native FS, heap, rendering, UI and actor services are mocked in CPU tests.
No DS emulator or hardware was run. Cold boot with the matching ordinary save
and follow [the expansion checklist](WHITE2UPGRADE-CHECKLIST.md). The copied
save is byte-identical to the prior 0.6.10 save; the original remains intact.

ROM SHA-256: `535e565e8f4e51421d794789d8ac623949082885142c1b5f3126b18feb2768f2`.
Field DLL SHA-256: `9b46bf7bc685e6d892da0a7fb1c4e1f1af2ced35e5ccf03dd1b0d33762587673`.
Save SHA-256: `313048122da76c5d98a025b93b67e609ad0ca2db4d1045e50c62a8e8a84e9c2a`.

## 0.6.10 main actor draw routing

Human result for 0.6.9: stair/player ordering and previously improved large-sprite
sideways overlap regressed; flat-ground alternating pixels remained. This result
supersedes any implication that the 0.6.9 numerical tests validated in-game output.

Confirmed cause: the old hook at overlay 36 `0x0218122E` receives the secondary
billboard system from field offset `0xC4`. The follower belongs to the main
system from `0xC0`, drawn at `0x0218119A`. In all three supplied state fixtures,
the actor-system billboard handle equals the main handle and differs from both
secondary and effects handles. The 0.6.9 ownership guard therefore bypassed the
correction. Its removal of the old externalOffset correction exposed the native
rendering problems again. The old test fixture directly passed the actor scene
to FollowingDraw, so its 12,000 numerical checks missed the wiring error.

The field module now intercepts the main actor draw call for correction and
restoration. The existing secondary draw hook forwards normally and retains the
ball-effect draw. The native effects pass is untouched. No further depth-margin
or stair-policy retuning is included in this version.

`verify_render.py` now executes the retail main/secondary/effects argument-loading
blocks with the saved distinct scene handles and packaged Thumb call veneers.
It checks that main submission receives the corrected follower, other passes do
not alter it, all native draws occur once, and registers/stack/quad are restored.
The new check was run against 0.6.9 and failed for the missing main actor hook.
This is a CPU/native-submission test with GPU service spies, not an emulator run.

Fixtures can be reproduced without opening an emulator:

```sh
python3 runtime/following-pokemon/capture_render_bindings.py /path/to/minorheadclip.mln /path/to/stairssink.mln /path/to/stairssideclipping.mln > runtime/following-pokemon/tests/render-bindings.json
```

Executed automated checks passed: three retail scene-binding fixtures; 12,000
packaged render submission frames; 1,728 projection cases; packaged instruction,
relocation and ARM/Thumb checks; 100 conversation and 100 scene cycles; host logic,
19 project tests, field ABI/unload/save-exclusion checks, and the production web
build. Fresh install/export/reopen/reinstall, disable/reenable, removal/reinstall,
and upgrade of the actual 0.6.9 ROM to 0.6.10 all passed without duplicate modules.

The versioned ROM and matching save were delivered to the requested Repos folder.
The new save is byte-identical to the previous alpha save; existing saves remain
unchanged. Emulator and hardware execution were not performed. Human acceptance
remains pending: cold boot from the ordinary save and check Zekrom stair ordering,
large and small followers moving sideways, and building frontage occlusion.

ROM SHA-256: `cc656b280161d21b405b66440dc37cace2c9b77ee56d487dc3b08c6d493aeff8`.
Field DLL SHA-256: `273fd0278a238d033a9ad3f21976e14d0a1a65ccfbeb3de794e38aa6e926dd74`.
Save SHA-256: `313048122da76c5d98a025b93b67e609ad0ca2db4d1045e50c62a8e8a84e9c2a`.

## 0.6.9 final-submission depth correction

The user reported that 0.6.7 and 0.6.8 still show alternating actor overlap and
building clipping. The earlier log identified the sideways example as Tornadus;
the inspected screenshot appears to show Sigilyph, whose imported resource is
32px and was excluded by the old correction. Historical offset assertions below
are not proof of visual correctness or successful final GPU submission.

This version removes the update-time externalOffset correction and applies a
temporary change to the owned follower's final native billboard immediately
before drawing. It uses the camera eye/target and final player/follower positions,
including native animation/control offsets. Both sizes participate. Flat ties
use 1/8 world unit plus a 1/256-unit rounding allowance; actual displacement is
only what is needed to meet separation. Perspective translation and quad scale
change together to preserve the projected artwork. Translation/scale are restored
after native drawing, including repeated draws without an intervening update.

Large-sprite stairs retain distinct native/foreground/lower-side policies; the
flat tie rule is not applied across a height difference greater than two world
units. Unsupported projection/billboard types or invalid bindings forward native
drawing unchanged. No new hooks, native locks, actor coordinates, trail state,
save fields, texture resources, or shared polygon attributes are changed.

Executed checks:

- 1,728 independent projection cases across both sizes, perspective/frustum/
  orthographic projection, 24 camera yaws, six pitches and both bob phases.
  Tests bound projected corner drift and verify stable flat depth separation.
- 12,000 final packaged DLL submission frames (100 complete 20-frame cycles per
  size/projection combination), plus camera rotation, final player offsets,
  stair cases, repeated draws and invalid binding/camera checks. The native
  draw spy observes corrected values; actor/trail/scene memory is restored.
- Packaged ARM946 instructions/relocations and the previous ARM/Thumb regression;
  100 retained-actor conversation cycles and 100 scene cycles; event command
  classification and lifecycle/ownership checks. Native GPU/UI services are
  mocked; these are not game-emulator runs.
- Sanitized host logic and eight Python test methods, 19 project tests, field
  forwarding/unload/save exclusion, core mapping and wide-offset checks, and
  production web build passed.

Fresh install/export/reopen/reinstall, disable/reenable, removal/reinstall, and
an actual 0.6.8-to-0.6.9 upgrade all passed. Runtime/data fingerprints survive
reopening, and each module appears once. Automatic ROM/save delivery completed.
The delivered save is an exact copy of the previous alpha save; existing saves
are preserved. No emulator or hardware result is claimed. Cold boot with an
ordinary save and prioritize checklist D04 (Sigilyph), D12 (building frontage),
and D07–D10 (stairs). A custom follower renderer remains outside this change.

ROM SHA-256: `ebca91ba320d606ec3be7efc752882be36af16d176f5598747af373904e965f9`.
Field DLL SHA-256: `75646645ec262e5a07dade75af572b490dddabdf1d299ef4885753b9280a813b`.
Save SHA-256: `313048122da76c5d98a025b93b67e609ad0ca2db4d1045e50c62a8e8a84e9c2a`.

## 0.6.8 flat-ground map-depth balance

The user reported that the 0.6.7 eight-pixel equal-elevation correction moved a
wide Cobalion billboard far enough behind the player that nearby facade pixels
cut into artwork which should remain in front of the building. This is the
opposite bound of the earlier two-pixel actor-order flicker.

Version 0.6.8 uses a four-pixel equal-elevation margin, midway between the two
observed failure bounds. It continues to classify lateral overlap as behind the
player and corrects animation-shifted frames, while halving the map-depth
displacement introduced by 0.6.7. Unequal-elevation stair policies, foreground
handling, 32-pixel sprites and the repaired Gen 5 palettes are unchanged.

Executed automated checks:

- Sanitized host and packaged ARM946 tests keep neutral and animation-shifted
  flat-ground cases in the behind class. The host test bounds the neutral
  correction below four pixels per world component, preventing a return to the
  0.6.7 displacement.
- The 100-cycle publish build passes packaged relocation, ARM/Thumb,
  interaction, conversation-return and scene checks, including all 65,536
  opcode classifications with native services mocked.
- The full Gen 5 palette audit still reports 17 repaired resources and 39
  repaired entries with no visible near-sentinel magenta.
- Project tests and the production web build pass. Fresh install/export/reopen,
  disable/reenable, removal/reinstall and an actual 0.6.7-to-0.6.8 upgrade pass.
- The delivered save is byte-identical to the 0.6.7 save, SHA-256
  `313048122da76c5d98a025b93b67e609ad0ca2db4d1045e50c62a8e8a84e9c2a`.

Delivered `White2-Following-0.6.8-alpha.nds` and its same-basename `.sav` to
the workspace parent directory. The ROM SHA-256 is
`6279929cf0633cf265045a046cff49cf3e558a09511ba70698b22b91ac40d849`.
The field, event and core DLL hashes are respectively
`481b56d37d2be98ff8db891642f76b181c8eb1b5923d6542e6517070e33d0555`,
`51f3a5ad5aeefcef8b0403607c79ba8c8237f950adf5ec7525d091863f080636`, and
`23c286b07ba85a1576551fc56a349dfec79ff1910a5f1817c3863a4a925f7d35`.

No emulator or hardware result is claimed for 0.6.8.

## 0.6.7 flat equal-elevation separation

The user supplied two screenshots of Tornadus moving laterally through the
player on flat ground. Different animation frames place intersecting parts of
the 64-pixel follower on opposite sides of the player even though both actor
anchors remain at the same elevation. The runtime catalog confirms that both
Tornadus forms use the 64-pixel renderer.

Version 0.6.7 increases only the equal-elevation behind margin from two to eight
pixels along the camera axis. The lateral half-tile classification remains
stable, but the larger separation prevents per-frame draw offsets from crossing
the player plane. The four-pixel lower-stair clamp, elevated native-depth rule,
foreground margin and all 32-pixel native rendering are unchanged.

The user also reported opaque bright-pink pixels across every direction of an
imported Landorus. An audit of the complete imported Gen 5 set found 39 used
sentinel-magenta palette entries across 17 shiny resources. The deterministic
importer now substitutes the corresponding normal-palette entry only for those
sentinels and records every repaired index in the generated manifest. The asset
verifier decodes both animation frames in all four directions for all 624 Gen 5
appearance keys and rejects any remaining visible near-sentinel magenta.

Executed automated checks:

- Sanitized host and packaged ARM946 tests apply the stronger flat-ground
  margin with zero and animation-shifted draw offsets. Both remain in the
  behind class with negative camera-axis correction.
- The Gen 5 verifier decodes every direction and both walk frames for all 624
  appearances. It reports 17 repaired resources and 39 repaired entries, with
  no remaining visible near-sentinel magenta.
- The 100-cycle publish build passes packaged relocation, ARM/Thumb,
  interaction, conversation-return and scene checks, including all 65,536
  opcode classifications with native services mocked.
- Core, field, effects, asset-catalog, TypeScript project and production web
  builds pass.
- Fresh install/export/reopen, repeated install, disable/reenable and
  removal/reinstall pass. An actual 0.6.6 export upgrades to 0.6.7 with its
  enabled state, updated follower resources and all three modules present once.
- The delivered save is byte-identical to the 0.6.6 save, SHA-256
  `313048122da76c5d98a025b93b67e609ad0ca2db4d1045e50c62a8e8a84e9c2a`.

Delivered `White2-Following-0.6.7-alpha.nds` and its same-basename `.sav` to
the workspace parent directory. The ROM SHA-256 is
`bc2fe10cd0372c1ec53a63181b24174a6e4ccc2bdc25a6aabcb6965aeeb019f7`.
The field, event and core DLL hashes are respectively
`23a347b389cddcdd403b2127231424900e1ba7cc0ce58207bb5b4199580824e9`,
`9536e2f107454e71fd0b5bf23bc4fe56eaa1a46743823b770f33734fcafd0767`, and
`0b2e4aea438da6ce6920ce535ee5a4e1bbf18131032fb1fcbc36e071ea6a827b`.
The repaired Gen 5 resource NARC SHA-256 is
`0ff200ce1eebcdf3f9b02a3ea2d73bb4fc88d491899f3fa2644d4b389785fec8`.

No emulator or hardware result is claimed for 0.6.7.

## 0.6.6 partial-elevation lower-side clamp

The user reported 0.6.5 as almost correct and supplied `minorheadclip.mln`,
SHA-256
`472556aeae466f12c5ec9c808d996cb88aebccbf907499d1cfb91b5643e2a08c`,
showing a few rear-railing pixels still covering Zekrom's head. The follower is
one tile lateral while its world anchor is 32,740 fx32 units below the player,
about half a tile, with a `(−8192, 6144, −8192)` draw offset. The saved 0.6.5
diagnostic reports the behind class with zero external correction: the
eight-pixel bound considered this partial-elevation pose already close enough.

Version 0.6.6 tightens only the lower behind/side bound to four pixels. The
reported partial-elevation pose now receives a positive camera-axis correction.
Upper unequal-elevation poses still receive no correction, equal-elevation
side travel retains its two-pixel rule, and foreground handling remains eight
pixels. World, collision, trail and terrain anchors are unchanged.

Executed automated checks:

- Sanitized host and packaged ARM946 tests reproduce both the full lower-step
  case and the partial-elevation `minorheadclip` relationship. Both require a
  positive correction; the two elevated regression cases require zero.
- The 100-cycle publish build passes packaged relocation, ARM/Thumb,
  interaction, conversation-return and scene checks, including all 65,536
  opcode classifications with native services mocked.
- Core, field, effects, asset-catalog, TypeScript project and production web
  builds pass.
- Fresh install/export/reopen, repeated install, disable/reenable and
  removal/reinstall pass. An actual 0.6.5 export upgrades to 0.6.6 with its
  enabled state and all three runtime modules present once.
- The delivered save is byte-identical to the 0.6.5 save, SHA-256
  `313048122da76c5d98a025b93b67e609ad0ca2db4d1045e50c62a8e8a84e9c2a`.

Delivered `White2-Following-0.6.6-alpha.nds` and its same-basename `.sav` to
the workspace parent directory. The ROM SHA-256 is
`b474233528e7fcb5a37d2742bfb93abf880721a9907b2f7fce4be47077e4ee96`.
The field, event and core DLL hashes are respectively
`1ce5f2f4427e9509698a6b279c996b41fc6743e119eb068ccd87fbd2f1517576`,
`8643d9351834317c4fa8ef410db5b656283f8c7faaf2d691f662f1e91fb79501`, and
`f3e6a16dd6c9f16aa9f0318a43112e059c39f948ff7705c890c04acc41ee40bb`.

No emulator or hardware result is claimed for 0.6.6.

## 0.6.5 lower-side stair clamp

The user reported 0.6.4 as much improved and supplied `smallclipsidestairs.mln`,
SHA-256
`a73182b7cdf3a50efbad15f942186b7a884b7515d5a698e179f588452b2cecb2`,
for the remaining case. In that state, Zekrom is one tile lateral and one
elevation below the player while both actors share the same camera-depth world
coordinate. Native actor depth correctly seats the follower on the lower step,
but its 64-pixel artwork extends upward and a rear stair railing cuts through
the head.

Version 0.6.5 distinguishes the two unequal-elevation relationships. An
elevated behind/side follower keeps native map depth, preserving the 0.6.4 fix.
A lower behind/side follower receives an eight-pixel camera-axis clamp. This
limits how far the large billboard can recede behind the player without moving
its world, collision, trail or terrain anchor and without classifying it as a
foreground follower. Equal-elevation and foreground handling are unchanged.

Executed automated checks:

- The sanitized host suite and packaged ARM946 regression include the supplied
  lower-side relationship and require a bounded positive camera-axis correction.
  The two upper-side regression relationships require exactly zero correction.
- The 100-cycle publish build passes packaged relocation, ARM/Thumb,
  interaction, conversation-return and scene checks. The scene suite classifies
  all 65,536 opcodes and preserves native results with services mocked.
- Host logic, core, field, effects, asset-catalog and TypeScript project tests
  pass. The production web build completes.
- Fresh install/export/reopen, repeated install, disable/reenable and
  removal/reinstall checks pass. An actual 0.6.4 export upgrades to 0.6.5 with
  its enabled state and all three modules present once.
- The delivery save is byte-identical to the prior 0.6.4 save, SHA-256
  `313048122da76c5d98a025b93b67e609ad0ca2db4d1045e50c62a8e8a84e9c2a`.

Delivered `White2-Following-0.6.5-alpha.nds` and its same-basename `.sav` to
the workspace parent directory. The ROM SHA-256 is
`10f36524522cb7ea733200e06ec9ff11f39a008099c3ab83a067606d04135613`.
The field, event and core DLL hashes are respectively
`fd317e3657b7113b953adf9dbb7113a3c85c44e2d9f0c67b812646290e16a095`,
`97133db4ea175766e8f5eb0b50544cb586e4d755d05125a290f32c63e8c650cd`, and
`db255cb37a451de3b2b47aaab62cd2f42406fb03d2ed63e13a3d02554487804e`.

No emulator or hardware result is claimed for 0.6.5.

## 0.6.4 unequal-elevation map depth

The user confirmed that 0.6.3 removed the earlier mid-step player-priority
flash, then supplied two new states showing the large-follower correction
crossing map geometry:

- `stairssink.mln`, SHA-256
  `df31d37680081b55e953d98a461140efe4a71d429851e2ce7048f3ac226a3d06`,
  has Kyurem one elevation level above and one camera-depth tile behind the
  player. The 0.6.3 diagnostic offset is `(0, -41213, -28532)` in fx32 units.
- `stairssideclipping.mln`, SHA-256
  `0b9e8b0525ed8539ec6ac796ce9f42e2b34231fc74e7166423b1ebc672469f7c`,
  has Kyurem one elevation level above and one tile laterally beside the player.
  Its correction reaches `(0, -65536, -49766)`.

Both are behind/side classifications. Forcing actor order by moving the whole
billboard backward also moves it behind stair faces and railings, so the map
clips artwork that should remain in front of that geometry.

Version 0.6.4 keeps the native billboard anchor whenever a behind/side follower
differs from the player by more than two vertical pixels. The map then resolves
stairs, railings and walls using the actor's true position. Equal-elevation
side-to-side overlap retains a two-pixel tie-breaker applied before billboard
submission. Foreground followers retain the eight-pixel correction needed for
the confirmed mid-step case.

Executed automated checks:

- Sanitized host tests reproduce the descending and lateral state relationships
  and require a zero correction, while preserving flat behind and foreground
  results.
- The packaged ARM946 regression applies both unequal-elevation relationships
  to the compiled field module and requires all three external-offset components
  to remain zero.
- The final 100-cycle build passes relocation, ARM/Thumb, interaction,
  conversation-return and scene checks. The scene suite classifies all 65,536
  opcodes and preserves native return values with services mocked.
- Host logic, core, field, effects, asset-catalog and TypeScript project tests
  pass. The production web build completes.
- Fresh install/export/reopen, repeated install, disable/reenable and
  removal/reinstall checks pass without duplicate files.
- An actual 0.6.3 exported ROM upgrades to 0.6.4 with its enabled state and all
  three owned modules intact.

Delivered `White2-Following-0.6.4-alpha.nds` to the workspace parent directory.
Its SHA-256 is `54a90621ad505a65163f0b129bb98d7286f82fa76ea1bde36a96b19ebdde119b`.
The field, event and core DLL hashes are respectively
`dc5260432ee8818b30b0273b42636baf81e25e61370775986e6077291110b79c`,
`c0dece9a333277ec156f3618381d4d8f5a521325d3ebf05f1bfe04b967a5ed9b`, and
`d5034231547bc6c80fa139437d3152a0a2222d410c3ff19885df8e82620269c3`.

No emulator or hardware result is claimed for 0.6.4.

## 0.6.3 stair interpolation and X-menu/PC retention

The supplied mid-step state has a 64-pixel Kyurem follower in the foreground
while the player is interpolating upward on the stairs. Its SHA-256 is
`fd9adbd9ebda489ed66a8bf55ca2923c1a42b8429a06d8d25cfc25c62a77edbe`.
The follower movement callback and native billboard submission run inside the
native model update. Version 0.6.2 applied its final correction after that whole
update, so stair interpolation could overwrite the offset used for the current
draw and the correction became visible on the next frame.

Version 0.6.3 applies the same camera-depth decision in the follower callback,
before native billboard submission, and retains the post-update correction as a
fallback. The bounded foreground/background margin increases from two to eight
pixels to cover transient stair interpolation without changing actor world,
collision or trail coordinates. A packaged ARM946 regression invokes the actual
movement callback at the supplied stair relationship and requires the offset to
exist before the draw stage.

The native normal-field event provider exposes a dedicated X-menu flag. The
field module records that exact menu root, pauses the visible follower and keeps
its actor and trail. Unknown child applications do not inherit this exemption.

The retail PC Box application tears down and reconstructs the field. The four
audited PC opcodes now keep the follower visible during terminal presentation
and capture one bounded restore snapshot before Box teardown. Resident bridge
ABI 2 carries the snapshot across field reconstruction. A same-zone, exact
player-position check gates one-use restoration; selection is refreshed from
the current party and the actor appears at the saved follower pose without ball
effects. Stale or mismatched snapshots are discarded.

Executed automated checks:

- Sanitized scene tests cover exact X-menu ownership, unknown menu children,
  PC presentation-child scope, one-use restore transfer and stale restore
  rejection.
- The packaged movement-callback regression confirms that the stair correction
  is installed before billboard submission.
- The final 100-cycle build passed packaged relocation, ARM/Thumb, interaction,
  conversation-return and scene checks. The scene suite classifies all 65,536
  opcodes and covers 100 retained-actor cycles with native services mocked.
- Host logic, compiled core, field-hook, effects, asset-catalog and TypeScript
  project tests pass. The production web build completes.
- Fresh install/export/reopen, repeated install, disable/reenable,
  removal/reinstall and fingerprint checks pass without duplicate files.
- An actual 0.6.2 exported ROM upgrades to 0.6.3 with its enabled state, three
  owned modules and imported assets intact.

Delivered `White2-Following-0.6.3-alpha.nds` to the workspace parent directory.
Its SHA-256 is `118c36f1887997864338d0254f3d853e3469c77c29ded12f97e65b3114add632`.
The field, event and core DLL hashes are respectively
`03d328a9dc6122a5230d629b5ea7542a362b1d3c3d12775f4a67eda4f61cd90c`,
`90409eab9325a0e2f6b6e2b5c02d535fa48c9e487a6928229658b4795a8d891b`, and
`4adac80d5710801d4eb3c01c0c33742fc31fba3b9e78cf916d470e9d74479de7`.

No emulator or hardware result is claimed for 0.6.3.

## 0.6.2 large-sprite draw priority

The supplied stair state has a 64-pixel Kyurem follower at grid `(37, 5, 722)`
and the player at `(37, 6, 721)`. The follower is one tile toward the yaw-zero
camera and one elevation step lower. Its native draw callback supplies only the
retail two-unit negative-Z follower bias, which lets the higher player win the
depth test at the reported overlap. The same fixed map-axis offset cannot keep
equal-depth horizontal movement stable on rotated cameras.

Version 0.6.2 applies a bounded external draw offset only to descriptors marked
64×64. It projects the follower/player horizontal separation onto the live
camera yaw, treats the follower as foreground after a half-tile dead band, and
otherwise keeps it behind. Eight yaw sectors and nine pitch sectors avoid adding
a runtime math dependency. World position, grid position, collision, trail
history and the player actor are unchanged. The diagnostic block now records
camera yaw/pitch, depth classification, applied X/Y/Z bias and model size.

Executed checks:

- The supplied melonDS state parsed successfully with state SHA-256
  `44458687d5226a59834ef5bfd245df048d4d9187531c45a1c707785a08a32851`;
  its actor-system camera yaw is `0x0000` and pitch is `0x2594`.
- Sanitized host tests cover equal-depth horizontal travel, the half-tile dead
  band, foreground/background positions, cardinal camera rotation and diagonal
  bias.
- The final packaged ARM946 module reproduces the supplied stair coordinates,
  checks that the 64-pixel follower receives the foreground offset, checks the
  equal-depth behind offset, checks a 90-degree camera, and confirms that a
  32-pixel follower receives no new offset.
- Packaged relocation, ARM/Thumb, conversation-return and 100-cycle scene tests
  continue to pass with native services mocked.
- Fresh install/export/reopen/removal checks pass, and an actual 0.6.1 exported
  ROM upgrades to 0.6.2 with its enabled state and three owned modules intact.

Delivered `White2-Following-0.6.2-alpha.nds` to the workspace parent directory.
Its SHA-256 is `ce8cb7337389be732e11906d9634b460da75f9b09989e6cff41e03a9e351c682`.
The field, event and core DLL hashes are respectively
`0ae394f60f1e38ff08053fe54af715cd1cfc27483f14bf6f83f60835a1f24660`,
`231832269929065e6dcf6a1cc7f8195b739048376b03e57a43c92ec4ac621557`, and
`ee0d6185583576d095ab5ab538ec645153ceb7a8708b04670bf3f3fd8bcb0336`.

No DS emulator or hardware acceptance is claimed for the draw-priority change.
Run D01 and D02 first from the human checklist using a cold boot.

## 0.6.1 bundled Gen 5 follower sprites

The user reported that the 0.6.0 Gen 5 up/down frames were reversed. Inspection
confirmed that the importer reordered source pairs `2,3,0,1` even though the
source and target controller both use up/down/left/right ordering. Version 0.6.1
preserves source indices `0,1,2,3,4,5,6,7` for 32-pixel resources and
`0,1,2,3,4,5` for mirrored 64-pixel resources. The generated manifest records
these indices and the asset verifier rejects another ordering change.

The installer now stages the resident registry-extension module, a 61,808-byte
FWDB registry, an expanded descriptor archive, and an expanded model-resource
archive atomically with the existing field/event modules. It reserves extension
codes at `0x3000`, preserves all stock mappings, and uses the verified 32-bit
descriptor-offset path for rows beyond 64 KiB.

Executed checks:

- The deterministic importer mapped **624** valid Gen 5 appearance keys to
  **348** normal/shiny resources. All Gen 5 keys have explicit art; zero use the
  previous Bulbasaur placeholder. Gender differences and valid forms are keyed
  separately even when the source artwork is intentionally shared.
- Every imported resource passed size, palette, transparency, frame-count and
  four-direction decoding. The generated runtime archive has **1,323** members;
  the descriptor table has **3,582** rows and is exactly 100,300 bytes.
- The final packaged field/event/core modules passed relocation, import, ABI,
  ARM/Thumb, 100-conversation, 100-scene-cycle and teardown checks. Native
  rendering and game services are mocked in those CPU checks.
- A fresh ROM install, repeated install, export/reopen, disable/re-enable,
  three-module removal/reinstall and fingerprint checks passed without duplicate
  files. Real exported 0.5.0 and 0.6.0 ROMs upgraded to 0.6.1, retained their
  enabled state, and reopened with each of the three modules present once.

Delivered `White2-Following-0.6.1-alpha.nds` to the workspace parent directory.
Its SHA-256 is `a8aa82c5b503677eda502623ed8ada3a30509990c88286ffb0bbaefdaefa568e`.
The field, event and core DLL hashes are respectively
`5d8bd1a25a569559cb6d307176676067231ed59922eca9ef4c9cddfea38772b5`,
`1a1bffb3034910895a52aac8c00c16c750b7052a9ece1e69204927720cbc11c7`, and
`43d5a69aa8b76a3493aabd7e12c2d67744faebd87489b975dcccfd5fedb25310`.

No DS emulator or hardware acceptance is claimed for 0.6.1. Start with G501–G505
in the human checklist, using a cold boot rather than an older emulator state.

## 0.5.0 visible dialogue and safe scenes

The current package contains one resident event observer and one overlay-36
field module, staged together with bridge ABI/fingerprint ownership. The
registry-extension development core remains uninstalled. See [EVENTS.md](EVENTS.md)
for the command policy, bounds, conservative cases and diagnostics.

Executed runtime checks:

- The pinned US binary matches the expanded hook/adapter contract, including
  both opcode dispatch paths, event/VM teardown, actor action/position/allocation
  adapters and all 162 allowlisted handler entries.
- Final packaged DLLs link through one RPM data import. All immediate call
  instructions pass the ARMv5 audit; arithmetic/trail checks execute at three
  relocation addresses and preserve the earlier ARM/Thumb regression coverage.
- `verify_scenes.py` passes 100 retained-actor dialogue/scene cycles without
  deletes, changed pose/facing/trail, or new resources. It checks all 65,536
  opcode classifications, executes retail standard/extended VM dispatch,
  preserves permission checking and native event results, and checks supported
  child events and bounded concurrent VM identities. The stock script-end cleanup
  command and callback are covered, including audited finalizers, yields, unknown
  active bits, changed bits on resume and invalid cleanup work.
- Resolved actor checks cover distant/crossing grid movement, forced player
  movement, private rail-cursor inputs, world-position writes on non-grid paths,
  elevation separation, unsupported actions, pre-allocation ID/pool/space
  conflicts, unrelated deletion, follower deletion exactly once, generation
  mismatch, callback unregistration and repeated field registration.
- VM-free checks poison the already-freed environment pointer before calling
  the native hook. Sixty sequential VM lifetimes do not exhaust the bounded
  live-token table; 49 simultaneous tracked VMs fail conservatively.
- Existing tests pass 100 own-follower controller conversations and 100
  conversations through the retail event scheduler/completion latch. The 0.4.1
  same-actor return behavior remains intact.

These CPU checks isolate UI, rendering, actor allocation and geometry evaluators
with spies. They do not establish stock-scene visual behavior, actual map curve
coverage, in-game allocation trends or hardware compatibility. Human acceptance
starts with **S01–S03 and S14**, then **S07–S08 and S12** in the
[checklist](EMULATOR-CHECKLIST.md). All new human rows remain NOT RUN.

Executed packaging/application checks:

- Fresh and repeated installation, ROM export/reopen, disable/re-enable,
  two-module removal to inert stubs, and reinstall pass without duplicate files.
- 0.4.0 and 0.4.1 ROM export/reopen/upgrades preserve the disabled setting,
  configuration and unrelated imported files. They install exactly one resident
  and one field module. Modified owned data, conflicting hook bytes and corrupted
  staged module/data assets reject before project mutation.
- Sanitized C logic/reaction checks, five asset-import tests and 19 follower
  TypeScript tests pass. The full application suite passes **1,395 tests** with
  **three skipped**, across 141 files. After the final script-end cleanup change,
  the runtime build gates and focused follower suite were run again and passed.
- Compiled field/effect checks pass, including native save exclusion, hook ABI,
  private cosmetic resources and idempotent teardown. The final production build
  passes; existing bundle-size/mixed-import warnings remain.
- The contract contains 17 sites: 15 installed hooks across the resident/field
  pair and two uninstalled development core sites; 283 native adapter/table
  fingerprints are pinned. The final field DLL has 175 audited immediate calls.

Delivered `White2-Following-0.5.0-alpha.nds` to the workspace parent directory.
Existing saves were preserved. Cold boot with an ordinary save; an older emulator
state restores the earlier modules and cannot validate this build.

| Artifact | SHA-256 |
|---|---|
| Test ROM | `cfbbfb43c0ba8ae795af19b08dcf99c062ee894c7bbee34d7288e3c039c1688e` |
| Field DLL | `2922b042dab14a8f10fd711d71cf92877dda27956c716a3445fc4a4f382cab7d` |
| Resident event DLL | `c5f17239556437785e11e1e2cbf392d8a6c37d7fc129e8088874f9b45e399f90` |

The event bridge is ABI 1. Effect, interaction and emote data are unchanged
from 0.4.1; their hashes are recorded in `build/manual-test/build.json`.
**No DS emulator or hardware acceptance is claimed for 0.5.0.**

## 0.4.1 conversation completion correction

The user reported that completing a conversation in 0.4.0 always recalled the
follower. The regression was reproduced with the old packaged DLL and the pinned
retail event loop: the first completed conversation deleted the actor with
suppression reason 16 (event running).

US ARM9 `0x020169a8` updates the cached event-running byte at game-system offset
`0x35` before callbacks, then runs the field. `0x02016d74` frees a completed event
and clears its pointer without clearing that byte. The field query still reports
an event for the completion frame. The previous cleanup released follower event
ownership before the field update, misclassifying its own completed event.

The fix retains a one-use completion marker for that field update, validated
against field, generation and actor identity and rejected if any current event
exists. It preserves the actor and trail without changing the native cached flag.
Cancellation/unload clear the marker; external event, fade, mode and partner
guards remain active. No new hooks, dialogue/art changes or save fields are added.

Executed checks:

- Exact baseline verification now includes 76 native adapter signatures and the
  same seven manifest sites / five installed hooks. Eight added signatures pin
  the retail event frame order, latch and scheduler routines.
- `verify_conversation_return.py` executes the final packaged DLL with the actual
  retail event scheduler/latch on ARM946. It passes 100 conversations on the same
  actor, standing still, continued movement, one-use ownership, immediate foreign
  events/fades/mode/partner changes, stale generation, message allocation failures
  and unload. UI, actor and resource services are mocked; no DS game was run.
- Existing packaged interaction tests pass, including 100 controller simulations,
  nine interruption stages and balanced resource ownership. All 137 immediate
  calls pass instruction checks; arithmetic and movement run at three addresses.
  Sanitized host logic/reaction tests, five asset tests and compiled field ABI /
  retail save-exclusion checks pass.
- 0.4.0 export/reopen/upgrade passes with one module, unchanged configuration,
  retained disabled setting and unrelated files. Modified previous-version
  dialogue or emote assets reject the upgrade before mutation. Fresh installation,
  repeated install, disable/enable, removal, export/reopen and reinstall pass.
- The full TypeScript run passed 1,392 tests, skipped three, and hit three 5-second
  timeouts in the unrelated map GLB suite while other builds/checks were running.
  Running that file alone passed all 15 tests with the normal timeout. Production
  build passes; existing Vite bundle-size/mixed-import warnings remain.

Delivered `White2-Following-0.4.1-alpha.nds` to the workspace parent directory.
ROM SHA-256: `15250e1dab01ff45c4ae13c9ea32858f1ad4afca2961b85c7401b956b1788775`.
Field DLL SHA-256: `b649712174e9fff35c0dbf5853adeadde4866b9c74013849879035f0a57dc2d5`.
Existing saves were preserved. Human acceptance starts with **C20** in the
[checklist](EMULATOR-CHECKLIST.md): dismiss with A/B, wait five seconds, repeat
without moving, walk away, then check a normal external event/door transition.

## 0.4.0 conversation checks

Executed without starting a DS game emulator:

- Pinned IRDO bytes: seven manifest sites (five installed field hooks, two
  development core sites), 68 native adapters; new event/text/sound/input and
  rail-facing/collision adapters inspected against the US binary.
- Deterministic import: 34 neutral-mood eligible rules in original order, 27 US
  English messages, 12 motions, seven emotes / 14 private 32px I4 resources.
  Data is 3,852 bytes; emote NARC is 10,076 bytes. Reimport reproduces hashes.
- Sanitized C tests reach all 34 rules and cover every HP/status/friendship
  boundary, 649 species, bounded name substitution in all 27 messages, all 12
  motion sequences, missing/fallback conditions and malformed record checks.
- Final packaged DLL has five intended external hooks, no unresolved imports,
  and 133 valid immediate calls. Multiply/divide helpers and existing stationary
  startup/walking trail execute at three load addresses, including the prior
  ARM/Thumb regression. Native call spies assert 8-byte stack alignment and
  caller register preservation.
- Packaged controller checks pass: native event priority veneers, four facing
  directions, rotated rail tangent, obstruction/height rejection, 100 completed
  simulated conversations, all nine stages interrupted, nested foreign event
  ownership, actor/generation loss, and event/string/window/effect/VRAM failures.
  Mock allocation/free counts balance. These are **not** 100 in-game conversations.
- Existing compiled field/effect tests still pass: update/draw forwarding,
  unload prologue, actual retail NOT_SAVE loop, private palettes and cleanup.
- 19 follower TypeScript tests and 76 existing PMC/export tests pass. Actual ROM
  install/export/reopen/reinstall/disable/enable/removal/reinstall checks pass.
  File-level upgrades from 0.2.0, 0.3.0 and 0.3.1 retain disabled state, mapping
  and unrelated files while adding conversations without duplicate modules.
- Production build passes; existing Vite bundle-size/mixed-import warnings remain.

Removal replaces the owned DLL with a deterministic inert module containing no
hooks or callbacks. This preserves NitroFS file IDs after reopening; imported
assets, interaction data and shared PMC stay available for reinstall. Hash
mismatches prevent mutation. It does not claim to erase file slots or uninstall
shared PMC.

Current ROM/runtime/data hashes are recorded in `build/manual-test/build.json`.
`build-following-rom.ts` copies the versioned ROM to the workspace parent and
preserves existing sample saves. No current emulator or hardware result is
claimed. C01–C20 in [the human checklist](EMULATOR-CHECKLIST.md), especially native
input, text rendering, cries, curved paths and interruption timing, remain NOT RUN.
Regenerate the conversation rows with `generate_checklist.py`.

## 0.3.1 freeze diagnosis and correction

The user reported following/effects working in the browser emulator but a lock
on overworld entry in melonDS. Read-only inspection of `melonfreeze.mln` found
ARM9 in Undefined mode (`CPSR 0x6000009b`, `PC 0xffff0108`). The failing call
at `0x023b9eae` contains halfwords `f000 e9fd`, identical to offset `0xe1e`
of the packaged 0.3.0 DLL. The reserved low bit of the Thumb BLX suffix is set.
This is an instruction-encoding fault; the snapshot does not indicate a null
dereference. The earlier pre-effects `frozen.mln` contains the same fault.

The RPM packager's Thumb-to-ARM immediate-call encoding generated these bytes
for the 64-bit multiply helper in movement distance calculation. This calculation
also runs on the second stationary sample, explaining the freeze before walking.
Effect diagnostics in the new snapshot show resource initialization completed
and no send-out/recall started yet.

The helper now has a Thumb entry with a word-aligned local `bx pc` transition
into its ARM body. Callers use ordinary Thumb BL, with no immediate BLX packing
required. No game hook, movement policy, asset or shared PMC installation changes.

`verify_packaged.py` checks the final DLL bytes and executes its relocated code
at three load addresses. It rejects the old DLL's `f000 e9fd` call, checks all
47 immediate calls in the fixed build, tests 106 full-width multiply pairs at
each address, and exercises stationary startup and a walking trail. It preserves
SP and r4–r11. This check is now mandatory before the build publishes the DLL;
the previous checks only exercised separately linked ELF code and missed the
packager's changed instruction.

The fixed build also passes the existing field/effect checks, host/import tests,
18 TypeScript tests and production build. File-level migrations from both 0.2.0
and 0.3.0, export/reopen, repeated install and disable/enable pass without duplicate
files; the effects archive retains its previous fingerprint.

Reproduce snapshot inspection without launching an emulator:

```sh
python3 runtime/following-pokemon/inspect_state.py /path/to/melonfreeze.mln \
  --module /path/to/previous-0.3/PokewebFollowingFieldW2.dll
python3 runtime/following-pokemon/verify_packaged.py
```

No new DS game run is claimed for this fix. Cold boot the new ROM with an
ordinary save and perform A00 and FX01–FX05 in the human checklist. Loading an
old emulator state restores the broken code and cannot validate the fix.

## 0.3 effects build checks

- Imported original HGSS ball, flash model and texture animation; deterministic
  3,052-byte archive with Pokeweb's canonical nameless FNT. Length/hash/CRC
  fingerprints are checked before installation and runtime resource loading.
- Verified pinned IRDO binary: five manifest sites (three installed field hooks,
  two development-only core sites) and 39 native adapter signatures.
- Built standalone field module with exactly three intended hooks and no imports.
- Compiled instruction checks with mocked native services passed: existing render
  forwarding, preserved stack/registers, two ball ticks/eight flash frames,
  white shrinking snapshot after actor removal, unchanged shared materials,
  no per-frame allocation or texture upload, safe missing-asset/low-memory skip,
  and repeated destruction without double frees. Native render output is not tested.
- Follower host/import tests and 18 TypeScript tests pass, including effects-file
  integrity and byte-identical archive normalization. Production TypeScript/Vite
  build passes with existing bundle warnings.
- Actual ROM install/export/reopen, repeated install and disable/enable checks
  pass with byte-identical owned DLL/config/effects and no duplicate files.
  A file-level 0.2 export/reopen/update/reexport check also passes: one module,
  disabled setting and native config retained, only the new effects archive added.

The current manual-test artifact is under `build/manual-test/`; `build.json`
records its version and hashes. The export command does not start an emulator.
An initial automated game run was stopped at the user's request before acceptance;
it provides no completed 0.3 game-validation result. Further emulator testing is
assigned to the human FX checklist. In particular, door-fade timing, placement,
large Pokémon alignment, palette isolation in a rendered scene and GPU/resource
lifetime during interrupted transitions remain pending.

## Historical 0.2 game-emulator evidence (2026-09-20)

The final walking run used the production Pokeweb installer and exported ROM:
5,000 emulator frames covering Aspertia City walking and four-direction turns,
an X-menu recall/return, Pokémon Center entry, indoor movement, exit, running/
reversal inputs, and a completed save. The party lead was Mew (species 151),
resolved to native object code `0x1098`. Captures visibly show Mew behind the
player outdoors and indoors. Diagnostic traces show one owned follower at a
time and deletion/recreation across the menu and field transitions.

A separate 1,800-frame cold boot used the normal exported ROM (without the
Quick Launch startup module) and the newly written save. It reached the saved
location, recreated one follower and followed subsequent movement. No emulator
undefined-instruction/assertion/abort output was observed in either final run.
The headless harness asserts visible outdoor/indoor samples and menu recall;
it also asserts a visible follower after the cold reload.

Reproducible commands and local evidence paths:

- `npm run following:emulator -- /path/to/clean-white2.nds 5000`
- `npm run following:emulator -- /path/to/clean-white2.nds 1800 --reload`
- `build/emulator/trace.json`, `reload-trace.json`, `frame-*.png`,
  `reload-frame-*.png`, and `after-test.sav`/`.dsv`.
- `build/emulator/White2-Following-Alpha.nds` is the normal testable ROM;
  `White2-Following-Alpha-QuickLaunch.nds` is the separate harness startup ROM.
- `build/emulator/evidence.json` records artifact hashes; generated ROMs, saves,
  captures, and tool output remain ignored local artifacts.

Harness outputs can be replaced by later local runs. Check their hashes against
the historical evidence before associating a file with the 0.2 results. Use the
separate `build/manual-test/` artifact for current 0.4 human testing.

These runs are **not** the 100-cycle release soak. They do not establish rail,
ledge, non-grid, bridge, battle, partner, communication, or hardware coverage.
Saving and cold reload succeeded; unpatched-game save testing remains outstanding.

## Historical 0.2 executed checks

| Check | Result | Scope |
|---|---|---|
| Pinned clean ROM | Pass | IRDO revision 0; SHA-256 `3e50aec3db401332175a5d2b5fe2a68ac1a05ec63995dba9d1506b1b51837446` |
| Binary signatures | Pass | Object lookup, descriptor offset edit, field sites and 20 native adapter signatures; full disassembly/ABI evidence remains scoped to the exercised paths |
| Native registry inventory | Pass | 1,008 rows, 28 bytes each; 975 resources; row ordering agrees with all stock ranges |
| Field build / veneers | Pass | Standalone overlay-36 DLL, only two intended field hooks, no unresolved imports; compiled update forwarding and unload prologue ABI checks |
| Retail save exclusion | Pass | Actual IRDO save-loop and iterator executed on ARM946 emulation; bit 20 skips follower serialization |
| Core build | Pass | Standalone development PMC DLL; only intended ARM9/overlay-12 external copy relocations; no unresolved imports |
| Compiled ARM946 core | Pass | All 65,536 inputs compared against execution of retail lookup instructions; SP and r4–r11 preserved |
| Core configuration | Pass | Valid FWDB enables bounded extension; malformed data revokes previous bounds |
| Descriptor edit | Pass | Exact assembled eight-byte edit executed; offsets above 64 KiB retained |
| Portable C host checks | Pass | Address/undefined-behavior sanitizers; lead selection, identity, low HP, nested suppression, interaction interruption, trail reversals/ledge samples/rail discontinuities/overflow, object mapping |
| Follower TypeScript tests | 17 passed | Registry validation, 32/64-pixel resources, transparency, independent/mirrored sides, animation timing, transactional import failure, placeholder retention, duplicate prevention, private-file integrity, unsupported targets, data-only ROM export/reopen/update, native config bounds, fingerprinted enable/disable |
| Python import tests | 5 passed | Deterministic containers/packages, invalid input rejection, transparency, explicit HGSS indices/palette, hg-engine indexed palette preservation |
| Stock asset inventory/decoding | Pass | 649 species, 2,574 keys; 1,068 exact and 1,506 placeholder appearances; 618 resources decoded in four directions/four phases |
| Existing PMC/export regression tests | 76 passed | `pmcModel`, `pmcModelCache`, `romExport` |
| Actual alpha install/export/reopen | Pass | Install twice, disable/enable, export/reopen, reinstall, disable/reexport and reenable; unchanged owned DLL/config and no duplicate files |
| Production build | Pass | TypeScript and Vite; existing chunk-size/mixed-import warnings remain |
| Working-source privacy audit | Pass | No private machine paths in commit-eligible source |

The appearance registry is 61,808 bytes. The proposed full descriptor table
would be 100,300 bytes, confirming why a 16-bit descriptor offset is insufficient.
The editor currently stores data under `following/`; it does not append the
native table or activate these object codes.

The asset-workspace unit regression uses a synthetic ROM. A separate
`verify-following-install.ts` integration check uses the actual alpha ROM export.
The compiled-core runner emulates ARM instructions with Unicorn; it is not a DS
game emulator and does not validate PMC load/unload ordering or rendering.
Source-art import tests use generated fixtures; automatically assigning the
available HGSS/hg-engine library and reviewing those assignments is outstanding.

## Not executed / incomplete

- Complete native actor-ID/zone/script audit, resource-pressure handling and
  allocation/callback/texture/palette telemetry across all teardown paths.
- Dedicated accepted grid/ledge/rail/non-grid adapters and full ordinary
  exploration coverage. The alpha samples actual world poses with bounded history.
- Exhaustive story-partner, external script, battle, blackout, transport,
  communication and special-activity guard timing. See `GUARDS.md`.
- Human acceptance of native A-button conversations, nickname layout, cries, emote placement and rail reach.
- Runtime use of arbitrary editor replacements, map-policy controls, and
  restoration of preexisting user-modified descriptor/resource archives.
- Human validation of asymmetric and shiny rendering, lighting, shadows,
  reflections, weather, grass and representative large-sprite visuals.
- Unpatched-game save round trips, 100 mixed transitions, crowded-area soak,
  complete heap/resource traces, and DS-family hardware.

The application exposes the Gen 5 sprite alpha with these limitations. Prepared
arbitrary custom assets remain separate from the runtime archive generator. The checklist
contains NOT RUN placeholders for human results; it is not a claim that those
scenarios have passed.
