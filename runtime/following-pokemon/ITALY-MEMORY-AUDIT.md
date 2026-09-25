# Italian White 2 follower memory audit

Version: 0.6.38-alpha. Generated from packaged W2I DLLs and the exported ROM.

| Module | Code and initialized data | BSS | Combined payload |
|---|---:|---:|---:|
| PokewebFollowingCoreW2I | 1,728 B | 4 B | 1,732 B |
| PokewebFollowingEventsW2I | 1,500 B | 136 B | 1,636 B |
| PokewebFollowingFieldW2I | 38,524 B | 19,996 B | 58,520 B |

Total fixed module payload: **61,888 B**.
Species index: 1,302 B; page cache: 1,024 B; movement trail: 64 records.
Generic dialogue buffer: 8,192 B; shared contextual/gift scratch: 4,096 B.
The language record is loaded only on a Bag-full response into the existing scratch buffer.
These values exclude loader metadata, native graphics allocations, stack and VRAM. No steady-state hardware heap measurement has been made.
