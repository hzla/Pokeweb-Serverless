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
int saveEvent(void* event, u32*) {
    auto* requestWork = api<SaveWork* (*)(void*)>(CG_EVENT_WORK)(event);
    if (!requestWork->finished) {
        u32 before = requestWork->reportSequence;
        int result =
            ov<int (*)(void*, u32*)>(CG_RUN_NATIVE_SAVE)(requestWork, &requestWork->reportSequence);
        // Retail cancel requests the main menu. Replace the pending request
        // in the same event tick, before either screen begins uploading.
        if (before == 17)
            ov<void (*)(Subscreen*, u32)>(CG_REQUEST_SUBSCREEN_MODE)(requestWork->sub,
                                                                     requestWork->returnMode);
        if (result != 2)
            requestWork->finished = 1;
    }
    return requestWork->finished &&
           ov<u32 (*)(Subscreen*)>(CG_SUBSCREEN_TRANSITION_DONE)(requestWork->sub);
}
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
int navEvent(void* event, u32* sequence) {
    auto* requestWork = api<NavWork* (*)(void*)>(CG_EVENT_WORK)(event);
    if (!*sequence) {
        void* sys = api<void* (*)(void*)>(CG_EVENT_SYSTEM)(event);
        void* field = api<void* (*)(void*)>(CG_SYSTEM_FIELD)(sys);
        if (!field)
            return 1;
        requestWork->map.system = sys;
        requestWork->map.field = field;
        requestWork->map.call = 0;
        requestWork->map.data = &requestWork->request;
        void* child = ov<void* (*)(MapRequest*, u32)>(CG_CREATE_MENU_APPLICATION)(
            &requestWork->map, ov<u32 (*)(void*)>(CG_FIELD_HEAP)(field));
        if (!child)
            return 1;
        api<void (*)(void*, void*)>(CG_EVENT_CALL_CHILD)(event, child);
        *sequence = 1;
        return 0;
    }
    return 1;
}
bool navConfigured(u16 heap) {
    pokenavEnabled = false;
    bool present = false;
    for (u32 i = 0; i < session.count; ++i)
        if (session.buttons[i].action == CG_ACTION_POKENAV)
            present = true;
    if (!present)
        return false;
    void* archiveHandle = archive(heap, "rom:/pokenav/ui.narc");
    if (!archiveHandle)
        return false;
    void* b = read(archiveHandle, 0, heap, 16);
    bool ok = b && at<u32>(b, 0) == pokenav::Magic && at<u16>(b, 4) == 1 && at<u16>(b, 6) == 16 &&
              at<u32>(b, 8) == 1 && at<u32>(b, 12) == 0xfffffffe;
    if (b) {
        api<void (*)(void*)>(CG_HEAP_FREE)(b);
    }
    closeArchive(archiveHandle);
    return ok;
}
void* navLaunch(Subscreen* subscreen) {
    void* event = api<void* (*)(void*, void*, void*, u32)>(CG_EVENT_CREATE)(
        system(subscreen), nullptr, reinterpret_cast<void*>(navEvent), sizeof(NavWork));
    if (!event)
        return nullptr;
    auto* requestWork = api<NavWork* (*)(void*)>(CG_EVENT_WORK)(event);
    clear(requestWork, sizeof(*requestWork));
    auto* r = &requestWork->request;
    r->magic = pokenav::Magic;
    r->version = pokenav::Abi;
    r->size = sizeof(*r);
    r->zone = ov<u32 (*)(void*)>(CG_FIELD_ZONE)(subscreen->field);
    void* enc = ov<void* (*)(void*)>(CG_GET_FIELD_ENCOUNTERS)(subscreen->field);
    const u8* data =
        enc && at<void*>(enc, 0) == subscreen->field ? at<const u8*>(enc, 12) : nullptr;
    if (data && (data[7] & 128)) {
        r->valid = 1;
        for (u32 i = 0; i < 232; ++i)
            r->tables[i] = data[i];
    }
    u8 excluded[nuzlocke::MaskBytes];
    if (r->valid && nuzlocke::snapshot(game(subscreen), excluded)) {
        r->reserved = 1 | (nuzlocke::preventAll() ? 2 : 0);
        u32 physical = 0;
        for (u32 method = 0; method < 7; ++method)
            for (u32 slot = 0; slot < (method < 3 ? 12u : 5u); ++slot, ++physical) {
                const u32 at = (method < 3 ? 8 + method * 48 : 152 + (method - 3) * 20) + slot * 4;
                if (nuzlocke::bit(excluded, nuzlocke::half(r->tables + at) & 2047))
                    r->dupes[physical >> 3] |= u8(1u << (physical & 7));
            }
    }
    void* headers = archive(subscreen->heap, "rom:/a/0/1/2");
    if (headers) {
        const u32 size = api<u32 (*)(void*, u32)>(CG_ARCHIVE_MEMBER_SIZE)(headers, 0);
        u8 row[48];
        const u32 at = u32(r->zone) * 48;
        if (at <= size && 48 <= size - at) {
            api<void (*)(void*, u32, u32, u32, void*)>(CG_ARCHIVE_READ_RANGE)(headers, 0, at, 48,
                                                                              row);
            r->placeName = row[26] | ((row[27] & 3) << 8);
        }
        closeArchive(headers);
    }
    api<void (*)(u32)>(CG_PLAY_SOUND)(CG_SOUND_MENU);
    return event;
}

