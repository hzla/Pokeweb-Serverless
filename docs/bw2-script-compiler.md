# Ruby-like BW2 field-script compiler and decompiler

The first compiler milestone produces a complete BW2 field/event script NARC
member from a restricted Ruby-syntax source file. It supports structured control
flow, zero-argument helper calls, automatic relative offsets, and lossless imports
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
- Zero-argument `def helper` or `def helper()`. Call with `helper`, `helper()`,
  or `call :helper`. Forward and backward calls are supported; recursion is
  rejected. Helpers cannot call public entry scripts.
- `return` halts a public script or returns from a helper. Reaching the end of
  a definition emits the corresponding halt/return instruction. There are no
  returned expression values or implicit Ruby expression returns.
- Assignments to bound work variables: `counter = 3`, `counter = other`,
  `counter += 1`, and `counter -= other`.

Conditions support `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`, `!`, parentheses,
`true`, and `false`. Boolean operators short-circuit in the default comparison
encoding. Numeric conditions require
an explicit comparison such as `counter != 0`; they do not use Ruby truthiness.
Comparison operands are integers, constants, or work bindings. `when` values
must be distinct constants. Arithmetic literals must be below `0x4000`, because
the BW2 arithmetic operand convention interprets larger values as work IDs.
Assignments and explicit constant comparisons retain their literal 16-bit form.

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
| `face_player` | `0x0074` | None |
| `play_sound` | `0x00A6` | Sound operand |

These commands take unsigned integer/constant operands. Documented work/literal
operands of `set_flag`, `clear_flag`, and `play_sound` also accept work bindings;
the compiler emits their numeric work ID for the game to resolve at runtime.
Message lifecycle commands are explicit. Authors must supply appropriate message operands and cleanup
such as unlocking actors before an early script return.

## Use with a loaded Pokeweb project

Open **Texts → BW2 Scripts** after loading a Black 2 or White 2 ROM with the
Scripts archive. Select a script file, then click **Decompile from ROM** or write it
in the Ruby-like editor. Syntax highlighting, line numbers, command completion,
undo/redo, and live compiler errors are available. Click an error location to
jump to its source line.

The source editor has **Script** and **Definitions** tabs. Script opens by default
with entries, helpers and shared code. Definitions holds the leading work bindings,
constants, layout directives, entry aliases and preserved data before the first
routine. Both sections compile together as one source file in their original
order; there is no separate include file or change to ROM layout. Drafts keep
both sections, and each editor keeps its own selection and undo history while
switching tabs. Work completion in Script includes bindings from Definitions.
Entry/helper navigation opens Script, and compiler-error links open the relevant
tab at its local line number.

The workspace uses a 60% source / 40% map split, with a 2D map on the right.
The preview uses the overworld editor's terrain and entity renderers. Headers
identify the map assigned to the selected script file; when multiple maps use a
file, select the desired map above the preview. Necessary event, matrix, and map
resources load from the same source ROM without dirtying them.

Moving the cursor inside an entry highlights its assigned NPCs, signs, or
triggers. Inside a helper, highlights follow transitive local callers, including
shared helpers with multiple owners. Entry aliases and shared code blocks are
supported. Uncalled helpers and map initialization entries may have no entity
assignment. Solid bright red outlines mark assigned entities; dashed red outlines
mark a supported command's literal actor target when it is not already assigned.
A white inner halo and red glow keep both visible against the map.
Markers show event-data placements; the
preview does not execute story branches or simulate script-driven repositioning.
Drag to pan, scroll to zoom, or use Fit. The source navigation menu jumps to
entries and helpers. Source context remains available during incomplete edits.

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
in the loaded project. Failed compilation or an entry-count mismatch disables
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
requires a BW2 project, a recognized original entry table, and the same number
of source entries as the original. Compilation and validation finish before
mutation. Successful replacement invalidates the cached member, marks it dirty,
and records a changelog entry for the normal materialization/export path. It
also retains the successfully applied source in `project.bw2ScriptEditor`.

This is whole-file authoring: all original entry meanings and helper behavior
must be represented in the replacement source. Applying does not preserve code
that the author deletes or remap events. Keep downloaded
`.bws` files for portable source backups.

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

The imported command catalog uses FrostsGen5Editor's BW2 layouts, independently
checked against Pokeweb's command sizes. Regenerate encoding facts with
`python3 scripts/generate-bw2-command-layouts.py path/to/ScriptNARC.cs`.

Like Frost's editor, **Command overlay** selects the definitions for opcodes
1000 and above. Select the overlay actually loaded by the event before clicking
**Decompile from ROM**. This is explicit context, not automatic detection or a
request to load an overlay in game. Multiple overlays can decode the same bytes
plausibly; exact round trips alone cannot establish the correct runtime overlay.
The source retains `overlay ID`, and changing context requires a fresh import.

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
```

The decompile CLI refuses to overwrite output. The audit checks recognized table
members and inserts a test `nop` into each editable member to verify code-growth
relocation; it does not modify or export the input ROM. With base commands only,
the tested US White 2 (`IRDO`) ROM had 585 recognized members: all 585 round trips
passed, 310 were editable and passed code-growth checks, and 275 remained
read-only. The other 704 members had empty or unrecognized command entry tables.
The alias/stack-condition update recovered 3,203 structured blocks across those
585 members. Aspertia file 854 recovered 46 blocks while retaining its read-only
status for unsupported commands and data.

In the tested White 2 file 854, `data :bytes_86` preserves 24 bytes at
`0x86`–`0x9D`. They decode as four `work_set_const` commands setting work IDs
`0x8020`–`0x8023` to zero. The earliest public entry begins at `0x9E`, and no
decoded relative pointer targets that prefix. It is retained as unreferenced
initialization bytes for lossless import; it is not part of entry 6's decoded
placement logic. Unsupported commands prevent stronger claims about all possible
runtime paths. The leading data appears in Definitions, with its original
physical position retained when compiling.
These counts describe that ROM, not all BW2 regions or modified ROMs.

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

BW1, battle scripts, automatic overlay discovery, arbitrary stack-expression
recovery, result predicates, general arithmetic expressions, helper parameters,
text strings, movement builders, and automatic temporary allocation are not
implemented in this milestone.
