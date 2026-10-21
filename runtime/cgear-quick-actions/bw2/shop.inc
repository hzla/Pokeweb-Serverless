// One owned shop session. Native VM/window lifetimes stay native. Stock and
// payment adapters act only while this parent owns the matching shop request.
constexpr u32 ShopRecordSize = 424, BagBytes = 0x9ec;
struct ShopWork {
    u16 heap, count;
    u8 *config, *script, *menu, *messages;
    void *menuText, *process, *native, *stock, *counts;
    u32 selection, priceIndex, pendingCost, pendingItem, pendingQuantity, failed;
    void* icon;
    u8* iconArt;
    u32 iconChar, iconPalette;
    u8 bagBackup[BagBytes];
};
ShopWork* activeShop;

bool shopCapacity(u16 heap) {
    const u32 heaps[] = {4, 21, u32(heap)};
    for (u32 h : heaps) {
        const u32 freeRequired = h == 4 ? 0x8000 : 0x24000;
        const u32 largestRequired = h == 4 ? 0x4000 : 0x10000;
        if (api<u32 (*)(u32)>(CG_HEAP_FREE_BYTES)(h) < freeRequired ||
            api<u32 (*)(u32)>(CG_HEAP_LARGEST_BLOCK)(h) < largestRequired)
            return false;
    }
    return true;
}
u8* shopRecord() {
    return activeShop && activeShop->selection && activeShop->selection <= activeShop->count
               ? activeShop->config + 32 + (activeShop->selection - 1) * ShopRecordSize
               : nullptr;
}
bool customShop(void* request) {
    return shopRecord() && activeShop->native == request;
}
void shopDispose(ShopWork* work) {
    if (work->menuText)
        api<void (*)(void*)>(CG_TEXT_DELETE)(work->menuText);
    void* buffers[] = {work->config,   work->script, work->menu,
                       work->messages, work->stock,  work->counts};
    for (void* p : buffers)
        if (p)
            api<void (*)(void*)>(CG_HEAP_FREE)(p);
    if (activeShop == work)
        activeShop = nullptr;
}
u8* shopRead(void* arc, u32 member, u16 heap, u32 limit, u32* size = nullptr) {
    u32 n = api<u32 (*)(void*, u32)>(CG_ARCHIVE_MEMBER_SIZE)(arc, member);
    if (!n || n > limit)
        return nullptr;
    if (size)
        *size = n;
    return static_cast<u8*>(read(arc, member, heap, n));
}
bool shopLoad(ShopWork* work) {
    void* arc = archive(work->heap, "rom:/system-shops/shops.narc");
    if (!arc)
        return false;
    u32 size = 0;
    work->config = shopRead(arc, 0, work->heap, 32 + 16 * ShopRecordSize, &size);
    bool ok = work->config && size >= 32;
    if (ok) {
        auto* h = work->config;
        work->count = at<u16>(h, 8);
        ok = at<u32>(h, 0) == 0x50485353 && at<u16>(h, 4) == 1 && at<u16>(h, 6) == ShopRecordSize &&
             work->count <= 16 && size == 32 + work->count * ShopRecordSize &&
             at<u32>(h, 16) == size && fingerprint(h + 32, size - 32) == at<u32>(h, 12);
    }
    if (ok) {
        work->script = shopRead(arc, 2, work->heap, 1024, &size);
        ok = work->script && size == SHOP_PICKER_SIZES[work->count] &&
             fingerprint(work->script, size) == SHOP_PICKER_HASHES[work->count];
    }
    if (ok) {
        work->menu = shopRead(arc, 3, work->heap, 8192, &size);
        ok = work->menu && fingerprint(work->menu, size) == at<u32>(work->config, 24);
    }
    closeArchive(arc);
    if (!ok)
        return false;
    // Native buffer-backed text borrows these bytes. Menu cleanup owns the
    // text object; the parent retains its source bank through child completion.
    work->menuText = api<void* (*)(void*, u32)>(CG_TEXT_FROM_BUFFER)(work->menu, 4);
    return work->menuText != nullptr;
}
int shopEvent(void* event, u32* sequence) {
    auto* work = api<ShopWork* (*)(void*)>(CG_EVENT_WORK)(event);
    if (*sequence) {
        shopDispose(work);
        return 1;
    }
    void* sys = api<void* (*)(void*)>(CG_EVENT_SYSTEM)(event);
    if (!api<void* (*)(void*)>(CG_SYSTEM_FIELD)(sys) || !shopCapacity(work->heap) ||
        !shopLoad(work)) {
        shopDispose(work);
        return 1;
    }
    void* child = ov<void* (*)(void*, u32, void*, u32)>(CG_CREATE_SCRIPT_EVENT)(
        sys, CG_SHOP_SCRIPT_ID, nullptr, work->heap);
    if (!child) {
        shopDispose(work);
        return 1;
    }
    void* childWork = api<void* (*)(void*)>(CG_EVENT_WORK)(child);
    work->process = at<void*>(childWork, 0);
    void* scripts = at<void*>(childWork, 4);
    void* vm = at<void*>(scripts, 4);
    auto* code = at<u8*>(vm, 56);
    auto* entry = at<u8*>(vm, 32);
    if (code && entry == code + SHOP_SCRIPT_ENTRY &&
        fingerprint(code, SHOP_SCRIPT_SIZE) == SHOP_SCRIPT_HASH) {
        api<void (*)(void*)>(CG_HEAP_FREE)(code);
        at<void*>(vm, 56) = work->script;
        at<void*>(vm, 32) = work->script + at<u32>(work->script, 0) + 4;
        work->script = nullptr; // Ownership passes to native VM destruction.
        activeShop = work;
        api<void (*)(u32)>(CG_PLAY_SOUND)(CG_SOUND_MENU);
    } else
        at<u16>(entry, 0) = 0x02; // Native cleanup of an unexpected copy.
    api<void (*)(void*, void*)>(CG_EVENT_CALL_CHILD)(event, child);
    *sequence = 1;
    return 0;
}
void* shopLaunch(Subscreen* subscreen) {
    if (activeShop || !shopCapacity(subscreen->heap))
        return nullptr;
    // Checked allocation of the verified native 20-byte scheduler record.
    // The native constructor dereferences allocation results without checks.
    void* event = api<void* (*)(u32, u32, u32)>(CG_HEAP_ALLOCATE)(4, 20, 1);
    if (!event)
        return nullptr;
    auto* work = api<ShopWork* (*)(u32, u32, u32)>(CG_HEAP_ALLOCATE)(4, sizeof(ShopWork), 1);
    if (!work) {
        api<void (*)(void*)>(CG_HEAP_FREE)(event);
        return nullptr;
    }
    clear(event, 20);
    clear(work, sizeof(*work));
    work->iconChar = work->iconPalette = INVALID;
    work->heap = subscreen->heap;
    at<void*>(event, 4) = reinterpret_cast<void*>(shopEvent);
    at<void*>(event, 12) = work;
    at<void*>(event, 16) = system(subscreen);
    return event;
}
bool ownedShopScript(void* runtime) {
    return activeShop && ov<void* (*)(void*)>(CG_SCRIPT_PROCESS)(runtime) == activeShop->process;
}
int shopChoiceAdd(void* vm, void* runtime) {
    if (ownedShopScript(runtime) && activeShop->menuText) {
        void* menu = static_cast<u8*>(at<void*>(runtime, 32)) + 0x34;
        if (at<u32>(menu, 16))
            api<void (*)(void*)>(CG_TEXT_DELETE)(at<void*>(menu, 20));
        at<void*>(menu, 20) = activeShop->menuText;
        at<u32>(menu, 16) = 1; // Menu cleanup now owns this text object.
        activeShop->menuText = nullptr;
    }
    return ov<int (*)(void*, void*)>(CG_NATIVE_CHOICE_ADD)(vm, runtime);
}
int shopBuyCommand(void* vm, void* runtime) {
    if (!ownedShopScript(runtime))
        return ov<int (*)(void*, void*)>(CG_NATIVE_SHOP_COMMAND)(vm, runtime);
    auto* work = activeShop;
    // Only a completed native shop can re-enable the picker loop. A rejected
    // launch or failed return-menu allocation instead unwinds this session.
    *ov<u16* (*)(void*, u32)>(CG_SCRIPT_WORK)(work->process, 0x802c) = 0;
    work->selection = *ov<u16* (*)(void*, u32)>(CG_SCRIPT_WORK)(work->process, 0x802a);
    if (work->selection > work->count)
        return 0;
    if (u8* record = shopRecord()) {
        u32 count = at<u16>(record, 4);
        if (!count || count > 45 || !shopCapacity(work->heap))
            return 0;
        void* arc = archive(work->heap, "rom:/system-shops/shops.narc");
        u32 size = 0;
        if (arc)
            work->messages = shopRead(arc, 3 + work->selection, work->heap, 16384, &size);
        closeArchive(arc);
        if (!work->messages || fingerprint(work->messages, size) != at<u32>(record, 56))
            return 0;
        work->stock = api<void* (*)(u32, u32, u32)>(CG_HEAP_ALLOCATE)(work->heap, count * 2, 1);
        work->counts = api<void* (*)(u32, u32, u32)>(CG_HEAP_ALLOCATE)(work->heap, 6, 1);
        if (!work->stock || !work->counts)
            return 0;
        for (u32 i = 0; i < count; ++i)
            at<u16>(work->stock, i * 2) = at<u16>(record, 64 + i * 8);
        for (u32 i = 0; i < 6; ++i)
            at<u8>(work->counts, i) = count;
    }
    int result = ov<int (*)(void*, void*)>(CG_NATIVE_SHOP_COMMAND)(vm, runtime);
    work->native = static_cast<u8*>(at<void*>(work->process, 0x3c)) + 8;
    return result;
}
void* shopStockFile(u32 archiveId, u32 member, u32 heap) {
    if (shopRecord() && activeShop->native) {
        void*& p = archiveId == 0x11b ? activeShop->counts : activeShop->stock;
        if (p) {
            void* result = p;
            p = nullptr;
            return result;
        }
    }
    return api<void* (*)(u32, u32, u32)>(CG_LOAD_NARC_MEMBER)(archiveId, member, heap);
}
u32 shopPrice(void* itemData) {
    u8* record = shopRecord();
    if (record && activeShop->native && activeShop->priceIndex < at<u16>(record, 4))
        return at<u32>(record, 68 + activeShop->priceIndex++ * 8);
    return api<u32 (*)(void*)>(CG_ITEM_PRICE)(itemData);
}
void* shopMessageBank(u32 mode, u32 archiveId, u32 member, u32 heap) {
    if (shopRecord() && activeShop->native && activeShop->messages)
        return api<void* (*)(void*, u32)>(CG_TEXT_FROM_BUFFER)(activeShop->messages, heap);
    return api<void* (*)(u32, u32, u32, u32)>(CG_TEXT_LOAD)(mode, archiveId, member, heap);
}
u32 shopBalance(void* request) {
    if (!customShop(request))
        return ov<u32 (*)(void*)>(CG_NATIVE_SHOP_BALANCE)(request);
    u32 currency = at<u16>(shopRecord(), 2);
    u32 balance = currency ? api<u32 (*)(void*, u32, u32)>(CG_BAG_QUANTITY)(
                                 at<void*>(request, 16), currency, at<u16>(request, 4))
                           : api<u32 (*)(void*)>(CG_TRAINER_MONEY)(at<void*>(request, 12));
    return balance >= activeShop->pendingCost ? balance - activeShop->pendingCost : 0;
}
u32 shopMoney(void* trainer) {
    if (shopRecord() && activeShop->native && at<void*>(activeShop->native, 12) == trainer)
        return shopBalance(activeShop->native);
    return api<u32 (*)(void*)>(CG_TRAINER_MONEY)(trainer);
}
void shopPay(void* request, u32 cost) {
    if (!customShop(request)) {
        ov<void (*)(void*, u32)>(CG_NATIVE_SHOP_PAY)(request, cost);
        return;
    }
    activeShop->pendingCost = cost;
    activeShop->pendingItem = at<u16>(request, 0x224);
    activeShop->pendingQuantity = at<u16>(request, 0x230);
}
u32 shopAdd(void* bag, u32 itemId, u32 quantity, u32 heap) {
    if (!shopRecord() || !activeShop->native || at<void*>(activeShop->native, 16) != bag)
        return api<u32 (*)(void*, u32, u32, u32)>(CG_BAG_ADD)(bag, itemId, quantity, heap);
    auto* work = activeShop;
    u32 cost = work->pendingCost;
    work->pendingCost = 0;
    u32 currency = at<u16>(shopRecord(), 2);
    bool ready = itemId == work->pendingItem && quantity == work->pendingQuantity && cost &&
                 shopBalance(work->native) >= cost;
    if (!ready) {
        work->failed = 3;
        return 0;
    }
    if (!api<u32 (*)(void*, u32, u32, u32)>(CG_BAG_CAN_ADD)(bag, itemId, quantity, heap)) {
        work->failed = 10;
        return 0;
    }
    for (u32 i = 0; i < BagBytes; ++i)
        work->bagBackup[i] = at<u8>(bag, i);
    bool paid = !currency || api<u32 (*)(void*, u32, u32)>(CG_BAG_REMOVE)(bag, currency, cost);
    bool added =
        paid && api<u32 (*)(void*, u32, u32, u32)>(CG_BAG_ADD)(bag, itemId, quantity, heap);
    if (!added) {
        for (u32 i = 0; i < BagBytes; ++i)
            at<u8>(bag, i) = work->bagBackup[i];
        work->failed = paid ? 10 : 3;
        return 0;
    }
    if (!currency)
        ov<void (*)(void*, u32)>(CG_NATIVE_SHOP_PAY)(work->native, cost);
    else
        api<void (*)(void*, u32)>(CG_RECORD_INCREMENT)(at<void*>(work->native, 20), 0x15);
    ov<void (*)(void*)>(CG_SHOP_REFRESH_BALANCE)(work->native);
    return 1;
}
int shopTick(void* sys, void* request, u32 shopId, u32 mode) {
    int result =
        ov<int (*)(void*, void*, u32, u32)>(CG_NATIVE_SHOP_TICK)(sys, request, shopId, mode);
    if (!result && customShop(request) && activeShop->failed) {
        ov<void (*)(void*, u32, u32, u32)>(CG_SHOP_MESSAGE)(request, activeShop->failed,
                                                            activeShop->pendingItem, 0);
        activeShop->failed = 0;
        at<u8>(request, 0) = 12;
        at<u8>(request, 1) = 4;
        ov<void (*)(void*)>(CG_SHOP_REFRESH_BALANCE)(request);
    }
    if (result && activeShop && activeShop->native == request) {
        auto* work = activeShop;
        work->native = nullptr;
        // Native teardown has released its text objects and any adopted stock.
        // Keep the parent/menu bank; release only this shop's borrowed sources.
        void* buffers[] = {work->messages, work->stock, work->counts};
        for (void* p : buffers)
            if (p)
                api<void (*)(void*)>(CG_HEAP_FREE)(p);
        work->messages = nullptr;
        work->stock = work->counts = nullptr;
        work->selection = work->priceIndex = work->pendingCost = 0;
        work->pendingItem = work->pendingQuantity = work->failed = 0;
        work->menuText = api<void* (*)(void*, u32)>(CG_TEXT_FROM_BUFFER)(work->menu, 4);
        *ov<u16* (*)(void*, u32)>(CG_SCRIPT_WORK)(work->process, 0x802c) =
            work->menuText ? 1 : 0;
    }
    return result;
}

