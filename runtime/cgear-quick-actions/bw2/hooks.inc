extern "C" void* QaShopUnit(u32 count,u32 engine,u32 heap) { return shopUnit(count,engine,heap); }
extern "C" void QaShopGraphics(void* request) { shopGraphics(request); }
extern "C" void QaShopGraphicsEnd(void* request) { shopGraphicsEnd(request); }
extern "C" void QaShopBalanceText(void* pixels,u32 x,u32 y,void* text,u32 font,u32 color) { shopBalanceText(pixels,x,y,text,font,color); }
extern "C" void QaShopLabel(void* request, u32 row, u32 mode, u32 item, void* names) { shopLabel(request, row, mode, item, names); }
extern "C" void QaShopSelect(void* request) { shopSelect(request); }
extern "C" void QaShopRowPrice(void* list, u32 row, u32 y) { shopRowPrice(list, row, y, false); }
extern "C" void QaShopTmRowPrice(void* list, u32 row, u32 y) { shopRowPrice(list, row, y, true); }
// PMC entry points. Native lifecycle calls still run; input only records an
// action request, and QaCGearEvent dispatches it when the field is available.
// Included outside the private namespace so exported hook names stay intact.

extern "C" int QaShopChoiceAdd(void* vm, void* runtime) { return shopChoiceAdd(vm, runtime); }
extern "C" int QaShopBuyCommand(void* vm, void* runtime) { return shopBuyCommand(vm, runtime); }
extern "C" void* QaShopStockFile(u32 arc, u32 member, u32 heap) { return shopStockFile(arc, member, heap); }
extern "C" u32 QaShopPrice(void* data) { return shopPrice(data); }
extern "C" void* QaShopMessageBank(u32 mode, u32 arc, u32 member, u32 heap) { return shopMessageBank(mode, arc, member, heap); }
extern "C" u32 QaShopBalance(void* request) { return shopBalance(request); }
extern "C" u32 QaShopMoney(void* trainer) { return shopMoney(trainer); }
extern "C" void QaShopPay(void* request, u32 cost) { shopPay(request, cost); }
extern "C" u32 QaShopAdd(void* bag, u32 item, u32 quantity, u32 heap) { return shopAdd(bag, item, quantity, heap); }
extern "C" int QaShopTick(void* sys, void* request, u32 shop, u32 mode) { return shopTick(sys, request, shop, mode); }

