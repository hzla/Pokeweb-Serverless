// BW1 uses a hex-panel C-Gear and a different application request ABI.
// Keep its display adapter separate from the BW2 ring/skin implementation.
using u8 = unsigned char;
using u16 = unsigned short;
using u32 = unsigned int;
using s16 = short;
#include "profiles-bw1.generated.h"
#include "pc-bw1.generated.h"
template <class T> T& at(void* p, u32 n) {
    return *reinterpret_cast<T*>(static_cast<u8*>(p) + n);
}
template <class F> F fn(u32 entry) {
    return reinterpret_cast<F>(entry);
}
constexpr u32 INVALID = 0xffffffff;
// GCC may emit this for aggregate initialization in a freestanding module.
extern "C" void* memset(void* p, int value, u32 size) {
    auto* out = static_cast<volatile u8*>(p);
    for (u32 i = 0; i < size; i++)
        out[i] = value;
    return p;
}
struct Subscreen {
    u32 mode, next, state;
    u16 heap, pad;
    u32 result;
    void* field;
    void* callback;
    void* callbackData;
    void* work;
};
struct Point {
    u8 x, y;
};
struct Button {
    u16 id;
    u8 action, flagMode;
    u16 item, alternate, flag;
    u8 x, y, check, pad[3];
};
struct MapRequest {
    void* system;
    void* field;
    void* parent;
    u32 call;
    void* data;
    void* open;
    void* close;
    void* before;
    void* user;
    u32 result, selection, pokemon, zone, x, y, z;
};
struct FlyCheck {
    u16 zone, bits;
    u32 form;
    void* system;
    void* actor;
    void* field;
};
struct UseHeader {
    u16 pokemon, move;
    u32 zone;
};
static_assert(sizeof(Button) == 16 && sizeof(MapRequest) == 64 && sizeof(Subscreen) == 36);
namespace {
struct Session {
    u32 magic;
    Subscreen* sub;
    void* unit;
    void* actors[10];
    void* task;
    void* graphics[10];
    u32 chars[10], palette, animation;
    Point positions[8];
    Button buttons[8];
    u16 colours[144], uploadColours[144];
    void* patterns;
    void* uploadBuffer;
    u8 desired[10], uploaded[10], shown[8], available[8];
    u8 count, visible, active, attempted, held, pending, pressed, drag, error, edit, resetHeld,
        feedback;
    u16 resetFrames;
    u8 networkMoved;
    s16 dragX, dragY;
} session;
bool enabled, repelPresent, initialized, stylusLatched;
bool panelsOwned, panelsWereVisible;
MapRequest* ownedMap;
void* radarWork;
void clear(void* p, u32 n) {
    for (u32 i = 0; i < n; i++)
        at<u8>(p, i) = 0;
}
u32 clamp(u32 n, u32 lo, u32 hi) {
    return n < lo ? lo : n > hi ? hi : n;
}
u32 fingerprint(const u8* p, u32 n) {
    u32 h = 0x811c9dc5;
    for (u32 i = 0; i < n; i++)
        h = (h ^ p[i]) * 0x1000193;
    return h;
}
u16 crc(const u8* p, u32 n) {
    u16 c = 0xffff;
    for (u32 i = 0; i < n; i++) {
        c ^= p[i];
        for (u32 j = 0; j < 8; j++)
            c = (c >> 1) ^ ((c & 1) ? 0xa001 : 0);
    }
    return c;
}
void* system(Subscreen* s) {
    return s ? at<void*>(s->field, 4) : nullptr;
}
void* gameFromSystem(void* sys) {
    return fn<void* (*)(void*)>(Native::Game)(sys);
}
void* game(Subscreen* s) {
    return s ? gameFromSystem(system(s)) : nullptr;
}
void* party(void* g) {
    return fn<void* (*)(void*)>(Native::Party)(g);
}
u32 count(void* g) {
    return fn<u32 (*)(void*)>(Native::PartyCount)(party(g));
}
void* record(void* g) {
    void* save = fn<void* (*)(void*)>(Native::Save)(g);
    return static_cast<u8*>(fn<void* (*)(void*)>(Native::Etc)(save)) + 164;
}
bool validRecord(void* p) {
    return at<u32>(p, 0) == 0x31475143 && at<u16>(p, 4) == 1 && at<u16>(p, 6) == 48 &&
           at<u8>(p, 8) <= 1 && crc(static_cast<u8*>(p), 44) == at<u16>(p, 44) &&
           static_cast<u16>(~at<u16>(p, 44)) == at<u16>(p, 46);
}
bool writableRecord(void* p) {
    if (validRecord(p))
        return true;
    for (u32 i = 0; i < 48; i++)
        if (at<u8>(p, i))
            return false;
    return true;
}
void seal(void* p) {
    at<u16>(p, 44) = crc(static_cast<u8*>(p), 44);
    at<u16>(p, 46) = ~at<u16>(p, 44);
}
bool repel(void* g) {
    if (!enabled || !repelPresent)
        return false;
    void* p = record(g);
    return validRecord(p) && at<u8>(p, 8);
}
void loadPositions(void* g) {
    void* p = record(g);
    bool good = validRecord(p);
    for (u32 i = 0; i < session.count; i++) {
        const auto& b = session.buttons[i];
        Point pos = {b.x, b.y};
        if (good)
            for (u32 j = 0; j < 8; j++)
                if (at<u16>(p, 12 + j * 4) == b.id)
                    pos = {at<u8>(p, 14 + j * 4), at<u8>(p, 15 + j * 4)};
        session.positions[i] =
            (pos.x >= 16 && pos.x <= 240 && pos.y >= 16 && pos.y <= 176) ? pos : Point{b.x, b.y};
    }
}
void savePositions(void* g) {
    void* p = record(g);
    if (!writableRecord(p))
        return;
    bool preference = validRecord(p) && at<u8>(p, 8);
    clear(p, 48);
    at<u32>(p, 0) = 0x31475143;
    at<u16>(p, 4) = 1;
    at<u16>(p, 6) = 48;
    at<u8>(p, 8) = preference;
    for (u32 i = 0; i < session.count; i++) {
        at<u16>(p, 12 + i * 4) = session.buttons[i].id;
        at<u8>(p, 14 + i * 4) = session.positions[i].x;
        at<u8>(p, 15 + i * 4) = session.positions[i].y;
    }
    seal(p);
}
bool item(void* g, u32 id, u16 heap) {
    return fn<u32 (*)(void*, u32, u32, u32)>(Native::HasItem)(fn<void* (*)(void*)>(Native::Bag)(g),
                                                              id, 1, heap);
}
bool show(u32 i, Subscreen* s) {
    auto& b = session.buttons[i];
    void* g = game(s);
    if (b.item && !item(g, b.item, s->heap) && (!b.alternate || !item(g, b.alternate, s->heap)))
        return false;
    if (b.flagMode) {
        bool set =
            fn<u32 (*)(void*, u16)>(Native::Flag)(fn<void* (*)(void*)>(Native::Flags)(g), b.flag);
        if (set != (b.flagMode == 1))
            return false;
    }
    return true;
}
void* radarEncounter(Subscreen* s) {
    void* enc = fn<void* (*)(void*)>(Native::FieldEncounter)(s->field);
    if (!enc || at<void*>(enc, 0) != s->field || !at<void*>(enc, 12) || !at<void*>(enc, 16))
        return nullptr;
    if (!(at<u8>(at<void*>(enc, 12), 7) & 0x80) ||
        fn<u32 (*)(void*)>(Native::FieldController)(s->field) != 0)
        return nullptr;
    if (!fn<u32 (*)(void*, u32)>(Native::Badge)(fn<void* (*)(void*)>(Native::Misc)(game(s)), 0))
        return nullptr;
    void* state = fn<void* (*)(void*)>(Native::EncounterState)(game(s));
    return state && !(at<u8>(state, 0x1d) & 15) ? enc : nullptr;
}
void pokeradar(Subscreen* s) {
    void* enc = radarEncounter(s);
    if (!enc)
        return;
    void* state = fn<void* (*)(void*)>(Native::EncounterState)(game(s));
    radarWork = at<void*>(enc, 16);
    for (u32 i = 0; i < 32 && !(at<u8>(state, 0x1d) & 15); i++)
        fn<void (*)(void*)>(Native::Phenomenon)(enc);
    radarWork = nullptr;
}
bool canUse(u32 i, Subscreen* s) {
    if (!show(i, s))
        return false;
    const auto& b = session.buttons[i];
    // BW1 returns TRUE for allowed use; BW2's corresponding helper returns an error code.
    if (b.check != 255 &&
        !fn<u32 (*)(u32, void*, void*)>(Native::ItemCheck)(b.check, system(s), s->field))
        return false;
    if ((b.action == 12 || b.action == 16) && !count(game(s)))
        return false;
    if (b.action == 1 && !writableRecord(record(game(s))))
        return false;
    return b.action != 17 || radarEncounter(s);
}
constexpr u32 ACTION_HM_FLY = 19, FLY_HM_ITEM = 421;
bool isFlyMapAction(u32 action) {
    return action == 4 || action == ACTION_HM_FLY;
}
int flyMember(void* field, void* g, bool requireMove = true) {
    FlyCheck check;
    fn<void (*)(void*, FlyCheck*)>(Native::FlyInit)(field, &check);
    if (fn<u32 (*)(FlyCheck*)>(Native::FlyCheck)(&check))
        return -1;
    void* p = party(g);
    for (u32 i = 0; i < count(g); i++) {
        void* mon = fn<void* (*)(void*, u32)>(Native::GetMon)(p, i);
        auto get = fn<u32 (*)(void*, u32, void*)>(Native::MonGet);
        if (get(mon, 0x4c, nullptr))
            continue;
        // The native animation needs a non-Egg, but HM Fly does not require
        // that member to know Fly and never changes its moves.
        if (!requireMove)
            return static_cast<int>(i);
        for (u32 m = 0x36; m < 0x3a; m++)
            if (get(mon, m, nullptr) == 19)
                return static_cast<int>(i);
    }
    return -1;
}
void* archive(u16 heap) {
    void* h = fn<void* (*)(u32, u32, u32, const char*, u32)>(Native::Alloc)(heap, 80, 1,
                                                                            "cgear-buttons", 0);
    if (!h)
        return nullptr;
    fn<void (*)(void*)>(Native::FileInit)(h);
    if (!fn<u32 (*)(void*, const char*)>(Native::FileOpen)(h, "rom:/quick-actions/ui.narc")) {
        fn<void (*)(void*)>(Native::Free)(h);
        return nullptr;
    }
    fn<void (*)(void*)>(Native::ArchiveInit)(h);
    return h;
}
void closeArchive(void* h) {
    if (h)
        fn<void (*)(void*)>(Native::ArchiveClose)(h);
}
void* read(void* h, u32 member, u16 heap, u32 size) {
    if (fn<u32 (*)(void*, u32)>(Native::ArchiveSize)(h, member) != size)
        return nullptr;
    return fn<void* (*)(void*, u32, u32)>(Native::ArchiveRead)(h, member, heap);
}
bool config(void* h, u16 heap) {
    session.count = 0;
    repelPresent = false;
    void* b = read(h, 0, heap, 160);
    if (!b)
        return false;
    u8 bytes[156];
    for (u32 i = 0; i < 28; i++)
        bytes[i] = at<u8>(b, i);
    for (u32 i = 32; i < 160; i++)
        bytes[i - 4] = at<u8>(b, i);
    bool ok = at<u32>(b, 0) == 0x41475143 && at<u16>(b, 4) == 9 && at<u16>(b, 6) == 160 &&
              at<u32>(b, 8) == 1 && at<u32>(b, 12) == 0x41475142 && at<u8>(b, 20) <= 8 &&
              !at<u8>(b, 21) && !at<u16>(b, 22) && at<u8>(b, 45) == 1 &&
              fingerprint(bytes, 156) == at<u32>(b, 28);
    if (ok) {
        session.count = at<u8>(b, 20);
        for (u32 i = 0; i < 8; i++) {
            for (u32 n = 0; n < 16; n++)
                at<u8>(&session.buttons[i], n) = at<u8>(b, 32 + i * 16 + n);
            auto& v = session.buttons[i];
            if (i < session.count) {
                if (!v.id || !v.action || v.action > ACTION_HM_FLY || v.action == 10 ||
                    v.action == 11 || v.action == 13 || v.action == 14 || v.action == 18 ||
                    v.flagMode > 2 || (v.flagMode && (!v.flag || v.flag > 2911)) || v.x < 16 ||
                    v.x > 240 || v.y < 16 || v.y > 176 || (v.check != 255 && v.check > 9))
                    ok = false;
                for (u32 j = 0; j < i; j++)
                    if (v.id == session.buttons[j].id)
                        ok = false;
                if (v.action == 1)
                    repelPresent = true;
            }
        }
    }
    fn<void (*)(void*)>(Native::Free)(b);
    if (!ok) {
        session.count = 0;
        repelPresent = false;
    }
    return ok;
}
void visible(void* actor, bool on) {
    if (actor)
        fn<void (*)(void*, u32)>(Native::ActorVisible)(actor, on);
}
void position(void* actor, u32 x, u32 y) {
    if (actor) {
        s16 xy[2] = {static_cast<s16>(x), static_cast<s16>(y)};
        fn<void (*)(void*, const s16*, u32)>(Native::ActorPlace)(actor, xy, 0);
    }
}
void place(u32 i) {
    position(session.actors[i], session.positions[i].x, session.positions[i].y);
}
u32 subPlanes() {
    return (*reinterpret_cast<volatile u32*>(0x04001000) >> 8) & 31;
}
void hidePanels() {
    u32 planes = subPlanes();
    if (!panelsOwned) {
        panelsWereVisible = planes & 1;
        panelsOwned = true;
    }
    // Startup can enable BG0 without updating the native visibility cache. The
    // unconditional native setter synchronizes both; preserve all other planes.
    fn<void (*)(u32)>(Native::SubPlanes)(planes & ~1u);
}
void dispose() {
    session.visible = 0;
    session.pending = 0;
    session.drag = 255;
    if (panelsOwned)
        fn<void (*)(u32)>(Native::SubPlanes)((subPlanes() & ~1u) |
                                             static_cast<u32>(panelsWereVisible));
    panelsOwned = false;
    if (session.networkMoved)
        fn<void (*)(u32, u32)>(Native::NetworkPosition)(218, 14);
    session.networkMoved = 0;
    if (!initialized) {
        session.palette = session.animation = INVALID;
        for (auto& c : session.chars)
            c = INVALID;
        initialized = true;
    }
    if (session.task)
        fn<void (*)(void*)>(Native::TaskDelete)(session.task);
    session.task = nullptr;
    for (u32 i = 0; i < 10; i++) {
        if (session.actors[i])
            fn<void (*)(void*)>(Native::ActorDelete)(session.actors[i]);
        session.actors[i] = nullptr;
    }
    session.unit = nullptr;
    for (u32 i = 0; i < 10; i++) {
        if (session.chars[i] != INVALID)
            fn<void (*)(u32)>(Native::CharDelete)(session.chars[i]);
        session.chars[i] = INVALID;
        if (session.graphics[i])
            fn<void (*)(void*)>(Native::Free)(session.graphics[i]);
        session.graphics[i] = nullptr;
    }
    if (session.animation != INVALID)
        fn<void (*)(u32)>(Native::AnimationDelete)(session.animation);
    session.animation = INVALID;
    if (session.palette != INVALID)
        fn<void (*)(u32)>(Native::PaletteDelete)(session.palette);
    session.palette = INVALID;
    if (session.patterns)
        fn<void (*)(void*)>(Native::Free)(session.patterns);
    session.patterns = nullptr;
    if (session.uploadBuffer)
        fn<void (*)(void*)>(Native::Free)(session.uploadBuffer);
    session.uploadBuffer = nullptr;
    session.sub = nullptr;
}
bool freeResources() {
    void* sys = *reinterpret_cast<void**>(Native::SpriteSystem);
    if (!sys)
        return false;
    u32 free = 0;
    void* chars = at<void*>(sys, 0x10c);
    for (u32 i = 0; i < at<u16>(sys, 0x118); i++)
        if (at<u32>(chars, i * 64 + 60) & 0x80000000)
            free++;
    if (free < session.count + 1u)
        return false;
    bool palette = false;
    void* pals = at<void*>(sys, 0x110);
    for (u32 i = 0; i < at<u16>(sys, 0x11a); i++)
        if (at<u32>(pals, i * 24 + 20) & 0x80000000)
            palette = true;
    if (!palette)
        return false;
    void* anim = at<void*>(sys, 0x114);
    for (u32 i = 0; i < at<u16>(sys, 0x11c); i++)
        if (at<u32>(anim, i * 20 + 16))
            return true;
    return false;
}
u32 pixel(const u8* data, u32 size, u32 x, u32 y) {
    u32 n = ((y / 8) * (size / 8) + x / 8) * 32 + (y % 8) * 4 + (x % 8) / 2;
    return (data[n] >> ((x % 2) * 4)) & 15;
}
constexpr u8 dim[32] = {0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4,  5,
                        5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10};
constexpr u8 active[32] = {4,  4,  5,  6,  7,  8,  9,  10, 10, 11, 12, 13, 14, 15, 16, 17,
                           17, 18, 19, 20, 21, 22, 23, 24, 24, 25, 26, 27, 28, 29, 30, 31};
constexpr u8 pressed[32] = {8,  8,  9,  10, 10, 11, 12, 13, 13, 14, 15, 16, 16, 17, 18, 19,
                            19, 20, 21, 22, 22, 23, 24, 25, 25, 26, 27, 28, 28, 29, 30, 31};
void upload(void*, void*) {
    if (!session.visible || !session.sub)
        return;
    hidePanels();
    for (u32 i = 0; i < 144; i++)
        session.uploadColours[i] = session.colours[i];
    for (u32 i = 0; i < 9; i++) {
        u32 pose = session.desired[i == 8 ? 9 : i] >> 4;
        for (u32 j = 1; j < 16; j++) {
            u16 c = session.colours[i * 16 + j], out = 0;
            for (u32 shift = 0; shift < 15; shift += 5) {
                u32 channel = (c >> shift) & 31;
                if (pose == 3)
                    channel = dim[channel];
                else if (((pose == 1 || pose == 2) && j >= 12) || (pose == 2 && j == 5))
                    channel = pose == 1 ? active[channel] : pressed[channel];
                out |= channel << shift;
            }
            session.uploadColours[i * 16 + j] = out;
        }
    }
    struct Palette {
        u32 format, extended, size;
        void* data;
    } pal = {3, 0, 288, session.uploadColours};
    fn<void (*)(u32, const void*, u32)>(Native::PaletteUpload)(session.palette, &pal, 9);
    struct Character {
        u16 height, width;
        u32 format, mapping, character, size;
        void* data;
    };
    for (u32 i = 0; i < 10; i++)
        if (session.actors[i]) {
            u8 shape = i < 8 ? session.desired[i] & 15 : 0;
            if (session.uploaded[i] != shape) {
                u32 size = i < 8 ? 1024 : 512;
                auto* target = static_cast<u8*>(session.uploadBuffer) + (i < 8 ? i * 1024 : 8192);
                auto* art = static_cast<u8*>(session.graphics[i]);
                for (u32 n = 0; n < size; n++)
                    target[n] = art[n];
                if (i < 8) {
                    auto* panel = static_cast<u8*>(session.patterns) + shape * 512;
                    for (u32 n = 0; n < 512; n++)
                        target[n] = panel[n];
                }
                Character c = {0xffff, 0xffff, 3, 16, 0, size, target};
                fn<void (*)(u32, const void*)>(Native::CharUpload)(session.chars[i], &c);
                session.uploaded[i] = shape;
            }
            visible(session.actors[i], i == 9 || session.shown[i]);
        }
}
void attach(Subscreen* s) {
    dispose();
    session.magic = 0x31415143;
    session.sub = s;
    session.drag = session.pressed = 255;
    session.held = stylusLatched;
    session.edit = 0;
    session.error = 1;
    void* h = archive(s->heap);
    enabled = h && config(h, s->heap);
    if (!enabled || !freeResources() || fn<u32 (*)(u32)>(Native::HeapFree)(s->heap) < 65536 ||
        fn<u32 (*)(u32)>(Native::HeapLargest)(s->heap) < 16384) {
        closeArchive(h);
        dispose();
        return;
    }
    session.error = 2;
    loadPositions(game(s));
    void* pal = read(h, 1, s->heap, 328);
    if (!pal) {
        closeArchive(h);
        dispose();
        return;
    }
    for (u32 i = 0; i < 144; i++)
        session.colours[i] = at<u16>(pal, 40 + i * 2);
    fn<void (*)(void*)>(Native::Free)(pal);
    session.patterns = read(h, 12, s->heap, 5120);
    session.uploadBuffer = fn<void* (*)(u32, u32, u32, const char*, u32)>(Native::Alloc)(
        s->heap, 8704, 1, "cgear-buttons", 0);
    if (!session.patterns || !session.uploadBuffer) {
        closeArchive(h);
        dispose();
        return;
    }
    session.error = 3;
    session.palette =
        fn<u32 (*)(void*, u32, u32, u32, u32)>(Native::PaletteLoad)(h, 1, 1, 32, s->heap);
    session.animation = fn<u32 (*)(void*, u32, u32, u32)>(Native::AnimationLoad)(h, 2, 3, s->heap);
    session.unit = at<void*>(s->work, 0x34);
    if (session.palette == INVALID || session.animation == INVALID || !session.unit) {
        closeArchive(h);
        dispose();
        return;
    }
    void* actors = at<void*>(session.unit, 0);
    u32 free = 0;
    for (u32 i = 0; i < at<u16>(session.unit, 12); i++)
        if (!at<u32>(actors, i * 228))
            free++;
    if (free < session.count + 1u) {
        closeArchive(h);
        dispose();
        return;
    }
    void* fixed = read(h, 16, s->heap, 512);
    if (!fixed) {
        closeArchive(h);
        dispose();
        return;
    }
    for (u32 reverse = 10; reverse > 0; reverse--) {
        u32 i = reverse - 1;
        if (i == 8 || (i < 8 && i >= session.count))
            continue;
        session.error = 8 + i;
        if (i < 8)
            session.graphics[i] = read(h, 4 + i, s->heap, 1024);
        else {
            session.graphics[i] = fixed;
            fixed = nullptr;
        }
        session.chars[i] =
            fn<u32 (*)(u32, u32, u32)>(Native::CharCreate)(i < 8 ? 1024 : 512, 1, s->heap);
        if (!session.graphics[i] || session.chars[i] == INVALID)
            break;
        void* sys = *reinterpret_cast<void**>(Native::SpriteSystem);
        void* resource = static_cast<u8*>(at<void*>(sys, 0x10c)) + session.chars[i] * 64;
        if (fn<u32 (*)(void*)>(Native::VramInvalid)(static_cast<u8*>(resource) + 0x34))
            break;
        struct ActorData {
            s16 x, y;
            u16 sequence;
            u8 priority, bg;
        } data = {static_cast<s16>(i < 8 ? session.positions[i].x : 218),
                  static_cast<s16>(i < 8 ? session.positions[i].y : 14), static_cast<u16>(i), 0, 0};
        session.actors[i] = fn<void* (*)(void*, u32, u32, u32, const void*, u32, u32)>(
            Native::ActorCreate)(session.unit, session.chars[i], session.palette, session.animation,
                                 &data, 0, s->heap);
        if (!session.actors[i])
            break;
        fn<void (*)(void*, u32)>(Native::ActorAnimate)(session.actors[i], 1);
        visible(session.actors[i], false);
        session.uploaded[i] = 255;
        session.desired[i] = 0;
    }
    if (fixed)
        fn<void (*)(void*)>(Native::Free)(fixed);
    closeArchive(h);
    bool good = true;
    for (u32 i = 0; i < 10; i++)
        if ((i == 9 || i < session.count) && !session.actors[i])
            good = false;
    if (!good) {
        dispose();
        return;
    }
    session.error = 40;
    session.task = fn<void* (*)(void*, void*, u32)>(Native::VBlank)(reinterpret_cast<void*>(upload),
                                                                    nullptr, 2);
    if (!session.task)
        dispose();
    else
        session.error = 0;
}
bool drawable(Subscreen* s) {
    return s && session.sub == s && s->mode == 0 && !s->state && s->work && session.unit &&
           at<u32>(s->work, 0) == Native::GearIdle;
}
bool safe(Subscreen* s) {
    return session.active && drawable(s) && !at<u32>(s->work, 0x214);
}
void refresh(Subscreen* s, u32 active) {
    session.active = active;
    session.visible = drawable(s);
    if (!session.unit)
        return;
    if (!safe(s)) {
        session.pending = 0;
        session.drag = session.pressed = 255;
    }
    if (session.visible) {
        hidePanels();
        for (u32 i = 0; i < 3; i++)
            visible(at<void*>(s->work, 0x158 + i * 4), false);
        for (u32 n = 0x164; n <= 0x16c; n += 4)
            visible(at<void*>(s->work, n), false);
        // Preserve the native wrench, help, power and logo palettes and positions.
        for (u32 n = 0x14c; n <= 0x154; n += 4)
            visible(at<void*>(s->work, n), true);
        if (!session.networkMoved) {
            fn<void (*)(u32, u32)>(Native::NetworkPosition)(256, 192);
            session.networkMoved = 1;
        }
        for (u32 i = 0; i < session.count; i++) {
            session.shown[i] = show(i, s);
            session.available[i] = canUse(i, s);
        }
        if (session.feedback)
            session.feedback--;
    }
    for (u32 i = 0; i < 10; i++)
        if (session.actors[i]) {
            if (i == 9) {
                session.desired[i] = session.feedback ? 32 : 0;
                continue;
            }
            bool on = (session.buttons[i].action == 1 && repel(game(s))) ||
                      (session.buttons[i].action == 3 &&
                       fn<u32 (*)(void*)>(Native::PlayerForm)(
                           fn<void* (*)(void*)>(Native::Player)(game(s))) == 1);
            u32 pose = session.pressed == i    ? 2
                       : session.edit          ? 1
                       : !session.available[i] ? 3
                       : on                    ? 1
                                               : 0;
            u32 design = at<u8>(s->work, 0x458);
            session.desired[i] =
                (pose << 4) | ((at<u8>(s->work, 0x459) == 1 ? 5 : 0) + (design < 5 ? design : 0));
            visible(session.actors[i], session.visible && session.shown[i]);
        }
    if (session.edit && (fn<u32 (*)()>(Native::Keys)() & 0x300) == 0x300) {
        if (!session.resetHeld && ++session.resetFrames >= 30) {
            session.resetHeld = 1;
            session.drag = 255;
            for (u32 i = 0; i < session.count; i++) {
                session.positions[i] = {session.buttons[i].x, session.buttons[i].y};
                place(i);
            }
            savePositions(game(s));
        }
    } else {
        session.resetHeld = 0;
        session.resetFrames = 0;
    }
    if (!session.visible)
        for (auto* actor : session.actors)
            visible(actor, false);
}
bool box(u32 x, u32 y, int cx, int cy) {
    return static_cast<int>(x) >= cx - 8 && static_cast<int>(x) <= cx + 8 &&
           static_cast<int>(y) >= cy - 8 && static_cast<int>(y) <= cy + 8;
}
bool near(u32 x, u32 y, int cx, int cy, int radius) {
    int dx = static_cast<int>(x) - cx, dy = static_cast<int>(y) - cy;
    return dx * dx + dy * dy <= radius * radius;
}
bool hit(u32 i, u32 x, u32 y) {
    int px = static_cast<int>(x) - session.positions[i].x + 16,
        py = static_cast<int>(y) - session.positions[i].y + 32;
    if (px < 0 || px >= 64 || py < 0 || py >= 64)
        return false;
    static constexpr s16 pieces[5][5] = {{-7, -17, 16, 16, 16},
                                         {9, -17, 8, 16, 20},
                                         {-7, -1, 16, 8, 22},
                                         {9, -1, 8, 8, 24},
                                         {17, -20, 32, 8, 25}};
    for (const auto& p : pieces) {
        int x = px - 16 - p[0], y = py - 32 - p[1];
        if (x >= 0 && x < p[2] && y >= 0 && y < p[3] &&
            pixel(static_cast<u8*>(session.graphics[i]) + p[4] * 32, p[2], x, y))
            return true;
    }
    if (px >= 32 || py < 16 || py >= 48)
        return false;
    u32 design = at<u8>(session.sub->work, 0x458);
    if (design > 4)
        design = 0;
    u32 shape = (at<u8>(session.sub->work, 0x459) == 1 ? 5 : 0) + design;
    return pixel(static_cast<u8*>(session.patterns) + shape * 512, 32, px, py - 16) != 0;
}
struct FlyWork {
    MapRequest map;
    u32 member, action, item;
};
u32 restoreScreen(const MapRequest* map, void*) {
    fn<void (*)(void*, u32)>(Native::SubscreenMode)(gameFromSystem(map->system),
                                                    map->result == 4 ? 6 : 0);
    return 1;
}
int flyEvent(void* event, u32* sequence) {
    auto* w = fn<FlyWork* (*)(void*)>(Native::EventData)(event);
    void* sys = fn<void* (*)(void*)>(Native::EventSystem)(event);
    void* field = fn<void* (*)(void*)>(Native::Field)(sys);
    void* g = gameFromSystem(sys);
    if (*sequence == 0) {
        if (!field)
            return 1;
        u32 action = w->action, itemId = w->item;
        bool hmFly = action == ACTION_HM_FLY;
        bool hmOwned = !hmFly || item(g, FLY_HM_ITEM, fn<u32 (*)(void*)>(Native::FieldHeap)(field));
        int member = isFlyMapAction(action) && hmOwned ? flyMember(field, g, !hmFly) : -1;
        clear(w, sizeof(*w));
        w->action = action;
        w->item = itemId;
        w->member = member;
        w->map.system = sys;
        w->map.field = field;
        w->map.call = action == 8                    ? 11
                      : action == 9                  ? 8
                      : action == 15                 ? 2
                      : action == 12 || action == 16 ? 0
                                                     : 7;
        w->map.data = reinterpret_cast<void*>(action == 12 ? 5 : INVALID);
        w->map.user = w;
        w->map.before = reinterpret_cast<void*>(restoreScreen);
        ownedMap = &w->map;
        void* child = fn<void* (*)(MapRequest*, u32)>(Native::Application)(
            &w->map, fn<u32 (*)(void*)>(Native::FieldHeap)(field));
        if (!child) {
            ownedMap = nullptr;
            return 1;
        }
        if (member >= 0) {
            w->map.call = 0;
            at<u8>(fn<void* (*)(void*)>(Native::EventData)(child), 0x60) = member;
        }
        fn<void (*)(void*, void*)>(Native::EventChild)(event, child);
        *sequence = 1;
        return 0;
    }
    ownedMap = nullptr;
    if (*sequence == 1 && (isFlyMapAction(w->action) || w->action == 15 || w->action == 16) &&
        w->map.result == 2 && field) {
        FlyCheck check;
        fn<void (*)(void*, FlyCheck*)>(Native::FlyInit)(field, &check);
        bool flyMap = isFlyMapAction(w->action);
        u32 skill = flyMap ? 4 : w->map.selection;
        if (flyMap && (w->member == INVALID || fn<u32 (*)(FlyCheck*)>(Native::FlyCheck)(&check)))
            return 1;
        if (w->action == ACTION_HM_FLY &&
            !item(g, FLY_HM_ITEM, fn<u32 (*)(void*)>(Native::FieldHeap)(field)))
            return 1;
        UseHeader header = {static_cast<u16>(flyMap ? w->member : w->map.pokemon),
                            static_cast<u16>(skill), w->map.zone};
        void* child =
            fn<void* (*)(u32, UseHeader*, FlyCheck*)>(Native::FlyUse)(skill, &header, &check);
        if (child) {
            fn<void (*)(void*, void*)>(Native::EventChild)(event, child);
            *sequence = 2;
            return 0;
        }
    }
    if (*sequence == 1 && (w->action == 15 || w->action == 16) && w->map.result == 3 && field) {
        void* child =
            fn<void* (*)(u32, void*, void*)>(Native::ItemEvent)(w->map.selection, sys, field);
        if (child) {
            fn<void (*)(void*, void*)>(Native::EventChild)(event, child);
            *sequence = 2;
            return 0;
        }
    }
    return 1;
}
void* storageEvent(void* sys, u16 heap) {
    void* event = fn<void* (*)(void*, u32, void*, u32)>(Native::Script)(sys, 10090, nullptr, heap);
    if (!event)
        return nullptr;
    void* w = fn<void* (*)(void*)>(Native::EventData)(event);
    void* scripts = at<void*>(w, 4);
    void* vm = at<void*>(scripts, 4);
    auto* code = at<u8*>(vm, 44);
    if (code && at<u8*>(vm, 20) == code + 30 &&
        fingerprint(code, PC_SCRIPT_SIZE) == PC_SCRIPT_HASH) {
        static constexpr u16 entry[] = {0x2e,  0x28, 0x8020, 0,      0x28, 0x8021, 1, 4,
                                        0x2bc, 0,    0x132,  0x8021, 0x30, 0x2f,   2};
        for (u32 i = 0; i < sizeof(entry) / 2; i++)
            at<u16>(code, 30 + i * 2) = entry[i];
        fn<void (*)(u32)>(Native::Sound)(1372);
    }
    return event;
}
} // namespace
extern "C" void QaCGearInit(Subscreen* s) {
    dispose();
    session.sub = s;
    session.attempted = 0;
    session.pending = session.held = 0;
    void* h = archive(s->heap);
    enabled = h && config(h, s->heap);
    closeArchive(h);
    fn<void (*)(Subscreen*)>(Native::Init)(s);
    if (enabled && s->mode == 0 && s->work)
        hidePanels();
}
extern "C" void QaCGearExit(Subscreen* s) {
    dispose();
    fn<void (*)(Subscreen*)>(Native::Exit)(s);
}
extern "C" void QaNoGearInit(Subscreen* s) {
    void* h = archive(s->heap);
    enabled = h && config(h, s->heap);
    closeArchive(h);
    fn<void (*)(Subscreen*)>(Native::NoGearInit)(s);
}
extern "C" void* QaGearUnit(u32 count, u32 priority, u32 heap) {
    return fn<void* (*)(u32, u32, u32)>(Native::UnitCreate)(
        count + (enabled ? session.count + 1 : 0), priority, heap);
}
extern "C" void QaGearEnd(void* work) {
    Subscreen* s = session.sub;
    if (s && s->work == work) {
        dispose();
        session.sub = s;
        session.attempted = 0;
    }
    fn<void (*)(void*)>(Native::GearDispose)(work);
}
extern "C" void QaCGearUpdate(Subscreen* s, u32 active) {
    session.active = active;
    fn<void (*)(Subscreen*, u32)>(Native::Update)(s, active);
    if (enabled && !session.attempted && s == session.sub && s->work &&
        at<u32>(s->work, 0) == Native::GearIdle) {
        session.attempted = 1;
        attach(s);
    }
    if (enabled && s == session.sub && s->mode == 0 && s->work &&
        (!session.attempted || session.unit))
        hidePanels();
    refresh(s, active);
}
extern "C" void QaInput(void* buttons) {
    auto* s = session.sub;
    if (!enabled || !session.unit) {
        fn<void (*)(void*)>(Native::NativeButtonInput)(buttons);
        return;
    }
    u32 x = 0, y = 0;
    bool down = fn<u32 (*)(u32*, u32*)>(Native::Touch)(&x, &y);
    if (!down)
        session.held = 0;
    if (!safe(s)) {
        session.pending = 0;
        stylusLatched = down;
        session.held = down;
        if (!down)
            session.pressed = 255;
        return;
    }
    if (session.drag < session.count) {
        if (down) {
            int cx = static_cast<int>(x) - session.dragX, cy = static_cast<int>(y) - session.dragY;
            session.positions[session.drag] = {static_cast<u8>(clamp(cx < 0 ? 0 : cx, 16, 240)),
                                               static_cast<u8>(clamp(cy < 0 ? 0 : cy, 16, 176))};
            place(session.drag);
        } else {
            savePositions(game(s));
            session.drag = session.pressed = 255;
            session.held = 0;
            stylusLatched = false;
        }
        return;
    }
    if (stylusLatched) {
        if (!down) {
            stylusLatched = false;
            session.held = 0;
            session.pressed = 255;
        }
        return;
    }
    if (!down)
        return;
    session.held = 1;
    stylusLatched = true;
    if (box(x, y, 174, 170)) {
        session.edit ^= 1;
        u8 power = at<u8>(s->work, 0x45a);
        at<u8>(s->work, 0x45a) = 1;
        fn<void (*)(void*, u32)>(Native::GearTouch)(s->work, 1);
        at<u8>(s->work, 0x45a) = power;
        return;
    }
    if (near(x, y, 218, 14, 12) || (x >= 96 && x <= 160 && y >= 14 && y <= 30)) {
        if (!session.edit) {
            u8 power = at<u8>(s->work, 0x45a);
            at<u8>(s->work, 0x45a) = 1;
            fn<void (*)(void*, u32)>(Native::GearTouch)(s->work, 5);
            at<u8>(s->work, 0x45a) = power;
            session.feedback = 6;
            fn<void (*)(u32)>(Native::Sound)(1356);
        }
        return;
    }
    if (box(x, y, 222, 170)) {
        if (!session.edit)
            fn<void (*)(void*, u32)>(Native::GearTouch)(s->work, 6);
        return;
    }
    if (box(x, y, 198, 170)) {
        if (!session.edit) {
            u8 power = at<u8>(s->work, 0x45a);
            at<u8>(s->work, 0x45a) = 1;
            fn<void (*)(void*, u32)>(Native::GearTouch)(s->work, 2);
            at<u8>(s->work, 0x45a) = power;
        }
        return;
    }
    for (u32 reverse = session.count; reverse > 0; reverse--) {
        u32 i = reverse - 1;
        if (session.shown[i] && hit(i, x, y)) {
            session.pressed = i;
            if (session.edit) {
                session.drag = i;
                session.dragX = static_cast<int>(x) - session.positions[i].x;
                session.dragY = static_cast<int>(y) - session.positions[i].y;
            } else if (session.available[i])
                session.pending = i + 1;
            return;
        }
    }
    // No native panel, radar, wireless, IR, or Online touch is forwarded.
}
extern "C" void* QaCGearEvent(Subscreen* s, u32 available) {
    void* native = fn<void* (*)(Subscreen*, u32)>(Native::Event)(s, available);
    u32 action = session.pending;
    session.pending = 0;
    if (native || !available || !action || !safe(s) || session.edit)
        return native;
    if (action > session.count || !canUse(action - 1, s))
        return nullptr;
    auto& b = session.buttons[action - 1];
    action = b.action;
    void* g = game(s);
    void* sys = system(s);
    if (action == 1) {
        savePositions(g);
        void* p = record(g);
        if (validRecord(p)) {
            at<u8>(p, 8) ^= 1;
            seal(p);
            if (at<u8>(p, 8))
                fn<void (*)(u32)>(Native::Sound)(1996);
        }
        return nullptr;
    }
    if (action == 2)
        return storageEvent(sys, s->heap);
    if (action == 17) {
        pokeradar(s);
        return nullptr;
    }
    if (action == 3 || action == 6 || action == 7)
        return fn<void* (*)(u32, void*, void*)>(Native::ItemEvent)(action == 3   ? 0
                                                                   : action == 6 ? 5
                                                                                 : 4,
                                                                   sys, s->field);
    void* event = fn<void* (*)(void*, void*, void*, u32)>(Native::EventCreate)(
        sys, nullptr, reinterpret_cast<void*>(flyEvent), sizeof(FlyWork));
    if (event) {
        auto* w = fn<FlyWork* (*)(void*)>(Native::EventData)(event);
        clear(w, sizeof(*w));
        w->action = action;
        w->item = b.item;
        if (isFlyMapAction(action) || action == 5 || action == 15 || action == 16)
            fn<void (*)(u32)>(Native::Sound)(1356);
    }
    return event;
}
extern "C" int QaTownMapReturn(void* work, void* param) {
    if (ownedMap && at<void*>(work, 0x18) == ownedMap && at<u32>(param, 4) != 2) {
        auto* w = static_cast<FlyWork*>(ownedMap->user);
        if (isFlyMapAction(w->action) || w->action == 5)
            return 1;
    }
    return fn<int (*)(void*, void*)>(Native::TownMapReturn)(work, param);
}
extern "C" u32 QaRepelStep(void* encounter, void* sys) {
    if (repel(gameFromSystem(sys)))
        return 0;
    return fn<u32 (*)(void*)>(Native::RepelStep)(encounter);
}
extern "C" u32 QaRepelDepleted(void* encounter, void* g) {
    if (repel(g) && count(g))
        return 0;
    return fn<u32 (*)(void*)>(Native::RepelDepleted)(encounter);
}
extern "C" u32 QaPhenomenonInterval(void* state, void* effect) {
    return radarWork && radarWork == effect
               ? 1
               : fn<u32 (*)(void*, void*)>(Native::PhenomenonInterval)(state, effect);
}
extern "C" u32 QaPhenomenonChance(u32 maximum) {
    return radarWork ? 0 : fn<u32 (*)(u32)>(Native::Random)(maximum);
}
