#!/usr/bin/env python3
"""Stage and validate the canonical White 2 single-NPC double-battle fix."""

from __future__ import annotations

import argparse
import base64
import hashlib
import struct
from pathlib import Path

import ndspy.codeCompression


PATCH_NAME = "DoubleBattleFixW2.dll"
PATCH_SHA256 = "d8ea7bfd01775ea0d30d235845a31f9a66a6876829747133d4d6661e7a841170"
PATCH_SIZE = 1520
OVERLAY_ID = 36
OVERLAY_RAM_ADDRESS = 0x0217F640

# These are the retail IREO instructions replaced by the two RPM THUMB_BRANCH
# relocations. Keeping the checks narrow allows unrelated overlay work while
# rejecting a second patch that owns either hook site.
HOOK_WINDOWS = {
    0x021A5D6C: bytes.fromhex("f8b58cb0051c0026daf7c2fb70f6aefe"),
    0x021A6910: bytes.fromhex("f8b50c1c051c201caef754fcadf7fefa"),
}

# Pinned from Pokeweb's canonical White 2 patch. Embedding the small RPM keeps
# this repository's ROM build self-contained and avoids a dependency on a
# sibling checkout or a machine-specific path.
PATCH_BASE64 = """
RExYRvAFAABAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4tRYAHQAGn6bxIvsyAAAhd2EEAFTx0P8ALQXQKgABISAAb2FU8cj/IAD4
vRO1AyQAlP/35f8WvRO1AiQAlP/33/8WvRO1ASQAlP/32f8WvQAjB7UAk//30/8OvfC1j7AEAIDxO/oGABbwJv0AIQGQAqogAKXx
Hv8AKALRACAPsPC9MAACnQafgvGS/wCQKACm8Wj6ACgT0CkAIAAIqqXxCf8GAAGYavEr+gAoJ9EAmwErLdwpACAAAqr/98n/3uc4
AFTxwf8BKBHROQAoAKbxkfoBHuDQBJsDmgiopvF6+ikAIAAIqwKq//es/8fnACjS0AEowt0AmwIr29y+5wAu2NApACAACKsCqv/3
j/+25wAuz9ApACAACKsCqv/3jP+t5wAjN7UFAAwAAJNqRigAAaln8a37ACgF0AGYZvGM/6BC89EBID6997UGAAgADQBV8Sj4U/HS
/ikABAAwAFTx0/spAAcAMABU8c77KQABkDAAVPHJ+wYAIABU8TH/VPFZ/wAoDtAgAFTxSv8AKBLRKABV8QP4+iPbAOEY//fB/wAo
DNEYIwIiACE5gAGZACAKgDOA/r0KIwkiByH15wYjBSIDIfHnAAAHsQGBsLAAhAAAAAAs/v9/qwixgFD+/3+oA7GAVP7/f6gDsYBY
/v9/qAOxgFz+/3/Q//9/YP7/f7CrDoAe//9/qQexgDz//3+rB7GAAAAAAAAAAAAAAAAARExYSA0AAAAUAAAAAAAAALADAABJTkZP
cAAAAHACAABQAAAAIAAAABQCAAD//////////zgAAABNRVRBAQAAAAQAAQAEAAAAAAAAAAAAAABTVFIwADM2AFBNQ01vZHVsZVBy
aW9yaXR5AAAAAAAAAFNZTTAAAAAAHQAIAP//AABEAgAAJQAAAAAAAABUUBUCAwQAAAAAAABoUBUCAwQAAAAAAADYagECAwQAAAAA
AAD8BBgCAwQAAAAAAAD0ZRoCAwQAAAAAAACEZRoCAwQAAAAAAADEURUCAwQAAAAAAACweBYCAwQAAAAAAAAAUBUCAwQAAAAAAADQ
LxgCAwQAAAAAAADYTxUCAwQAAAAAAAAgpRYCAwQAAAAAAAC8URUCAwQAAAAAAADUXhoCAwQAAAAAAABwZhoCAwQAAAAAAABAUBUC
AwQAAAAAAAB4cBYCAwQAAAAAAAAUZhoCAwQAAAAAAAAoSRUCAwQAAAAAAAAcPxUCAwQAAAAAAAAAAAAAAQAAAAAAAAAsAAAAAQAA
AAAAAAA4AAAAAQAAAAAAAABEAAAAAQAAAAAAAABQAAAAAQAAAAAAAADIAQAAAQAAAAAAAABcAAAAAQAAAAAAAAAiAQAAAQAAAAAA
AABIAQAAAQAAAAAALAAAAAAAAwEAAAAADAA4AAAAAwEAAAAAxgBcAAAAAwEAAAAADABEAAAAAwEAAAAAfgBIAQAAAwEAAAAAJgAi
AQAAAwEAAAAADABQAAAAAwEAAAAADAAsAAAAAwEAAD5Q4iLxSIsuuZEdMerKYoUwyC2eUsKk19VN8+e4hwb1AAAAAAAAAAAAAAAA
UkVMMAAAAACkAgAAoAIAAIgCAACcAgAAAgAAAG1dGgIAAx8AEWkaAgADIQABAAEAAAAAACEAAAAIAAAA/wEOABQAAAD/AQoAJAAA
AP8BCgBiAAAA/wEDAGgAAAD/AQIAdAAAAP8BDQCIAAAA/wEJAJAAAAD/AQUAngAAAP8BDQCmAAAA/wELAMIAAAD/AQEAzgAAAP8B
EQDcAAAA/wEEADIBAAD/AQcAPAEAAP8BEABQAQAA/wEGAFQBAAD/ARMAXgEAAP8BEgBoAQAA/wESAHIBAAD/ARIAegEAAP8BCAB+
AQAA/wEAAIgBAAD/AQ8AkgEAAP8BDADUAQAA/wcUANwBAAD/BxUA5AEAAP8HFgDsAQAA/wcXAPQBAAD/BxgA+AEAAP8HGQD8AQAA
/wcaAAQCAAD/BxsADAIAAP8HHAA=
"""