void* storageEvent(void* sys, u16 heap) {
    void* event = ov<void* (*)(void*, u32, void*, u32)>(CG_CREATE_SCRIPT_EVENT)(
        sys, CG_STORAGE_SCRIPT_ID, nullptr, heap);
    if (!event)
        return nullptr;
    // The native constructor has already created an independently allocated
    // script and VM. Change only this invocation's entry code; its native
    // event retains ownership and frees the script, VM and windows normally.
    void* work = api<void* (*)(void*)>(CG_EVENT_WORK)(event);
    void* scripts = at<void*>(work, 4);
    void* vm = at<void*>(scripts, 4);
    auto* code = at<u8*>(vm, 56);
    if (code && at<u8*>(vm, 32) == code + 30 &&
        fingerprint(code, PC_SCRIPT_SIZE) == PC_SCRIPT_HASH) {
        // Field start, initialize logout state, call the unchanged storage
        // choice loop, quick PC shutdown, then ordinary field-event cleanup.
        static constexpr u16 entry[] = {0x2e,  0x28, 0x8020, 0,      0x28, 0x8021, 1,   0x04,
                                        0x2bc, 0,    0x132,  0x8021, 0x30, 0x2f,   0x02};
        for (u32 i = 0; i < sizeof(entry) / 2; i++)
            at<u16>(code, 30 + i * 2) = entry[i];
        api<void (*)(u32)>(CG_PLAY_SOUND)(CG_SOUND_PC);
    }
    return event;
}
int flyEvent(void* event, u32* sequence) {
    auto* requestWork = api<FlyWork* (*)(void*)>(CG_EVENT_WORK)(event);
    void* sys = api<void* (*)(void*)>(CG_EVENT_SYSTEM)(event);
    void* field = api<void* (*)(void*)>(CG_SYSTEM_FIELD)(sys);
    void* gameData = api<void* (*)(void*)>(CG_SYSTEM_GAME_DATA)(sys);
    if (*sequence == 0) {
        if (!field)
            return 1;
        u32 action = requestWork->action, itemId = requestWork->item;
        bool hmFly = action == CG_ACTION_HM_FLY;
        bool hmOwned =
            !hmFly || item(gameData, CG_FLY_HM_ITEM_ID, ov<u32 (*)(void*)>(CG_FIELD_HEAP)(field));
        int member = isFlyMapAction(action) && hmOwned ? flyMember(field, gameData, !hmFly) : -1;
        clear(requestWork, sizeof(*requestWork));
        requestWork->member = member;
        requestWork->action = action;
        requestWork->item = itemId;
        bool formItem = action >= CG_ACTION_GRACIDEA && action <= CG_ACTION_REVEAL_GLASS;
        requestWork->map.system = sys;
        requestWork->map.field = field;
        requestWork->map.call = action == CG_ACTION_RECORDER              ? 12
                                : action == CG_ACTION_PAL_PAD             ? 9
                                : action == CG_ACTION_XTRANSCEIVER        ? 13
                                : action == CG_ACTION_MEDAL_BOX           ? 14
                                : action == CG_ACTION_BAG                 ? 2
                                : (formItem || action == CG_ACTION_PARTY) ? 0
                                                                          : 8;
        requestWork->map.user = requestWork;
        requestWork->map.data = reinterpret_cast<void*>(formItem ? itemId : 0xffffffff);
        ownedMap = &requestWork->map;
        void* child = ov<void* (*)(MapRequest*, u32)>(CG_CREATE_MENU_APPLICATION)(
            &requestWork->map, ov<u32 (*)(void*)>(CG_FIELD_HEAP)(field));
        if (!child) {
            ownedMap = nullptr;
            return 1;
        }
        // The child's initial application is already Town Map. PARTY origin
        // selects the native Fly map and native Fly return result, bypassing
        // an unnecessary party menu. Request storage belongs to this event.
        if (member >= 0) {
            requestWork->map.call = 0;
            at<u8>(api<void* (*)(void*)>(CG_EVENT_WORK)(child), 0x68) = member;
        }
        api<void (*)(void*, void*)>(CG_EVENT_CALL_CHILD)(event, child);
        *sequence = 1;
        return 0;
    }
    ownedMap = nullptr;
    if (*sequence == 1 &&
        (isFlyMapAction(requestWork->action) || requestWork->action == CG_ACTION_BAG ||
         requestWork->action == CG_ACTION_PARTY) &&
        requestWork->map.result == 2 && field) {
        FlyCheck check;
        ov<void (*)(void*, FlyCheck*)>(CG_BUILD_FIELD_MOVE_CHECK)(field, &check);
        bool flyMap = isFlyMapAction(requestWork->action);
        u32 skill = flyMap ? 4 : requestWork->map.selection;
        if (flyMap &&
            (requestWork->member == INVALID || ov<u32 (*)(FlyCheck*)>(CG_CHECK_FLY_USE)(&check)))
            return 1;
        // Recheck the HM after the native map returns; never consume or grant it.
        if (requestWork->action == CG_ACTION_HM_FLY &&
            !item(gameData, CG_FLY_HM_ITEM_ID, ov<u32 (*)(void*)>(CG_FIELD_HEAP)(field)))
            return 1;
        UseHeader header = {
            static_cast<u16>(flyMap ? requestWork->member : requestWork->map.pokemon),
            static_cast<u16>(skill), requestWork->map.zone};
        void* child = ov<void* (*)(u32, UseHeader*, FlyCheck*)>(CG_CREATE_FIELD_MOVE_EVENT)(
            skill, &header, &check);
        if (child) {
            api<void (*)(void*, void*)>(CG_EVENT_CALL_CHILD)(event, child);
            *sequence = 2;
            return 0;
        }
    }
    if (*sequence == 1 &&
        (requestWork->action == CG_ACTION_BAG || requestWork->action == CG_ACTION_PARTY) &&
        requestWork->map.result == 3 && field) {
        void* child = ov<void* (*)(u32, void*, void*)>(CG_CREATE_KEY_ITEM_EVENT)(
            requestWork->map.selection, sys, field);
        if (child) {
            api<void (*)(void*, void*)>(CG_EVENT_CALL_CHILD)(event, child);
            *sequence = 2;
            return 0;
        }
    }
    return 1;
}
