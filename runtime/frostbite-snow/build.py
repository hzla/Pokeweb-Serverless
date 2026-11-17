"""Build the two PMC templates and checked US battle-overlay profiles."""
import json
import struct
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE.parent / "item-expansion"))
from build import JAR, WORKSPACE, Symbols, tool  # noqa: E402
from build_bw1 import Inputs, bw1  # noqa: E402


def build_template(name, test):
    directory = HERE / "build"
    directory.mkdir(exist_ok=True)
    suffix = f"{name}-test" if test else name
    obj = directory / f"{suffix}.o"
    dll = directory / f"{suffix}.dll"
    dll.unlink(missing_ok=True)
    subprocess.run([tool("arm-none-eabi-gcc"), "-mthumb", "-mcpu=arm946e-s", "-Os", "-Wall", "-Wextra", "-Werror",
                    "-ffreestanding", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables", "-fvisibility=hidden",
                    f"-D{name.upper()}", "-fno-builtin", *(["-DCLIMATE_TEST"] if test else []), "-c", HERE / "runtime.c", "-o", obj], check=True)
    subprocess.run(["java", "-cp", JAR, "rpm.cli.RPMTool", "-i", obj, "--fourcc", "DLXF", "-o", dll,
                    "--generate-relocations"], check=True)
    output = directory / f"{suffix}.json"
    subprocess.run([ROOT / "node_modules/.bin/vite-node", HERE.parent / "ability-effects/describe.ts", dll, output], check=True)
    return json.loads(output.read_text())


