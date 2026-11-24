# PWT Ability Selection

Install **PWT Ability Selection** in **Code Injection → Minor Features/Add-ons** for US Black 2 or White 2 revision 0. Choose **Random** or a named ability slot on a trainer or rental set in the PWT editor, then export the ROM. Set copies carry the same slot choice. The patch works alongside **Six-Pokémon PWT**.

Byte `0x0A` of a 16-byte PWT set stores the six EV flags in bits 0–5 and the ability selection in bits 6–7. Values 0–3 represent Random, slot 1, slot 2, and Hidden. The game resolves the slot from the Pokémon's current form when it builds the party. Ability IDs 1–255 are supported. Random and unavailable slots use retail generation. The installer checks for existing use of these bits before enabling them.

Run `python3 runtime/pwt-abilities/build.py` to regenerate the Thumb code. The build uses `arm-none-eabi-gcc`, `arm-none-eabi-objcopy`, and `arm-none-eabi-nm`. Set `ARM_TOOLCHAIN_PREFIX` to use a different toolchain location.