// Retail shops choose a single TM renderer from their first item. Custom
// inventories can mix TMs and ordinary items, so select the native route per row.
u32 shopIsTm(u32 item) {
    return api<u32 (*)(u32)>(CG_ITEM_IS_TM)(item) ? 1 : 0;
}
void shopLabel(void* request, u32 row, u32 mode, u32 item, void* names) {
    if (customShop(request))
        mode = shopIsTm(item);
    ov<void (*)(void*, u32, u32, u32, void*)>(CG_SHOP_LABEL)(request, row, mode, item, names);
}
void shopSelect(void* request) {
    if (customShop(request))
        at<u8>(request, 0x18a) = shopIsTm(at<u16>(request, 0x224));
    ov<void (*)(void*)>(CG_SHOP_SELECT)(request);
}
void shopRowPrice(void* list, u32 row, u32 y, bool nativeTm) {
    void* request = api<void* (*)(void*)>(CG_LIST_USER_DATA)(list);
    bool tm = nativeTm;
    if (customShop(request) && row < at<u16>(request, 0x188))
        tm = shopIsTm(at<u16>(request, 0x20 + row * 8));
    ov<void (*)(void*, u32, u32)>(tm ? CG_SHOP_TM_ROW_PRICE : CG_SHOP_ROW_PRICE)(list, row, y);
}

