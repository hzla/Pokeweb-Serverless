#include <stdint.h>

#define PUBLIC __attribute__((used, visibility("default")))
#define NAKED __attribute__((naked)) PUBLIC
#define THUMB(body) __asm__ volatile(".syntax unified\n" body "\n.syntax divided")
#define NATIVE(i, signature) ((signature)(uintptr_t)BattleClimateApi[i])

#ifdef CLIMATE_TEST
typedef struct {
    uint8_t event, actor, target, type;
    uint16_t first, second;
    uint32_t value;
} TestRecord;
#ifdef SNOW
#define TEST_TAG 0x574f4e53
#elif defined(MODERN_STATUS)
#define TEST_TAG 0x4e444f4d
#else
#define TEST_TAG 0x54535246
#endif
PUBLIC volatile struct { uint32_t tag, count; TestRecord records[80]; } BattleClimateTest = { TEST_TAG, 0, {{0}} };
static void record(unsigned event, unsigned actor, unsigned target, unsigned type,
                   unsigned first, unsigned second, unsigned value) {
    unsigned index = BattleClimateTest.count;
    if (index >= 80) return;
#ifdef MODERN_STATUS
    if (!index) target = event;
#endif
    BattleClimateTest.records[index] = (TestRecord){ index ? event : 3, actor, target, type, first, second, value };
    BattleClimateTest.count = index + 1;
}
#endif

#ifdef SNOW
#ifdef CLIMATE_TEST
PUBLIC const volatile uint32_t BattleClimateApi[5] = {0};
PUBLIC const volatile uint32_t WeatherProbeOriginal = 0;
PUBLIC volatile struct { uint32_t tag, turns[12]; } WeatherProbe = {0x54434257, {0}};

/* The doubles fixture compares whole turns, including AI previews. */
PUBLIC unsigned CountWeather(void *flow) {
    unsigned turn = *(const uint32_t *)((const uint8_t *)flow + 0x10);
    if (turn < 12) WeatherProbe.turns[turn]++;
    return ((unsigned (*)(void *))(uintptr_t)WeatherProbeOriginal)(flow);
}
#else
PUBLIC const volatile uint32_t BattleClimateApi[3] = {0};
#endif

/* Lower half: the existing effective weather. Upper half: selected defense. */
PUBLIC uint32_t SnowDefense(void *flow, void *defender, unsigned stat, unsigned defense) {
    unsigned weather = NATIVE(0, unsigned (*)(void *))(flow);
#ifdef CLIMATE_TEST
    unsigned original = defense;
#endif
    if (weather == 3 && stat == 9 && NATIVE(1, unsigned (*)(void *, unsigned))(defender, 14))
        defense = NATIVE(2, unsigned (*)(unsigned, unsigned))(defense, 0x1800);
#ifdef CLIMATE_TEST
    unsigned id = NATIVE(4, unsigned (*)(void *))(defender);
    unsigned hp = NATIVE(3, unsigned (*)(void *, unsigned))(defender, 13);
    record(0xd0, id, 0, weather, original, defense, (hp << 16) | stat);
#endif
    return (defense << 16) | weather;
}

/* Replace only the existing effective-weather call in the defense calculation. */
NAKED void SnowDefenseSite(void) {
    THUMB("push {r3, lr}\n"
          "movs r1, r5\n"
          "movs r2, r4\n"
          "movs r3, r7\n"
          "bl SnowDefense\n"
          "lsrs r7, r0, #16\n"
          "lsls r0, r0, #16\n"
          "lsrs r0, r0, #16\n"
          "pop {r3, pc}");
}
#endif

#if defined(FROSTBITE) || defined(MODERN_STATUS)
enum {
    GET_STATUS, GET_STAT, HAS_CONDITION, DIVIDE_MAX_HP,
    CONDITION_DAMAGE_MESSAGE, SHOW_EFFECT, SET_MESSAGE, ADD_MESSAGE_ARG,
    GET_MON_ID, FROZEN_EFFECT, FROSTBITE_DAMAGE_TEXT, GET_EVENT_VALUE,
    BATTLE_RANDOM, MAKE_MOVE_CONDITION, GET_TYPE_PAIR, MATCH_TYPE, IS_SUBSTITUTE_ACTIVE,
    TICK_SLEEP, CHECK_INDIRECT_DAMAGE
};
#ifdef MODERN_STATUS
PUBLIC const volatile uint32_t BattleClimateApi[19] = {0};
#else
PUBLIC const volatile uint32_t BattleClimateApi[12] = {0};
#endif

