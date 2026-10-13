# Ruby-like BW2 field-script compiler and decompiler

The first compiler milestone produces a complete BW2 field/event script NARC
member from a restricted Ruby-syntax source file. It supports structured control
flow, parameterized helpers, automatic scratch Works and relative offsets, and lossless imports
of existing scripts with conservative control-flow recovery. It runs in
TypeScript without evaluating Ruby or adding an interpreter to the ROM.

## Compile a source file

From the repository root:

```sh
npm run scripts:bw2-compile -- examples/bw2-scripts/counter.bws --out /tmp/counter.bin
```

The output is one script NARC member, not a ROM or a complete NARC archive.
The CLI refuses to overwrite an existing output file. `.bws` is the example
extension; the compiler does not require a particular filename extension.

The browser/CLI API is:

```typescript
import { compileBw2Script } from "../src/pokeweb/bw2ScriptCompiler";

const result = compileBw2Script(source);
// result.bytes, entries, helpers, instructions, relocations
```

Source locations use one-based lines and columns. Compile failures throw
`Bw2ScriptCompileError` with a message and a `position` containing line/column.
Successful results include instruction locations and resolved relocation records.

## Vanilla White 2 purpose comments

**Decompile from ROM** adds short purpose and effect comments for matching
US White 2 routines, including unchanged routines inside an edited member.
The catalog contains SHA-256 fingerprints for all
1,289 members of `a/0/5/6`: 673 field-command files, 615 map-event selection
tables, and one unrecognized member (1241). The field files have summaries for
4,955 physical code routines and 3,237 movement blocks, with no undecoded field
entries in this revision. Shared entry aliases receive one comment at their common code
body. Selection tables are indexed and described as tables, not command routines.

The lookup requires US White 2 identity (`IRDO`, BW2/W2), member ID,
and the decoding command table. An exact length and SHA-256 match of the entire current
member, including entry slots, movements, raw data, and padding, retains all its
original notes. For edited members, version 2 of the catalog also matches
individual routines through normalized SHA-256 fingerprints. These retain
opcodes, literal operands, instruction widths, entry roles, and a rooted graph
of local jumps, calls, fallthrough, movement lists, and referenced tables.
Absolute offsets and generated symbol names are excluded: code growth elsewhere
does not invalidate an unchanged function merely by relocating it. Internal
target positions and shared-reference topology remain significant.

A changed routine loses its fresh vanilla summary. Changes to its local helpers
or referenced movement/table data also invalidate its summary. Referenced versus
detached status is checked, and identical matches with conflicting original
explanations receive no comment. Partial matching supplies annotations only; it
does not establish a native command overlay or bypass original/edited round-trip
checks. Cross-file global callees, map assignments, dialogue contents, and native
handlers remain outside these fingerprints and can change the original context.
Black 2, BW1, and other regions have no matching catalog. Older saved
source drafts keep their contents; decompile again to import the notes.

Comments describe the original game. Most purposes are inferred conservatively
from decoded command effects, reachable local helpers, original map headers,
NPC/sign/trigger assignments, map activation records, named saved works, and
original dialogue topics. Reviewed templates cover specific Aspertia scenes,
companion routines, and the hidden-item pickup family. The catalog records
`reviewed`, `inferred`, or `partial` confidence; unknown command effects and
undecoded paths are stated explicitly. A matching script hash does not prove
that its map, dialogue, shared callees, or native command handlers are unchanged.
Effects may depend on branches. Revise retained comments when editing source.

Summary rules resolve numeric and descriptive command spellings through their
opcode and command table. The alias-effect rules in
`scripts/lib/bw2ScriptSummaryCommandEffects.ts` describe surveys, PWT interactions
and result queries, Battle Subway operations, Join Avenue services, Pokéstar
movies, and other named command families. Queries are described as reading or
checking data; they do not imply that an award or state change occurred. Local
calls are followed through actual returns, and a helper that halts the VM stops
the caller's effect analysis. Comments for recovered detached code and movement
lists without a decoded reference state that their runtime use is unknown.

Notes sit inside code/movement bodies so they stay with the correct Script or
Definitions tab and cursor ownership. Physical offsets identify the bodies;
generated symbol spellings are not the lookup key. Annotation is compiled again
and must reproduce the original member exactly. All existing unsupported-data,
overlay, original-import, and apply checks remain active. The catalog's single
verified original context can supply the overlay for an unassigned shared member;
map-assigned members continue to use the loaded ROM's dispatcher, and an explicit
alternate overlay does not inherit another decoding's notes.

Generate and verify from the pinned clean US White 2 revision:

```sh
npm run scripts:w2-summaries -- /path/to/cleanwhite2.nds
npm run scripts:w2-summaries:verify -- /path/to/cleanwhite2.nds
```

The generator refuses a different full-ROM SHA-256 and emits deterministic
metadata in `src/assets/data/white2ScriptSummaries.json`. It stores summaries,
hashes, offsets, entry aliases, and decoding context without embedding script
bytes, source code, or complete dialogue banks. Keep semantic rules and reviewed
purposes in `scripts/lib/bw2ScriptSummaryAnalysis.ts` and alias-effect rules in
`scripts/lib/bw2ScriptSummaryCommandEffects.ts`, then regenerate the catalog.
Analysis/coverage reports and the annotated `.bws` files produced by verification
stay under ignored `work/bw2-vanilla-summaries/`.

Verification checks all 1,289 hashes against Node crypto, all 673 annotated
round trips, insertion coverage for every code/movement/undecoded summary,
Script/Definitions joining, dialogue cursor lookup, rejection of exact-file
matches after member-byte changes, selective comment retention after an in-memory
Aspertia edit/apply/reimport, and the read-only gate.
Neither command writes the input ROM; these checks do not claim an in-game test.

