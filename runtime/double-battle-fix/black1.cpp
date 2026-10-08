// US Black / IRBO, revision 0. Trainer setup and script layouts are BW1's.
// The single-NPC behavior follows the bundled Sunk/Papaya BW2 fix.
using u32 = unsigned int;
using u16 = unsigned short;

struct TrainerSetup {
    void *actor;
    u32 position;
    u32 direction;
    u32 scriptId;
    u32 trainerId;
    u32 format;
};
static_assert(sizeof(TrainerSetup) == 24, "BW1 trainer setup ABI");

template <u32 Address, typename Result, typename... Args>
static Result native(Args... args) {
    return reinterpret_cast<Result (*)(Args...)>(Address | 1)(args...);
}

static void *startClash(void *field, TrainerSetup &first,
                        TrainerSetup *second, u32 format) {
    void *event = native<0x021ae930, void *>(field, first.actor);
    first.format = format;
    native<0x0215a438, void>(event, 0u, &first);
    if (second) {
        second->format = format;
        native<0x0215a438, void>(event, 1u, second);
    }
    return event;
}

extern "C" void *THUMB_BRANCH_21_0x021ae0cc(void *field) {
    TrainerSetup first, second;
    if (native<0x021ae1fc, int>(field, static_cast<void *>(nullptr), &first) != 1)
        return nullptr;
    const u32 type = native<0x0215a4c8, u32>(static_cast<u16>(first.trainerId));
    void *system = native<0x02188c80, void *>(field);
    const int usable = native<0x0218b6ac, int>(system);
    if (type == 0) {
        if (usable >= 2 && native<0x021ae1fc, int>(field, first.actor, &second))
            return startClash(field, first, &second, 2);
        return startClash(field, first, nullptr, 0);
    }
    if (type == 1) {
        if (usable < 2) return nullptr;
        void *partner = native<0x021ae8d4, void *>(first.actor, static_cast<u16>(first.trainerId));
        // A trainer changed from Singles to Doubles has no paired map actor.
        // The common script still reads the trainer's Double battle type;
        // format 0 supplies a single trainer instead of a missing partner.
        if (!partner) return startClash(field, first, nullptr, 0);
        native<0x021ae8b4, void>(&second, partner, first.position, static_cast<u16>(first.direction));
        return startClash(field, first, &second, 1);
    }
    if ((type == 2 || type == 3) && usable >= 3)
        return startClash(field, first, nullptr, 0);
    return nullptr;
}

static bool actorExists(void *system, u32 scriptId) {
    u32 index = 0;
    void *actor;
    while (native<0x0216dd1c, int>(system, &actor, &index) == 1) {
        if (native<0x0216d5b8, u32>(actor) == scriptId) return true;
    }
    return false;
}

extern "C" int THUMB_BRANCH_21_0x021aebb0(void *vm, void *environment) {
    void *work = native<0x0215a5f4, void *>(environment);
    const u32 scriptId = native<0x02158f8c, u32>(work);
    u16 *intro = native<0x02159ae8, u16 *>(vm, environment);
    u16 *defeat = native<0x02159ae8, u16 *>(vm, environment);
    u16 *after = native<0x02159ae8, u16 *>(vm, environment);
    u16 a = 0, b = 2, c = 24;
    const u16 trainerId = native<0x0215a460, u16>(scriptId);
    if (native<0x0215a4b4, u16>(trainerId)) {
        if (native<0x0215a4a0, u16>(scriptId)) {
            a = 7; b = 9; c = 10;
        } else {
            void *actors = native<0x0215a5ec, void *>(environment);
            if (actorExists(actors, scriptId + 2000)) {
                a = 3; b = 5; c = 6;
            }
        }
    }
    *intro = a; *defeat = b; *after = c;
    return 0;
}
