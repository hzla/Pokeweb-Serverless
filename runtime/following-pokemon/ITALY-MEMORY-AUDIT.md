# Italian White 2 follower memory audit

Version: 0.6.49-alpha. Generated from packaged W2I DLLs and the exported ROM.

| Module | Code and initialized data | BSS | Combined payload |
|---|---:|---:|---:|
| PokewebFollowingCoreW2I | 652 B | 136 B | 788 B |
| PokewebFollowingEventsW2I | 1,436 B | 28 B | 1,464 B |
| PokewebFollowingFieldW2I | 44,880 B | 20,084 B | 64,964 B |
| PokewebFollowingOptionsW2I | 1,996 B | 40 B | 2,036 B |
| PokewebFollowingBattleW2I | 364 B | 0 B | 364 B |

Total fixed module payload: **69,616 B**.
Species index: 1,302 B; page cache: 1,024 B; movement trail: 64 records.
Generic dialogue buffer: 8,192 B; shared contextual/gift scratch: 4,096 B.
The language record is loaded only on a Bag-full response into the existing scratch buffer.
These values exclude loader metadata, native graphics allocations, stack and VRAM. No steady-state hardware heap measurement has been made.
