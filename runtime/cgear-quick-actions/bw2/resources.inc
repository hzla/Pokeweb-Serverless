// Resource teardown/allocation, retained VBlank uploads and draw/input guards.
// Included once by quick_actions.cpp inside its private namespace.

void dispose() {
    if (!session.sub && !session.unit)
        return;
    if (session.networkMoved)
        api<void (*)(u32, u32)>(CG_NETWORK_ICON_POSITION)(200, 10);
    session.networkMoved = 0;
    session.skinFeedback = 0;
    session.visible = 0;
    session.pending = 0;
    session.drag = 0xff;
    session.dialCaptured = session.skinSound = session.preparedSound = session.appliedSound =
        session.markerUploaded = 0;
    if (session.task)
        api<void (*)(void*)>(CG_TASK_DELETE)(session.task);
    session.task = nullptr;
    if (session.marker)
        api<void (*)(void*)>(CG_ACTOR_DELETE)(session.marker);
    session.marker = nullptr;
    if (session.markerChars != INVALID)
        api<void (*)(u32)>(CG_CHARACTER_DELETE)(session.markerChars);
    session.markerChars = INVALID;
    // Stop uploads, remove owned actors from the native unit, then free banks.
    for (u32 i = 0; i < session.count; i++)
        if (session.actors[i])
            api<void (*)(void*)>(CG_ACTOR_DELETE)(session.actors[i]);
    session.unit = nullptr;
    for (u32 i = 0; i < session.count; i++) {
        session.actors[i] = nullptr;
        if (session.chars[i] != INVALID)
            api<void (*)(u32)>(CG_CHARACTER_DELETE)(session.chars[i]);
        session.chars[i] = INVALID;
        if (session.graphics[i])
            api<void (*)(void*)>(CG_HEAP_FREE)(session.graphics[i]);
        session.graphics[i] = nullptr;
    }
    if (session.animation != INVALID)
        api<void (*)(u32)>(CG_ANIMATION_DELETE)(session.animation);
    if (session.palette != INVALID)
        api<void (*)(u32)>(CG_PALETTE_DELETE)(session.palette);
    session.animation = session.palette = INVALID;
    session.sub = nullptr;
    if (session.patterns)
        api<void (*)(void*)>(CG_HEAP_FREE)(session.patterns);
    session.patterns = nullptr;
    if (session.uploadBuffer)
        api<void (*)(void*)>(CG_HEAP_FREE)(session.uploadBuffer);
    session.uploadBuffer = nullptr;
    if (session.skinOriginal)
        api<void (*)(void*)>(CG_HEAP_FREE)(session.skinOriginal);
    if (session.skinBuffer)
        api<void (*)(void*)>(CG_HEAP_FREE)(session.skinBuffer);
    session.skinOriginal = session.skinBuffer = nullptr;
    session.skinCaptured = session.skinRequest = session.skinUpload = 0;
}
void prepareSkin() {
    if (!session.skinRequest || !session.skinCaptured || session.skinUpload)
        return;
    session.skinRequest = 0;
    session.preparedSkin = session.wantedSkin;
    session.preparedSound = session.skinSound;
    session.skinSound = 0;
    if (session.dialControl && session.preparedSound &&
        session.preparedSkin == session.currentSkin) {
        session.preparedSound = 0;
        return;
    }
    if (session.skinBuffer)
        api<void (*)(void*)>(CG_HEAP_FREE)(session.skinBuffer);
    session.skinBuffer = nullptr;
    if (session.wantedSkin) {
        u32 i = 0;
        while (i < session.skinCount && session.skinIds[i] != session.wantedSkin)
            i++;
        void* archiveHandle = i < session.skinCount ? archive(session.sub->heap) : nullptr;
        void* b = archiveHandle
                      ? read(archiveHandle, session.skinMembers[i], session.sub->heap, 0x2600)
                      : nullptr;
        closeArchive(archiveHandle);
        bool good = b && fingerprint(static_cast<u8*>(b), 0x2600) == session.skinHashes[i];
        if (good) {
            for (u32 n = 0; n < 16; n++)
                if (at<u16>(b, 0x1fe0 + n * 2) & 0x8000)
                    good = false;
            for (u32 n = 0; n < 768; n++)
                if ((at<u16>(b, 0x2000 + n * 2) & 1023) >= 255 ||
                    (at<u16>(b, 0x2000 + n * 2) & 0xf000))
                    good = false;
        }
        if (!good) {
            if (b)
                api<void (*)(void*)>(CG_HEAP_FREE)(b);
            session.wantedSkin = session.dialTarget = session.currentSkin;
            session.preparedSound = 0;
            return;
        }
        session.skinBuffer = b;
    }
    session.skinUpload = 1;
}
bool freeResources() {
    void* sys = *reinterpret_cast<void**>(nativeAddress(CG_SPRITE_MANAGER_POINTER));
    if (!sys)
        return false;
    void* chars = at<void*>(sys, 0x10c);
    void* anim = at<void*>(sys, 0x114);
    u32 free = 0;
    u16 n = at<u16>(sys, 0x118);
    for (u32 i = 0; i < n; i++)
        if (at<u32>(chars, i * 64 + 60) & 0x80000000)
            free++;
    if (free < session.count + (session.dialControl && session.skinCount ? 1u : 0u))
        return false;
    void* palettes = at<void*>(sys, 0x110);
    n = at<u16>(sys, 0x11a);
    bool freePalette = false;
    for (u32 i = 0; i < n; i++)
        if (at<u32>(palettes, i * 24 + 20) & 0x80000000)
            freePalette = true;
    if (!freePalette)
        return false;
    n = at<u16>(sys, 0x11c);
    for (u32 i = 0; i < n; i++)
        if (at<u32>(anim, i * 20 + 16))
            return true;
    return false;
}
void upload(void*, void*) {
    struct Character {
        u16 height, width;
        u32 format, mapping, character, size;
        void* data;
    };
    if (session.visible && session.skinOriginal && !session.skinCaptured) {
        // Snapshot the native picture after its scheduled initialization.
        // These are checked BG1 VRAM regions, not replacements of display control.
        for (u32 i = 0; i < 0x1fe0; i += 2)
            at<u16>(session.skinOriginal, i) = *reinterpret_cast<volatile u16*>(0x06204000 + i);
        void* fade = at<void*>(session.sub->work, 0x100);
        void* base = fade ? at<void*>(fade, 20) : nullptr;
        // Preserve the native palette before an initialization fade changes
        // physical VRAM. FADE_SUB_BG is the second 20-byte native record.
        for (u32 i = 0; i < 32; i += 2)
            at<u16>(session.skinOriginal, 0x1fe0 + i) =
                base ? at<u16>(base, 416 + i) : *reinterpret_cast<volatile u16*>(0x050003a0 + i);
        for (u32 i = 0; i < 0x600; i += 2)
            at<u16>(session.skinOriginal, 0x2000 + i) =
                *reinterpret_cast<volatile u16*>(0x06207800 + i) & 0x0fff;
        session.skinCaptured = 1;
    }
    if (session.visible && session.skinUpload) {
        void* b = session.preparedSkin ? session.skinBuffer : session.skinOriginal;
        if (b) {
            api<void (*)(u32, const void*, u32, u32)>(CG_BG_UPLOAD_CHARACTERS)(5, b, 0x1fe0, 0);
            void* colors = static_cast<u8*>(b) + 0x1fe0;
            api<void (*)(void*, const void*, u32, u32, u32)>(CG_PALETTE_FADE_BUFFER_COPY)(
                at<void*>(session.sub->work, 0x100), colors, 1, 208, 32);
            api<void (*)(u32, const void*, u32, u32)>(CG_BG_UPLOAD_PALETTE)(5, colors, 32, 416);
            api<void (*)(u32, const void*, u32)>(CG_BG_UPLOAD_MAP)(5, static_cast<u8*>(b) + 0x2000,
                                                                   0x600);
            api<void (*)(u32, u32, u32, u32, u32, u32)>(CG_BG_SET_PALETTE_RECT)(5, 0, 0, 32, 24,
                                                                                13);
            api<void (*)(u32)>(CG_BG_COMMIT_MAP)(5);
            ov<void (*)(void*)>(CG_CGEAR_RESTORE_RING_COLORS)(session.sub->work);
            bool changed = session.currentSkin != session.preparedSkin;
            session.currentSkin = session.preparedSkin;
            savePositions(game(session.sub));
            if (changed && session.preparedSound)
                session.appliedSound = 1;
        }
        session.skinUpload = 0;
        session.preparedSound = 0;
    }
    // Native C-Gear initialization is asynchronous and first uploads a full
    // palette bank. Restore our unused slots after that upload, through the
    // same native scheduling system. The additional transfer is 256 bytes.
    if (session.visible && session.palette != INVALID) {
        u16 target = at<u8>(session.sub->work, 0x30a) ? 0x0423 : 0x0441;
        for (u32 i = 0; i < 128; i++) {
            u16 c = session.colours[i];
            if (session.dim)
                c = (((c & 31) + (target & 31)) >> 1) |
                    (((((c >> 5) & 31) + ((target >> 5) & 31)) >> 1) << 5) |
                    (((((c >> 10) & 31) + ((target >> 10) & 31)) >> 1) << 10);
            session.uploadColours[i] = c;
        }
        struct Palette {
            u32 format, extended, size;
            void* data;
        } p = {3, 0, 256, session.uploadColours};
        // Retail C-Gear fades retransmit OBJ banks 0–13 every VBlank. Keep
        // its retained buffers in sync for owned banks 7–13; bank 14 is
        // outside that allocation and travels through the resource upload.
        api<void (*)(void*, const void*, u32, u32, u32)>(CG_PALETTE_FADE_BUFFER_COPY)(
            at<void*>(session.sub->work, 0x100), session.uploadColours, 3, 112, 224);
        api<void (*)(u32, const void*, u32)>(CG_PALETTE_UPLOAD)(session.palette, &p, 8);
    }
    for (u32 i = 0; i < session.count; i++)
        if (session.actors[i]) {
            u8 pose = session.desired[i];
            if (pose != session.uploaded[i]) {
                auto* composed = static_cast<u8*>(session.uploadBuffer) + i * 512;
                auto* art = static_cast<u8*>(session.graphics[i]) + (pose >> 4) * 512;
                auto* pattern = static_cast<u8*>(session.patterns) + (pose & 15) * 512;
                // Compose immutable pattern and caption data only inside the
                // scheduled upload. DMA sources must live in main RAM: a stack
                // buffer can be in DTCM, which the DS DMA engine cannot read.
                for (u32 n = 0; n < 512; n++) {
                    u8 a = art[n], p = pattern[n];
                    u8 lo = a & 15, hi = a >> 4;
                    if (lo == 9)
                        lo = (p & 15) == 13 ? 13 : 9;
                    if (hi == 9)
                        hi = (p >> 4) == 13 ? 13 : 9;
                    composed[n] = lo | (hi << 4);
                }
                Character c = {0xffff, 0xffff, 3, 16, 0, 512, composed};
                api<void (*)(u32, const void*)>(CG_CHARACTER_UPLOAD)(session.chars[i], &c);
                session.uploaded[i] = pose;
            }
            visible(session.actors[i], session.visible && session.shown[i]);
        }
    if (session.marker) {
        if (!session.markerUploaded) {
            auto* pixels = static_cast<u8*>(session.uploadBuffer) + 4096;
            clear(pixels, 128);
            for (int y = 0; y < 8; y++)
                for (int x = 0; x < 8; x++) {
                    int d = absolute(x - 3) + absolute(y - 3);
                    u8 ink = d > 3 ? 0 : d == 3 ? 12 : 11;
                    pixels[y * 4 + x / 2] |= ink << ((x & 1) * 4);
                }
            Character c = {0xffff, 0xffff, 3, 16, 0, 128, pixels};
            api<void (*)(u32, const void*)>(CG_CHARACTER_UPLOAD)(session.markerChars, &c);
            session.markerUploaded = 1;
        }
        visible(session.marker, session.visible && session.dialCaptured);
    }
}
void attach(Subscreen* subscreen) {
    dispose();
    session.error = 1;
    session.magic = 0x53415143;
    session.sub = subscreen;
    session.drag = 0xff;
    session.pressed = 0xff;
    session.frame = 0;
    session.held = 0;
    session.dim = 0;
    session.animation = session.palette = session.markerChars = INVALID;
    for (u32 i = 0; i < 8; i++)
        session.chars[i] = INVALID;
    void* archiveHandle = archive(subscreen->heap);
    enabled = archiveHandle && config(archiveHandle, subscreen->heap);
    if (!enabled || !freeResources() ||
        api<u32 (*)(u32)>(CG_HEAP_FREE_BYTES)(subscreen->heap) < 65536 ||
        api<u32 (*)(u32)>(CG_HEAP_LARGEST_BLOCK)(subscreen->heap) < 16384) {
        closeArchive(archiveHandle);
        dispose();
        return;
    }
    session.error = 2;
    loadPositions(game(subscreen));
    savePositions(game(subscreen));
    void* palette = read(archiveHandle, 1, subscreen->heap, 296);
    if (!palette) {
        closeArchive(archiveHandle);
        dispose();
        return;
    }
    for (u32 i = 0; i < 128; i++)
        session.colours[i] = at<u16>(palette, 40 + i * 2);
    api<void (*)(void*)>(CG_HEAP_FREE)(palette);
    session.error = 3;
    session.patterns = read(archiveHandle, 12, subscreen->heap, 5120);
    if (!session.patterns) {
        closeArchive(archiveHandle);
        dispose();
        return;
    }
    session.error = 4;
    session.uploadBuffer = api<void* (*)(u32, u32, u32, const char*, u32)>(CG_HEAP_ALLOCATE)(
        subscreen->heap, session.dialControl ? 4224 : 4096, 1, "quick-actions", 0);
    if (!session.uploadBuffer) {
        closeArchive(archiveHandle);
        dispose();
        return;
    }
    session.error = 5;
    session.palette = api<u32 (*)(void*, u32, u32, u32, u32)>(CG_PALETTE_CREATE)(
        archiveHandle, 1, 1, 224, subscreen->heap);
    session.animation = api<u32 (*)(void*, u32, u32, u32)>(CG_ANIMATION_CREATE)(archiveHandle, 2, 3,
                                                                                subscreen->heap);
    if (session.palette == INVALID || session.animation == INVALID) {
        closeArchive(archiveHandle);
        dispose();
        return;
    }
    session.error = 6;
    session.unit = at<void*>(subscreen->work, 0x34);
    if (!session.unit) {
        closeArchive(archiveHandle);
        dispose();
        return;
    }
    // Native owns the render unit. Add up to eight buttons plus a dial marker,
    // leaving its original 84 slots available. Remove ours before native exit.
    void* actors = at<void*>(session.unit, 0);
    u32 freeActors = 0;
    for (u32 i = 0; i < at<u16>(session.unit, 12); i++)
        if (!at<u32>(actors, i * 228))
            freeActors++;
    if (freeActors < session.count + (session.dialControl && session.skinCount ? 1u : 0u)) {
        closeArchive(archiveHandle);
        dispose();
        return;
    }
    for (u32 reverse = session.count; reverse > 0; reverse--) {
        u32 i = reverse - 1;
        session.error = 8 + i;
        session.graphics[i] = read(archiveHandle, i + 4, subscreen->heap, 2048);
        session.error = 16 + i;
        session.chars[i] =
            api<u32 (*)(u32, u32, u32)>(CG_CHARACTER_CREATE)(512, 1, subscreen->heap);
        if (!session.graphics[i] || session.chars[i] == INVALID) {
            closeArchive(archiveHandle);
            dispose();
            return;
        }
        void* sys = *reinterpret_cast<void**>(nativeAddress(CG_SPRITE_MANAGER_POINTER));
        void* resource = static_cast<u8*>(at<void*>(sys, 0x10c)) + session.chars[i] * 64;
        session.error = 24 + i;
        if (api<u32 (*)(void*)>(CG_VRAM_ALLOCATION_INVALID)(static_cast<u8*>(resource) + 0x34)) {
            closeArchive(archiveHandle);
            dispose();
            return;
        }
        struct ActorData {
            s16 x, y;
            u16 sequence;
            u8 priority, bg;
        } data = {session.positions[i].x, session.positions[i].y, static_cast<u16>(i), 0, 0};
        session.error = 32 + i;
        session.actors[i] = api<void* (*)(void*, u32, u32, u32, const void*, u32, u32)>(
            CG_ACTOR_CREATE)(session.unit, session.chars[i], session.palette, session.animation,
                             &data, 0, subscreen->heap);
        if (!session.actors[i]) {
            closeArchive(archiveHandle);
            dispose();
            return;
        }
        api<void (*)(void*, u32)>(CG_ACTOR_FREEZE_ANIMATION)(session.actors[i], 1);
        visible(session.actors[i], false);
        session.uploaded[i] = 0xff;
        session.desired[i] = 0;
    }
    if (session.dialControl && session.skinCount) {
        session.markerChars =
            api<u32 (*)(u32, u32, u32)>(CG_CHARACTER_CREATE)(128, 1, subscreen->heap);
        if (session.markerChars == INVALID) {
            closeArchive(archiveHandle);
            dispose();
            return;
        }
        void* sys = *reinterpret_cast<void**>(nativeAddress(CG_SPRITE_MANAGER_POINTER));
        void* resource = static_cast<u8*>(at<void*>(sys, 0x10c)) + session.markerChars * 64;
        if (api<u32 (*)(void*)>(CG_VRAM_ALLOCATION_INVALID)(static_cast<u8*>(resource) + 0x34)) {
            closeArchive(archiveHandle);
            dispose();
            return;
        }
        struct MarkerData {
            s16 x, y;
            u16 sequence;
            u8 priority, bg;
        } data = {dial::decalX, dial::decalY, 8, 0, 0};
        session.marker = api<void* (*)(void*, u32, u32, u32, const void*, u32, u32)>(
            CG_ACTOR_CREATE)(session.unit, session.markerChars, session.palette, session.animation,
                             &data, 0, subscreen->heap);
        if (!session.marker) {
            closeArchive(archiveHandle);
            dispose();
            return;
        }
        api<void (*)(void*, u32)>(CG_ACTOR_FREEZE_ANIMATION)(session.marker, 1);
        visible(session.marker, false);
    }
    closeArchive(archiveHandle);
    if (session.skinCount) {
        session.skinOriginal = api<void* (*)(u32, u32, u32, const char*, u32)>(CG_HEAP_ALLOCATE)(
            subscreen->heap, 0x2600, 1, "quick-actions-skin", 0);
        if (!session.skinOriginal) {
            dispose();
            return;
        }
    }
    session.error = 40;
    session.task = api<void* (*)(void*, void*, u32)>(CG_DISPLAY_TASK_CREATE)(
        reinterpret_cast<void*>(upload), nullptr, 2);
    if (!session.task)
        dispose();
    else
        session.error = 0;
}
bool drawable(Subscreen* subscreen) {
    if (!subscreen || subscreen != session.sub || !session.unit || subscreen->state ||
        subscreen->mode != 0)
        return false;
    void* gearWork = subscreen->work;
    return gearWork && !api<u32 (*)(void*)>(CG_GET_FIELD_SCREEN_STATE)(game(subscreen)) &&
           at<u32>(gearWork, 0) == (overlayAddress(CG_CGEAR_IDLE_CALLBACK) | 1) &&
           ov<u32 (*)(Subscreen*, void*, void*)>(CG_GET_SUBSCREEN_KIND)(
               subscreen, system(subscreen), game(subscreen)) == 13;
}
bool safe(Subscreen* subscreen) {
    return drawable(subscreen) && !ov<u32 (*)(void*)>(CG_CGEAR_IS_DIMMED)(subscreen->work) &&
           !at<u32>(subscreen->work, 0x108) &&
           !ov<u32 (*)(void*)>(CG_FIELD_HAS_EVENT)(subscreen->field);
}
