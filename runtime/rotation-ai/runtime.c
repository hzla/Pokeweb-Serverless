#include <stddef.h>
#include <stdint.h>

typedef struct BattleMon BattleMon;
typedef struct BattleParty BattleParty;
typedef struct MainModule MainModule;
typedef struct PokeCon PokeCon;
typedef struct ServerFlow ServerFlow;
typedef struct Vm Vm;
typedef uint32_t Action;

// Client action fields moved by eight bytes in BW2. The scorer's context is shared.
#ifdef BW1
#define CLIENT_VM_OFFSET 0xf0
#define FINISH_SEQUENCE 3
#define NATIVE_ADDRESS(bw2, bw1) (bw1)
#else
#define CLIENT_VM_OFFSET 0xf8
#define FINISH_SEQUENCE 4
#define NATIVE_ADDRESS(bw2, bw1) (bw2)
#endif
typedef struct {
    MainModule *main;
    PokeCon *pokeCon;
    BattleMon *mon;
    Action *action;
    uint8_t padding[CLIENT_VM_OFFSET - 0x10];
    Vm *vm;
    uint8_t paddingToParty[0x24];
    BattleParty *party;
    uint8_t padding2[0x93];
    uint8_t extraActionCount;
} Client;

typedef struct {
    uint32_t unused;
    int32_t scores[4];
    uint8_t padding[0x2c];
    uint32_t flags;
    uint8_t padding2[0x51];
    uint8_t defenderPos;
    uint8_t padding3[0x1e];
    ServerFlow *flow;
} AiContext;

typedef struct EventItem {
    uint32_t unused;
    struct EventItem *next;
    uint32_t padding[2];
    uint32_t factor;
    uint8_t padding2[7];
    uint8_t flags;
    uint8_t padding3[31];
    uint8_t dependent;
} EventItem;

_Static_assert(offsetof(Client, vm) == CLIENT_VM_OFFSET, "client VM offset");
_Static_assert(offsetof(Client, party) == CLIENT_VM_OFFSET + 0x28, "client party offset");
_Static_assert(offsetof(Client, extraActionCount) == CLIENT_VM_OFFSET + 0xbf, "client extra action offset");
_Static_assert(offsetof(AiContext, flags) == 0x40, "AI flags offset");
_Static_assert(offsetof(AiContext, defenderPos) == 0x95, "AI defender offset");
_Static_assert(offsetof(AiContext, flow) == 0xb4, "AI flow offset");
_Static_assert(offsetof(EventItem, flags) == 0x1b && offsetof(EventItem, dependent) == 0x3b, "event layout");