def read_u16(data: bytes, offset: int) -> int:
    if offset < 0 or offset + 2 > len(data):
        raise RuntimeError(f"u16 read outside file at 0x{offset:x}")
    return struct.unpack_from("<H", data, offset)[0]


def read_u32(data: bytes, offset: int) -> int:
    if offset < 0 or offset + 4 > len(data):
        raise RuntimeError(f"u32 read outside file at 0x{offset:x}")
    return struct.unpack_from("<I", data, offset)[0]


def section(data: bytes, exec_offset: int, owner: int, pointer_offset: int, magic: bytes) -> int:
    result = exec_offset + read_u32(data, owner + pointer_offset)
    if data[result : result + 4] != magic:
        raise RuntimeError(f"{magic.decode('ascii')} section not found")
    return result


def validate_rpm(data: bytes) -> None:
    digest = hashlib.sha256(data).hexdigest()
    if len(data) != PATCH_SIZE or digest != PATCH_SHA256:
        raise RuntimeError(
            f"{PATCH_NAME} payload mismatch: size={len(data)}, sha256={digest}"
        )
    if data[:4] != b"DLXF" or read_u32(data, 4) != PATCH_SIZE:
        raise RuntimeError("invalid DLXF wrapper or expanded module size")

    exec_offset = read_u32(data, 8)
    if data[exec_offset : exec_offset + 4] != b"DLXH":
        raise RuntimeError("DLXH header not found")
    info_offset = section(data, exec_offset, exec_offset, 8, b"INFO")
    strings_offset = section(data, exec_offset, info_offset, 12, b"STR0")
    rel_offset = section(data, exec_offset, info_offset, 8, b"REL0")

    modules_offset = exec_offset + read_u32(data, rel_offset + 0x14)
    module_count = read_u16(data, modules_offset)
    modules: list[str] = []
    for index in range(module_count):
        name_offset = read_u16(data, modules_offset + 2 + index * 2)
        start = strings_offset + 4 + name_offset
        end = data.find(b"\0", start)
        if end < 0:
            raise RuntimeError("unterminated external module name")
        modules.append(data[start:end].decode("ascii"))
    if modules != [str(OVERLAY_ID)]:
        raise RuntimeError(f"unexpected RPM overlay dependencies: {modules!r}")


def validate_overlay(overlay_path: Path, table_path: Path) -> None:
    table = table_path.read_bytes()
    entry_offset = OVERLAY_ID * 32
    if entry_offset + 32 > len(table):
        raise RuntimeError(f"overlay {OVERLAY_ID} is absent from the overlay table")
    table_id, ram_address = struct.unpack_from("<II", table, entry_offset)
    if table_id != OVERLAY_ID or ram_address != OVERLAY_RAM_ADDRESS:
        raise RuntimeError(
            f"overlay {OVERLAY_ID} table mismatch: id={table_id}, ram=0x{ram_address:08x}"
        )

    overlay = bytes(ndspy.codeCompression.decompress(overlay_path.read_bytes()))
    for address, expected in HOOK_WINDOWS.items():
        offset = address - ram_address
        actual = overlay[offset : offset + len(expected)]
        if actual != expected:
            raise RuntimeError(
                f"overlay {OVERLAY_ID} conflicts at 0x{address:08x}: "
                f"expected {expected.hex()}, found {actual.hex()}"
            )


def write_if_changed(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.read_bytes() != data:
        path.write_bytes(data)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--stamp", required=True, type=Path)
    parser.add_argument("--base-overlay", required=True, type=Path)
    parser.add_argument("--overlay-table", required=True, type=Path)
    args = parser.parse_args()

    patch = base64.b64decode(PATCH_BASE64)
    validate_rpm(patch)
    validate_overlay(args.base_overlay, args.overlay_table)
    write_if_changed(args.output, patch)
    args.stamp.parent.mkdir(parents=True, exist_ok=True)
    args.stamp.write_text(PATCH_SHA256 + "\n", encoding="ascii")
    print(f"[+] staged {PATCH_NAME} ({len(patch)} bytes, overlay {OVERLAY_ID})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