## Source syntax

```ruby
work :counter, 0x8000
LIMIT = 3

script :main, entry: 1 do
  counter = 0
  while counter < LIMIT
    pause_once
    counter += 1
    next if counter == 1
    break if counter == LIMIT
  end
end

def pause_once
  sleep 1
  return
end
```

`work :name, ID` binds an existing game work variable; it does not allocate
storage. Review each ID for the event and its callees. The compiler checks the
16-bit encoding and requires IDs of at least `0x4000`; it does not certify that
every ID in that range names valid or available runtime storage. Helpers share
the same bindings and may change them. Duplicate bindings to the same ID are
rejected. Uppercase constants are immutable integer literals.

Public script entry IDs start at 1 and must be unique and contiguous. An entry
ID maps to binary table index `entry - 1`. Definition order may differ from
entry order. Helpers are excluded from the entry table and may appear before
or after their callers.

Supported statements:

- `if` / `elsif` / `else` / `end` and `unless` / `else` / `end`.
- Postfix `if` and `unless` on calls, assignments, `return`, `break`, and `next`.
- `while` and `until`, with an optional `do`, plus nested `break` and `next`.
- `case value` / `when 1, 2` / `else` / `end`, with exclusive branches.
- `def helper`, `def helper()`, or `def helper(parameter, ...)`. Call with
  `helper`, `helper(...)`, `helper value, ...`, or `call :helper, value, ...`.
  Forward and backward calls are supported; recursion is
  rejected. Helpers cannot call public entry scripts.
- `return` halts a public script or returns from a helper. Reaching the end of
  a definition emits the corresponding halt/return instruction. There are no
  returned expression values or implicit Ruby expression returns.
- Assignments to bound work variables: `counter = 3`, `counter = other`,
  `counter += 1`, and `counter -= other`.

### Helper parameters and local variables

```ruby
script :reward_actor, entry: 1 do
  lock
  amount = 2
  reward_player(4, amount)
  finish_interaction
end

def reward_player(item, quantity)
  remaining = quantity
  while remaining > 0
    give_item item: item, quantity: 1
    remaining -= 1
  end
  return
end
```

Parameters pass unsigned 16-bit integer values. They and newly assigned lowercase
names have routine-local scope. Existing `work` bindings remain shared storage;
assigning those names keeps the original behavior. Parameters can shadow a work
binding without changing its slot. Locals initialize to zero each time the routine
starts. Reading a name with no binding, assignment, or parameter remains an error.