PUBLIC unsigned FrostbiteDamage(void *attacker, unsigned category, unsigned damage) {
    if (category == 1 || category == 2) {
        unsigned status = NATIVE(GET_STATUS, unsigned (*)(void *))(attacker);
        unsigned result = damage;
#ifdef FROSTBITE
        if (category == 2 && status == 3)
            result >>= 1;
#endif
        if (category == 1 && status == 4 &&
            NATIVE(GET_STAT, unsigned (*)(void *, unsigned))(attacker, 17) != 62 &&
            (!BattleClimateApi[GET_EVENT_VALUE] || NATIVE(GET_EVENT_VALUE, unsigned (*)(unsigned))(0x12) != 263))
            result >>= 1;
#ifdef CLIMATE_TEST
        record(0xd1, NATIVE(GET_MON_ID, unsigned (*)(void *))(attacker), 0, status, damage, result, category);
#endif
        return result;
    }
    return damage;
}

/* The damage calculator keeps its attacker and category on the stack.
 * Return to its minimum-one check with the same damage register as retail. */
NAKED void FrostbiteDamageSite(void) {
    THUMB("ldr r0, [sp, #4]\n"
          "ldr r1, [sp, #16]\n"
          "push {r3, lr}\n"
          "movs r2, r4\n"
          "bl FrostbiteDamage\n"
          "movs r4, r0\n"
          "pop {r3, pc}");
}
#endif

#ifdef FROSTBITE
PUBLIC unsigned FrostbiteResidual(void *mon) {
    if (!NATIVE(HAS_CONDITION, unsigned (*)(void *, unsigned))(mon, 3)) return 0;
    unsigned damage = NATIVE(DIVIDE_MAX_HP, unsigned (*)(void *, unsigned))(mon, 16);
#ifdef CLIMATE_TEST
    record(0xd2, NATIVE(GET_MON_ID, unsigned (*)(void *))(mon), 0, 3, 0, 0, damage);
#endif

    return damage;
}

/* At the residual calculator's condition-check call, all other conditions
 * continue through the original callee. Frostbite returns from the calculator
 * after the ordinary condition check and max-HP division. */
NAKED void FrostbiteResidualSite(void) {
    THUMB("cmp r1, #3\n"
          "beq 1f\n"
          "ldr r3, =BattleClimateApi\n"
          "ldr r3, [r3, #8]\n"
          "bx r3\n"
          "1:\n"
          "bl FrostbiteResidual\n"
          "pop {r3, r4, r5, pc}");
}

PUBLIC unsigned FrostbiteMessage(void *message, void *mon, unsigned condition, void *flow) {
    if (condition != 3)
        return NATIVE(CONDITION_DAMAGE_MESSAGE, unsigned (*)(void *, void *, unsigned))
            (message, mon, condition);
    NATIVE(SHOW_EFFECT, void (*)(void *, void *, unsigned))(flow, mon, BattleClimateApi[FROZEN_EFFECT]);
    NATIVE(SET_MESSAGE, void (*)(void *, unsigned, unsigned))(message, 2, BattleClimateApi[FROSTBITE_DAMAGE_TEXT]);
    NATIVE(ADD_MESSAGE_ARG, void (*)(void *, unsigned))(message, NATIVE(GET_MON_ID, unsigned (*)(void *))(mon));
#ifdef CLIMATE_TEST
    record(0xd3, NATIVE(GET_MON_ID, unsigned (*)(void *))(mon), 0, 3, 0, 0, 0);
#endif
    return 0;
}

NAKED void FrostbiteMessageSite(void) {
    THUMB("movs r3, r4\n"
          "push {r4, lr}\n"
          "bl FrostbiteMessage\n"
          "pop {r4, pc}");
}
#endif