def profiles_for(game, file, test):
    first = len(game) == 1
    source = Inputs(game) if first else None
    rom = source.binaries if source else bw1.RomBinaries(WORKSPACE / file)
    symbols = source.symbols if source else Symbols(game.lower() + "_us")
    overlay = "93" if first else "167"

    def function(bw1_name, bw2_name, module=overlay):
        name = bw1_name if first else bw2_name
        segment, (address, _, _, size) = symbols.resolve(name, (module,))
        assert segment == module and size
        return address, rom.read(segment, address, size)

    def site(native, start, end, edits, calls=(), mask_calls=(), expected=(), module=overlay):
        address, code = native
        witness = code[start:end]
        assert len(witness) == end - start
        mask = bytearray(b"\xff" * len(witness))
        targets = []
        for offset in set(call[1] for call in calls) | set(mask_calls):
            hi, lo = struct.unpack_from("<HH", code, offset)
            assert hi & 0xf800 == 0xf000 and lo & 0xf800 in (0xf800, 0xe800), (game, hex(address), hex(offset))
            mask[offset-start:offset-start+4] = b"\x00" * 4
        for api, offset in calls:
            hi, lo = struct.unpack_from("<HH", code, offset)
            delta = ((hi & 0x7ff) << 12) | ((lo & 0x7ff) << 1)
            if delta & 0x400000:
                delta -= 0x800000
            destination = address + offset + 4 + delta
            assert lo & 0xf800 == 0xf800
            # Also compare the target. A modified call into an unrelated
            # routine can match the caller's masked signature.
            target = rom.read(module, destination, 12)
            assert len(target) == 12
            targets.append({"api": api, "offset": offset-start, "hex": target.hex()})
        for offset, original in expected:
            assert code[offset:offset+len(bytes.fromhex(original))].hex() == original, (game, hex(address), hex(offset))
        def patch_edit(offset, edit):
            if edit.startswith("="):
                return dict(offset=offset-start, hex=edit[1:])
            if edit.startswith(">"):
                return dict(offset=offset-start, symbol=edit[1:], branch=True)
            return dict(offset=offset-start, symbol=edit)
        return dict(offset=address-rom.overlays[int(module)][0]+start, hex=witness.hex(), mask=mask.hex(),
                    edits=[patch_edit(offset, edit) for offset, edit in edits], calls=targets)

    defense = function("BTL_SERVER_FLOW_CalcDefenseStat", "ServerEvent_GetTargetDefenses")
    weather = function("BTL_CALC_GetWeatherDamage", "BtlCalc_GetWeatherDamage")
    snow = [
        site(defense, 0xb0, 0xe4, [(0xbe, "SnowDefenseSite")], [(0, 0xbe), (1, 0xca), (2, 0xdc), (3, 0xb4)],
             expected=[(0xb8, "0004070c0098"), (0xc2, "04280ed1")]),
        site(weather, 0, 0x4c, [(0x3a, "=002010bd")], expected=[(0x3a, "0e21")]),
    ]
    fail = function("BTL_SERVER_FLOW_CheckMoveExecuteFail", "ServerControl_CheckMoveFail")
    thaw = function("BTL_SERVER_FLOW_CheckFreezeThaw", "ServerControl_CheckThaw")
    damage = function("BTL_SERVER_FLOW_CalcMoveDamage", "ServerEvent_CalcDamage")
    residual = function("BTL_POKEPARAM_CalcSickDamage", "BattleMon_GetResidualDamage")
    message = function("BTL_SERVER_FLOW_ProcSickDamage", "ServerControl_ConditionDamage")
    failure_effect = function("BTL_SERVER_FLOW_ProcMoveExecuteFail", "ServerControl_MoveFail")
    burn = 0x150 if first else 0x15a
    damage_site = site(damage, burn-2, burn+0x2e, [(burn, "FrostbiteDamageSite"), (burn+4, "=10e0")],
                       [(0, burn+8), (1, burn+0x14)], mask_calls=[burn+0x22],
                       expected=[(burn, "0498012810d1"), (burn+0x28, "002c")])
    frostbite = [
        site(fail, 0x38, 0x56, [(0x46, "=05e0")], expected=[(0x46, "032804d1")]),
        site(thaw, 0x1e, 0x38, [(0x2a, "=04e0")], mask_calls=[0x1e], expected=[(0x2a, "1420")]),
        damage_site,
        site(residual, 0, 0x54, [(6, "FrostbiteResidualSite")], [(2, 6), (3, 0x48)], expected=[(0, "38b5041c0d1c")]),
        site(message, 0x7a, 0x9c, [(0x8e, "FrostbiteMessageSite")], [(4, 0x8e), (5, 0x7a)], mask_calls=[0x82]),
    ]
    assert struct.unpack_from("<I", failure_effect[1], 0xbc)[0] == 0x259
    standalone = [
        function("BTL_SERVER_FLOW_InitMsgRecord", "BattleHandler_StrSetup"),
        function("BTL_SERVER_FLOW_AppendMsgRecordArg", "BattleHandler_AddArg"),
        function("BTL_POKEPARAM_GetPokeId", "GetMonID"),
    ]
    helpers = [{"api": 6+i, "offset": address-rom.overlays[int(overlay)][0], "hex": code.hex()}
               for i, (address, code) in enumerate(standalone)]
    def binding(index, native, size=12):
        address, code = native
        return dict(api=index, offset=address-rom.overlays[int(overlay)][0], hex=code[:size].hex())

    speed = function("BTL_SERVER_FLOW_CalcPokeSpeed", "ServerEvent_CalculateSpeed")
    speed_ratio = 0x82 if first else 0x80
    confusion = function("BTL_SERVER_FLOW_CheckConfusionFail", "ServerControl_CheckConfusion")
    clear = function("BTL_POKEPARAM_ClearSickConts", "ClearMoveStatusWork")
    sleep = function("BTL_CALC_MakeDefaultSickCont", "BtlCalc_MakeStatusCondition")
    immunity = function("BTL_SERVER_FLOW_CheckSickImmunity", "AddConditionCheckFailOverwrite")
    secondary = function("BTL_SERVER_FLOW_RollMoveAddedSick", "ServerEvent_CheckMoveAddCondition")
    simple = function("BTL_SERVER_FLOW_ProcMoveSickAllTargets", "ServerControl_SimpleCondition")
    stat = function("BTL_SERVER_FLOW_ProcMoveRankAndSickAllTargets", "ServerControl_StatChangeAndCondition")
    fire_thaw = function("BTL_SERVER_FLOW_ThawTargetsHitByFireMove", "ServerControl_CheckFireThaw")
    modern = [
        site(speed, speed_ratio-6, speed_ratio+14, [(speed_ratio, "=3220")], mask_calls=[speed_ratio+6],
             expected=[(speed_ratio, "1920")]),
        site(fail, 0x196, 0x1aa, [(0x19e, "ModernFullParalysis")], mask_calls=[0x19e], expected=[(0x19c, "1920")]),
        site(confusion, 0x74, 0x82, [(0x74, "=2120")], mask_calls=[0x76], expected=[(0x74, "3220")]),
        site(residual, 0x5e, 0x6a, [(0x62, "=1021")], mask_calls=[0x64], expected=[(0x60, "201c0821")]),
        site(clear, 0, 0x34, [(0, ">ModernClearConditions")], mask_calls=[0x2e], expected=[(0, "70b50023002900d1")]),
        site(sleep, 0x2c, 0x46, [(0x36, "ModernSleepDuration")], mask_calls=[0x36], expected=[(0x30, "022004210443")]),
        site(secondary, 0x34, 0x48, [(0x44, "ModernSecondarySleepSite")], [(13, 0x44)]),
        site(simple, 0x56, 0x66, [(0x62, "ModernSimpleSleepSite")], [(13, 0x62)]),
        site(stat, 0x24, 0x34, [(0x30, "ModernStatSleepSite")], [(13, 0x30)]),
        site(immunity, 0x8a, 0xe4, [(0xe0, "ModernElectricTail")], [(14, 0x90), (15, 0x96)],
             mask_calls=[0xa8, 0xae, 0xc0, 0xd4], expected=[(0xe0, "002070bd")]),
    ]
    modern_freeze = [
        site(thaw, 0x22, 0x3a, [(0x2c, "ModernNaturalThawSite")], mask_calls=[0x2c], expected=[(0x2a, "1420")]),
        site(fire_thaw, 0, 0x32, [(4, "ModernScaldThawSite"), (0x2a, "ModernThawBlockedSite")],
             [(16, 0x2a)], mask_calls=[0x20], expected=[(4, "88791d1c0928")]),
    ]
    rng = function("BTL_CALC_Random", "BattleRandom")
    event_value = binding(11, function("BTL_EVENT_GetVar", "BattleEventVar_GetValue"))
    client = "94" if first else "168"
    sprites = function("BTLV_MCSS_Update", "BtlvMcss_Main", client)
    # In the Freeze gauge case, load mode 3 to clear only the persistent
    # freeze bit. The ice tint and the effect VM's temporary pauses are native.
    frostbite_sprite = site(sprites, 0x21e, 0x23a, [(0x22c, "=0322")],
                            expected=[(0x22c, "0222")], module=client)
    profile = dict(overlay=int(overlay), snow=snow, frostbite=frostbite, helpers=helpers,
                   modern=modern, modernFreeze=modern_freeze, damageSite=damage_site,
                   eventValue=event_value, battleRandom=binding(12, rng),
                   clientOverlay=int(client), frostbiteSprite=frostbite_sprite)
    if test:
        _, getter = function("BTLV_EFFECT_GetMcss", "BtlvEffect_GetMcss", client)
        assert getter[:12].hex() == "024801681920000108587047"
        profile["battleViewGlobal"] = struct.unpack_from("<I", getter, 12)[0]
    wake = function("BTL_SERVER_FLOW_TickSleepTurn", "ServerControl_CheckWakeUp")
    profile["modernProbes"] = [
        site(residual, 0x60, 0x6a, [(0x64, "ModernBurnProbe")], [(3, 0x64)]),
        site(wake, 0x12, 0x1c, [(0x14, "ModernSleepProbe")], [(17, 0x14)]),
        site(message, 0x26, 0x34, [(0x2c, "ModernIndirectDamageSite")], [(18, 0x2c)]),
        site(confusion, 0x74, 0x82, [(0x76, "ModernConfusionProbe")], mask_calls=[0x76]),
    ]
    return profile


if __name__ == "__main__":
    test = "--test" in sys.argv
    games = {game: profiles_for(game, file, test) for game, file in
             [("B", "cleanblack.nds"), ("W", "cleanwhite.nds"), ("B2", "cleanblack2.nds"), ("W2", "cleanwhite2.nds")]}
    data = {"games": games, "templates": {name: build_template(name, test) for name in ("frostbite", "snow", "modern_status")}}
    output = HERE / "build/test.json" if test else ROOT / "src/assets/codeinjection/frostbiteSnow.json"
    output.write_text(json.dumps(data, separators=(",", ":")) + "\n")
