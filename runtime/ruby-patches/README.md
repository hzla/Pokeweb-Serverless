# Ruby PMC patches

Experimental build-time Ruby frontends for [Form Evolution](form_evolution.rb)
and the [BW2 Learnset viewer](learnset/README.md). The pipeline is restricted Ruby
syntax → generated C/C++ → ARMv5T/Thumb ELF → RPMTool → PMC DLL. No Ruby
interpreter, object heap or garbage collector runs on the DS.

The scalar frontend handles the small Form Evolution implementation. The typed
record frontend adds native pointers, records, callbacks and rendering for the
Learnset port. These are different restricted dialects; see
[AUTHORING.md](AUTHORING.md) for supported syntax, bindings and build workflow.
Native ABIs, hook profiles and resource generation remain explicit.

```sh
ruby runtime/ruby-patches/test_compiler.rb
ruby runtime/ruby-patches/test_native_compiler.rb
python3 runtime/ruby-patches/build.py
python3 runtime/ruby-patches/verify.py
```

Requires Ruby's Ripper/JSON/Minitest, Python, Java, ARM GNU tools, RPMTool and
Unicorn for CPU verification. Candidate builds remain separate from shipped
C++ runtimes. US revision-0 BW2 is the initial target; BW1 is not ported. Parsing,
CPU checks and export success do not establish full-game compatibility.