// Lifecycle: read our archive, then run native C-Gear initialization unchanged.
extern "C" void QaCGearInit(Subscreen* subscreen) {
    dispose();
    session.sub = subscreen;
    session.attempted = 0;
    session.held = 0;
    session.pending = 0;
    session.palette = session.animation = session.markerChars = INVALID;
    for (u32 i = 0; i < 8; i++)
        session.chars[i] = INVALID;
    void* archiveHandle = archive(subscreen->heap);
    enabled = archiveHandle && config(archiveHandle, subscreen->heap);
    closeArchive(archiveHandle);
    pokenavEnabled = enabled && navConfigured(subscreen->heap);
    ov<void (*)(Subscreen*)>(CG_CGEAR_INIT)(subscreen);
}
extern "C" void* QaGearUnit(u32 count, u32 priority, u32 heap) {
    return api<void* (*)(u32, u32, u32)>(CG_SPRITE_UNIT_CREATE)(
        count + (enabled ? session.count + (session.dialControl && session.skinCount ? 1 : 0) : 0),
        priority, heap);
}
extern "C" void QaGearEnd(void* work) {
    // Native applications can rebuild C-Gear without changing its subscreen
    // object. Release our resources before the inner native teardown too.
    Subscreen* subscreen = session.sub;
    if (subscreen && subscreen->work == work) {
        dispose();
        session.sub = subscreen;
        session.attempted = 0;
    }
    ov<void (*)(void*)>(CG_CGEAR_WORK_DISPOSE)(work);
}
extern "C" void QaCGearExit(Subscreen* subscreen) {
    dispose();
    ov<void (*)(Subscreen*)>(CG_CGEAR_EXIT)(subscreen);
}
extern "C" void QaNoGearInit(Subscreen* subscreen) {
    void* archiveHandle = archive(subscreen->heap);
    enabled = archiveHandle && config(archiveHandle, subscreen->heap);
    closeArchive(archiveHandle);
    pokenavEnabled = enabled && navConfigured(subscreen->heap);
    ov<void (*)(Subscreen*)>(CG_NO_CGEAR_INIT)(subscreen);
}
extern "C" void QaCGearUpdate(Subscreen* subscreen, u32 active) {
    session.active = active;
    ov<void (*)(Subscreen*, u32)>(CG_CGEAR_UPDATE)(subscreen, active);
    // Let all native graphics finish allocating before taking spare capacity.
    // A failed attempt remains invisible and is never retried every frame.
    if (enabled && !session.attempted && subscreen == session.sub && subscreen->work &&
        at<u32>(subscreen->work, 0) == (overlayAddress(CG_CGEAR_IDLE_CALLBACK) | 1)) {
        session.attempted = 1;
        attach(subscreen);
    }
    refresh(subscreen, active);
    if (session.appliedSound) {
        session.appliedSound = 0;
        api<void (*)(u32)>(CG_PLAY_SOUND)(CG_SOUND_MENU);
    }
    if (active && safe(subscreen))
        prepareSkin();
}
// Input: capture one press, update drags, and record a pending slot. Launching
// a native menu belongs to QaCGearEvent below, not to the touch callback.
extern "C" void QaInput(void* gearWork) {
    Subscreen* subscreen = session.sub;
    if (!session.active || !safe(subscreen) || subscreen->work != gearWork) {
        cancelDial();
        session.pending = 0;
        ov<void (*)(void*)>(CG_CGEAR_INPUT)(gearWork);
        return;
    }
    u32 x = 0, y = 0;
    bool down = api<u32 (*)(u32*, u32*)>(CG_GET_STYLUS_POSITION)(&x, &y);
    if (session.dialCaptured) {
        if (!down) {
            session.dialCaptured = session.held = 0;
            visible(session.marker, false);
            return;
        }
        if (at<u8>(gearWork, 0x2fe)) {
            cancelDial();
            return;
        }
        int angle = angleAt(x, y), delta = angle - session.dialAngle;
        if (delta > 18000)
            delta -= 36000;
        if (delta < -18000)
            delta += 36000;
        session.dialAngle = angle;
        int dx = int(x) - dial::centerX, dy = int(y) - dial::centerY;
        if (dx * dx + dy * dy >= 6400 && absolute(delta) <= 9000) {
            int movement = session.dialAccum + delta;
            while (movement >= dial::step) {
                stepSkin(1);
                movement -= dial::step;
            }
            while (movement <= -dial::step) {
                stepSkin(-1);
                movement += dial::step;
            }
            session.dialAccum = movement;
            moveMarker(x, y);
        }
        return;
    }
    if (session.drag < session.count) {
        if (down) {
            auto& p = session.positions[session.drag];
            p.x = clamp(x, 16, 240);
            p.y = clamp(y, 16, 176);
            place(session.drag);
        } else {
            savePositions(game(subscreen));
            session.drag = 0xff;
            session.pressed = 0xff;
        }
        return;
    }
    if (session.held) {
        if (!down) {
            session.held = 0;
            session.pressed = 0xff;
        }
        return;
    }
    if (api<u32 (*)()>(CG_STYLUS_JUST_PRESSED)()) {
        int mx = static_cast<int>(x) - 215, my = static_cast<int>(y) - 163;
        if (session.muteControl && mx * mx + my * my <= 100) {
            session.held = 1;
            session.pending = at<u8>(gearWork, 0x2fe) ? 0 : 254;
            return;
        }
        int px = static_cast<int>(x) - 200, py = static_cast<int>(y) - 180;
        if (session.saveControl && px * px + py * py <= 100) {
            session.held = 1;
            session.pending = at<u8>(gearWork, 0x2fe) ? 0 : 255;
            return;
        }
        int sx = static_cast<int>(x) - 208, sy = static_cast<int>(y) - 18;
        if (!session.dialControl && session.skinCount && !at<u8>(gearWork, 0x2fe) &&
            sx * sx + sy * sy <= 256) {
            session.held = 1;
            session.pending = 0;
            if (!session.skinRequest && !session.skinUpload) {
                u32 i = 0;
                while (i < session.skinCount && session.skinIds[i] != session.currentSkin)
                    i++;
                session.wantedSkin = session.currentSkin == 0    ? session.skinIds[0]
                                     : i + 1 < session.skinCount ? session.skinIds[i + 1]
                                                                 : 0;
                session.skinRequest = 1;
                session.skinFeedback = 6; // Six 30 Hz updates: a 200 ms pressed flash.
                api<void (*)(u32)>(CG_PLAY_SOUND)(CG_SOUND_MENU);
            }
            return;
        }
        // Keep the fixed wrench reachable even if a saved/custom button is
        // positioned over it. Native editing/exit always owns this region.
        int dx = static_cast<int>(x) - 228, dy = static_cast<int>(y) - 144;
        int i = dx * dx + dy * dy <= 100 ? -1 : hit(x, y);
        if (i >= 0) {
            session.held = 1;
            session.pressed = i;
            if (at<u8>(gearWork, 0x2fe))
                session.drag = i;
            else if (session.available[i])
                session.pending = i + 1;
            return; // Disabled buttons also own their circular touch.
        }
        int mx0 = int(x) - 215, my0 = int(y) - 163, px0 = int(x) - 200, py0 = int(y) - 180;
        bool reserved = dx * dx + dy * dy <= 100 || (x >= 104 && x <= 152 && y <= 24) ||
                        (!session.dialControl && x >= 31 && x <= 65 && y <= 35) ||
                        (session.muteControl && mx0 * mx0 + my0 * my0 <= 100) ||
                        (session.saveControl && px0 * px0 + py0 * py0 <= 100);
        if (session.dialControl && session.skinCount && !at<u8>(gearWork, 0x2fe) && !reserved &&
            onDial(x, y) && QaButtonHit(gearWork) < 0) {
            session.pending = 0;
            session.held = 1;
            session.dialCaptured = 1;
            session.dialAngle = angleAt(x, y);
            session.dialAccum = 0;
            session.dialTarget = session.skinRequest  ? session.wantedSkin
                                 : session.skinUpload ? session.preparedSkin
                                                      : session.currentSkin;
            moveMarker(x, y);
            visible(session.marker, true);
            return;
        }
    }
    ov<void (*)(void*)>(CG_CGEAR_INPUT)(gearWork);
}
extern "C" int QaButtonHit(void* gearWork) {
    if (enabled && session.dialCaptured)
        return -1;
    // Input only: allow the wrench, pattern toggle and panel drags with wireless off.
    // Never make the C-Gear state machine believe wireless has been enabled.
    u8 power = at<u8>(gearWork, 0x30b);
    bool edit = at<u8>(gearWork, 0x2fe);
    u32 x = 0, y = 0;
    api<u32 (*)(u32*, u32*)>(CG_GET_STYLUS_POSITION)(&x, &y);
    int dx = static_cast<int>(x) - 228, dy = static_cast<int>(y) - 144;
    bool wrench = dx * dx + dy * dy <= 100;
    bool logo = x >= 104 && x <= 152 && y <= 24;
    if (enabled && (edit || wrench || logo))
        at<u8>(gearWork, 0x30b) = 1;
    int result = ov<int (*)(void*)>(CG_CGEAR_HIT_TEST)(gearWork);
    at<u8>(gearWork, 0x30b) = power;
    if (enabled && session.dialControl && (result == 3 || result == 4))
        return -1;
    if (enabled && session.saveControl && result == 5)
        return -1;
    if (enabled && session.muteControl && result == 6)
        return -1;
    if (enabled && session.hideCommunication && ((result >= 0 && result <= 2) || result == 8))
        return -1;
    return result;
}
// Dispatch: give native events priority, consume the request once, recheck the
// world, then either toggle local state or return an event to the native owner.
extern "C" void* QaCGearEvent(Subscreen* subscreen, u32 available) {
    void* native = ov<void* (*)(Subscreen*, u32)>(CG_CGEAR_GET_EVENT)(subscreen, available);
    u32 action = session.pending;
    session.pending = 0;
    if (native || !available || !action || !safe(subscreen) || at<u8>(subscreen->work, 0x2fe))
        return native;
    if (action == 254 && session.muteControl) {
        session.muteState = PokewebBgmMute(1);
        api<void (*)(u32)>(CG_PLAY_SOUND)(CG_SOUND_MENU);
        return nullptr;
    }
    if (action == 255 && session.saveControl) {
        void* event = api<void* (*)(void*, void*, void*, u32)>(CG_EVENT_CREATE)(
            system(subscreen), nullptr, reinterpret_cast<void*>(saveEvent), sizeof(SaveWork));
        if (event) {
            auto* requestWork = api<SaveWork* (*)(void*)>(CG_EVENT_WORK)(event);
            clear(requestWork, sizeof(*requestWork));
            requestWork->control = save(game(subscreen));
            requestWork->sys = system(subscreen);
            requestWork->field = subscreen->field;
            requestWork->message = ov<void* (*)(void*)>(CG_FIELD_MESSAGE_WINDOW)(subscreen->field);
            requestWork->heap = subscreen->heap;
            requestWork->returnMode = subscreen->mode;
            requestWork->sub = subscreen;
        }
        return event;
    }
    if (action > session.count || !show(action - 1, subscreen))
        return nullptr;
    void* gameData = game(subscreen);
    void* sys = system(subscreen);
    const auto& button = session.buttons[action - 1];
    action = button.action;
    if (!canUse(static_cast<u32>(&button - session.buttons), subscreen))
        return nullptr;
    if (action == CG_ACTION_REPEL) {
#ifdef CGEAR_REDUX
        if (toggleRepel(gameData))
#else
        u16* p = options(gameData);
        *p ^= CG_REPEL_OPTION_MASK;
        if (*p & CG_REPEL_OPTION_MASK)
#endif
            api<void (*)(u32)>(CG_PLAY_SOUND)(CG_SOUND_REPEL);
        return nullptr;
    }
    if (action == CG_ACTION_POKENAV)
        return navLaunch(subscreen);
    if (action == CG_ACTION_PC)
        return storageEvent(sys, subscreen->heap);
    if (action == CG_ACTION_SYSTEM_SHOP)
        return shopLaunch(subscreen);
    if (action == CG_ACTION_POKERADAR) {
        api<void (*)(u32)>(CG_PLAY_SOUND)(CG_SOUND_MENU);
        pokeradar(subscreen);
        return nullptr;
    }
    if (action == CG_ACTION_BICYCLE || action == CG_ACTION_DOWSING || action == CG_ACTION_SUPER_ROD)
        return ov<void* (*)(u32, void*, void*)>(CG_CREATE_KEY_ITEM_EVENT)(
            action == CG_ACTION_BICYCLE   ? 0
            : action == CG_ACTION_DOWSING ? 5
                                          : 4,
            sys, subscreen->field);
    void* event = api<void* (*)(void*, void*, void*, u32)>(CG_EVENT_CREATE)(
        sys, nullptr, reinterpret_cast<void*>(flyEvent), sizeof(FlyWork));
    if (event) {
        auto* requestWork = api<FlyWork* (*)(void*)>(CG_EVENT_WORK)(event);
        clear(requestWork, sizeof(*requestWork));
        requestWork->action = action;
        requestWork->item = button.alternate && item(gameData, button.alternate, subscreen->heap)
                                ? button.alternate
                                : button.item;
        if (isFlyMapAction(action) || action == CG_ACTION_TOWN_MAP || action == CG_ACTION_BAG ||
            action == CG_ACTION_PARTY)
            api<void (*)(u32)>(CG_PLAY_SOUND)(CG_SOUND_MENU);
    }
    return event;
}
extern "C" int QaTownMapReturn(void* work, void* param) {
    if (ownedMap && at<void*>(work, 0x18) == ownedMap && at<u32>(param, 4) != 2) {
        auto* requestWork = static_cast<FlyWork*>(ownedMap->user);
        if (isFlyMapAction(requestWork->action) || requestWork->action == CG_ACTION_TOWN_MAP)
            return 1;
    }
    return ov<int (*)(void*, void*)>(CG_TOWN_MAP_RETURN)(work, param);
}
// Repel is a saved preference plus these two encounter hooks. We do not give
// the player extra Repel items or overwrite the ordinary remaining-step count.
extern "C" u32 QaRepelStep(void* encounter, void* gameData) {
    if (repel(gameData))
        return 0;
    return api<u32 (*)(void*)>(CG_REPEL_STEP)(encounter);
}
extern "C" u32 QaRepelDepleted(void* encounter, void* gameData) {
    if (repel(gameData) && count(gameData))
        return 0;
    return api<u32 (*)(void*)>(CG_REPEL_DEPLETED)(encounter);
}
extern "C" u32 QaPhenomenonInterval(void* state, void* effect) {
    if (radarWork && radarWork == effect)
        return 1;
    return ov<u32 (*)(void*, void*)>(CG_PHENOMENON_INTERVAL)(state, effect);
}
extern "C" u32 QaPhenomenonChance(u32 chance) {
    // Called only at the native spawn-probability site. Other RNG stays native.
    return radarWork ? 100 : api<u32 (*)(u32)>(CG_RANDOM_RANGE)(chance);
}