#define THUMB(address, type) ((type)((address) | 1u))
#define OVERLAY(bw2, bw1, type) THUMB(NATIVE_ADDRESS(bw2, bw1) - VERSION_DELTA, type)
#define nativeSelect OVERLAY(0x021b59ec, 0x021d0790, int (*)(Client *, int32_t *))
#define partyMon OVERLAY(0x0219d534, 0x021b9c20, BattleMon *(*)(BattleParty *, uint8_t))
#define positionMon OVERLAY(0x0219d1c8, 0x021b98cc, BattleMon *(*)(PokeCon *, uint8_t))
#define monId OVERLAY(0x021bac80, 0x021d5460, uint8_t (*)(BattleMon *))
#define battlePos OVERLAY(0x0219c638, 0x021b8dac, uint8_t (*)(MainModule *, PokeCon *, uint8_t))
#define fainted OVERLAY(0x021bb3a8, 0x021d5b88, int (*)(BattleMon *))
#define selectableMoves OVERLAY(0x021b4a64, 0x021cf83c, uint8_t (*)(Client *, BattleMon *, uint8_t *))
#define moveAt OVERLAY(0x021bad00, 0x021d54e0, uint16_t (*)(BattleMon *, uint8_t))
#define movePp OVERLAY(0x021badc4, 0x021d55a4, uint8_t (*)(BattleMon *, uint8_t))
#define getMonStat OVERLAY(0x021bb1f4, 0x021d59d4, uint32_t (*)(BattleMon *, uint32_t))
#define checkCondition OVERLAY(0x021bbb04, 0x021d62e4, int (*)(BattleMon *, uint32_t))
#define continuation OVERLAY(0x021bbb54, 0x021d6334, uint32_t (*)(BattleMon *, uint32_t))
#define conditionMove OVERLAY(0x021ce400, 0x021e8ba0, uint16_t (*)(uint32_t))
#define moveIsDamaging THUMB(DAMAGING_ADDRESS, int (*)(uint16_t))
#define effectiveness OVERLAY(0x021ab92c, 0x021c7dcc, uint32_t (*)(ServerFlow *, uint8_t, uint8_t, uint16_t))
#define calcDamage OVERLAY(0x021ab994, 0x021c7e34, uint32_t (*)(ServerFlow *, uint8_t, uint8_t, uint16_t, int, uint32_t))
#define setRotation OVERLAY(0x021bdc64, 0x021d841c, void (*)(Action *, uint32_t))
#define setFight OVERLAY(0x021bdb38, 0x021d82f0, void (*)(Action *, uint16_t, uint8_t))
#define setStruggle OVERLAY(0x021b47d4, 0x021cf5ac, void (*)(Action *, Client *, BattleMon *))
#define aiContext THUMB(NATIVE_ADDRESS(0x020159dc, 0x02011324), AiContext *(*)(Vm *))
#define setupAi OVERLAY(0x0217f7fc, 0x021880dc, void (*)(Vm *, const uint8_t *, uint8_t))
#define chooseMove OVERLAY(0x0217f88c, 0x0218816c, int (*)(Vm *, AiContext *))

enum {
    PLAYER_FRONT = 0,
    MON_HP = 13,
    LOCKED_CONTINUATION = 25,
    AI_BASIC = 1 << 0,
    AI_STRONG = 1 << 1,
    AI_EXPERT = 1 << 2,
    KO_BONUS = 4,
    MIN_DAMAGE = 0,
    NO_MOVE_SLOT = 4,
    NO_BATTLE_POSITION = 6,
    FINISH_ACTION = FINISH_SEQUENCE,
    START_ROTATION_AI = 5,
    SCORE_ROTATION_AI = 6,
    ABILITY_EVENT = 4,
    HELD_ITEM_EVENT = 5,
    EVENT_SLEEPING = 0x40,
    EVENT_POOL_COUNT = 0x84,
};

typedef struct {
    uint16_t move;
    uint8_t partySlot;
    int32_t score;
    uint32_t damage;
} Choice;

typedef struct {
    BattleMon *defender;
    uint8_t slot;
    uint8_t legal[4];
    uint16_t continuationMove;
    uint8_t scoring;
    Choice best;
} RotationDecision;

// Trainer Rotation Battles have a single CPU client. State resets at the start of each decision.
static RotationDecision decision;

// Adjust just the ability/item handlers that real rotation sleeps or wakes.
// Restore each changed flag before returning to the engine, including on VM yield.
static unsigned simulateRotation(EventItem *changed[EVENT_POOL_COUNT], uint8_t outgoing, uint8_t incoming)
{
    EventItem *item = *(EventItem *volatile *)EVENT_LIST_HEAD;
    unsigned count = 0;
    for (; item && count < EVENT_POOL_COUNT; item = item->next) {
        if (item->factor != ABILITY_EVENT && item->factor != HELD_ITEM_EVENT) continue;
        if ((item->dependent == outgoing && !(item->flags & EVENT_SLEEPING)) ||
            (item->dependent == incoming && (item->flags & EVENT_SLEEPING))) {
            changed[count++] = item;
            item->flags ^= EVENT_SLEEPING;
        }
    }
    return count;
}

