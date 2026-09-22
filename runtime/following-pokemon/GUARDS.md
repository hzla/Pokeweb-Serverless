# Guard implementation ledger

The walking alpha now has native selection, world-position history, actor
creation/deletion, save exclusion, and basic player-pause/event/fade/mode/partner
guards. Outdoor walking, menu return and Center entry were exercised with 0.2 in
the bundled emulator. The user confirmed 0.3 effects in the browser emulator and the 0.3.1 melonDS freeze fix. The 0.5 dialogue/scene policy and broader conversation edge cases await human acceptance.
The table lists the broader verification still required; host
logic tests alone do not establish native event coverage.

| Situation | Existing component | Native integration and regression still required |
|---|---|---|
| Empty, Egg-only, fainted party | `fw_select`; host tests | Party ABI, blackout entry/exit timing |
| Party reorder, PC, trades, evolution, hatching | `fw_same_identity`; no borrowed party pointer | Refresh when field control returns; species/form/gender/shiny refresh |
| Missing artwork | Explicit catalog fallback reason | Display selected identity/cry despite substituted art |
| Reversal/overlap | Recorded-pose trail reversal test | Actor collision masks; no NPC/player blocking |
| Ledges/consecutive jumps | Elevation and movement-kind samples | Capture full jump timeline and draw offsets |
| Rail/non-grid movement | Arc-distance recorded-pose trail; rail-connection checks | Verified rail/coordinate-system adapters and curved paths |
| Compatible streamed boundaries | Caller supplies generation and coordinate-space ID | Derive compatibility without clearing ordinary exploration |
| Doors, stairs, elevators, warps, Fly/escape | `FW_WARP`; generation/discontinuity reset | Recall before destination/actor teardown; reseed after init |
| Battle/blackout | Independent suppression reasons | Pre-battle destruction and return selection |
| NPC/sign dialogue, choices, safe scenes | `scene.c`, bounded native event/VM observation | Preserve actor/trail; refresh selection on return; S01–S06, S14 |
| Menus and independent transitions | Existing mode/fade/event ownership guards | Recall remains active; S12, S16 |
| External scripts/cutscenes | Executed opcode policy plus resolved actor-action checks | Recall before player translation, conflicting NPC action or unsupported child/command; S07–S13 |
| Follower interaction | `interaction.c`: native provider priority, owned event, bounded snapshot, private cosmetics and immediate cancellation; packaged controller tests | C01–C19: native presentation, input, reach on curved paths, interruptions and soak |
| Story companion | `FW_PARTNER` | Read-only detection; prove flags/trainer/battle state unchanged |
| Bike/Surf/Dive/fishing/field move | Independent activity reasons | Mode transitions and restoration |
| Communication/Funfest/special ownership | `FW_COMMUNICATION`, `FW_ACTIVITY` | All entry/return paths and alternate actor systems |
| Ice/conveyor/falling/narrow traversal/gym machinery | Recorded movement kind; discontinuity rejection | Verify ordinary travel; narrowly scoped special-activity guards |
| Save/reload | Nonpersistent bit; actual retail save-loop exclusion executed on ARM946 emulation | Full round-trip save comparison, including unpatched game |
| Overflow/malformed registry/resource pressure | Trail clears on overflow; C/TS validators | Recall, cleanup and safe retry without stuck input |
| Nested suppressions | Counted reasons; saturated count latches safely | Balanced native enter/leave events and teardown reset |
| Large indoor Pokémon | No size-based exclusion in catalog/logic | Indoor visual/collision review |
| Send-out / recall effect interruption | Private palette and detached billboard snapshot; effect cancellation and teardown | FX01–FX12: door fades, placement, large sprites, repeated transitions and resource lifetime |
| Lighting/shadow/reflection/grass | Native rendering intended | Verify each effect; no shared palette mutation |

HGSS small-only indoor and location-specific Diglett/Dugtrio exclusions are
reference behaviors, not White 2 policies. Large followers are permitted indoors.
