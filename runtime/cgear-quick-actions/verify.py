"""Execute compiled ARM code and retail resource parsers with isolated stubs.

This is a CPU/ownership harness, not evidence of DS graphics or travel behavior.
"""

import json, struct, subprocess, re
from functools import lru_cache
from pathlib import Path
import ndspy.rom, ndspy.codeCompression, ndspy.narc
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import *
from build import HERE, WS, BUILD, TOOLS, APIS, NATIVE, CALLS

REGS = [UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3]
SAVED = [
    UC_ARM_REG_R4,
    UC_ARM_REG_R5,
    UC_ARM_REG_R6,
    UC_ARM_REG_R7,
    UC_ARM_REG_R8,
    UC_ARM_REG_R9,
    UC_ARM_REG_R10,
    UC_ARM_REG_R11,
]
STOP = 0x023F8000
STACK = 0x023F0000
SUB = 0x02280000
FIELD = SUB + 0x100
SYSTEM = SUB + 0x200
GAME = SUB + 0x300
CONFIG = SUB + 0x400
CGEAR = SUB + 0x500
PARTY = SUB + 0x600
WORK = SUB + 0x1000
CLSYS = SUB + 0x2000


@lru_cache(maxsize=2)
def retailImages(game):
    rom = ndspy.rom.NintendoDSRom.fromFile(
        WS / ("cleanblack2.nds" if game == "B2" else "cleanwhite2.nds")
    )
    return (
        rom.arm9RamAddress,
        bytes(ndspy.codeCompression.decompress(rom.arm9)),
        tuple(
            (o.ramAddress, bytes(o.data))
            for o in rom.loadArm9Overlays(NATIVE.keys()).values()
        ),
        bytes(ndspy.narc.NARC(rom.files[rom.filenames.idOf("a/0/5/6")]).files[1244]),
        bytes(ndspy.narc.NARC(rom.files[rom.filenames.idOf("a/0/5/6")]).files[1247]),
    )