void* shopUnit(u32 count, u32 engine, u32 heap) {
    return api<void* (*)(u32, u32, u32)>(CG_SHOP_UNIT)(
        shopRecord() && activeShop->native && at<u16>(shopRecord(), 2) ? count + 1 : count, engine,
        heap);
}
void shopIconDispose() {
    if (!activeShop)
        return;
    auto* work = activeShop;
    if (work->icon)
        api<void (*)(void*)>(CG_ACTOR_DELETE)(work->icon);
    if (work->iconChar != INVALID)
        api<void (*)(u32)>(CG_CHARACTER_DELETE)(work->iconChar);
    if (work->iconPalette != INVALID)
        api<void (*)(u32)>(CG_PALETTE_DELETE)(work->iconPalette);
    if (work->iconArt)
        api<void (*)(void*)>(CG_HEAP_FREE)(work->iconArt);
    work->iconArt = nullptr;
    work->icon = nullptr;
    work->iconChar = work->iconPalette = INVALID;
}
void shopGraphics(void* request) {
    ov<void (*)(void*)>(CG_SHOP_GRAPHICS)(request);
    if (!customShop(request) || !at<u16>(shopRecord(), 2))
        return;
    auto* work = activeShop;
    void* arc = archive(work->heap, "rom:/system-shops/shops.narc");
    u32 member = 4 + work->count + (work->selection - 1) * 2;
    work->iconArt = arc ? static_cast<u8*>(read(arc, member, work->heap, 512)) : nullptr;
    u8* palette = arc ? static_cast<u8*>(read(arc, member + 1, work->heap, 72)) : nullptr;
    u32 hash = 0x811c9dc5;
    if (work->iconArt && palette) {
        for (u32 i = 0; i < 512; ++i)
            hash = (hash ^ work->iconArt[i]) * 0x1000193;
        for (u32 i = 0; i < 72; ++i)
            hash = (hash ^ palette[i]) * 0x1000193;
    }
    if (work->iconArt && palette && hash == at<u32>(shopRecord(), 60)) {
        work->iconChar = api<u32 (*)(u32, u32, u32)>(CG_CHARACTER_CREATE)(512, 0, work->heap);
        // Main OBJ banks 0 and 1 belong to the shop UI and selected item.
        // The fourth argument is a destination byte offset; bank 2 starts at 64.
        work->iconPalette = api<u32 (*)(void*, u32, u32, u32, u32, u32, u32)>(
            CG_SHOP_PALETTE_CREATE)(arc, member + 1, 0, 64, 0, 1, work->heap);
        if (work->iconChar != INVALID && work->iconPalette != INVALID) {
            struct Character {
                u16 h, w;
                u32 format, mapping, character, size;
                void* data;
            } character = {0xffff, 0xffff, 3, 16, 0, 512, work->iconArt};
            api<void (*)(u32, const void*)>(CG_CHARACTER_UPLOAD)(work->iconChar, &character);
            void* window = at<void*>(request, 0x190);
            struct ActorData {
                s16 x, y;
                u16 sequence;
                u8 priority, bg;
            } data = {s16(at<u8>(window, 3) * 8 + 10), s16(at<u8>(window, 4) * 8 + 8), 0, 0, 0};
            work->icon = api<void* (*)(void*, u32, u32, u32, const void*, u32, u32)>(
                CG_ACTOR_CREATE)(at<void*>(request, 0x1e4), work->iconChar, work->iconPalette,
                                 at<u32>(request, 0x21c), &data, 0, work->heap);
            if (work->icon)
                api<void (*)(void*, u32)>(CG_ACTOR_FREEZE_ANIMATION)(work->icon, 1);
        }
    }
    if (palette)
        api<void (*)(void*)>(CG_HEAP_FREE)(palette);
    closeArchive(arc);
    if (!work->icon)
        shopIconDispose();
}
void shopGraphicsEnd(void* request) {
    if (customShop(request))
        shopIconDispose();
    ov<void (*)(void*)>(CG_SHOP_GRAPHICS_END)(request);
}
void shopBalanceText(void* pixels, u32 x, u32 y, void* text, u32 font, u32 color) {
    if (shopRecord() && activeShop->native && at<u16>(shopRecord(), 2)) {
        u32 width = at<u16>(pixels, 4),
            textWidth = api<u32 (*)(void*, u32, u32)>(CG_TEXT_WIDTH)(text, font, 0);
        x = width > textWidth + 2 ? width - textWidth - 2 : 0;
    }
    api<void (*)(void*, u32, u32, void*, u32, u32)>(CG_DRAW_TEXT)(pixels, x, y, text, font, color);
}