Allocation uses `0x8020`–`0x8053`, excluding explicit work IDs, numeric references,
constants, and work-shaped words in raw data in the file. Engine parameter/result
and register slots are outside this pool. This conservative ceiling agrees with
the [Gen V PokeScript Work constants](https://github.com/HelloOO7/PokeScript/blob/master/PokeScript/src/ctrmap/pokescript/instructions/gen5/VConstants.java).
Different routines can reuse slots. Calls save caller/callee slots, snapshot all
arguments left to right, then assign parameters. This preserves `pair(right, left)`
when slots overlap. Normal and early returns restore slots in reverse order.
Public scripts restore their borrowed slots when they finish. Synchronous global
calls, including interaction macros, preserve active caller locals; unallocated
Works retain the command's normal effects.

The native US White 2 VM shares a stack between expressions and return addresses;
its 256-word allocation permits 255 pushed words. Automatic locals/parameters
enable a graph check for overflow, unbalanced raw stack operations, and exits that
skip restoration. Exhausted pools, recursive calls, cross-routine jumps, and
entry/raw-call targets bypassing parameter setup are compilation errors. Managed
helpers finish with `return`; the caller can then use `finish_interaction`.
Asynchronous global calls cannot share active automatic locals. Use `if`/`unless`
around helper invocations instead of stack-based conditional raw calls.

Existing zero-argument helpers and explicit work bindings keep their encoding.
New locals/parameters get initialization and an implicit terminator even within
`preserve_layout`. Allocation metadata is available in `result.scratchWorks` and
adds no ROM payload. Saved project source keeps the local/parameter names; fresh
ROM decompiles show explicit save/setup/call/restore commands and round-trip
byte-identically. Names are not guessed from bytecode. The editor highlights and
completes locals and helper signatures. Literal dialogue previews and map/entity
ownership remain supported; parameter-based message IDs remain runtime values.
Default/keyword parameters, return values, and general arithmetic expressions
are not implemented.

Conditions support `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`, `!`, parentheses,
`true`, and `false`. Boolean operators short-circuit in the default comparison
encoding. Numeric conditions require
an explicit comparison such as `counter != 0`; they do not use Ruby truthiness.
Comparison operands are integers, constants, or work bindings. `when` values
must be distinct constants. Arithmetic literals must be below `0x4000`, because
the BW2 arithmetic operand convention interprets larger values as work IDs.
Assignments and explicit constant comparisons retain their literal 16-bit form.

### Interaction macros

```ruby
VS_RECORDER = 465

script :greeter, entry: 1 do
  lock
  talk message: 1
  give_item item: VS_RECORDER, quantity: 1
  finish_interaction
end

script :town_sign, entry: 2 do
  lock
  read_sign message: 26, style: :town
  finish_interaction
end
```

| Macro | Exact expansion | Arguments |
| --- | --- | --- |
| `talk` | Interaction sound `0x0547`, face player, `message_actor 0x0400, MESSAGE, 0, 0`, final confirmation, balloon close; five commands, 20 bytes | `message:` is a zero-based entry in the current script's story bank |
| `read_sign` | Sign action log `(17, 0)`, interaction sound `0x0547`, sign message, sign close; four commands, 18 bytes | Required `message:` and `style:`; styles are `:info` (0), `:town` (1), `:post` (2), and `:road` (3) |
| `give_item` | Push shared slots `0x8000`/`0x8001`, set item/quantity with opcode `0x002A`, call global script 2805, pop slots in reverse order; seven commands, 32 bytes | Required `item:` and `quantity:`; the helper awards the item, handles bag capacity, and presents its result |
| `finish_interaction` | Completion check (`0x0030`), unlock (`0x002F`), halt (`0x0002`); three commands, six bytes | No arguments; terminates the script VM rather than returning from a helper |

`talk` and `read_sign` use the header-associated default bank and do not lock
actors or terminate the event. `talk` targets the actor being talked to, with
automatic placement and the normal balloon style. Other sounds, banks, speakers,
placement, confirmation, or window-closing variants retain their explicit commands.
`read_sign` keeps the sign action log; it is not interchangeable with displaying
only a message. `give_item` is distinct from the global item-success presentation
helper, which does not itself add an item.

All message, item, and quantity arguments accept literals/constants below
`0x4000` or explicit work bindings for runtime values. Sign `style:` is a literal
operand, so it accepts aliases, numbers, and constants but rejects work bindings.
Keyword order, parentheses, multiline arguments, and postfix conditions work
like the companion macro below. `finish_interaction` does not cause an additional
automatic halt; terminating alternatives also avoid unreachable cleanup jumps.

The decompiler recovers complete exact sequences automatically, without crossing
an interior public entry, branch/local-call target, or rendering boundary. If
structured flow cannot preserve the layout, it tries raw branches with the
verified macros before falling back to expanded commands. Every result still
passes the original byte-identical check. `recoverMacros: false` keeps all these
sequences expanded, and unresolved data continues to make imports read-only.

The sidebar resolves `talk` and `read_sign` through their underlying message
operands, including reordered keywords and constant aliases. Runtime message
works remain unresolved instead of being guessed. Text editing, the Texts tab,
and preview name-buffer limits share the existing text store. Sign text uses the
normal dialogue layout preview; alternate sign frames are not simulated.
Command help shows each macro's actual argument list, command count, and byte size.

`scripts/verify-bw2-interaction-macros.ts` audits the stock US White 2 revision
without writing a ROM. The 39 matrix-0 city/town/route files recovered 195 `talk`,
113 `read_sign`, 25 `give_item`, and 442 `finish_interaction` calls, all with exact
round trips. All 308 recovered talk/sign references matched native story-bank
entries. Each macro was edited in Aspertia through the project apply gate in
memory, with edited-output round trips, relocation checks, baseline preservation,
and unchanged archive members outside file 854. This is not an in-game test or
verification of BW1, Black 2, or other regions.

### Companion-release macro

```ruby
stop_companion_following script: 1, movement: :none
```

This ends the trainer companion's following state through global script 10536
(`0x2928`). `script:` is the interaction script ID assigned to the released
companion. `movement:` is its autonomous actor behavior; `:none` encodes zero.
Both keywords are required. Keyword order, parentheses, multiline calls,
constants, work bindings, and postfix `if`/`unless` are supported. Other movement
behavior codes can be numeric. These codes are separate from movement-list labels.

The macro emits exactly these seven commands (32 bytes):

```ruby
stack_push 0x8000
stack_push 0x8001
work_set 0x8000, 1
work_set 0x8001, 0
rt_call_global 0x2928
stack_pop 0x8001
stack_pop 0x8000
```

The original `work_set` (`0x002A`) opcode and setter order are retained even
for literal arguments. Shared parameter values are saved and restored. Work
arguments are read in that original setter order, so an argument bound to a
shared parameter slot can observe an earlier setter's write. Literals/constants
must be below `0x4000`; larger runtime operands require an explicit work binding.
No explicit definitions for the macro's internal parameter slots are needed.

The decompiler recovers this spelling only for the complete contiguous sequence,
including the exact global-script ID, setter opcodes, shared slots, and restoration
order. It keeps raw commands when a branch, local call, public entry, or rendering
boundary enters/splits the sequence. The existing byte-identical verification
and read-only/apply gates remain in force. The API option
`decompileBw2Script(bytes, { recoverMacros: false })` retains expanded source.
New ROM imports use the macro automatically; older drafts remain compatible.

US White 2 Aspertia file 854, entry 22, recovers the example above and compiles
to the original bytes. Changing its `script:` argument to 2 was verified through
the project apply gate in memory, with only the expected operand byte changed.
The audit does not write the input ROM or claim an in-game test.

### Descriptive work names and stack conditions

The BW2 catalog contains 420 named work slots, including story progress,
system state, map-local slots, and event-scoped temporary slots. Decompilation
emits bindings only for referenced, documented work operands. Each binding has
a description comment. Unknown IDs keep `work_XXXX`; reused temporary slots
keep names such as `event_temp_0`, since their meaning changes between events.
Catalog names identify an event or storage role, not a complete interpretation
of every numeric stage. Regional and modified-ROM event meanings still need
checking against the actual scripts. Names do not establish valid free storage.

For Aspertia script file 854, the important bindings are:

```ruby
work :bianca_intro_progress, 0x40a1
work :aspertia_gym_opening_progress, 0x40a8
work :lake_guardians_cave_of_being_event_progress, 0x4115
```

The first two are saved integer work variables. `_progress` denotes a numeric
event stage; `_flag` is reserved for Boolean event flags.
`bianca_intro_progress != 0` tests whether the progress value has left
stage zero; it does not assert that the entire introduction has finished.
The third belongs to the Cave of Being lake-guardian sequence and also controls
Hugh/sister placements in Aspertia. Aspertia and lake-guardian event context was
checked against the
[BW2 walkthrough](https://bulbapedia.bulbagarden.net/wiki/Walkthrough:Pok%C3%A9mon_Black_2_and_White_2);
the walkthrough does not establish numeric work IDs or stage values.

Recognized stack conditions use a file-level `condition_encoding :stack` directive
so plain conditions reproduce the original stack commands instead of substituting
comparison-flag commands. For example, this jump preserves the original
`stack_push 0x40a1; stack_push_const 0; stack_cmp 1; jump_if 0xff, :loc_d1`:

```ruby
preserve_layout
condition_encoding :stack
work :bianca_intro_progress, 0x40a1

script :main, entry: 1 do
  if bianca_intro_progress != 0
    jump :loc_d1
  end
  nop
  label :loc_d1
  halt
end
```

Stack encoding evaluates both sides of `&&`/`||` in order and emits stack
Boolean AND/OR. Both sides must be comparisons, Boolean values, or flag
predicates; numeric Ruby truthiness is not supported. Existing comparison-flag
conditions in a mixed import use `vm_compare(condition)` to retain their opcode
sequence. `stack_condition(condition)` selects stack encoding for one complete
condition in an otherwise default-encoding file. `case` retains its existing
comparison-flag dispatch. Old source files without the new directive keep their
previous encoding, including saved import baselines.

`flag_set?(0x0123)` tests a real Boolean event flag in separate flag storage.
It accepts a literal/constant flag ID below `0x4000`, not a work binding. Use an
integer comparison for work progress. Named work bindings are also accepted in
documented raw work-ID/work-literal operands, including `stack_push`, work
operations, and actor/player position commands. A literal-only operand such as
`stack_push_const` continues to reject a work binding.

Ruby `#` comments, decimal/hex integers, optional call parentheses, and semicolon
statement separators work. Headers and structural keywords use separate lines;
multiline argument lists are supported inside parentheses. Syntax/condition
nesting is bounded, and source size is limited to one million characters.

## Initial field-command subset

| Source command | Opcode | Integer arguments |
|---|---|---|
| `nop` | `0x0000` | None |
| `sleep` | `0x0003` | Frames/delay operand |
| `set_flag`, `clear_flag` | `0x0023`, `0x0024` | Flag ID |
| `lock`, `unlock` | `0x002E`, `0x002F` | None |
| `wait_moment`, `wait_buttons`, `wait_last` | `0x0030`–`0x0032` | None |
| `message_actor` | `0x003D` | Four existing message-command operands |
| `close_message` | `0x003E` | None |
| `apply_movement` | `0x0064` | Actor ID, symbolic movement name |
| `wait_movement` | `0x0065` | None |
| `face_player` | `0x0074` | None |
| `play_sound` | `0x00A6` | Sound operand |

These commands take unsigned integer/constant operands. Documented work/literal
operands of `set_flag`, `clear_flag`, and `play_sound` also accept work bindings;
the compiler emits their numeric work ID for the game to resolve at runtime.
Message lifecycle commands are explicit. Authors must supply appropriate message operands and cleanup
such as unlocking actors before an early script return.

## Use with a loaded Pokeweb project

The editor is currently available only when Pokeweb is opened on `localhost`,
`127.0.0.1`, or IPv6 loopback. Other hosts hide the menu link and reject direct
route/editor access.

Open **Texts → BW2 Scripts** after loading a Black 2 or White 2 ROM with the
Scripts archive. Select a script file, then click **Decompile from ROM** or write it
in the Ruby-like editor. Syntax highlighting, line numbers, command completion,
undo/redo, and live compiler errors are available. Click an error location to
jump to its source line.

The source editor has **Script** and **Definitions** tabs. Script opens by default
with entries, helpers and shared code. Definitions holds the leading work bindings,
constants, layout directives, entry aliases, preserved leading data, and recovered
movement definitions. Both tabs compile together as one source file. Imported
movement placement metadata retains records interleaved with code; there is no
separate include file or change to ROM layout. Drafts keep
both sections, and each editor keeps its own selection and undo history while
switching tabs. Work completion in Script includes bindings from Definitions.
Entry/helper navigation opens Script, movement navigation opens Definitions,
and compiler-error links open the relevant
tab at its local line number.

The workspace uses a 60% source / 40% map split, with a 2D map on the right.
The preview uses the overworld editor's terrain and entity renderers. Headers
identify the map assigned to the selected script file; when multiple maps use a
file, select the desired map above the preview. Necessary event, matrix, and map
resources load from the same source ROM without dirtying them.

Moving the cursor inside an entry highlights its assigned NPCs, signs, or
triggers. Inside a helper, highlights follow transitive local callers, including
shared helpers with multiple owners. Movement blocks follow their transitive
caller entries too. Entry aliases and shared code blocks are
supported. Uncalled helpers and map initialization entries may have no entity
assignment. Solid bright red outlines mark assigned entities; dashed red outlines
mark a supported command's literal actor target when it is not already assigned.
A white inner halo and red glow keep both visible against the map.
Clicking `apply_movement` refreshes its actor highlight, including when the cursor
was already on that command. Actor constants such as `HUGH = 0` resolve to the
matching event object ID; work-variable values and runtime-only actors without
map event placements cannot be inferred from this static preview.
Double-click the movement symbol in an `apply_movement` call to open its
definition in Definitions. Shared-tail symbols jump directly to their interior
label. Missing definitions and other words retain normal text selection.
Markers show event-data placements; the
preview does not execute story branches or simulate script-driven repositioning.
Drag to pan, scroll to zoom, or use Fit. The source navigation menu jumps to
entries, helpers and movements. Source context remains available during incomplete edits.

Click a command name for sidebar help describing its purpose and parameters.
Click a declared work name for its numeric ID, storage scope, and event description.
Declared work names are included in completion; catalog aliases are highlighted.
`actor_set_g_pos` documents actor, X, elevation/Y, map Z, and facing direction;
stack commands document expression-stack behavior and false-result branching.
Other known commands retain their verified widths when semantic descriptions
are not yet available. The compact status/error line sits above the editor; the
previous bottom statistics and entry-point panel has been removed.

**Compile** validates the source and reports status or a clickable source error.
**Compile & Apply** compiles the current source again and stages the replacement
in the loaded project. Failed compilation or unsafe entry changes disable
apply and leaves the existing bytecode intact. Export the ROM to use applied
scripts in game.

Drafts are saved per script file in the project's browser storage and survive
file switches and navigation. Editing a draft does not modify ROM bytecode.
Successful apply also records the applied source. **Decompile from ROM** replaces
the current source draft with source reconstructed from the project's current
bytes, including previously applied edits. Decompiling does not dirty the ROM.

`compileBw2ProjectScript(project, fileId, source)` provides a read-only compile
preview with the same validation used by apply.

`replaceBw2ProjectScript(project, fileId, source)` in
`src/pokeweb/bw2ScriptModel.ts` replaces a complete existing script member. It
requires a BW2 project and a recognized original entry table. Entry-count changes
require a verified ROM import and validated assignment mapping. Compilation and validation finish before
mutation. Successful replacement invalidates the cached member, marks it dirty,
and records a changelog entry for the normal materialization/export path. It
also retains the successfully applied source in `project.bw2ScriptEditor`.

This is whole-file authoring: entry meanings and helper behavior must be
represented in the replacement source. The CLI can save portable `.bws` backups.

### Adding, clearing and removing entries

After an editable import, **Add entry** appends the next public entry with a
`halt` body. Existing IDs stay unchanged. The compiler rebuilds the complete
entry table and all relative entry, jump, call and movement pointers. Local IDs
must remain below 10000, where global-script IDs begin.

**Remove entry** removes the selected slot and compacts later IDs. Choose
**No script — detach events** to remove its NPC, furniture/sign and trigger
assignments, or choose another entry as their replacement. The replacement
selector uses the entry's current ID; the editor adjusts it after compaction.
The compile preview shows the assignment count and expandable change list.
Applying updates the script and affected event/initialization members together.
Unchanged global IDs, actor IDs, coordinates and trigger conditions are retained.
Code still reached through local calls, jumps, shared public slots or fallthrough
stays as a shared block when its public slot is removed.

Static and conditional initialization entry references are checked in both the
event footer and the map header's special-script member. An initialization entry
cannot be detached: choose a replacement or use **Clear entry**. Clear keeps the
public ID and points it to a new halted body, preserving code reached by other
slots or local callers. Removing the last entry produces the two-byte `0xFD13`
empty table; an empty table can be imported and given its first entry again.

Renumbering requires loaded map headers/events and a map assignment for the
file. Unrecognized initialization data, event or initialization members shared
with another field-script file, stale imports, and affected numeric scheduling
or persistent actor-script assignments block apply. In particular,
`rt_reserve_script` can schedule execution after a warp; the editor cannot infer
its destination map from its numeric operand. Runtime-selected actor assignments
and unrecognized argument setup for companion-release global script 10536 also
block renumbering. Clear preserves slots in these cases. Global calls with other
IDs retain their existing operands; their arbitrary parameter conventions are
not inferred or certified by entry remapping.

Structural controls stage source changes without changing ROM bytes. Repeated
changes compose a pending old-to-new ID mapping that survives project persistence.
Direct source edits that change entry count can infer a mapping from distinct
unchanged definition names; ambiguous shared aliases require an explicit mapping.
Same-count manual source edits preserve public IDs unless an explicit mapping is
supplied. The model APIs accept `{ entryMapping: number[] }` as a fourth argument;
array index `oldEntry - 1` contains the new entry ID, or zero for detachment.
Validation of every related member completes before any apply mutation, including
materialization of pending overworld edits into staging copies.

**Add movement** creates a named sequence in Definitions and enables two-byte
alignment. Edit its steps and reference it with `apply_movement ACTOR, :name`.
**Remove movement** uses the definition under the cursor and rejects removal
while its beginning or a shared tail is still referenced. New unused movement
and helper definitions remain editable: compiler metadata supplies their starts
to the independent decoder, which still verifies commands, record sizes,
termination, bounds, overlap and the full byte-identical round trip. Reimport
uses those hints only when saved applied source compiles to the current bytes
in the same command context. A cold binary import cannot recover arbitrary
unreferenced definitions without verified source; unsupported raw bytes remain
read-only.

### Movement definitions

Movement records use a separate command namespace from field instructions.
Named actions take one literal/constant unsigned 16-bit parameter, usually a
repeat count; its meaning depends on the action. Work bindings and runtime
expressions are not movement parameters. For example, White 2 file 854's list
at `0x1DB0`, called by entry 25 for actor 3, becomes:

```ruby
movement :movement_1db0 do
  wait_8 2
  walk_left 2
  turn_right 1
end
```

The caller uses `apply_movement 3, :movement_1db0`. The compiler writes each
action as an opcode/parameter pair and emits `0x00FE, 0x0000` for `end`.
`finish 7` retains a nonzero terminator parameter instead. Movement pointers
relocate automatically when code or movement lists grow. New imports include
`movement_alignment 2`, so odd-sized control-flow edits add zero padding as
needed before movement records. Older sources without the directive retain
their original encoding. Unaligned imported movement pointers remain read-only.
Shared list suffixes
use an interior `label :name` rather than duplicating records.

The named catalog covers the FrostsGen5Editor header IDs `0x00`–`0x5B`
and `0x9F`–`0xA1`, plus additional BW2 records needed by Aspertia:
`animation_0_once` (`0x64`), `player_receive_item` (`0x9A`),
directional `run_6f` (`0xA3`–`0xA6`) and `walk_12f` (`0xA7`–`0xAA`),
and animation-slot actions (`0xB5`–`0xB7`, `0xBA`–`0xBB`).
Animation slots depend on the actor model; `0x64` is not a universal turn.
Mom's phone actions use slots 1 and 2. Records contain a 16-bit action ID and
a 16-bit execution count; they do not contain variable-sized action operands.
Click an action for movement-specific parameter help; completion and syntax
highlighting include these names. Labels retain offset-based names because
bytecode does not contain the original authors' identifiers.

Recovered movement definitions live after the routines in canonical source and
appear together with work bindings in Definitions. An imported list that
originally occurred before later code or data carries
`movement :name, before: :next_block do`; this preserves its placement relative
to that block while allowing offsets to change. Keep this metadata when editing.
Placement anchors must name a top-level block, and cycles are rejected. Older
sources with inline movement blocks or raw `data` keep their physical order.

The decompiler recovers complete referenced lists and adjacent pools that end
at decoded code/typed-data boundaries or EOF, with up to three zero padding
bytes. Only complete lists of documented records become trusted typed data.
Unknown words in a read-only pool use
`raw_step 0xffff, 1`; this is byte preservation, not verified runtime semantics.
Malformed lists, unrelated payloads and unsupported interleaved data remain raw.
Unknown records, malformed lists and unrelated nonzero bytes retain read-only
restrictions; readable syntax alone does not establish support.

## Lossless decompilation

```typescript
import { decompileBw2Script } from "../src/pokeweb/bw2ScriptCompiler";

const result = decompileBw2Script(originalBytes, { overlayId: undefined });
// result.source, roundTripVerified, editable, warnings, stats
```

The decoder follows reachable entry points, branches, and local calls. It checks
instruction boundaries and relative pointer bounds, and separates code from
referenced movement and elevator tables. It never guesses an unknown opcode's
length. Shared entry slots, definition order, signed backward references, odd
instruction positions, padding, and unrecognized bytes are retained.

Recognizable compare/branch patterns become `if`, `if/else`, `while`, or
`case/when` blocks. Assignments and arithmetic use work bindings where their
opcodes match the high-level syntax. Local routines become helpers. Unstructured
flow keeps symbolic labels and jumps. Self-contained stack comparisons and
Boolean combinations become readable conditions when their exact opcode
sequence can be reproduced. Entry/jump targets inside an expression, arithmetic
stack operations, indirect flag IDs, and unsupported stack encodings stay explicit.
Original author names and Ruby source cannot be reconstructed from bytecode;
documented work slots use descriptive catalog aliases, while other names describe
IDs and offsets.

Every import compiles its generated source and compares the entire member byte
for byte. If recovered blocks cannot reproduce the original encoding, it retries
with explicit VM commands. A failed exact round trip rejects the import.

Imported source starts with `preserve_layout`. In that mode definitions have no
implicit halt/return and the compiler adds no final padding. Keep the generated
`halt`, `vm_return`, and `data` directives. Empty `else` clauses may be necessary
to retain an existing unconditional jump. `entry N, :label` preserves alias slots;
`block :label do` holds shared code; `label :name`, `jump :name`, and postfix
`jump :name if work_8000 == 1` preserve less structured branches. `jump_if`,
`call_if`, and numeric `cmd_XXXX` commands retain raw VM behavior. `data :name,
0x00, ...` retains exact bytes. Relative operands use symbols so entry, branch,
call, movement (`0x64`), and elevator (`0x1C1`) pointers relocate after edits.
Labels name positions without emitting an instruction or opening a helper.
`jump :label` transfers control without remembering a return address;
`call :helper` records a return address and the helper ends with `vm_return`.
Generated `loc_XXXX` names refer to original byte offsets, but remain symbolic
when edits move the code; the compiler computes their new offsets.

The imported command catalog starts with FrostsGen5Editor's BW2 layouts,
independently checked against Pokeweb's command sizes. Native US White 2
handler checks correct five callback layouts in overlays 50, 55, and 58 and add
the temporary Join Avenue shop table, overlay 60. The generator retains these
corrections. Regenerate encoding facts with
`python3 scripts/generate-bw2-command-layouts.py path/to/ScriptNARC.cs`.

Semantic names and operand roles live in
`src/pokeweb/bw2ScriptCompiler/commandFacts.json`. The current catalog adds 129
base-command names and 239 overlay-command names. Decompilation uses these
names automatically; old `cmd_XXX` / `cmd_XXXX` spellings remain accepted where
the corresponding encoding exists. Names are also available to highlighting,
autocomplete, and command/parameter help. A name does not imply that every
parameter's gameplay meaning is known; unresolved roles retain raw-operand help.

For example, `cmd_209` is `survey_set_answer question, answer`. Both operands
are literals below `0x4000` or work IDs whose values are read. Question 8 records
the Aspertia starter choice: 1 = Tepig, 2 = Oshawott, 3 = Snivy. This updates
survey/profile data, separately from the integer `bianca_intro_progress` work.

Join Avenue's `join_avenue_store_start` temporarily selects the shop command
table, and `join_avenue_store_end` restores the common table. The eight-word
`join_avenue_shop_menu` callback is decoded in the shop context. Live-path
verification follows both branch alternatives and local call/return frames;
source hints cannot excuse reaching this command with an incompatible table.
Compiled source retains per-instruction dispatch hints for edited helpers that
change table state. Unsupported or ambiguous contexts remain read-only.

**Command overlay** defaults to **Auto**. Pokeweb locates the loaded ROM's
native zone-to-command-overlay dispatcher, validates its complete table structure
and pointers, then matches the script's current map assignments. This does not
use regional RAM addresses or choose an overlay merely because it round-trips.
Dispatcher discovery was checked against the US White 2 and Black 2 ROMs.
Other ROMs must match the verified dispatcher structure; otherwise automatic
context is unavailable. A script shared by maps with conflicting command contexts
requires an explicit selection. Shared/global scripts without a map assignment
can also need manual context. Manual selections and **Base commands only** remain
available; neither loads an overlay in game.

The source retains `overlay ID`, and changing context requires a fresh import.
Automatically imported map context is rechecked before preview/apply; a changed
or unverifiable map dispatcher/context blocks edits until a new import.
The project stores a small dispatcher snapshot so releasing the full ROM buffer
after autosave does not lose context. Older saved projects acquire it from the
matching ROM in browser storage when the editor opens.
Exact round trips alone do not establish the correct runtime overlay.

Aspertia uses overlay 66. Its zero-argument commands now decompile as
`aspertia_start_petals` (`0x03E8`) and `aspertia_initialize_ending` (`0x03F3`).
Their operand-free handlers were checked in the native US White 2 overlay.

### Dialogue and associated text banks

The **Texts** tab lists story text banks assigned by every current map header
whose main or auxiliary script ID matches the selected file. Shared banks are
grouped with their map names and zones. Select a bank, search its entries, and
click an entry to edit it in the sidebar. Explicit bank references can also be
opened through **View bank**.

Clicking `msg_actor_ex` (`0x003C`) or `msg_actor` (`0x003D`), or one of their
arguments, opens the referenced dialogue in the sidebar. Literal IDs and
uppercase constants are resolved; runtime work values are reported as unresolved.
`0x0400` selects the current script's default bank, normally supplied by the map
header. `talk message:` and `read_sign message:` navigate to the same stored
entry and preview as their equivalent native message commands. A file shared by maps with different banks offers a map-specific bank
selector. Unassigned global scripts may require their caller's runtime bank.

`msg_actor_ex` takes bank, zero-based message ID, actor, window position, and
balloon type. Actor `0x00FE` is the following companion; position zero is automatic
and balloon type zero is normal. In US White 2 Aspertia file 854, entry 22,
`msg_actor_ex 0x0400, 0x0011, 0x00fe, 0, 0` displays Hugh's outlook dialogue
from story bank 169, entry 17. The preceding name-buffer command supplies his
saved rival name to `VAR(256, 1)`.

**Save text** validates encoding and decoded contents before updating the shared
story-text store and change log. It preserves entry IDs, block/flag metadata, and
other entries' contents, and refuses stale or unencodable edits. The selected text
bank is re-encoded; byte-identical script checks remain independent and script
bytes are unchanged by text saves. Export the ROM to use saved text edits.
The sidebar has **Text** and **Preview** tabs. Text retains stored `VAR(...)`,
`\\n`, `\\r`, and `\\f` controls for editing. Preview reads the current ROM's
dialogue font (`a/0/2/3`) and normal dialogue border/arrow graphics (`a/0/0/5`),
including project file replacements. No game font or frame images are bundled.
It measures native glyph advances in the normal 256×48 two-line box with a
232-pixel line allowance. Long lines are clipped and reported, never automatically
wrapped. `\\n` moves down one line, `\\r` clears the page after a pause, and `\\f`
scrolls one line after a pause; page/scroll controls consume an immediately
following newline. Page selection and 1×/2× zoom help inspect the layout.

Word/number substitutions use maximum-length `W` placeholders at the font's
widest advance. Preceding writers in the focused routine supply known limits:
player/rival names reserve seven characters and Pokémon nicknames ten. Conflicting
writers use the largest limit; loaded name banks supply name-length bounds where
available. Unidentified word buffers use a conservative 64-character allowance.
The preview lists these assumptions. It does not execute branches, resolve actual
save names, simulate actor tails or print timing, or reproduce alternate balloon
styles. Unsupported controls/glyphs are reported. The source ROM must be available
to obtain graphics; text editing remains usable if preview resources cannot load.
These features were checked against the US White 2 bank and graphics, and automated
model/UI tests; no in-game rendering test is claimed.

Unknown commands, unrecognized nonzero bytes, unsupported movements, and
unterminated typed data produce a verified **read-only** import. Source remains
viewable and can be copied. Compile & Apply is disabled, and the model refuses
changed bytecode even if a caller forces Apply. Unsupported auxiliary archive
members without an entry table cannot be decompiled as field-command files.

`decompileBw2ProjectScript(project, fileId, { overlayId })` stores the original
source, original bytes, and expected current bytes alongside the draft. Every
preview/apply rechecks the original exact round trip and rejects stale project
bytes. Changed output is decoded and round-trip checked again before mutation.
Successful apply advances expected current bytes while retaining the original
verification baseline. These records survive project persistence. Imported
layout source without a verified ROM import cannot apply through the project API.

CLI decompilation and read-only ROM auditing are also available:

```sh
npm run scripts:bw2-decompile -- script.bin --out /tmp/script.bws
npm run scripts:bw2-decompile -- script.bin --out /tmp/overlay-script.bws --overlay 51
npm run scripts:bw2-audit -- path/to/white2.nds
npm run scripts:bw2-audit -- path/to/bw2-hack.nds /tmp/bw2-audit.json
```

The decompile CLI refuses to overwrite output. The audit distinguishes nonempty
field files, empty field tables, header-assigned activation tables, and
unrecognized members. It checks field files and inserts a test `nop` into each
editable nonempty member to verify code-growth
relocation; it does not modify or export the input ROM. It now uses the same
automatic ROM-derived context and original/edited verification gates as the UI.
An optional JSON report includes per-file warnings, import versus code-growth
failure phases, map/overlay context, grouped issues, and the input ROM SHA-256.
The separate pinned-ROM audit below also performs in-memory Apply/reimport checks.
With its automatically detected overlay 66, Aspertia
file 854 is editable: it recovers 48 control-flow blocks and 50 movement blocks,
all visible in Definitions. Its original 7,996-byte decompile/compile round trip
passed. An in-memory edit grew entry 6 and a movement list to 8,002 bytes, checked
all 330 relocations, passed the edited round trip, and rebuilt the NARC with only
member 854 changed. Odd-sized control-flow edits also passed alignment checks.
No input ROM was modified, and these checks do not establish in-game acceptance.

Reproduce that focused verification with:

```sh
npx vite-node scripts/verify-bw2-aspertia-editing.ts path/to/clean-us-white2.nds
npx vite-node scripts/verify-bw2-entry-editing.ts path/to/clean-us-white2.nds
```

The entry-editing audit adds a 34th Aspertia entry and a 51st movement definition,
verifies their offsets, then removes original entry 18 with original entry 19 as
its replacement. It updates 14 references across event member 163 and special
script member 855, checks persisted reimports and byte-identical edited round
trips, and rebuilds both archives with all unrelated members unchanged. Preview
leaves original bytes untouched, including Node buffer views. All edits stay in
memory; no input ROM is written and no gameplay test is claimed.

In the tested White 2 file 854, the pre-entry initializer occupies 24 bytes at
`0x86`–`0x9D`. They decode as four `work_set_const` commands setting work IDs
`0x8020`–`0x8023` to zero. The earliest public entry begins at `0x9E`, and no
decoded relative pointer targets that prefix. The decoder now recognizes only
complete temporary zero-store sequences as unreferenced code blocks and
preserves its position before the first entry. It is not part of entry 6's
placement logic. Other complete detached routines and orphan jumps can also be
recovered: operands must fit known layouts, branches must target instruction
boundaries, and the block must have code evidence and a verified boundary or
terminator. Unknown nonzero payloads remain raw/read-only;
recognizing this encoding does not establish which runtime path executes it.
Detached recovery also checks incoming entry and branch targets: it cannot claim
an unresolved target as an instruction operand or padding. Such uncertain bytes
stay explicit and read-only when they can be preserved losslessly. Genuine
overlaps in decoded live code still fail the boundary checks.
These counts describe that ROM, not all BW2 regions or modified ROMs.

### Complete clean US White 2 field coverage

The 231 previously read-only field files are now editable. All 673 field members
pass original byte-identical decompile/compile checks, including 88 empty tables.
Recovery includes the complete documented movement namespace (`0x00`–`0xC0`),
complete unreferenced movement pools, detached compiler output, corrected native
callback operands, and shared-member contexts for files 1246, 1254, 1258, and
1287. Live code is decoded before detached ranges so recovery cannot truncate
a called helper or conceal reachable unknown bytes.

The archive-wide edit audit inserted a no-op into each of the 585 nonempty field
files, applied each change to an independent in-memory project, and reimported
the result. All remained editable and passed exact edited round trips. It
checked 21,853 original relative operands and 26,363 edited relocations, including
six Join Avenue shop calls. Every unrelated archive member remained unchanged.
The 615 map-event selection tables are a different format; member 1241 remains
unrecognized and is outside the field-command coverage claim.

```sh
npm run scripts:bw2-verify-editing -- /path/to/cleanwhite2.nds
```

The tool requires the pinned clean US White 2 ROM hash and writes its report to
ignored `work/bw2-support/edit-verification.json`. The ROM is never written.
Unknown commands, unknown movement IDs, incomplete data, overlap, malformed
pointers, conflicting dispatch states, stale imports, and failed exact round
trips continue to block editing. Newly decoded pointers must be represented by
compiler relocations, not embedded raw bytes. Older saved drafts can require
**Decompile from ROM** again before editing; this refresh recovers the symbolic
targets needed for safe code growth. These host checks do not establish gameplay
acceptance, Black 2 coverage, BW1 support, or support for other regions.

## Encoding and verification boundaries

The compiler lowers structured constructs into instructions and symbolic labels,
lays out the entire file, and patches every entry, branch, and helper call using
`target - (offset_operand_position + 4)`. Offsets are signed 32-bit little-endian
values. Conditional branches have a one-byte condition operand, so instruction
positions may be odd. The entry table ends in `0xFD13`; the file is padded to
four bytes in authored mode. Imported mode preserves its original length.
Entry offsets that would be mistaken for the terminator are rejected.

The architecture is inspired by [Rotom](https://github.com/KalaayPT/rotom).
This implementation was written independently. BW2 command layouts and comparison
IDs follow the FrostsGen5Editor BW2 BeaterScript definitions; emitted instruction
sizes are also checked against Pokeweb's existing BW2 size table.

Tests cover hand-encoded bytes, all comparison operators, short-circuit behavior,
nested loops, exclusive case branches, helper calls/returns, code growth, entry
ordering, source errors, lossless imports, typed data, overlay layouts, stale
imports, read-only gates, and project/NARC integration. A small independent test
VM executes the generated control-flow bytes. These host checks do not establish
retail gameplay acceptance or runtime call-stack capacity; keep helper call chains
shallow until an in-game test establishes the supported depth.

BW1, battle scripts, arbitrary stack-expression
recovery, result predicates, general arithmetic expressions, helper return values,
text strings, and movement expressions/helpers are not
implemented in this milestone.
