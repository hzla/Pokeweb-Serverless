"""Focused singles move-handler regressions using native headless battles."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid

spec = importlib.util.spec_from_file_location("battle_shared", Path(__file__).with_name("test-battle-interactions.py"))
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
check, read_mon, ROOT = shared.check, shared.read_mon, shared.ROOT


def select_variants(manifest, names):
    if not names:
        return manifest["variants"]
    available = {variant["name"] for variant in manifest["variants"]}
    check(len(names) == len(set(names)), "Duplicate variant filter")
    check(set(names) <= available, "Unknown variant filter")
    return [variant for variant in manifest["variants"] if variant["name"] in names]


def state(emu, pointer):
    return {**read_mon(emu, pointer), "substituteHp": emu.memory.read_short(pointer + 0x1f2),
            "currentSpecies": emu.memory.read_short(pointer + (0xec if emu.memory.read_byte(pointer + 27) & 0x20 else 12)),
            "form": emu.memory.read_byte(pointer + 0x141),
            "transformed": bool(emu.memory.read_byte(pointer + 27) & 0x20),
            "moveId": emu.memory.read_short(pointer + 0x10a), "pp": emu.memory.read_byte(pointer + 0x10c),
            "previousMove": emu.memory.read_short(pointer + 0x14a),
            "previousMoveId": emu.memory.read_short(pointer + 0x14c),
            "statStages": [emu.memory.read_byte(pointer + 0xfc + i) for i in range(7)],
            "conditions": [emu.memory.read_long(pointer + 28 + 4 * i) for i in range(7)],
            "itemBlockedCondition": emu.memory.read_long(pointer + 28 + 4 * 19),
            "gastroAcidCondition": emu.memory.read_long(pointer + 28 + 4 * 16),
            "conditionFlags": emu.memory.read_byte(pointer + 0x155) | (emu.memory.read_byte(pointer + 0x156) << 8),
            # Native surface moves are active; truth moves retain original PP
            # when Transform/Mimic unlinks them. Observe both without writes.
            "moves": [{"id": emu.memory.read_short(pointer + 0x10a + 14 * i),
                       "pp": emu.memory.read_byte(pointer + 0x10c + 14 * i)} for i in range(4)],
            "originalMoves": [{"id": emu.memory.read_short(pointer + 0x104 + 14 * i),
                               "pp": emu.memory.read_byte(pointer + 0x106 + 14 * i)} for i in range(4)],
            "turnFlags": emu.memory.read_byte(pointer + 0x153) | (emu.memory.read_byte(pointer + 0x154) << 8)}


def verify_storm(case, result, variant):
    summary = verify_power(case, result, variant)
    check(case["expectedWeather"] in result["weatherReads"], "Required effective weather was not observed")
    rolls = result["accuracyRolls"]
    check(len(rolls) == case["expectedAccuracyRolls"], "Wrong number of native accuracy rolls")
    for roll in rolls:
        check(roll["threshold"] == case["expectedAccuracy"], "Wrong native accuracy threshold")
        check(roll["draw"] == case["accuracyRoll"], "Accuracy draw was not controlled independently of secondary effects")
    if case.get("expectedFly"):
        check(result["after"]["defender"]["conditionFlags"] & 8, "Target did not establish native Fly semi-invulnerability")
        check(result["after"]["defender"]["previousMoveId"] == 19, "Target did not use Fly")
    if "accuracyStage" in case:
        check(result["before"]["attacker"]["statStages"][5] == case["accuracyStage"], "Wrong user accuracy fixture stage")
    if "evasionStage" in case:
        check(result["before"]["defender"]["statStages"][6] == case["evasionStage"], "Wrong target evasion fixture stage")
    return {**summary, "accuracyRolls": len(rolls), "effectiveWeather": case["expectedWeather"]}


def verify_hydro_steam(case, result, variant):
    summary = verify_power(case, result, variant)
    check(case["expectedWeather"] in result["weatherReads"], "Required effective weather was not observed")
    for calculation in result["damageCalls"]:
        check(calculation.get("damageWeather") == case["expectedDamageWeather"], "Wrong weather at the native damage multiplier")
    return {**summary, "effectiveWeather": case["expectedWeather"], "weatherRatio": case["weatherRatio"]}


def verify_terrain_pulse(case, result, variant):
    summary = verify_power(case, result, variant)
    if "requiredOpponentMove" in case:
        check(result["after"]["defender"]["previousMoveId"] == case["requiredOpponentMove"],
              "Native opponent did not establish the required type conversion")
    if "expectedUserTypes" in case:
        for call in result["damageCalls"]:
            check(call["attacker"]["types"] == case["expectedUserTypes"],
                  "Protean did not receive the resolved Terrain Pulse type")
    return summary


def verify_supercell_slam(case, result, variant):
    summary = verify_power(case, result, variant)
    check(len(result["accuracyRolls"]) == case["expectedAccuracyRolls"], "Wrong number of native accuracy rolls")
    for roll in result["accuracyRolls"]:
        check(roll["threshold"] == case["expectedAccuracy"] and roll["draw"] == case["accuracyRoll"], "Wrong ordinary accuracy control")
    for calculation in result["damageCalls"]:
        check(bool(calculation["defender"]["conditionFlags"] & 0x100) == case["expectedMinimized"], "Target did not establish native Minimize")
    return {**summary, "accuracyRolls": len(result["accuracyRolls"])}


def verify_ruination(case, result):
    verify_completed(result, 877)
    before, after = result["before"]["defender"], result["after"]["defender"]
    if case.get("substitute"):
        check(result["damageCalls"], "No Ruination damage calculation against Substitute")
        defended = result["damageCalls"][0]["defender"]
        check(defended["substituteHp"] > 0, "Substitute was not established before Ruination")
        check(after["hp"] == defended["hp"], "Ruination bypassed Substitute")
        check(after["substituteHp"] == max(0, defended["substituteHp"] - max(1, defended["hp"] // 2)), "Wrong Substitute damage")
    elif case.get("blocked"):
        check(after["hp"] == before["hp"], "Blocked Ruination damaged its target")
        if case.get("forceMiss"):
            check(result["rngOverrides"] > 0, "Accuracy-miss RNG was never exercised")
    else:
        expected = max(1, before["hp"] // 2)
        check(before["hp"] - after["hp"] == expected,
              f"Ruination HP loss {before['hp'] - after['hp']}, expected {expected} from current HP {before['hp']}")
    return summarize(case, before, after)


def verify_completed(result, move_id, pp_spent=1):
    check(result.get("finished"), "Move attempt never completed")
    slot = result.get("selectedMoveSlot", 0)
    before, after = result["before"]["attacker"], result["after"]["attacker"]
    selected = before["moves"][slot] if "moves" in before else {"id": before["moveId"], "pp": before["pp"]}
    remaining = after["moves"][slot]["pp"] if "moves" in after else after["pp"]
    check(selected["id"] == move_id, "Wrong move in selected slot")
    completed = result.get("completion", result["after"]["attacker"])
    check(completed["turnFlags"] & (1 << 1), "Native action-complete flag is missing")
    check(result["after"]["attacker"]["previousMoveId"] == move_id, "Wrong completed move")
    check(remaining == selected["pp"] - pp_spent,
          f"Move did not consume exactly {pp_spent} PP")


def summarize(case, before, after):
    return {"case": case["id"], "passed": True, "hpBefore": before["hp"], "hpAfter": after["hp"],
            "hpLoss": before["hp"] - after["hp"], "substituteHpAfter": after["substituteHp"]}


def verify_power(case, result, variant):
    verify_completed(result, variant["moveId"], case.get("ppSpent", len(case.get("expectedPowers", [variant["power"]]))))
    if case.get("blocked"):
        before, after = result["before"]["defender"], result["after"]["defender"]
        check(before["hp"] == after["hp"], "Immune target took damage")
        check(not result["damageCalls"], "Immune target entered damage calculation")
        return summarize(case, before, after)
    calls = result["damageCalls"]
    expected_powers = case.get("expectedPowers")
    if case.get("powerRule") == "target-hp":
        expected_powers = [max(1, min(100, 100 * calculation["defender"]["hp"] // calculation["defender"]["maxHp"])) for calculation in calls]
    check(expected_powers is not None, "Missing power oracle")
    check(len(calls) == len(expected_powers), "Wrong number of native move executions")
    effective_powers = case.get("effectivePowers", expected_powers)
    expected_acted = case.get("expectedActed")
    expected_hp, expected_sub = calls[0]["defender"]["hp"], calls[0]["defender"]["substituteHp"]
    disguise_cost = max(1, result["before"]["defender"]["maxHp"] // 8) if case.get("expectedDisguise") else 0
    for index, (calculation, power) in enumerate(zip(calls, effective_powers)):
        attacker, target = calculation["attacker"], calculation["defender"]
        check(target["hp"] == expected_hp and target["substituteHp"] == expected_sub,
              "Repeated execution did not observe previously applied damage or Substitute damage")
        check(calculation["category"] == variant["category"], "Wrong native move category")
        if "expectedMoveType" in case:
            check(calculation["moveType"] == case["expectedMoveType"], "Wrong native resolved move type")
        check(calculation["critical"] == case.get("expectedCritical", 0), "Wrong critical-hit result")
        if variant["moveId"] == 803:
            check(attacker["stats"][4] < target["stats"][4], "Priority fixture must have a slower user")
        if expected_acted is not None:
            check(bool(target["turnFlags"] & 2) == expected_acted[index], "Native target action state did not match the case")
        if case.get("expectedStatus"):
            check(target["conditions"][case["expectedStatus"]] & 7, "Native setup did not establish the requested target status")
        stat_index = 0 if variant["category"] == 1 else 2
        defense_index = 1 if variant["category"] == 1 else 3
        attack_value = attacker["stats"][stat_index]
        if "expectedAttackValue" in case:
            check(calculation.get("attackValue") == case["expectedAttackValue"], "Wrong raw/staged/modified Body Press attacking value")
            attack_value = case["expectedAttackValue"]
        expected_damage = ((2 * attacker["level"] // 5 + 2) * power * attack_value // target["stats"][defense_index]) // 50 + 2
        # Native weather rounds before critical/random/STAB, not power or
        # final damage. A .5 tie rounds down at each fixed-ratio stage.
        expected_damage = (expected_damage * case.get("weatherRatio", 4096) + 2047) >> 12
        if case.get("expectedCritical"):
            expected_damage *= 2
        expected_damage = expected_damage * 85 // 100
        if case.get("expectedMoveType", variant.get("type")) in attacker.get("types", []):
            expected_damage = (expected_damage * 6144 + 2047) >> 12
        expected_damage = expected_damage * case.get("typeRatio", 4096) // 4096
        if case.get("burnRatio"):
            check(attacker["conditions"][4] & 7, "Native Flame Orb did not burn the attacker")
            expected_damage = (expected_damage * case["burnRatio"] + 2047) >> 12
        check(calculation["preModifierDamage"] == expected_damage,
              f"Native pre-modifier damage {calculation['preModifierDamage']}, expected {expected_damage} from power {power}")
        if expected_powers[index] != variant["power"]:
            check(expected_powers[index] in calculation["powerRewrites"], "Expected custom power rewrite was not executed")
        else:
            check(all(value in (variant["power"], power) for value in calculation["powerRewrites"]), "Unexpected custom power boost")
        if "damageRatios" in case:
            expected_ratio = case["damageRatios"][index]
            check(calculation["damageRatio"] == expected_ratio, "Wrong final native damage modifier")
            expected_final = 0 if disguise_cost and index == 0 else max(1, (expected_damage * expected_ratio + 2047) >> 12)
            check(calculation["calculatedDamage"] == expected_final,
                  "Wrong final native damage rounding")
        if "powerRolls" in case:
            check(calculation["powerRolls"] == case["powerRolls"][index], "Power chance rerolled within the action, or was not rolled for a new action")
        for side, expected in case.get("expectedFloating", {}).items():
            observed = [check_["floating"] for check_ in calculation.get("floatingChecks", []) if check_["side"] == side]
            check(observed and all(value == expected for value in observed), "Wrong or unobserved native floating state")
        for side, expected in case.get("executionItems", {}).items():
            check(calculation[side]["item"] == expected, "Wrong held item at damage execution")
        if expected_sub and not case.get("bypassSubstitute"):
            expected_sub = max(0, expected_sub - calculation["calculatedDamage"])
        else:
            expected_hp = max(0, expected_hp - calculation["calculatedDamage"])
        if disguise_cost and index == 0:
            expected_hp = max(0, expected_hp - disguise_cost)
    before, after = calls[0]["defender"], result["after"]["defender"]
    total = sum(call["calculatedDamage"] for call in calls) + disguise_cost
    if case.get("substitute"):
        check(before["substituteHp"] > 0 and before["hp"] < result["before"]["defender"]["hp"],
              "Native target did not reduce its HP to establish Substitute before the attack")
        check(after["hp"] == expected_hp, "Attack incorrectly bypassed Substitute or spilled damage through its break")
        check(after["substituteHp"] == expected_sub, "Wrong Substitute damage")
    else:
        applied = min(before["hp"], total) if case.get("allowFaint") else total
        check(before["hp"] - after["hp"] == applied > 0, "Native damage does not match actual HP loss")
        check(case.get("allowFaint") or after["hp"] > 0, "Damage capped by fainting")
    if "expectPoison" in case:
        check(bool(after["conditions"][5] & 7) == case["expectPoison"], "Wrong poison secondary result")
    if "expectedDefenseStage" in case:
        check(after["statStages"][1] == case["expectedDefenseStage"], "Wrong native Defense-stage secondary")
    if case.get("expectedAirborne"):
        check(all(calls[0][side]["item"] == 541 for side in ("attacker", "defender")), "Both battlers must hold intact Air Balloons at damage execution")
    if "expectedUserItem" in case:
        check(calls[0]["attacker"]["item"] == case["expectedUserItem"], "Wrong user held item at execution")
    check(result["rngOverrides"] > 0, "Controlled native RNG was never exercised")
    return {**summarize(case, before, after), "effectivePowers": effective_powers,
            "defenderSpecies": before["species"], "nativeExecutions": len(calls)}


def verify_aura_wheel(case, result, variant):
    summary = verify_power(case, result, variant)
    before, after = result["before"]["attacker"], result["after"]["attacker"]
    expected_species = case.get("expectedCurrentSpecies", variant["playerSpecies"])
    expected_form = case.get("expectedForm", variant["playerForm"])
    check(before["species"] == variant["playerSpecies"], "Original species changed during Transform")
    check(before["currentSpecies"] == expected_species and before["form"] == expected_form,
          "Wrong native current species/form precondition")
    check(before["transformed"] == case.get("transformed", False), "Native Transform was not established")
    if case.get("transformed"):
        check(result.get("setup") and result["setup"][0]["after"]["attacker"]["previousMoveId"] == 144,
              "Transform case did not execute the native move")
        check(before["pp"] == 5 and after["pp"] == 4, "Wrong copied-move PP after native Transform")
        check(before["originalMoves"][0] == after["originalMoves"][0] == {"id": 783, "pp": 10},
              "Copied move consumed original PP rather than active surface PP")
    stages = before["statStages"].copy()
    if not case.get("blocked"):
        stages[4] = min(12, stages[4] + 1)
    check(after["statStages"] == stages, "Wrong Aura Wheel user stat changes")
    if "expectedUserTypes" in case:
        check(result["damageCalls"][0]["attacker"]["types"] == case["expectedUserTypes"],
              "Protean did not use Aura Wheel's resolved type")
    if "requiredOpponentMove" in case:
        target = result["damageCalls"][0]["defender"] if result["damageCalls"] else result["after"]["defender"]
        check(target["previousMoveId"] == case["requiredOpponentMove"] and target["turnFlags"] & 2,
              "Required opponent setup did not execute before Aura Wheel")
    if case.get("forceMiss"):
        check(result["accuracyRolls"] and all(roll["draw"] == 99 and 0 < roll["threshold"] < 100
                                              for roll in result["accuracyRolls"]),
              "Aura Wheel miss did not exercise native reduced accuracy")
    return {**summary, "currentSpecies": expected_species, "form": expected_form,
            "userStages": after["statStages"], "resolvedType": case.get("expectedMoveType")}


def verify_scale_shot(case, result, variant):
    summary = verify_power(case, result, variant)
    stages = result["before"]["attacker"]["statStages"]
    check(stages == case.get("userStages", [6] * 7), "Wrong Scale Shot initial stat stages")
    for calculation in result["damageCalls"]:
        check(calculation["attacker"]["statStages"] == stages, "Scale Shot changed user stats before the last strike")
    check(result["after"]["attacker"]["statStages"] == case["expectedUserStages"],
          "Wrong once-per-sequence Scale Shot stat changes")
    if case.get("forceMiss"):
        check(result["accuracyRolls"] and all(roll["draw"] == 99 and roll["threshold"] == 90 for roll in result["accuracyRolls"]),
              "Scale Shot miss did not exercise native 90% accuracy")
    return {**summary, "userStages": result["after"]["attacker"]["statStages"]}


def verify_triple_axel(case, result, variant):
    summary = verify_power(case, result, variant)
    rolls = result["accuracyRolls"]
    check(len(rolls) == len(case["accuracyDraws"]), "Wrong number of Triple Axel accuracy checks")
    for roll, draw in zip(rolls, case["accuracyDraws"]):
        check(roll["threshold"] == 90 and roll["draw"] == draw,
              "Triple Axel did not exercise native per-strike accuracy")
    before, after = result["before"], result["after"]
    calls = result["damageCalls"]
    if "contactCostDivisor" in case:
        hp = before["attacker"]["hp"]
        cost = max(1, before["attacker"]["maxHp"] // case["contactCostDivisor"])
        for calculation in calls:
            check(calculation["attacker"]["hp"] == hp, "Contact reaction was not applied between strikes")
            hp = max(0, hp - cost)
        check(after["attacker"]["hp"] == hp, "Wrong per-strike contact damage")
    if case.get("expectedDisguise"):
        check(before["defender"]["species"] == 778 and before["defender"]["form"] == 0 and
              after["defender"]["form"] == 1, "Native Disguise was not busted by the first strike")
        cost = max(1, before["defender"]["maxHp"] // 8)
        check(len(calls) == 3 and calls[0]["defender"]["form"] == 0 and calls[0]["calculatedDamage"] == 0 and
              calls[1]["defender"]["form"] == 1 and calls[1]["defender"]["hp"] == before["defender"]["hp"] - cost,
              "Disguise did not absorb the first strike with exactly one native HP cost")
    if "expectedDefenderForm" in case:
        check(after["defender"]["form"] == case["expectedDefenderForm"], "Wrong completed Disguise form")
    if "disguiseSetupMove" in case:
        setup = result["setup"][0]
        target = setup["before"]["defender"]
        check(setup["after"]["attacker"]["previousMoveId"] == case["disguiseSetupMove"] and
              target["form"] == 0 and setup["after"]["defender"]["form"] == 1 and
              setup["after"]["defender"]["hp"] == target["hp"] - max(1, target["maxHp"] // 8),
              "Native setup did not preserve Disguise's single/fixed-damage absorption")
    if "followup" in case:
        summary["followup"] = verify_triple_axel(case["followup"]["case"], result["followup"], variant)
    return {**summary, "accuracyChecks": len(rolls)}


def verify_maximum_hp_cost(case, result, variant):
    summary = verify_power(case, result, variant)
    before, after = result["before"]["attacker"], result["after"]["attacker"]
    check("paysHpCost" in case, "Missing explicit maximum-HP cost oracle")
    if "expectedMaxHpParity" in case:
        check(before["maxHp"] % 2 == case["expectedMaxHpParity"], "Wrong even/odd maximum-HP fixture")
    cost = (before["maxHp"] + 1) // 2 if case["paysHpCost"] else 0
    check(after["hp"] == max(0, before["hp"] - cost), "Wrong once-per-action maximum-HP cost")
    check(after["statStages"] == before["statStages"], "HP cost unexpectedly changed the user's stats")
    if case.get("expectedUserAbilitySuppressed"):
        check(result["damageCalls"] and all(c["attacker"]["gastroAcidCondition"] & 7 for c in result["damageCalls"]),
              "Native Gastro Acid did not suppress the user's ability before damage")
    for roll in result["accuracyRolls"]:
        check(roll["threshold"] == 95 and roll["draw"] == case.get("accuracyRoll", 0),
              "Wrong independently controlled accuracy boundary")
    if "expectedAccuracyRolls" in case:
        check(len(result["accuracyRolls"]) == case["expectedAccuracyRolls"], "Accuracy miss/protection precondition was not exercised")
    if "followup" in case:
        summary["followup"] = verify_maximum_hp_cost(case["followup"]["case"], result["followup"], variant)
    return {**summary, "userHpLoss": before["hp"] - after["hp"], "maximumHpCost": cost}


def verify_dire_claw(case, result, variant):
    summary = verify_power(case, result, variant)
    conditions = result["after"]["defender"]["conditions"]
    active = [index for index in range(1, 6) if conditions[index] & 7]
    check(active == ([case["statusAfter"]] if case["statusAfter"] else []), "Wrong Dire Claw secondary status")
    rolls = result["statusRng"]
    chances = [roll for roll in rolls if roll["bound"] == 100]
    choices = [roll for roll in rolls if roll["bound"] == 3]
    check(len(chances) == case["chanceRolls"], "Wrong Dire Claw activation-roll count")
    check(all(roll["draw"] == case.get("secondaryRoll", 99) for roll in chances), "Wrong Dire Claw activation draw")
    check(len(choices) == case["choiceRolls"] + case.get("sleepDurationRolls", 0), "Dire Claw rerolled a status or missed its uniform choice")
    if case["choiceRolls"]:
        check(choices[0]["draw"] == case.get("statusChoice", 2), "Wrong Dire Claw uniform status draw")
        if chances:
            check(rolls[0]["bound"] == 100, "Dire Claw chose a status before checking activation")
    return {**summary, "statusAfter": case["statusAfter"], "statusRng": rolls}


def active_status(mon):
    return [index for index in range(1, 6) if mon["conditions"][index] & 7]


def read_event_var(emu, key):
    # Signature-validated native US GetValue layout, including its current
    # scope start, zero-key sentinel and 96-entry limit. Read-only observation.
    base, limit = 0x021db3f0, 96
    start = emu.memory.read_long(base)
    check(0 <= start <= limit, "Invalid native event scope")
    for index in range(start, limit):
        actual = emu.memory.read_short(base + 4 + 2 * index)
        if actual == key:
            return emu.memory.read_long(base + 0xc4 + 4 * index)
        if actual == 0:
            break
    return 0


def verify_take_heart(case, result, variant):
    verify_completed(result, 850)
    check(not result["damageCalls"], "Take Heart entered damage calculation")
    before, after = result["before"], result["after"]
    check(before["attacker"]["statStages"] == case.get("userStages", [6] * 7), "Wrong Take Heart initial user stages")
    check(before["defender"]["statStages"] == case.get("defenderStages", [6] * 7), "Wrong Take Heart initial defender stages")
    check(after["attacker"]["statStages"] == case["expectedUserStages"], "Wrong Take Heart user stat changes")
    check(after["defender"]["statStages"] == case.get("expectedDefenderStages", [6] * 7), "Wrong Take Heart defender stat changes")
    for side, key in (("attacker", "userStatusBefore"), ("defender", "defenderStatusBefore")):
        expected = [case[key]] if case.get(key) else []
        check(active_status(before[side]) == expected, "Native setup did not establish the required Take Heart status")
        cured = (side == "defender") if case.get("snatched") else (side == "attacker")
        check(active_status(after[side]) == ([] if cured else expected), "Take Heart cured the wrong battler or missed its cure")
    events = result["takeHeartEvents"]
    check(len(events) == 1, "Take Heart did not execute exactly once")
    check(events[0]["used"], "Take Heart did not execute native effect work")
    check(events[0]["success"] == case["takeHeartSuccess"], "Wrong native combined Take Heart success/failure result")
    executing = "defender" if case.get("snatched") else "attacker"
    check(events[0]["executingSlot"] == before[executing]["slot"], "Take Heart executed for the wrong owner")
    check(events[0]["after"][executing]["statStages"] == after[executing]["statStages"], "Take Heart effect checkpoint disagrees with completed action")
    check(active_status(events[0]["after"][executing]) == [], "Take Heart left the executing user's major status active")
    if case.get("snatched"):
        check(after["defender"]["previousMoveId"] == 289, "Opponent never used native Snatch")
    if case["id"] == "own-substitute-does-not-block":
        check(before["attacker"]["substituteHp"] > 0 and after["attacker"]["substituteHp"] == before["attacker"]["substituteHp"], "User Substitute was not established/preserved")
    if "followup" in case:
        verify_take_heart(case["followup"]["case"], result["followup"], variant)
    return {"case": case["id"], "passed": True, "nativeSuccess": events[0]["success"],
            "userStages": after["attacker"]["statStages"], "defenderStages": after["defender"]["statStages"],
            "userStatus": active_status(after["attacker"]), "defenderStatus": active_status(after["defender"])}


def verify_tidy_up(case, result, variant):
    verify_completed(result, 882)
    check(not result["damageCalls"], "Tidy Up incorrectly calculated damage")
    before, after = result["before"], result["after"]
    check(after["attacker"]["statStages"] == case["expectedUserStages"], "Wrong Tidy Up user boosts")
    check(after["defender"]["statStages"] == before["defender"]["statStages"], "Tidy Up changed the opponent's stages")
    events = result["takeHeartEvents"]
    check(len(events) == 1 and events[0]["used"] and events[0]["success"] == case["nativeSuccess"], "Wrong native Tidy Up work/result")
    check(events[0]["executingSlot"] == before["attacker"]["slot"], "Tidy Up was incorrectly stolen")
    for side, key in (("attacker", "userSubstitute"), ("defender", "defenderSubstitute")):
        if case.get(key):
            check(before[side]["substituteHp"] > 0, "Required native Substitute was never established")
        check(after[side]["substituteHp"] == 0, "Tidy Up left an active Substitute")
        check(after[side]["hp"] == before[side]["hp"], "Tidy Up directly changed battler HP")
    for side in range(2):
        for index, effect in enumerate(("6", "7", "8")):
            if "initialHazards" in case:
                check(result["beforeSideEffects"][side][effect]["layers"] == case["initialHazards"][side][index], "Native hazard precondition not established")
            check(result["afterSideEffects"][side][effect]["layers"] == 0, "Tidy Up left a native hazard")
        if case.get("screensRemain"):
            check(result["beforeSideEffects"][side]["0"]["layers"] > 0 and result["afterSideEffects"][side]["0"]["layers"] > 0, "Tidy Up removed or never established Reflect")
    if "followup" in case:
        next_ = case["followup"]
        if next_["moveId"] == 564:
            verify_completed(result["followup"], 564)
            events = result["followup"]["takeHeartEvents"]
            check(len(events) == 1 and events[0]["success"], "Sticky Web was not cleared: native reapplication failed")
        else:
            verify_power(next_["case"], result["followup"], {**variant, **{key: next_[key] for key in ("moveId", "power", "category", "type")}})
    return {"case": case["id"], "passed": True, "nativeSuccess": case["nativeSuccess"]}


def verify_hp_cost_boost(case, result, variant):
    if case.get("selectionRejected"):
        check(result.get("finished") and result.get("selectionRejected"), "Sound move selection was not rejected")
        checks = result["selectionChecks"]
        check(checks and all(c["moveId"] == variant["moveId"] and c["result"] == 1 for c in checks), "Wrong native selection rejection")
        for key in ("pp", "previousMoveId", "turnFlags"):
            check(result["before"]["attacker"][key] == result["after"]["attacker"][key], "Rejected selection advanced the native action")
    else:
        verify_completed(result, variant["moveId"])
    check(not result["damageCalls"], "HP boost entered attack damage calculation")
    before, after = result["before"], result["after"]
    executing = "defender" if case.get("snatched") else "attacker"
    other = "attacker" if executing == "defender" else "defender"
    success = case["hpBoostSuccess"]
    events = result["takeHeartEvents"]
    check(len(events) == case.get("hpBoostEvents", 1), "Wrong HP boost effect count")
    if events:
        event = events[0]
        check(event["executingSlot"] == before[executing]["slot"], "HP boost used the wrong executing owner")
        check(event["used"] == success and event["success"] == success, "Wrong HP boost native work result")
    user = before[executing]
    cost = max(1, user["maxHp"] * 33 // 100 if variant["moveId"] == 775 else user["maxHp"] // 2)
    if "expectedPayment" in case:
        check(cost == case["expectedPayment"], "Wrong HP boost maximum/rounding fixture")
    for side, key in (("attacker", "userStages"), ("defender", "defenderStages")):
        check(before[side]["statStages"] == case.get(key, [6] * 7), "Wrong HP boost initial stages")
    check(after["attacker"]["statStages"] == case["expectedUserStages"], "Wrong HP boost user stages")
    check(after["defender"]["statStages"] == case.get("expectedDefenderStages", [6] * 7), "Wrong HP boost defender stages")
    healing = user["maxHp"] // 4 if case.get("berryHealing") else 0
    expected_hp = user["hp"] - cost + healing if success else user["hp"]
    if events:
        event_after = events[0]["after"]
        check(events[0]["before"][executing]["hp"] == user["hp"], "Unexpected pre-payment HP change")
        check(event_after[executing]["hp"] == expected_hp, "Wrong native transaction HP payment")
        check(event_after[executing]["statStages"] == after[executing]["statStages"], "Boost checkpoint disagrees with completed action")
    incoming = result.get("incomingDamageCalls", [])
    if incoming:
        check(not case.get("snatched") and case.get("requiredOpponentMove") == 675 and len(events) == 1,
              "Unexpected incoming attack in HP boost fixture")
        # Separately certify the later real attack from its own native damage
        # and PP records; never confuse its HP loss with the direct payment.
        reversed_result = {"finished": True, "damageCalls": incoming,
            "rngOverrides": result["rngOverrides"],
            "before": {"attacker": event_after["defender"], "defender": event_after["attacker"]},
            "after": {"attacker": after["defender"], "defender": after["attacker"]}}
        verify_power({"id": "incoming", "expectedPowers": [80], "ppSpent": 1, "typeRatio": 8192, "damageRatios": [4096]},
                     reversed_result, {"moveId": 675, "power": 80, "category": 1, "type": 16})
        expected_hp -= sum(call["calculatedDamage"] for call in incoming)
    check(after[executing]["hp"] == expected_hp, f"Wrong HP boost payment: HP {after[executing]['hp']}, expected {expected_hp}")
    check(after[other]["hp"] == before[other]["hp"], "HP boost paid from the wrong battler")
    check(after[other]["item"] == before[other]["item"], "HP boost consumed the wrong item")
    check(after[executing]["item"] == (0 if case.get("berryHealing") else user["item"]), "Wrong HP boost berry reaction")
    if case.get("berryHealing"):
        check(success and user["item"] == 158 and user["hp"] - cost <= user["maxHp"] // 2, "Sitrus fixture never qualified")
    if case.get("snatched"):
        check(after["defender"]["previousMoveId"] == 289, "Opponent did not use native Snatch")
    if "requiredOpponentMove" in case:
        check(before["defender"]["previousMoveId"] == case["requiredOpponentMove"], "Required native setup move was not used")
    if case["id"] == "own-substitute-preserved":
        check(user["substituteHp"] > 0 and after[executing]["substituteHp"] == user["substituteHp"], "HP boost changed the user's Substitute")
    if "followup" in case:
        verify_hp_cost_boost(case["followup"]["case"], result["followup"], variant)
    return {"case": case["id"], "passed": True, "nativeSuccess": success,
            "payment": cost if success else 0, "hpAfter": after[executing]["hp"],
            "executingOwner": executing, "statStages": after[executing]["statStages"]}


def verify_magic_powder(case, result, variant):
    verify_completed(result, 750)
    check(not result["damageCalls"], "Magic Powder entered damage calculation")
    events = result["typeChangeEvents"]
    success = case["typeChangeSuccess"]
    check(len(events) == case.get("typeChangeEvents", 1), "Wrong number of Magic Powder effect executions")
    side = case.get("typeChangeSide", "defender")
    if events:
        event = events[0]
        check(event["success"] == success, "Wrong native Magic Powder success/failure result")
        owner = "defender" if side == "attacker" else "attacker"
        check(event["executingSlot"] == event["before"][owner]["slot"], "Magic Powder executed for the wrong owner")
        check(event["after"][side]["types"] == ([13, 13] if success else event["before"][side]["types"]),
              "Magic Powder did not replace the target's complete base typing")
        check(event["before"][side]["hp"] == event["after"][side]["hp"], "Type replacement altered HP")
        other = "attacker" if side == "defender" else "defender"
        check(event["after"][other]["types"] == event["before"][other]["types"], "Type replacement affected the wrong battler")
    else:
        check(not success and result["after"][side]["types"] == result["before"][side]["types"],
              "Blocked Magic Powder changed typing")
    if case.get("forceMiss"):
        check(result["accuracyRolls"] and all(roll["draw"] == 99 and 0 < roll["threshold"] < 100 for roll in result["accuracyRolls"]),
              "Magic Powder miss did not exercise native accuracy/evasion")
    if case.get("substitute"):
        check(result["after"]["defender"]["substituteHp"] > 0 and result["after"]["defender"]["previousMoveId"] == 164,
              "Opponent never established native Substitute")
    if "requiredOpponentMove" in case:
        check(result["after"]["defender"]["previousMoveId"] == case["requiredOpponentMove"], "Required native opponent action did not execute")
    if case["id"] == "gastro-acid-removes-overcoat-immunity":
        check(result["before"]["defender"]["gastroAcidCondition"] != 0 and
              result["setup"][0]["after"]["attacker"]["previousMoveId"] == 380,
              "Native Gastro Acid did not establish ability suppression")
    if case["id"] == "embargo-disables-goggles":
        check(result["before"]["defender"]["itemBlockedCondition"] != 0 and
              result["setup"][0]["after"]["attacker"]["previousMoveId"] == 373,
              "Native Embargo did not establish held-item suppression")
    if case["id"] == "replacement-clears-third-type":
        setup = result["setup"]
        check(len(setup) == 2 and setup[0]["after"]["attacker"]["previousMoveId"] == 567 and
              setup[1]["after"]["attacker"]["previousMoveId"] == 129 and
              setup[1]["before"]["defender"]["hp"] == setup[1]["after"]["defender"]["hp"],
              "Added Ghost typing was not established and exercised before replacement")
    if "expectedIncomingTypes" in case:
        check(result["after"]["defender"]["species"] == variant["incomingSpecies"] and
              result["after"]["defender"]["types"] == case["expectedIncomingTypes"], "Native first switch was not observed")
        check(len(result["switchInEvents"]) == 1 and
              result["switchInEvents"][0]["species"] == variant["incomingSpecies"], "Native first switch-in event was not observed")
    summary = {"case": case["id"], "passed": True, "nativeSuccess": success, "effectExecutions": len(events)}
    if "followup" in case:
        followup, next_result = case["followup"], result["followup"]
        if followup["moveId"] == 750:
            summary["followup"] = verify_magic_powder(followup["case"], next_result, variant)
        elif followup["moveId"] == 150:
            verify_completed(next_result, 150)
            check(next_result["after"]["defender"]["species"] == variant["defenderSpecies"] and
                  next_result["after"]["defender"]["types"] == followup["case"]["expectedIncomingTypes"],
                  "Returning original battler did not regain its native typing")
            check(next_result["before"]["defender"]["species"] == variant["incomingSpecies"], "Return check did not start with the native replacement battler")
            check(len(next_result["switchInEvents"]) == 1 and
                  next_result["switchInEvents"][0]["slot"] == result["before"]["defender"]["slot"],
                  "Switch-back did not restore the same original party battler")
            summary["followup"] = {"passed": True, "nativeSwitchRestoration": True}
        else:
            next_variant = {**variant, **{key: followup[key] for key in ("moveId", "power", "category", "type")}}
            summary["followup"] = verify_power(followup["case"], next_result, next_variant)
    return summary

def verify_damage_shield(case, result, variant):
    verify_completed(result, variant["moveId"])
    check(not result["damageCalls"], "Shield unexpectedly attacked")
    events, breaks, hits = result["shieldEvents"], result["shieldBreakEvents"], result["shieldHitEvents"]
    check(len(events) == 1 and events[0]["success"], "Shield did not successfully establish native protection")
    check(events[0]["executingSlot"] == result["before"]["attacker"]["slot"] and
          events[0]["after"]["attacker"]["turnFlags"] & (1 << 7), "Shield did not protect its actual user")
    check((bool(breaks) or case.get("expectedBreakChecks") == 0) and
          all(event["result"] == case.get("shieldBypass", 0) for event in breaks), "Wrong damage-only protection bypass result")
    if "expectedBreakChecks" in case:
        check(len(breaks) == case["expectedBreakChecks"], "Wrong number of protection checks")
    check(len(hits) == (1 if case["shieldBlocks"] else 0), "Wrong number of confirmed protection events")
    before, after = result["before"], result["after"]
    check(after["defender"]["previousMoveId"] == variant["trainerMove"], "Required opponent move never executed")
    check(len(result["incomingDamageCalls"]) == case.get("expectedIncomingDamage", 1 if not case["shieldBlocks"] and variant["trainerMove"] != 92 else 0),
          "Blocked damaging move reached native damage calculation, or Feint did not")
    if case["shieldBlocks"]:
        check(before["attacker"]["hp"] == after["attacker"]["hp"], "Shield did not block HP damage")
    expected_stages = list(before["defender"]["statStages"])
    if case["shieldRetaliates"] and variant["moveId"] != 908:
        index, drop = (1, 2) if variant["moveId"] == 792 else (4, 1)
        expected_stages[index] = max(0, expected_stages[index] - drop)
    expected_stages = case.get("expectedDefenderStages", expected_stages)
    check(after["defender"]["statStages"] == expected_stages, "Wrong shield retaliation stages")
    expected_status = case.get("expectedOpponentStatus", 4 if case["shieldRetaliates"] and variant["moveId"] == 908 else 0)
    check(active_status(after["defender"]) == ([expected_status] if expected_status else []), "Wrong shield retaliation status")
    expected_user_status = case.get("expectedUserStatus", 0)
    check(active_status(after["attacker"]) == ([expected_user_status] if expected_user_status else []), "Wrong status on shield user")
    # Blocking must not additionally trigger Helmet/Rough Skin damage. Burn
    # residual is checked separately from the immediate protection snapshot.
    if hits:
        check(hits[0]["after"]["defender"]["hp"] == before["defender"]["hp"], "Protection incorrectly triggered ordinary contact damage")
        check(hits[0]["attackingSlot"] == before["defender"]["slot"] and
              hits[0]["defendingSlot"] == before["attacker"]["slot"], "Retaliation event has the wrong owner/attacker")
    if case["id"] == "embargo-disabled-pads-allow-retaliation":
        check(before["defender"]["itemBlockedCondition"] != 0 and before["defender"]["item"] == 114,
              "Native Embargo did not disable the actual Protective Pads")
    if case.get("expectedBreakChecks") == 0:
        check(before["attacker"]["hp"] == after["attacker"]["hp"], "Immunity bypass control incorrectly took damage")
    summary = {"case": case["id"], "passed": True, "protectionEvents": len(hits), "bypass": breaks[0]["result"] if breaks else None,
               "opponentStages": expected_stages, "opponentStatus": expected_status}
    if "followup" in case:
        next_result = result["followup"]
        verify_completed(next_result, 150)
        check(not next_result["shieldEvents"] and not next_result["shieldHitEvents"], "Shield leaked into the following turn")
        check(len(next_result["incomingDamageCalls"]) == 1 and
              next_result["before"]["attacker"]["hp"] > next_result["after"]["attacker"]["hp"], "Shield's turn-end cleanup did not restore damage")
        check(next_result["after"]["defender"]["statStages"] == expected_stages, "Expired shield retaliated again")
        summary["followup"] = {"passed": True, "turnEndCleanup": True}
    return summary


def verify_steel_roller(case, result, variant):
    summary = verify_power(case, result, variant)
    check(len(result["terrainEndMessages"]) == case["terrainEndMessages"], "Wrong terrain-removal announcement count")
    for message in result["terrainEndMessages"]:
        check(message["mode"] == 2, "Wrong terrain-removal message mode")
    if case.get("forceMiss"):
        check(result["accuracyRolls"] and all(roll["draw"] == 99 and 0 < roll["threshold"] < 100 for roll in result["accuracyRolls"]),
              "Steel Roller miss did not exercise native accuracy/evasion")
    if case.get("userFaints"):
        check(result["after"]["attacker"]["hp"] == 0, "Required user reaction KO did not occur")
    if "followup" in case:
        check("followup" in result, "Missing post-removal behavioral check")
        followup = case["followup"]
        next_variant = {**variant, **{key: followup[key] for key in ("moveId", "power", "category", "type")}}
        if followup["moveId"] == 798:
            summary["followup"] = verify_steel_roller(followup["case"], result["followup"], next_variant)
        else:
            summary["followup"] = verify_power(followup["case"], result["followup"], next_variant)
    return {**summary, "terrainEndMessages": len(result["terrainEndMessages"])}


def verify_hazard(case, result, variant):
    summary = verify_power(case, result, variant)
    effect = "6" if variant["moveId"] == 845 else "8"
    before, after = result["beforeSideEffects"], result["afterSideEffects"]
    check(before[1][effect]["layers"] == case["hazardsBefore"], "Wrong native initial hazard layers")
    check(after[1][effect]["layers"] == case["expectedHazards"], "Wrong native post-hit hazard layers")
    for side in range(2):
        for key in ("6", "8"):
            record = after[side][key]
            check(0 <= record["layers"] <= (3 if key == "6" else 1), "Native hazard layer cap exceeded")
            check(bool(record["handler"]) == bool(record["layers"]), "Hazard count has no matching native handler")
            if record["layers"]:
                check(record["condition"] & 7 == 1, "Hazard does not have a permanent native condition")
            if side == 0 or key != effect:
                check(record == before[side][key], "Damaging hazard changed the wrong side or effect")
    if case.get("forceMiss"):
        check(result["accuracyRolls"] and all(roll["threshold"] == 90 and roll["draw"] == 99 for roll in result["accuracyRolls"]),
              "Hazard miss did not exercise native 90% accuracy")
    if case.get("userFaints"):
        check(result["after"]["attacker"]["hp"] == 0, "Contact-punishment fixture did not faint the attacker")
    return {**summary, "hazardLayers": after[1][effect]["layers"]}


def read_side_effects(emu, layout):
    return [{str(effect): {
        "handler": emu.memory.read_long(layout["base"] + side * layout["sideStride"] + effect * layout["effectStride"]),
        "condition": emu.memory.read_long(layout["base"] + side * layout["sideStride"] + effect * layout["effectStride"] + 4),
        "layers": emu.memory.read_long(layout["base"] + side * layout["sideStride"] + effect * layout["effectStride"] + layout["countOffset"]),
    } for effect in layout["effects"]} for side in range(2)]


def verify_poltergeist(case, result, variant):
    summary = verify_power(case, result, variant)
    before, after = result["before"]["defender"], result["after"]["defender"]
    check(before["item"] == case["expectedItemBefore"], "Wrong pre-hit held item")
    check(after["item"] == case["expectedItemAfter"], "Wrong post-hit held item")
    if "expectedItemBlocked" in case:
        check(bool(before["itemBlockedCondition"] & 7) == case["expectedItemBlocked"], "Embargo setup did not disable held-item use")
    if "expectedMagicRoom" in case:
        check(result["magicRoomActive"] == case["expectedMagicRoom"], "Magic Room setup did not become active")
    messages = result["announcements"]
    check(len(messages) == case["announcements"], "Wrong number of Poltergeist item announcements")
    for message in messages:
        check(message["mode"] == 2 and message["args"] == [before["slot"], before["item"]],
              "Poltergeist announced the wrong target or item")
        check(message["beforeDamageModifiers"], "Item announcement was not before damage/item reactions")
    if "expectedBoosts" in case:
        check(after["statStages"] == case["expectedBoosts"], "Wrong reactive item stat boosts")
    if case.get("forceMiss"):
        check(result["rngOverrides"] > 0, "Accuracy-miss RNG was never exercised")
    if "expectedIncomingAttacker" in case:
        incoming = result.get("incomingAttacker")
        check(incoming and incoming["species"] == case["expectedIncomingAttacker"] and incoming["slot"] < 6,
              "Red Card did not switch in the player's bench Pokemon")
    return {**summary, "announcements": len(messages), "itemAfter": after["item"]}


def verify_stat_history(case, result, variant):
    summary = verify_power(case, result, variant)
    calls = result["damageCalls"]
    if "requiredOpponentMove" in case:
        check(calls[0]["defender"]["previousMoveId"] == case["requiredOpponentMove"] and
              calls[0]["defender"]["turnFlags"] & 2, "Stat-history opponent action never executed first")
    if "expectedHistory" in case:
        changes = [event for event in result["statHistoryEvents"] if event["slot"] == case["expectedHistory"]]
        if case["historyVolume"]:
            check(any(event["volume"] == case["historyVolume"] for event in changes), "Required applied stat event was not observed")
        else:
            check(not changes, "A prevented/replaced stage incorrectly emitted an applied change")
    if "expectConditionalStatus" in case:
        status = 4 if variant["moveId"] == 807 else 6
        check(bool(result["after"]["defender"]["conditions"][status] & 7) == case["expectConditionalStatus"], "Wrong conditional burn/confusion result")
    if case.get("bypassSubstitute"):
        initial = calls[0]["defender"]["substituteHp"]
        check(initial > 0 and result["after"]["defender"]["substituteHp"] == initial,
              "Sound move did not bypass a real, preserved Substitute")
    if "expectedBoosts" in case:
        check(result["after"]["defender"]["statStages"] == case["expectedBoosts"], "Weakness Policy setup did not actually activate")
    return summary


class Observer:
    def __init__(self, emu, variant):
        self.emu, self.variant = emu, variant
        self.pointers, self.hooks, self.returns = {}, [], {}
        self.mon_pointers = {}
        self.ready = None
        self.reset(None)

    def reset(self, case):
        self.case = case
        self.next_command = False
        self.action_complete = False
        self.active_move_slot, self.active_move_id = 0, self.variant.get("moveId", 877)
        self.errors, self.damage, self.pending = [], [], {}
        self.active_damage = None
        self.rng_overrides = 0
        self.announcements, self.message_pointers = [], {}
        self.terrain_end_messages = []
        self.status_rng = []
        self.status_window = False
        self.status_windows_pending = {}
        self.take_heart_events, self.take_heart_pending = [], {}
        self.magic_powder_events = []
        self.shield_events, self.shield_break_events, self.shield_hit_events = [], [], []
        self.shield_pending, self.incoming_damage = {}, []
        self.switch_in_events = []
        self.incoming_attacker = None
        self.selection_checks, self.selection_pending = [], {}
        self.stat_history_events = []
        self.accuracy_ours = False
        self.accuracy_rolls, self.weather_reads = [], []
        self.weather_pending = {}
        self.floating_pending = {}
        self.start = self.emu.frame_count

    def install(self, probes):
        for probe in probes:
            def wrapped(cpu, address, callback=getattr(self, probe["name"])):
                if self.errors:
                    return
                try:
                    callback(cpu, address)
                except Exception as error:
                    self.errors.append(error)
            self.hooks.append(self.emu.memory.register_exec(probe["address"], wrapped))

    def ability(self, cpu, address):
        pointer = self.emu.memory.register_arm9.r0
        mon = state(self.emu, pointer)
        self.mon_pointers[mon["slot"]] = pointer
        side = "attacker" if mon["slot"] < 6 else "defender"
        if self.case:
            if side == "attacker" and self.variant.get("incomingAttackerSpecies") == mon["species"]:
                self.incoming_attacker = pointer
            if side == "defender" and self.variant.get("incomingSpecies") == mon["species"]:
                check(mon["ability"] == self.variant["abilityId"], "Incoming target registered the wrong ability")
                self.pointers[side] = pointer
            return
        check(mon["species"] == (self.variant.get("playerSpecies", 151) if side == "attacker" else self.variant.get("defenderSpecies", 143)), "Unexpected native battler species")
        if "playerForm" in self.variant and side == "attacker":
            check(mon["form"] == self.variant["playerForm"], "Unexpected native player form")
        if "defenderForm" in self.variant and side == "defender":
            check(mon["form"] == self.variant["defenderForm"], "Unexpected native defender form")
        check(mon["ability"] == (self.variant["playerAbilityId"] if side == "attacker" else self.variant["abilityId"]), "Unexpected registered ability")
        self.pointers[side] = pointer

    def command(self, cpu, address):
        if self.emu.memory.read_long(self.emu.memory.register_arm9.r1) != 0:
            return
        if self.case is None:
            self.ready = self.emu.frame_count
        elif self.action_complete:
            mon = state(self.emu, self.pointers["attacker"])
            if mon["moves"][self.active_move_slot]["pp"] < self.initial_pp:
                self.next_command = True

    def damage_probe(self, cpu, address):
        self.active_damage = None
        if not self.case:
            return
        registers = self.emu.memory.register_arm9
        if self.variant.get("moveId") in (792, 852, 908) and registers.r1 == self.pointers.get("defender"):
            check(registers.r2 == self.pointers["attacker"], "Incoming move has the wrong shield target")
            self.incoming_damage.append({"moveId": self.emu.memory.read_short(registers.r3),
                                         "category": self.emu.memory.read_long(registers.r3 + 8)})
        incoming_boost = self.variant.get("moveId") in (775, 868) and registers.r1 == self.pointers.get("defender")
        if incoming_boost:
            check(registers.r2 == self.pointers["attacker"], "Incoming HP boost attack has the wrong target")
        elif registers.r1 != self.pointers["attacker"]:
            return
        else:
            check(registers.r2 == self.pointers["defender"], "Wrong damage target")
            check(self.emu.memory.read_short(registers.r3) == self.active_move_id, "Wrong attacking move")
        calculation = {"frame": self.emu.frame_count, "attacker": state(self.emu, registers.r1),
                       "defender": state(self.emu, registers.r2), "powerRewrites": [], "powerRolls": 0,
                       "floatingChecks": [],
                       "moveType": self.emu.memory.read_byte(registers.r3 + 6),
                       "category": self.emu.memory.read_long(registers.r3 + 8)}
        (self.incoming_damage if incoming_boost else self.damage).append(calculation)
        self.active_damage = calculation

    def selection(self, cpu, address):
        r = self.emu.memory.register_arm9
        if not self.case or r.r2 != self.active_move_id or not r.r3:
            return
        # The command client owns a separate BattleMon copy from the server's
        # registered battler. Match native identity, not allocation address.
        mon = state(self.emu, r.r1)
        user = state(self.emu, self.pointers["attacker"])
        if mon["slot"] != user["slot"] or mon["species"] != user["species"]:
            return
        ret = r.lr & ~1
        event = {"moveId": r.r2, "clientPointer": r.r1, "before": mon}
        self.selection_pending.setdefault(ret, []).append(event)
        key = ("selection", ret)
        if key not in self.returns:
            def returned(cpu, address):
                if self.errors or not self.selection_pending.get(address):
                    return
                event = self.selection_pending[address].pop()
                value = self.emu.memory.register_arm9.r0
                if value not in (0, 1):
                    self.errors.append(AssertionError("Invalid native selection result"))
                    return
                event.update(result=value, after=state(self.emu, event["clientPointer"]))
                self.selection_checks.append(event)
            self.returns[key] = self.emu.memory.register_exec(ret, returned)

    def attack_stat(self, cpu, address):
        if self.active_damage is None:
            return
        r = self.emu.memory.register_arm9
        ret = r.lr & ~1
        key = ("attack-stat", ret)
        self.pending.setdefault(key, []).append(self.active_damage)
        if key not in self.returns:
            def returned(cpu, address):
                if self.pending.get(key):
                    self.pending[key].pop()["attackValue"] = self.emu.memory.register_arm9.r0
            self.returns[key] = self.emu.memory.register_exec(ret, returned)

    def rewrite(self, cpu, address):
        r = self.emu.memory.register_arm9
        if self.active_damage is not None and r.r0 == 48:
            self.active_damage["powerRewrites"].append(r.r1)

    def critical(self, cpu, address):
        if self.active_damage is not None:
            self.active_damage["critical"] = self.emu.memory.register_arm9.r6

    def pre_modifier(self, cpu, address):
        if self.active_damage is not None:
            self.active_damage["preModifierDamage"] = self.emu.memory.register_arm9.r4

    def damage_weather(self, cpu, address):
        if self.active_damage is not None:
            self.active_damage["damageWeather"] = self.emu.memory.register_arm9.r0

    def calculated(self, cpu, address):
        if self.active_damage is not None:
            self.active_damage["calculatedDamage"] = self.emu.memory.register_arm9.r0
            self.active_damage = None

    def ratio(self, cpu, address):
        if self.active_damage is not None:
            self.active_damage["damageRatio"] = self.emu.memory.register_arm9.r0

    def accuracy(self, cpu, address):
        r = self.emu.memory.register_arm9
        self.accuracy_ours = bool(self.case and r.r1 == self.pointers.get("attacker") and
                                  self.emu.memory.read_short(r.r3) == self.active_move_id)

    def accuracy_roll(self, cpu, address):
        if self.accuracy_ours:
            self.accuracy_rolls.append({"threshold": self.emu.memory.register_arm9.r4,
                                        "draw": None})

    def weather(self, cpu, address):
        if not self.case:
            return
        ret = self.emu.memory.register_arm9.lr & ~1
        self.weather_pending[ret] = self.weather_pending.get(ret, 0) + 1
        key = ("weather", ret)
        if key not in self.returns:
            def returned(cpu, address):
                if self.case and self.weather_pending.get(address, 0):
                    self.weather_pending[address] -= 1
                    self.weather_reads.append(self.emu.memory.register_arm9.r0)
            self.returns[key] = self.emu.memory.register_exec(ret, returned)

    def floating(self, cpu, address):
        if self.active_damage is None:
            return
        r = self.emu.memory.register_arm9
        side = next((side for side, pointer in self.pointers.items() if pointer == r.r1), None)
        if side is None:
            return
        ret = r.lr & ~1
        self.floating_pending.setdefault(ret, []).append((self.active_damage, side))
        key = ("floating", ret)
        if key not in self.returns:
            def returned(cpu, address):
                if self.errors:
                    return
                try:
                    if self.floating_pending.get(address):
                        calculation, side = self.floating_pending[address].pop()
                        value = self.emu.memory.register_arm9.r0
                        check(value in (0, 1), "Invalid native floating result")
                        calculation["floatingChecks"].append({"side": side, "floating": bool(value)})
                except Exception as error:
                    self.errors.append(error)
            self.returns[key] = self.emu.memory.register_exec(ret, returned)

    def message_setup(self, cpu, address):
        r = self.emu.memory.register_arm9
        self.message_pointers.pop(r.r0, None)
        if self.case and r.r2 == 1301:
            self.terrain_end_messages.append({"frame": self.emu.frame_count, "mode": r.r1})
        if not self.case or self.active_move_id != 809 or r.r2 != 1349:
            return
        message = {"frame": self.emu.frame_count, "mode": r.r1, "args": [],
                   "beforeDamageModifiers": self.active_damage is not None and "preModifierDamage" not in self.active_damage}
        self.announcements.append(message)
        self.message_pointers[r.r0] = message

    def message_arg(self, cpu, address):
        r = self.emu.memory.register_arm9
        if r.r0 in self.message_pointers:
            self.message_pointers[r.r0]["args"].append(r.r1)

    def random(self, cpu, address):
        controlled = self.variant.get("controlledRng", False)
        if not self.case or not (self.case.get("forceMiss") or controlled):
            return
        registers = self.emu.memory.register_arm9
        bound, ret = registers.r0, registers.lr & ~1
        if self.active_damage is not None and bound == 100:
            self.active_damage["powerRolls"] += 1
        if not controlled and bound != 100:
            return
        check(0 < bound <= 0x100000, "Invalid BattleRandom bound")
        self.pending.setdefault(ret, []).append(bound)
        if ret not in self.returns:
            def returned(cpu, address):
                if self.errors:
                    return
                try:
                    if self.case and self.pending.get(address):
                        bound = self.pending[address].pop()
                        # Native RNG executes first. Only control its draw, never
                        # the handler, status result, damage or HP.
                        native = self.emu.memory.register_arm9.r0
                        check(native < bound, "Native RNG result exceeds its bound")
                        if address == 0x021a3694 and self.accuracy_ours and "accuracyDraws" in self.case:
                            index = len(self.accuracy_rolls) - 1
                            check(0 <= index < len(self.case["accuracyDraws"]), "Unexpected extra accuracy draw")
                            accuracy_draw = self.case["accuracyDraws"][index]
                        else:
                            accuracy_draw = self.case.get("accuracyRoll", 99)
                        draw = (accuracy_draw if address == 0x021a3694 and self.accuracy_ours else
                                self.case.get("statusChoice", 2) if controlled and self.active_move_id == 827 and bound == 3 else
                                self.case.get("secondaryRoll", 99) if controlled and bound == 100 else bound - 1)
                        check(0 <= draw < bound, "Controlled RNG draw exceeds its bound")
                        self.emu.memory.register_arm9.r0 = draw
                        if self.status_window and bound in (100, 3):
                            self.status_rng.append({"frame": self.emu.frame_count, "caller": address,
                                                    "bound": bound, "nativeDraw": native, "draw": draw})
                        if address == 0x021a3694 and self.accuracy_ours:
                            check(bound == 100 and self.accuracy_rolls and self.accuracy_rolls[-1]["draw"] is None,
                                  "Accuracy RNG return had no matching observed roll")
                            self.accuracy_rolls[-1].update(nativeDraw=native, bound=bound,
                                                         draw=self.emu.memory.register_arm9.r0)
                        self.rng_overrides += 1
                except Exception as error:
                    self.errors.append(error)
            self.returns[ret] = self.emu.memory.register_exec(ret, returned)

    def event_dispatch(self, cpu, address):
        r = self.emu.memory.register_arm9
        if self.case and self.variant.get("moveId") in (807, 808, 914) and r.r1 == 0x5d:
            volume = read_event_var(self.emu, 0x20)
            self.stat_history_events.append({"slot": read_event_var(self.emu, 2),
                "volume": volume if volume < 0x80000000 else volume - 0x100000000})
        if self.case and self.variant.get("moveId") in (792, 852, 908):
            if (r.r1 == 0x2e and read_event_var(self.emu, 4) == state(self.emu, self.pointers["attacker"])["slot"] and
                    read_event_var(self.emu, 3) == state(self.emu, self.pointers["defender"])["slot"]):
                self.observe_shield_event("break", {"category": read_event_var(self.emu, 0x1a)})
            elif (r.r1 == 0x15 and read_event_var(self.emu, 2) == 0xffffffff and
                  read_event_var(self.emu, 9) == state(self.emu, self.pointers["attacker"])["slot"]):
                self.observe_shield_event("hit", {"attackingSlot": read_event_var(self.emu, 8),
                                                  "defendingSlot": read_event_var(self.emu, 9)})
        if self.case and self.variant.get("moveId") == 750 and self.variant.get("bench") and r.r1 == 0x55:
            slot = read_event_var(self.emu, 2)
            check(slot in self.mon_pointers, "Native switch-in references an unobserved battler")
            pointer = self.mon_pointers[slot]
            mon = state(self.emu, pointer)
            check(mon["slot"] == slot, "Native switch-in battler pointer is stale")
            if slot >= 6:
                self.pointers["defender"] = pointer
                self.switch_in_events.append(mon)
        if (self.case and self.active_move_id in (750, 850, 775, 868, 792, 852, 908, 882, 564)
                and r.r1 == (0xa1 if self.active_move_id == 564 else 0xa0)
                and read_event_var(self.emu, 0x12) == self.active_move_id):
            server, ret = r.r0, r.lr & ~1
            event = {"executingSlot": read_event_var(self.emu, 3),
                     "before": {side: state(self.emu, p) for side, p in self.pointers.items()}}
            (self.magic_powder_events if self.active_move_id == 750 else
             self.shield_events if self.active_move_id in (792, 852, 908) else self.take_heart_events).append(event)
            self.take_heart_pending.setdefault(ret, []).append((server, event))
            key = ("uncategorized", ret)
            if key not in self.returns:
                def returned(cpu, address):
                    if self.errors:
                        return
                    try:
                        if self.take_heart_pending.get(address):
                            server, event = self.take_heart_pending[address].pop()
                            value = self.emu.memory.read_long(server + 0x1d78)
                            event.update(used=bool(value & (1 << 30)), success=bool(value & (1 << 29)),
                                         after={side: state(self.emu, p) for side, p in self.pointers.items()})
                    except Exception as error:
                        self.errors.append(error)
                self.returns[key] = self.emu.memory.register_exec(ret, returned)
            return
        if self.active_move_id != 827 or not self.damage or r.r1 != 0x4b:
            return
        # Only the per-hit reaction's handler window owns the custom status
        # draws. A newly paralyzed AI can roll full paralysis on the next
        # action before our frame snapshot; that is not another activation.
        ret = r.lr & ~1
        self.status_windows_pending.setdefault(ret, []).append(self.status_window)
        self.status_window = True
        key = ("status-window", ret)
        if key not in self.returns:
            def returned(cpu, address):
                if self.status_windows_pending.get(address):
                    self.status_window = self.status_windows_pending[address].pop()
            self.returns[key] = self.emu.memory.register_exec(ret, returned)

    def observe_shield_event(self, label, fields):
        ret = self.emu.memory.register_arm9.lr & ~1
        event = {**fields, "before": {side: state(self.emu, p) for side, p in self.pointers.items()}}
        (self.shield_break_events if label == "break" else self.shield_hit_events).append(event)
        self.shield_pending.setdefault(ret, []).append((label, event))
        key = ("shield", ret)
        if key not in self.returns:
            def returned(cpu, address):
                if self.errors or not self.shield_pending.get(address):
                    return
                try:
                    label, event = self.shield_pending[address].pop()
                    event["after"] = {side: state(self.emu, p) for side, p in self.pointers.items()}
                    if label == "break":
                        event["result"] = read_event_var(self.emu, 0x51)
                except Exception as error:
                    self.errors.append(error)
            self.returns[key] = self.emu.memory.register_exec(ret, returned)

    def raise_errors(self):
        if self.errors:
            raise self.errors[0]

    def close(self):
        for hook in [*self.hooks, *self.returns.values()]:
            hook.remove()
        self.hooks.clear()
        self.returns.clear()


def patch_rom(rom, patches):
    with rom.open("r+b") as stream:
        seen = set()
        for entry in patches:
            at, expected, value = entry["offset"], entry["expected"], entry["value"]
            check(isinstance(at, int) and 0 <= at < rom.stat().st_size and at not in seen, "Invalid variant patch offset")
            check(all(isinstance(n, int) and 0 <= n <= 255 for n in (expected, value)), "Invalid variant patch byte")
            stream.seek(at)
            check(stream.read(1) == bytes([expected]), "Variant patch expected-byte mismatch")
            stream.seek(at)
            stream.write(bytes([value]))
            seen.add(at)


def execute_move(emu, observer, maximum, slot=0):
    before = {side: state(emu, p) for side, p in observer.pointers.items()}
    side_before = read_side_effects(emu, observer.variant["sideState"]) if "sideState" in observer.variant else None
    selected = before["attacker"]["moves"][slot]
    check(selected["id"] and selected["pp"], "Selected fixture move is missing or out of PP")
    observer.active_move_id, observer.active_move_slot = selected["id"], slot
    observer.initial_pp = selected["pp"]
    observer.action_complete = observer.next_command = False
    for step in range(maximum):
        emu.input.keypad_update(1 if 24 <= step < 27 else 0)
        if step >= 60 and step % 12 < 3:
            emu.input.touch_set_pos(64 if slot % 2 == 0 else 192, 50 if slot < 2 else 110)
        else:
            emu.input.touch_release()
        emu.cycle()
        observer.raise_errors()
        check_arm9(emu)
        after = {side: state(emu, p) for side, p in observer.pointers.items()}
        if observer.case.get("selectionRejected") and observer.selection_checks:
            check(observer.selection_checks[-1]["result"] == 1, "Blocked sound move was selectable")
            return {"finished": True, "selectionRejected": True, "selectedMoveSlot": slot,
                    "before": before, "after": after}
        if (after["attacker"]["turnFlags"] & (1 << 1)
                and after["attacker"]["moves"][slot]["pp"] < selected["pp"]
                and after["attacker"]["previousMoveId"] == selected["id"]):
            observer.action_complete = True
            result = {"finished": True, "selectedMoveSlot": slot, "before": before, "after": after}
            if side_before is not None:
                result.update(beforeSideEffects=side_before, afterSideEffects=read_side_effects(emu, observer.variant["sideState"]))
            return result
    raise AssertionError("Move attempt never completed")


def check_arm9(emu):
    # BIOS addresses alone are not faults: normal DMA/IRQ/SWI handling can
    # execute there at a frame boundary. ARM abort/undefined modes are faults.
    mode = emu.memory.register_arm9.cpsr & 0x1f
    check(mode not in (0x17, 0x1b), f"ARM9 fault mode {mode:#x}")


def wait_next_command(emu, observer, maximum):
    for _ in range(maximum):
        emu.input.keypad_update(0)
        emu.input.touch_release()
        emu.cycle()
        observer.raise_errors()
        check_arm9(emu)
        if observer.next_command:
            return
    raise AssertionError("Battle did not return to the next command menu")


def run_variant(args, spec):
    directory, artifacts = Path(spec["directory"]), Path(spec["artifacts"])
    variant, manifest = spec["variant"], spec["manifest"]
    if "sideState" in manifest:
        variant = {**variant, "sideState": manifest["sideState"]}
    rom = Path(spec["workspace"]) / "battle.nds"
    shared.clone(directory / "battle.nds", rom)
    patch_rom(rom, variant["romPatches"])
    rom.with_suffix(".sav").write_bytes((directory / variant["save"]).read_bytes())
    MelonDS, library = shared.configure_melon(args, preflight=False)
    emu = MelonDS(library)
    observer = Observer(emu, variant)
    snapshot = None
    result = {"variant": variant["name"], "passed": False, "cases": [],
              "checkpoint": "native-action-complete", "fullTurnValidated": False}
    try:
        probes = [{**p, "name": "damage_probe" if p["name"] == "damage" else p["name"]} for p in manifest["probes"]]
        observer.install(probes)
        emu.open(rom)
        for _ in range(args.max_frames):
            emu.cycle()
            observer.raise_errors()
            if observer.ready is not None:
                break
        check(observer.ready is not None and set(observer.pointers) == {"attacker", "defender"}, "Battle did not reach a registered command menu")
        baseline = {side: bytes(emu.memory.unsigned[p:p + 0x200]) for side, p in observer.pointers.items()}
        baseline_pointers = dict(observer.pointers)
        frame = emu.frame_count
        snapshot = emu.save_snapshot()
        result.update(checkpointFrame=frame, snapshotBytes=len(snapshot))
        for case in variant["cases"]:
            record = {"case": case["id"], "finished": False}
            try:
                emu.restore_snapshot(snapshot)
                emu.input.keypad_update(0)
                emu.input.touch_release()
                observer.pointers = dict(baseline_pointers)
                observer.reset(case)
                check(emu.frame_count == frame, "Checkpoint frame was not restored")
                for side, raw in baseline.items():
                    check(bytes(emu.memory.unsigned[observer.pointers[side]:observer.pointers[side] + len(raw)]) == raw, "Battler checkpoint was not restored")
                # Explicit fixture preconditions, applied before any input. Never
                # modify a calculated result or HP after the move begins.
                target = observer.pointers["defender"]
                if "userStats" in case:
                    stats = case["userStats"]
                    check(len(stats) == 5 and all(isinstance(value, int) and 0 < value <= 2000 for value in stats), "Invalid raw-stat fixture")
                    for index, value in enumerate(stats):
                        emu.memory.write_short(observer.pointers["attacker"] + 0xee + index * 2, value)
                if "currentHp" in case:
                    check(0 < case["currentHp"] <= emu.memory.read_short(target + 14), "Invalid fixture current HP")
                    emu.memory.write_short(target + 16, case["currentHp"])
                if "userCurrentHp" in case:
                    user = observer.pointers["attacker"]
                    check(0 < case["userCurrentHp"] <= emu.memory.read_short(user + 14), "Invalid fixture user current HP")
                    emu.memory.write_short(user + 16, case["userCurrentHp"])
                if "defenseStage" in case:
                    check(0 <= case["defenseStage"] <= 12, "Invalid fixture stat stage")
                    emu.memory.write_byte(target + 0xfd, case["defenseStage"])
                if "accuracyStage" in case:
                    check(0 <= case["accuracyStage"] <= 12, "Invalid user accuracy fixture stage")
                    emu.memory.write_byte(observer.pointers["attacker"] + 0x101, case["accuracyStage"])
                if "evasionStage" in case:
                    check(0 <= case["evasionStage"] <= 12, "Invalid target evasion fixture stage")
                    emu.memory.write_byte(target + 0x102, case["evasionStage"])
                if "userStages" in case:
                    stages = case["userStages"]
                    check(len(stages) == 7 and all(isinstance(value, int) and 0 <= value <= 12 for value in stages), "Invalid user stat-stage fixture")
                    for index, value in enumerate(stages):
                        emu.memory.write_byte(observer.pointers["attacker"] + 0xfc + index, value)
                if "defenderStages" in case:
                    stages = case["defenderStages"]
                    check(len(stages) == 7 and all(isinstance(value, int) and 0 <= value <= 12 for value in stages), "Invalid defender stat-stage fixture")
                    for index, value in enumerate(stages):
                        emu.memory.write_byte(target + 0xfc + index, value)
                for setup_slot in case.get("setupSlots", [case["setupSlot"]] if "setupSlot" in case else []):
                    observer.reset({"id": "setup", "secondaryRoll": 99, "accuracyRoll": case.get("setupAccuracyRoll", 99)})
                    record.setdefault("setup", []).append(execute_move(emu, observer, args.max_frames, setup_slot))
                    wait_next_command(emu, observer, args.max_frames)
                    observer.reset(case)
                record.update(execute_move(emu, observer, args.max_frames))
                if manifest["move"] == "poltergeist":
                    record["magicRoomActive"] = bool(emu.memory.read_long(0x021dd928 + 0x148 + 7 * 4))
                record["completion"] = record["after"]["attacker"]
                if case.get("completeTurn"):
                    wait_next_command(emu, observer, args.max_frames)
                    record["after"] = {side: state(emu, p) for side, p in observer.pointers.items()}
                    if "sideState" in variant:
                        record["afterSideEffects"] = read_side_effects(emu, variant["sideState"])
                record["statHistoryEvents"] = observer.stat_history_events
                record.update(damageCalls=observer.damage, rngOverrides=observer.rng_overrides,
                              announcements=observer.announcements, weatherReads=observer.weather_reads,
                              accuracyRolls=observer.accuracy_rolls, terrainEndMessages=observer.terrain_end_messages,
                              statusRng=observer.status_rng, takeHeartEvents=observer.take_heart_events,
                              typeChangeEvents=observer.magic_powder_events)
                record["selectionChecks"] = observer.selection_checks
                record.update(shieldEvents=observer.shield_events, shieldBreakEvents=observer.shield_break_events,
                              shieldHitEvents=observer.shield_hit_events, incomingDamageCalls=observer.incoming_damage)
                record["switchInEvents"] = observer.switch_in_events
                if observer.incoming_attacker is not None:
                    record["incomingAttacker"] = state(emu, observer.incoming_attacker)
                check(record["before"]["attacker"]["moveId"] == manifest["moveId"], "Fixture selected the wrong suite move")
                if "followup" in case:
                    followup = case["followup"]
                    wait_next_command(emu, observer, args.max_frames)
                    observer.reset(followup["case"])
                    record["followup"] = execute_move(emu, observer, args.max_frames, followup["slot"])
                    record["followup"]["completion"] = record["followup"]["after"]["attacker"]
                    if followup["case"].get("completeTurn"):
                        wait_next_command(emu, observer, args.max_frames)
                        record["followup"]["after"] = {side: state(emu, p) for side, p in observer.pointers.items()}
                    record["followup"].update(damageCalls=observer.damage, rngOverrides=observer.rng_overrides,
                        terrainEndMessages=observer.terrain_end_messages, accuracyRolls=observer.accuracy_rolls,
                        takeHeartEvents=observer.take_heart_events, typeChangeEvents=observer.magic_powder_events,
                        switchInEvents=observer.switch_in_events)
                    record["followup"].update(shieldEvents=observer.shield_events, shieldBreakEvents=observer.shield_break_events,
                        shieldHitEvents=observer.shield_hit_events, incomingDamageCalls=observer.incoming_damage)
                summary = (verify_ruination(case, record) if manifest["move"] == "ruination" else
                           verify_stat_history(case, record, variant) if manifest["move"] in ("lash-out", "burning-jealousy", "alluring-voice") else
                           verify_tidy_up(case, record, variant) if manifest["move"] == "tidy-up" else
                           verify_dire_claw(case, record, variant) if manifest["move"] == "dire-claw" else
                           verify_take_heart(case, record, variant) if manifest["move"] == "take-heart" else
                           verify_hp_cost_boost(case, record, variant) if manifest["move"] in ("clangorous-soul", "fillet-away") else
                           verify_aura_wheel(case, record, variant) if manifest["move"] == "aura-wheel" else
                           verify_magic_powder(case, record, variant) if manifest["move"] == "magic-powder" else
                           verify_damage_shield(case, record, variant) if manifest["move"] in ("obstruct", "silk-trap", "burning-bulwark") else
                           verify_scale_shot(case, record, variant) if manifest["move"] == "scale-shot" else
                           verify_triple_axel(case, record, variant) if manifest["move"] == "triple-axel" else
                           verify_maximum_hp_cost(case, record, variant) if manifest["move"] in ("steel-beam", "chloroblast") else
                           verify_steel_roller(case, record, variant) if manifest["move"] in ("steel-roller", "ice-spinner") else
                           verify_hazard(case, record, variant) if manifest["move"] in ("ceaseless-edge", "stone-axe") else
                           verify_poltergeist(case, record, variant) if manifest["move"] == "poltergeist" else
                           verify_hydro_steam(case, record, variant) if manifest["move"] == "hydro-steam" else
                           verify_terrain_pulse(case, record, variant) if manifest["move"] == "terrain-pulse" else
                           verify_supercell_slam(case, record, variant) if manifest["move"] == "supercell-slam" else
                           verify_storm(case, record, variant) if manifest["move"] in ("bleakwind-storm", "sandsear-storm", "wildbolt-storm") else
                           verify_power(case, record, variant))
                result["cases"].append(summary)
                if args.full_turn_smoke and case["id"] == "full-hp":
                    wait_next_command(emu, observer, args.max_frames)
                    result["fullTurnValidated"] = record["fullTurnValidated"] = True
            except Exception as error:
                record["error"] = str(error)
                # Keep completed first-action observations if a follow-up fails.
                for key, value in dict(damageCalls=observer.damage, rngOverrides=observer.rng_overrides,
                              announcements=observer.announcements, weatherReads=observer.weather_reads,
                              accuracyRolls=observer.accuracy_rolls, statusRng=observer.status_rng,
                              takeHeartEvents=observer.take_heart_events, typeChangeEvents=observer.magic_powder_events,
                              switchInEvents=observer.switch_in_events, shieldEvents=observer.shield_events,
                              shieldBreakEvents=observer.shield_break_events, shieldHitEvents=observer.shield_hit_events,
                              incomingDamageCalls=observer.incoming_damage,
                              selectionChecks=observer.selection_checks).items():
                    record.setdefault(key, value)
                if observer.incoming_attacker is not None:
                    record["incomingAttacker"] = state(emu, observer.incoming_attacker)
                record["lastState"] = {side: state(emu, p) for side, p in observer.pointers.items()}
                record["registers"] = {f"r{i}": getattr(emu.memory.register_arm9, f"r{i}") for i in range(16)}
                record["registers"]["cpsr"] = emu.memory.register_arm9.cpsr
                emu.screenshot().save(artifacts / f"{variant['name']}-{case['id']}-failure.png")
                raise
            finally:
                record["finalFrame"] = emu.frame_count
                (artifacts / f"{variant['name']}-{case['id']}.json").write_text(json.dumps(record, indent=2) + "\n")
        result["passed"] = True
    except Exception as error:
        result["error"] = str(error)
        raise
    finally:
        snapshot = None
        result["snapshotReleased"] = True
        try:
            observer.close()
        finally:
            try:
                emu.destroy()
            finally:
                (artifacts / f"{variant['name']}-batch.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--move", choices=["lash-out", "burning-jealousy", "alluring-voice", "tidy-up", "body-press", "ice-spinner", "ruination", "barb-barrage", "dire-claw", "take-heart", "clangorous-soul", "fillet-away", "aura-wheel", "magic-powder", "obstruct", "silk-trap", "burning-bulwark", "hydro-steam", "terrain-pulse", "supercell-slam", "bolt-beak", "fishious-rend", "hard-press", "grav-apple", "psyblade", "rising-voltage", "scale-shot", "triple-axel", "steel-beam", "chloroblast", "steel-roller", "ceaseless-edge", "stone-axe", "collision-course", "electro-drift", "fickle-beam", "poltergeist", "grassy-glide", "bleakwind-storm", "sandsear-storm", "wildbolt-storm"], default="ruination")
    parser.add_argument("--rom", type=Path, default=ROOT.parent.parent / "White2Upgrade.nds")
    parser.add_argument("--core", type=Path, help="Fresh stripped core DLL to install in the private fixture ROM")
    parser.add_argument("--save", type=Path, default=ROOT / "src/assets/testbattle/test.sav")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--fixtures", type=Path, help="Reuse a complete caller-owned fixture; never deletes its ROM")
    parser.add_argument("--keep-fixtures", action="store_true")
    parser.add_argument("--variant", action="append",
                        help="Run only a named variant (repeatable); omitted runs the complete suite")
    parser.add_argument("--full-turn-smoke", action="store_true", help="Also require the normal full-HP case to reach the next native command menu")
    parser.add_argument("--max-frames", type=int, default=2400)
    parser.add_argument("--trial-timeout", type=float, default=300,
                        help="Hard process deadline per restored-case batch, in seconds (default: 300)")
    parser.add_argument("--melon-python", type=Path)
    parser.add_argument("--melon-lib", type=Path)
    parser.add_argument("--worker-spec", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.worker_spec:
        spec = json.loads(args.worker_spec.read_text())
        with shared.native_log(Path(spec["artifacts"]) / f"{spec['variant']['name']}-batch.log"):
            run_variant(args, spec)
        return 0
    check(args.max_frames > 0 and args.trial_timeout > 0, "Limits must be positive")
    output = (args.out or ROOT / "work/move-handlers" / f"{args.move}-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}").resolve()
    shared.create_output_directory(output)
    directory, artifacts = args.fixtures.resolve() if args.fixtures else output / "fixtures", output / "trials"
    report = {"move": args.move, "passed": False, "cases": [],
              "checkpoint": "native-action-complete", "fullTurnValidated": False}
    start = time.monotonic()
    try:
        with shared.native_log(output / "preflight.log"):
            shared.configure_melon(args)
        command = [str(ROOT / "node_modules/.bin/vite-node"), str(ROOT / "scripts/build-move-handler-fixtures.ts"),
                   "--move", args.move, "--rom", str(args.rom.resolve()), "--save", str(args.save.resolve()), "--out", str(directory)]
        if args.core:
            command += ["--core", str(args.core.resolve())]
        if not args.fixtures:
            subprocess.run(command, cwd=ROOT, check=True)
        manifest = json.loads((directory / "suite.json").read_text())
        check(manifest["format"] == "pokeweb-focused-move-1" and manifest["move"] == args.move and manifest["battleType"] == "Singles", "Wrong fixture contract")
        variants = select_variants(manifest, args.variant)
        report.update(selectedVariants=[variant["name"] for variant in variants],
                      completeSuite=len(variants) == len(manifest["variants"]))
        check(shared.digest(directory / "battle.nds") == manifest["rom"]["sha256"], "Fixture ROM hash mismatch")
        for save in manifest["saves"]:
            check(shared.digest(directory / save["file"]) == save["sha256"], "Fixture save hash mismatch")
            shared.validate_fixture_save(directory / save["file"])
        report.update(inputRomSha256=manifest["inputRomSha256"], coreSha256=manifest.get("coreSha256"))
        artifacts.mkdir()
        for variant in variants:
            print(f"Running {args.move}/{variant['name']}...", flush=True)
            with tempfile.TemporaryDirectory(prefix="pokeweb-move-handler-") as workspace:
                specification = artifacts / f"{variant['name']}-batch.input.json"
                specification.write_text(json.dumps({"directory": str(directory), "artifacts": str(artifacts), "workspace": workspace,
                                                     "manifest": manifest, "variant": variant}, indent=2) + "\n")
                worker = [sys.executable, str(Path(__file__).resolve()), "--worker-spec", str(specification), "--max-frames", str(args.max_frames)]
                if args.full_turn_smoke:
                    worker.append("--full-turn-smoke")
                for option, value in (("--melon-python", args.melon_python), ("--melon-lib", args.melon_lib)):
                    if value:
                        worker += [option, str(value.resolve())]
                subprocess.run(worker, check=True, timeout=args.trial_timeout)
            result = json.loads((artifacts / f"{variant['name']}-batch.json").read_text())
            check(result["passed"] and result["snapshotReleased"], "Incomplete batch cleanup")
            if result["fullTurnValidated"]:
                report["fullTurnValidated"] = True
            report["cases"].extend(result["cases"])
            for result in result["cases"]:
                detail = (f"native effect {'succeeded' if result['nativeSuccess'] else 'failed as expected'}"
                          if "nativeSuccess" in result else
                          f"{result['protectionEvents']} block(s), bypass {result['bypass']}" if "protectionEvents" in result else
                          f"{result['hpBefore']} -> {result['hpAfter']} HP")
                print(f"PASS {result['case']}: {detail}", flush=True)
        report["passed"] = True
    except Exception as error:
        report["error"] = str(error)
        print(f"FAIL: {error}", file=sys.stderr)
    finally:
        try:
            report["removedFixtureRoms"] = [] if args.keep_fixtures or args.fixtures else shared.cleanup_fixture_rom(directory)
        except Exception as error:
            report.update(passed=False, cleanupError=str(error))
        report["wallSeconds"] = round(time.monotonic() - start, 2)
        (output / "result.json").write_text(json.dumps(report, indent=2) + "\n")
        print(f"Report: {output / 'result.json'}", flush=True)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
