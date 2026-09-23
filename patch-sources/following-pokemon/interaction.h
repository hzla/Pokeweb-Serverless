#ifndef FW_INTERACTION_H
#define FW_INTERACTION_H
#include "native.h"
#include "reactions.h"
void fwt_poll_input(void);
int fwt_active(void);
int fwt_owns(void *field);
/* Called once by each field actor update; includes our event's completion frame. */
int fwt_field_owns(void *field);
int fwt_reach(FwFollower *f,Actor *player,Actor *actor,void *field);
void *fwt_begin(FwFollower *f,Actor *player,Actor *actor,void *field,void *game,const FwrSnapshot *snapshot);
void fwt_cancel(void);
void fwt_unload(void);
#endif
