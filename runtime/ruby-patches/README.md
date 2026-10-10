# Ruby PMC patches

This directory contains two experimental Ruby frontends for native PMC patches:

- [Form Evolution](form_evolution.rb), the original small scalar MVP described below.
- [Learnset viewer](learnset/README.md), a complete BW2 behavior port using typed
  records, native pointers, callbacks, archive readers, and rendering.

[AUTHORING.md](AUTHORING.md) documents how to write, build, and verify Ruby code
injection patches. The two dialects have different capabilities; choose the
record dialect for code based on the Learnset viewer. Neither runs Ruby on the DS.

This experimental frontend ports the existing BW2 Form Evolution patch from
`runtime/form-evolution/form_evolution.cpp` to [form_evolution.rb](form_evolution.rb).
It resolves form personal-record IDs to a base species and form, resets the old
form before changing species, and preserves the original fallback behavior.

The build pipeline is Ruby syntax → generated C → native ARMv5T/Thumb ELF →
RPMTool → PMC `DLXF` DLL. Ruby is used on the build computer. The DS executes
native instructions, with no Ruby interpreter, object heap or garbage collector.

## Build and verify

Run from the repository root:

```sh
ruby runtime/ruby-patches/test_compiler.rb
python3 runtime/ruby-patches/build.py
python3 runtime/ruby-patches/verify.py
npx vite-node runtime/ruby-patches/verify_install.ts
```

Requirements are Ruby with the standard `Ripper`, `JSON` and `Minitest` libraries,
Python 3, Java, the existing ARM toolchain and RPMTool, and Python `unicorn` for
CPU verification. The importer check uses the repository's Node dependencies.
The builder uses the same defaults as the native Form Evolution builder;
`ARM_TOOLCHAIN_BIN`, `RPM_TOOL_JAR`, `BW2_W2_ESDB` and `RUBY` can override them.

Candidates are written to:

- `build/ruby/FormEvolutionB2.dll`
- `build/ruby/FormEvolutionW2.dll`

Generated C, ELF files, native reference builds, and verification reports remain
under the ignored `build/` directory. Rebuild after editing Ruby, compiler or
binding inputs; the CPU verifier rejects stale build receipts. The builder does
not change bundled assets, ROMs or saves.

These candidates replace the corresponding Form Evolution module when manually
imported through Pokeweb's existing PMC DLL importer. Use the matching game and
the existing `FormEvolutionB2.dll`/`FormEvolutionW2.dll` filename so the module is
replaced; installing another copy under a different filename would duplicate
the hooks. The supported bindings are US B2/W2 revision 0. BW1 and other language
or revision targets require separate verified profiles.

## Supported language

The source is parsed, never evaluated. Top-level declarations describe approved
native functions and typed patch functions:

```ruby
native :change_form, symbol: "PokeParty_ChangeForme",
       args: [:ptr, :u32], returns: :u32

signature :apply_evolution_target,
          args: { pokemon: :ptr, target: :u16 }, returns: :void
```

Functions support positional parameters, local assignments, `if`/`else`,
`while`, explicit `return`, and declared function calls with parentheses.
Integer addition, subtraction, multiplication and bitwise `&`, `|`, `^` operate
as unsigned 32-bit arithmetic, including wraparound. Comparisons produce
booleans; `&&`, `||` and `!` require boolean operands. Conditions require explicit
comparisons because Ruby's integer truthiness differs from C. Locals are typed
from their first assignment, and reads require definite initialization.

Types are `u8`, `u16`, `u32`, `ptr`, `bool`, and `void` return values. Integers
may widen; implicit narrowing, negative literals and values beyond `u32` are
rejected. Value-returning functions require explicit returns on every path;
there is no implicit last-expression return. Native ABI declarations must match
the game. Calls can be standalone, assigned or returned; nested calls and calls
inside expressions are rejected to avoid changing Ruby's evaluation order.

This is a restricted language using Ruby syntax. Classes, arrays, strings in
patch functions, gems, dynamic methods, `eval`, exceptions, pointer arithmetic,
and general Ruby runtime behavior are unsupported. Unsupported syntax fails the
build. The compiler does not prove loop bounds or recursion depth; patch authors
must bound execution and stack use. The supplied lookup scans at most 649 species.

Hook sites are separate from the Ruby logic in
[form_evolution.json](form_evolution.json). This MVP emits function-call hooks
with the same signature as the patch entry function. Other hook conventions
and more game APIs require additional bindings and verification.

## Validation

The initial B2 and W2 candidates each contain 132 bytes of native code and zero
bytes of BSS, compared with 136 bytes and zero BSS for the C++ baseline. Each DLL
is 768 bytes, compared with 784 bytes for the native baseline.

The native reference rebuild matches the bundled DLL byte for byte. CPU checks
apply relocations from the packaged DLLs and execute both overlay 284 hook
branches in an ARM946 model. Across 49 cases, two starting forms, two hooks and
two games, 392 comparisons verify native call traces, final species/form,
callee-saved registers, and stack restoration. Cases cover ordinary targets,
range endpoints, first/last species, invalid record counts, overlapping records,
unknown targets, maximum `u16` targets and deterministic generated ranges.

Compiler rejection tests cover unsupported Ruby, integer truthiness,
uninitialized locals, narrowing, argument types/counts and evaluation order.
The Pokeweb importer check stages both candidates in isolated project state,
verifies duplicate suppression and rejects wrong-game imports. Existing PMC and
Menu Evolution regression tests also pass.

The three native game functions are stubbed in CPU tests. No in-game emulator or
hardware acceptance run has been performed for the Ruby candidates; the shipped
implementation remains the C++ baseline. Full-game behavior still needs an
acceptance run before promoting these builds into bundled assets.
