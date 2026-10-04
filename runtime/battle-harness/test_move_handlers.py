"""Positive and negative checks for focused move-handler outcome oracles."""
from copy import deepcopy
import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("move_handlers", Path(__file__).resolve().parents[2] / "scripts/test-move-handlers.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def ruination_result(hp):
    return {"finished": True, "before": {"attacker": {"moveId": 877, "pp": 10},
                                         "defender": {"hp": hp, "substituteHp": 0}},
            "after": {"attacker": {"pp": 9, "turnFlags": 2, "previousMoveId": 877},
                      "defender": {"hp": hp - max(1, hp // 2), "substituteHp": 0}},
            "damageCalls": [], "rngOverrides": 0}


class CoachingTests(unittest.TestCase):
    def fixture(self):
        variant = {"battleType": "Doubles", "playerAbilityId": 99, "abilityId": 50,
                   "allySpecies": 149, "allyAbilityId": 50,
                   "defenderAllySpecies": 242, "defenderAllyAbilityId": 50}
        before = {role: {"slot": slot, "species": species, "ability": ability,
                         "hp": 100, "maxHp": 100, "statStages": [6]*7,
                         "moves": [{"id": 811 if role == "attacker" else 150, "pp": 10}],
                         "previousMoveId": 0, "turnFlags": 0}
                  for slot, (role,species,ability) in runner.expected_battlers(variant).items()}
        after = deepcopy(before)
        for role in after:
            after[role].update(previousMoveId=811 if role == "attacker" else 150, turnFlags=2)
            after[role]["moves"][0]["pp"] = 9
        after["ally"]["statStages"] = [7,7,6,6,6,6,6]
        return variant, {"id": "normal", "expectedAllyStages": [7,7,6,6,6,6,6]}, {
            "finished": True, "before": before, "after": after, "damageCalls": [],
            "battleSetup": {"rule": 1,"playerCount": 2,"trainerCount": 2}, "takeHeartEvents": [{"success": True}]}

    def test_actual_four_battlers_and_commands_pass(self):
        variant, case, result = self.fixture()
        self.assertTrue(runner.verify_coaching(case,result,variant)["passed"])

    def test_rejects_wrong_effect_or_fake_doubles(self):
        mutations = [lambda r: r["after"]["ally"]["statStages"].__setitem__(0,6),
                     lambda r: r["after"]["attacker"]["statStages"].__setitem__(0,7),
                     lambda r: r["after"]["defender"]["statStages"].__setitem__(0,7),
                     lambda r: r["after"].pop("defenderAlly"),
                     lambda r: r["battleSetup"].update(rule=0),
                     lambda r: r["battleSetup"].update(playerCount=1),
                     lambda r: r["takeHeartEvents"][0].update(success=False),
                     lambda r: r["after"]["ally"]["moves"][0].update(pp=10),
                     lambda r: r["after"]["ally"].update(previousMoveId=182),
                     lambda r: r["after"]["defenderAlly"].update(slot=12)]
        for mutation in mutations:
            variant, case, result = self.fixture()
            mutation(result)
            with self.assertRaises(AssertionError):
                runner.verify_coaching(case,result,variant)


class DoublesOracleTests(unittest.TestCase):
    def fixture(self, move=791):
        variant = {"moveId":move,"battleType":"Doubles","playerAbilityId":99,"abilityId":50,
                   "allySpecies":149,"allyAbilityId":50,"defenderAllySpecies":242,"defenderAllyAbilityId":50,"trainerMove":150}
        before = {role:{"slot":slot,"species":species,"ability":ability,"hp":100,"maxHp":200,
                        "level":50,"stats":[100]*5,"types":[13,13],"statStages":[6]*7,
                        "conditionFlags":0,"conditions":[0]*7,"substituteHp":0,
                        "moves":[{"id":move if role=="attacker" else 150,"pp":10}],
                        "turnFlags":0,"previousMoveId":0}
                  for slot,(role,species,ability) in runner.expected_battlers(variant).items()}
        after = deepcopy(before)
        for role,mon in after.items():
            mon.update(turnFlags=2,previousMoveId=move if role=="attacker" else 150)
            mon["moves"][0]["pp"]=9
        result = {"finished":True,"before":before,"after":after,"fullTurnValidated":True,
                  "battleSetup":{"rule":1,"playerCount":2,"trainerCount":2},"damageCalls":[],"criticalRanks":[],"coins":[]}
        return variant,result

    def test_healing_requires_real_status_preconditions_and_four_native_commands(self):
        variant,result = self.fixture()
        result["before"]["attacker"]["conditions"][4]=1
        result["before"]["ally"]["conditions"][5]=1
        result["after"]["attacker"]["hp"]=150
        result["after"]["ally"]["hp"]=150
        case={"id":"cure","expectedStatusesBefore":{"attacker":4,"ally":5},"expectedStatuses":{"attacker":0,"ally":0},"expectedHealing":{"attacker":50,"ally":50}}
        self.assertTrue(runner.verify_doubles(case,result,variant)["passed"])
        for mutation in (lambda r:r["before"]["attacker"].update(conditions=[0]*7),
                         lambda r:r["after"]["ally"].update(hp=149),
                         lambda r:r["after"]["defenderAlly"].update(previousMoveId=0),
                         lambda r:r.update(fullTurnValidated=False),
                         lambda r:r["battleSetup"].update(rule=0)):
            bad=deepcopy(result); mutation(bad)
            with self.assertRaises(AssertionError):runner.verify_doubles(case,bad,variant)

    def damage(self, move=874,power=120):
        variant,result=self.fixture(move)
        damage=((((22*power)//50+2)*3072+2047)//4096)*85//100
        for role in ("defender","defenderAlly"):
            result["damageCalls"].append({"attacker":deepcopy(result["before"]["attacker"]),
                "defender":deepcopy(result["before"][role]),"databasePower":power,"powerRewrites":[],
                "category":2,"moveType":8,"critical":0,"targetDamageRatio":3072,"preModifierDamage":damage,"calculatedDamage":damage})
            result["after"][role]["hp"]-=damage
        return variant,result

    def test_spread_power_damage_and_once_per_action_drop_are_independent(self):
        variant,result=self.damage()
        result["after"]["attacker"]["statStages"][2]=5
        result["coins"]=[{"amount":250,"accepted":True},{"amount":250,"accepted":True}]
        case={"id":"rain","expectedTargets":["defender","defenderAlly"],"expectedBasePower":120,"expectedSpread":True,
              "expectedStages":{"attacker":[6,6,5,6,6,6,6]},"expectedCoins":500}
        self.assertTrue(runner.verify_doubles(case,result,variant)["passed"])
        for mutation in (lambda r:r["damageCalls"][0].update(targetDamageRatio=4096),
                         lambda r:r["damageCalls"][0].update(databasePower=80),
                         lambda r:r["damageCalls"][0].update(preModifierDamage=999),
                         lambda r:r["damageCalls"].pop(),
                         lambda r:r["after"]["attacker"]["statStages"].__setitem__(2,4),
                         lambda r:r["coins"].pop()):
            bad=deepcopy(result); mutation(bad)
            with self.assertRaises(AssertionError):runner.verify_doubles(case,bad,variant)

    def test_liquid_ooze_is_processed_before_capped_healing(self):
        variant,result=self.damage(902,80)
        result["before"]["attacker"].update(hp=195,maxHp=200)
        result["after"]["attacker"]["hp"]=195
        case={"id":"ordered","expectedTargets":["defender","defenderAlly"],"expectedBasePower":80,"drain":True,"oozeRoles":["defenderAlly"]}
        self.assertTrue(runner.verify_doubles(case,result,variant)["passed"])
        result["after"]["attacker"]["hp"]=189
        with self.assertRaisesRegex(AssertionError,"ordered spread drain"):runner.verify_doubles(case,result,variant)

    def test_critical_stage_is_observed_not_inferred_from_the_focus_flag(self):
        variant,result=self.fixture(913)
        result["after"]["ally"]["conditionFlags"]=1<<9
        result["criticalRanks"]=[{"slot":1,"rank":1}]
        case={"id":"critical","expectedFocus":{"ally":True,"attacker":False},"expectedCriticalRanks":{"ally":1}}
        self.assertTrue(runner.verify_doubles(case,result,variant)["passed"])
        result["criticalRanks"][0]["rank"]=2
        with self.assertRaisesRegex(AssertionError,"critical rank"):runner.verify_doubles(case,result,variant)


class RuinationTests(unittest.TestCase):
    def test_persisted_worker_paths_are_relative_and_resolve_from_root(self):
        paths = runner.relative_worker_paths(runner.ROOT / "work/fixtures", runner.ROOT / "work/trials", Path(tempfile.gettempdir()) / "worker")
        for key, expected in (("directory", runner.ROOT / "work/fixtures"),
                              ("artifacts", runner.ROOT / "work/trials"),
                              ("workspace", Path(tempfile.gettempdir()) / "worker")):
            self.assertFalse(Path(paths[key]).is_absolute())
            self.assertEqual((runner.ROOT / paths[key]).resolve(), expected.resolve())
    def test_variant_filter_is_explicit_and_fail_closed(self):
        manifest = {"variants": [{"name": "draws"}, {"name": "parental-bond"}]}
        self.assertEqual(runner.select_variants(manifest, None), manifest["variants"])
        self.assertEqual(runner.select_variants(manifest, ["parental-bond"]), [manifest["variants"][1]])
        with self.assertRaisesRegex(AssertionError, "Unknown"):
            runner.select_variants(manifest, ["typo"])
        with self.assertRaisesRegex(AssertionError, "Duplicate"):
            runner.select_variants(manifest, ["draws", "draws"])

    def test_current_hp_rounding_and_minimum(self):
        for hp in (235, 101, 100, 2, 1):
            with self.subTest(hp=hp):
                result = runner.verify_ruination({"id": "hp"}, ruination_result(hp))
                self.assertEqual(result["hpLoss"], max(1, hp // 2))

    def test_damage_only_placeholder_is_rejected(self):
        result = ruination_result(235)
        result["after"]["defender"]["hp"] = 233
        with self.assertRaisesRegex(AssertionError, "expected 117"):
            runner.verify_ruination({"id": "placeholder"}, result)

    def test_half_maximum_instead_of_current_hp_is_rejected(self):
        result = ruination_result(101)
        result["after"]["defender"]["hp"] = 0
        with self.assertRaisesRegex(AssertionError, "expected 50"):
            runner.verify_ruination({"id": "current"}, result)

    def test_blocked_hits_must_do_no_damage(self):
        result = ruination_result(235)
        case = {"id": "protect", "blocked": True}
        with self.assertRaisesRegex(AssertionError, "Blocked Ruination"):
            runner.verify_ruination(case, result)
        result["after"]["defender"]["hp"] = 235
        self.assertTrue(runner.verify_ruination(case, result)["passed"])

    def test_accuracy_miss_requires_rng_to_have_run(self):
        result = ruination_result(235)
        result["after"]["defender"]["hp"] = 235
        case = {"id": "miss", "blocked": True, "forceMiss": True}
        with self.assertRaisesRegex(AssertionError, "never exercised"):
            runner.verify_ruination(case, result)
        result["rngOverrides"] = 1
        self.assertTrue(runner.verify_ruination(case, result)["passed"])

    def test_substitute_absorbs_fixed_damage(self):
        result = ruination_result(235)
        result["damageCalls"] = [{"defender": {"hp": 177, "substituteHp": 58}}]
        result["after"]["defender"].update(hp=177, substituteHp=0)
        case = {"id": "substitute", "substitute": True}
        self.assertTrue(runner.verify_ruination(case, result)["passed"])
        bad = deepcopy(result)
        bad["after"]["defender"]["hp"] = 89
        with self.assertRaisesRegex(AssertionError, "bypassed Substitute"):
            runner.verify_ruination(case, bad)
        bad = deepcopy(result)
        bad["after"]["defender"]["substituteHp"] = 1
        with self.assertRaisesRegex(AssertionError, "Wrong Substitute damage"):
            runner.verify_ruination(case, bad)

    def test_incomplete_or_wrong_move_or_unspent_pp_is_rejected(self):
        for mutate in (lambda r: r.update(finished=False),
                       lambda r: r["before"]["attacker"].update(moveId=33),
                       lambda r: r["after"]["attacker"].update(turnFlags=0),
                       lambda r: r["after"]["attacker"].update(previousMoveId=33),
                       lambda r: r["after"]["attacker"].update(pp=10)):
            result = ruination_result(235)
            mutate(result)
            with self.assertRaises(AssertionError):
                runner.verify_ruination({"id": "incomplete"}, result)

    def test_variant_patch_validates_expected_bytes(self):
        with tempfile.TemporaryDirectory() as root:
            rom = Path(root) / "test.nds"
            rom.write_bytes(b"\x01\x02\x03")
            runner.patch_rom(rom, [{"offset": 1, "expected": 2, "value": 4}])
            self.assertEqual(rom.read_bytes(), b"\x01\x04\x03")
            with self.assertRaisesRegex(AssertionError, "expected-byte"):
                runner.patch_rom(rom, [{"offset": 1, "expected": 2, "value": 4}])


class MagicPowderTests(unittest.TestCase):
    def result(self, success=True, reflected=False, events=1):
        before = {side: {"slot": 0 if side == "attacker" else 12, "types": [9, 9] if side == "attacker" else [10, 13],
                         "hp": 200, "pp": 20, "moveId": 750} for side in ("attacker", "defender")}
        after = deepcopy(before)
        after["attacker"].update(pp=19, turnFlags=2, previousMoveId=750)
        target = "attacker" if reflected else "defender"
        if success:
            after[target]["types"] = [13, 13]
        event = {"success": success, "before": deepcopy(before), "after": deepcopy(after),
                 "executingSlot": before["defender" if reflected else "attacker"]["slot"]}
        return {"id": "test", "typeChangeSuccess": success, "typeChangeSide": target, "typeChangeEvents": events}, {
            "finished": True, "before": before, "after": after, "damageCalls": [], "typeChangeEvents": [event] * events}

    def test_replacement_and_native_reflection_owner(self):
        for reflected in (False, True):
            case, result = self.result(reflected=reflected)
            self.assertTrue(runner.verify_magic_powder(case, result, {})["passed"])

    def test_empty_native_work_and_filtered_targets_are_failures(self):
        for events in (0, 1):
            case, result = self.result(success=False, events=events)
            self.assertTrue(runner.verify_magic_powder(case, result, {})["passed"])

    def test_placeholder_success_wrong_owner_and_added_not_replaced_are_rejected(self):
        for mutate in (lambda r: r["typeChangeEvents"][0].update(success=False),
                       lambda r: r["typeChangeEvents"][0].update(executingSlot=12),
                       lambda r: r["typeChangeEvents"][0]["after"]["defender"].update(types=[10, 13]),
                       lambda r: r["typeChangeEvents"][0]["after"]["attacker"].update(types=[13, 13]),
                       lambda r: r["typeChangeEvents"][0]["after"]["defender"].update(hp=199),
                       lambda r: r.update(damageCalls=[{}]),
                       lambda r: r["after"]["attacker"].update(pp=20)):
            case, result = self.result()
            mutate(result)
            with self.assertRaises(AssertionError):
                runner.verify_magic_powder(case, result, {})

    def test_stale_success_or_blocked_type_mutation_is_rejected(self):
        case, result = self.result(success=False, events=0)
        result["after"]["defender"]["types"] = [13, 13]
        with self.assertRaisesRegex(AssertionError, "Blocked"):
            runner.verify_magic_powder(case, result, {})
        case, result = self.result(success=False)
        result["typeChangeEvents"].append(deepcopy(result["typeChangeEvents"][0]))
        with self.assertRaisesRegex(AssertionError, "number"):
            runner.verify_magic_powder(case, result, {})

    def test_miss_requires_a_real_accuracy_roll(self):
        case, result = self.result(success=False, events=0)
        case["forceMiss"] = True
        result["accuracyRolls"] = []
        with self.assertRaisesRegex(AssertionError, "native accuracy"):
            runner.verify_magic_powder(case, result, {})
        result["accuracyRolls"] = [{"draw": 99, "threshold": 11}]
        self.assertTrue(runner.verify_magic_powder(case, result, {})["passed"])

    def test_returning_battler_uses_native_switch_event_not_ability_reregistration(self):
        emu = SimpleNamespace(frame_count=0, memory=SimpleNamespace(register_arm9=SimpleNamespace(r1=0x55)))
        observer = runner.Observer(emu, {"moveId": 750, "bench": True})
        observer.reset({"id": "return"})
        observer.mon_pointers = {12: 100, 13: 200}
        observer.pointers = {"defender": 200}
        with patch.object(runner, "read_event_var", return_value=12), patch.object(runner, "state", return_value={"slot": 12, "species": 143, "types": [0, 0]}):
            observer.event_dispatch(0, 0)
        self.assertEqual(observer.pointers["defender"], 100)
        self.assertEqual(observer.switch_in_events[0]["slot"], 12)
        with patch.object(runner, "read_event_var", return_value=14):
            with self.assertRaisesRegex(AssertionError, "unobserved"):
                observer.event_dispatch(0, 0)
        with patch.object(runner, "read_event_var", return_value=12), patch.object(runner, "state", return_value={"slot": 13}):
            with self.assertRaisesRegex(AssertionError, "stale"):
                observer.event_dispatch(0, 0)


class TakeHeartTests(unittest.TestCase):
    def result(self, snatched=False, success=True, capped=False, status=0):
        stages = [6, 6, 12, 12, 6, 6, 6] if capped else [6] * 7
        before = {
            side: {"moveId": 850, "pp": 5, "hp": 200, "substituteHp": 0,
                   "slot": 0 if side == "attacker" else 12,
                   "statStages": list(stages if side == ("defender" if snatched else "attacker") else [6] * 7),
                   "conditions": [1 if index == status and status else 0 for index in range(6)]}
            for side in ("attacker", "defender")
        }
        after = deepcopy(before)
        after["attacker"].update(pp=4, turnFlags=2, previousMoveId=850)
        after["defender"]["previousMoveId"] = 289 if snatched else 150
        executing = "defender" if snatched else "attacker"
        if success and not capped:
            after[executing]["statStages"][2:4] = [7, 7]
        after[executing]["conditions"] = [0] * 6
        result = {"finished": True, "before": before, "after": after, "damageCalls": [],
                  "takeHeartEvents": [{"used": True, "success": success, "after": deepcopy(after),
                                       "executingSlot": before[executing]["slot"]}]}
        case = {"id": "test", "expectedUserStages": after["attacker"]["statStages"],
                "expectedDefenderStages": after["defender"]["statStages"], "takeHeartSuccess": success,
                "snatched": snatched, "userStages": before["attacker"]["statStages"],
                "defenderStages": before["defender"]["statStages"],
                "userStatusBefore": status, "defenderStatusBefore": status}
        return deepcopy(case), result

    def test_native_benefits_and_status_only_success(self):
        for snatched, capped, status, success in ((False, False, 0, True), (False, True, 0, False),
                                                 (False, True, 4, True), (True, True, 5, True)):
            case, result = self.result(snatched, success, capped, status)
            self.assertTrue(runner.verify_take_heart(case, result, {})["passed"])

    def test_false_success_wrong_stat_and_wrong_cure_are_rejected(self):
        case, result = self.result(capped=True, success=False)
        result["takeHeartEvents"][0]["success"] = True
        with self.assertRaisesRegex(AssertionError, "success/failure"):
            runner.verify_take_heart(case, result, {})
        case, result = self.result()
        result["after"]["attacker"]["statStages"][0] = 7
        with self.assertRaisesRegex(AssertionError, "user stat"):
            runner.verify_take_heart(case, result, {})
        case, result = self.result(snatched=True, status=5)
        result["after"]["attacker"]["conditions"][5] = 0
        with self.assertRaisesRegex(AssertionError, "wrong battler"):
            runner.verify_take_heart(case, result, {})

    def test_missing_or_duplicate_execution_is_rejected(self):
        for events in ([], [{"used": False}], [{}, {}]):
            case, result = self.result()
            result["takeHeartEvents"] = events
            with self.assertRaises(AssertionError):
                runner.verify_take_heart(case, result, {})

    def test_event_scope_reader_uses_current_scope_and_sentinel(self):
        base = 0x021db3f0
        longs = {base: 3, base + 0xc4: 999, base + 0xc4 + 4 * 4: 850}
        shorts = {base + 4: 0x12, base + 4 + 2 * 3: 3, base + 4 + 2 * 4: 0x12,
                  base + 4 + 2 * 5: 0}
        emu = SimpleNamespace(memory=SimpleNamespace(read_long=lambda at: longs[at], read_short=lambda at: shorts[at]))
        self.assertEqual(runner.read_event_var(emu, 0x12), 850)
        self.assertEqual(runner.read_event_var(emu, 77), 0)
        longs[base] = 97
        with self.assertRaisesRegex(AssertionError, "scope"):
            runner.read_event_var(emu, 0x12)


def power_result(move_id=754, powers=(170,), statuses=(), acted=(False,)):
    before = {"attacker": {"moveId": move_id, "pp": 10},
              "defender": {"hp": 235, "substituteHp": 0}}
    calls = []
    for index, (power, has_acted) in enumerate(zip(powers, acted)):
        conditions = [0] * 6
        for status in statuses:
            conditions[status] = 1
        base = 60 if move_id == 839 else 1 if move_id == 912 else 80 if move_id in (788, 875, 907) else 100 if move_id in (878, 879) else 85
        defender = {"species": 143, "hp": 235 - 30 * index, "substituteHp": 0, "stats": [85] * 5,
                    "conditions": conditions, "turnFlags": 2 if has_acted else 0}
        calls.append({"attacker": {"level": 50, "stats": [120] * 5}, "defender": defender,
                      "category": 1, "critical": 0, "powerRewrites": [power] if power != base else [],
                      "preModifierDamage": ((22 * power * 120 // 85) // 50 + 2) * 85 // 100,
                      "calculatedDamage": 30})
    after = {"attacker": {"pp": 10 - len(calls), "turnFlags": 2, "previousMoveId": move_id},
             "defender": {"hp": 235 - 30 * len(calls), "substituteHp": 0, "conditions": calls[-1]["defender"]["conditions"]}}
    return {"finished": True, "before": before, "after": after, "damageCalls": calls, "rngOverrides": 1}


class AuraWheelTests(unittest.TestCase):
    variant = {"moveId": 783, "power": 110, "category": 1, "type": 12,
               "playerSpecies": 877, "playerForm": 1}

    def result(self, transformed=False):
        result = power_result(783, (110,))
        species = 151 if transformed else 877
        for phase in ("before", "after"):
            result[phase]["attacker"].update(species=species, currentSpecies=877, form=1,
                transformed=transformed, statStages=[6, 6, 6, 6, 6 if phase == "before" else 7, 6, 6])
        result["damageCalls"][0].update(moveType=16, powerRewrites=[])
        if transformed:
            result["setup"] = [{"after": {"attacker": {"previousMoveId": 144}}}]
            result["before"]["attacker"]["pp"] = 5
            result["after"]["attacker"]["pp"] = 4
            for phase in ("before", "after"):
                result[phase]["attacker"]["originalMoves"] = [{"id": 783, "pp": 10}]
        return result

    def test_observer_reads_surface_pp_and_gates_transform_species(self):
        pointer = 0x02001000
        words = {pointer + 12: 151, pointer + 0xec: 877, pointer + 27: 0x20,
                 pointer + 0x104: 783, pointer + 0x106: 10,
                 pointer + 0x10a: 783, pointer + 0x10c: 5}
        memory = SimpleNamespace(read_short=lambda at: words.get(at, 0),
                                 read_byte=lambda at: words.get(at, 0),
                                 read_long=lambda at: words.get(at, 0))
        mon = runner.state(SimpleNamespace(memory=memory), pointer)
        self.assertEqual(mon["species"], 151)
        self.assertEqual(mon["currentSpecies"], 877)
        self.assertEqual(mon["moves"][0], {"id": 783, "pp": 5})
        self.assertEqual(mon["originalMoves"][0], {"id": 783, "pp": 10})
        words[pointer + 27] = 0x80
        self.assertEqual(runner.state(SimpleNamespace(memory=memory), pointer)["currentSpecies"], 151)

    def test_form_type_and_native_transform_current_species(self):
        case = {"id": "hangry", "expectedMoveType": 16, "expectedPowers": [110]}
        self.assertTrue(runner.verify_aura_wheel(case, self.result(), self.variant)["passed"])
        case.update(transformed=True, expectedCurrentSpecies=877, expectedForm=1)
        variant = {**self.variant, "playerSpecies": 151, "playerForm": 0}
        self.assertTrue(runner.verify_aura_wheel(case, self.result(True), variant)["passed"])
        for mutate in (lambda r: r["before"]["attacker"].update(currentSpecies=151),
                       lambda r: r["before"]["attacker"].update(species=877),
                       lambda r: r["before"]["attacker"].update(transformed=False),
                       lambda r: r.update(setup=[]),
                       lambda r: r["after"]["attacker"]["originalMoves"][0].update(pp=9)):
            bad = self.result(True)
            mutate(bad)
            with self.assertRaises(AssertionError):
                runner.verify_aura_wheel(case, bad, variant)

    def test_wrong_resolved_type_or_unearned_speed_boost_is_rejected(self):
        case = {"id": "hangry", "expectedMoveType": 16, "expectedPowers": [110]}
        result = self.result()
        result["damageCalls"][0]["moveType"] = 12
        with self.assertRaisesRegex(AssertionError, "resolved move type"):
            runner.verify_aura_wheel(case, result, self.variant)
        result = self.result()
        result["damageCalls"] = []
        result["after"]["defender"]["hp"] = 235
        with self.assertRaisesRegex(AssertionError, "stat changes"):
            runner.verify_aura_wheel({"id": "failed", "blocked": True}, result, self.variant)
        result["after"]["attacker"]["statStages"] = [6] * 7
        self.assertTrue(runner.verify_aura_wheel({"id": "failed", "blocked": True}, result, self.variant)["passed"])

    def test_actual_type_is_used_for_stab_not_the_record_default(self):
        case = {"id": "normalize", "expectedMoveType": 0, "expectedPowers": [110]}
        result = self.result()
        result["damageCalls"][0].update(moveType=0)
        result["damageCalls"][0]["attacker"]["types"] = [12, 16]
        self.assertTrue(runner.verify_aura_wheel(case, result, self.variant)["passed"])
        result["damageCalls"][0]["preModifierDamage"] = (result["damageCalls"][0]["preModifierDamage"] * 6144 + 2047) >> 12
        with self.assertRaisesRegex(AssertionError, "pre-modifier damage"):
            runner.verify_aura_wheel(case, result, self.variant)

    def test_override_requires_native_opponent_action_and_protean_type(self):
        case = {"id": "override", "expectedMoveType": 16, "expectedPowers": [110],
                "requiredOpponentMove": 582, "expectedUserTypes": [16, 16]}
        result = self.result()
        result["damageCalls"][0]["defender"].update(previousMoveId=582, turnFlags=2)
        result["damageCalls"][0]["attacker"]["types"] = [16, 16]
        result["damageCalls"][0]["preModifierDamage"] = (result["damageCalls"][0]["preModifierDamage"] * 6144 + 2047) >> 12
        self.assertTrue(runner.verify_aura_wheel(case, result, self.variant)["passed"])
        for mutate in (lambda r: r["damageCalls"][0]["defender"].update(previousMoveId=150),
                       lambda r: r["damageCalls"][0]["defender"].update(turnFlags=0),
                       lambda r: r["damageCalls"][0]["attacker"].update(types=[12, 16])):
            bad = deepcopy(result)
            mutate(bad)
            with self.assertRaises(AssertionError):
                runner.verify_aura_wheel(case, bad, self.variant)


class DireClawTests(unittest.TestCase):
    variant = {"moveId": 827, "power": 80, "category": 1, "type": 3}

    def result(self, status, rolls):
        result = power_result(827, (80,))
        result["after"]["defender"]["conditions"] = [0] * 6
        if status:
            result["after"]["defender"]["conditions"][status] = 1
        result["statusRng"] = [{"bound": bound, "draw": draw} for bound, draw in rolls]
        return result

    def test_activation_and_uniform_choice(self):
        for choice, status in enumerate((5, 1, 2)):
            case = {"id": "choice", "expectedPowers": [80], "secondaryRoll": 49, "statusChoice": choice,
                    "statusAfter": status, "chanceRolls": 1, "choiceRolls": 1,
                    "sleepDurationRolls": int(status == 2)}
            rolls = [(100, 49), (3, choice)] + ([(3, 2)] if status == 2 else [])
            self.assertTrue(runner.verify_dire_claw(case, self.result(status, rolls), self.variant)["passed"])
            with self.assertRaisesRegex(AssertionError, "secondary status"):
                runner.verify_dire_claw(case, self.result(0, rolls), self.variant)
            with self.assertRaisesRegex(AssertionError, "before checking"):
                runner.verify_dire_claw(case, self.result(status, list(reversed(rolls))), self.variant)

    def test_failure_and_immunity_never_reroll(self):
        case = {"id": "immune", "expectedPowers": [80], "secondaryRoll": 0, "statusChoice": 0,
                "statusAfter": 0, "chanceRolls": 1, "choiceRolls": 1}
        self.assertTrue(runner.verify_dire_claw(case, self.result(0, [(100, 0), (3, 0)]), self.variant)["passed"])
        with self.assertRaisesRegex(AssertionError, "rerolled"):
            runner.verify_dire_claw(case, self.result(0, [(100, 0), (3, 0), (3, 1)]), self.variant)
        case.update(secondaryRoll=50, choiceRolls=0)
        self.assertTrue(runner.verify_dire_claw(case, self.result(0, [(100, 50)]), self.variant)["passed"])
        with self.assertRaisesRegex(AssertionError, "rerolled"):
            runner.verify_dire_claw(case, self.result(0, [(100, 50), (3, 0)]), self.variant)

    def test_rng_scope_ends_before_the_next_ai_action(self):
        callbacks = {}
        registers = SimpleNamespace(r0=100, r1=0x4b, lr=0x2001)
        memory = SimpleNamespace(register_arm9=registers,
            register_exec=lambda address, callback: callbacks.setdefault(address, callback))
        observer = runner.Observer(SimpleNamespace(memory=memory, frame_count=1),
                                   {"moveId": 827, "controlledRng": True})
        observer.reset({"secondaryRoll": 0})
        observer.damage = [{}]
        observer.event_dispatch(None, 0)
        self.assertTrue(observer.status_window)
        registers.r1 = 0x64
        observer.event_dispatch(None, 0)
        self.assertTrue(observer.status_window)
        registers.lr = 0x2003
        observer.random(None, 0)
        registers.r0 = 9
        callbacks[0x2002](None, 0x2002)
        self.assertEqual(len(observer.status_rng), 1)
        callbacks[0x2000](None, 0x2000)
        self.assertFalse(observer.status_window)
        registers.r0 = 100
        observer.random(None, 0)
        registers.r0 = 9
        callbacks[0x2002](None, 0x2002)
        self.assertEqual(len(observer.status_rng), 1)


class DamageShieldTests(unittest.TestCase):
    def fixture(self, move_id=792, blocks=True, retaliation=True, status=False):
        user = {"moveId": move_id, "pp": 10, "turnFlags": 0, "hp": 200, "slot": 0,
                "statStages": [6]*7, "conditions": [0]*6}
        enemy = {"hp": 200, "slot": 12, "statStages": [6]*7, "conditions": [0]*6}
        before = {"attacker": user, "defender": enemy}
        after = deepcopy(before)
        after["attacker"].update(pp=9, turnFlags=2, previousMoveId=move_id)
        after["defender"]["previousMoveId"] = 92 if status else 33
        if retaliation:
            if move_id == 908:
                after["defender"]["conditions"][4] = 1
            else:
                after["defender"]["statStages"][1 if move_id == 792 else 4] -= 2 if move_id == 792 else 1
        if status:
            after["attacker"]["conditions"][5] = 1
        protected = deepcopy(after)
        protected["attacker"]["turnFlags"] |= 1 << 7
        variant = {"moveId": move_id, "trainerMove": 92 if status else 33}
        case = {"id": "shield", "shieldBlocks": blocks, "shieldRetaliates": retaliation,
                **({"shieldBypass": 2, "expectedUserStatus": 5} if status else {})}
        result = {"finished": True, "before": before, "after": after, "damageCalls": [],
                  "shieldEvents": [{"success": True, "executingSlot": 0, "after": protected}],
                  "shieldBreakEvents": [{"result": 2 if status else 0}],
                  "shieldHitEvents": [{"attackingSlot": 12, "defendingSlot": 0, "after": deepcopy(after)}] if blocks else [],
                  "incomingDamageCalls": []}
        return case, result, variant

    def test_each_guard_specific_contact_effect(self):
        for move in (792, 852, 908):
            case, result, variant = self.fixture(move)
            self.assertTrue(runner.verify_damage_shield(case, result, variant)["passed"])

    def test_placeholder_wrong_stat_owner_and_contact_damage_are_rejected(self):
        for mutate in (lambda r: r["shieldEvents"].clear(),
                       lambda r: r["shieldEvents"][0].update(success=False),
                       lambda r: r["shieldEvents"][0].update(executingSlot=12),
                       lambda r: r["shieldEvents"][0]["after"]["attacker"].update(turnFlags=2),
                       lambda r: r["after"]["defender"].update(statStages=[6]*7),
                       lambda r: r["shieldHitEvents"][0]["after"]["defender"].update(hp=180),
                       lambda r: r["incomingDamageCalls"].append({})):
            case, result, variant = self.fixture()
            mutate(result)
            with self.assertRaises(AssertionError):
                runner.verify_damage_shield(case, result, variant)

    def test_status_bypass_requires_native_target_condition(self):
        case, result, variant = self.fixture(blocks=False, retaliation=False, status=True)
        self.assertTrue(runner.verify_damage_shield(case, result, variant)["passed"])
        for mutate in (lambda r: r["shieldBreakEvents"][0].update(result=0),
                       lambda r: r["after"]["attacker"].update(conditions=[0]*6),
                       lambda r: r["shieldHitEvents"].append({})):
            bad = deepcopy(result)
            mutate(bad)
            with self.assertRaises(AssertionError):
                runner.verify_damage_shield(case, bad, variant)

    def test_contact_burn_and_no_contact_retaliation_have_distinct_oracles(self):
        case, result, variant = self.fixture(908)
        result["after"]["defender"]["conditions"][4] = 0
        with self.assertRaisesRegex(AssertionError, "retaliation status"):
            runner.verify_damage_shield(case, result, variant)
        case, result, variant = self.fixture(retaliation=False)
        self.assertTrue(runner.verify_damage_shield(case, result, variant)["passed"])
        result["after"]["defender"]["statStages"][1] = 4
        with self.assertRaisesRegex(AssertionError, "retaliation stages"):
            runner.verify_damage_shield(case, result, variant)

    def test_next_turn_cleanup_requires_restored_damage_and_no_callback(self):
        case, result, variant = self.fixture()
        case["followup"] = {"case": {}}
        next_result = deepcopy(result)
        next_result["before"]["attacker"].update(moveId=150, pp=40)
        next_result["after"]["attacker"].update(previousMoveId=150, pp=39, hp=180)
        next_result.update(shieldEvents=[], shieldHitEvents=[], incomingDamageCalls=[{}])
        result["followup"] = next_result
        self.assertTrue(runner.verify_damage_shield(case, result, variant)["passed"])
        next_result["shieldHitEvents"].append({})
        with self.assertRaisesRegex(AssertionError, "leaked"):
            runner.verify_damage_shield(case, result, variant)


class HazardTests(unittest.TestCase):
    variant = {"moveId": 845, "power": 65, "category": 1, "type": 16}
    case = {"id": "hit", "expectedPowers": [65], "expectedHazards": 1, "hazardsBefore": 0}

    def result(self):
        result = power_result(845, (65,))
        empty = {"handler": 0, "condition": 0, "layers": 0}
        result["beforeSideEffects"] = [{"6": deepcopy(empty), "8": deepcopy(empty)} for _ in range(2)]
        result["afterSideEffects"] = deepcopy(result["beforeSideEffects"])
        result["afterSideEffects"][1]["6"] = {"handler": 0x02080000, "condition": 1, "layers": 1}
        return result

    def test_damage_only_or_wrong_side_or_nonpermanent_hazard_is_rejected(self):
        self.assertTrue(runner.verify_hazard(self.case, self.result(), self.variant)["passed"])
        for mutate in (lambda r: r["afterSideEffects"][1]["6"].update(layers=0),
                       lambda r: r["afterSideEffects"][1]["6"].update(handler=0),
                       lambda r: r["afterSideEffects"][1]["6"].update(condition=2),
                       lambda r: r["afterSideEffects"][0]["8"].update(layers=1, handler=0x02090000, condition=1)):
            bad = self.result()
            mutate(bad)
            with self.assertRaises(AssertionError):
                runner.verify_hazard(self.case, bad, self.variant)

    def test_three_layer_cap_and_native_initial_layers_are_checked(self):
        result = self.result()
        case = {**self.case, "hazardsBefore": 3, "expectedHazards": 3}
        result["beforeSideEffects"][1]["6"] = {"handler": 0x02080000, "condition": 1, "layers": 3}
        result["afterSideEffects"][1]["6"]["layers"] = 3
        self.assertTrue(runner.verify_hazard(case, result, self.variant)["passed"])
        result["afterSideEffects"][1]["6"]["layers"] = 4
        with self.assertRaises(AssertionError):
            runner.verify_hazard(case, result, self.variant)


class SteelRollerTests(unittest.TestCase):
    variant = {"moveId": 798, "power": 130, "category": 1, "type": 8}
    case = {"id": "terrain", "expectedPowers": [130], "terrainEndMessages": 1,
            "followup": {"slot": 0, "moveId": 798, "power": 130, "category": 1, "type": 8,
                         "case": {"id": "removed", "blocked": True, "terrainEndMessages": 0}}}

    def result(self):
        result = power_result(798, (130,))
        result["terrainEndMessages"] = [{"mode": 2}]
        followup = power_result(798, (130,))
        followup["damageCalls"] = []
        followup["after"]["defender"]["hp"] = followup["before"]["defender"]["hp"]
        followup["terrainEndMessages"] = []
        result["followup"] = followup
        return result

    def test_success_requires_removal_and_later_failure(self):
        self.assertTrue(runner.verify_steel_roller(self.case, self.result(), self.variant)["passed"])
        for mutate in (lambda r: r.update(terrainEndMessages=[]),
                       lambda r: r.pop("followup"),
                       lambda r: r["followup"].update(damageCalls=r["damageCalls"])):
            bad = self.result()
            mutate(bad)
            with self.assertRaises(AssertionError):
                runner.verify_steel_roller(self.case, bad, self.variant)

    def test_blocked_attack_cannot_remove_terrain(self):
        result = self.result()["followup"]
        case = self.case["followup"]["case"]
        self.assertTrue(runner.verify_steel_roller(case, result, self.variant)["passed"])
        result["terrainEndMessages"] = [{"mode": 2}]
        with self.assertRaisesRegex(AssertionError, "announcement count"):
            runner.verify_steel_roller(case, result, self.variant)

    def test_selected_followup_slot_must_spend_its_own_pp(self):
        result = self.result()
        result["selectedMoveSlot"] = 2
        result["before"]["attacker"]["moves"] = [{"id": 875, "pp": 9}, {"id": 604, "pp": 9}, {"id": 798, "pp": 5}]
        result["after"]["attacker"]["moves"] = [{"id": 875, "pp": 9}, {"id": 604, "pp": 9}, {"id": 798, "pp": 4}]
        runner.verify_completed(result, 798)
        result["after"]["attacker"]["moves"][2]["pp"] = 5
        with self.assertRaisesRegex(AssertionError, "exactly 1 PP"):
            runner.verify_completed(result, 798)


class HpCostBoostTests(unittest.TestCase):
    def result(self, move=775, snatched=False, success=True, berry=False):
        before = {"attacker": {"moveId": move, "pp": 5, "hp": 175, "maxHp": 175,
                  "slot": 0, "statStages": [6] * 7, "substituteHp": 0, "item": 0},
                  "defender": {"hp": 235, "maxHp": 235, "slot": 6, "statStages": [6] * 7, "item": 0}}
        owner = "defender" if snatched else "attacker"
        if berry:
            before[owner].update(hp=100, item=158)
        after = deepcopy(before)
        after["attacker"].update(pp=4, turnFlags=2, previousMoveId=move)
        after["defender"]["previousMoveId"] = 289 if snatched else 150
        stats = range(5) if move == 775 else (0, 2, 4)
        if success:
            for index in stats:
                after[owner]["statStages"][index] += 1 if move == 775 else 2
            cost = before[owner]["maxHp"] * 33 // 100 if move == 775 else before[owner]["maxHp"] // 2
            after[owner]["hp"] -= cost
            if berry:
                after[owner]["hp"] += before[owner]["maxHp"] // 4
                after[owner]["item"] = 0
        event = {"used": success, "success": success, "executingSlot": before[owner]["slot"],
                 "before": deepcopy(before), "after": deepcopy(after)}
        result = {"finished": True, "before": before, "after": after, "damageCalls": [], "takeHeartEvents": [event]}
        case = {"id": "boost", "hpBoostSuccess": success, "snatched": snatched, "berryHealing": berry,
                "expectedUserStages": after["attacker"]["statStages"], "expectedDefenderStages": after["defender"]["statStages"]}
        return deepcopy(case), result, {"moveId": move}

    def test_cost_rounding_native_ownership_and_berry(self):
        for move in (775, 868):
            for snatched, berry in ((False, False), (True, False), (False, True)):
                args = self.result(move, snatched, berry=berry)
                self.assertTrue(runner.verify_hp_cost_boost(*args)["passed"])
                args[1]["after"]["defender" if snatched else "attacker"]["hp"] += 1
                with self.assertRaisesRegex(AssertionError, "payment"):
                    runner.verify_hp_cost_boost(*args)

    def test_failures_must_not_pay_or_queue_success(self):
        args = self.result(success=False)
        self.assertTrue(runner.verify_hp_cost_boost(*args)["passed"])
        args[1]["takeHeartEvents"][0]["used"] = True
        with self.assertRaisesRegex(AssertionError, "native work"):
            runner.verify_hp_cost_boost(*args)
        args = self.result(success=False)
        args[1]["after"]["attacker"]["hp"] -= 57
        with self.assertRaisesRegex(AssertionError, "payment"):
            runner.verify_hp_cost_boost(*args)

    def test_wrong_owner_partial_or_invented_sound_execution_rejected(self):
        args = self.result(snatched=True)
        args[1]["takeHeartEvents"][0]["executingSlot"] = 0
        with self.assertRaisesRegex(AssertionError, "owner"):
            runner.verify_hp_cost_boost(*args)
        args = self.result()
        args[1]["after"]["attacker"]["statStages"][0] = 6
        with self.assertRaisesRegex(AssertionError, "stages"):
            runner.verify_hp_cost_boost(*args)
        args = self.result(success=False)
        args[0]["hpBoostEvents"] = 0
        with self.assertRaisesRegex(AssertionError, "effect count"):
            runner.verify_hp_cost_boost(*args)

    def test_rejected_selection_is_not_a_completed_action(self):
        case, result, variant = self.result(success=False)
        result["before"]["attacker"].update(previousMoveId=150, turnFlags=0)
        result["after"] = deepcopy(result["before"])
        result.update(selectionRejected=True, selectionChecks=[{"moveId":775, "result":1}], takeHeartEvents=[])
        case.update(selectionRejected=True, hpBoostEvents=0)
        self.assertTrue(runner.verify_hp_cost_boost(case, result, variant)["passed"])
        for mutate in (lambda r: r.update(selectionChecks=[]),
                       lambda r: r["selectionChecks"][0].update(result=0),
                       lambda r: r["after"]["attacker"].update(pp=4),
                       lambda r: r["after"]["attacker"].update(previousMoveId=775),
                       lambda r: r["after"]["attacker"].update(hp=118)):
            bad = deepcopy(result)
            mutate(bad)
            with self.assertRaises(AssertionError):
                runner.verify_hp_cost_boost(case, bad, variant)

    def test_selection_matches_client_identity_not_server_pointer(self):
        callbacks = {}
        registers = SimpleNamespace(r1=200, r2=775, r3=300, lr=401, r0=1)
        emu = SimpleNamespace(memory=SimpleNamespace(register_arm9=registers,
            register_exec=lambda address, callback: callbacks.setdefault(address, callback)))
        observer = runner.Observer.__new__(runner.Observer)
        observer.emu, observer.case, observer.active_move_id = emu, {"selectionRejected":True}, 775
        observer.pointers, observer.selection_pending = {"attacker":100}, {}
        observer.returns, observer.selection_checks, observer.errors = {}, [], []
        with patch.object(runner, "state", return_value={"slot":0, "species":151}):
            observer.selection(None, 0)
            callbacks[400](None, 400)
        self.assertEqual(observer.selection_checks[0]["clientPointer"], 200)
        self.assertEqual(observer.selection_checks[0]["result"], 1)

    def test_later_enemy_damage_is_not_charged_as_payment(self):
        case, result, variant = self.result(move=868)
        case["requiredOpponentMove"] = 675
        enemy = result["before"]["defender"]
        enemy.update(moveId=675, pp=15, previousMoveId=675, turnFlags=0,
                     level=10, stats=[30,21,21,33,12], types=[0,0], substituteHp=0)
        result["after"]["defender"] = deepcopy(enemy)
        result["after"]["defender"].update(pp=14, turnFlags=2)
        event = result["takeHeartEvents"][0]
        event["after"]["defender"] = deepcopy(enemy)
        event["after"]["attacker"].update(species=151, stats=[120]*5, types=[13,13])
        call = {"attacker":deepcopy(enemy), "defender":deepcopy(event["after"]["attacker"]),
                "category":1, "critical":0, "powerRewrites":[], "preModifierDamage":6,
                "calculatedDamage":6, "damageRatio":4096}
        result["after"]["attacker"]["hp"] -= 6
        result.update(incomingDamageCalls=[call], rngOverrides=1)
        self.assertTrue(runner.verify_hp_cost_boost(case, result, variant)["passed"])
        for mutate in (lambda r: r["incomingDamageCalls"][0].update(calculatedDamage=5),
                       lambda r: r["takeHeartEvents"][0]["after"]["attacker"].update(hp=82),
                       lambda r: r.update(rngOverrides=0)):
            bad = deepcopy(result)
            mutate(bad)
            with self.assertRaises(AssertionError):
                runner.verify_hp_cost_boost(case, bad, variant)


class MaximumHpCostTests(unittest.TestCase):
    def result(self, move=796, power=140, hp=175, maximum=175, pays=True):
        result = power_result(move, (power,))
        result["damageCalls"][0].update(category=2, calculatedDamage=result["damageCalls"][0]["preModifierDamage"], damageRatio=4096)
        result["after"]["defender"]["hp"] = 235-result["damageCalls"][0]["calculatedDamage"]
        result["before"]["attacker"].update(hp=hp, maxHp=maximum, statStages=[6] * 7)
        result["after"]["attacker"].update(hp=max(0,hp-(maximum+1)//2) if pays else hp, statStages=[6] * 7)
        result["accuracyRolls"] = [{"threshold":95,"draw":0}]
        case = {"id":"cost", "expectedPowers":[power], "ppSpent":1, "paysHpCost":pays, "damageRatios":[4096]}
        variant = {"moveId":move, "power":power, "category":2}
        return case, result, variant

    def test_maximum_not_current_hp_rounding_and_faint_cap(self):
        for maximum,hp in ((175,175),(178,178),(175,87),(175,1)):
            case,result,variant = self.result(hp=hp,maximum=maximum)
            self.assertTrue(runner.verify_maximum_hp_cost(case,result,variant)["passed"])
            result["after"]["attacker"]["hp"] += 1
            with self.assertRaisesRegex(AssertionError,"maximum-HP cost"):
                runner.verify_maximum_hp_cost(case,result,variant)

    def test_zero_cost_policy_and_damage_are_separate(self):
        case,result,variant = self.result(move=835,power=150,pays=False)
        self.assertTrue(runner.verify_maximum_hp_cost(case,result,variant)["passed"])
        result["after"]["attacker"]["hp"] -= 1
        with self.assertRaisesRegex(AssertionError,"maximum-HP cost"):
            runner.verify_maximum_hp_cost(case,result,variant)

    def test_ability_suppression_and_accuracy_preconditions_fail_closed(self):
        case,result,variant = self.result()
        case.update(expectedUserAbilitySuppressed=True, expectedAccuracyRolls=1)
        result["damageCalls"][0]["attacker"]["gastroAcidCondition"] = 1
        self.assertTrue(runner.verify_maximum_hp_cost(case,result,variant)["passed"])
        for mutate in (lambda r:r["damageCalls"][0]["attacker"].update(gastroAcidCondition=0),
                       lambda r:r.update(accuracyRolls=[]),
                       lambda r:r["accuracyRolls"][0].update(threshold=100),
                       lambda r:r["after"]["attacker"].update(statStages=[6,6,6,6,5,6,6])):
            bad=deepcopy(result)
            mutate(bad)
            with self.assertRaises(AssertionError):
                runner.verify_maximum_hp_cost(case,bad,variant)


class TripleAxelTests(unittest.TestCase):
    variant = {"moveId": 813, "power": 20, "category": 1, "type": 14}

    def result(self, powers=(20, 40, 60), draws=(0, 0, 0, 99), contact=0):
        result = power_result(813, powers, acted=[False] * len(powers))
        result["before"]["attacker"].update(hp=200, maxHp=200)
        result["after"]["attacker"].update(pp=9, hp=200-contact*len(powers))
        hp = 235
        for index, call in enumerate(result["damageCalls"]):
            call["attacker"].update(hp=200-contact*index)
            call["defender"]["hp"] = hp
            call.update(moveType=14, calculatedDamage=call["preModifierDamage"], damageRatio=4096)
            hp -= call["calculatedDamage"]
        result["after"]["defender"]["hp"] = hp
        result["accuracyRolls"] = [{"threshold": 90, "draw": draw} for draw in draws]
        case = {"id": "sequence", "expectedPowers": list(powers), "accuracyDraws": list(draws), "ppSpent": 1}
        if contact:
            case["contactCostDivisor"] = 8
        return case, result

    def test_escalation_and_miss_stop_are_not_flat_three_hits(self):
        for powers, draws in (((20, 40, 60), (89, 89, 89, 99)), ((20,), (89, 90)), ((20, 40), (89, 89, 90))):
            case, result = self.result(powers, draws)
            self.assertTrue(runner.verify_triple_axel(case, result, self.variant)["passed"])
            bad = deepcopy(result)
            bad["damageCalls"][-1]["powerRewrites"] = []
            if len(powers) > 1:
                with self.assertRaises(AssertionError):
                    runner.verify_triple_axel(case, bad, self.variant)

    def test_skill_link_requires_only_one_controlled_accuracy_check(self):
        case, result = self.result(draws=(89,))
        self.assertTrue(runner.verify_triple_axel(case, result, self.variant)["passed"])
        result["accuracyRolls"].append({"threshold": 90, "draw": 99})
        with self.assertRaisesRegex(AssertionError, "accuracy checks"):
            runner.verify_triple_axel(case, result, self.variant)

    def test_contact_cost_must_happen_between_hits_and_after_last(self):
        case, result = self.result(contact=25)
        self.assertTrue(runner.verify_triple_axel(case, result, self.variant)["passed"])
        for mutate in (lambda r: r["damageCalls"][1]["attacker"].update(hp=200),
                       lambda r: r["after"]["attacker"].update(hp=200)):
            bad = deepcopy(result)
            mutate(bad)
            with self.assertRaisesRegex(AssertionError, "ontact"):
                runner.verify_triple_axel(case, bad, self.variant)

    def test_disguise_absorbs_one_strike_with_one_cost_not_the_sequence(self):
        case, result = self.result()
        case.update(expectedDisguise=True, damageRatios=[4096] * 3)
        result["before"]["defender"].update(species=778, form=0, maxHp=235)
        hp = 235
        for index, call in enumerate(result["damageCalls"]):
            call["defender"].update(species=778, form=int(index > 0), hp=hp, maxHp=235)
            if index == 0:
                call["calculatedDamage"] = 0
                hp -= 235 // 8
            hp -= call["calculatedDamage"]
        result["after"]["defender"].update(hp=hp, form=1)
        self.assertTrue(runner.verify_triple_axel(case, result, self.variant)["passed"])
        for mutate in (lambda r: r["damageCalls"][0].update(calculatedDamage=11),
                       lambda r: r["damageCalls"][1]["defender"].update(form=0),
                       lambda r: r["after"]["defender"].update(hp=hp+235//8),
                       lambda r: r.update(damageCalls=r["damageCalls"][:1])):
            bad = deepcopy(result)
            mutate(bad)
            with self.assertRaises(AssertionError):
                runner.verify_triple_axel(case, bad, self.variant)


class TerrainPulseTests(unittest.TestCase):
    variant = {"moveId": 805, "power": 50, "category": 2, "type": 0}

    def result(self, power=100, effective=130, type_=12):
        result = power_result(805, (power,))
        call = result["damageCalls"][0]
        damage = (22 * effective * 120 // 85 // 50 + 2) * 85 // 100
        call.update(category=2, moveType=type_, powerRewrites=[power] if power != 50 else [],
                    preModifierDamage=damage, calculatedDamage=damage, damageRatio=4096,
                    floatingChecks=[{"side": "attacker", "floating": False}])
        result["after"]["defender"]["hp"] = 235 - damage
        return result

    def test_terrain_power_and_type_are_independent_of_ordinary_boosts(self):
        for type_, effective in ((12, 130), (11, 130), (17, 100), (13, 130)):
            case = {"id": "grounded", "expectedPowers": [100], "effectivePowers": [effective],
                    "expectedMoveType": type_, "damageRatios": [4096], "expectedFloating": {"attacker": False}}
            result = self.result(effective=effective, type_=type_)
            self.assertTrue(runner.verify_terrain_pulse(case, result, self.variant)["passed"])
            for mutate in (lambda r: r["damageCalls"][0].update(moveType=0),
                           lambda r: r["damageCalls"][0].update(powerRewrites=[]),
                           lambda r: r["damageCalls"][0].update(preModifierDamage=1),
                           lambda r: r["damageCalls"][0].update(floatingChecks=[])):
                bad = deepcopy(result)
                mutate(bad)
                with self.assertRaises(AssertionError):
                    runner.verify_terrain_pulse(case, bad, self.variant)

    def test_electrify_does_not_cancel_misty_power_doubling(self):
        case = {"id": "electrify", "expectedPowers": [100], "expectedMoveType": 12, "requiredOpponentMove": 582}
        result = self.result(effective=100)
        result["after"]["defender"]["previousMoveId"] = 582
        self.assertTrue(runner.verify_terrain_pulse(case, result, self.variant)["passed"])
        result["after"]["defender"]["previousMoveId"] = 150
        with self.assertRaisesRegex(AssertionError, "type conversion"):
            runner.verify_terrain_pulse(case, result, self.variant)

    def test_protean_must_change_the_user_not_just_attack_type(self):
        case = {"id": "protean", "expectedPowers": [100], "effectivePowers": [130],
                "expectedMoveType": 12, "expectedUserTypes": [12, 12]}
        result = self.result()
        call = result["damageCalls"][0]
        call["attacker"]["types"] = [12, 12]
        damage = (call["preModifierDamage"] * 6144 + 2047) >> 12
        call.update(preModifierDamage=damage, calculatedDamage=damage)
        result["after"]["defender"]["hp"] = 235 - damage
        self.assertTrue(runner.verify_terrain_pulse(case, result, self.variant)["passed"])
        case["expectedUserTypes"] = [13, 13]
        with self.assertRaisesRegex(AssertionError, "Protean"):
            runner.verify_terrain_pulse(case, result, self.variant)


class WeatherAndMinimizeTests(unittest.TestCase):
    def hydro(self, ratio=6144):
        result = power_result(876, (80,))
        call = result["damageCalls"][0]
        damage = (((22 * 80 * 120 // 85 // 50 + 2) * ratio + 2047) >> 12) * 85 // 100
        call.update(category=2, powerRewrites=[], damageRatio=4096,
                    preModifierDamage=damage, calculatedDamage=damage, damageWeather=2)
        result["after"]["defender"]["hp"] = 235 - damage
        result["weatherReads"] = [1]
        case = {"id": "sun", "expectedPowers": [80], "weatherRatio": 6144,
                "expectedWeather": 1, "expectedDamageWeather": 2, "damageRatios": [4096]}
        return case, result, {"moveId": 876, "power": 80, "category": 2, "type": 10}

    def test_weather_is_applied_before_random_rounding(self):
        case, result, variant = self.hydro()
        self.assertTrue(runner.verify_hydro_steam(case, result, variant)["passed"])
        for mutate in (lambda r: r["damageCalls"][0].update(damageWeather=1),
                       lambda r: r.update(weatherReads=[0]),
                       lambda r: r["damageCalls"][0].update(preModifierDamage=30)):
            bad = deepcopy(result)
            mutate(bad)
            with self.assertRaises(AssertionError):
                runner.verify_hydro_steam(case, bad, variant)

    def test_native_sun_halving_is_rejected(self):
        case, result, variant = self.hydro(2048)
        with self.assertRaisesRegex(AssertionError, "pre-modifier"):
            runner.verify_hydro_steam(case, result, variant)

    def test_minimize_requires_a_real_flag_and_skipped_roll(self):
        result = power_result(916, (100,))
        call = result["damageCalls"][0]
        call.update(powerRewrites=[], damageRatio=8192,
                    calculatedDamage=call["preModifierDamage"] * 2)
        call["defender"]["conditionFlags"] = 0x100
        result["after"]["defender"]["hp"] = 235 - call["calculatedDamage"]
        result["accuracyRolls"] = []
        case = {"id": "minimize", "expectedPowers": [100], "damageRatios": [8192],
                "expectedMinimized": True, "expectedAccuracyRolls": 0}
        variant = {"moveId": 916, "power": 100, "category": 1, "type": 12}
        self.assertTrue(runner.verify_supercell_slam(case, result, variant)["passed"])
        for mutate in (lambda r: r["damageCalls"][0]["defender"].update(conditionFlags=0),
                       lambda r: r.update(accuracyRolls=[{"threshold": 95, "draw": 94}])):
            bad = deepcopy(result)
            mutate(bad)
            with self.assertRaises(AssertionError):
                runner.verify_supercell_slam(case, bad, variant)


class StormTests(unittest.TestCase):
    variant = {"moveId": 846, "power": 100, "category": 2, "type": 2}
    rain = {"id": "rain", "expectedPowers": [100], "expectedWeather": 2,
            "accuracyRoll": 99, "expectedAccuracyRolls": 0, "damageRatios": [4096]}

    def result(self):
        result = power_result(846, (100,))
        call = result["damageCalls"][0]
        call.update(category=2, powerRewrites=[], damageRatio=4096, calculatedDamage=call["preModifierDamage"])
        result["after"]["defender"].update(hp=235-call["calculatedDamage"], conditionFlags=0, previousMoveId=150)
        result.update(weatherReads=[2], accuracyRolls=[])
        return result

    def test_rain_must_skip_the_ordinary_roll(self):
        self.assertTrue(runner.verify_storm(self.rain, self.result(), self.variant)["passed"])
        bad = self.result()
        bad["accuracyRolls"] = [{"threshold": 80, "draw": 99}]
        with self.assertRaisesRegex(AssertionError, "number of native accuracy"):
            runner.verify_storm(self.rain, bad, self.variant)

    def test_wrong_weather_or_threshold_or_draw_is_rejected(self):
        case = {**self.rain, "expectedWeather": 1, "expectedAccuracyRolls": 1, "expectedAccuracy": 80, "accuracyRoll": 79}
        result = self.result()
        result.update(weatherReads=[1], accuracyRolls=[{"threshold": 80, "draw": 79}])
        self.assertTrue(runner.verify_storm(case, result, self.variant)["passed"])
        for mutate in (lambda r: r.update(weatherReads=[0]),
                       lambda r: r["accuracyRolls"][0].update(threshold=50),
                       lambda r: r["accuracyRolls"][0].update(draw=99),
                       lambda r: r["accuracyRolls"][0].update(draw=None)):
            bad = deepcopy(result)
            mutate(bad)
            with self.assertRaises(AssertionError):
                runner.verify_storm(case, bad, self.variant)

    def test_fly_block_requires_real_native_setup(self):
        result = self.result()
        result["damageCalls"] = []
        result["after"]["defender"].update(hp=235, conditionFlags=8, previousMoveId=19)
        case = {**self.rain, "blocked": True, "expectedFly": True}
        self.assertTrue(runner.verify_storm(case, result, self.variant)["passed"])
        for key, value in [("conditionFlags", 0), ("previousMoveId", 150)]:
            bad = deepcopy(result)
            bad["after"]["defender"][key] = value
            with self.assertRaises(AssertionError):
                runner.verify_storm(case, bad, self.variant)


class PoltergeistTests(unittest.TestCase):
    variant = {"moveId": 809, "power": 110, "category": 1, "type": 7}
    case = {"id": "held", "expectedPowers": [110], "damageRatios": [4096],
            "expectedItemBefore": 223, "expectedItemAfter": 223, "announcements": 1}

    def result(self):
        result = power_result(809, (110,))
        call = result["damageCalls"][0]
        call.update(damageRatio=4096, calculatedDamage=call["preModifierDamage"])
        result["before"]["defender"].update(item=223, slot=6)
        result["after"]["defender"].update(item=223, hp=235 - call["calculatedDamage"], statStages=[6] * 7)
        result["announcements"] = [{"mode": 2, "args": [6, 223], "beforeDamageModifiers": True}]
        return result

    def test_held_item_and_announcement(self):
        self.assertTrue(runner.verify_poltergeist(self.case, self.result(), self.variant)["passed"])

    def test_wrong_item_message_count_or_timing_fails(self):
        for mutate in (lambda r: r["before"]["defender"].update(item=0),
                       lambda r: r["after"]["defender"].update(item=0),
                       lambda r: r.update(announcements=[]),
                       lambda r: r["announcements"][0].update(args=[6, 196]),
                       lambda r: r["announcements"][0].update(args=[0, 223]),
                       lambda r: r["announcements"][0].update(beforeDamageModifiers=False)):
            result = self.result()
            mutate(result)
            with self.assertRaises(AssertionError):
                runner.verify_poltergeist(self.case, result, self.variant)

    def test_blocked_no_item_must_not_announce_or_damage(self):
        result = self.result()
        result["damageCalls"] = []
        result["before"]["defender"]["item"] = 0
        result["after"]["defender"].update(hp=235, item=0)
        result["announcements"] = []
        case = {"id": "no-item", "blocked": True, "expectedItemBefore": 0,
                "expectedItemAfter": 0, "announcements": 0}
        self.assertTrue(runner.verify_poltergeist(case, result, self.variant)["passed"])
        result["announcements"] = [{"mode": 2, "args": [6, 0], "beforeDamageModifiers": True}]
        with self.assertRaisesRegex(AssertionError, "announcements"):
            runner.verify_poltergeist(case, result, self.variant)

    def test_reactive_item_boost_and_switch_must_occur(self):
        for extra, expected_error in (({"expectedBoosts": [8, 6, 8, 6, 6, 6, 6]}, "stat boosts"),
                                      ({"expectedIncomingAttacker": 149}, "switch in")):
            with self.assertRaisesRegex(AssertionError, expected_error):
                runner.verify_poltergeist({**self.case, **extra}, self.result(), self.variant)


class ScaleShotTests(unittest.TestCase):
    variant = {"moveId": 799, "power": 25, "category": 1, "type": 15}
    case = {"id": "two", "expectedPowers": [25, 25], "ppSpent": 1,
            "expectedUserStages": [6, 5, 6, 6, 7, 6, 6]}

    def result(self):
        result = power_result(799, (25, 25), acted=(False, False))
        result["before"]["attacker"]["statStages"] = [6] * 7
        result["after"]["attacker"].update(pp=9, statStages=self.case["expectedUserStages"][:])
        for call in result["damageCalls"]:
            call["attacker"]["statStages"] = [6] * 7
        return result

    def test_self_changes_must_wait_until_the_last_strike(self):
        self.assertTrue(runner.verify_scale_shot(self.case, self.result(), self.variant)["passed"])
        bad = self.result()
        bad["damageCalls"][1]["attacker"]["statStages"] = self.case["expectedUserStages"][:]
        with self.assertRaisesRegex(AssertionError, "before the last strike"):
            runner.verify_scale_shot(self.case, bad, self.variant)

    def test_per_hit_changes_or_extra_pp_are_rejected(self):
        for mutate in (lambda r: r["after"]["attacker"].update(statStages=[6, 4, 6, 6, 8, 6, 6]),
                       lambda r: r["after"]["attacker"].update(pp=8)):
            bad = self.result()
            mutate(bad)
            with self.assertRaises(AssertionError):
                runner.verify_scale_shot(self.case, bad, self.variant)

    def test_miss_requires_native_accuracy_and_unchanged_stages(self):
        result = self.result()
        result.update(damageCalls=[], accuracyRolls=[{"draw": 99, "threshold": 90}])
        result["after"]["defender"]["hp"] = 235
        result["after"]["attacker"]["statStages"] = [6] * 7
        case = {"id": "miss", "blocked": True, "forceMiss": True, "ppSpent": 1, "expectedUserStages": [6] * 7}
        self.assertTrue(runner.verify_scale_shot(case, result, self.variant)["passed"])
        result["accuracyRolls"] = []
        with self.assertRaisesRegex(AssertionError, "90% accuracy"):
            runner.verify_scale_shot(case, result, self.variant)

    def test_multihit_substitute_does_not_spill_damage(self):
        result = self.result()
        result["damageCalls"] = [deepcopy(result["damageCalls"][0]) for _ in range(3)]
        for call, hp, sub in zip(result["damageCalls"], (177, 177, 177), (40, 10, 0)):
            call["defender"].update(hp=hp, substituteHp=sub)
        result["after"]["defender"].update(hp=147, substituteHp=0)
        case = {**self.case, "expectedPowers": [25] * 3, "substitute": True}
        self.assertTrue(runner.verify_scale_shot(case, result, self.variant)["passed"])
        result["after"]["defender"]["hp"] = 127
        with self.assertRaisesRegex(AssertionError, "spilled damage"):
            runner.verify_scale_shot(case, result, self.variant)


class PowerTests(unittest.TestCase):
    def test_rising_voltage_observes_target_grounding_separately(self):
        result = power_result(804, (140,))
        call = result["damageCalls"][0]
        call.update(category=2, floatingChecks=[{"side": "attacker", "floating": True},
                                               {"side": "defender", "floating": False}])
        call["attacker"]["item"] = 541
        case = {"id": "air-user", "expectedPowers": [140], "expectedFloating": {"attacker": True, "defender": False},
                "executionItems": {"attacker": 541}}
        variant = {"moveId": 804, "power": 70, "category": 2, "type": 12}
        self.assertTrue(runner.verify_power(case, result, variant)["passed"])
        for mutate in (lambda r: r["damageCalls"][0].update(floatingChecks=[]),
                       lambda r: r["damageCalls"][0]["floatingChecks"][1].update(floating=True),
                       lambda r: r["damageCalls"][0]["attacker"].update(item=0)):
            bad = deepcopy(result)
            mutate(bad)
            with self.assertRaises(AssertionError):
                runner.verify_power(case, bad, variant)

    def test_rising_voltage_ordinary_terrain_boost_is_not_move_doubling(self):
        result = power_result(804, (70,))
        call = result["damageCalls"][0]
        call.update(category=2, powerRewrites=[], floatingChecks=[{"side": "attacker", "floating": False},
                                                                 {"side": "defender", "floating": True}])
        call["preModifierDamage"] = (22 * 91 * 120 // 85 // 50 + 2) * 85 // 100
        case = {"id": "air-target", "expectedPowers": [70], "effectivePowers": [91],
                "expectedFloating": {"attacker": False, "defender": True}}
        variant = {"moveId": 804, "power": 70, "category": 2, "type": 12}
        self.assertTrue(runner.verify_power(case, result, variant)["passed"])
        call["powerRewrites"] = [140]
        with self.assertRaisesRegex(AssertionError, "Unexpected custom power"):
            runner.verify_power(case, result, variant)

    def test_grassy_glide_requires_priority_not_speed(self):
        variant = {"moveId": 803, "power": 55, "category": 1, "type": 11}
        case = {"id": "grassy", "expectedPowers": [55], "effectivePowers": [71],
                "expectedActed": [False], "typeRatio": 1024, "damageRatios": [4096]}
        result = power_result(803, (71,), acted=(False,))
        call = result["damageCalls"][0]
        call["defender"]["stats"][4] = 180
        call["preModifierDamage"] //= 4
        call.update(damageRatio=4096, calculatedDamage=call["preModifierDamage"])
        result["after"]["defender"]["hp"] = 235 - call["calculatedDamage"]
        self.assertTrue(runner.verify_power(case, result, variant)["passed"])
        wrong = deepcopy(result)
        wrong["damageCalls"][0]["defender"]["turnFlags"] = 2
        with self.assertRaisesRegex(AssertionError, "action state"):
            runner.verify_power(case, wrong, variant)
        wrong = deepcopy(result)
        wrong["damageCalls"][0]["attacker"]["stats"][4] = 220
        with self.assertRaisesRegex(AssertionError, "slower user"):
            runner.verify_power(case, wrong, variant)

    def test_unacted_and_acted_native_states(self):
        variant = {"moveId": 754, "power": 85, "category": 1}
        for power, acted in ((170, False), (85, True)):
            case = {"id": "turn", "expectedPowers": [power], "expectedActed": [acted]}
            self.assertTrue(runner.verify_power(case, power_result(powers=(power,), acted=(acted,)), variant)["passed"])

    def test_damage_only_placeholder_and_wrong_action_state_fail(self):
        case = {"id": "unacted", "expectedPowers": [170], "expectedActed": [False]}
        variant = {"moveId": 754, "power": 85, "category": 1}
        with self.assertRaisesRegex(AssertionError, "power 170"):
            runner.verify_power(case, power_result(powers=(85,)), variant)
        with self.assertRaisesRegex(AssertionError, "action state"):
            runner.verify_power(case, power_result(acted=(True,)), variant)

    def test_poison_only_not_hex(self):
        variant = {"moveId": 839, "power": 60, "category": 1}
        for status, power in ((5, 120), (4, 60), (2, 60)):
            case = {"id": "status", "expectedPowers": [power], "expectedStatus": status}
            self.assertTrue(runner.verify_power(case, power_result(839, (power,), (status,)), variant)["passed"])
        with self.assertRaisesRegex(AssertionError, "power 60"):
            runner.verify_power({"id": "old-hex", "expectedPowers": [60], "expectedStatus": 4},
                                power_result(839, (120,), (4,)), variant)

    def test_extra_actions_require_two_independent_calculations(self):
        case = {"id": "instruct", "expectedPowers": [170, 85], "expectedActed": [False, True]}
        variant = {"moveId": 755, "power": 85, "category": 1}
        self.assertEqual(runner.verify_power(case, power_result(755, (170, 85), acted=(False, True)), variant)["nativeExecutions"], 2)
        incomplete = power_result(755)
        incomplete["after"]["attacker"]["pp"] = 8
        with self.assertRaisesRegex(AssertionError, "number"):
            runner.verify_power(case, incomplete, variant)

    def test_unapplied_damage_and_missing_custom_callback_fail(self):
        case = {"id": "unacted", "expectedPowers": [170]}
        variant = {"moveId": 754, "power": 85, "category": 1}
        result = power_result()
        result["after"]["defender"]["hp"] += 1
        with self.assertRaisesRegex(AssertionError, "HP loss"):
            runner.verify_power(case, result, variant)
        result = power_result()
        result["damageCalls"][0]["powerRewrites"] = []
        with self.assertRaisesRegex(AssertionError, "rewrite"):
            runner.verify_power(case, result, variant)

    def test_poison_secondary_and_controlled_rng_checked(self):
        case = {"id": "secondary", "expectedPowers": [60], "expectPoison": True}
        variant = {"moveId": 839, "power": 60, "category": 1}
        with self.assertRaisesRegex(AssertionError, "secondary"):
            runner.verify_power(case, power_result(839, (60,)), variant)
        result = power_result(839, (60,))
        result["after"]["defender"]["conditions"][5] = 1
        self.assertTrue(runner.verify_power(case, result, variant)["passed"])
        result["rngOverrides"] = 0
        with self.assertRaisesRegex(AssertionError, "RNG"):
            runner.verify_power(case, result, variant)

    def test_repeat_move_requires_repeat_pp_consumption(self):
        case = {"id": "instruct", "expectedPowers": [170, 85], "expectedActed": [False, True]}
        result = power_result(755, (170, 85), acted=(False, True))
        result["after"]["attacker"]["pp"] = 9
        with self.assertRaisesRegex(AssertionError, "exactly 2 PP"):
            runner.verify_power(case, result, {"moveId": 755, "power": 85, "category": 1})

    def test_bios_irq_and_swi_are_not_aborts(self):
        from types import SimpleNamespace
        for mode in (0x10, 0x12, 0x13, 0x1f):
            runner.check_arm9(SimpleNamespace(memory=SimpleNamespace(register_arm9=SimpleNamespace(cpsr=mode))))
        for mode in (0x17, 0x1b):
            with self.assertRaisesRegex(AssertionError, "fault mode"):
                runner.check_arm9(SimpleNamespace(memory=SimpleNamespace(register_arm9=SimpleNamespace(cpsr=mode))))

    def test_hard_press_target_hp_formula_and_faint_cap(self):
        variant = {"moveId": 912, "power": 1, "category": 1}
        for hp, power in ((235, 100), (118, 50), (117, 49), (101, 42), (2, 1), (1, 1)):
            result = power_result(912, (power,))
            result["before"]["defender"]["hp"] = hp
            result["damageCalls"][0]["defender"].update(hp=hp, maxHp=235)
            result["after"]["defender"]["hp"] = max(0, hp - 30)
            case = {"id": "hp", "powerRule": "target-hp", "allowFaint": True}
            self.assertEqual(runner.verify_power(case, result, variant)["effectivePowers"], [power])
        result["damageCalls"][0]["preModifierDamage"] += 1
        with self.assertRaisesRegex(AssertionError, "power 1"):
            runner.verify_power(case, result, variant)

    def test_stab_uses_native_fixed_point_half_down_rounding(self):
        result = power_result(875, (120,))
        call = result["damageCalls"][0]
        call["attacker"]["types"] = [13, 13]
        call["preModifierDamage"] = (call["preModifierDamage"] * 6144 + 2047) >> 12
        variant = {"moveId": 875, "power": 80, "category": 1, "type": 13}
        case = {"id": "terrain", "expectedPowers": [120]}
        self.assertTrue(runner.verify_power(case, result, variant)["passed"])
        call["preModifierDamage"] += 1
        with self.assertRaisesRegex(AssertionError, "pre-modifier"):
            runner.verify_power(case, result, variant)

    def test_grav_apple_secondary_and_psyblade_airborne_preconditions(self):
        result = power_result(788, (120,))
        case = {"id": "gravity", "expectedPowers": [120], "expectedDefenseStage": 5}
        result["after"]["defender"]["statStages"] = [6, 5, 6, 6, 6, 6, 6]
        variant = {"moveId": 788, "power": 80, "category": 1}
        self.assertTrue(runner.verify_power(case, result, variant)["passed"])
        result["after"]["defender"]["statStages"][1] = 6
        with self.assertRaisesRegex(AssertionError, "Defense-stage"):
            runner.verify_power(case, result, variant)
        result = power_result(875, (120,))
        variant = {"moveId": 875, "power": 80, "category": 1}
        case = {"id": "air", "expectedPowers": [120], "expectedAirborne": True}
        for side in ("attacker", "defender"):
            result["damageCalls"][0][side]["item"] = 541
        self.assertTrue(runner.verify_power(case, result, variant)["passed"])
        result["damageCalls"][0]["defender"]["item"] = 0
        with self.assertRaisesRegex(AssertionError, "Air Balloons"):
            runner.verify_power(case, result, variant)

    def test_final_effectiveness_bonus_is_not_a_power_boost(self):
        for type_ratio, ratio in ((2048, 4096), (4096, 4096), (8192, 5461), (16384, 5461), (512, 4096)):
            result = power_result(878, (100,))
            call = result["damageCalls"][0]
            call["preModifierDamage"] = call["preModifierDamage"] * type_ratio // 4096
            call["damageRatio"] = ratio
            call["calculatedDamage"] = max(1, (call["preModifierDamage"] * ratio + 2047) >> 12)
            result["before"]["defender"]["hp"] = call["defender"]["hp"] = 1000
            result["after"]["defender"]["hp"] = 1000 - call["calculatedDamage"]
            case = {"id": "effectiveness", "expectedPowers": [100], "typeRatio": type_ratio, "damageRatios": [ratio]}
            variant = {"moveId": 878, "power": 100, "category": 1}
            self.assertTrue(runner.verify_power(case, result, variant)["passed"])
            call["damageRatio"] = 1
            with self.assertRaisesRegex(AssertionError, "modifier"):
                runner.verify_power(case, result, variant)

    def test_power_chance_caches_hits_but_resets_actions(self):
        result = power_result(907, (160, 160), acted=(False, False))
        variant = {"moveId": 907, "power": 80, "category": 1}
        case = {"id": "parental-bond", "expectedPowers": [160, 160], "powerRolls": [1, 0], "ppSpent": 1}
        result["after"]["attacker"]["pp"] = 9
        for call, rolls in zip(result["damageCalls"], (1, 0)):
            call["powerRolls"] = rolls
        self.assertTrue(runner.verify_power(case, result, variant)["passed"])
        result["damageCalls"][1]["powerRolls"] = 1
        with self.assertRaisesRegex(AssertionError, "rerolled"):
            runner.verify_power(case, result, variant)
        case.update(id="instruct", ppSpent=2, powerRolls=[1, 1])
        result["after"]["attacker"]["pp"] = 8
        self.assertTrue(runner.verify_power(case, result, variant)["passed"])


class MoveLifetimeOutcomeTests(unittest.TestCase):
    def status_result(self, move=753):
        before = {"attacker": {"moveId":move,"pp":15,"slot":0,"species":151},
                  "defender": {"hp":235,"substituteHp":0,"slot":12,"trapCondition":0,"statStages":[6]*7}}
        action = {"attacker": {**before["attacker"],"pp":14,"turnFlags":2,"previousMoveId":move},
                  "defender": deepcopy(before["defender"])}
        return {"finished":True,"before":before,"after":deepcopy(action),"actionAfter":action,
                "damageCalls":[],"completion":action["attacker"]}

    def test_source_exit_requires_real_replacement_and_no_remaining_effect(self):
        result = self.status_result()
        result["after"]["attacker"].update(slot=1,species=149)
        case = {"id":"exit","sourceExit":True,"expectedTraps":[0,0],"expectedDefenderStages":[6]*7}
        result["after"]["attacker"]["trapCondition"] = 0
        variant = {"moveId":753,"power":0}
        self.assertTrue(runner.verify_persistent(case,result,variant)["passed"])
        for mutate in (lambda r:r["after"]["attacker"].update(slot=0),
                       lambda r:r["after"]["defender"].update(trapCondition=3),
                       lambda r:r["after"]["defender"].update(statStages=[6,5,6,5,6,6,6])):
            bad = deepcopy(result)
            mutate(bad)
            with self.assertRaises(AssertionError):
                runner.verify_persistent(case,bad,variant)

    def test_called_move_checks_selected_pp_and_actual_payload_separately(self):
        result = self.status_result(214)
        result["after"]["attacker"]["previousMoveId"] = 901
        runner.verify_completed(result,214,1,901)
        for key,value in (("pp",15),("previousMoveId",214),("turnFlags",0)):
            bad = deepcopy(result)
            bad["after"]["attacker"][key] = value
            bad["completion"] = bad["after"]["attacker"]
            with self.assertRaises(AssertionError):
                runner.verify_completed(bad,214,1,901)

    def test_native_forced_struggle_requires_unchanged_selected_pp(self):
        result = self.status_result(893)
        result["after"]["attacker"].update(pp=15,previousMoveId=165)
        runner.verify_completed(result,893,0,165)
        result["after"]["attacker"]["pp"] = 14
        with self.assertRaisesRegex(AssertionError,"consume exactly 0"):
            runner.verify_completed(result,893,0,165)

    def test_switch_command_does_not_compare_replacements_unrelated_pp(self):
        emu = SimpleNamespace(frame_count=1,memory=SimpleNamespace(
            register_arm9=SimpleNamespace(r1=100),read_long=lambda at:0))
        observer = runner.Observer(emu,{"moveId":753})
        observer.reset({"sourceExit":True})
        observer.pointers = {"attacker":10,"defender":20}
        observer.incoming_attacker = 30
        observer.action_complete = True
        observer.command(None,None)
        self.assertTrue(observer.next_command)
        self.assertEqual(observer.pointers["attacker"],30)

    def test_destroyed_item_cannot_be_recorded_as_consumed(self):
        result = self.status_result(810)
        result["before"]["defender"].update(item=158,consumedItem=0)
        result["after"]["defender"].update(item=0,consumedItem=0)
        case = {"id":"destroy","expectedItemRemoved":True}
        self.assertTrue(runner.verify_forced_item(case,result,{"moveId":810})["passed"])
        result["after"]["defender"]["consumedItem"] = 158
        with self.assertRaisesRegex(AssertionError,"recorded as consumption"):
            runner.verify_forced_item(case,result,{"moveId":810})

    def test_stuff_cheeks_requires_boost_and_consumption_together(self):
        result = self.status_result(747)
        result["after"]["attacker"].update(item=0,consumedItem=158,statStages=[6,8,6,6,6,6,6],hp=175)
        case = {"id":"full-hp","expectedUserStages":[6,8,6,6,6,6,6],"expectedUserItem":0,
                "expectedConsumedItem":158,"expectedUserHp":175}
        self.assertTrue(runner.verify_forced_item(case,result,{"moveId":747})["passed"])
        for key,value in (("item",158),("consumedItem",0),("statStages",[6]*7)):
            bad = deepcopy(result)
            bad["after"]["attacker"][key] = value
            with self.assertRaises(AssertionError):
                runner.verify_forced_item(case,bad,{"moveId":747})


if __name__ == "__main__":
    unittest.main()