#ifdef MODERN_STATUS
// The native per-Pokémon condition words and counters have the same layout in BW/BW2.
enum { CONDITION_COUNT = 36, CONDITION_WORD_OFFSET = 0x1c, CONDITION_COUNTER_OFFSET = 0xac };

#ifdef CLIMATE_TEST
PUBLIC const volatile uint32_t ModernRngOverride = 0;
PUBLIC const volatile uint32_t ModernScaldFixture = 0;
#endif

static unsigned random_below(unsigned limit) {
    unsigned roll = NATIVE(BATTLE_RANDOM, unsigned (*)(unsigned))(limit);
#ifdef CLIMATE_TEST
    unsigned forced = ModernRngOverride;
    if (forced && forced <= limit) roll = forced - 1;
#endif
    return roll;
}

PUBLIC unsigned ModernFullParalysis(void) {
    unsigned roll = random_below(8);
#ifdef CLIMATE_TEST
    record(0xe1, 0, 0, 1, 8, roll, roll == 0);
#endif
    return roll == 0;
}

PUBLIC unsigned ModernSleepDuration(void) {
    unsigned roll = random_below(3);
    unsigned duration = roll == 0 ? 2 : 3;
#ifdef CLIMATE_TEST
    record(0xe2, 0, 0, 2, 3, roll, duration);
#endif
    return duration;
}

PUBLIC void ModernMoveCondition(unsigned spec, void *mon, uint32_t *out, unsigned condition) {
    // Native move data: a 4-bit kind followed by the 6-bit minimum and maximum.
    if (condition == 2 && (uint16_t)spec == (2 | (2 << 4) | (4 << 10))) {
        *out = 2 | (ModernSleepDuration() << 3);
    } else {
        NATIVE(MAKE_MOVE_CONDITION, void (*)(unsigned, void *, uint32_t *))(spec, mon, out);
    }
}

// The caller keeps the resolved condition in its own frame, before ability
// and item events see the resulting native condition word.
NAKED void ModernSecondarySleepSite(void) {
    THUMB("ldr r3, [sp, #8]\n b ModernMoveCondition");
}
NAKED void ModernSimpleSleepSite(void) {
    THUMB("ldr r3, [sp, #20]\n b ModernMoveCondition");
}
NAKED void ModernStatSleepSite(void) {
    THUMB("ldr r3, [sp, #16]\n b ModernMoveCondition");
}

PUBLIC void ModernClearConditions(void *mon, unsigned all) {
    uint32_t *conditions = (uint32_t *)((uint8_t *)mon + CONDITION_WORD_OFFSET);
    uint8_t *counters = (uint8_t *)mon + CONDITION_COUNTER_OFFSET;
    for (unsigned id = all ? 0 : 6; id < CONDITION_COUNT; id++) conditions[id] = 0;
    for (unsigned id = 0; id < CONDITION_COUNT; id++)
        if (all || (id != 2 && id != 3)) counters[id] = 0;
}

PUBLIC unsigned ModernNaturalThaw(void *mon) {
    uint8_t *attempts = (uint8_t *)mon + CONDITION_COUNTER_OFFSET + 3;
    unsigned attempt = ++*attempts;
    unsigned result = attempt >= 3 || random_below(4) == 0;
#ifdef CLIMATE_TEST
    record(0xe3, NATIVE(GET_MON_ID, unsigned (*)(void *))(mon), 0, 3, attempt, 0, result);
#endif
    return result;
}

NAKED void ModernNaturalThawSite(void) {
    THUMB("movs r0, r6\n b ModernNaturalThaw");
}

PUBLIC unsigned ModernScaldThaw(const uint8_t *move, unsigned *isScald, const uint8_t *targets) {
    *isScald = *(const uint16_t *)move == 503;
#ifdef CLIMATE_TEST
    // Seed a frozen target for the test after the native hit on its Substitute.
    if (*isScald && ModernScaldFixture && targets[0x42] && targets[0x30] == 2) {
        uint8_t *mon = *(uint8_t *const *)targets;
        ((uint32_t *)(mon + CONDITION_WORD_OFFSET))[3] = 1;
    }
#else
    (void)targets;
#endif
    return *isScald ? 9 : move[6];
}

