#!/usr/bin/env python3
"""Build the empty, versioned PWTH registry installed beside the weather DLL."""

import struct
import sys
from pathlib import Path


MAGIC = b"PWTH"
FORMAT_VERSION = 4
HEADER_SIZE = 16
ENTRY_SIZE = 72
FIRST_CUSTOM_ID = 15
ENTRY_COUNT = 49
UNUSED_RESOURCE = 0xFFFF
DEFAULT_FOG_TABLE = bytes((
    0, 4, 8, 12, 16, 20, 24, 28,
    33, 37, 41, 45, 49, 53, 57, 61,
    66, 70, 74, 78, 82, 86, 90, 94,
    99, 103, 107, 111, 115, 119, 123, 127,
))


def empty_entry() -> bytes:
    entry = bytearray(ENTRY_SIZE)
    struct.pack_into("<HHHHHH", entry, 4, UNUSED_RESOURCE, UNUSED_RESOURCE,
                     UNUSED_RESOURCE, UNUSED_RESOURCE, UNUSED_RESOURCE,
                     UNUSED_RESOURCE)
    struct.pack_into("<HHH", entry, 16, 0x0100, 0x0100, 32575)
    entry[22:26] = bytes((27, 28, 28, 9))
    struct.pack_into("<hHH", entry, 26, 0x0100, 90, 50)
    entry[36:68] = DEFAULT_FOG_TABLE
    struct.pack_into("<HBB", entry, 68, UNUSED_RESOURCE, 0, 0)
    return bytes(entry)


def build_registry() -> bytes:
    header = struct.pack("<4sHHBBHI", MAGIC, FORMAT_VERSION, ENTRY_SIZE,
                         FIRST_CUSTOM_ID, ENTRY_COUNT, HEADER_SIZE, 0)
    return header + empty_entry() * ENTRY_COUNT


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: build_weather_registry.py <output>", file=sys.stderr)
        return 2
    output = Path(sys.argv[1])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(build_registry())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
