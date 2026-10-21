// Archive integrity, configuration decoding and stable-ID save positions.
// Included once by quick_actions.cpp inside its private namespace.

void* archive(u16 heap, const char* path = "rom:/quick-actions/ui.narc") {
    // Native ARCHANDLE contains FSFile (72 bytes), archive offset and counts.
    void* archiveHandle = api<void* (*)(u32, u32, u32, const char*, u32)>(CG_HEAP_ALLOCATE)(
        heap, 80, 1, "quick-actions", 0);
    if (!archiveHandle)
        return nullptr;
    api<void (*)(void*)>(CG_FS_FILE_INIT)(archiveHandle);
    if (!api<u32 (*)(void*, const char*)>(CG_FS_FILE_OPEN)(archiveHandle, path)) {
        api<void (*)(void*)>(CG_HEAP_FREE)(archiveHandle);
        return nullptr;
    }
    api<void (*)(void*)>(CG_ARCHIVE_INIT)(archiveHandle);
    return archiveHandle;
}
void closeArchive(void* archiveHandle) {
    if (archiveHandle)
        api<void (*)(void*)>(CG_ARCHIVE_CLOSE)(archiveHandle);
}
void* read(void* archiveHandle, u32 member, u16 heap, u32 size) {
    if (api<u32 (*)(void*, u32)>(CG_ARCHIVE_MEMBER_SIZE)(archiveHandle, member) != size)
        return nullptr;
    return api<void* (*)(void*, u32, u32)>(CG_ARCHIVE_READ_MEMBER)(archiveHandle, member, heap);
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
u32 fingerprint(const u8* p, u32 n, u32 h = 0x811c9dc5) {
    for (u32 i = 0; i < n; i++)
        h = (h ^ p[i]) * 0x1000193;
    return h;
}
bool config(void* archiveHandle, u16 heap) {
    session.count = 0;
    repelPresent = false;
    session.hideCommunication = session.saveControl = session.muteControl = session.dialControl = 0;
    void* m = read(archiveHandle, 0, heap, 160);
    if (!m)
        return false;
    bool ok = at<u32>(m, 0) == 0x41475143 && (at<u16>(m, 4) == 6 || at<u16>(m, 4) == 7) &&
              at<u16>(m, 6) == 160 && at<u32>(m, 8) == 1 && at<u32>(m, 12) == 0x41475142 &&
              at<u8>(m, 20) <= 8;
    u32 hash = fingerprint(static_cast<u8*>(m), 28);
    hash = fingerprint(static_cast<u8*>(m) + 32, 128, hash);
    if (hash != at<u32>(m, 28))
        ok = false;
    if (ok) {
        session.saveControl = at<u16>(m, 4) == 7;
        session.hideCommunication = session.saveControl ? at<u8>(m, 45) : 0;
        session.dialControl = session.saveControl && at<u8>(m, 47) == 1;
        session.muteControl = session.saveControl ? at<u8>(m, 46) : 0;
        if (session.muteControl > 1)
            ok = false;
        if (session.hideCommunication > 1)
            ok = false;
        session.skinCount = at<u8>(m, 21);
        session.defaultSkin = at<u16>(m, 22);
        if (session.skinCount > 64)
            ok = false;
        void* catalog = ok ? read(archiveHandle, 15, heap, 16 + session.skinCount * 8) : nullptr;
        if (!catalog)
            ok = false;
        if (catalog) {
            if (at<u32>(catalog, 0) != 0x534e4b53 || at<u16>(catalog, 4) != 1 ||
                at<u16>(catalog, 6) != session.skinCount)
                ok = false;
            bool found = session.defaultSkin == 0;
            for (u32 i = 0; i < session.skinCount; i++) {
                session.skinIds[i] = at<u16>(catalog, 16 + i * 8);
                session.skinMembers[i] = at<u16>(catalog, 18 + i * 8);
                session.skinHashes[i] = at<u32>(catalog, 20 + i * 8);
                if (!session.skinIds[i] || session.skinIds[i] > 4095 ||
                    session.skinMembers[i] != 16 + i)
                    ok = false;
                if (session.skinIds[i] == session.defaultSkin)
                    found = true;
                for (u32 j = 0; j < i; j++)
                    if (session.skinIds[i] == session.skinIds[j])
                        ok = false;
            }
            if (!found)
                ok = false;
            api<void (*)(void*)>(CG_HEAP_FREE)(catalog);
        }
        session.count = at<u8>(m, 20);
        for (u32 i = 0; i < 8; i++) {
            for (u32 n = 0; n < 16; n++)
                at<u8>(&session.buttons[i], n) = at<u8>(m, 32 + i * 16 + n);
            const auto& b = session.buttons[i];
            if (i < session.count) {
                if (!b.id || b.action < CG_ACTION_REPEL || b.action > CG_ACTION_SYSTEM_SHOP ||
                    b.flagMode > 2 || (b.flagMode && (!b.flag || b.flag > 3059)) || b.x < 16 ||
                    b.x > 240 || b.y < 16 || b.y > 176 || (b.check != 255 && b.check > 11))
                    ok = false;
                for (u32 j = 0; j < i; j++)
                    if (session.buttons[j].id == b.id)
                        ok = false;
                if (b.action == CG_ACTION_REPEL)
                    repelPresent = true;
            }
            for (u32 c = 0; c < 4; c++)
                session.rings[i][c] = c == 3 ? 9 : c + 1;
        }
    }
    api<void (*)(void*)>(CG_HEAP_FREE)(m);
    if (!ok) {
        session.count = 0;
        session.skinCount = 0;
        repelPresent = false;
    }
    return ok;
}
void loadPositions(void* gameData) {
    const u8* p = static_cast<u8*>(cgearSave(gameData)) + 16;
    u16 marker = at<u16>(const_cast<u8*>(p), 0);
    bool current = (marker == 0x3251 || (marker & 0xf000) == 0xa000) &&
                   crc(p, 34) == at<u16>(const_cast<u8*>(p), 34);
    session.currentSkin = session.defaultSkin;
    if (current && (marker & 0xf000) == 0xa000) {
        u16 id = marker & 4095;
        bool found = id == 0;
        for (u32 i = 0; i < session.skinCount; i++)
            if (session.skinIds[i] == id)
                found = true;
        if (found)
            session.currentSkin = id;
    }
    session.wantedSkin = session.currentSkin;
    session.skinRequest = session.currentSkin != 0;
    u8 sum = 0x9b;
    for (u32 i = 0; i < 13; i++)
        sum ^= p[i];
    bool legacy = at<u32>(const_cast<u8*>(p), 0) == 0x31504151 && p[4] == 1 && p[13] == sum;
    for (u32 i = 0; i < session.count; i++) {
        const auto& b = session.buttons[i];
        Point v = {b.x, b.y};
        if (current)
            for (u32 j = 0; j < 8; j++)
                if (at<u16>(const_cast<u8*>(p), 2 + j * 4) == b.id)
                    v = {p[4 + j * 4], p[5 + j * 4]};
        if (legacy && b.id <= 4)
            v = {p[5 + (b.id - 1) * 2], p[6 + (b.id - 1) * 2]};
        session.positions[i] =
            (v.x >= 16 && v.x <= 240 && v.y >= 16 && v.y <= 176) ? v : Point{b.x, b.y};
    }
}
void savePositions(void* gameData) {
    // The checked save block is 52 bytes: retain native bytes 0..15 and use
    // only its 36-byte reserved tail. Stable IDs detach positions from order.
    u8* p = static_cast<u8*>(cgearSave(gameData)) + 16;
    clear(p, 36);
    at<u16>(p, 0) = 0xa000 | session.currentSkin;
    for (u32 i = 0; i < session.count; i++) {
        at<u16>(p, 2 + i * 4) = session.buttons[i].id;
        p[4 + i * 4] = session.positions[i].x;
        p[5 + i * 4] = session.positions[i].y;
    }
    at<u16>(p, 34) = crc(p, 34);
}
