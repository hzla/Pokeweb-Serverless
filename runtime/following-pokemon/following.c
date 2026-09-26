#include "following.h"
#include <limits.h>
int fw_select(const FwPokemon *party, unsigned count) {
    int fallback = -1;
    if (!party || count > FW_PARTY_CAPACITY) return -1;
    for (unsigned i = 0; i < count; ++i) {
        if (party[i].egg || !party[i].species || party[i].species > FW_MAX_SPECIES) continue;
        if (fallback < 0) fallback = (int)i;
        if (party[i].hp) return (int)i;
    }
    return fallback;
}
int fw_cycle_slot(const FwPokemon *party, unsigned count, int current, int direction) {
    if (!party || !count || count > FW_PARTY_CAPACITY || (direction != -1 && direction != 1)) return -1;
    int baseline = fw_select(party, count);
    if (baseline < 0) return -1;
    if (current < 0 || (unsigned)current >= count) current = baseline;
    int healthy = 0;
    for (unsigned i = 0; i < count; ++i)
        if (!party[i].egg && party[i].species && party[i].species <= FW_MAX_SPECIES && party[i].hp) healthy = 1;
    int slot = current;
    for (unsigned step = 1; step <= count; ++step) {
        slot += direction;
        if (slot < 0) slot = (int)count - 1;
        else if ((unsigned)slot >= count) slot = 0;
        const FwPokemon *mon = &party[slot];
        if (!mon->egg && mon->species && mon->species <= FW_MAX_SPECIES && (!healthy || mon->hp))
            return slot == current ? -1 : slot;
    }
    return -1;
}
int fw_same_identity(const FwPokemon *a, const FwPokemon *b) {
    return a->personality == b->personality && a->trainer == b->trainer &&
        a->species == b->species && a->form == b->form &&
        a->gender == b->gender && a->shiny == b->shiny;
}
int fw_tired(const FwPokemon *mon) { return mon->max_hp && (uint32_t)mon->hp * 4 <= mon->max_hp; }
int fw_idle_animation_enabled(FwState state, unsigned visible, unsigned effect_busy) {
    return state == FW_FOLLOWING && visible && !effect_busy;
}
void fw_trail_clear(FwTrail *t) { t->head = t->count = 0; t->distance = 0; }
void fw_init(FwFollower *f, uint32_t generation) {
    f->state = FW_ABSENT; f->actor = 0; f->generation = generation;
    f->slot = -1; f->has_selection = 0; f->side_gap = 0;
    for (unsigned i = 0; i < FW_REASON_COUNT; ++i) f->suppression[i] = 0;
    fw_trail_clear(&f->trail);
}
int fw_suppressed(const FwFollower *f) {
    for (unsigned i = 0; i < FW_REASON_COUNT; ++i) if (f->suppression[i]) return 1;
    return 0;
}
void fw_enter(FwFollower *f, FwReason reason) {
    if ((unsigned)reason >= FW_REASON_COUNT) return;
    /* Saturation latches the guard rather than wrapping to an unsafe release. */
    if (f->suppression[reason] < 255) ++f->suppression[reason];
    f->state = FW_SUPPRESSED; fw_trail_clear(&f->trail);
}
void fw_leave(FwFollower *f, FwReason reason) {
    if ((unsigned)reason >= FW_REASON_COUNT) return;
    if (f->suppression[reason] && f->suppression[reason] != 255) --f->suppression[reason];
    if (!fw_suppressed(f) && f->state == FW_SUPPRESSED) f->state = FW_WAITING;
}
int fw_interact(FwFollower *f) {
    if (f->state != FW_FOLLOWING || fw_suppressed(f) || !f->actor) return 0;
    f->state = FW_INTERACTING; return 1;
}
void fw_end_interaction(FwFollower *f) {
    if (f->state == FW_INTERACTING) f->state = fw_suppressed(f) ? FW_SUPPRESSED : FW_FOLLOWING;
}
static uint32_t abs_delta(int32_t a, int32_t b) {
    int64_t d = (int64_t)a - b;
    if (d > FW_TILE * 2 || d < -FW_TILE * 2) return FW_TILE * 3;
    return (uint32_t)(d < 0 ? -d : d);
}
static uint32_t isqrt(uint64_t n) {
    uint64_t bit = (uint64_t)1 << 62, result = 0;
    while (bit > n) bit >>= 2;
    while (bit) {
        if (n >= result + bit) { n -= result + bit; result = (result >> 1) + bit; }
        else result >>= 1;
        bit >>= 2;
    }
    return (uint32_t)result;
}
static uint32_t distance(const FwSample *a, const FwSample *b) {
    uint32_t x = abs_delta(a->x, b->x), z = abs_delta(a->z, b->z);
    return isqrt((uint64_t)x * x + (uint64_t)z * z);
}
/* One constant metric per appearance: horizontal span 16+gap, vertical 16.
 * Corners follow recorded poses instead of changing a distance target abruptly.
 * Integer weights keep cardinal spacing exact with no extra history buffer. */
