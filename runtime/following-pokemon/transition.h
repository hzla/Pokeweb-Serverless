#ifndef POKEWEB_FOLLOWING_TRANSITION_H
#define POKEWEB_FOLLOWING_TRANSITION_H
#include "native.h"
#include "events.h"

/* All state is temporary and belongs to the stock field overlay. */
int fwtm_eligible(void *game,void *field,const FwPokemon *selected,int slot,
                  unsigned *direction,unsigned *attribute);
void *fwtm_enter(void *game,void *field,const FwPokemon *selected,int slot,
                 unsigned appearance,unsigned direction,unsigned attribute);
void fwtm_observe_exit(void *event,void *game,void *field);
unsigned fwtm_appearance(void *game);
int fwtm_return_ready(void *game,const FwPokemon *selected);
int fwtm_return_pending(void);
void fwtm_return_done(void);
void fwtm_cancel(void);
int fwtm_entering(void);
int fwtm_exiting(void);
int fwtm_menu_snapshot(void *field,FweMount *mount);
int fwtm_menu_restore(void *field,const FweMount *mount);

void FollowingSurfEntryStep(void *model,unsigned code);
int FollowingSurfEntryDone(void *model);
void FollowingSurfExitStep(void *model,unsigned code);
int FollowingSurfExitDone(void *model);
#endif
