#ifndef FW_EFFECTS_H
#define FW_EFFECTS_H
#include "native.h"
void fwfx_prepare(Actor *actor);
void fwfx_snapshot(Actor *actor);
void fwfx_out(Actor *actor);
void fwfx_recall(Actor *actor);
void fwfx_tick(void);
void fwfx_cancel(void);
void fwfx_destroy(void);
int fwfx_hides_actor(void);
int fwfx_busy(void);
int fwfx_available(void);
void fwfx_draw(void *camera,void *light);
/* Private reaction emotes; frame resources never alias a native actor palette. */
int fwfx_emote_begin(Actor *actor,unsigned member);
void fwfx_emote_frame(Actor *actor,unsigned frame);
void fwfx_emote_end(void);

#endif