static uint32_t trail_distance(const FwSample *a, const FwSample *b, const uint8_t gaps[4]) {
    unsigned gx = b->x < a->x ? gaps[2] : gaps[3], gz = b->z < a->z ? gaps[0] : gaps[1];
    uint32_t raw_x = abs_delta(a->x, b->x),raw_z = abs_delta(a->z, b->z);
    uint32_t x = (raw_x*16u+15u+gx)/(16u+gx), z = (raw_z*16u+15u+gz)/(16u+gz);
    return isqrt((uint64_t)x * x + (uint64_t)z * z);
}
int fw_clamp_dialogue_pose(FwPoint *pose,const FwPoint *player,const FwPoint *art_offset,
                           unsigned face,unsigned gap){
    if(!pose||!player||face>3||gap>FW_MAX_DIRECTIONAL_GAP)return 0;
    FwPoint offset=art_offset?*art_offset:(FwPoint){0,0,0};
    int64_t along=face==0?(int64_t)player->z-pose->z:
                  face==1?(int64_t)pose->z-player->z:
                  face==2?(int64_t)player->x-pose->x:(int64_t)pose->x-player->x;
    int64_t lateral=face<2?(int64_t)pose->x-player->x:(int64_t)pose->z-player->z;
    int64_t art_along=along+(face==0?-(int64_t)offset.z:face==1?offset.z:face==2?-(int64_t)offset.x:offset.x);
    int64_t art_lateral=lateral+(face<2?offset.x:offset.z);
    int64_t height=(int64_t)pose->y-player->y;
    int64_t limit=FW_DIALOGUE_REACH(gap);
    /* A small draw-anchor displacement can put the world actor just beyond
     * the coarse reach bound. Do not pull a distant or off-axis actor across
     * a turn, wall, stair or discontinuity to make it talkable. */
    int64_t farthest=along>art_along?along:art_along;
    if(farthest<=limit||along>limit+2*4096||farthest>limit+10*4096||
       lateral<-(int64_t)FW_TILE/3||lateral>(int64_t)FW_TILE/3||
       art_lateral<-(int64_t)FW_TILE/3||art_lateral>(int64_t)FW_TILE/3||
       height<-8*4096||height>8*4096)return 0;
    int64_t shift=farthest-limit;
    int64_t value=face==0?(int64_t)pose->z+shift:
                  face==1?(int64_t)pose->z-shift:
                  face==2?(int64_t)pose->x+shift:(int64_t)pose->x-shift;
    if(value<INT32_MIN||value>INT32_MAX)return 0;
    if(face<2)pose->z=(int32_t)value;
    else pose->x=(int32_t)value;
    return 1;
}
static unsigned index_at(const FwTrail *t, unsigned at) { return (t->head + at) % FW_TRAIL_CAPACITY; }
int fw_trail_push_directional(FwTrail *t, const FwSample *s, FwSample *out, const uint8_t gaps[4]) {
    if (!gaps || gaps[0]>FW_MAX_DIRECTIONAL_GAP||gaps[1]>FW_MAX_DIRECTIONAL_GAP||gaps[2]>FW_MAX_DIRECTIONAL_GAP||gaps[3]>FW_MAX_DIRECTIONAL_GAP||
        !s || !out || s->kind > FW_WORLD || s->direction > 3 || !s->generation) { fw_trail_clear(t); return -1; }
    if (!t->count) { t->samples[0] = *s; t->head = 0; t->count = 1; return 0; }
    const FwSample *last = &t->samples[index_at(t, t->count - 1)];
    uint32_t delta = distance(last, s);
    int disconnected = last->generation != s->generation || last->space != s->space ||
        delta > FW_TILE || abs_delta(last->y, s->y) > FW_TILE * 2;
    if (last->kind == FW_RAIL && s->kind == FW_RAIL && last->rail != s->rail &&
        (last->connection == 0xffff || last->connection != s->connection)) disconnected = 1;
    if (disconnected || t->count == FW_TRAIL_CAPACITY) { fw_trail_clear(t); return -1; }
    /* Stationary facing changes must not consume the bounded history. */
    if (!delta && last->y == s->y) return 0;
    t->samples[index_at(t, t->count++)] = *s;
    t->distance += trail_distance(last, s, gaps);
    if (t->distance < FW_TILE) return 0;
    while (t->count > 1) {
        const FwSample *a = &t->samples[t->head];
        const FwSample *b = &t->samples[index_at(t, 1)];
        uint32_t step = trail_distance(a, b, gaps);
        if (t->distance - step < FW_TILE) break;
        t->distance -= step; t->head = (t->head + 1) % FW_TRAIL_CAPACITY; --t->count;
    }
    *out = t->samples[t->head];
    return 1;
}
int fw_trail_push(FwTrail *t, const FwSample *s, FwSample *out, unsigned gap) {
    if(gap>FW_MAX_SIDE_GAP){fw_trail_clear(t);return -1;}
    const uint8_t gaps[4]={0,0,(uint8_t)gap,(uint8_t)gap};
    return fw_trail_push_directional(t,s,out,gaps);
}
