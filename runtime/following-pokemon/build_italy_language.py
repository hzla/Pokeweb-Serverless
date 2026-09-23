"""Build the provisional IRDI follower UI message record without truncation."""
import argparse
import hashlib
import json
import struct
import zlib
from pathlib import Path
import ndspy.narc
import ndspy.rom

HERE = Path(__file__).resolve().parent
APP = HERE.parents[1]


ITALIAN_WHITE2_SHA256 = "04c7ae9f697b09f0558c9a508fc8960531c6429e5341bd699955f5ff925d600a"


def retail_text(path: Path, source: dict) -> str:
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != ITALIAN_WHITE2_SHA256 or raw[12:16] != b"IRDI":
        raise ValueError("Italian White 2 text source does not match the pinned clean ROM")
    rom = ndspy.rom.NintendoDSRom(raw)
    bank = ndspy.narc.NARC(rom.getFileByName(source["sourceArchive"])).files[source["sourceBank"]]
    blocks, entries = struct.unpack_from("<HH", bank)
    if blocks != 1 or source["sourceEntry"] >= entries:
        raise ValueError("Unexpected Italian White 2 text-bank layout")
    block = struct.unpack_from("<I", bank, 12)[0]
    offset, count = struct.unpack_from("<IH", bank, block + 4 + source["sourceEntry"]*8)
    encoded = list(struct.unpack_from("<" + "H"*count, bank, block + offset))
    key = encoded[-1] ^ 0xffff
    words = []
    for word in reversed(encoded):
        words.append(word ^ key)
        key = ((key >> 3) | (key << 13)) & 0xffff
    words.reverse()
    if not words or words[-1] != 0xffff or any(word < 0x20 or word >= 0xf000 for word in words[:-1]):
        raise ValueError("Italian White 2 Bag-full text has unsupported controls")
    return "".join(chr(word) for word in words[:-1])


def build(language: str = "en", rom: Path | None = None):
    source = json.loads((HERE / f"italy-language-{language}.json").read_text())
    message = source["bagFull"]
    if source["abi"] != 1 or source["language"] != language or source["provisional"] != (language == "en"):
        raise ValueError("Unexpected language metadata")
    if language == "it":
        if rom is None or retail_text(rom, source) != message:
            raise ValueError("Localized Bag-full text differs from the pinned retail entry")
    if not message or any(ord(ch) < 0x20 or ord(ch) >= 0xf000 for ch in message):
        raise ValueError("Follower language text contains an unsupported glyph")
    payload = message.encode("utf-16le") + struct.pack("<H", 0xffff)
    if len(payload) > 384:
        raise ValueError("Follower UI text exceeds the runtime text buffer")
    output = struct.pack("<IHHII", 0x474c5746, 1, 1, 16 + len(payload), zlib.crc32(payload)) + payload
    path = APP / "src/assets/following/white2italy/language.bin"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(output)
    print(f"Wrote {path}: {len(output)} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=("en", "it"), default="en")
    parser.add_argument("--rom", type=Path)
    args = parser.parse_args()
    build(args.language, args.rom)
