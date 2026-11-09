// Configuration records and owned session state. Field order is part of our ABI.
// Included once by quick_actions.cpp inside its private namespace.

struct ButtonConfig {
    u16 id;
    u8 action, flagMode;
    u16 item, alternate, flag;
    u8 x, y, check, pad[3];
};
static_assert(sizeof(ButtonConfig) == 16);
struct Session {
    // Native handles are borrowed; our added actors, task and uploads are owned.
    u32 magic;
    Subscreen* sub;
    void* unit;
    void* actors[8];
    void* task;
    void* graphics[8];
    u32 chars[8], palette, animation;
    Point positions[8];
    volatile u8 desired[8], uploaded[8];
    u8 available[8], visible;
    // pending is an array slot + 1, NOT an action code. Zero means no request.
    // Fixed controls reserve 254 (music) and 255 (Save).
    u8 pending, pressed, drag, held, active, attempted;
    u32 frame;
    // Eight palettes of sixteen DS colors. DMA sources must stay in main RAM.
    u16 colours[128];
    u8 rings[8][4];
    void* patterns;
    void* uploadBuffer;
    u16 uploadColours[128];
    u8 dim, shown[8];
    u8 count, resetHeld, error;
    u16 resetFrames;
    ButtonConfig buttons[8];
    // Skin IDs remain stable when the authored list is reordered.
    u16 skinIds[64], skinMembers[64];
    u32 skinHashes[64];
    u16 currentSkin, wantedSkin, defaultSkin;
    u8 skinCount, skinCaptured, skinRequest, skinUpload;
    void* skinOriginal;
    void* skinBuffer;
    u8 hideCommunication, saveControl, networkMoved, skinFeedback;
    u8 muteControl, muteState;
    u8 dialControl, dialCaptured, markerUploaded, skinSound, preparedSound, appliedSound;
    u16 dialAngle;
    s16 dialAccum, markerX, markerY;
    // A prepared upload keeps its ID, even if the stylus requests another skin.
    u16 preparedSkin, dialTarget;
    void* marker;
    u32 markerChars;
};
#if defined(CG_SPLIT_UI)
#define CG_SHARED(type, name) extern __attribute__((visibility("default"))) type name
#elif defined(CG_SPLIT_FIELD)
#define CG_SHARED(type, name) __attribute__((visibility("default"))) type name
#else
#define CG_SHARED(type, name) type name
#endif
#ifdef CG_SPLIT_UI
// RPM data imports do not preserve C++ member-address addends. Resolve the
// shared object through a function so member offsets stay CPU arithmetic.
__attribute__((visibility("default"), const)) Session* sharedSession();
#define session (*sharedSession())
#else
Session session;
#ifdef CG_SPLIT_FIELD
__attribute__((visibility("default"), const)) Session* sharedSession() { return &session; }
#endif
#endif
static_assert(__builtin_offsetof(Session, hideCommunication) == 1400);
static_assert(__builtin_offsetof(Session, skinFeedback) == 1403);
// Archive state is also read on the no-C-Gear initialization path: encounter
// hooks must not depend on whether the touch-screen sprites are visible.
CG_SHARED(bool, enabled);
CG_SHARED(bool, repelPresent);
CG_SHARED(bool, pokenavEnabled);
CG_SHARED(MapRequest*, ownedMap);
CG_SHARED(void*, radarWork);
