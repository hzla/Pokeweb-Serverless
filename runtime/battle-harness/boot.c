#include <stdint.h>
#include <stddef.h>
#define CALL(address,type) ((type)(uintptr_t)(address))
#define API __attribute__((visibility("default")))
typedef struct {
 uint32_t magic;
 uint16_t version, trainer;
 uint32_t rule, marker;
} HarnessConfig;
API const volatile HarnessConfig BattleHarnessConfig={0x32484250,5,TRAINER_ID,BATTLE_RULE,0x57483242};
/* Bit zero is the boot latch; bit one arms only the first battle opening. */
static unsigned launched;
typedef struct {
 uint32_t background, terrain;
 uint8_t weather, season;
 uint16_t zone;
 uint8_t hour, minute;
 uint16_t padding;
} Situation;
/* The first 44 bytes match native battle-event work, including its return
 * procedure parameter (game data, battle setup). The final pointer is ours. */
typedef struct {
 void *game, *data, *battle, *returnData, *returnBattle;
 uint32_t subEvent, noLose, examination, keepBattle, lost, flags;
 void *init;
} BootWork;
_Static_assert(sizeof(Situation)==16 && sizeof(BootWork)==48 && offsetof(BootWork,returnData)==12 && offsetof(BootWork,init)==44,"native battle ABI");
static void *fieldStart(void *game,void *init) {
 CALL(0x0203ce39,void(*)(unsigned))(35);
 return CALL(0x0217c981,void*(*)(void*,void*))(game,init);
}
/* Native trainer music, without loading the encounter-effect overlay. */
static const uint16_t trainerMusic[14]={1132,1135,1145,1262,1130,1258,1137,1257,1260,1259,1267,1261,1258,1133};
API int BattleHarnessEvent(void *event,int *sequence,BootWork *work) {
 switch(*sequence) {
 case 0: {
  Situation situation;
  uint32_t time[3];
  CALL(0x02017df1,void(*)(Situation*))(&situation);
  situation.padding=0;
  situation.season=CALL(0x020173ad,unsigned(*)(void*))(work->data);
  situation.zone=CALL(0x02017545,unsigned(*)(void*))(
   CALL(0x020171f5,void*(*)(void*))(work->data));
  unsigned cls=CALL(0x0203050d,unsigned(*)(unsigned,unsigned))(BattleHarnessConfig.trainer,1);
  situation.background=CALL(0x02030829,unsigned(*)(unsigned,unsigned))(cls,
   CALL(0x02018d69,unsigned(*)(unsigned))(situation.zone));
  CALL(0x02044265,void(*)(uint32_t*))(time);
  situation.hour=time[0]; situation.minute=time[1];
  work->battle=CALL(0x02017c61,void*(*)(unsigned))(4);
  uintptr_t setup=0x0201828d+0x34*BattleHarnessConfig.rule;
  CALL(setup,void(*)(void*,void*,Situation*,unsigned,unsigned))
   (work->battle,work->data,&situation,BattleHarnessConfig.trainer,4);
  CALL(0x020185d1,void(*)(void*,void*,unsigned))(work->battle,work->data,situation.zone);
  unsigned group=CALL(0x020307f1,unsigned(*)(unsigned))(cls);
  uint16_t music=group<14?trainerMusic[group]:1130;
  *(uint16_t*)((uint8_t*)work->battle+0x18)=music;
  CALL(0x02019371,void(*)(void*,unsigned))(
   CALL(0x020175b5,void*(*)(void*))(work->data),1);
  CALL(0x02034ee9,void(*)(void*))(
   CALL(0x0201798d,void*(*)(void*))(work->data));
  CALL(0x02016d69,void(*)(void*,void*))(event,
   CALL(0x0202fe7d,void*(*)(void*,unsigned))(work->game,music));
  break;
 }
 case 1:
  /* Field startup normally enables both LCD engines. Battle initialization
   * configures their layers but preserves the sub-screen display-off bit. */
  CALL(0x02046e0d,void(*)(void))();
  launched|=2;
  CALL(0x02016e39,void(*)(void*,unsigned,void*,void*))
   (event,167,(void*)0x021d6d20,work->battle);
  break;
 case 2:
  work->returnData=work->data; work->returnBattle=work->battle;
  CALL(0x02016e39,void(*)(void*,unsigned,void*,void*))
   (event,166,(void*)0x0219d6e0,&work->returnData);
  break;
 case 3:
  CALL(0x02019371,void(*)(void*,unsigned))(
   CALL(0x020175b5,void*(*)(void*))(work->data),0);
  CALL(0x02034f41,void(*)(void*))(
   CALL(0x0201798d,void*(*)(void*))(work->data));
  CALL(0x02169129,void(*)(BootWork*,void*))(work,work->data);
  work->lost=CALL(0x02169115,unsigned(*)(BootWork*))(work);
  CALL(0x02017c85,void(*)(void*))(work->battle);
  work->battle=0;
  CALL(0x02016d69,void(*)(void*,void*))(event,
   CALL(0x0202feb1,void*(*)(void*))(work->game));
  break;
 case 4:
  /* Native blackout recovery must start with the field still closed. */
  CALL(0x02016d51,void(*)(void*,void*))(event,work->lost?
   CALL(0x0215a191,void*(*)(void*))(work->game):fieldStart(work->game,work->init));
  return 0;
 default: return 1;
 }
 ++*sequence;
 return 0;
}
/* Native short helpers take (screen, sequence), unlike procedure callbacks. */
API int BattleHarnessPlace(int *sequence,void *screen) {
 unsigned rule=BattleHarnessConfig.rule;
 uintptr_t fast=0x021d1415+0x10*(rule>1?2:rule);
 return CALL(fast,int(*)(void*,int*))(screen,sequence);
}
/* Keep native screen setup, then select its direct placement presentation.
 * The normal (non-chapter) mode supplies the short fade and waits for models.
 * No trainer sprites, introduction messages, or ball effects are created. */
API void BattleHarnessOpening(void *screen,unsigned shortMode) {
 CALL(0x021d10c5,void(*)(void*,unsigned))(screen,shortMode);
 if(!(launched&2))return;
 launched&=~2u;
 *(void**)((uint8_t*)screen+0xe4)=BattleHarnessPlace;
}
/* Save/game initialization precedes this hook. Field initialization does not. */
API void *BattleHarnessStart(void *game,void *init) {
 if(!BattleHarnessConfig.trainer||launched||!init||*(unsigned*)init!=1)
  return fieldStart(game,init);
 launched=1;
 void *event=CALL(0x02016cb5,void*(*)(void*,void*,void*,unsigned))
  (game,0,BattleHarnessEvent,sizeof(BootWork));
 BootWork *work=CALL(0x02016edd,void*(*)(void*))(event);
 work->game=game;
 work->data=CALL(0x02016ad9,void*(*)(void*))(game);
 work->init=init;
 return event;
}
