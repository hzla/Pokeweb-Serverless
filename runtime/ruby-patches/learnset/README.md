# Ruby Learnset viewer for BW2

Experimental typed-Ruby implementation of the BW2 viewer behavior, producing
separate Menu/Viewer PMC companions for checked US Black 2/White 2. Ruby runs only
on the build computer; the DS executes generated ARMv5T/Thumb code. The bundled
release and separate BW1 implementation still use C++.

`menu.rb` owns the party command and request lifetime; `viewer.rb` owns navigation
and native list details; `info.rb` renders species/form information and caches;
`logic.rb` and `info_logic.rb` implement bounded data algorithms. Native record
headers, addresses, trampolines and resource generation remain build inputs.
See [the authoring guide](../AUTHORING.md) for the language and ABI rules.

```sh
python3 runtime/ruby-patches/learnset/build.py
python3 runtime/ruby-patches/learnset/verify.py
npx vite-node runtime/ruby-patches/learnset/export_test_rom.ts /path/cleanwhite2.nds /path/new-ruby-test.nds
```

The exporter verifies the pair through normal PMC/text installation and reload
checks and refuses existing outputs. It does not change source ROMs or saves.
Cold-boot gameplay, other ROM profiles, hardware and DSi require independent
verification; isolated native fixtures are not complete game acceptance.