class Harness:
    def __init__(self, game):
        self.game = game
        self.delta = 64 if game == "B2" else 0
        self.armdelta = 44 if game == "B2" else 0
        self.uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
        self.uc.ctl_set_cpu_model(UC_CPU_ARM_946)
        self.uc.mem_map(0x02000000, 0x400000)
        self.uc.mem_map(0x05000000, 0x1000)
        self.uc.mem_map(0x06200000, 0x10000)
        armAddress, armBytes, overlays, pcScript, shopScript = retailImages(game)
        self.uc.mem_write(armAddress, armBytes)
        for address, data in overlays:
            self.uc.mem_write(address, data)
        elf = BUILD / f"{game}-harness.elf"
        bgm = HERE.parent / "bgm-toggle"
        definitions = [
            f"-Wl,--defsym={name}={address}"
            for name, address in re.findall(
                r"Name: (\S+)\s+Segment: 0\s+Address: (0x\w+)",
                (bgm / f"symbols_{game.lower()}.yml").read_text(),
            )
        ]
        subprocess.run(
            [
                str(TOOLS / "arm-none-eabi-g++"),
                "-nostdlib",
                "-Wl,-Ttext=0x02300020,-Tbss=0x02320000,-eQaCGearInit",
                str(BUILD / f"CGearQuickActions{game}.o"),
                str(BUILD / f"runtime{game}.o"),
                str(BUILD / f"memory{game}.o"),
                str(bgm / "build/BgmToggle.elf"),
                *definitions,
                "-o",
                str(elf),
            ],
            check=True,
        )
        with elf.open("rb") as f:
            e = ELFFile(f)
            for p in e.iter_segments():
                if p["p_type"] == "PT_LOAD":
                    self.uc.mem_write(
                        p["p_vaddr"], p.data() + bytes(p["p_memsz"] - p["p_filesz"])
                    )
            self.symbols = {
                s.name: s["st_value"]
                for s in e.get_section_by_name(".symtab").iter_symbols()
            }
        # Execute the retail generator through the same two call-site adapters as
        # the shipped DLL, rather than replacing the generator with a test stub.
        for label, module, address, target, prep in CALLS:
            if not label.startswith("QaPhenomenon"):
                continue
            site = address - self.delta
            offset = (self.symbols[label] & ~1) - site - 4
            self.uc.mem_write(
                site,
                struct.pack(
                    "<HH",
                    0xF000 | ((offset >> 12) & 2047),
                    0xF800 | ((offset >> 1) & 2047),
                ),
            )
        self.functions = {}
        self.calls = []
        self.heap = 0x02200000
        self.allocations = {}
        self.fail = 0
        self.attempts = 0
        self.touch = None
        self.trigger = False
        self.event = 0
        self.busy = False
        self.allowed = True
        self.bikeOwned = True
        self.mapOwned = True
        self.flyAllowed = True
        self.eggs = set()
        self.moves = {0: [19]}
        self.sounds = []
        self.chars = set()
        self.charSizes = {}
        self.actorSet = set()
        self.inVblank = False
        self.uploads = []
        self.vblank = 0
        self.write(
            SUB, struct.pack("<IIIHHIIIIII", 0, 0, 0, 45, 0, 0, FIELD, 0, 0, WORK, 0)
        )
        self.put(FIELD + 4, SYSTEM)
        self.put(FIELD + 8, GAME)
        self.put(GAME, CONFIG)
        self.put(GAME + 0x10, PARTY)
        self.put(WORK, self.ov(0x21EC9CC) | 1)
        self.put(WORK + 0x10, SYSTEM)
        self.put(WORK + 0x14, GAME)
        self.flagWork = SUB + 0x8000
        self.put(GAME + 0x1AC, self.flagWork)
        self.put(SYSTEM + 0x1C, GAME)
        self.put(SYSTEM + 0x20, FIELD)
        self.children = []
        self.maps = []
        self.record = []
        self.put(PARTY + 4, 1)
        self.write(CGEAR, bytes(52))
        self.write(CONFIG, b"\x01\x0a\0\0")
        self.put(self.arm(0x214197C), CLSYS)
        self.put(CLSYS + 0x10C, CLSYS + 0x400)
        self.put(CLSYS + 0x114, CLSYS + 0x1400)
        self.put(CLSYS + 0x110, CLSYS + 0x1600)
        for i in range(16):
            self.put(CLSYS + 0x400 + i * 64 + 60, 0x80000000)
        for i in range(8):
            self.put(CLSYS + 0x1400 + i * 20 + 16, 1)
        for i in range(8):
            self.put(CLSYS + 0x1600 + i * 24 + 20, 0x80000000)
        self.write(CLSYS + 0x118, struct.pack("<HHH", 16, 8, 8))
        self.put(WORK + 0x34, CLSYS + 0x2000)
        self.put(CLSYS + 0x2000, CLSYS + 0x2400)
        self.write(CLSYS + 0x200C, struct.pack("<H", 92))
        self.arc = ndspy.narc.NARC(
            (
                HERE.parents[1] / "src/assets/codeinjection/cgearQuickActions.narc"
            ).read_bytes()
        )
        # Retain the original four-button regression fixture separately from the new preset.
        header = bytearray(self.arc.files[0])
        struct.pack_into("<H", header, 4, 6)
        header[20] = 4
        header[45] = 0
        header[58:60] = bytes([196, 116])
        header[96:160] = bytes(64)
        self.arc.files[0] = header
        self.rehash()

        def add(a, f):
            self.functions[self.arm(a) if a < 0x2150000 else self.ov(a)] = f

        add(0x2007448, lambda a: CONFIG if a[1] == 27 else CGEAR - 40)
        add(0x201735C, lambda a: PARTY)
        add(0x2017354, lambda a: GAME)
        add(0x20171F4, lambda a: GAME)
        add(0x20175A4, lambda a: self.riding if hasattr(self, "riding") else 0)
        add(
            0x2008474,
            lambda a: int(
                self.bikeOwned
                if a[1] == 450
                else self.mapOwned if a[1] == 442 else a[1] in self.ownedItems
            ),
        )
        add(0x201FF34, lambda a: PARTY + 0x20 + a[1] * 0x100)
        add(
            0x201CD24,
            lambda a: (
                int((a[0] - PARTY - 0x20) // 0x100 in self.eggs)
                if a[1] == 0x4C
                else (
                    self.moves.get((a[0] - PARTY - 0x20) // 0x100, [0] * 4)[a[1] - 0x36]
                    if 0x36 <= a[1] < 0x3A
                    and a[1] - 0x36
                    < len(self.moves.get((a[0] - PARTY - 0x20) // 0x100, []))
                    else 0
                )
            ),
        )
        add(
            0x2159270,
            lambda a: self.write(
                a[1], struct.pack("<HHIIII", 20, 16, 0, SYSTEM, 0, FIELD)
            ),
        )
        add(0x21596C4, lambda a: 0 if self.flyAllowed else 1)
        add(0x215EFF4, lambda a: int(a[0] in self.useBlocked))
        add(0x218130C, lambda a: int(self.busy))
        add(0x21983EC, lambda a: 13 if self.allowed else 5)
        add(
            0x21ED2E0,
            lambda a: int(bool(self.byte(WORK + 0x30E) or self.byte(WORK + 0x30F))),
        )
        add(0x2198564, lambda a: 0)
        add(0x219863C, lambda a: 0)
        add(0x219865C, lambda a: 0)
        add(0x21986C0, lambda a: 0)
        add(0x21986B4, lambda a: self.event)
        add(0x21EB894, lambda a: 0)
        add(0x21EB748, lambda a: self.nativeTouch if self.byte(WORK + 0x30B) else -1)
        self.useBlocked = set()
        self.ownedItems = set()
        self.keys = 0
        add(0x203DF4C, lambda a: self.keys)
        add(0x203DAB0, self.point)
        add(0x203DA74, lambda a: int(self.trigger))
        self.heapFree = 65536
        self.heapLargest = 65536
        add(0x2039F8C, lambda a: self.heapFree)
        add(0x2039FBC, lambda a: self.heapLargest)
        add(0x203A228, lambda a: self.allocate(a[1]))
        add(0x203A278, lambda a: self.free(a[0]))
        add(0x2070CA8, lambda a: 0)
        add(0x2070ECC, lambda a: 1)
        add(0x204AAC8, lambda a: 0)
        add(0x204AB38, lambda a: self.free(a[0]))
        add(0x204AC38, lambda a: len(self.arc.files[a[1]]))
        add(0x204AB48, self.read)
        add(0x204BBCC, lambda a: 2)
        add(0x204BE0C, lambda a: 3)
        add(0x204BE90, lambda a: 0)
        add(0x204BCFC, lambda a: 0)
        add(0x204BF48, lambda a: CLSYS + 0x2000)
        add(0x204C134, self.actorDelete)
        add(0x204B8E8, self.char)
        add(0x204B9B8, self.charDelete)
        add(0x204C06C, self.actor)
        self.spriteCapacity = (
            4480  # Verified retail repack with feedback leaves this many Sub OBJ bytes.
        )
        self.actorVisibility = {}
        self.actorPositions = {}
        add(0x204C01C, lambda a: 0)
        add(0x204C044, lambda a: 0)
        add(0x204C54C, lambda a: 0)
        add(0x204C150, lambda a: self.actorVisibility.update({a[0]: bool(a[1])}))
        add(
            0x204C16C,
            lambda a: self.actorPositions.update(
                {a[0]: struct.unpack("<hh", self.uc.mem_read(a[1], 4))}
            ),
        )
        self.musicSequences = []
        add(0x204C4E4, lambda a: self.musicSequences.append(a[:2]))
        self.selectorFrames = []
        self.put(WORK + 0x80, SUB + 0xA0A0)
        add(0x204C530, lambda a: self.selectorFrames.append(a[:2]))
        add(0x21EC808, self.workEnd)
        add(0x20056FC, self.task)
        add(0x203A6D4, lambda a: self.free(a[0]))
        add(0x204BA6C, self.upload)
        add(0x204BD3C, self.paletteUpload)
        self.skinUploads = []
        self.skinPalettes = []
        add(0x20450AC, self.skinCharUpload)
        add(
            0x204534C,
            lambda a: self.skinPalettes.append(bytes(self.uc.mem_read(a[1], a[2]))),
        )
        add(0x2045080, lambda a: self.write(0x06207800, self.uc.mem_read(a[1], a[2])))
        add(0x2045698, lambda a: 0)
        add(0x2044FBC, lambda a: 0)
        self.networkPositions = []
        add(0x2042F58, lambda a: self.networkPositions.append(a[:2]))
        self.nativeTouch = 7
        self.saveDone = False
        self.saveResult = 2
        self.saveSteps = []
        self.subReady = True
        self.bgmVolumes = []
        add(0x2005F94, lambda a: self.bgmVolumes.append(a[:2]))
        add(0x2005C18, lambda a: 0)
        add(0x21804D0, lambda a: FIELD + 0x400)
        add(0x21984AC, self.subChange)
        add(0x21983DC, lambda a: int(self.subReady))
        add(0x2163B78, self.saveMain)
        self.fadeObjBytes = None
        add(0x2026E90, self.fadePaletteSet)
        add(0x21EB730, lambda a: 0)
        self.pcScript = pcScript
        self.shopScript = shopScript
        self.pcOwned = {}
        self.fileArcs = {}
        self.functions[self.arm(0x2070ECC)] = self.fileOpen
        self.functions[self.arm(0x204AC38)] = lambda a: len(self.fileArcs.get(a[0], self.arc).files[a[1]])
        self.functions[self.arm(0x204AB38)] = self.archiveClose
        add(0x2048828, lambda a: self.allocate(28))
        add(0x2048800, lambda a: self.free(a[0]))
        add(0x21551C4, lambda a: self.shopProcess)

        add(0x2006254, lambda a: self.sounds.append(a[0]))
        add(0x21536AC, self.scriptCreate)
        add(0x215F024, lambda a: 0x022F2000)
        add(0x2016CB4, self.eventCreate)
        add(0x215B4C8, self.mapCreate)
        add(0x2016D68, lambda a: self.children.append((a[0], a[1])))
        add(0x2180500, lambda a: 45)
        add(0x2159460, self.flyCreate)
        add(0x2017994, lambda a: GAME + 0x800)
        add(0x20095A0, lambda a: self.record.append(a[1]))
        self.encounter = SUB + 0x9000
        self.encounterState = SUB + 0x9100
        self.encounterData = SUB + 0x9200
        self.effect = SUB + 0x9300
        self.write(
            self.encounter,
            struct.pack("<IIIII", FIELD, SYSTEM, GAME, self.encounterData, self.effect),
        )
        self.write(self.effect + 0x5B8, struct.pack("<HH", 50, 10))
        self.radarAllowed = True
        self.radarBadge = True
        self.radarGrid = True
        self.radarTiles = True
        self.radarSelections = 0
        self.radarAttempts = 0
        self.radarFlags = []
        add(0x2180564, lambda a: self.encounter)
        add(0x2180578, lambda a: 0 if self.radarGrid else 1)
        add(0x20174A4, lambda a: self.encounterState)
        add(0x2017974, lambda a: GAME)
        add(0x200C97C, lambda a: int(self.radarBadge))
        add(0x21A16E8, lambda a: int(self.radarAllowed))
        add(0x201739C, lambda a: GAME)
        add(0x2180518, lambda a: 45)
        add(0x2180530, lambda a: FIELD)
        add(0x219A6E0, lambda a: FIELD)
        add(0x2167338, lambda a: self.write(a[1], bytes(12)))
        add(0x2154B84, lambda a: 1)
        add(0x2154B30, lambda a: 45)
        add(0x201385C, lambda a: a[0])
        add(0x2013878, lambda a: a[0])
        add(0x2005784, lambda a: 999)

        def radarSearch(a):
            assert a[:2] == [self.encounter, self.effect]
            self.radarAttempts += 1
            self.radarFlags.append(a[2])
            self.write(self.effect + 4, struct.pack("<H", int(self.radarTiles)))

        def radarSetup(a):
            assert a[:2] == [self.encounter, self.effect]
            if self.radarSelections:
                self.radarSelections -= 1
            else:
                self.write(
                    self.encounterState + 0x25,
                    bytes([self.byte(self.encounterState + 0x25) | 1]),
                )

        add(0x21A25C4, radarSearch)
        add(0x21A272C, radarSetup)
        self.uc.hook_add(UC_HOOK_CODE, self.intercept)

    def arm(self, a):
        return (
            (0x214193C if self.game == "B2" else a)
            if a == 0x214197C
            else a - (self.armdelta if a >= 0x20191D8 else 0)
        )

    def ov(self, a):
        return a - self.delta

    def write(self, a, b):
        self.uc.mem_write(a, bytes(b))
        return 0

    def put(self, a, v):
        self.write(a, struct.pack("<I", v & 0xFFFFFFFF))

    def word(self, a):
        return struct.unpack("<I", self.uc.mem_read(a, 4))[0]

    def byte(self, a):
        return self.uc.mem_read(a, 1)[0]

    def allocate(self, n):
        self.attempts += 1
        if self.fail == self.attempts:
            return 0
        if not self.allocations:
            self.heap = 0x02200000
        p = self.heap
        self.heap += (n + 7) & ~7
        self.allocations[p] = n
        self.write(p, bytes(n))
        return p

    def free(self, p):
        assert p in self.allocations, ("invalid/double free", hex(p))
        del self.allocations[p]
        return 0

    def point(self, a):
        if self.touch:
            self.put(a[0], self.touch[0])
            self.put(a[1], self.touch[1])
            return 1
        return 0

    def fileOpen(self, a):
        name = bytes(self.uc.mem_read(a[1], 128)).split(b"\0")[0]
        if name == b"rom:/system-shops/shops.narc":
            self.fileArcs[a[0]] = self.shopArc
        return 1

    def archiveClose(self, a):
        self.fileArcs.pop(a[0], None)
        return self.free(a[0])

    def read(self, a):
        b = self.fileArcs.get(a[0], self.arc).files[a[1]]
        p = self.allocate(len(b))
        if p:
            self.write(p, b)
        return p

    def char(self, a):
        i = next(i for i in range(16) if i not in self.chars)
        self.chars.add(i)
        used = sum(self.charSizes.values())
        self.charSizes[i] = a[0]
        self.put(CLSYS + 0x400 + i * 64 + 60, a[0])
        self.write(
            CLSYS + 0x400 + i * 64 + 52,
            struct.pack(
                "<II",
                0xFFFFFFFF,
                used if used + a[0] <= self.spriteCapacity else 0xFFFFFFFF,
            ),
        )
        return i

    def charDelete(self, a):
        assert a[0] in self.chars
        self.chars.remove(a[0])
        del self.charSizes[a[0]]
        self.put(CLSYS + 0x400 + a[0] * 64 + 60, 0x80000000)
        return 0

    def actor(self, a):
        p = self.allocate(32)
        self.actorSet.add(p) if p else None
        return p

    def actorDelete(self, a):
        self.actorSet.remove(a[0])
        return self.free(a[0])

    def unitDelete(self, a):
        for p in self.actorSet:
            self.free(p)
        self.actorSet.clear()
        return self.free(a[0])

    def workEnd(self, a):
        assert (
            not self.actorSet and not self.chars and not self.allocations
        ), "Owned resources survived inner C-Gear teardown"
        self.put(WORK, 0)
        self.put(WORK + 0x34, 0)
        return 0

    def task(self, a):
        self.vblank = a[0]
        return self.allocate(16)

    def upload(self, a):
        assert self.inVblank, "Upload outside VBlank"
        source = self.word(a[1] + 20)
        size = self.word(a[1] + 16)
        assert (
            size == self.charSizes[a[0]]
            and size in (128, 512)
            and any(
                p <= source and source + size <= p + n
                for p, n in self.allocations.items()
            )
        ), "DMA source is not retained main-RAM allocation"
        self.uploads.append((a[0], bytes(self.uc.mem_read(source, size))))
        return 0

    def skinCharUpload(self, a):
        assert self.inVblank and a[0] == 5 and a[2] == 0x1FE0 and a[3] == 0
        assert any(
            p <= a[1] and a[1] + 0x2600 <= p + n for p, n in self.allocations.items()
        ), "Skin source is not retained main RAM"
        self.skinUploads.append(bytes(self.uc.mem_read(a[1], 0x2600)))
        self.write(0x06204000, self.uc.mem_read(a[1], a[2]))
        return 0

    def paletteUpload(self, a):
        assert (
            self.inVblank and self.word(a[1] + 8) == 256 and a[2] == 8
        ), "Palette refresh must transfer all eight banks"
        self.paletteBytes = bytes(self.uc.mem_read(self.word(a[1] + 12), 256))
        return 0

    def fadePaletteSet(self, a):
        size = self.word(self.uc.reg_read(UC_ARM_REG_SP))
        assert self.inVblank, "Fade palette changed outside scheduled upload"
        if a[2] == 3:
            assert (
                a[3] == 112 and size == 224
            ), "OBJ fade update overruns the native 14-bank buffer"
            assert (
                a[1] == self.session() + 468
            ), "OBJ fade source is not retained session memory"
            self.fadeObjBytes = bytes(self.uc.mem_read(a[1], size))
        else:
            assert (
                a[2] == 1 and a[3] == 208 and size == 32
            ), "Unexpected native fade palette ownership"
        return 0

    def eventCreate(self, a):
        e = self.allocate(20)
        if not e:
            return 0
        data = self.allocate(a[3])
        if not data:
            self.free(e)
            return 0
        self.put(e + 4, a[2])
        self.put(e + 12, data)
        self.put(e + 16, a[0])
        return e

    def mapCreate(self, a):
        assert self.word(a[0]) == SYSTEM and self.word(a[0] + 16) in (
            0,
            2,
            8,
            9,
            12,
            13,
            14,
        )
        assert any(
            p <= a[0] < p + n for p, n in self.allocations.items()
        ), "Map request is not owned"
        child = self.eventCreate([SYSTEM, 0, 0, 124])
        if child:
            self.put(self.word(child + 12) + 24, a[0])
            self.maps.append((a[0], child))
        return child

    def scriptCreate(self, a):
        assert a in ([SYSTEM, 10090, 0, 45], [SYSTEM, 10110, 0, 45]), a
        source = self.shopScript if a[1] == 10110 else self.pcScript
        e = self.eventCreate([SYSTEM, 0, 0, 8])
        if not e:
            return 0
        owned = []
        for n in [28, 60, len(source)]:
            p = self.allocate(n)
            if not p:
                for p in owned:
                    self.free(p)
                self.eventDelete(e)
                return 0
            owned.append(p)
        scripts, vm, code = owned
        self.write(code, source)
        self.put(self.word(e + 12) + 4, scripts)
        self.put(scripts + 4, vm)
        self.put(vm + 32, code + (24 if a[1] == 10110 else 30))
        self.put(vm + 56, code)
        process = self.allocate(64)
        if not process:
            for p in owned: self.free(p)
            self.eventDelete(e)
            return 0
        owned.append(process)
        self.put(self.word(e + 12), process)
        self.shopProcess = process
        self.pcOwned[e] = owned
        return e

    def flyCreate(self, a):
        assert a[0] == 4 and self.word(a[1] + 4) == self.destination
        assert self.word(a[1]) >> 16 == 4 and self.word(a[1]) & 0xFFFF == self.member
        return self.eventCreate([SYSTEM, 0, 0, 24])

    def subChange(self, a):
        self.put(a[0] + 4, a[1])
        self.put(a[0] + 8, 1)
        return 0

    def saveMain(self, a):
        seq = self.word(a[1])
        self.saveSteps.append(seq)
        assert (
            self.word(a[0]) == CONFIG
            and self.word(a[0] + 4) == SYSTEM
            and self.word(a[0] + 8) == FIELD
        )
        assert self.word(a[0] + 12) == FIELD + 0x400 and self.byte(a[0] + 16) == 45
        if seq == 17:
            self.subChange([SUB, 2])
            self.put(a[1], 18)
        return self.saveResult

    def eventDelete(self, e):
        owned = self.pcOwned.pop(e, [])
        if owned: owned[2] = self.word(owned[1] + 56)
        for p in owned:
            self.free(p)
        self.free(self.word(e + 12))
        self.free(e)

    def intercept(self, u, a, size, _):
        if a == STOP:
            u.emu_stop()
            return
        if a not in self.functions:
            return
        assert u.reg_read(UC_ARM_REG_SP) % 8 == 0, ("stack misalignment", hex(a))
        args = [u.reg_read(r) for r in REGS]
        self.calls.append((a, args))
        v = self.functions[a](args)
        for r in REGS:
            u.reg_write(r, 0xDEADBEEF)
        u.reg_write(UC_ARM_REG_R0, (v or 0) & 0xFFFFFFFF)
        u.reg_write(UC_ARM_REG_PC, u.reg_read(UC_ARM_REG_LR))

    def call(self, name, *args):
        address = self.symbols[name] if isinstance(name, str) else name
        values = [0x11110000 + i for i in range(8)]
        for r, v in zip(SAVED, values):
            self.uc.reg_write(r, v)
        for r, v in zip(REGS, args):
            self.uc.reg_write(r, v)
        self.uc.reg_write(UC_ARM_REG_SP, STACK)
        self.uc.reg_write(UC_ARM_REG_LR, STOP | 1)
        self.uc.emu_start(address | 1, STOP, count=getattr(self, "instructionLimit", 200000))
        assert self.uc.reg_read(UC_ARM_REG_PC) == STOP, (
            "Did not return",
            name,
            hex(self.uc.reg_read(UC_ARM_REG_PC)),
        )
        assert (
            self.uc.reg_read(UC_ARM_REG_SP) == STACK
            and [self.uc.reg_read(r) for r in SAVED] == values
        )
        return self.uc.reg_read(UC_ARM_REG_R0)

    def rehash(self):
        h = bytearray(self.arc.files[0])
        v = 0x811C9DC5
        for b in h[:28] + h[32:]:
            v = ((v ^ b) * 0x1000193) & 0xFFFFFFFF
        struct.pack_into("<I", h, 28, v)
        self.arc.files[0] = h

    def configure(self, buttons):
        h = bytearray(self.arc.files[0])
        h[20] = len(buttons)
        h[32:160] = bytes(128)
        for i, b in enumerate(buttons):
            id, action, item, alternate, check, x, y, mode, flag = b
            struct.pack_into(
                "<HBBHHHBBB3x",
                h,
                32 + i * 16,
                id,
                action,
                mode,
                item,
                alternate,
                flag,
                x,
                y,
                check,
            )
        self.arc.files[0] = bytes(h)
        self.rehash()

    def session(self):
        return self.symbols["_ZN12_GLOBAL__N_17sessionE"]

    def press(self, x, y):
        self.touch = (x, y)
        self.trigger = True
        self.call("QaInput", WORK)
        self.trigger = False

    def release(self):
        self.touch = None
        self.call("QaInput", WORK)


for game in ("W2", "B2"):
    h = Harness(game)
    # The retail Nitro parsers unpack our complete one-cell resources.
    for file, parser in [(2, 0x206017C), (3, 0x2060078)]:
        p = 0x022E0000
        h.write(p, h.arc.files[file])
        assert h.call(h.arm(parser), p, p + 0x500) == 1
    h.call("QaCGearInit", SUB)
    h.call("QaCGearUpdate", SUB, 1)
    assert len(h.chars) == 4 and len(h.actorSet) == 4
    h.call("QaGearUnit", 84, 0, 45)
    assert h.calls[-1][1][:3] == [88, 0, 45]
    h.inVblank = True
    h.call(h.vblank)
    h.inVblank = False
    assert len(h.uploads) == 4
    # Item gates hide the actors and release their touch regions. Retail flag
    # setters/getters execute on the real saved flag layout in both profiles.
    actors = [h.word(h.session() + 12 + i * 4) for i in range(4)]
    for flag in (1517, 1509):
        header = bytearray(h.arc.files[0])
        struct.pack_into("<H", header, 56, flag)
        h.arc.files[0] = bytes(header)
        h.rehash()
        h.call("QaCGearExit", SUB)
        h.call("QaCGearInit", SUB)
        h.call("QaCGearUpdate", SUB, 1)
        actors = [h.word(h.session() + 12 + i * 4) for i in range(4)]
        h.call(h.arm(0x2019204), h.flagWork, flag)
        h.bikeOwned = False
        h.mapOwned = False
        h.call("QaCGearUpdate", SUB, 1)
        h.inVblank = True
        h.call(h.vblank)
        h.inVblank = False
        assert [h.actorVisibility[a] for a in actors] == [True, False, False, False]
        for x, y in [(196, 116), (88, 152), (172, 152)]:
            before = len(h.calls)
            h.press(x, y)
            assert h.call("QaCGearEvent", SUB, 1) == 0
            h.release()
            assert any(
                a == h.ov(0x21EB894) for a, _ in h.calls[before:]
            ), "Hidden button owned a touch"
        h.call(h.arm(0x2019204), h.flagWork, flag - 1)
        h.call(h.arm(0x201922C), h.flagWork, flag)
        assert (
            h.call(h.arm(0x20191D8), h.flagWork, flag - 1) == 1
        ), "Adjacent saved flag changed"
        h.bikeOwned = True
        h.mapOwned = True
        h.call("QaCGearUpdate", SUB, 1)
        h.inVblank = True
        h.call(h.vblank)
        h.inVblank = False
        assert [h.actorVisibility[a] for a in actors] == [True] * 4
    # Fresh appearance expectations start with the first native pattern again.
    h.uploads.clear()
    h.inVblank = True
    for i in range(4):
        h.write(h.session() + 144 + i, b"\xff")
    h.call(h.vblank)
    h.inVblank = False
    # Decode every native pattern for each gender through the actual compositor.
    for sex in range(2):
        for design in range(5):
            h.write(WORK + 0x30A, bytes([sex]))
            h.write(WORK + 0x300, bytes([design]))
            h.call("QaCGearUpdate", SUB, 1)
            h.inVblank = True
            h.call(h.vblank)
            h.inVblank = False
            for i in range(4):
                art = h.arc.files[4 + i][:512]
                pattern = h.arc.files[12][
                    (sex * 5 + design) * 512 : (sex * 5 + design + 1) * 512
                ]
                expected = bytes(
                    ((p & 15 if p & 15 == 13 else 9) if a & 15 == 9 else a & 15)
                    | (
                        ((p >> 4 if p >> 4 == 13 else 9) if a >> 4 == 9 else a >> 4)
                        << 4
                    )
                    for a, p in zip(art, pattern)
                )
                assert (
                    next(
                        data
                        for char, data in reversed(h.uploads)
                        if char == h.word(h.session() + 80 + i * 4)
                    )
                    == expected
                )
    h.press(60, 116)
    assert h.call("QaCGearEvent", SUB, 1) == 0
    assert h.word(CONFIG) & 0x1000 and h.sounds == [1996]
    for _ in range(5):
        h.call("QaInput", WORK)
        h.call("QaCGearEvent", SUB, 1)
    assert h.sounds == [1996] and h.word(CONFIG) & 0x1000
    h.release()
    h.press(60, 116)
    h.call("QaCGearEvent", SUB, 1)
    h.release()
    assert not h.word(CONFIG) & 0x1000 and h.sounds == [1996]
    h.press(196, 116)
    h.event = 0x022F3000
    assert h.call("QaCGearEvent", SUB, 1) == h.event
    h.event = 0
    h.release()
    assert h.call("QaCGearEvent", SUB, 1) == 0, "Blocked PC touch queued later"
    h.press(196, 116)
    event = h.call("QaCGearEvent", SUB, 1)
    assert event
    h.release()
    code = h.pcOwned[event][2]
    changed = bytes(h.uc.mem_read(code, len(h.pcScript)))
    assert changed[:30] == h.pcScript[:30] and changed[60:] == h.pcScript[60:]
    assert (
        struct.unpack_from("<H", changed, 44)[0] == 4
        and 50 + struct.unpack_from("<i", changed, 46)[0] == 0x2EE
    )
    assert changed[50:60] == bytes.fromhex("3201218030002f000200")
    assert h.sounds == [1996, 1372]
    h.eventDelete(event)
    h.bikeOwned = False
    h.call("QaCGearUpdate", SUB, 1)
    h.press(88, 152)
    assert h.call("QaCGearEvent", SUB, 1) == 0
    h.release()
    h.bikeOwned = True
    h.call("QaCGearUpdate", SUB, 1)
    h.press(88, 152)
    assert h.call("QaCGearEvent", SUB, 1) == 0x022F2000
    h.release()
    # Busy field events and inactive input retain the display, but reject touches.
    h.busy = True
    h.call("QaCGearUpdate", SUB, 0)
    h.inVblank = True
    h.call(h.vblank)
    h.inVblank = False
    assert all(
        h.actorVisibility[a] for a in h.actorSet
    ), "Bike/PC events hid custom buttons"
    before = h.paletteBytes
    h.write(WORK + 0x30E, b"\1")
    h.write(WORK + 0x310, b"\1")
    h.call("QaCGearUpdate", SUB, 0)
    h.inVblank = True
    h.call(h.vblank)
    h.inVblank = False
    assert h.paletteBytes == before, "Short Bike event flashed dim colors"
    h.write(WORK + 0x310, b"\0")
    h.call("QaCGearUpdate", SUB, 0)
    h.inVblank = True
    h.call(h.vblank)
    h.inVblank = False
    assert all(h.actorVisibility[a] for a in h.actorSet), "Dimming hid buttons"
    original = struct.unpack_from("<H", before, 16)[0]
    target = 0x0423  # Female fixture after pattern loop.
    expected = sum(
        (((original >> shift) & 31) + ((target >> shift) & 31)) // 2 << shift
        for shift in (0, 5, 10)
    )
    assert struct.unpack_from("<H", h.paletteBytes, 16)[0] == expected
    h.press(196, 116)
    assert h.call("QaCGearEvent", SUB, 1) == 0
    h.release()
    h.busy = False
    h.write(WORK + 0x30E, b"\0")
    h.call("QaCGearUpdate", SUB, 1)
    assert h.call("QaCGearEvent", SUB, 1) == 0, "Busy touch queued later"
    h.write(WORK + 0x2FE, b"\1")
    h.press(60, 116)
    h.touch = (77, 125)
    h.call("QaInput", WORK)
    h.release()
    assert h.word(CGEAR + 16) & 65535 == 0xA000 and bytes(
        h.uc.mem_read(CGEAR + 20, 2)
    ) == bytes([77, 125])
    assert bytes(h.uc.mem_read(CGEAR, 16)) == bytes(16)
    h.write(WORK + 0x2FE, b"\0")
    h.call("QaCGearExit", SUB)
    assert not h.allocations and not h.chars and not h.actorSet
    # Native PC storage and other applications rebuild the inner C-Gear work
    # without replacing its subscreen. Tear down before native unit deletion,
    # then attach to the rebuilt work, including reused memory addresses.
    for _ in range(12):
        h.put(WORK, h.ov(0x21EC9CC) | 1)
        h.put(WORK + 0x34, CLSYS + 0x2000)
        h.call("QaCGearInit", SUB)
        h.call("QaCGearUpdate", SUB, 1)
        assert len(h.actorSet) == 4
        h.call("QaGearEnd", WORK)
        assert not h.allocations
        h.put(WORK, h.ov(0x21EC9CC) | 1)
        h.put(WORK + 0x34, CLSYS + 0x2000)
        h.call("QaCGearUpdate", SUB, 1)
        assert len(h.actorSet) == 4
        h.call("QaCGearExit", SUB)
        assert not h.allocations
    h.write(CONFIG, struct.pack("<HH", 0x1801, 0))
    h.call("QaCGearInit", SUB)
    h.call("QaCGearUpdate", SUB, 1)
    assert h.sounds == [1996, 1372]
    for setter in (0x2008A1C, 0x2008A38, 0x2008A54, 0x2008A70, 0x2008AD0, 0x2008AF0):
        h.call(setter, CONFIG, 1)
        assert h.word(CONFIG) & 0x1800 == 0x1800
    encounter = 0x022D0000
    h.write(encounter, bytes(64))
    h.write(encounter + 0x2D, b"\x7b")
    h.write(encounter + 0x32, b"\x4c\0")
    assert (
        h.call("QaRepelStep", encounter, GAME) == 0 and h.byte(encounter + 0x2D) == 123
    )
    assert h.call("QaRepelDepleted", encounter, GAME) == 0
    h.write(encounter + 0x2D, b"\0")
    h.put(PARTY + 4, 0)
    assert h.call("QaRepelDepleted", encounter, GAME) == 1
    h.put(PARTY + 4, 1)
    h.write(encounter + 0x2D, b"\x7b")
    h.write(CONFIG, struct.pack("<HH", 0x801, 0))
    assert (
        h.call("QaRepelStep", encounter, GAME) == 0 and h.byte(encounter + 0x2D) == 122
    )
    assert bytes(h.uc.mem_read(encounter + 0x32, 2)) == b"\x4c\0"
    h.call("QaCGearExit", SUB)
    assert not h.allocations
    # First eligible non-egg Fly user; native app request remains owned across
    # graphics cleanup and a rebuilt field. Cancel returns directly to the field.
    h.put(PARTY + 4, 3)
    h.eggs = {0}
    h.moves = {0: [19], 1: [0], 2: [19]}
    h.call("QaCGearInit", SUB)
    h.call("QaCGearUpdate", SUB, 1)
    for result in [1, 2]:
        h.press(172, 152)
        event = h.call("QaCGearEvent", SUB, 1)
        h.release()
        assert event, (
            game,
            [(hex(a), args) for a, args in h.calls[-40:]],
            list(h.uc.mem_read(h.session() + 96, 24)),
        )
        callback = h.word(event + 4)
        seq = event + 8
        assert h.call(callback, event, seq) == 0 and h.word(seq) == 1
        request, child = h.maps[-1]
        childwork = h.word(child + 12)
        assert h.word(request + 16) == 0 and h.byte(childwork + 0x68) == 2
        h.call("QaCGearExit", SUB)
        assert request in h.allocations
        param = 0x022E0000
        h.write(param, struct.pack("<IIH2xIII", 0, result, 42, 8, 9, SYSTEM))
        ret = h.call("QaTownMapReturn", childwork, param)
        assert ret == (1 if result == 1 else 2)
        h.put(request + 40, result)
        h.member = 2
        h.destination = 42
        h.eventDelete(child)
        h.call("QaCGearInit", SUB)
        h.call("QaCGearUpdate", SUB, 1)
        if result == 2:
            assert h.call(callback, event, seq) == 0 and h.word(seq) == 2
            h.eventDelete(h.children[-1][1])
            assert h.call(callback, event, seq) == 1
        else:
            assert h.call(callback, event, seq) == 1
        h.eventDelete(event)
    h.call("QaCGearExit", SUB)
    assert not h.allocations and h.record == [42]
    # Direct PC changes only its owned VM copy. Held touches and failed requests
    # do not replay access audio; the script lives through graphics teardown.
    cgearBefore = bytes(h.uc.mem_read(CGEAR, 52))
    h.configure([(60000, 2, 0, 0, 255, 60, 116, 0, 0)])
    for _ in range(10):
        h.call("QaCGearInit", SUB)
        h.call("QaCGearUpdate", SUB, 1)
        sounds = len(h.sounds)
        h.press(60, 116)
        event = h.call("QaCGearEvent", SUB, 1)
        assert event and h.sounds[sounds:] == [1372], (game, event, h.sounds[sounds:])
        code = h.pcOwned[event][2]
        for _ in range(4):
            h.call("QaInput", WORK)
            assert h.call("QaCGearEvent", SUB, 1) == 0
        assert len(h.sounds) == sounds + 1
        h.release()
        h.call("QaCGearExit", SUB)
        assert (
            code in h.allocations
            and h.uc.mem_read(code + 0x2EE, len(h.pcScript) - 0x2EE)
            == h.pcScript[0x2EE:]
        )
        h.eventDelete(event)
        assert not h.allocations
    h.call("QaCGearInit", SUB)
    h.call("QaCGearUpdate", SUB, 1)
    for offset in range(1, 6):
        baseline = dict(h.allocations)
        sounds = len(h.sounds)
        h.fail = h.attempts + offset
        h.press(60, 116)
        assert not h.call("QaCGearEvent", SUB, 1)
        h.release()
        assert h.allocations == baseline and len(h.sounds) == sounds
    h.fail = 0
    event = h.scriptCreate([SYSTEM, 10090, 0, 45])
    code = h.pcOwned[event][2]
    assert (
        h.uc.mem_read(code, len(h.pcScript)) == h.pcScript
    ), "Ordinary PC script was changed"
    h.eventDelete(event)
    h.call("QaCGearExit", SUB)
    assert not h.allocations
    h.write(CGEAR, cgearBefore)
    h.configure(
        [
            (1, 1, 0, 0, 255, 60, 116, 0, 0),
            (2, 2, 0, 0, 255, 196, 116, 0, 0),
            (3, 3, 450, 0, 0, 88, 152, 0, 0),
            (4, 4, 442, 0, 1, 172, 152, 0, 0),
        ]
    )
    # No Fly user, eggs only, empty party, and prohibited Fly locations open
    # the ordinary Town Map. Cancel owns no party menu or Fly travel request.
    for n, eggs, moves, allowed in [
        (1, set(), {0: [0]}, True),
        (1, {0}, {0: [19]}, True),
        (0, set(), {}, True),
        (1, set(), {0: [19]}, False),
    ]:
        h.put(PARTY + 4, n)
        h.eggs = eggs
        h.moves = moves
        h.flyAllowed = allowed
        h.call("QaCGearInit", SUB)
        h.call("QaCGearUpdate", SUB, 1)
        h.press(172, 152)
        event = h.call("QaCGearEvent", SUB, 1)
        h.release()
        assert event
        callback = h.word(event + 4)
        seq = event + 8
        assert h.call(callback, event, seq) == 0
        request, child = h.maps[-1]
        assert h.word(request + 16) == 8, "Fallback opened Fly map"
        h.put(request + 40, 1)
        h.eventDelete(child)
        assert h.call(callback, event, seq) == 1
        h.eventDelete(event)
        h.call("QaCGearExit", SUB)
        assert not h.allocations
    # Map parent and child allocation failures leave the live field UI intact.
    h.flyAllowed = True
    h.put(PARTY + 4, 1)
    h.moves = {0: [19]}
    h.eggs = set()
    h.call("QaCGearInit", SUB)
    h.call("QaCGearUpdate", SUB, 1)
    for offset in (1, 2):
        baseline = dict(h.allocations)
        h.fail = h.attempts + offset
        h.press(172, 152)
        assert h.call("QaCGearEvent", SUB, 1) == 0
        h.release()
        assert h.allocations == baseline and len(h.actorSet) == 4
    for offset in (1, 2):
        h.fail = 0
        baseline = dict(h.allocations)
        h.press(172, 152)
        event = h.call("QaCGearEvent", SUB, 1)
        h.release()
        h.fail = h.attempts + offset
        assert h.call(h.word(event + 4), event, event + 8) == 1
        h.eventDelete(event)
        assert h.allocations == baseline and len(h.actorSet) == 4
    h.call("QaCGearExit", SUB)
    assert not h.allocations
    for n in range(1, 18):
        h = Harness(game)
        h.fail = n
        h.call("QaCGearInit", SUB)
        h.call("QaCGearUpdate", SUB, 1)
        h.call("QaCGearExit", SUB)
        assert not h.allocations and not h.chars
    for low in ("heapFree", "heapLargest"):
        h = Harness(game)
        setattr(h, low, 1024)
        h.call("QaCGearInit", SUB)
        h.call("QaCGearUpdate", SUB, 1)
        assert not h.actorSet and not h.allocations
        h.call("QaCGearExit", SUB)
    print(
        game,
        "native resource parsers, register/stack preservation, touch ownership/hold, event priority, saved bits, Repel pause/resume, dragging, VBlank, persistent display/dimming, inner teardown/rebuild, Town Map fallback, Fly request lifetime/cancel/travel dispatch and allocation failure/cleanup passed",
    )

# Eight-button configuration, stable positions, every route and both profiles.
DEFAULT = [
    (1, 1, 0, 0, 255, 60, 116, 0, 0),
    (2, 2, 0, 0, 255, 196, 116, 2, 1517),
    (3, 3, 450, 0, 0, 88, 152, 0, 0),
    (4, 4, 442, 0, 1, 172, 152, 0, 0),
]
EXTRA = [
    (5, 6, 471, 0, 9, 40, 88, 0, 0),
    (6, 7, 447, 0, 5, 216, 88, 0, 0),
    (7, 8, 465, 0, 6, 40, 136, 0, 0),
    (8, 11, 627, 0, 11, 216, 136, 0, 0),
]
for game in ("W2", "B2"):
    h = Harness(game)
    h.ownedItems = {471, 447, 465, 627}
    h.configure(DEFAULT + EXTRA)
    native = bytes(range(16))
    h.write(CGEAR, native)
    # Migrate the old four-position layout into the entire 36-byte reserved tail.
    legacy = bytearray(14)
    struct.pack_into("<I", legacy, 0, 0x31504151)
    legacy[4] = 1
    legacy[5:13] = bytes([61, 117, 197, 117, 89, 153, 173, 153])
    legacy[13] = 0x9B
    for b in legacy[:13]:
        legacy[13] ^= b
    h.write(CGEAR + 16, legacy)
    h.call("QaCGearInit", SUB)
    h.call("QaCGearUpdate", SUB, 1)
    assert (
        len(h.chars) == 8
        and len(h.actorSet) == 8
        and bytes(h.uc.mem_read(CGEAR, 16)) == native
    )
    h.call("QaGearUnit", 84, 0, 45)
    assert h.calls[-1][1][:3] == [92, 0, 45]
    assert bytes(h.uc.mem_read(h.session() + 120, 8)) == legacy[5:13]
    h.inVblank = True
    h.call(h.vblank)
    h.inVblank = False
    assert len(h.uploads) == 8 and len(h.paletteBytes) == 256
    assert (
        h.fadeObjBytes == h.paletteBytes[:224]
    ), "Native fade would overwrite custom palette banks 7–13"
    h.write(GAME + 0x1D2, b"\1")
    h.call("QaCGearUpdate", SUB, 1)
    h.inVblank = True
    h.call(h.vblank)
    h.inVblank = False
    assert not any(
        h.actorVisibility[a] for a in h.actorSet
    ), "Reverse field displayed quick actions"
    h.write(GAME + 0x1D2, b"\0")
    h.call("QaCGearUpdate", SUB, 1)
    assert [h.uc.mem_read(h.session() + 80 + i * 4, 4) for i in range(8)] == [
        struct.pack("<I", 7 - i) for i in range(8)
    ]
    # Eighth actor can be dragged and saved, independent of subsequent ordering/default changes.
    h.write(WORK + 0x2FE, b"\1")
    h.press(216, 136)
    h.touch = (224, 112)
    h.call("QaInput", WORK)
    h.release()
    assert bytes(h.uc.mem_read(CGEAR + 16 + 4 + 7 * 4, 2)) == bytes([224, 112])
    h.call("QaCGearExit", SUB)
    h.configure(list(reversed(DEFAULT + EXTRA)))
    h.call("QaCGearInit", SUB)
    h.call("QaCGearUpdate", SUB, 1)
    assert bytes(h.uc.mem_read(h.session() + 120, 2)) == bytes(
        [224, 112]
    ), "Reorder lost stable position ID"
    # L+R resets once per one-second hold, and preserves native save bytes.
    h.keys = 0x300
    for _ in range(29):
        h.call("QaCGearUpdate", SUB, 1)
    assert bytes(h.uc.mem_read(h.session() + 120, 2)) == bytes([224, 112])
    h.call("QaCGearUpdate", SUB, 1)
    assert bytes(h.uc.mem_read(h.session() + 120, 2)) == bytes([216, 136])
    h.press(216, 136)
    h.touch = (224, 112)
    h.call("QaInput", WORK)
    h.release()
    for _ in range(90):
        h.call("QaCGearUpdate", SUB, 1)
    assert bytes(h.uc.mem_read(h.session() + 120, 2)) == bytes(
        [224, 112]
    ), "Reset repeated during held keys"
    h.keys = 0
    h.call("QaCGearUpdate", SUB, 1)
    h.keys = 0x300
    for _ in range(30):
        h.call("QaCGearUpdate", SUB, 1)
    assert (
        bytes(h.uc.mem_read(h.session() + 120, 2)) == bytes([216, 136])
        and bytes(h.uc.mem_read(CGEAR, 16)) == native
    )
    h.call("QaCGearExit", SUB)
    assert not h.allocations
    # Front custom button owns an overlap; wrench/logo own their native regions.
    h.configure(
        [(101, 1, 0, 0, 255, 60, 116, 0, 0), (102, 2, 0, 0, 255, 60, 116, 0, 0)]
    )
    h.write(WORK + 0x2FE, b"\0")
    h.call("QaCGearInit", SUB)
    h.call("QaCGearUpdate", SUB, 1)
    h.press(60, 116)
    event = h.call("QaCGearEvent", SUB, 1)
    assert event
    h.release()
    h.eventDelete(event)
    assert not h.word(CONFIG) & 0x1000
    h.call("QaCGearExit", SUB)
    for action, itemId, alternate, check, call in [
        (3, 450, 0, 0, None),
        (4, 442, 0, 1, 8),
        (5, 442, 0, 1, 8),
        (6, 471, 0, 9, None),
        (7, 447, 0, 5, None),
        (8, 465, 0, 6, 12),
        (9, 437, 0, 7, 9),
        (10, 621, 626, 10, 13),
        (11, 627, 0, 11, 14),
        (12, 466, 0, 255, 0),
        (13, 628, 629, 255, 0),
        (14, 638, 0, 255, 0),
        (15, 0, 0, 255, 2),
        (16, 0, 0, 255, 0),
    ]:
        h.configure([(1, action, itemId, alternate, check, 60, 116, 1, 1500)])
        h.call(h.arm(0x2019204), h.flagWork, 1500)
        h.ownedItems.add(alternate or itemId)
        h.flyAllowed = False
        h.call("QaCGearInit", SUB)
        h.call("QaCGearUpdate", SUB, 1)
        if check != 255:
            h.useBlocked.add(check)
            h.call("QaCGearUpdate", SUB, 1)
            h.press(60, 116)
            assert h.call("QaCGearEvent", SUB, 1) == 0
            h.release()
            h.useBlocked.clear()
            h.call("QaCGearUpdate", SUB, 1)
        sounds = len(h.sounds)
        h.press(60, 116)
        event = h.call("QaCGearEvent", SUB, 1)
        assert event
        assert h.sounds[sounds:] == ([1356] if action in (4, 5, 15, 16) else [])
        for _ in range(5):
            h.call("QaInput", WORK)
            assert h.call("QaCGearEvent", SUB, 1) == 0
        assert len(h.sounds) == sounds + (action in (4, 5, 15, 16))
        h.release()
        if call is None:
            assert [args[0] for a, args in h.calls if a == h.ov(0x215F024)][-1] == {
                3: 0,
                6: 5,
                7: 4,
            }[action]
        else:
            callback = h.word(event + 4)
            assert h.call(callback, event, event + 8) == 0
            request, child = h.maps[-1]
            assert h.word(request + 16) == call
            assert h.word(request + 20) == (
                (alternate or itemId) if 12 <= action <= 14 else 0xFFFFFFFF
            )
            h.put(request + 40, 1)
            h.eventDelete(child)
            assert h.call(callback, event, event + 8) == 1
            h.eventDelete(event)
        h.call("QaCGearExit", SUB)
        assert not h.allocations
    # BAG can open with an empty party; PARTY dims and consumes its touch.
    for action in (15, 16):
        h.configure([(1, action, 0, 0, 255, 60, 116, 0, 0)])
        h.put(PARTY + 4, 0)
        h.call("QaCGearInit", SUB)
        h.call("QaCGearUpdate", SUB, 1)
        h.press(60, 116)
        event = h.call("QaCGearEvent", SUB, 1)
        h.release()
        if action == 15:
            assert event
            h.eventDelete(event)
        else:
            assert not event and h.byte(h.session() + 152) == 0
        h.call("QaCGearExit", SUB)
        assert not h.allocations
    h.put(PARTY + 4, 1)
    # Ordinary bag/party launches preserve native item/field-skill handoffs.
    for action in (15, 16):
        for result in (2, 3):
            h.configure([(1, action, 0, 0, 255, 60, 116, 0, 0)])
            h.call("QaCGearInit", SUB)
            h.call("QaCGearUpdate", SUB, 1)
            h.press(60, 116)
            event = h.call("QaCGearEvent", SUB, 1)
            h.release()
            callback = h.word(event + 4)
            assert h.call(callback, event, event + 8) == 0
            request, child = h.maps[-1]
            h.eventDelete(child)
            h.put(request + 40, result)
            h.put(request + 44, 4 if result == 2 else 0)
            h.put(request + 48, 0)
            h.put(request + 52, 42)
            h.member = 0
            h.destination = 42
            assert h.call(callback, event, event + 8) == 0 and h.word(event + 8) == 2
            if result == 2:
                h.eventDelete(h.children[-1][1])
            else:
                assert h.children[-1][1] == 0x022F2000
            assert h.call(callback, event, event + 8) == 1
            h.eventDelete(event)
            h.call("QaCGearExit", SUB)
            assert not h.allocations
    # Removing every Repel button preserves the preference and resumes ordinary item behavior.
    h.configure([(1, 2, 0, 0, 255, 60, 116, 0, 0)])
    h.write(CONFIG, struct.pack("<HH", 0x1801, 0))
    h.call("QaCGearInit", SUB)
    encounter = 0x022D0000
    h.write(encounter, bytes(64))
    h.write(encounter + 0x2D, b"\x7b")
    h.call("QaRepelStep", encounter, GAME)
    assert h.byte(encounter + 0x2D) == 122 and h.word(CONFIG) & 0x1800 == 0x1800
    h.call("QaCGearExit", SUB)
    # Every partial allocation point in the maximum configuration cleans up.
    for failure in range(1, 31):
        h = Harness(game)
        h.configure(DEFAULT + EXTRA)
        h.fail = failure
        h.call("QaCGearInit", SUB)
        h.call("QaCGearUpdate", SUB, 1)
        h.call("QaCGearExit", SUB)
        assert not h.allocations and not h.chars and not h.actorSet
    h = Harness(game)
    h.configure(DEFAULT + EXTRA)
    h.spriteCapacity = 2048
    h.call("QaCGearInit", SUB)
    h.call("QaCGearUpdate", SUB, 1)
    assert not h.actorSet and not h.chars and not h.allocations
    print(
        game,
        "eight actors/palettes, finite VRAM failure cleanup, stable-ID migration/reordering, eighth drag, once-per-hold reset, touch layering, show-flag/native eligibility, all key-item routes, dormant Repel and eight-button allocation cleanup passed",
    )

# Skin carousel: scheduled uploads, original-picture preservation, held touch,
# saved stable IDs, conflict priority and failed reads in both native profiles.
for game in ("W2", "B2"):
    h = Harness(game)
    original = bytearray(0x2600)
    original[:0x1FE0] = bytes([0x11]) * 0x1FE0
    for i in range(16):
        struct.pack_into("<H", original, 0x1FE0 + i * 2, i * 31)
    h.write(0x06204000, original[:0x1FE0])
    h.write(0x050003A0, original[0x1FE0:0x2000])
    h.write(0x06207800, original[0x2000:])
    native = bytes(range(16))
    h.write(CGEAR, native)

    def tick():
        h.call("QaCGearUpdate", SUB, 1)
        h.inVblank = True
        h.call(h.vblank)
        h.inVblank = False

    h.call("QaCGearInit", SUB)
    tick()
    assert not h.skinUploads and not h.sounds
    assert h.selectorFrames[-1] == [SUB + 0xA0A0, 0]
    h.press(208, 18)
    assert h.sounds == [1356]
    tick()
    assert h.skinUploads[-1] == h.arc.files[16]
    assert h.selectorFrames[-1] == [SUB + 0xA0A0, 1]
    saved = bytes(h.uc.mem_read(CGEAR, 52))
    assert struct.unpack_from("<H", saved, 16)[0] == 0xA001 and saved[:16] == native
    for _ in range(5):
        h.call("QaInput", WORK)
        tick()
    assert len(h.skinUploads) == 1 and h.sounds == [
        1356
    ], "Held touch repeated skin switching or sound"
    assert h.selectorFrames[-1][1] == 1
    h.release()
    tick()
    assert h.selectorFrames[-1][1] == 0, "Pressed feedback did not expire"
    for i in range(1, 15):
        h.press(208, 18)
        tick()
        h.release()
        assert h.skinUploads[-1] == h.arc.files[16 + i]
    h.press(208, 18)
    tick()
    h.release()
    assert h.skinUploads[-1] == bytes(
        original
    ), "Original save-file picture was not restored"
    assert h.uc.mem_read(CGEAR, 16) == native and h.sounds == [1356] * 16
    # Blocked input is discarded, including wrench mode.
    count = len(h.skinUploads)
    sounds = len(h.sounds)
    h.busy = True
    h.press(208, 18)
    h.release()
    h.busy = False
    tick()
    assert len(h.skinUploads) == count and len(h.sounds) == sounds
    h.write(WORK + 0x2FE, b"\1")
    h.press(208, 18)
    h.release()
    tick()
    assert h.selectorFrames[-1][1] == 0
    h.write(WORK + 0x2FE, b"\0")
    tick()
    assert len(h.skinUploads) == count and len(h.sounds) == sounds
    # Persisted ID survives cleanup/reinitialization and load does not activate actions.
    h.call("QaCGearExit", SUB)
    h.write(CGEAR, saved)
    h.call("QaCGearInit", SUB)
    tick()
    tick()
    assert h.skinUploads[-1] == h.arc.files[16]
    assert (
        len(h.sounds) == sounds
        and len(h.actorSet) == 4
        and h.selectorFrames[-1][1] == 0
    )
    # Damaged skin leaves the working display and saved preference intact.
    bad = bytearray(h.arc.files[17])
    bad[0] ^= 1
    h.arc.files[17] = bytes(bad)
    count = len(h.skinUploads)
    h.press(208, 18)
    tick()
    h.release()
    assert len(h.skinUploads) == count
    assert struct.unpack("<H", h.uc.mem_read(CGEAR + 16, 2))[0] == 0xA001
    h.call("QaCGearExit", SUB)
    assert not h.allocations and not h.chars and not h.actorSet
    # A pre-skin position record migrates positions but has no chosen skin ID.
    h = Harness(game)
    header = bytearray(h.arc.files[0])
    struct.pack_into("<H", header, 22, 1)
    h.arc.files[0] = bytes(header)
    h.rehash()
    saved = bytearray(36)
    struct.pack_into("<H", saved, 0, 0x3251)
    struct.pack_into("<HBB", saved, 2, 1, 76, 120)
    crc = 0xFFFF
    for b in saved[:34]:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ (0xA001 if crc & 1 else 0)
    struct.pack_into("<H", saved, 34, crc)
    h.write(CGEAR + 16, saved)
    # Physical palette is faded; the retained native source remains original.
    fade = SUB + 0x9000
    base = SUB + 0x9200
    h.put(WORK + 0x100, fade)
    h.put(fade + 20, base)
    colors = bytes(range(32))
    h.write(base + 416, colors)
    h.write(0x050003A0, bytes(32))
    h.call("QaCGearInit", SUB)
    tick()
    tick()
    assert h.skinUploads[-1] == h.arc.files[16]
    assert bytes(h.uc.mem_read(h.session() + 120, 2)) == bytes([76, 120])
    originalPointer = h.word(h.session() + 1392)
    assert (
        h.uc.mem_read(originalPointer + 0x1FE0, 32) == colors
    ), "Original skin captured a faded palette"
    h.call("QaCGearExit", SUB)
    assert not h.allocations
    print(
        game,
        "15-skin cycle, pressed feedback/expiry, once-per-press menu sound, original picture, VBlank/main-RAM uploads, hold suppression, silent blocked/wrench input and reload, saved selection, corrupt-read recovery and cleanup passed",
    )

# Continuous BW2 rim dial, including in-flight upload identity and cancellation.
import math

for game in ("W2", "B2"):

    def point(degrees):
        return (
            128 + round(125 * math.cos(math.radians(degrees))),
            96 + round(125 * math.sin(math.radians(degrees))),
        )

    def setup(buttons=None, capacity=4288):
        h = Harness(game)
        if buttons is not None:
            h.configure(buttons)
        header = bytearray(h.arc.files[0])
        struct.pack_into("<H", header, 4, 7)
        header[45] = header[47] = 1
        h.arc.files[0] = header
        h.rehash()
        h.nativeTouch = -1
        h.spriteCapacity = capacity
        for i in range(6):
            h.put(WORK + 0x6C + i * 4, SUB + 0xA000 + i * 32)
        h.call("QaCGearInit", SUB)
        h.call("QaCGearUpdate", SUB, 1)
        return h

    def tick(h):
        h.call("QaCGearUpdate", SUB, 1)
        h.inVblank = True
        h.call(h.vblank)
        h.inVblank = False

    def settle(h):
        tick(h)
        tick(h)

    def move(h, a):
        h.touch = point(a)
        h.call("QaInput", WORK)

    def saved(h):
        return struct.unpack("<H", h.uc.mem_read(CGEAR + 16, 2))[0] & 4095

    def marker(h):
        custom = {
            h.word(h.session() + 12 + i * 4) for i in range(h.byte(h.session() + 733))
        }
        return next(iter(h.actorSet - custom))

    h = setup()
    settle(h)
    m = marker(h)
    assert len(h.actorSet) == 5 and not h.actorVisibility[m]
    assert all(
        not h.actorVisibility[SUB + 0xA000 + i * 32] for i in range(6)
    ), "Clock or decal actor remained visible"
    h.nativeTouch = 3
    assert (
        h.call("QaButtonHit", WORK) == 0xFFFFFFFF
    ), "Hidden clock retained touch input"
    h.nativeTouch = -1
    h.press(208, 18)
    settle(h)
    h.release()
    assert not h.skinUploads and not h.sounds, "Removed selector still activated"
    h.press(*point(-140))
    assert h.actorVisibility[m], "Former clock area blocked rim capture"
    h.release()
    h.press(*point(0))
    assert h.actorVisibility[m]
    h.nativeTouch = 7
    assert (
        h.call("QaButtonHit", WORK) == 0xFFFFFFFF
    ), "Captured rim drag reached native controls"
    h.nativeTouch = -1
    move(h, 11)
    settle(h)
    assert not h.skinUploads
    move(h, 13)
    settle(h)
    assert saved(h) == 1 and h.skinUploads[-1] == h.arc.files[16] and h.sounds == [1356]
    for _ in range(6):
        h.call("QaInput", WORK)
        settle(h)
    assert (
        len(h.skinUploads) == 1 and len(h.sounds) == 1
    ), "Held stationary dial repeated"
    h.release()
    assert not h.actorVisibility[m]
    h.press(*point(0))
    move(h, -13)
    settle(h)
    assert saved(h) == 0
    h.release()
    h.press(*point(0))
    move(h, -13)
    settle(h)
    assert saved(h) == 15
    h.release()
    h.press(*point(-13))
    move(h, 0.6)
    settle(h)
    assert saved(h) == 0, "Zero wrap jumped/reversed"
    h.release()
    # A second request arrives after preparation but before the first upload.
    h.press(*point(0))
    move(h, 13)
    h.call("QaCGearUpdate", SUB, 1)
    move(h, 27)
    h.inVblank = True
    h.call(h.vblank)
    h.inVblank = False
    assert (
        saved(h) == 1 and h.skinUploads[-1] == h.arc.files[16]
    ), "Prepared pixels and saved ID diverged"
    settle(h)
    assert saved(h) == 2 and h.skinUploads[-1] == h.arc.files[17]
    x, y = h.actorPositions[m]
    assert abs(math.hypot(x - 128, y - 96) - 125) < 2
    h.release()
    # A native event cancels an unprepared target and suppresses held touches.
    before = len(h.skinUploads)
    h.press(*point(0))
    move(h, 13)
    h.busy = True
    tick(h)
    assert not h.actorVisibility[m]
    h.busy = False
    settle(h)
    assert len(h.skinUploads) == before
    move(h, 27)
    settle(h)
    assert len(h.skinUploads) == before
    h.release()
    h.write(WORK + 0x2FE, b"\1")
    h.press(*point(0))
    move(h, 27)
    settle(h)
    h.release()
    assert len(h.skinUploads) == before
    h.write(WORK + 0x2FE, b"\0")
    h.call("QaCGearExit", SUB)
    assert not h.allocations and not h.chars and not h.actorSet
    # Shown unavailable custom controls retain their touches above the rim.
    custom = list(DEFAULT)
    custom[2] = (3, 3, 450, 0, 0, 240, 96, 0, 0)
    h = setup(custom)
    h.bikeOwned = True
    h.useBlocked = {0}
    settle(h)
    h.press(240, 96)
    move(h, 13)
    settle(h)
    assert not h.actorVisibility[marker(h)] and not h.skinUploads
    h.release()
    h.call("QaCGearExit", SUB)
    # All eight actions plus marker fit; finite VRAM failure restores ownership.
    h = setup(DEFAULT + EXTRA)
    settle(h)
    assert len(h.actorSet) == 9 and len(h.chars) == 9
    h.call("QaGearUnit", 84, 0, 45)
    assert h.calls[-1][1][0] == 93
    h.call("QaCGearExit", SUB)
    assert not h.allocations and not h.chars and not h.actorSet
    h = setup(DEFAULT + EXTRA, 4096)
    assert (
        not h.actorSet and not h.chars
    ), "Marker VRAM failure retained button resources"
    h.call("QaCGearExit", SUB)
    assert not h.allocations
    for failure in range(1, 26):
        h = Harness(game)
        header = bytearray(h.arc.files[0])
        struct.pack_into("<H", header, 4, 7)
        header[47] = 1
        h.arc.files[0] = header
        h.rehash()
        h.fail = failure
        h.call("QaCGearInit", SUB)
        h.call("QaCGearUpdate", SUB, 1)
        h.call("QaCGearExit", SUB)
        assert not h.allocations and not h.chars and not h.actorSet, (
            "dial allocation cleanup",
            failure,
        )
    print(
        game,
        "dial 12-degree CW/CCW, wrapping, stationary hold, marker, upload coalescing/identity, blocked/wrench cancellation, custom priority, nine resources and allocation cleanup passed",
    )

# New native control replacements, hidden communication input, Save ownership.
for game in ("W2", "B2"):
    h = Harness(game)
    header = bytearray(h.arc.files[0])
    struct.pack_into("<H", header, 4, 7)
    header[45] = 1
    h.arc.files[0] = header
    h.rehash()
    for i in range(20):
        h.put(WORK + 0x6C + i * 4, SUB + 0xA000 + i * 32)
    h.call("QaCGearInit", SUB)
    h.call("QaCGearUpdate", SUB, 1)
    assert h.networkPositions == [[256, 192]]
    for i in [10, 13, 14, 15, 16, 17, 18, 19]:
        assert not h.actorVisibility[SUB + 0xA000 + i * 32]
    assert (
        h.actorVisibility[SUB + 0xA000 + 7 * 32]
        and h.actorVisibility[SUB + 0xA000 + 9 * 32]
    )
    h.write(WORK + 0x30B, b"\1")
    for i in [0, 1, 2, 8, 5, 6]:
        h.nativeTouch = i
        assert h.call("QaButtonHit", WORK) == 0xFFFFFFFF
    for i in [7, 9, 10]:
        h.nativeTouch = i
        assert h.call("QaButtonHit", WORK) == i
    # The fixed music control shares real compiled state with the keyboard
    # shortcut, consumes help touches, and never acquires event/heap resources.
    h.write(WORK + 0x30B, b"\0")
    baseline = dict(h.allocations)
    opts = bytes(h.uc.mem_read(CONFIG, 4))
    assert h.call("PokewebBgmMute", 0) == 0
    h.press(215, 163)
    assert h.call("QaCGearEvent", SUB, 1) == 0 and h.call("PokewebBgmMute", 0) == 1
    assert h.bgmVolumes[-1] == [0xFFFF, 0] and h.sounds == [1356]
    h.call("QaCGearUpdate", SUB, 1)
    assert h.musicSequences[-1] == [SUB + 0xA000 + 8 * 32, 9]
    for _ in range(5):
        h.call("QaInput", WORK)
        h.call("QaCGearEvent", SUB, 1)
    assert (
        h.call("PokewebBgmMute", 0) == 1
        and len(h.bgmVolumes) == 1
        and h.sounds == [1356]
    )
    h.release()
    h.keys = 0x304
    h.call("THUMB_BRANCH_LINK_GameUpdate_0xE")
    assert h.call("PokewebBgmMute", 0) == 0
    assert h.bgmVolumes[-1] == [0xFFFF, 127]
    h.call("THUMB_BRANCH_LINK_GameUpdate_0xE")
    assert len(h.bgmVolumes) == 2
    h.keys = 0
    h.call("THUMB_BRANCH_LINK_GameUpdate_0xE")
    h.press(215, 163)
    h.event = 0x022F3000
    assert h.call("QaCGearEvent", SUB, 1) == h.event
    h.event = 0
    h.release()
    assert h.call("QaCGearEvent", SUB, 1) == 0 and h.call("PokewebBgmMute", 0) == 0
    h.write(WORK + 0x2FE, b"\1")
    h.press(215, 163)
    h.call("QaCGearEvent", SUB, 1)
    h.release()
    h.write(WORK + 0x2FE, b"\0")
    assert h.call("PokewebBgmMute", 0) == 0
    h.press(215, 163)
    h.call("QaCGearEvent", SUB, 0)
    h.release()
    assert h.call("PokewebBgmMute", 0) == 0
    h.press(215, 163)
    h.call("QaCGearEvent", SUB, 1)
    h.release()
    h.call("QaCGearUpdate", SUB, 1)
    assert (
        h.call("PokewebBgmMute", 0) == 1
        and h.allocations == baseline
        and bytes(h.uc.mem_read(CONFIG, 4)) == opts
    )
    assert h.sounds == [1356, 1356], "Blocked/edit/held mute presses played sound"
    h.call("PokewebBgmMute", 1)
    h.call("QaCGearUpdate", SUB, 1)
    assert h.musicSequences[-1] == [SUB + 0xA000 + 8 * 32, 8]
    h.write(WORK + 0x30B, b"\1")
    h.press(200, 180)
    event = h.call("QaCGearEvent", SUB, 1)
    assert event
    callback = h.word(event + 4)
    for _ in range(5):
        h.call("QaInput", WORK)
        assert h.call("QaCGearEvent", SUB, 1) == 0
    h.release()
    h.call("QaCGearExit", SUB)
    assert h.networkPositions[-1] == [200, 10], "Global network icon was not restored"
    # Request survives graphics teardown. Cancel overwrites native menu request
    # before the next display update and waits for the return screen to be ready.
    work = h.word(event + 12)
    h.put(work + 36, 17)
    h.saveResult = 2
    assert h.call(callback, event, event + 8) == 0 and h.word(SUB + 4) == 0
    h.saveResult = 1
    h.subReady = False
    assert h.call(callback, event, event + 8) == 0
    h.subReady = True
    assert h.call(callback, event, event + 8) == 1
    h.eventDelete(event)
    assert not h.allocations
    h.put(SUB + 8, 0)
    h.put(WORK, h.ov(0x21EC9CC) | 1)
    h.call("QaCGearInit", SUB)
    h.call("QaCGearUpdate", SUB, 1)
    h.press(200, 180)
    h.event = 0x022F3000
    assert h.call("QaCGearEvent", SUB, 1) == h.event
    h.event = 0
    h.release()
    assert h.call("QaCGearEvent", SUB, 1) == 0
    h.fail = h.attempts + 1
    h.press(200, 180)
    assert not h.call("QaCGearEvent", SUB, 1)
    h.release()
    h.call("QaCGearExit", SUB)
    assert not h.allocations
    print(
        game,
        "hidden native actors/touches, fixed Save priority/hold, native save request lifetime/cancel return, network selector cleanup and blocked/allocation failure passed",
    )

# Pokéradar: real retail eligibility, timer and chance flow; isolated terrain
# search/effect tasks. Full tile/visual behavior is checked in the DS emulator.
for game in ("W2", "B2"):
    for terrain, offset, flags in [
        ("grass", 2, 1),
        ("water", 4, 2),
        ("fishing", 6, 2),
        ("mixed", 2, 3),
    ]:
        h = Harness(game)
        h.configure([(17, 17, 0, 0, 255, 60, 116, 0, 0)])
        h.write(h.encounterData + offset, b"\x01")
        if terrain == "mixed":
            h.write(h.encounterData + 4, b"\x01")
        h.radarSelections = 2
        h.call("QaCGearInit", SUB)
        h.call("QaCGearUpdate", SUB, 1)
        before = dict(h.allocations)
        h.press(60, 116)
        assert h.call("QaCGearEvent", SUB, 1) == 0
        assert h.sounds == [1356], "Radar did not use the Party menu opening sound"
        assert (
            h.byte(h.encounterState + 0x25) & 15
            and h.radarAttempts == 3
            and h.radarFlags == [flags] * 3
        )
        assert h.allocations == before, "Radar acquired an unowned request/allocation"
        for _ in range(8):
            h.call("QaInput", WORK)
            h.call("QaCGearEvent", SUB, 1)
        assert h.radarAttempts == 3, "Held radar press retriggered"
        assert h.sounds == [1356], "Held radar press repeated its sound"
        h.release()
        h.call("QaCGearUpdate", SUB, 1)
        h.press(60, 116)
        h.call("QaCGearEvent", SUB, 1)
        h.release()
        assert h.radarAttempts == 3, "Radar replaced an existing phenomenon"
        assert h.sounds == [1356], "Unavailable radar press played a sound"
        h.write(h.encounterState + 0x25, b"\0")
        h.call("QaCGearUpdate", SUB, 1)
        h.press(60, 116)
        h.event = 0x022F3000
        assert h.call("QaCGearEvent", SUB, 1) == h.event
        h.event = 0
        h.release()
        assert (
            h.call("QaCGearEvent", SUB, 1) == 0 and h.radarAttempts == 3
        ), "Blocked radar press queued later"
        # The overrides are strictly scoped to the accepted button call.
        h.put(h.encounterState + 0x14, 0)
        assert h.call("QaPhenomenonInterval", h.encounterState, h.effect) == 0
        assert h.word(h.encounterState + 0x14) == 1
        assert h.call("QaPhenomenonChance", 7) == 7
        h.call("QaCGearExit", SUB)
        assert not h.allocations
    for blocked in ("data", "badge", "grid", "tiles", "occupied", "empty"):
        h = Harness(game)
        h.configure([(17, 17, 0, 0, 255, 60, 116, 0, 0)])
        if blocked != "empty":
            h.write(h.encounterData + 2, b"\x01")
        h.radarAllowed = blocked != "data"
        h.radarBadge = blocked != "badge"
        h.radarGrid = blocked != "grid"
        h.radarTiles = blocked != "tiles"
        h.radarSelections = 100 if blocked == "occupied" else 0
        h.call("QaCGearInit", SUB)
        h.call("QaCGearUpdate", SUB, 1)
        h.press(60, 116)
        assert h.call("QaCGearEvent", SUB, 1) == 0
        h.release()
        assert not h.byte(h.encounterState + 0x25) & 15
        assert h.radarAttempts == (32 if blocked in ("tiles", "occupied") else 0), (
            game,
            blocked,
            h.radarAttempts,
        )
        assert not h.word(h.symbols["_ZN12_GLOBAL__N_19radarWorkE"])
        h.call("QaCGearExit", SUB)
        assert not h.allocations
    print(
        game,
        "Pokéradar retail eligibility/timer/chance, terrain flags, immediate bounded placement, existing phenomenon, held/blocked presses and normal-spawn restoration passed",
    )

# HM02 Fly uses the native map/travel route without requiring move 19.
for game in ("W2", "B2"):
    h = Harness(game)
    h.configure([(19, 19, 421, 0, 1, 60, 116, 0, 0)])
    h.mapOwned = False
    h.moves = {0: [0], 1: [33]}
    h.eggs = {0}
    h.put(PARTY + 4, 2)
    h.call("QaCGearInit", SUB)
    h.call("QaCGearUpdate", SUB, 1)
    # Town Map/Fly ownership does not substitute for HM02, or vice versa.
    assert h.byte(h.session() + 725) == 0
    h.press(60, 116)
    assert not h.call("QaCGearEvent", SUB, 1)
    h.release()
    h.ownedItems.add(421)
    h.call("QaCGearUpdate", SUB, 1)
    originalMoves = dict(h.moves)
    for result, allowed, keepHm in [
        (1, True, True),
        (2, True, True),
        (2, False, True),
        (2, True, False),
    ]:
        h.flyAllowed = True
        h.ownedItems.add(421)
        h.press(60, 116)
        event = h.call("QaCGearEvent", SUB, 1)
        assert event and h.sounds[-1] == 1356
        # A held press cannot queue a second launch.
        assert not h.call("QaCGearEvent", SUB, 1)
        h.release()
        callback, sequence = h.word(event + 4), event + 8
        assert h.call(callback, event, sequence) == 0
        request, child = h.maps[-1]
        assert h.word(request + 16) == 0
        assert h.byte(h.word(child + 12) + 0x68) == 1
        h.call("QaCGearExit", SUB)
        assert request in h.allocations
        if result == 1:
            param = 0x022E0000
            h.write(param, struct.pack("<IIH2xIII", 0, result, 42, 8, 9, SYSTEM))
            assert h.call("QaTownMapReturn", h.word(child + 12), param) == 1
        h.put(request + 40, result)
        h.flyAllowed = allowed
        if not keepHm:
            h.ownedItems.remove(421)
        h.member, h.destination = 1, 42
        h.put(request + 52, h.destination)
        h.eventDelete(child)
        if result == 2 and allowed and keepHm:
            assert h.call(callback, event, sequence) == 0 and h.word(sequence) == 2
            h.eventDelete(h.children[-1][1])
        assert h.call(callback, event, sequence) == 1
        h.eventDelete(event)
        assert not h.allocations and h.moves == originalMoves
        h.ownedItems.add(421)
        h.flyAllowed = True
        h.call("QaCGearInit", SUB)
        h.call("QaCGearUpdate", SUB, 1)
    # Fly-prohibited areas and parties without a usable animation member fall
    # back to ordinary Town Map. Even an injected travel result cannot fly.
    for n, eggs, allowed in [(2, {0}, False), (2, {0, 1}, True), (0, set(), True)]:
        h.put(PARTY + 4, n)
        h.eggs, h.flyAllowed = eggs, allowed
        h.press(60, 116)
        event = h.call("QaCGearEvent", SUB, 1)
        h.release()
        callback, sequence = h.word(event + 4), event + 8
        assert h.call(callback, event, sequence) == 0
        request, child = h.maps[-1]
        assert h.word(request + 16) == 8
        h.put(request + 40, 2)
        h.eventDelete(child)
        assert h.call(callback, event, sequence) == 1
        h.eventDelete(event)
    h.call("QaCGearExit", SUB)
    assert not h.allocations and h.ownedItems == {421}
    print(
        game,
        "HM02 ownership, no-move Fly, native return/restrictions, held input and owned-request cleanup passed",
    )

# System Shop: trusted picker, parent lifetime, private messages and atomic payment.
subprocess.run(["npx", "vite-node", "scripts/generate-system-shop-bindings.ts", "--fixtures"], cwd=HERE.parents[1], check=True)
for game in ("W2", "B2"):
    h = Harness(game)
    h.heapFree = h.heapLargest = 0x80000
    h.shopArc = ndspy.narc.NARC((BUILD / "shop-fixture-1.narc").read_bytes())
    h.configure([(20, 20, 0, 0, 255, 60, 116, 2, 42)])
    h.call("QaCGearInit", SUB)
    h.call("QaCGearUpdate", SUB, 1)
    baseline = dict(h.allocations)
    h.call(h.arm(0x2019204), h.flagWork, 42)
    h.press(60, 116)
    assert not h.call("QaCGearEvent", SUB, 1)
    h.release()
    h.call(h.arm(0x201922C), h.flagWork, 42)

    def launch():
        h.press(60, 116)
        e = h.call("QaCGearEvent", SUB, 1)
        assert e and not h.call("QaCGearEvent", SUB, 1)
        h.release()
        assert h.call(h.word(e + 4), e, e + 8) == 0
        child = h.children[-1][1]
        vm = h.pcOwned[child][1]
        code = h.word(vm + 56)
        assert bytes(h.uc.mem_read(code, len(h.shopArc.files[2]))) == h.shopArc.files[2]
        assert h.word(vm + 32) == code + struct.unpack_from("<I", h.shopArc.files[2])[0] + 4
        return e, child

    def finish(e, child):
        h.eventDelete(child)
        assert h.call(h.word(e + 4), e, e + 8) == 1
        h.eventDelete(e)
        assert h.allocations == baseline

    for count in [0, 1, 16, 1]:
        h.shopArc = ndspy.narc.NARC((BUILD / f"shop-fixture-{count}.narc").read_bytes())
        e, child = launch()
        assert h.sounds[-1] == 1356
        finish(e, child)

    # Native priority and discarded touches, then checked owned allocations.
    h.event = 0x022f3000
    h.press(60, 116)
    assert h.call("QaCGearEvent", SUB, 1) == h.event
    h.event = 0
    h.release()
    assert not h.call("QaCGearEvent", SUB, 1)
    for free, largest in [(1024, 0x80000), (0x80000, 1024)]:
        h.heapFree, h.heapLargest = free, largest
        h.press(60, 116)
        assert not h.call("QaCGearEvent", SUB, 1)
        h.release()
        assert h.allocations == baseline
    h.heapFree = h.heapLargest = 0x80000
    for fail in range(1, 14):
        h.fail = h.attempts + fail
        h.press(60, 116)
        e = h.call("QaCGearEvent", SUB, 1)
        h.release()
        if e:
            done = h.call(h.word(e + 4), e, e + 8)
            if not done:
                child = h.children[-1][1]
                h.eventDelete(child)
                assert h.call(h.word(e + 4), e, e + 8) == 1
            h.eventDelete(e)
        assert h.allocations == baseline
    h.fail = 0
    original = h.shopScript
    h.shopScript = original[:60] + bytes([original[60] ^ 1]) + original[61:]
    sounds = len(h.sounds)
    h.press(60, 116)
    e = h.call("QaCGearEvent", SUB, 1)
    h.release()
    assert h.call(h.word(e + 4), e, e + 8) == 0
    child = h.children[-1][1]
    assert h.uc.mem_read(h.word(h.pcOwned[child][1] + 56) + 24, 2) == b"\x02\x00"
    assert len(h.sounds) == sounds
    finish(e, child)
    h.shopScript = original

    # Choice ownership and a constructed native request. UI scheduling stays
    # stubbed; bag reads/add/remove execute the retail ARM9 implementation.
    e, child = launch()
    native, trainer, bag, runtime, scriptState, choice = [SUB + n for n in [0x10000, 0x11000, 0x12000, 0x14000, 0x14100, 0x14200]]
    testVm, operands = SUB + 0x14400, SUB + 0x14480
    h.put(testVm + 32, operands)
    h.write(operands, struct.pack("<3H", 0, 65535, 0))
    h.put(runtime + 32, scriptState)
    menu = scriptState + 0x34
    h.functions[h.ov(0x21A85BC)] = lambda a: 0
    h.call("QaShopChoiceAdd", testVm, runtime)
    menuText = h.word(menu + 20)
    assert menuText in h.allocations and h.word(menu + 16) == 1
    h.free(menuText)  # Native list cleanup releases the adopted object.
    h.put(choice, 1)
    reopen = choice + 4
    h.functions[h.ov(0x2153F60)] = lambda a: choice if a[1] == 0x802a else reopen
    h.functions[h.ov(0x21ABBB0)] = lambda a: h.put(h.shopProcess + 0x3c, native - 8)
    h.call("QaShopBuyCommand", testVm, runtime)
    owned = []
    for arc in [0x11b, 0x11a]:
        p = h.call("QaShopStockFile", arc, 0, 21)
        assert p in h.allocations
        owned.append(p)
    assert h.uc.mem_read(owned[0], 6) == bytes([20] * 6)
    assert struct.unpack("<20H", h.uc.mem_read(owned[1], 40)) == tuple(range(328, 348))
    for i in range(20): assert h.call("QaShopPrice", 0) == i + 1
    h.write(native, bytes(0x2a4))
    h.write(native + 4, struct.pack("<H", 21))
    h.put(native + 12, trainer)
    h.put(native + 16, bag)
    h.put(trainer, 10000)
    h.write(bag, bytes(0x9ec))
    h.instructionLimit = 3000000
    assert h.call(h.arm(0x2008268), bag, 93, 50, 21) == 1
    h.functions[h.ov(0x21AD08C)] = lambda a: 0
    h.write(native + 0x224, struct.pack("<H", 328))
    h.write(native + 0x230, struct.pack("<H", 1))
    assert h.call("QaShopBalance", native) == 50
    h.call("QaShopPay", native, 1)
    assert h.call("QaShopBalance", native) == 49
    assert h.call("QaShopAdd", bag, 328, 1, 21) == 1
    assert h.call(h.arm(0x2008538), bag, 93, 21) == 49
    assert h.call(h.arm(0x2008538), bag, 328, 21) == 1
    assert h.word(trainer) == 10000
    before = bytes(h.uc.mem_read(bag, 0x9ec))
    h.call("QaShopPay", native, 1)
    assert h.call("QaShopAdd", bag, 328, 1, 21) == 0 # Owned TM.
    assert bytes(h.uc.mem_read(bag, 0x9ec)) == before
    h.write(native + 0x224, struct.pack("<H", 329))
    h.call("QaShopPay", native, 999)
    assert h.call("QaShopAdd", bag, 329, 1, 21) == 0
    assert bytes(h.uc.mem_read(bag, 0x9ec)) == before
    # Failure after payment removal restores the entire bag, including ordering.
    originalAdd = h.functions.get(h.arm(0x2008268))
    h.functions[h.arm(0x2008268)] = lambda a: 0
    h.call("QaShopPay", native, 2)
    assert h.call("QaShopAdd", bag, 329, 1, 21) == 0
    assert bytes(h.uc.mem_read(bag, 0x9ec)) == before
    h.functions.pop(h.arm(0x2008268))
    h.call("QaShopPay", native, 2)
    assert h.call("QaShopAdd", bag, 329, 1, 21) == 1
    assert h.call(h.arm(0x2008538), bag, 93, 21) == 47
    assert h.word(trainer) == 10000
    # Scoped per-item TM renderer/selection; ordinary NPC routes fall through.
    selections, labels, prices = [], [], []
    h.functions[h.ov(0x21AC110)] = lambda a: selections.append(h.byte(a[0] + 0x18a))
    h.functions[h.ov(0x21AC6A0)] = lambda a: labels.append(a[2])
    h.functions[h.arm(0x2026548)] = lambda a: native
    h.functions[h.ov(0x21AD510)] = lambda a: prices.append(0)
    h.functions[h.ov(0x21AD5A0)] = lambda a: prices.append(1)
    h.write(native + 0x188, struct.pack("<H", 2))
    for i, item in enumerate([17, 330]):
        h.write(native + 0x224, struct.pack("<H", item))
        h.write(native + 0x20 + 8 * i, struct.pack("<H", item))
        h.call("QaShopSelect", native)
        # Five-argument wrapper checked separately by emulator; the CPU ABI
        # utility supplies four register args only, with zeroed stack fifth.
        h.call("QaShopLabel", native, i, 0, item)
        h.call("QaShopRowPrice", 0, i, 0)
    assert selections == labels == prices == [0, 1]
    # The currency icon borrows the native item animation, owns one extra actor,
    # character and palette, and retains its queued source through destruction.
    wallet, unit = SUB + 0x15000, SUB + 0x15100
    h.put(native + 0x190, wallet); h.put(native + 0x1e4, unit); h.put(native + 0x21c, 3)
    h.write(wallet + 3, bytes([1, 3]))
    h.functions[h.ov(0x21ACEA4)] = lambda a: 0
    h.functions[h.ov(0x21ACEE0)] = lambda a: 0
    paletteDestinations = []
    def iconPalette(a):
        paletteDestinations.append((a[2], a[3]))
        return 3
    h.functions[h.arm(0x204BBE4)] = iconPalette
    sources, positions = [], []
    h.functions[h.arm(0x204BA6C)] = lambda a: sources.append(h.word(a[1] + 20))
    oldActor = h.functions[h.arm(0x204C06C)]
    def iconActor(a):
        positions.append(struct.unpack("<hh", h.uc.mem_read(h.word(h.uc.reg_read(UC_ARM_REG_SP)), 4)))
        return oldActor(a)
    h.functions[h.arm(0x204C06C)] = iconActor
    iconBaseline = dict(h.allocations)
    h.call("QaShopGraphics", native)
    assert positions == [(18, 32)] and len(sources) == 1 and sources[0] in h.allocations
    assert paletteDestinations == [(0, 64)] # Main OBJ bank 2, separate from the selected item.
    h.call("QaShopGraphicsEnd", native)
    assert h.allocations == iconBaseline
    for failure in range(1, 5):
        h.fail = h.attempts + failure
        h.call("QaShopGraphics", native)
        h.call("QaShopGraphicsEnd", native)
        assert h.allocations == iconBaseline
    h.fail = 0
    for p in owned: h.free(p)
    # Exit back to the same picker, alternating custom and ordinary shops.
    # Prices/payment state reset on each return; the parent owns no stale bank.
    h.functions[h.ov(0x21AC3B0)] = lambda a: 1
    for selection in [0, 1, 0, 1, 1, 0, 1]:
        assert h.call("QaShopTick", 0, native, 255, 0) == 1
        assert h.word(reopen) & 0xffff == 1
        h.put(menu + 16, 0) # Native menu initialization after previous cleanup.
        h.call("QaShopChoiceAdd", testVm, runtime)
        adoptedText = h.word(menu + 20)
        assert adoptedText in h.allocations
        h.free(adoptedText)
        h.put(choice, selection)
        h.call("QaShopBuyCommand", testVm, runtime)
        assert h.word(reopen) & 0xffff == 0
        if selection:
            assert h.call("QaShopPrice", 0) == 1
            assert h.call("QaShopBalance", native) == 47
    # An allocation failure while rebuilding the picker exits cleanly instead
    # of displaying an unrelated native text bank or retaining a locked field.
    h.fail = h.attempts + 1
    assert h.call("QaShopTick", 0, native, 255, 0) == 1
    assert h.word(reopen) & 0xffff == 0
    h.fail = 0
    finish(e, child)
    h.call("QaCGearExit", SUB)
    assert not h.allocations
    print(game, "System Shop picker/ownership, visibility/priority, allocation cleanup, native TM bag/payment rollback and mixed renderers passed")


# Condition filtering snapshots visible source indices so hidden rows never
# shift a different item's price onto a visible item. Execute actual badge and
# saved-flag readers from each game; native UI scheduling remains stubbed.
for game in ("W2", "B2"):
    h = Harness(game)
    h.heapFree = h.heapLargest = 0x80000
    h.shopArc = ndspy.narc.NARC((BUILD / "shop-fixture-conditions.narc").read_bytes())
    h.configure([(20, 20, 0, 0, 255, 60, 116, 0, 0)])
    h.call("QaCGearInit", SUB); h.call("QaCGearUpdate", SUB, 1)
    baseline = dict(h.allocations)
    del h.functions[h.arm(0x200c97c)] # Use the retail trainer badge bit reader.
    native, runtime, scriptState, choice, testVm, operands = [SUB+n for n in [0x10000,0x14000,0x14100,0x14200,0x14400,0x14480]]
    h.put(runtime+32, scriptState)
    menu = scriptState+0x34
    h.functions[h.ov(0x2153f60)] = lambda a: choice if a[1]==0x802a else choice+4
    h.functions[h.ov(0x21abbb0)] = lambda a: h.put(h.shopProcess+0x3c,native-8)
    h.functions[h.ov(0x21ac3b0)] = lambda a: 1
    calls=[]
    h.functions[h.ov(0x21a85bc)] = lambda a: calls.append(1) or 0
    for badges in range(9):
        h.put(GAME+4,(1<<badges)-1)
        for setFlag in (False,True):
            h.call(h.arm(0x2019204 if setFlag else 0x201922c),h.flagWork,42)
            flagsBefore=bytes(h.uc.mem_read(h.flagWork,0x800))
            h.press(60,116);event=h.call("QaCGearEvent",SUB,1);h.release()
            assert event and h.call(h.word(event+4),event,event+8)==0
            child=h.children[-1][1]
            expected=[i for i in range(20) if i%9<=badges and (i%3==2 or (i%3==0)==setFlag)]
            h.put(testVm+32,operands);h.write(operands,struct.pack("<3H",1,65535,1))
            before=len(calls);h.put(menu+16,0)
            h.call("QaShopChoiceAdd",testVm,runtime)
            assert len(calls)-before==int(bool(expected))
            assert h.word(testVm+32)==operands+(0 if expected else 6)
            h.free(h.word(menu+20));h.put(menu+16,0)
            h.put(choice,1);h.put(testVm+32,operands)
            h.call("QaShopBuyCommand",testVm,runtime)
            if not expected:
                assert h.word(testVm+32)==operands+4 and h.word(choice+4)==1
            else:
                stock=h.call("QaShopStockFile",0x11a,0,21);counts=h.call("QaShopStockFile",0x11b,0,21)
                assert list(struct.unpack("<"+str(len(expected))+"H",h.uc.mem_read(stock,len(expected)*2)))==[328+i for i in expected]
                assert h.uc.mem_read(counts,6)==bytes([len(expected)]*6)
                # A condition change after opening cannot change this session's
                # ordering/prices. It takes effect only on the next opening.
                h.call(h.arm(0x201922c if setFlag else 0x2019204),h.flagWork,42)
                assert [h.call("QaShopPrice",0) for _ in expected]==[i+1 for i in expected]
                h.call(h.arm(0x2019204 if setFlag else 0x201922c),h.flagWork,42)
                h.free(stock);h.free(counts)
                assert h.call("QaShopTick",0,native,255,0)==1
            assert bytes(h.uc.mem_read(h.flagWork,0x800))==flagsBefore
            h.eventDelete(child);assert h.call(h.word(event+4),event,event+8)==1;h.eventDelete(event)
            assert h.allocations==baseline
    h.call("QaCGearExit",SUB);assert not h.allocations
    print(game,"all 0–8 badge counts, set/clear conditions, combined requirements, stable price mapping, empty-shop omission and read-only flag checks passed")
