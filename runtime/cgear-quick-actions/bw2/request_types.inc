// Native application request lifetimes: Save, optional Pokenav, PC and Party/Bag/Map.
// Included once by quick_actions.cpp inside its private namespace.

// Native report state owns its allocations and ordinary yes/no/save flow.
// Our event owns the 32-byte request and waits for subscreen reconstruction.
struct SaveWork {
    void* control;
    void* sys;
    void* field;
    void* message;
    u16 heap, pad;
    void* result;
    u32 returnMode;
    void* local;
    Subscreen* sub;
    u32 reportSequence, finished;
};
static_assert(__builtin_offsetof(SaveWork, sub) == 32);
struct FlyWork {
    MapRequest map;
    u32 member, action, item;
};
// Optional custom-screen integration. The beginner guide resumes at
// storageEvent(); Pokenav's own screen implementation is in runtime/pokenav.
struct NavWork {
    MapRequest map;
    pokenav::Launch request;
};

#if defined(CG_SPLIT_UI) || defined(CG_SPLIT_FIELD)
#define CG_FIELD_API __attribute__((visibility("default")))
#else
#define CG_FIELD_API
#endif
CG_FIELD_API int saveEvent(void*, u32*);
bool navConfigured(u16);
void* navLaunch(Subscreen*);
void* storageEvent(void*, u16);
CG_FIELD_API int flyEvent(void*, u32*);
CG_FIELD_API int navEvent(void*, u32*);
