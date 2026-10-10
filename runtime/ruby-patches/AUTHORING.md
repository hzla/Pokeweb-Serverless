# Writing native code injection patches in Ruby

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
