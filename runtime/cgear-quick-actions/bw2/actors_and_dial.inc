// Actor placement and integer-only outer-rim input geometry.
// Included once by quick_actions.cpp inside its private namespace.

void visible(void* actor, bool on) {
    if (actor)
        api<void (*)(void*, u32)>(CG_ACTOR_VISIBLE)(actor, on);
}
void place(u32 i) {
    s16 xy[2] = {session.positions[i].x, session.positions[i].y};
    api<void (*)(void*, const s16*, u32)>(CG_ACTOR_POSITION)(session.actors[i], xy, 0);
}
void placeActor(void* actor, s16 x, s16 y) {
    s16 p[2] = {x, y};
    if (actor)
        api<void (*)(void*, const s16*, u32)>(CG_ACTOR_POSITION)(actor, p, 0);
}
int absolute(int v) {
    return v < 0 ? -v : v;
}
u32 divide(u32 n, u32 d) {
    u32 q = 0, b = 1;
    while (d <= n / 2) {
        d <<= 1;
        b <<= 1;
    }
    for (; b; b >>= 1, d >>= 1)
        if (n >= d) {
            n -= d;
            q |= b;
        }
    return q;
}
int ratio(int n, u32 d) {
    return n < 0 ? -int(divide(-n, d)) : int(divide(n, d));
}
int angleAt(int x, int y) {
    x -= dial::centerX;
    y -= dial::centerY;
    int ax = absolute(x), ay = absolute(y), hi = ax > ay ? ax : ay, lo = ax < ay ? ax : ay;
    if (!hi)
        return 0;
    int a = dial::angles[divide(lo * 128 + hi / 2, hi)], first = ax >= ay ? a : 9000 - a;
    return y >= 0 ? (x >= 0 ? first : 18000 - first)
                  : (x < 0 ? 18000 + first : (first ? 36000 - first : 0));
}
bool onDial(int x, int y) {
    int dx = x - dial::centerX, dy = y - dial::centerY, d = dx * dx + dy * dy;
    return d >= dial::innerRadius * dial::innerRadius && d <= dial::outerRadius * dial::outerRadius;
}
void moveMarker(int x, int y) {
    int dx = x - dial::centerX, dy = y - dial::centerY, d = dx * dx + dy * dy, r = 1;
    while ((r + 1) * (r + 1) <= d)
        ++r;
    session.markerX = dial::centerX + ratio(dx * dial::markerRadius, r);
    session.markerY = dial::centerY + ratio(dy * dial::markerRadius, r);
    placeActor(session.marker, session.markerX, session.markerY);
}
void cancelDial() {
    if (session.dialCaptured) {
        session.held = 1;
        session.wantedSkin = session.skinUpload ? session.preparedSkin : session.currentSkin;
        session.skinRequest = session.skinSound = 0;
    }
    session.dialCaptured = 0;
    visible(session.marker, false);
}
void stepSkin(int direction) {
    int i = -1;
    for (u32 n = 0; n < session.skinCount; n++)
        if (session.skinIds[n] == session.dialTarget)
            i = n;
    i += direction;
    if (i >= int(session.skinCount))
        i = -1;
    if (i < -1)
        i = session.skinCount - 1;
    session.dialTarget = i < 0 ? 0 : session.skinIds[i];
    session.wantedSkin = session.dialTarget;
    session.skinRequest = 1;
    session.skinSound = 1;
}
