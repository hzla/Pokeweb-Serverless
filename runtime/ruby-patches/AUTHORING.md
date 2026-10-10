# Writing native code injection patches in Ruby

The sections through "Adding another patch" describe the implemented frontends.
The [readable Ruby frontend plan](#readable-ruby-frontend-plan) describes the
proposed next version; its example and capabilities are not implemented yet.

Ruby source is the editable implementation. A static parser generates C or C++,
the existing ARM compiler creates Thumb code, and RPMTool packages it as a PMC
`DLXF` DLL. The DS executes that native code. The source is parsed with `Ripper`
and is never evaluated by the builder.

This is a restricted language with Ruby syntax, not general-purpose Ruby compiled
for Nintendo DS. There are no gems, Ruby objects, runtime dispatch, exceptions,
garbage collector, or interpreter in the injected module. Native allocations
still exist when the patch explicitly calls the game's allocator.

## Choose a starting point

| Frontend | Example | Best fit |
| --- | --- | --- |
| `compiler.rb` | [form_evolution.rb](form_evolution.rb) | Small scalar patches with declared calls; frontend checks widths, initialization and call contracts |
| `native_compiler.rb` | [learnset/logic.rb](learnset/logic.rb), [learnset/viewer.rb](learnset/viewer.rb) | Records, buffers, pointers, templates and native callbacks; generated C++ checks concrete types |

The rest of this guide describes the record dialect. Its type names describe the
native ABI and deliberately remain C++ type strings. Game bindings and record
layouts stay in reviewed headers; behavior stays in `.rb` files. There is no
escape that inserts an arbitrary C/C++ function body.

## Declare functions and locals

Every function needs one `signature` and one matching `def`. Parameter names and
order must agree. Returns are explicit; the last Ruby expression is not an
implicit return.

```ruby
signature :scaled_stat, returns: "u32",
          args: { value: "u32", width: "u32" }, scope: "learnset"
def scaled_stat(value, width)
  if value > 255
    value = 255
  end
  return (value * width) / 255
end
```

Use `local(:name, "type", initial_value)` for local declarations. Omit the last
argument only when the native local will be initialized before use. Supported
native types include `u8`, `u16`, `u32`, `int`, `bool`, pointers, references,
fixed arrays, record names, and `auto`. The Learnset ABI defines the integer
aliases and fixes request layouts with size and offset assertions.

```ruby
local(:count, "u32", 0)
local(:buffer, "u8[16]")
local(:list, "List", aggregate("List"))
list.count = 0
list.status = enum_value("Status", "Unavailable")
```

`aggregate("Record", ...)` initializes fields in ABI order; an empty aggregate
zero-initializes the record. An array aggregate is used inside a typed array
declaration. `construct("Archive")` invokes the declared native constructor;
scope exit invokes a declared destructor. Archive cleanup behavior is itself
implemented in Ruby. Ruby classes and `new` are unsupported.

`scope: "private"` gives functions internal linkage. `scope: "learnset"` uses
that namespace; `scope: "global"` uses the global namespace. `cpp_name` chooses
the generated native declaration name; call sites use that native name. Alias
mapping across source files is not automatic. `owner` implements
a method declared in an ABI record, and `self.field` accesses that record.
`qualifiers` accepts `inline`, `constexpr`, and `extern_c`. `templates` lists
native template type parameters. `defaults` can declare literal parameter
defaults or an ABI constant name on the generated prototype.

## Native operations and control flow

Use `if`/`else`, `while`, `return`, `break`, and `next`. `case` generates a native
switch with a break after each branch; it does not support fall-through.

```ruby
for_loop(local(:i, "u32", 0), i < count, pre_inc(i)) do
  buffer[i] = 0
end
```

`for_loop` preserves native loop scope; `each_native(array, :item, "u32")` visits
a fixed native array. `do_while(condition)` and `scope()` provide native block
scopes. The block forms use `do ... end`.

| Expression | Native meaning |
| --- | --- |
| `record.field`, `buffer[index]` | Typed field and array access; pointer fields are dereferenced by the ABI bridge |
| `truth(value)` | Native boolean conversion: zero/null is false |
| `cast("u16", value)` | Explicit native conversion |
| `cast("InfoView &", deref(state))` | A reference to the existing record; retain `&` when mutation must affect it |
| `reinterpret("u8 *", pointer)` | Explicit native pointer reinterpretation |
| `address_of(value)`, `deref(pointer)` | Address and pointer dereference |
| `mem("u32", pointer, byte_offset)` | A typed reference to a field at a verified ABI offset |
| `assign(lvalue, value)` | Assignment where Ruby syntax cannot express the native lvalue |
| `pre_inc(value)`, `post_inc(value)` | Native increment; matching decrement forms also exist |
| `size_of("Request")`, `size_of_expr(buffer)` | Native size in bytes |

Arithmetic follows the declared native types, including integer promotions,
integer division, and fixed-width unsigned wraparound. It does not use Ruby's
arbitrary-precision integers or Ruby integer truthiness. Use explicit comparisons
or `truth` in conditions. `nil` becomes a null pointer. Bounds and initialization
are the author's responsibility; the record dialect does not prove them.

Nested calls are allowed in the record dialect. They follow C++ evaluation rules,
which do not guarantee Ruby's argument evaluation order. Put calls with related
side effects into separate typed locals before combining their results.

## Bind game functions and callbacks

A native call includes its exact function-pointer type and separately verified
White 2 and Black 2 addresses. Addresses include the Thumb state bit where
required. This existing Learnset allocator binding illustrates the syntax:

```ruby
signature :alloc, returns: "void *",
          args: { heap: "u32", size: "u32" }, qualifiers: ["inline"]
def alloc(heap, size)
  return invoke(native("void*(*)(u32,u32)", 0x02039dc9, 0x02039d9d), heap, size)
end
```

`native` selects the address at build time; `invoke` calls the resulting pointer.
Record, pointer, and calling-convention declarations must match the target game.
Never derive a new game's addresses by assuming a constant offset. The existing
builder checks the Learnset hook and resource pins; a new game API needs its own
binding evidence and checks.

```ruby
local(:eligible, "auto", callback(returns: "bool", args: { slot: "u32" }) do
  return viewable(partyPokemon(party, slot))
end)
```

Callbacks capture surrounding native locals by reference. These local callbacks
must not outlive that stack frame. Persistent game callbacks use explicitly
typed function pointers and records, as in [learnset/menu.rb](learnset/menu.rb).

Globals use `global :name, { type: "...", scope: "..." }, initializer`. Exported
installer configuration records additionally use `export: true` and a named
`section`; see [learnset/config.rb](learnset/config.rb). Config markers, field
widths, complements and section layout form a contract with the app installer.

## Build, verify, and test a change

1. Edit the relevant `.rb` implementation. Change ABI headers only when native
   layout or binding evidence requires it.
2. Run both compiler test suites, rebuild, then verify the generated candidates:

   ```sh
   ruby runtime/ruby-patches/test_compiler.rb
   ruby runtime/ruby-patches/test_native_compiler.rb
   python3 runtime/ruby-patches/learnset/build.py
   python3 runtime/ruby-patches/learnset/verify.py
   ```

3. Inspect generated code and build diagnostics under `learnset/build/` when a
   binding or type fails. Edit canonical Ruby/ABI inputs, then rebuild. Generated
   source is disposable. Build and verification receipts bind checks to input
   and candidate hashes; stale artifacts are rejected.
4. Export a separate test ROM with the verified pair:

   ```sh
   npx vite-node runtime/ruby-patches/learnset/export_test_rom.ts \
     /path/to/cleanwhite2.nds /path/to/NEW-ruby-learnset-W2.nds
   ```

5. Cold boot the export in an emulator or on hardware. Follow the Learnset
   acceptance checklist in [learnset/README.md](learnset/README.md). An isolated
   CPU test or successful export does not establish full-game acceptance.

The export tool installs PMC and private messages with the normal installer,
then replaces both staged Learnset companions with the configured Ruby builds.
It verifies the exported DLL bytes and reload status. It refuses to overwrite an
existing output and does not edit source ROMs or save files. Bundled assets and
release support flags are unaffected.

## Adding another patch

The compiler is reusable; the build and hook profile remain patch-specific.
Start by identifying a native entry signature, exact hook sites and native
functions for one verified ROM revision. Keep those declarations beside the
Ruby implementation. Reuse the native toolchain, ROM signature checks,
trampolines and RPMTool packaging for that feature. Add the generated C++ source
to its builder and keep candidate output separate from shipped assets.

Before using a new binding, check native argument/return widths, ARM/Thumb state,
record alignment, heap ownership and callback lifetime. Exercise malformed data,
allocation failure, repeated entry/exit and register/stack preservation where
applicable. A new hook also needs packaged relocation/import checks and a game
acceptance run. A successful Ruby parse alone is insufficient.

This Learnset port supports US revision-0 BW2. The separate BW1 implementation
and profiles have not been ported to Ruby. Supporting other versions requires
their own layouts, bindings, hook verification and acceptance evidence.

## Readable Ruby frontend plan

Status: design proposal. The current compiler, compiled patches and test ROM
continue to use the existing typed dialect. This plan changes the authoring
language and compiler without changing the intended Learnset behavior.

### Target authoring experience

Patch behavior should read as ordinary Ruby, using snake_case methods,
predicates, guard clauses, inferred locals, keyword arguments, blocks and
implicit returns. Native declarations belong in a binding package shared by
patches. Authors should use named game objects and APIs without embedding
addresses, C++ type strings, record offsets or pointer operations in algorithms.

The first acceptance example is party navigation:

```ruby
module Learnset
  def self.next_party_slot(party, current, forward: true)
    count = party.size
    return current unless count.between?(2, 6)
    return current unless current.between?(0, count - 1)

    (1...count).each do |distance|
      offset = forward ? distance : -distance
      slot = (current + offset) % count
      return slot if party[slot]&.viewable?
    end

    current
  end
end
```

This source is the proposed target, not a supported current build input.
`Party#size`, `Party#[]` and `Pokemon#viewable?` are proposed bound APIs. An empty
slot returns `nil`; `viewable?` encapsulates the species/Egg check. The compiler
must preserve non-local return from an `each` block and Ruby's modulo behavior.
The existing native entry wrapper remains responsible for its verified ABI.

### Architecture

Use this pipeline:

`Ruby source → parsed syntax → resolved names/types → typed intermediate representation → generated C++ → existing ARM compiler → PMC DLL`.

Ripper remains the parser. A new semantic frontend handles Ruby expressions and
control flow before native emission. The current native compiler directly emits
C++ from syntax and therefore cannot by itself provide Ruby evaluation rules,
type inference or safe handling of nullable receivers. Keep it as the legacy
frontend while the new one matures. Reuse the ARM build, RPMTool packaging,
pinned hook generation and candidate export machinery.

The binding package has a Ruby-facing API and separately maintained native
metadata. It records hook entry signatures, concrete record layouts, per-game
addresses, logical method names, field/result conversions, nullability and
ownership. Native scalar results such as an Egg flag are converted to Ruby
booleans in the binding. Types originate at hooks, constants, constructors and
bound method results, then propagate through the closed call graph. Ambiguous
types require a small explicit annotation or a diagnostic on the Ruby line.

Named properties such as `request.selection` and `pokemon.egg?` lower to direct
field operations or statically resolved calls. Mutable native handles alias the
same underlying object when assigned. Immutable value records can use native
value storage. Copies and resets are explicit APIs; assigning a handle must not
silently copy its record. Bound constructors state whether storage is local or
uses a game heap, and how it is released.

### First language scope

- Modules and module methods; ordinary calls with or without parentheses;
  snake_case, `?` and `!` method names; positional and fixed keyword arguments.
- Assignments with inferred local declarations; constants and statically known
  symbols; named bound properties, constructors and setter methods.
- `if`, `elsif`, `unless`, modifier guards, `case`, ternaries, `while`, explicit
  return and implicit return from the final expression/branch.
- Integer ranges with `each`, `times`, `break`, `next`, non-escaping blocks and
  safe navigation on nullable bound handles. Ranges become loops without an
  intermediate allocation. Guarded conditions can establish iteration bounds.
- Ruby truthiness, short-circuit operators and ordered evaluation for supported
  types, plus integer comparisons and arithmetic whose supported range fits the
  generated representation.

Start with those features and named bindings. General inheritance, runtime method
redefinition, reflection, `eval`, gems, escaping closures and arbitrary dynamic
collections remain outside the first version. Statically resolved user-defined
classes and bounded collection operations follow after the first compiled slice.

### Semantic requirements

The new frontend must define and test these rules before migrating code:

| Behavior | Required lowering |
| --- | --- |
| Truthiness | Only `false` and `nil` are false; integer zero is true |
| `&&`, `||` | Short-circuit and return the appropriate operand, not an unconditional native boolean |
| Arguments and receivers | Evaluate once in Ruby order using intermediate temporaries where needed |
| `/`, `%` | Preserve Ruby integer results, including negative operands, within the supported integer range |
| Integer widths | Infer a sufficient representation; prove bounds or reject operations that could violate the documented range; no silent C++ unsigned wrapping |
| Native integer boundaries | Check narrowing or establish it from bounds; bit patterns/intentional wrap use an explicit low-level binding type |
| Implicit return | Return the final expression's value on each supported path; diagnose incompatible result types |
| Blocks | Inline supported iteration blocks, preserve enclosing-method return and reject escaping captures |
| Indexing | Distinguish a bound `Party#[]` API from Ruby Array semantics; define nil/out-of-range results and validate accesses |
| Mutation | Keep mutable handle identity and enforce ownership/lifetime rules |

This remains a supported Ruby subset. Arbitrary-precision integer growth is not
part of the initial native implementation. An unsupported construct fails with
a Ruby source location and a suggested supported form, rather than falling back
to an altered meaning or silently ignoring arguments. Full array/string behavior
must not be implied by a custom bound buffer type.

### Implementation sequence and gates

1. **Specify the source before building the compiler.** Use the party-navigation
   example, one small learnset parser and one viewer refresh routine to establish
   the desired style. Inventory the binding methods, return types, capacities and
   lifetimes each requires. Mark every example as proposed until it compiles.
2. **Build the binding model and semantic core.** Implement name/method resolution,
   inference, definite assignment, source locations and the typed intermediate
   representation. Add Ruby truthiness, evaluation order, numeric rules, guard
   clauses and implicit returns before adding collection conveniences.
3. **Compile one complete navigation slice.** Add keyword defaults, range/block
   lowering, predicates and nullable receivers. Compile the example through the
   existing native build. Compare ordinary Ruby execution with native execution
   over party sizes, starting slots, both directions, Eggs and empty slots. Run
   the existing exhaustive party-scan tests and stack/register checks.
4. **Migrate the Learnset data algorithms.** Add bounded buffers, immutable record
   constructors and typed status symbols. Port parsing, sorting, duplicate checks,
   family traversal and text wrapping in small groups. Document capacity and
   failure behavior; collections must not silently truncate or expand without a
   memory budget. Defer allocating Enumerable chains until their behavior and
   storage are explicitly supported.
5. **Migrate viewer sessions and rendering.** Introduce named party/request/window/
   archive APIs and block-scoped resource ownership. Guarantee cleanup on early
   return, `break` and failure; retained session data requires explicit ownership.
   Port lifecycle, navigation, caches and rendering against those APIs.
6. **Verify and deliver the readable implementation.** Run compiler rejection and
   semantic tests, host algorithms, both games' CPU wrappers/rendering/navigation/
   cache cases, packaged DLL configuration/import checks and ROM export/reload.
   Build a separately named White 2 test ROM. Complete cold-boot game acceptance
   separately from isolated CPU evidence. Update this guide and the Learnset
   source map as each feature becomes available.

The first milestone is complete when the navigation example compiles without
native syntax in its body, matches the Ruby reference on supported inputs, and
passes the native navigation checks. The larger migration is complete when the
Learnset behavior files use this authoring model, raw ABI details are confined
to bindings/infrastructure, and both games pass the existing verification gates.

### Documentation and build integration

Keep the current authoring instructions available while the new frontend is
experimental. Add a capability table identifying implemented syntax, planned
syntax and exclusions. Each advertised example must be a compiler fixture and,
where applicable, run against both ordinary Ruby and the native implementation.
Source diagnostics should link to the corresponding supported-language rule.

The builder should select the frontend explicitly and include semantic compiler,
binding package, source and generated native artifact hashes in receipts. Keep
candidate outputs separate from bundled releases, and preserve exact hook,
configuration and callback ABI contracts. BW2 remains the initial target; the
separate BW1 profiles require their own migration and acceptance work.
