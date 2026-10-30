#ifndef FW_NATIVE_ROUTE_H
#define FW_NATIVE_ROUTE_H
#include "following.h"
/* WORLD samples keep the native continuous rail heading in rail and the
 * corresponding input direction in connection's low bits. FW_RAIL retains
 * its original connection/identity meaning. This is transient trail data. */
#define FWN_RAIL_HEADING 0xfffcu
static inline int fwn_has_heading(const FwSample *s){
    return s->kind==FW_WORLD&&(s->connection&0xfffcu)==FWN_RAIL_HEADING;
}
/* One controller owns movement. The second bounded trail exists only while
 * traversing the already-recorded route during a reversal. No native partner
 * configuration, save flag or battle-partner identity is used. */
typedef struct {
    FwTrail reversal;
    FwSample player;
    uint32_t progress, recovery, startKeep;
    uint8_t valid, swapping, easing, idle;
    uint16_t zone;
    uint8_t inputValid,inputDirection,previousInput,facingValid;
    uint16_t facingAngle;
} FwNativeRoute;
void fwn_route_reset(FwNativeRoute *route);
int fwn_route_step(FwNativeRoute *route,FwFollower *f,const FwSample *player,
                   const FwPoint *current,FwSample *target);
int fwn_route_rebase(FwNativeRoute *route,FwFollower *f,const FwPoint *delta);
int fwn_pedestrian(unsigned code,unsigned *direction,unsigned *tiles);
int fwn_reposition(const FwPoint *from,const FwPoint *to);
int fwn_large_indoor(unsigned size_mode,int exterior);
#endif
