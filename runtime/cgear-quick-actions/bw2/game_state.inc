// Native data access, ownership/visibility, availability and field prerequisites.
// Included once by quick_actions.cpp inside its private namespace.

u32 clamp(u32 n, u32 lo, u32 hi) {
    return n < lo ? lo : n > hi ? hi : n;
}
void clear(void* p, u32 n) {
    for (u32 i = 0; i < n; i++)
        at<u8>(p, i) = 0;
}
void* game(Subscreen* subscreen) {
    return subscreen ? at<void*>(subscreen->field, 8) : nullptr;
}
void* system(Subscreen* subscreen) {
    return subscreen ? at<void*>(subscreen->field, 4) : nullptr;
}
void* save(void* gameData) {
    return api<void* (*)(void*)>(CG_GET_SAVE_DATA)(gameData);
}
[[maybe_unused]] u16* options(void* gameData) {
    return api<u16* (*)(void*)>(CG_GET_OPTIONS)(save(gameData));
}
void* cgearSave(void* gameData) {
    return api<void* (*)(void*)>(CG_GET_CGEAR_SAVE)(save(gameData));
}
void* party(void* gameData) {
    return api<void* (*)(void*)>(CG_GET_PARTY)(gameData);
}
u32 count(void* gameData) {
    return api<u32 (*)(void*)>(CG_PARTY_COUNT)(party(gameData));
}
bool repel(void* gameData) {
#ifdef CGEAR_REDUX
    // Redux's PC/script toggle owns this flag and its encounter hook. Reflect
    // that same state rather than introducing a second saved preference.
    return api<u32 (*)(void*, u16)>(CG_GET_SAVE_FLAG)(
        api<void* (*)(void*)>(CG_GET_FLAG_WORK)(gameData), 0x0bf7);
#else
    return enabled && repelPresent && (*options(gameData) & CG_REPEL_OPTION_MASK);
#endif
}
#ifdef CGEAR_REDUX
bool toggleRepel(void* gameData) {
    void* work = api<void* (*)(void*)>(CG_GET_FLAG_WORK)(gameData);
    u8* byte = api<u8* (*)(void*, u16)>(0x2019278)(work, 0x0bf7);
    if (byte)
        *byte ^= 1u << (0x0bf7 & 7);
    return repel(gameData);
}
#endif
bool cycling(void* gameData) {
    return api<u32 (*)(void*)>(CG_GET_TRAVEL_MODE)(
               api<void* (*)(void*)>(CG_GET_PLAYER_STATE)(gameData)) == 1;
}
bool item(void* gameData, u32 id, u16 heap) {
    return api<u32 (*)(void*, u32, u32, u32)>(CG_BAG_HAS_ITEM)(
        api<void* (*)(void*)>(CG_GET_BAG)(gameData), id, 1, heap);
}
// Visibility: missing items/visibility flags remove both the sprite and its hit.
bool show(u32 i, Subscreen* subscreen) {
    void* gameData = game(subscreen);
    const auto& b = session.buttons[i];
    if (b.item && !item(gameData, b.item, subscreen->heap) &&
        (!b.alternate || !item(gameData, b.alternate, subscreen->heap)))
        return false;
    if (b.flagMode) {
        bool set = api<u32 (*)(void*, u16)>(CG_GET_SAVE_FLAG)(
            api<void* (*)(void*)>(CG_GET_FLAG_WORK)(gameData), b.flag);
        if (set != (b.flagMode == 1))
            return false;
    }
    return true;
}
void* radarEncounter(Subscreen* subscreen) {
    void* enc = ov<void* (*)(void*)>(CG_GET_FIELD_ENCOUNTERS)(subscreen->field);
    if (!enc || at<void*>(enc, 0) != subscreen->field || !at<void*>(enc, 12) || !at<void*>(enc, 16))
        return nullptr;
    if (!ov<u32 (*)(void*, u32)>(CG_PHENOMENON_ALLOWED)(enc, 2))
        return nullptr;
    if (ov<u32 (*)(void*)>(CG_GET_ENCOUNTER_STATE)(subscreen->field) != 0)
        return nullptr;
    if (!api<u32 (*)(void*, u32)>(CG_HAS_BADGE)(
            api<void* (*)(void*)>(CG_GET_TRAINER_DATA)(game(subscreen)), 0))
        return nullptr;
    void* state = api<void* (*)(void*)>(CG_GET_PHENOMENON_STATE)(game(subscreen));
    // Never replace an existing phenomenon or its native task.
    if (!state || (at<u8>(state, 0x25) & 15))
        return nullptr;
    return enc;
}
void pokeradar(Subscreen* subscreen) {
    void* enc = radarEncounter(subscreen);
    if (!enc)
        return;
    void* state = api<void* (*)(void*)>(CG_GET_PHENOMENON_STATE)(game(subscreen));
    radarWork = at<void*>(enc, 16);
    // Retail searches a random half of the nearby block and can reject an
    // occupied candidate. Retry a bounded number of times in this press.
    // The native routine retains badge, grid, zone and terrain restrictions.
    for (u32 tries = 0; tries < 32 && !(at<u8>(state, 0x25) & 15); tries++)
        ov<void (*)(void*)>(CG_GENERATE_PHENOMENON)(enc);
    radarWork = nullptr;
}
// Availability: a visible action may be temporarily blocked by native rules.
// It then uses the dim pose and still consumes its touch.
bool canUse(u32 i, Subscreen* subscreen) {
    const auto& b = session.buttons[i];
    if (!show(i, subscreen))
        return false;
    if (b.check != 255 && ov<u32 (*)(u32, void*, void*)>(CG_CHECK_KEY_ITEM_USE)(
                              b.check, system(subscreen), subscreen->field) != 0)
        return false;
    if (((b.action >= CG_ACTION_GRACIDEA && b.action <= CG_ACTION_REVEAL_GLASS) ||
         b.action == CG_ACTION_PARTY) &&
        !count(game(subscreen)))
        return false;
    if (b.action == CG_ACTION_POKERADAR && !radarEncounter(subscreen))
        return false;
    if (b.action == CG_ACTION_POKENAV && !pokenavEnabled)
        return false;
    return true;
}
bool isFlyMapAction(u32 action) {
    return action == CG_ACTION_MAP_OR_FLY || action == CG_ACTION_HM_FLY;
}
int flyMember(void* field, void* gameData, bool requireMove = true) {
    FlyCheck check;
    ov<void (*)(void*, FlyCheck*)>(CG_BUILD_FIELD_MOVE_CHECK)(field, &check);
    if (ov<u32 (*)(FlyCheck*)>(CG_CHECK_FLY_USE)(&check))
        return -1;
    void* p = party(gameData);
    u32 n = count(gameData);
    for (u32 i = 0; i < n; i++) {
        void* mon = api<void* (*)(void*, u32)>(CG_PARTY_MEMBER)(p, i);
        auto get = api<u32 (*)(void*, u32)>(CG_GET_POKEMON_PARAMETER);
        if (get(mon, 0x4c))
            continue;
        // Native travel still uses a real party member for its animation.
        // HM Fly may use the first non-Egg, without inspecting or changing moves.
        if (!requireMove)
            return static_cast<int>(i);
        for (u32 m = 0x36; m < 0x3a; m++)
            if (get(mon, m) == 19)
                return static_cast<int>(i);
    }
    return -1;
}