NAKED void ModernScaldThawSite(void) {
    // The retail prologue's saved r3 only pads its stack frame.
    THUMB("movs r5, r3\n movs r0, r1\n mov r1, sp\n movs r2, r5\n b ModernScaldThaw");
}

PUBLIC unsigned ModernThawBlocked(void *mon, const uint8_t *targets, unsigned scald) {
    unsigned blocked = NATIVE(IS_SUBSTITUTE_ACTIVE, unsigned (*)(void *))(mon);
#ifdef CLIMATE_TEST
    unsigned nativeSubstitute = blocked;
#endif
    if (scald && !blocked) {
        // GetNext increments the native cursor. HP damage is separate from
        // Substitute damage even if the hit broke the Substitute.
        unsigned cursor = targets[0x44];
        blocked = !cursor || cursor > 6 || !((const uint16_t *)(targets + 0x18))[cursor - 1];
    }
#ifdef CLIMATE_TEST
    if (scald) record(0xe5, NATIVE(GET_MON_ID, unsigned (*)(void *))(mon), 0, 3, nativeSubstitute, 0, blocked);
#endif
    return blocked;
}

NAKED void ModernThawBlockedSite(void) {
    THUMB("movs r1, r5\n ldr r2, [sp, #0]\n b ModernThawBlocked");
}

PUBLIC unsigned ModernElectricImmunity(void *mon, unsigned condition) {
    if (condition != 1) return 0;
    unsigned types = NATIVE(GET_TYPE_PAIR, unsigned (*)(void *))(mon);
    unsigned result = NATIVE(MATCH_TYPE, unsigned (*)(unsigned, unsigned))(types, 12) ? 2 : 0;
#ifdef CLIMATE_TEST
    record(0xe4, NATIVE(GET_MON_ID, unsigned (*)(void *))(mon), 0, 1, 0, 0, result);
#endif
    return result;
}

// Only the native successful exit reaches this site. Keep the original
// rejection codes and let the caller issue the usual immunity message.
NAKED void ModernElectricTail(void) {
    THUMB("movs r0, r5\n movs r1, r4\n bl ModernElectricImmunity\n pop {r4, r5, r6, pc}");
}

#ifdef CLIMATE_TEST
PUBLIC unsigned ModernBurnProbe(void *mon, unsigned divisor) {
    unsigned damage = NATIVE(DIVIDE_MAX_HP, unsigned (*)(void *, unsigned))(mon, divisor);
    record(0xe6, NATIVE(GET_MON_ID, unsigned (*)(void *))(mon), 0, 4, divisor, 0, damage);
    return damage;
}

PUBLIC unsigned ModernSleepProbe(void *mon) {
    unsigned progress = ((uint8_t *)mon)[CONDITION_COUNTER_OFFSET + 2];
    unsigned woke = NATIVE(TICK_SLEEP, unsigned (*)(void *))(mon);
    record(0xe7, NATIVE(GET_MON_ID, unsigned (*)(void *))(mon), 0, 2, progress, 0, woke);
    return woke;
}

PUBLIC unsigned ModernIndirectDamageProbe(void *flow, void *mon, unsigned damage, unsigned status) {
    unsigned enabled = NATIVE(CHECK_INDIRECT_DAMAGE, unsigned (*)(void *, void *, unsigned))(flow, mon, damage);
    record(0xe8, NATIVE(GET_MON_ID, unsigned (*)(void *))(mon), 0, status, damage, 0, enabled);
    return enabled;
}

NAKED void ModernIndirectDamageSite(void) {
    THUMB("movs r3, r6\n b ModernIndirectDamageProbe");
}

PUBLIC unsigned ModernConfusionProbe(unsigned chance) {
    unsigned roll = random_below(100);
    record(0xe9, 0, 0, 6, chance, roll, roll < chance);
    return roll < chance;
}
#endif
#endif
