// Touch layering, per-frame poses, theme colors and native control visibility.
// Included once by quick_actions.cpp inside its private namespace.

int hit(u32 x, u32 y) {
    int wx = static_cast<int>(x) - 228, wy = static_cast<int>(y) - 144;
    int sx = static_cast<int>(x) - 208, sy = static_cast<int>(y) - 18;
    int px = static_cast<int>(x) - 200, py = static_cast<int>(y) - 180;
    if ((session.saveControl && px * px + py * py <= 100) || wx * wx + wy * wy <= 100 ||
        (x >= 104 && x <= 152 && y <= 24) ||
        (!session.dialControl && session.skinCount && sx * sx + sy * sy <= 256))
        return -1;
    for (u32 n = session.count; n > 0; n--) {
        u32 i = n - 1;
        if (!session.shown[i])
            continue;
        int dx = static_cast<int>(x) - session.positions[i].x,
            dy = static_cast<int>(y) - session.positions[i].y;
        if (dx * dx + dy * dy <= 256)
            return static_cast<int>(i);
    }
    return -1;
}
void refresh(Subscreen* s, u32 active) {
    // Native field events temporarily disable input while retaining C-Gear.
    // Keep the overlay on that screen during Bike and PC dialogs; hiding it
    // belongs to the display lifecycle, independently of input permission.
    session.active = active;
    session.visible = drawable(s);
    if (!active || !safe(s)) {
        cancelDial();
        session.pending = 0;
        session.pressed = 0xff;
        session.drag = 0xff;
        session.skinFeedback = 0;
    }
    bool moveNetwork =
        session.visible && session.saveControl && (session.skinCount || session.dialControl);
    if (moveNetwork != !!session.networkMoved) {
        api<void (*)(u32, u32)>(CG_NETWORK_ICON_POSITION)(moveNetwork ? 256 : 200,
                                                          moveNetwork ? 192 : 10);
        session.networkMoved = moveNetwork;
    }
    if (!session.unit)
        return;
    void* gameData = game(s);
    bool edit = at<u8>(s->work, 0x2fe);
    if (edit || !session.visible)
        session.skinFeedback = 0;
    if (edit)
        cancelDial();
    if (session.dialControl) {
        // Four time digits, the clock's circular backing, and the old selector.
        // Native updates may show these again, so hide them before each render.
        for (u32 i = 0; i < 6; i++)
            visible(at<void*>(s->work, 0x6c + i * 4), false);
    }
    if (session.visible && session.skinCount && !session.dialControl) {
        // The retained ACT_NETWORK_BG has two frames in native sequence 5.
        // Override its network-status frame after native update; use the owned
        // pressed glyph briefly even when the stylus has already been released.
        void* selector = at<void*>(s->work, 0x80);
        if (selector) {
            api<void (*)(void*, u16)>(CG_ACTOR_SET_FRAME)(
                selector,
                (session.dialControl ? session.dialCaptured : session.skinFeedback) ? 1 : 0);
        }
        if (session.skinFeedback)
            session.skinFeedback--;
    }
    if (session.visible) {
        for (u32 i = 0; i < session.count; i++)
            session.shown[i] = show(i, s);
        // Follow native sleep dimming after its delayed palette update.
        // Short Bike events finish before that update, avoiding a flash.
        if (!at<u8>(s->work, 0x310))
            session.dim = ov<u32 (*)(void*)>(CG_CGEAR_IS_DIMMED)(s->work);
        // Match the user's middle C-Gear ring, including native pink themes
        // and colour edits. These offsets are independently pinned per game.
        u32 col = at<u8>(s->work, 0x306);
        if (col >= 6)
            col = 0;
        for (u32 i = 0; i < session.count; i++)
            for (u32 c = 0; c < 3; c++)
                session.colours[i * 16 + session.rings[i][c]] =
                    at<u16>(s->work, 0x18c + col * 18 + 6 + c * 2);
        for (u32 i = 0; i < session.count; i++)
            session.available[i] = canUse(i, s);
        session.frame++;
        // Retail hides ACT_CUSTOM with wireless off. Its actor is retained;
        // restore only that actor, without changing any communication flag.
        visible(at<void*>(s->work, 0x90), true);
        if (session.hideCommunication) {
            visible(at<void*>(s->work, 0x6c + 10 * 4), false);
            for (u32 i = 13; i <= 19; i++)
                visible(at<void*>(s->work, 0x6c + i * 4), false);
        }
        if (session.saveControl)
            visible(at<void*>(s->work, 0x6c + 7 * 4), true);
        if (session.muteControl) {
            session.muteState = PokewebBgmMute(0);
            void* music = at<void*>(s->work, 0x6c + 8 * 4);
            visible(music, true);
            if (music) {
                // Help has a single normal frame; choose the appropriate
                // sequence and freeze its first cell instead of frame 1.
                api<void (*)(void*, u16)>(CG_ACTOR_SET_SEQUENCE)(music, session.muteState ? 9 : 8);
                api<void (*)(void*, u32)>(CG_ACTOR_FREEZE_ANIMATION)(music, 1);
                api<void (*)(void*, u16)>(CG_ACTOR_SET_FRAME)(music, 0);
            }
        }
    }
    u32 keys = api<u32 (*)()>(CG_GET_HELD_KEYS)();
    if (edit && (keys & 0x300) == 0x300) {
        // The field subscreen update runs at 30 Hz in both retail profiles.
        if (!session.resetHeld && ++session.resetFrames >= 30) {
            session.resetHeld = 1;
            session.pending = 0;
            session.drag = 0xff;
            for (u32 i = 0; i < session.count; i++) {
                session.positions[i] = {session.buttons[i].x, session.buttons[i].y};
                place(i);
            }
            savePositions(gameData);
        }
    } else {
        session.resetFrames = 0;
        session.resetHeld = 0;
    }
    for (u32 i = 0; i < session.count; i++) {
        bool on = (session.buttons[i].action == CG_ACTION_REPEL && repel(gameData)) ||
                  (session.buttons[i].action == CG_ACTION_BICYCLE && cycling(gameData));
        u32 pose = session.pressed == i ? 2 : edit ? 1 : !session.available[i] ? 3 : on ? 1 : 0;
        u32 design = at<u8>(s->work, 0x300), sex = at<u8>(s->work, 0x30a);
        if (design >= 5)
            design = 0;
        if (sex > 1)
            sex = 0;
        session.desired[i] = (pose << 4) | (sex * 5 + design);
    }
}