static void considerMove(AiContext *ctx, uint8_t attacker, uint8_t defender,
                         uint16_t move, int32_t score)
{
    uint32_t damage = 0;
    if (moveIsDamaging(move) && effectiveness(ctx->flow, attacker, defender, move) != 0) {
        damage = calcDamage(ctx->flow, attacker, defender, move, 1, MIN_DAMAGE);
    }
    if ((ctx->flags & AI_STRONG) && damage > 0 && damage >= getMonStat(decision.defender, MON_HP)) {
        score += KO_BONUS;
    }
    Choice *best = &decision.best;
    if (best->move == 0 || score > best->score || (score == best->score && damage > best->damage)) {
        best->move = move;
        best->partySlot = decision.slot;
        best->score = score;
        best->damage = damage;
    }
}

static void startSlot(Client *client, AiContext *ctx, BattleMon *mon, uint8_t position)
{
    const uint8_t first = selectableMoves(client, mon, decision.legal);
    decision.continuationMove = 0;
    if (checkCondition(mon, LOCKED_CONTINUATION)) {
        decision.continuationMove = conditionMove(continuation(mon, LOCKED_CONTINUATION));
        // Continuations can use the move even after its PP was spent.
        for (unsigned i = 0; i < 4; ++i) {
            decision.legal[i] = moveAt(mon, i) == decision.continuationMove;
        }
    } else if (first == NO_MOVE_SLOT) {
        return;
    }

    uint32_t flags = ctx->flags;
    ctx->flags = flags & (AI_BASIC | AI_EXPERT);
    setupAi(client->vm, decision.legal, position);
    ctx->flags = flags;
    ctx->defenderPos = PLAYER_FRONT;
    decision.scoring = 1;
}

static int scoreSlot(Client *client, AiContext *ctx, BattleMon *mon)
{
    EventItem *changed[EVENT_POOL_COUNT];
    uint8_t attacker = monId(mon);
    unsigned changedCount = decision.slot == 0 ? 0 : simulateRotation(changed, monId(client->mon), attacker);
    int busy = chooseMove(client->vm, ctx);
    if (!busy) {
        uint8_t defender = monId(decision.defender);
        for (unsigned i = 0; i < 4; ++i) {
            if (decision.legal[i]) {
                uint16_t move = moveAt(mon, i);
                // A forced continuation with no PP has no usable script score.
                int32_t score = decision.continuationMove && movePp(mon, i) == 0 ? 100 : ctx->scores[i];
                considerMove(ctx, attacker, defender, move, score);
            }
        }
    }
    while (changedCount > 0) changed[--changedCount]->flags ^= EVENT_SLEEPING;
    return busy;
}

// The original callback continues handling command setup and finalization.
// The call hook enters states 5 and 6 only after the stock rotation check.
int DISPATCH_HOOK(Client *client, int32_t *seq)
{
    if (*seq == START_ROTATION_AI) {
        decision.defender = positionMon(client->pokeCon, PLAYER_FRONT);
        decision.slot = 0;
        decision.scoring = 0;
        decision.best.move = 0;
        *seq = SCORE_ROTATION_AI;
    } else if (*seq != SCORE_ROTATION_AI) {
        return nativeSelect(client, seq);
    }

    AiContext *ctx = aiContext(client->vm);
    if (decision.defender && !fainted(decision.defender)) {
        for (; decision.slot < 3; ++decision.slot) {
            BattleMon *mon = partyMon(client->party, decision.slot);
            if (!mon || fainted(mon)) continue;
            if (!decision.scoring) {
                uint8_t position = battlePos(client->main, client->pokeCon, monId(mon));
                if (position == NO_BATTLE_POSITION) continue;
                startSlot(client, ctx, mon, position);
                if (!decision.scoring) continue;
            }
            if (scoreSlot(client, ctx, mon)) return 0;
            decision.scoring = 0;
        }
    }

    Action *action = client->action;
    if (!decision.best.move) {
        setStruggle(action, client, client->mon);
    } else {
        if (decision.best.partySlot) {
            setRotation(action++, decision.best.partySlot + 1);
            client->extraActionCount = 1;
            client->action = action;
            client->mon = partyMon(client->party, decision.best.partySlot);
        }
        setFight(action, decision.best.move, PLAYER_FRONT);
    }
    *seq = FINISH_ACTION;
    return 0;
}
