"""Execute packaged Ruby/reference PMC modules in an ARM946 CPU model.

Apply the packaged module's relocations and both retail hook branches. The three
native game routines are instrumented stubs; no ROM, emulator or save is edited.
"""
import hashlib
import json
import random
import struct

from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import (
    UC_CPU_ARM_946, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2,
    UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7,
    UC_ARM_REG_R8, UC_ARM_REG_R9, UC_ARM_REG_R10, UC_ARM_REG_R11,
    UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC,
)

from build import BUILD, HERE, REPO, NATIVE, W2_ESDB, IMPORTS, PROFILE, audit, read_rpm
from rpm_read import thumb_bl

BASE = 0x02300000
STACK = 0x023f0000
POKEMON = 0x02200000
CALLEE_SAVED = [UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7,
                UC_ARM_REG_R8, UC_ARM_REG_R9, UC_ARM_REG_R10, UC_ARM_REG_R11]


def expect(target, records, initial_form):
    """Independent contract model, including native call order and fallback."""
    calls = []
    species, form = 25, initial_form

    def change(name, value):
        nonlocal species, form
        calls.append((name, POKEMON, value))
        if name == "PokeParty_ChangeForme":
            form = value
        else:
            species = value

    if target >= 650:
        for owner in range(1, 650):
            first, count = records.get(owner, (0, 1))
            calls.append(("PML_PersonalGetParamSingle", owner, 0, 0x20))
            if not 2 <= count <= 31:
                continue
            calls.append(("PML_PersonalGetParamSingle", owner, 0, 0x1e))
            if first == 0 or not first <= target < first + count - 1:
                continue
            change("PokeParty_ChangeForme", 0)
            change("setChangedPkmSpecies", owner)
            change("PokeParty_ChangeForme", target - first + 1)
            return calls, (species, form)
    change("setChangedPkmSpecies", target)
    return calls, (species, form)


def prepare(path, game):
    audit(path, game)
    rpm = read_rpm(path.read_bytes())
    code = bytearray(rpm["code"])
    hooks = {}
    for relocation in rpm["relocations"]:
        assert relocation["type"] == "THUMB_BRANCH_LINK", relocation
        symbol = rpm["symbols"][relocation["symbol"]]
        assert symbol["type"] == 3, symbol
        destination = symbol["address"] if symbol["attributes"] & 4 else BASE + symbol["address"]
        if relocation["module"] == "base":
            offset = relocation["address"]
            code[offset:offset + 4] = thumb_bl(BASE + offset, destination)
        else:
            assert relocation["module"] == "284"
            site = relocation["address"]
            hooks[site] = thumb_bl(site, destination)
    return bytes(code), hooks


def execute(prepared, game, site, target, records, initial_form):
    code, hooks = prepared
    uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
    uc.ctl_set_cpu_model(UC_CPU_ARM_946)
    uc.mem_map(0x02000000, 0x400000)
    uc.mem_write(BASE, code)
    uc.mem_write(site, hooks[site])
    uc.mem_write(POKEMON, struct.pack("<II", 25, initial_form))
    uc.reg_write(UC_ARM_REG_SP, STACK)
    uc.reg_write(UC_ARM_REG_LR, 0x02008001)
    uc.reg_write(UC_ARM_REG_R0, POKEMON)
    uc.reg_write(UC_ARM_REG_R1, target)
    for index, reg in enumerate(CALLEE_SAVED):
        uc.reg_write(reg, 0x11110000 + index)
    calls = []
    imports = {address & ~1: name for name, address in IMPORTS[game].items()}

    def intercept(emu, address, _size, _user):
        name = imports.get(address)
        if name is None:
            return
        arg0, arg1, arg2 = [emu.reg_read(reg) for reg in (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2)]
        if name == "PML_PersonalGetParamSingle":
            assert arg1 == 0 and arg2 in (0x1e, 0x20)
            first, count = records.get(arg0, (0, 1))
            value = first if arg2 == 0x1e else count
            calls.append((name, arg0, arg1, arg2))
        else:
            assert arg0 == POKEMON
            offset = 4 if name == "PokeParty_ChangeForme" else 0
            emu.mem_write(POKEMON + offset, struct.pack("<I", arg1))
            calls.append((name, arg0, arg1))
            value = 1
        emu.reg_write(UC_ARM_REG_R0, value)
        emu.reg_write(UC_ARM_REG_PC, emu.reg_read(UC_ARM_REG_LR))

    uc.hook_add(UC_HOOK_CODE, intercept)
    uc.emu_start(site | 1, site + 4, count=100000)
    assert uc.reg_read(UC_ARM_REG_PC) == site + 4, "hook did not return within instruction budget"
    assert uc.reg_read(UC_ARM_REG_SP) == STACK, "stack was not restored"
    for index, reg in enumerate(CALLEE_SAVED):
        assert uc.reg_read(reg) == 0x11110000 + index, "callee-saved register was clobbered"
    state = struct.unpack("<II", bytes(uc.mem_read(POKEMON, 8)))
    return calls, state


