#include "native.h"
#include "battle-entry.h"
#define API __attribute__((visibility("default")))
/* Overlay 167 owns both procedure literals. No imports, heap buffers, or
 * retained field pointers: the normal battle setup carries one transient bit. */
static void *setup_for(void *work){return PTR(PTR(work,0x134),0);}
static void *player_data(void *work,unsigned *position){
 *position=CALL(0x0219c785,unsigned(*)(void*,unsigned))(PTR(work,0x134),0);
 return CALL(0x0219d1c9,void*(*)(void*,unsigned))(PTR(work,0x138),*position);
}
static void show_status(void *work,unsigned position){
 CALL(0x021d39cd,void(*)(void*))((uint8_t*)work+0x48+12*position);
}
static int opening(int *seq,void *work,int trainer){
 void *setup=setup_for(work);
 int (*native)(int*,void*)=trainer?CALL(0x021d1639,int(*)(int*,void*)):CALL(0x021d1445,int(*)(int*,void*));
 if(!fwb_local_single(setup)||!(U32(setup,FWB_STATUS)&FWB_PRESENT)||*((uint8_t*)work+0x150))return native(seq,work);
 if(*seq==0){
  unsigned position;void *data=player_data(work,&position);
  /* The field handshake admits slot zero only. Confirm the native opening
   * battler is still that slot before altering the presentation. */
  if(!data||CALL(0x021bac81,unsigned(*)(void*))(data)!=0){
   U32(setup,FWB_STATUS)&=~FWB_PRESENT;return native(seq,work);
  }
  void *mon=CALL(0x021bb0a5,void*(*)(void*))(data);
  CALL(0x021df85d,void(*)(void*,unsigned))(mon,0);
 }
 /* The preceding native states have finished the opponent's message and
  * started hiding its window. Skip only the player's gauge/throw/Go stages. */
 if(*seq==(trainer?6:5)){
  if(!CALL(0x021d37d9,int(*)(void*))((uint8_t*)work+0x154)
     ||CALL(0x021df829,int(*)(void))())return 0;
  if(trainer)show_status(work,*((uint8_t*)work+0xf4));
  unsigned position;void *data=player_data(work,&position);
  PTR(work,0xf0)=data;*((uint8_t*)work+0xf4)=(uint8_t)position;
  *((uint8_t*)work+0xf5)=0;*((uint8_t*)work+0xf6)=0;
  /* Neither skipped sequence runs, so no trainer sprite or ball is created.
   * Restore the ordinary battle camera, then let the native final state show
   * the player HP bar and finish the opening procedure. */
  CALL(0x021df309,void(*)(unsigned))(566);
  *seq=trainer?11:9;
  return 0;
 }
 int result=native(seq,work);
 if(result)U32(setup,FWB_STATUS)&=~FWB_PRESENT;
 return result;
}
API int FollowingBattleWild(int *seq,void *work){return opening(seq,work,0);}
API int FollowingBattleTrainer(int *seq,void *work){return opening(seq,work,1);}
