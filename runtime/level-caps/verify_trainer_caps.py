"""Run the shipped companion and retail return callback in an ARM946 CPU model.

Native callees and NitroFS I/O are stubbed; this is CPU verification, not a DS
playthrough. Supply clean US revision-0 ROMs to verify both retail call sites.
"""
import argparse
import json
from pathlib import Path
import struct
import sys

import ndspy.rom
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import UC_CPU_ARM_946, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "runtime/battle-type-hud"))
from rpm_read import read_rpm, thumb_bl

BASE, WORK, SETUP, GAME, EVENT, CAP = 0x02300000, 0x02310000, 0x02311000, 0x02312000, 0x02313000, 0x02314000
TRAINER, SECOND, ALLY, STACK, STOP = 0x02315000, 0x02315100, 0x02315200, 0x023f0000, 0x02008000
REGS = [UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3]


def run(game, rom, profile, *, result=1, battle_type=1, cap=30, authored=55, secondary=0, ally=0,
        flags=0, online=0, network=0, field_return=1, trial_house=0, trainer_id=800, table=None, missing=False,
        short_read=False, no_game=False, null_event=False, null_variable=False):
    rpm = read_rpm((REPO / "src/assets/codeinjection" / profile["fileName"]).read_bytes())
    uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
    uc.ctl_set_cpu_model(UC_CPU_ARM_946)
    uc.mem_map(0x02000000, 0x400000)
    code = bytearray(rpm["code"])
    hook = None
    for r in rpm["relocations"]:
        symbol = rpm["symbols"][r["symbol"]]
        destination = symbol["address"] + (0 if symbol["attributes"] & 4 else BASE)
        if r["module"] == "12":
            hook = (r["address"], thumb_bl(r["address"], destination))
        elif r["type"] == "THUMB_BRANCH_LINK":
            code[r["address"]:r["address"] + 4] = thumb_bl(BASE + r["address"], destination)
        else:
            assert r["type"] == "OFFSET"
            struct.pack_into("<I", code, r["address"], destination)
    uc.mem_write(BASE, bytes(code))
    overlay = rom.loadArm9Overlays([12])[12]
    uc.mem_write(overlay.ramAddress, bytes(overlay.data))
    uc.mem_write(hook[0], hook[1])
    pack = lambda address, value: uc.mem_write(address, struct.pack("<I", value))
    pack(WORK, 0x12345678); pack(WORK + 4, 0 if no_game else GAME); pack(WORK + 8, SETUP); pack(WORK + 0x28, flags)
    pack(WORK + 0x14, field_return); pack(WORK + 0x1c, trial_house); pack(SETUP + 0x1c, network)
    pack(SETUP, battle_type); pack(SETUP + 0xa8, result); uc.mem_write(SETUP + 0x20, bytes([online]))
    for offset, ptr, trainer in [(0x4c, TRAINER, trainer_id), (0x54, SECOND, 801), (0x50, ALLY, 802)]:
        pack(SETUP + offset, ptr); pack(ptr, trainer)
    uc.mem_write(CAP, struct.pack("<H", cap))
    if table is None:
        table = bytearray(struct.pack("<IHHII", 0x434c5750, 1, 1, 803, 16415) + bytes(803))
        table[16 + 800] = authored; table[16 + 801] = secondary; table[16 + 802] = ally
    position = 0
    calls = []
    delta = -44 if game == "B2" else 0
    api = {address + delta: name for address, name in [(0x02070ca8, "init"), (0x02070ecc, "open"), (0x02070e6c, "read"),
           (0x02070dec, "length"), (0x02070e54, "seek"), (0x02070de0, "close")]}
    api[0x02017394] = "event"
    api[0x02019294 if game == "B2" else 0x020192c0] = "variable"
    api[0x02168f38 if game == "B2" else 0x02168f78] = "broadcast"
    api[0x020174b4] = "last_result"
    api[0x020171f4] = "player_state"
    api[0x02017544] = "zone"
    api[0x02032f3c if game == "B2" else 0x02032f68] = "weather"
    api[0x0216907c if game == "B2" else 0x021690bc] = "fled"

    def intercept(emu, address, _size, _data):
        nonlocal position
        if address == STOP:
            emu.emu_stop(); return
        name = api.get(address)
        if name is None: return
        a, b, c, _ = [emu.reg_read(reg) for reg in REGS]
        calls.append(name)
        value = 0
        if name == "broadcast": assert a == WORK
        elif name == "last_result": assert (a, b) == (GAME, result)
        elif name == "event": assert a == GAME; value = 0 if null_event else EVENT
        elif name == "variable": assert (a, b) == (EVENT, 16415); value = 0 if null_variable else CAP
        elif name == "open":
            assert bytes(emu.mem_read(b, 28)).split(b"\0")[0] == b"rom:/battle/trainer-caps.bin"
            value = 0 if missing else 1
        elif name == "length": value = len(table)
        elif name == "seek": assert c == 0; position = b; value = 1
        elif name == "read":
            payload = table[position:position + c - (1 if short_read else 0)]
            emu.mem_write(b, bytes(payload)); position += len(payload); value = len(payload)
        elif name == "close": value = 1
        # Exercise caller-saved clobbers as retail functions are allowed to do.
        for reg in REGS: emu.reg_write(reg, 0xeeeeeeee)
        emu.reg_write(UC_ARM_REG_R0, value)
        emu.reg_write(UC_ARM_REG_PC, emu.reg_read(UC_ARM_REG_LR))

    uc.hook_add(UC_HOOK_CODE, intercept)
    uc.reg_write(UC_ARM_REG_R0, WORK); uc.reg_write(UC_ARM_REG_R1, GAME)
    uc.reg_write(UC_ARM_REG_SP, STACK); uc.reg_write(UC_ARM_REG_LR, STOP | 1)
    saved = [UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7]
    for i, reg in enumerate(saved): uc.reg_write(reg, 0x11111111 * (i + 1))
    uc.emu_start(profile["signatureAddress"] | 1, STOP, count=20000)
    assert uc.reg_read(UC_ARM_REG_PC) == STOP, "Callback did not return"
    assert uc.reg_read(UC_ARM_REG_SP) == STACK
    for i, reg in enumerate(saved): assert uc.reg_read(reg) == 0x11111111 * (i + 1)
    assert calls.count("broadcast") == 1 and calls.count("last_result") == 1 and calls.count("weather") == 1
    assert calls.count("close") == (1 if "open" in calls and not missing else 0)
    return struct.unpack("<H", uc.mem_read(CAP, 2))[0], calls


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--black2", required=True, type=Path)
    parser.add_argument("--white2", required=True, type=Path)
    args = parser.parse_args()
    profiles = json.loads((REPO / "src/assets/codeinjection/trainerLevelCapsManifest.json").read_text())
    for game, path in [("B2", args.black2), ("W2", args.white2)]:
        rom = ndspy.rom.NintendoDSRom.fromFile(path)
        p = profiles[game]
        with path.open("rb") as input_file:
            header = input_file.read(32)
        assert rom.idCode.decode() == p["idCode"] and header[0x1e] == 0
        overlay = rom.loadArm9Overlays([12])[12]
        at = p["signatureAddress"] - overlay.ramAddress
        assert overlay.data[at:at + len(p["expectedHex"]) // 2].hex() == p["expectedHex"]
        cases = [(dict(), 55), (dict(cap=100), 55), (dict(cap=0, authored=1), 1), (dict(authored=100), 100),
                 (dict(authored=0), 30), (dict(authored=101), 30), (dict(trainer_id=65535), 30),
                 (dict(authored=0, secondary=60), 60), (dict(authored=55, secondary=40), 55),
                 (dict(authored=0, secondary=0, ally=100), 30), (dict(missing=True), 30),
                 (dict(short_read=True), 30), (dict(no_game=True), 30), (dict(null_event=True), 30), (dict(null_variable=True), 30)]
        cases += [(dict(result=result), 30) for result in [0, 2, 3, 4, 5, 6]]
        cases += [(dict(battle_type=kind), 30) for kind in [0, 2, 3, 4, 5, 6]]
        cases += [(dict(flags=4), 30), (dict(online=1), 30), (dict(network=1), 30), (dict(field_return=0), 30), (dict(trial_house=1), 30)]
        good = bytearray(struct.pack("<IHHII", 0x434c5750, 1, 1, 801, 16415) + bytes(800) + b"\x37")
        for index in [0, 4, 6, 8, 12]:
            bad = good.copy(); bad[index] ^= 0xff; cases.append((dict(table=bad), 30))
        cases += [(dict(table=good[:-1]), 30), (dict(table=good + b"\0"), 30)]
        for options, expected in cases:
            actual, calls = run(game, rom, p, **options)
            assert actual == expected, (game, options, actual, expected, calls)
            if (options.get("result", 1) != 1 or options.get("battle_type", 1) != 1 or options.get("flags")
                    or options.get("online") or options.get("network") or not options.get("field_return", 1) or options.get("trial_house")):
                assert "open" not in calls
        print(f"{game}: retail signature and {len(cases)} compiled callback scenarios passed")


if __name__ == "__main__":
    main()