def cases():
    result = []

    def add(name, target, records, owner, form):
        result.append((name, target, records, owner, form))

    for target in (0, 1, 25, 649):
        add(f"ordinary-{target}", target, {386: (650, 4)}, target, None)
    for target in (650, 651, 652):
        add(f"form-{target}", target, {386: (650, 4)}, 386, target - 649)
    add("past-form-range", 653, {386: (650, 4)}, 653, None)
    add("first-species", 650, {1: (650, 2)}, 1, 1)
    add("last-species", 650, {649: (650, 2)}, 649, 1)
    for target in (999, 1000, 1029, 1030):
        resolved = 1000 <= target <= 1029
        add(f"maximum-form-count-{target}", target, {649: (1000, 31)}, 649 if resolved else target,
            target - 999 if resolved else None)
    for count in (0, 1, 32, 0xffffffff):
        add(f"invalid-count-{count}", 650, {1: (650, count)}, 650, None)
    add("zero-form-offset", 650, {1: (0, 2)}, 650, None)
    add("below-form-range", 650, {1: (651, 2)}, 650, None)
    add("huge-form-offset", 65535, {1: (0xffffffff, 31)}, 65535, None)
    add("last-u16-target", 65535, {649: (65534, 3)}, 649, 2)
    add("unknown-target", 65535, {}, 65535, None)
    add("first-overlap-wins", 701, {25: (700, 3), 386: (700, 4)}, 25, 2)
    add("skip-invalid-owner", 650, {1: (650, 32), 649: (650, 2)}, 649, 1)
    rng = random.Random(20261010)
    for index in range(24):
        owner, first, count = rng.randint(1, 649), rng.randint(650, 60000), rng.randint(2, 31)
        offset = rng.randint(0, count - 2)
        add(f"generated-range-{index}", first + offset, {owner: (first, count)}, owner, offset + 1)
    return result


def main():
    (BUILD / "verification.json").unlink(missing_ok=True)
    receipt = json.loads((BUILD / "build-report.json").read_text())
    inputs = [HERE / name for name in ("form_evolution.rb", "form_evolution.json", "compiler.rb", "build.py")]
    inputs += [NATIVE / name for name in ("form_evolution.cpp", "symbols_b2.yml", "metadata_b2.yml", "metadata_w2.yml")]
    inputs.append(W2_ESDB)
    for path in inputs:
        assert receipt["inputSha256"][path.name] == hashlib.sha256(path.read_bytes()).hexdigest(), f"rebuild required: {path.name} changed"
    report, count = {}, 0
    source_hash = hashlib.sha256((HERE / "form_evolution.rb").read_bytes()).hexdigest()
    for game in ("B2", "W2"):
        paths = {kind: BUILD / kind / f"FormEvolution{game}.dll" for kind in ("ruby", "reference")}
        for kind, path in paths.items():
            assert receipt["games"][game][kind]["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest(), "rebuild required: module changed"
        shipped = REPO / "src/assets/codeinjection" / f"FormEvolution{game}.dll"
        assert paths["reference"].read_bytes() == shipped.read_bytes(), "native rebuild differs from shipped baseline"
        prepared = {kind: prepare(path, game) for kind, path in paths.items()}
        game_count = 0
        for name, target, records, owner, resolved_form in cases():
            for initial_form in (0, 2):
                expected = expect(target, records, initial_form)
                assert expected[1] == (owner, initial_form if resolved_form is None else resolved_form), name
                for site in prepared["ruby"][1]:
                    outcomes = {kind: execute(module, game, site, target, records, initial_form)
                                for kind, module in prepared.items()}
                    assert outcomes["ruby"] == outcomes["reference"] == expected, (game, name, initial_form, hex(site))
                    game_count += 1
        count += game_count
        report[game] = {"comparisons": game_count, "ruby": audit(paths["ruby"], game),
                        "reference": audit(paths["reference"], game), "referenceMatchesShipped": True,
                        "nativeCallTracesMatch": True, "registersAndStackPreserved": True}
        print(f"{game}: {game_count} packaged ARM946 comparisons passed across both hooks")
    result = {"sourceSha256": source_hash, "comparisons": count, "games": report,
              "limitations": ["Native game APIs were stubbed.", "No in-game emulator or hardware acceptance run was performed."]}
    (BUILD / "verification.json").write_text(json.dumps(result, indent=2) + "\n")
    print(f"Passed {count} comparisons; report: runtime/ruby-patches/build/verification.json")


if __name__ == "__main__":
    main()
