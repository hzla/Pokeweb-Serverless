"""Verify the retail ARM9 sites used by the background-music toggle."""
from pathlib import Path
import sys

import ndspy.codeCompression
import ndspy.rom

HERE = Path(__file__).resolve().parent
WORKSPACE = HERE.parents[2]
PROFILES = {
    "W2": {
        "rom": WORKSPACE / "cleanwhite2.nds",
        "id": b"IRDO",
        "held": 0x0203DF4C,
        "sound_delta": 0,
    },
    "B2": {
        "rom": WORKSPACE / "cleanblack2.nds",
        "id": b"IREO",
        "held": 0x0203DF20,
        "sound_delta": -0x2C,
    },
}
GAME_UPDATE_SOUND_CALL = 0x02005336
SOUND_UPDATE = 0x02005C18
BGM_SET_PAUSED = 0x02005E54
HOOK_CALLS = [0x02005E02, 0x02005E62, 0x02005EB0, 0x02005FA2]
STREAM_ENTRY_BYTES = {
    0x02007054: bytes.fromhex("70b5"),
    0x02007090: bytes.fromhex("0248"),
    0x020070A4: bytes.fromhex("08b5"),
    0x020070C0: bytes.fromhex("011c"),
}


def read_at(arm9, base, address, length):
    offset = address - base
    if offset < 0 or offset + length > len(arm9):
        raise AssertionError(f"Address outside ARM9: 0x{address:08X}")
    return arm9[offset:offset + length]


def verify(profile, rom_path):
    rom = ndspy.rom.NintendoDSRom.fromFile(rom_path)
    assert bytes(rom.idCode) == profile["id"], f"Unexpected ROM revision: {bytes(rom.idCode)!r}"
    assert rom.arm9RamAddress == 0x02004000, f"Unexpected ARM9 base: 0x{rom.arm9RamAddress:08X}"
    arm9 = ndspy.codeCompression.decompress(rom.arm9)

    # The hook replaces this BL and runs the same native sound update first.
    assert read_at(arm9, rom.arm9RamAddress, GAME_UPDATE_SOUND_CALL, 4) == bytes.fromhex("00f06ffc")
    assert read_at(arm9, rom.arm9RamAddress, SOUND_UPDATE, 2) == bytes.fromhex("f8b5")
    assert read_at(arm9, rom.arm9RamAddress, BGM_SET_PAUSED, 2) == bytes.fromhex("10b5")
    assert read_at(arm9, rom.arm9RamAddress, profile["held"], 2) == bytes.fromhex("08b5")
    for address in HOOK_CALLS:
        upper, lower = read_at(arm9, rom.arm9RamAddress, address, 4)[0:2], read_at(arm9, rom.arm9RamAddress, address, 4)[2:4]
        assert upper[1] & 0xF8 == 0xF0 and lower[1] & 0xF8 == 0xF8, f"Expected Thumb BL at 0x{address:08X}"
    for address, expected in STREAM_ENTRY_BYTES.items():
        assert read_at(arm9, rom.arm9RamAddress, address, 2) == expected
    for address, expected in {
        0x02005DF4: "38b5",  # public BGM play wrapper
        0x02005EA0: "10b5",  # public fade-out wrapper
        0x02005CE4: "01480069",  # native sound heap getter
    }.items():
        assert read_at(arm9, rom.arm9RamAddress, address, len(bytes.fromhex(expected))) == bytes.fromhex(expected)
    for address, expected in {
        0x0206DB6C: "f8b582b00090294801910168",  # native stream init
        0x0206DD10: "10b5041cfff7d4ff002801d1",  # native stream start
        0x0206DD2C: "08b50268002a02d0006800f0",  # native stream stop
        0x0206BEEC: "08b50368002b07d000685300",  # handle / track-mask / volume
        # Native sound-block allocation: 32-byte alignment and header, null
        # return on exhaustion, callback/data retained in the native section.
        0x0206D108: "f8b5051c0e1c171c1f311f2291432868203120220093f2f7c1f8041c01d10020f8bd",
        # Native frame-heap header is 0x24 bytes before its allocator cursors.
        0x0205F2A4: "08b52430002900d101210323c91c9943002a02dbfff78cff08bd",
        # Our sixth hook replaces only this allocation call. Its live r6 is
        # written into player.bufSize at +0x138 after native ForceStopStrm.
        0x0206DC70: "4b208000285c114a2b1cc602002000900198311cfff740fa071c02d102b00020f8bd281c00f088fa4d2080002f50001d2e50",
        # Native position reads the sample read head (+0x168), at rate +0xcc.
        0x0206DD58: "10b50168002901d1002010bd04685a2080000021fa22205892000b1c1ff060eccc34228800231ff038ec10bd",
    }.items():
        assert read_at(arm9, rom.arm9RamAddress, address + profile["sound_delta"], len(bytes.fromhex(expected))) == bytes.fromhex(expected)
    # Both US builds reserve the same fixed 0x9d000-byte sound heap.
    assert read_at(arm9, rom.arm9RamAddress, 0x02005B86, 6) == bytes.fromhex("9d210a480903")


def main():
    paths = {
        "W2": Path(sys.argv[1]) if len(sys.argv) > 1 else PROFILES["W2"]["rom"],
        "B2": Path(sys.argv[2]) if len(sys.argv) > 2 else PROFILES["B2"]["rom"],
    }
    for version, profile in PROFILES.items():
        verify(profile, paths[version])
        print(f"{version}: verified sound hook and BGM/input entry points")


if __name__ == "__main__":
    main()
