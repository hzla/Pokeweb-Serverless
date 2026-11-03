#include <stdint.h>
#ifdef MOVE_HISTORY
#include "history.h"
#endif
typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef int32_t s32;
void*memcpy(void*dst,const void*src,unsigned length){volatile u8*p=dst;const volatile u8*q=src;for(u32 n=0;n<length;++n)p[n]=q[n];return dst;}
void*memset(void*dst,int value,unsigned length){volatile u8*p=dst;for(u32 n=0;n<length;++n)p[n]=(u8)value;return dst;}
#define PUBLIC __attribute__((visibility("default")))
typedef void (*Callback)(void*,void*,u8,u32*);
typedef struct { u32 event; Callback callback; } Event;
#ifdef MOVE_MODERN_KNOCK
PUBLIC const volatile u32 MoveRuleApi[66]={0};
/* Per active user, cleared at action boundaries; independent of installed definitions. */
static u32 knockArmed[24];
#else
PUBLIC const volatile u32 MoveRuleApi[64]={0};
#endif
PUBLIC const volatile u32 MoveNativeGetters[20]={0};
PUBLIC const volatile u16 MoveNativeIds[20]={0};
PUBLIC const volatile u8 *MoveRuleData=(const volatile u8*)1;
PUBLIC const volatile u32 MoveItemMessageBase=0;
PUBLIC const volatile u32 MoveSwapMessageBase=0;
PUBLIC const volatile u32 MoveTypeLossMessageBase=0;
#define FN(i,t) ((t)(uintptr_t)MoveRuleApi[i])
#define GET(k) FN(0,u32(*)(u32))(k)
#define TRY(k,p) FN(1,u32(*)(u32,s32*))(k,p)
#define SET(k,v) FN(2,u32(*)(u32,u32))(k,v)
#define MUL(k,v) FN(3,void(*)(u32,u32))(k,v)
#define MON(f,id) FN(4,void*(*)(void*,u8))(f,id)
#define STAT(m,k) FN(5,u32(*)(void*,u32))(m,k)
#define PUSH(f,k,o) FN(10,u8*(*)(void*,u32,u8))(f,k,o)
#define POP(f,p) FN(11,void(*)(void*,void*))(f,p)
static u16 half(const volatile u8*p){return p[0]|p[1]<<8;}
static u32 word(const volatile u8*p){return half(p)|(u32)half(p+2)<<16;}
static void put16(u8*p,u32 v){p[0]=v;p[1]=v>>8;}
static void put32(u8*p,u32 v){put16(p,v);put16(p+2,v>>16);}
static u32 divide(u32 n,u32 d){u32 q=0,r=0;if(!d)return 0;if(d==1)return n;if(d==2)return n>>1;if(d==4)return n>>2;if(d==16)return n>>4;for(int i=31;i>=0;--i){r=(r<<1)|((n>>i)&1);if(r>=d){r-=d;q|=1u<<i;}}return q;}
static const volatile u8*entry(u32 id){
 u32 lo=0,hi=half(MoveRuleData);
 while(lo<hi){u32 mid=(lo+hi)>>1;const volatile u8*p=MoveRuleData+4+mid*16;u32 v=half(p);if(v<id)lo=mid+1;else hi=mid;}
 const volatile u8*p=MoveRuleData+4+lo*16;return lo<half(MoveRuleData)&&half(p)==id?p:0;
}
typedef struct {void*flow;u8 owner,target;u16 move;u32 weather,active,groundKnown,grounded,hiddenKnown,hidden;u8 weatherValid,activeValid,itemRequired,event;} Evaluation;
#ifdef MOVE_HISTORY
#ifdef MOVE_PERSISTENT
PUBLIC const volatile u32 MoveHistoryApi[14]={0};
#else
PUBLIC const volatile u32 MoveHistoryApi[8]={0};
#endif
PUBLIC const volatile u32 MoveHistoryCount=0;
PUBLIC const volatile Event *MoveHistoryEvents=(const Event*)1;
static MoveHistory moveHistory;
#ifdef MOVE_PERSISTENT
/* Per-battler until the next action: 0 means inactive, otherwise fixed-point ratio. */
static u16 moveVulnerability[24];
static u32 moveVulnerabilityAccuracy,moveSelfTrapUsed;
typedef struct { const volatile u8 *effect; u8 target,source,remaining,kind; u16 move; } MoveResidual;
static MoveResidual moveResidual[48];
static u8 moveFieldTypes[18],moveTargetTypes[24],movePowderType[24],movePowderDenominator[24];
static u16 moveBlockedFlags[24];static u8 moveBlockedTurns[24][16],moveFocusTurns[24],moveCritBoost[24],moveCritPending[24],moveSpotlightTarget,moveFieldLockTurns;
typedef struct {u8 active,stat;int8_t amount;u8 unused;} MoveWeb;
static MoveWeb moveWeb[2];
PUBLIC const volatile u32 MoveNativeSideState=0;
PUBLIC const volatile u32 MoveSpotlightCount=0;
PUBLIC const volatile Event *MoveSpotlightEvents=(const Event*)1;

PUBLIC const volatile u32 MovePowderCoverBase=0,MovePowderDamageBase=0,MoveFocusMessageBase=0,MoveSpotlightMessageBase=0,MoveFieldLockMessageBase=0;
PUBLIC const volatile u32 MoveWebStartBase=0,MoveWebHitBase=0,MoveWebEndBase=0,MoveCourtChangeBase=0;
#endif
#define HF(i,t) ((t)(uintptr_t)MoveHistoryApi[i])
#ifdef MOVE_PERSISTENT
static u32 blockedMove(u32 id,u32 move){if(id>=24)return 0;u32 mask=moveBlockedFlags[id];for(u32 flag=0;mask&&flag<16;++flag)if(mask&(1u<<flag)){if(HF(8,u32(*)(u32,u32))(move,flag))return 1;mask&=~(1u<<flag);}return 0;}
#endif
#endif
/* Deliberately evaluation-local: no cross-action cache can outlive a weather change.
 * These callbacks never subscribe to the native weather-query event. */
static u32 weather(Evaluation*x){if(!x->weatherValid){x->weather=FN(8,u32(*)(void*))(x->flow);x->weatherValid=1;}return x->weather;}
static u32 alive(void*f,u8 id){return id<24&&FN(18,u32(*)(void*,u8))(f,id)&&STAT(MON(f,id),13);}
static u32 type(void*m,u32 t){return FN(7,u32(*)(u32,u32))(FN(6,u32(*)(void*))(m),t);}
static u32 effectiveAbility(void*m){return STAT(m,17);}
static u32 pendingPriority(Evaluation*x,u8 target,s32 wanted){
 /* Read-only native action data. No scheduling or priority calculation is changed. */
 u8*f=x->flow;u32 count=f[0x782];if(count>6)return 0;
 for(u32 i=0;i<count;++i){u8*p=f+0x7e0+i*16;void*m=(void*)(uintptr_t)word(p);
  if(m&&FN(19,u32(*)(void*))(m)==target&&!p[13]&&(word(p+4)&15)==1){u32 move=(word(p+4)>>7)&65535;return FN(21,u32(*)(u32))(move)!=0&&((s32)((word(p+8)>>16)&63)-7)==wanted;}
 }return 0;
}
static u32 condition(const volatile u8**cursor,Evaluation*x,u32 evaluate){
 const volatile u8*p=*cursor;*cursor=p+8;u32 op=p[0],v=half(p+4),result=0;
 if(op>=128){result=op==128;for(u32 n=0;n<p[1];++n){u32 run=evaluate&&(op==128?result:!result),c=condition(cursor,x,run);if(run)result=op==128?result&&c:result||c;}return evaluate&&result;}
 if(!evaluate)return 0;
 u8 id=p[1]?x->target:x->owner;void*m=0;
 if(op==1||op==2||op==4||op==5||op==6||op==9||op==10||op==11||op>=15&&op<=18){m=id<24?MON(x->flow,id):0;if(!m)return 0;}
 if(op==1){u32 hp=STAT(m,13)*100,max=STAT(m,14)*v;result=p[2]==0?hp<max:p[2]==1?hp<=max:p[2]==2?hp>max:hp>=max;return result;}
 if(op==2)result=type(m,v);
 if(op==3)result=weather(x)==v;
 if(op==4)result=FN(20,u32(*)(void*))(m)==v;
 if(op==5){if(v)result=FN(17,u32(*)(void*,u32))(m,v);else{result=1;for(u32 n=1;n<=5;++n)if(FN(17,u32(*)(void*,u32))(m,n))result=0;}}
 if(op==6)result=effectiveAbility(m)==v;
 if(op==7)result=FN(25,u32(*)(u32))(v);
 if(op==8){s32 value;result=TRY(0x38,&value)&&value==(s32)v;}
 if(op==9)result=(FN(22,u32(*)(void*,u32))(m,1)!=0)==(v!=0);
 if(op==10)result=(half((u8*)m+0x146)==0)==(v!=0);
 if(op==11){u32 bit=1u<<id;if(!(x->groundKnown&bit)){if(!FN(26,u32(*)(void*,void*,u32))(x->flow,m,1))x->grounded|=bit;x->groundKnown|=bit;}result=((x->grounded&bit)!=0)==(v!=0);}
 if(op==12)result=(FN(16,u32(*)(u8,u8))(x->owner,id)!=0)==(v!=0);
 if(op==13)result=pendingPriority(x,id,(int16_t)v);
 if(op==14)result=(id==x->owner)==(v!=0);
 if(op==15){u32 stage=STAT(m,p[3]);return p[2]==0?stage<v:p[2]==1?stage<=v:p[2]==2?stage>v:stage>=v;}
 if(op==16)result=FN(38,u32(*)(void*))(m)==v;
 if(op==17)result=(FN(38,u32(*)(void*))(m)!=0)==(v!=0);
 if(op==18)result=(FN(39,u32(*)(u32))(FN(38,u32(*)(void*))(m))!=0)==(v!=0);
 if(op==19){
  u32 bit=1u<<id;if(!(x->hiddenKnown&bit)){void*mon=MON(x->flow,id);u32 hidden=FN(17,u32(*)(void*,u32))(mon,33);for(u32 flag=3;flag<=6&&!hidden;++flag)hidden=FN(55,u32(*)(void*,u32))(mon,flag);if(hidden)x->hidden|=bit;x->hiddenKnown|=bit;}
  result=((x->hidden&bit)!=0)==(v!=0);
 }
#ifdef MOVE_HISTORY
 if(op==20)result=((moveHistory.ate_berry&move_history_mask(id))!=0)==(v!=0);
 if(op==21)result=((moveHistory.failed_last_turn&move_history_mask(id))!=0)==(v!=0);
 if(op==22)result=id<24&&moveHistory.hits[id]>=v;
 if(op==23)result=id<24&&moveHistory.faints[divide(id,6)]>=v;
 if(op==24)result=(((x->event==0x4b?moveHistory.raised_snapshot:moveHistory.raised)&move_history_mask(id))!=0)==(v!=0);
 if(op==25)result=((moveHistory.lowered&move_history_mask(id))!=0)==(v!=0);
 if(op==26)result=id<24&&moveHistory.selected_last_turn[id]&&(v?moveHistory.selected_last_turn[id]==v:moveHistory.selected_last_turn[id]==x->move);
#ifdef MOVE_PERSISTENT
 if(op==28){u32 a=FN(42,u32(*)(void*,u8))(x->flow,x->owner),b=FN(42,u32(*)(void*,u8))(x->flow,id);result=(a<6&&b<6&&(a>b?a-b:b-a)<=2)==(v!=0);}
 if(op==27){u32 wanted=v?v:x->move;for(u32 i=0;i<48;++i)if(moveResidual[i].effect&&moveResidual[i].target==id&&moveResidual[i].move==wanted){result=1;break;}}
#endif
#endif
 return p[2]?!result:result;
}
static u32 match(const volatile u8*p,Evaluation*x,u32 count){
 /* Configuration v2 omits empty groups; v1 callers always have a root node. */
 return !count||condition(&p,x,1);
}
static u32 preview(void*f){return FN(9,u32(*)(void*))(f)||FN(27,u32(*)(void*))(f);}
#ifdef MOVE_HISTORY
PUBLIC void MoveHistoryInit(void){
 HF(0,void(*)(void))();move_history_reset(&moveHistory);
#ifdef MOVE_PERSISTENT
 memset(moveVulnerability,0,sizeof(moveVulnerability));moveVulnerabilityAccuracy=0;moveSelfTrapUsed=0;memset(moveResidual,0,sizeof(moveResidual));memset(moveFieldTypes,0,sizeof(moveFieldTypes));memset(moveTargetTypes,0,sizeof(moveTargetTypes));memset(movePowderType,0,sizeof(movePowderType));memset(movePowderDenominator,0,sizeof(movePowderDenominator));memset(moveBlockedFlags,0,sizeof(moveBlockedFlags));memset(moveBlockedTurns,0,sizeof(moveBlockedTurns));memset(moveFocusTurns,0,sizeof(moveFocusTurns));memset(moveCritBoost,0,sizeof(moveCritBoost));memset(moveCritPending,0,sizeof(moveCritPending));memset(moveWeb,0,sizeof(moveWeb));moveSpotlightTarget=255;moveFieldLockTurns=0;
#endif
 if(MoveHistoryCount)HF(1,void*(*)(u32,u32,u32,u32,u32,const Event*,u32))(3,65534,7,0,31,(const Event*)(uintptr_t)MoveHistoryEvents,MoveHistoryCount);
#ifdef MOVE_PERSISTENT
 if(MoveSpotlightCount)HF(1,void*(*)(u32,u32,u32,u32,u32,const Event*,u32))(3,65533,0,0,31,(const Event*)(uintptr_t)MoveSpotlightEvents,MoveSpotlightCount);
#endif
}
#ifdef MOVE_PERSISTENT
static u32 statWork(void*f,u8 owner,const volatile u8*e,const u8*targets,u32 count);
static u32 removeWeb(void*f,u8 owner,u32 side){
 if(side>=2||!moveWeb[side].active)return 0;moveWeb[side].active=0;
 u8*p=PUSH(f,4,owner);if(p){FN(56,void(*)(void*,u32,u32))(p+4,2,MoveWebEndBase+side);POP(f,p);}return 1;
}
static u32 addResidual(void*f,const volatile u8*e,u8 source,u8 target,u16 move){
 MoveResidual*free=0;for(u32 i=0;i<48;++i){MoveResidual*r=moveResidual+i;if(r->effect==e&&r->target==target&&r->move==move){free=r;break;}if(!r->effect&&!free)free=r;}
 if(!free){u8*p=PUSH(f,4,source);if(p){FN(56,void(*)(void*,u32,u32))(p+4,2,24);FN(57,void(*)(void*,u32))(p+4,target);POP(f,p);}return 0;}free->effect=e;free->target=target;free->source=source;free->kind=e[0];free->move=move;free->remaining=(u8)half(e+(e[0]==45?14:10));return 1;
}
#endif
static void historyObserve(void*f,u32 event){
 u32 id;
#ifdef MOVE_PERSISTENT
 if(event==0x28){s32 slot=0,t=0;if(TRY(2,&slot)&&slot>=0&&slot<24&&TRY(0x16,&t)&&t>=0&&t<18){u32 replacement=moveTargetTypes[slot]?moveTargetTypes[slot]:moveFieldTypes[t];if(replacement)SET(0x16,replacement-1);}return;}
 if(event==0x1c||event==0x47){id=GET(4);if(id<24&&moveVulnerability[id]){if(event==0x1c&&(moveVulnerabilityAccuracy&move_history_mask(id)))SET(0x51,1);if(event==0x47)MUL(0x35,moveVulnerability[id]);}return;}
#endif
 if(preview(f))return;
#ifdef MOVE_PERSISTENT
 if(event==0x0c){id=GET(2);void*m=id<24?MON(f,(u8)id):0;if(moveFieldLockTurns&&m&&!type(m,7))SET(0x41,1);return;}
 if(event==0x55){id=GET(2);if(id<24){moveCritPending[id]=0;if(moveWeb[0].active||moveWeb[1].active){u32 side=FN(41,u32(*)(u8))((u8)id);void*m=MON(f,(u8)id);if(side<2&&moveWeb[side].active&&m&&!FN(26,u32(*)(void*,void*,u32))(f,m,1)){
   u8*p=PUSH(f,4,(u8)id);if(p){FN(56,void(*)(void*,u32,u32))(p+4,2,MoveWebHitBase);FN(57,void(*)(void*,u32))(p+4,id);POP(f,p);}
   u8 row[32]={0},target=(u8)id,source=target;for(u8 candidate=0;candidate<24;++candidate)if(alive(f,candidate)&&!FN(16,u32(*)(u8,u8))(target,candidate)){source=candidate;break;}
   row[1]=6;put16(row+6,(u16)moveWeb[side].amount);put16(row+8,moveWeb[side].stat);statWork(f,source,row,&target,1);
  }}}}
 if(event==0xa0){u32 move=GET(0x12);if(move==244){u32 actor=GET(3),target=GET(6);if(actor<24&&target<24)moveCritBoost[actor]=moveCritBoost[target]&&FN(55,u32(*)(void*,u32))(MON(f,(u8)target),9)?moveCritBoost[target]:0;}return;}
 if(event==0x76){moveSpotlightTarget=255;return;}
 if(event==4){id=GET(2);if(id<24)moveTargetTypes[id]=0;}
 if(event==0x78&&GET(2)==31){if(moveFieldLockTurns)--moveFieldLockTurns;for(u32 p=0;p<24;++p)if(moveFocusTurns[p])--moveFocusTurns[p];memset(moveFieldTypes,0,sizeof(moveFieldTypes));memset(moveTargetTypes,0,sizeof(moveTargetTypes));memset(movePowderType,0,sizeof(movePowderType));for(u32 p=0;p<24;++p)if(moveBlockedFlags[p])for(u32 q=0;q<16;++q)if(moveBlockedTurns[p][q]&&!--moveBlockedTurns[p][q])moveBlockedFlags[p]&=~(1u<<q);}
 if(event==1||event==0x54||event==0xa3){id=GET(2);if(id<24){if(event!=1){if(moveSpotlightTarget==id)moveSpotlightTarget=255;moveTargetTypes[id]=0;movePowderType[id]=0;moveFocusTurns[id]=0;if(event==0x54)moveCritPending[id]=moveCritBoost[id];moveCritBoost[id]=0;moveBlockedFlags[id]=0;memset(moveBlockedTurns[id],0,sizeof(moveBlockedTurns[id]));moveSelfTrapUsed&=~move_history_mask(id);}moveVulnerability[id]=0;moveVulnerabilityAccuracy&=~move_history_mask(id);if(event!=1)for(u32 i=0;i<48;++i){MoveResidual*r=moveResidual+i;if(r->effect&&(r->target==id||r->source==id&&r->kind==46&&half(r->effect+12)))r->effect=0;}}if(event==1)return;}
 if(event==0x77){id=GET(2);if(id>=24)return;for(u32 i=0;i<48;++i){MoveResidual*r=moveResidual+i;const volatile u8*e=r->effect;if(!e||r->target!=id||!alive(f,id))continue;
  if(r->kind==45){void*m=MON(f,id);u32 denom=half(e+6),alt=half(e+8),t1=half(e+10),t2=half(e+12);if(alt&&(t1<18&&type(m,t1)||t2<18&&type(m,t2)))denom=alt;u32 amount=divide(STAT(m,14),denom);if(!amount)amount=1;if(amount>65535)amount=65535;u8*p=PUSH(f,7,id);if(p){put16(p+4,amount);p[6]=id;POP(f,p);}}
  if(r->kind==46&&(!half(e+12)||alive(f,r->source))){u8 target=(u8)id,source=alive(f,r->source)?r->source:(u8)id;statWork(f,source,e,&target,1);}
  if(r->remaining&&!--r->remaining)r->effect=0;
 }return;}
#endif
 if(event==3){
  id=GET(3);if(id>=24)return;
  if(!moveHistory.sequence_depth[id]){moveHistory.selected_this_turn[id]=(u16)GET(0x12);moveHistory.raised_snapshot=0;moveHistory.protected_move&=~move_history_mask(id);}
  if(moveHistory.sequence_depth[id]<255)++moveHistory.sequence_depth[id];return;
 }
 if(event==4){
  id=GET(2);if(id>=24)return;
  if(moveHistory.sequence_depth[id])--moveHistory.sequence_depth[id];
  if(!moveHistory.sequence_depth[id]){u32 bit=move_history_mask(id);move_history_action(&moveHistory,id,moveHistory.selected_this_turn[id],GET(0x51)!=0,(moveHistory.protected_move&bit)!=0,0);moveHistory.protected_move&=~bit;}
  return;
 }
 if(event==0x2c){s32 ptr=0;if(TRY(0x3f,&ptr)&&ptr){u32 msg=half((u8*)(uintptr_t)ptr);if(msg==797||msg==800)moveHistory.protected_move|=move_history_mask(GET(3));}return;}
 if(event==0x5d){move_history_stage(&moveHistory,GET(2),(s32)GET(0x20),1,0);return;}
 if(event==0x46){id=GET(4);u32 bit=move_history_mask(id);moveHistory.raised_snapshot=(moveHistory.raised_snapshot&~bit)|(moveHistory.raised&bit);return;}
 if(event==0x4b){move_history_hit(&moveHistory,GET(3),GET(4),GET(0x32),GET(0x46)!=0,0);return;}
 if(event==0x78){if(GET(2)==31)move_history_next_turn(&moveHistory,0);return;}
 if(event==0x55){id=GET(2);void*m=id<24?MON(f,id):0;if(m&&STAT(m,13))moveHistory.faint_seen&=~move_history_mask(id);return;}
 if(event==0x54||event==0xa3){
  id=GET(2);u32 bit=move_history_mask(id);void*m=bit?MON(f,id):0;
  if(event==0xa3&&m&&!STAT(m,13)&&!(moveHistory.faint_seen&bit)){moveHistory.faint_seen|=bit;move_history_faint(&moveHistory,divide(id,6),1,0);}
  move_history_leave(&moveHistory,id,0);
 }
}
#ifdef MOVE_PERSISTENT
PUBLIC void MoveSpotlightRedirect(void*item,void*f,u8 owner,u32*work){
 (void)item;(void)owner;(void)work;u32 target=moveSpotlightTarget;if(target>=24||!alive(f,(u8)target))return;
 u32 attacker=GET(3),move=GET(0x12);if(attacker>=24||attacker==target||FN(16,u32(*)(u8,u8))(attacker,target)||move==507||FN(17,u32(*)(void*,u32))(MON(f,(u8)target),33))return;
 u32 a=FN(42,u32(*)(void*,u8))(f,(u8)attacker),b=FN(42,u32(*)(void*,u8))(f,(u8)target);if(a>=6||b>=6)return;
 u32 count=0;for(u8 id=0;id<24;++id)if(alive(f,id))++count;
 if(count>4&&!HF(8,u32(*)(u32,u32))(move,11)&&((a==0&&b==1)||(a==1&&b==0)||(a==4&&b==5)||(a==5&&b==4)))return;
 FN(28,void(*)(u32,u32))(4,target);
}
PUBLIC u32 MoveCriticalRank(void*mon){u32 native=HF(10,u32(*)(void*))(mon),id=FN(19,u32(*)(void*))(mon);if(id>=24||!moveCritBoost[id]||!FN(55,u32(*)(void*,u32))(mon,9))return native;u32 rank=(u8)(((u8*)mon)[0x142]+moveCritBoost[id]);return rank>4?4:rank;}
PUBLIC u32 MoveFieldSwitchCheck(void*mon,u32 condition){return (moveFieldLockTurns&&mon&&!type(mon,7))||FN(17,u32(*)(void*,u32))(mon,condition);}
PUBLIC void MoveRapidSpin(void*item,void*f,u8 owner,u32*w){
 HF(12,Callback)(item,f,owner,w);if(!preview(f)&&GET(3)==owner)removeWeb(f,owner,FN(41,u32(*)(u8))(owner));
}
PUBLIC void MoveDefog(void*item,void*f,u8 owner,u32*w){
 HF(13,Callback)(item,f,owner,w);if(!preview(f)&&GET(3)==owner){u32 target=GET(6);if(target<24)removeWeb(f,owner,FN(41,u32(*)(u8))((u8)target));}
}
static u32 exchangeSides(void){
 static const u8 effects[]={0,1,2,3,4,5,6,7,8,11,12,13};
 u8*slots=(u8*)(uintptr_t)MoveNativeSideState;if(!slots)return 0;u32 changed=moveWeb[0].active||moveWeb[1].active;
 /* Unknown custom side factors cannot be exchanged safely. */
 for(u32 side=0;side<2;++side){u8*p=FN(53,u8*(*)(u32,u8))(2,(u8)side);u32 count=0;for(;p&&count<256;++count,p=(u8*)(uintptr_t)word(p+4))if(word(p+16)==2&&p[0x3a]==side&&!(word(p+24)&(1u<<27))&&half(p+0x38)>=14)return 0;if(p)return 0;}
 for(u32 n=0;n<sizeof(effects);++n)for(u32 side=0;side<2;++side){u8*slot=slots+(side*14+effects[n])*16;u32 ptr=word(slot);if(!ptr)continue;
  if(ptr<0x02000000||ptr>0x023fffc4)return 0;u8*factor=(u8*)(uintptr_t)ptr;
  if(word(factor+16)!=2||half(factor+0x38)!=effects[n]||factor[0x3a]!=side||(word(factor+24)&((1u<<24)|(1u<<27))))return 0;changed=1;
 }
 if(!changed)return 0;
 /* The native side table is in VRAM; ARM9 byte stores there are ignored. */
 for(u32 n=0;n<sizeof(effects);++n){volatile u32*a=(volatile u32*)(slots+effects[n]*16),*b=(volatile u32*)(slots+(14+effects[n])*16);for(u32 k=0;k<4;++k){u32 tmp=a[k];a[k]=b[k];b[k]=tmp;}if(a[0])((u8*)(uintptr_t)a[0])[0x3a]=0;if(b[0])((u8*)(uintptr_t)b[0])[0x3a]=1;}
 MoveWeb web=moveWeb[0];moveWeb[0]=moveWeb[1];moveWeb[1]=web;return 1;
}
/* Baton Pass copies the native Focus Energy condition; carry its recipe rank too. */
PUBLIC void MovePassEffects(void*dest,void*source){
 u32 a=FN(19,u32(*)(void*))(dest),b=FN(19,u32(*)(void*))(source),boost=0;
 if(b<24&&FN(55,u32(*)(void*,u32))(source,9))boost=moveCritBoost[b]?moveCritBoost[b]:moveCritPending[b];
 HF(11,void(*)(void*,void*))(dest,source);
 if(a<24)moveCritBoost[a]=(u8)boost;
}
PUBLIC u32 MoveFocusedCritical(u32 rank){s32 id=-1;if(TRY(3,&id)&&id>=0&&id<24&&moveFocusTurns[id])return 1;return HF(9,u32(*)(u32))(rank);}
PUBLIC void MovePersistentEvent_1f(void*item,void*f,u8 owner,u32*work){
 (void)item;(void)owner;if(preview(f))return;u32 id=GET(2);if(id>=24)return;
 u32 move=GET(0x12);if(blockedMove(id,move)){u32 failed=SET(0x22,0x19);if(work)work[0]=failed;SET(0x41,1);u8*p=PUSH(f,4,(u8)id);if(p){FN(56,void(*)(void*,u32,u32))(p+4,2,905);FN(57,void(*)(void*,u32))(p+4,id);FN(57,void(*)(void*,u32))(p+4,move);POP(f,p);}return;}
 if(!movePowderType[id])return;
 void*m=MON(f,(u8)id);if(!m)return;u8 param[24]={0};FN(63,void(*)(void*,u16,void*,u8*))(f,(u16)GET(0x12),m,param);if(param[6]+1!=movePowderType[id])return;
 u32 failed=SET(0x22,0x19);if(work)work[0]=failed;SET(0x41,1);movePowderType[id]=0;
 u32 damage=divide(STAT(m,14),movePowderDenominator[id]);if(!damage)damage=1;if(damage>65535)damage=65535;
 u8*p=PUSH(f,7,(u8)id);if(p){put16(p+4,damage);p[6]=(u8)id;FN(56,void(*)(void*,u32,u32))(p+12,2,MovePowderDamageBase);FN(57,void(*)(void*,u32))(p+12,id);POP(f,p);}
}
#endif
#define HISTORY_EVENT(n) PUBLIC void MoveHistoryEvent_##n(void*i,void*f,u8 o,u32*w){(void)i;(void)o;(void)w;historyObserve(f,0x##n);}
#ifdef MOVE_PERSISTENT
HISTORY_EVENT(01) HISTORY_EVENT(0c) HISTORY_EVENT(1c) HISTORY_EVENT(28) HISTORY_EVENT(47) HISTORY_EVENT(76) HISTORY_EVENT(77) HISTORY_EVENT(a0)
#endif
HISTORY_EVENT(03) HISTORY_EVENT(04) HISTORY_EVENT(2c) HISTORY_EVENT(46) HISTORY_EVENT(4b)
HISTORY_EVENT(54) HISTORY_EVENT(55) HISTORY_EVENT(5d) HISTORY_EVENT(78) HISTORY_EVENT(a3)
PUBLIC void MoveHistoryChangeItem(void*f,void*m,u16 item,u32 consume){
 u32 old=FN(38,u32(*)(void*))(m),id=FN(19,u32(*)(void*))(m);
 HF(2,void(*)(void*,void*,u16,u32))(f,m,item,consume);
 move_history_berry(&moveHistory,id,consume==1&&old&&!FN(38,u32(*)(void*))(m),FN(39,u32(*)(u32))(old),preview(f));
}
PUBLIC u32 MoveHistoryForceItem(void*f,u8*param){
 u32 result=HF(3,u32(*)(void*,void*))(f,param);
 move_history_berry(&moveHistory,param[4],result,FN(39,u32(*)(u32))(half(param+6)),preview(f));return result;
}
PUBLIC u32 MoveHistoryConsumeWork(void*f,u8*param){
 u32 id=(word(param)>>8)&31,old=id<24?FN(38,u32(*)(void*))(MON(f,id)):0;
 u32 result=HF(5,u32(*)(void*,void*))(f,param);
 move_history_berry(&moveHistory,id,result&&word(param+4)==0&&old&&!FN(38,u32(*)(void*))(MON(f,id)),FN(39,u32(*)(u32))(old),preview(f));return result;
}
PUBLIC u32 MoveHistoryProtect(void*f,void*attacker,void*target,u32 move){
 u32 result=HF(4,u32(*)(void*,void*,void*,u32))(f,attacker,target,move);
 if(!result&&!preview(f))moveHistory.protected_move|=move_history_mask(FN(19,u32(*)(void*))(attacker));return result;
}
/* Transform copies the target's accumulated hit history along with its battle data. */
PUBLIC u32 MoveHistoryTransform(void*user,void*target,void*flow){
 u32 result=HF(7,u32(*)(void*,void*))(user,target);
 if(result&&!preview(flow)){u32 a=FN(19,u32(*)(void*))(user),b=FN(19,u32(*)(void*))(target);if(a<24&&b<24){moveHistory.hits[a]=moveHistory.hits[b];
#ifdef MOVE_PERSISTENT
 moveCritBoost[a]=moveCritBoost[b];if(moveCritBoost[a]&&FN(55,u32(*)(void*,u32))(target,9)){u8*p=PUSH(flow,23,(u8)a);if(p){put32(p+4,9);p[8]=(u8)a;POP(flow,p);}}
#endif
 }}
 return result;
}
/* The verified native caller keeps its server flow in r5. */
PUBLIC __attribute__((naked)) void MoveHistoryTransformHook(void){
 __asm__ volatile("push {r4,lr}\n mov r2,r5\n bl MoveHistoryTransform\n pop {r4,pc}\n");
}
PUBLIC u32 MoveHistorySelect(void*client,void*mon,u32 move,u8*message){
 u32 native=HF(6,u32(*)(void*,void*,u32,void*))(client,mon,move,message);if(native||move==165)return native;
#ifdef MOVE_PERSISTENT
 u32 blockedOwner=FN(19,u32(*)(void*))(mon);if(blockedMove(blockedOwner,move)){if(message){memset(message,0,36);put16(message,905);message[2]=0x50;message[3]=0x22;put32(message+4,blockedOwner);put32(message+8,move);}return 1;}
#endif
 const volatile u8*idx=entry(move);if(!idx)return native;
 u32 owner=FN(19,u32(*)(void*))(mon);if(owner>=24)return native;
 const volatile u8*r=MoveRuleData+word(idx+4),*global=r+8,*e=global+(r[1]+r[2])*8;
 Evaluation x={.owner=(u8)owner,.target=(u8)owner,.move=(u16)move};
 for(u32 n=0;n<r[0];++n){
  if(e[0]==43&&(!half(e+8)||moveHistory.selected_last_turn[owner]&&moveHistory.selected_move[owner]==moveHistory.selected_last_turn[owner])&&match(global,&x,r[1])&&match(e+32,&x,e[5])){
   if(message){memset(message,0,36);put16(message,905);message[2]=0x50;message[3]=0x22;put32(message+4,owner);put32(message+8,move);}
   return 1;
  }
  e+=32+e[5]*8;
 }
 return native;
}
#endif
static void nativeEvent(u32 id,u32 event,void*item,void*f,u8 owner,u32*w){
 for(u32 n=0;n<20;++n)if(MoveNativeIds[n]==id&&MoveNativeGetters[n]){u32 count=0;const Event*t=((const Event*(*)(u32*))(uintptr_t)MoveNativeGetters[n])(&count);if(count>16)return;for(u32 j=0;t&&j<count;++j)if(t[j].event==event)t[j].callback(item,f,owner,w);return;}
}
static u32 secondary(void*f,u8 owner,u8 target,u32 chance,u32 stat){
 s32 flag=0;if(target!=owner&&(TRY(0x46,&flag)&&flag||TRY(0x47,&flag)&&flag))return 0;
 if(effectiveAbility(MON(f,owner))==125)return 0;
 u32 move=GET(0x12);FN(12,void(*)(u32))(0x601);FN(14,void(*)(u32,u32))(3,owner);FN(14,void(*)(u32,u32))(4,target);
 FN(14,void(*)(u32,u32))(0x12,move);FN(15,void(*)(u32,u32))(0x41,0);FN(28,void(*)(u32,u32))(0x26,chance);
 FN(29,void(*)(void*,u32))(f,stat?0x51:0x64);u32 blocked=GET(0x41),value=GET(0x26);FN(13,void(*)(u32))(0x601);
 return !blocked&&value&&FN(23,u32(*)(u8))(value>100?100:value);
}
static u32 actionChance(void*f,u8 owner,u8 target,const volatile u8*e){
 if(e[0]==19)return !e[3]||effectiveAbility(MON(f,owner))!=125;
 if(e[3])return secondary(f,owner,target,e[4],e[0]==4||e[0]==46);
 return e[4]>=100||FN(23,u32(*)(u8))(e[4]);
}
static u32 statWork(void*f,u8 owner,const volatile u8*e,const u8*targets,u32 count){
 if(!count)return 0;u8*p=PUSH(f,14,owner);if(!p)return 0;
 put32(p+4,half(e+8));p[12]=(u8)half(e+6);p[14]=e[1]==6;p[15]=count;
 for(u32 n=0;n<count;++n)p[16+n]=targets[n];POP(f,p);return 1;
}
static u32 groupCanChange(void*m,u32 mask,s32 delta){
 if(effectiveAbility(m)==126)delta=-delta;
 for(u32 stat=1;stat<=7;++stat)if(mask&(1u<<(stat-1))&&FN(24,u32(*)(void*,u32,s32))(m,stat,delta))return 1;
 return 0;
}
static void groupStatWork(void*f,u8 owner,u32 mask,s32 delta){
 for(u32 stat=1;stat<=7;++stat)if(mask&(1u<<(stat-1))){
  u8 row[32]={0};row[1]=6;put16(row+6,delta);put16(row+8,stat);statWork(f,owner,row,&owner,1);
 }
}
static void forceSuccess(void*f,u8 owner){u8*p=PUSH(f,59,owner);if(p)POP(f,p);}
static u32 useBerry(void*f,u8 owner,u8 target){
 u32 berry=FN(38,u32(*)(void*))(MON(f,target));if(!FN(39,u32(*)(u32))(berry))return 0;
 u8*p=PUSH(f,35,target);if(!p)return 0;put32(p+4,0);POP(f,p);
 /* Consumption removes the held factor before the forced-use event. */
 p=PUSH(f,34,owner);if(!p)return 0;put32(p,word(p)|(1u<<24));p[4]=target;put16(p+6,berry);POP(f,p);forceSuccess(f,owner);return 1;
}
static u32 cure(void*f,u8 owner,u8 target,u32 selected){
 void*m=MON(f,target);u32 success=0;
 for(u32 c=selected?selected:1;c<=(selected?selected:5);++c)if(FN(17,u32(*)(void*,u32))(m,c)){
  u8*p=PUSH(f,11,owner);if(!p)continue;put32(p+4,c);p[8]=target;p[20]=1;POP(f,p);
  if(!FN(17,u32(*)(void*,u32))(m,c))success=1;
 }return success;
}
static u32 heal(void*f,u8 owner,u8 target,u32 amount){
 void*m=MON(f,target);if(STAT(m,13)>=STAT(m,14))return 0;if(!amount)amount=1;if(amount>65535)amount=65535;
 u8*p=PUSH(f,5,owner);if(!p)return 0;put16(p+4,amount);p[6]=target;
 FN(56,void(*)(void*,u32,u32))(p+8,2,387);FN(57,void(*)(void*,u32))(p+8,target);POP(f,p);return 1;
}
static u32 healTypeImmune(void*f,u8 owner,u8 target,u32 move,u32 type,u32*w,u32 itemRequired){
 if(owner==target)return 0;u8 message[40]={0};
 FN(12,void(*)(u32))(0x604);FN(14,void(*)(u32,u32))(3,owner);FN(14,void(*)(u32,u32))(4,target);FN(14,void(*)(u32,u32))(0x12,move);FN(14,void(*)(u32,u32))(0x16,type);
 FN(14,void(*)(u32,u32))(0x4e,0);FN(14,void(*)(u32,u32))(0x3f,(u32)(uintptr_t)message);FN(14,void(*)(u32,u32))(0x38,3);
 FN(15,void(*)(u32,u32))(0x40,0);FN(15,void(*)(u32,u32))(0x51,0);
 /* An internal ability query is not another target eligibility check for the
  * move. The native item owns seven work words; preserve this scoped marker. */
 u32 saved=0;if(itemRequired&&w){saved=w[6];w[6]=saved|1u;}
 FN(29,void(*)(void*,u32))(f,0x2d);if(itemRequired&&w)w[6]=saved;
 u32 immune=GET(0x40);FN(13,void(*)(u32))(0x604);return immune;
}
static u32 addCondition(void*f,u8 owner,u8 target,u32 id,u32 data){
 void*m=MON(f,target);if(FN(17,u32(*)(void*,u32))(m,id))return 0;
 u8*p=PUSH(f,12,owner);if(!p)return 0;put32(p+4,id);put32(p+8,data);p[15]=target;
 if(id==16||id==22){FN(56,void(*)(void*,u32,u32))(p+20,2,id==16?565:872);FN(57,void(*)(void*,u32))(p+20,target);}
 POP(f,p);return 1;
}
static u32 changeRawStat(void*f,u8 owner,u8 target,u32 stat,u32 value,u32 announce){
 u8*p=PUSH(f,17,owner);if(!p)return 0;put16(p+4+(stat-1)*2,value);p[14]=target;p[15]=1u<<(stat-1);
 if(announce){FN(56,void(*)(void*,u32,u32))(p+16,2,MoveSwapMessageBase);FN(57,void(*)(void*,u32))(p+16,owner);}
 POP(f,p);return 1;
}
static u32 sideHazards(u32 side){
 /* Seek the native side list, never the installed recipe catalog. */
 u8*p=FN(53,u8*(*)(u32,u8))(2,side);u32 found=0;
 for(u32 n=0;p&&n<256;++n,p=(u8*)(uintptr_t)word(p+4)){
  if(word(p+16)!=2||p[0x3a]!=side||word(p+24)&(1u<<27))continue;
  u32 id=half(p+0x38);if(id>=6&&id<=8)found|=1u<<(id-6);
 }return found;
}
static u32 recipients(Evaluation*x,u32 scope);
static u32 tidy(Evaluation*x,void*f,u8 owner,u32 hazards,u32 substitutes){
 u32 changed=0;
 u32 mask=substitutes?recipients(x,4):0;
 if(substitutes)for(u8 id=0;id<24;++id)if(mask&(1u<<id)){
  /* The native break routine clears server state and queues both client updates. */
  void*m=MON(f,id);if(half((u8*)m+0x1f2)){FN(58,void(*)(void*,void*))(f,m);changed=1;}
 }
 for(u32 side=0;side<2;++side){u32 clear=sideHazards(side)&hazards;if(!clear)continue;
  u8*p=PUSH(f,26,owner);if(!p)continue;p[7]=side;
  p[4]=3;
  for(u32 n=0;n<3;++n)if(clear&(1u<<n))p[5+(n+6)/8]|=1u<<((n+6)%8);
  POP(f,p);changed=1;
 }
#ifdef MOVE_PERSISTENT
 if(hazards&8)for(u32 side=0;side<2;++side)changed|=removeWeb(f,owner,side);
#endif
 return changed;
}
static u32 action(void*item,void*f,u8 owner,u8 target,const volatile u8*e,u32*w,Evaluation*x){
 if(!alive(f,target))return 0;void*m=MON(f,target);u32 kind=e[0],v=half(e+6),arg=half(e+8);s32 delta=(int16_t)v;
 if(kind==12){
  s32 flag=0;if(!v||TRY(0x46,&flag)&&flag||TRY(0x47,&flag)&&flag)return 0;
  FN(12,void(*)(u32))(0x602);FN(14,void(*)(u32,u32))(3,owner);FN(14,void(*)(u32,u32))(0x25,v);
  FN(15,void(*)(u32,u32))(0x45,0);FN(15,void(*)(u32,u32))(0x41,0);FN(28,void(*)(u32,u32))(0x26,0);
  FN(29,void(*)(void*,u32))(f,0x6c);u32 blocked=GET(0x41),doubled=GET(0x45);FN(13,void(*)(u32))(0x602);
  if(blocked)return 0;if(doubled)v*=2;if(v>100)v=100;
  u8*p=PUSH(f,43,owner);if(!p)return 0;p[4]=target;p[5]=v;POP(f,p);return 1;
 }
 if(!actionChance(f,owner,target,e))return 0;
#ifdef MOVE_PERSISTENT
 if(kind==45||kind==46){u32 added=addResidual(f,e,owner,target,x->move);if(added&&e[1]==6)forceSuccess(f,owner);return added;}
 if(kind==55){if(FN(55,u32(*)(void*,u32))(m,9)||moveCritBoost[target])return 0;u32 amount=type(m,half(e+8))?half(e+10):v;if(!amount||amount>4)return 0;u8*p=PUSH(f,23,owner);if(!p)return 0;put32(p+4,9);p[8]=target;POP(f,p);moveCritBoost[target]=(u8)amount;p=PUSH(f,4,owner);if(p){FN(56,void(*)(void*,u32,u32))(p+4,2,1041);FN(57,void(*)(void*,u32))(p+4,target);POP(f,p);}forceSuccess(f,owner);return 1;}
 if(kind==56){if(!v||moveFieldLockTurns)return 0;moveFieldLockTurns=(u8)v;u8*p=PUSH(f,4,owner);if(p){FN(56,void(*)(void*,u32,u32))(p+4,2,MoveFieldLockMessageBase);FN(57,void(*)(void*,u32))(p+4,owner);POP(f,p);}forceSuccess(f,owner);return 1;}
 if(kind==57){u32 side=half(e+10),own=FN(41,u32(*)(u8))(owner),changed=0;if(own>=2||!v||!arg||arg>7)return 0;
  for(u32 n=0;n<2;++n)if((side==2||n==(side==0?own:own^1))&&!moveWeb[n].active){moveWeb[n].active=1;moveWeb[n].stat=(u8)arg;moveWeb[n].amount=(int8_t)(int16_t)v;changed=1;u8*p=PUSH(f,4,owner);if(p){FN(56,void(*)(void*,u32,u32))(p+4,2,MoveWebStartBase+n);POP(f,p);}}
  if(changed)forceSuccess(f,owner);return changed;
 }
 if(kind==58){if(!exchangeSides())return 0;u8*p=PUSH(f,4,owner);if(p){FN(56,void(*)(void*,u32,u32))(p+4,2,MoveCourtChangeBase);POP(f,p);}forceSuccess(f,owner);return 1;}
 if(kind==54){if(FN(42,u32(*)(void*,u8))(f,target)>=6)return 0;moveSpotlightTarget=target;u8*p=PUSH(f,4,owner);if(p){FN(56,void(*)(void*,u32,u32))(p+4,2,MoveSpotlightMessageBase);FN(57,void(*)(void*,u32))(p+4,target);POP(f,p);}forceSuccess(f,owner);return 1;}
 if(kind==53){if(!v||moveFocusTurns[target])return 0;moveFocusTurns[target]=(u8)v;u8*p=PUSH(f,4,owner);if(p){FN(56,void(*)(void*,u32,u32))(p+4,2,MoveFocusMessageBase);FN(57,void(*)(void*,u32))(p+4,target);POP(f,p);}forceSuccess(f,owner);return 1;}
 if(kind==52){if(v>=16||!arg||moveBlockedTurns[target][v])return 0;moveBlockedTurns[target][v]=(u8)arg;moveBlockedFlags[target]|=1u<<v;return 1;}
 if(kind==51){if(v>=18||!arg)return 0;movePowderType[target]=(u8)(v+1);movePowderDenominator[target]=(u8)arg;u8*p=PUSH(f,4,owner);if(p){FN(56,void(*)(void*,u32,u32))(p+4,2,MovePowderCoverBase);FN(57,void(*)(void*,u32))(p+4,target);POP(f,p);}forceSuccess(f,owner);return 1;}
 if(kind==50){if(target==owner||!alive(f,owner))return 0;void*user=MON(f,owner);for(u32 id=8;id<=22;++id)if((id==8||id==20||id==22)&&(FN(17,u32(*)(void*,u32))(user,id)||FN(17,u32(*)(void*,u32))(m,id)))return 0;u32 changed=0;if(!type(m,7))changed|=addCondition(f,owner,target,22,3u|((u32)owner<<3));if(!type(user,7))changed|=addCondition(f,target,owner,22,3u|((u32)target<<3));return changed;}
 if(kind==49){u32 bit=move_history_mask(owner);if(target!=owner||moveSelfTrapUsed&bit)return 0;u32 already=FN(17,u32(*)(void*,u32))(m,22),changed=groupCanChange(m,arg,delta);if(!already){if(!type(m,7)&&!addCondition(f,owner,owner,22,3u|((u32)owner<<3)))return 0;moveSelfTrapUsed|=bit;}if(changed)groupStatWork(f,owner,arg,delta);if(changed||!already){forceSuccess(f,owner);return 1;}return 0;}
 if(kind==47){if(arg>=18||v>=18)return 0;moveFieldTypes[arg]=(u8)(v+1);if(e[1]==6)forceSuccess(f,owner);return 1;}
 if(kind==48){if(v>=18||FN(22,u32(*)(void*,u32))(m,1))return 0;moveTargetTypes[target]=(u8)(v+1);if(e[1]==6)forceSuccess(f,owner);return 1;}
#endif
 if(kind==4){if(!FN(24,u32(*)(void*,u32,s32))(m,arg,effectiveAbility(m)==126?-delta:delta))return 0;return statWork(f,owner,e,&target,1);}
 if(kind==5){u32 check=half(e+10);if(check&&healTypeImmune(f,owner,target,GET(0x12),check-1,w,x->itemRequired))return 0;return heal(f,owner,target,divide(STAT(m,14)*v,arg));}
 if(kind==6)return cure(f,owner,target,v);
 if(kind==7){u8 values[7];u32 changed=0;for(u32 n=0;n<7;++n){u32 before=STAT(m,n+1);values[n]=arg?12-before:6;if(before!=values[n])changed=1;}if(!changed)return 0;u8*p=PUSH(f,15,owner);if(!p)return 0;p[4]=target;for(u32 n=0;n<7;++n)p[5+n]=values[n];POP(f,p);return 1;}
 if(kind==8){nativeEvent(v,v==229?0x4d:0xa1,item,f,owner,w);return 1;}
 if(kind==11){u8*p=PUSH(f,12,owner);if(!p)return 0;put32(p+4,v);put32(p+8,FN(30,u32(*)(u32))(v));p[12]=0;p[15]=target;POP(f,p);return 1;}
 if(kind==13){
  u8 choices[6];u32 count=0;for(u32 c=1;c<=6;++c)if(v&(1u<<(c-1)))choices[count++]=c;
  if(!count)return 0;u32 chosen=choices[FN(37,u32(*)(u32))(count)];
  u8*p=PUSH(f,12,owner);if(!p)return 0;put32(p+4,chosen);put32(p+8,FN(30,u32(*)(u32))(chosen));p[15]=target;POP(f,p);return 1;
 }
 if(kind==14){
  u32 cost=divide(STAT(m,14)*half(e+10),half(e+12));if(!cost)cost=1;
  if(target!=owner||STAT(m,13)<=cost||!groupCanChange(m,arg,delta))return 0;
  u8*p=PUSH(f,8,owner);if(!p)return 0;p[4]=1;p[6]=1;p[7]=owner;put32(p+16,0-cost);POP(f,p);
  groupStatWork(f,owner,arg,delta);
  p=PUSH(f,33,owner);if(p){p[4]=owner;put32(p+8,1);POP(f,p);}return 1;
 }
 if(kind==15){
  u32 amount=divide(STAT(m,arg+7)*v,half(e+10));if(!amount)amount=1;if(amount>65535)amount=65535;
  s32 change=(int16_t)half(e+12);if(change){u8 row[32]={0};row[1]=6;put16(row+6,change);put16(row+8,arg);statWork(f,owner,row,&target,1);}
  u8*p=PUSH(f,6,owner);if(!p)return 0;put16(p+4,amount);p[6]=owner;p[7]=target;
  FN(56,void(*)(void*,u32,u32))(p+8,2,387);FN(57,void(*)(void*,u32))(p+8,owner);POP(f,p);forceSuccess(f,owner);return 1;
 }
 if(kind==16){if(!cure(f,owner,target,half(e+10)))return 0;void*user=MON(f,owner);if(alive(f,owner))heal(f,owner,owner,divide(STAT(user,14)*v,arg));return 1;}
 if(kind==17)return useBerry(f,owner,target);
 if(kind==18){
  if(target!=owner||!FN(39,u32(*)(u32))(FN(38,u32(*)(void*))(m))||!groupCanChange(m,arg,delta))return 0;
  groupStatWork(f,owner,arg,delta);return useBerry(f,owner,owner);
 }
 if(kind==19){
  u32 first=arg==2?0:arg?(FN(41,u32(*)(u8))(owner)^1u):FN(41,u32(*)(u8))(owner),last=arg==2?1:first;
  for(u32 side=first;side<=last&&side<2;++side){u8*p=PUSH(f,25,owner);if(!p)continue;put32(p+4,v);put32(p+8,1);p[12]=side;
   FN(56,void(*)(void*,u32,u32))(p+16,1,v==6?148:v==7?152:156);FN(57,void(*)(void*,u32))(p+16,side);POP(f,p);}return 1;
 }
 if(kind==20){
  u32 data=3u|((u32)owner<<3);
  if(v==18){u32 pos=FN(42,u32(*)(void*,u8))(f,owner);if(pos>=6)return 0;data=1u|(pos<<9);}
  return addCondition(f,owner,target,v,data);
 }
 if(kind==21){
  u32 pair=FN(6,u32(*)(void*))(m),one=FN(50,u32(*)(u32))(pair),two=FN(51,u32(*)(u32))(pair),remaining=v;
  if(!arg&&(one==v&&two==v||FN(20,u32(*)(void*))(m)==493||effectiveAbility(m)==121))return 0;
  if(arg){if(one!=v&&two!=v)return 0;u32 nullType=MoveRuleData[3]?MoveRuleData[3]:17;remaining=one==v?(two==v?nullType:two):one;}
  u8*p=PUSH(f,20,owner);if(!p)return 0;put16(p+4,FN(52,u32(*)(u32,u32))(remaining,remaining));p[6]=target;p[7]=arg?1:0;POP(f,p);
  if(arg){p=PUSH(f,4,owner);if(p){FN(56,void(*)(void*,u32,u32))(p+4,2,MoveTypeLossMessageBase);FN(57,void(*)(void*,u32))(p+4,target);FN(57,void(*)(void*,u32))(p+4,v);POP(f,p);}}
  return 1;
 }
 if(kind==22){
  void*user=MON(f,owner);u32 mine=FN(43,u32(*)(void*,u32))(user,v+7),theirs=FN(43,u32(*)(void*,u32))(m,v+7);
  if(owner==target)return 0;
  if(!changeRawStat(f,owner,target,v,mine,0))return 0;return changeRawStat(f,owner,owner,v,theirs,1);
 }
 if(kind==23){
  u8 stages[7],stolen[7];u32 changed=0;for(u32 stat=1;stat<=7;++stat){u32 stage=STAT(m,stat);stolen[stat-1]=(v&(1u<<(stat-1)))&&stage>6?stage-6:0;stages[stat-1]=stolen[stat-1]?6:stage;if(stolen[stat-1])changed=1;}
  if(!changed)return 0;u8*p=PUSH(f,15,owner);if(!p)return 0;p[4]=target;for(u32 n=0;n<7;++n)p[5+n]=stages[n];POP(f,p);
  for(u32 n=0;n<7;++n)if(stolen[n]){u8 row[32]={0};put16(row+6,stolen[n]);put16(row+8,n+1);statWork(f,owner,row,&owner,1);}return 1;
 }
 if(kind==24){if(STAT(m,16)==121)return 0;return addCondition(f,owner,target,16,1);}
 if(kind==25){
  s32 source=-1;if(!TRY(6,&source)||source<0||source>=24||!alive(f,source))return 0;
  u32 ability=STAT(MON(f,source),16);if(ability==121||ability==161)return 0;
  u8 chosen[6];u32 count=0;
  u32 mask=recipients(x,arg?2:0);
  for(u8 id=0;id<24;++id)if((mask&(1u<<id))&&alive(f,id)){
   u32 old=STAT(MON(f,id),16);if(old==121||old==161)return 0;if(old==ability)continue;if(count==6)return 0;chosen[count++]=id;
  }
  for(u32 n=0;n<count;++n){u8*p=PUSH(f,31,owner);if(!p)continue;put16(p+4,ability);p[6]=chosen[n];p[7]=0;p[8]=0;
   FN(56,void(*)(void*,u32,u32))(p+12,2,405);FN(57,void(*)(void*,u32))(p+12,chosen[n]);FN(57,void(*)(void*,u32))(p+12,ability);POP(f,p);}return count!=0;
 }
 if(kind==26){
  u32 previous=FN(44,u32(*)(void*))(m);if(!previous||previous==165)return 0;
  for(u32 slot=0;slot<4;++slot)if(FN(45,u32(*)(void*,u32))(m,slot)==previous){u32 amount=FN(46,u32(*)(void*,u32))(m,slot);if(amount>v)amount=v;if(!amount)return 0;
   u8*p=PUSH(f,10,owner);if(!p)return 0;p[4]=amount;p[5]=target;p[6]=slot;
   FN(56,void(*)(void*,u32,u32))(p+8,2,641);FN(57,void(*)(void*,u32))(p+8,target);FN(57,void(*)(void*,u32))(p+8,previous);FN(57,void(*)(void*,u32))(p+8,amount);POP(f,p);return 1;
  }return 0;
 }
 if(kind==29){
  u32 move=GET(0x12);FN(12,void(*)(u32))(0x603);FN(14,void(*)(u32,u32))(3,owner);FN(14,void(*)(u32,u32))(4,target);FN(14,void(*)(u32,u32))(5,1);FN(14,void(*)(u32,u32))(6,target);FN(14,void(*)(u32,u32))(0x12,move);
  nativeEvent(282,0x83,item,f,owner,w);FN(13,void(*)(u32))(0x603);return 1;
 }
 if(kind==30){u32 changed=tidy(x,f,owner,arg,half(e+10));if(changed)forceSuccess(f,owner);return changed;}
 if(kind==31){
  if(half(e+12)&&effectiveAbility(m)==69)return 0;
  u32 amount=divide(STAT(m,14)*v+arg-1,arg);if(!amount)amount=1;if(amount>65535)amount=65535;
  u8*p=PUSH(f,7,owner);if(!p)return 0;put16(p+4,amount);p[6]=owner;
  FN(56,void(*)(void*,u32,u32))(p+12,2,378);FN(57,void(*)(void*,u32))(p+12,owner);POP(f,p);return 1;
 }
 return 0;
}
static u32 recipients(Evaluation*x,u32 scope){
 if(scope==0)return 1u<<x->owner;
 if(scope==1){s32 count=0,first=0;u32 mask=0;
  if(TRY(4,&first))return first>=0&&first<24?1u<<first:0;
  if(TRY(5,&count))for(s32 n=0;n<count&&n<6;++n){u32 id=GET(6+n);if(id<24)mask|=1u<<id;}
  return mask;
 }
 if(!x->activeValid){for(u8 id=0;id<24;++id)if(alive(x->flow,id))x->active|=1u<<id;x->activeValid=1;}
 u32 result=0;for(u8 id=0;id<24;++id)if(x->active&(1u<<id)){
  u32 ally=scope==4?0:FN(16,u32(*)(u8,u8))(x->owner,id);
  if(scope==4||scope==2&&ally||scope==3&&!ally)result|=1u<<id;
 }return result;
}
/* The caller supplies the current MoveParam and the defending type at each of
 * the two native matchup calls. Unconfigured moves take the original path. */
PUBLIC u32 MoveTypeMatchup(void*f,void*attacker,void*defender,u32 moveType,u32 defendingType,u32 move){
 u32 native=FN(59,u32(*)(void*,void*,void*,u32,u32))(f,attacker,defender,moveType,defendingType);
 const volatile u8*idx=entry(move);if(!idx||!native)return native;
 const volatile u8*r=MoveRuleData+word(idx+4),*global=r+8,*e=global+(r[1]+r[2])*8;
 u32 owner=FN(19,u32(*)(void*))(attacker),target=FN(19,u32(*)(void*))(defender);
 if(owner>=24||target>=24)return native;
 Evaluation x={.flow=f,.owner=(u8)owner,.target=(u8)target,.move=(u16)move};
 for(u32 n=0;n<r[0];++n){
  if(e[0]==35&&half(e+6)==defendingType&&match(global,&x,r[1])&&match(e+32,&x,e[5]))native=half(e+8);
  e+=32+e[5]*8;
 }
 return native;
}
PUBLIC __attribute__((naked)) void MoveTypeMatchupHook(void){
 __asm__ volatile("push {r4, lr}\n"
                  "sub sp, #8\n"
                  "ldr r4, [sp, #16]\n"
                  "str r4, [sp, #0]\n"
                  "ldrh r4, [r5, #0]\n"
                  "str r4, [sp, #4]\n"
                  "bl MoveTypeMatchup\n"
                  "add sp, #8\n"
                  "pop {r4, pc}\n");
}
PUBLIC u32 MoveDamagingSubstitute(void*defender,const u8*param,void*f,void*attacker){
 u32 native=FN(60,u32(*)(void*))(defender);if(!native||!param)return native;
 u32 move=half(param);const volatile u8*idx=entry(move);if(!idx)return native;
 const volatile u8*r=MoveRuleData+word(idx+4),*global=r+8,*e=global+(r[1]+r[2])*8;
 u32 owner=FN(19,u32(*)(void*))(attacker),target=FN(19,u32(*)(void*))(defender);
 if(owner>=24||target>=24)return native;
 Evaluation x={.flow=f,.owner=(u8)owner,.target=(u8)target,.move=(u16)move};
 for(u32 n=0;n<r[0];++n){
  if(e[0]==28&&match(global,&x,r[1])&&match(e+32,&x,e[5]))return 0;
  e+=32+e[5]*8;
 }
 return native;
}
PUBLIC __attribute__((naked)) void MoveDamagingSubstituteHook(void){
 __asm__ volatile("push {r4, lr}\n"
                  "ldr r1, [sp, #40]\n"
                  "ldr r2, [sp, #28]\n"
                  "ldr r3, [sp, #32]\n"
                  "bl MoveDamagingSubstitute\n"
                  "pop {r4, pc}\n");
}
PUBLIC u32 MoveDamageWeather(void*f,const u8*param){
 u32 actual=FN(8,u32(*)(void*))(f);if(!param)return actual;
 u32 move=half(param);const volatile u8*idx=entry(move);if(!idx)return actual;
 s32 owner=-1,target=-1;if(!TRY(3,&owner)||!TRY(4,&target)||owner<0||owner>=24||target<0||target>=24)return actual;
 const volatile u8*r=MoveRuleData+word(idx+4),*global=r+8,*e=global+(r[1]+r[2])*8;
 Evaluation x={.flow=f,.owner=(u8)owner,.target=(u8)target,.move=(u16)move,.weather=actual,.weatherValid=1};
 u32 result=actual;
 for(u32 n=0;n<r[0];++n){
  if(e[0]==36&&half(e+6)==actual&&(half(e+10)==255||half(e+10)==param[6])&&match(global,&x,r[1])&&match(e+32,&x,e[5]))result=half(e+8);
  e+=32+e[5]*8;
 }
 return result;
}
PUBLIC __attribute__((naked)) void MoveDamageWeatherHook(void){
 __asm__ volatile("push {r4, lr}\n"
                  "movs r1, r4\n"
                  "bl MoveDamageWeather\n"
                  "pop {r4, pc}\n");
}
PUBLIC void MoveThawHitTargets(void*f,const u8*param,void*attacker,void*targets){
 const volatile u8*idx=param?entry(half(param)):0;
 if(idx){
  const volatile u8*r=MoveRuleData+word(idx+4),*global=r+8,*e=global+(r[1]+r[2])*8;u32 owner=FN(19,u32(*)(void*))(attacker);
  if(owner<24){
   Evaluation x={.flow=f,.owner=(u8)owner,.target=(u8)owner,.move=half(param)};
   for(u32 n=0;n<r[0];++n){
    if(e[0]==37&&match(global,&x,r[1])&&match(e+32,&x,e[5])){
     u8 temp[20];memcpy(temp,param,sizeof(temp));temp[6]=9;
     FN(61,void(*)(void*,const u8*,void*,void*))(f,temp,attacker,targets);return;
    }
    e+=32+e[5]*8;
   }
  }
 }
 FN(61,void(*)(void*,const u8*,void*,void*))(f,param,attacker,targets);
}
PUBLIC void MoveRedirectEvent(void*f,u32 event){
 s32 move=-1,owner=-1,target=-1;
 if(event==0x2a&&TRY(0x12,&move)&&TRY(3,&owner)&&TRY(4,&target)&&move>0&&owner>=0&&owner<24&&target>=0&&target<24){
  const volatile u8*idx=entry((u32)move);
  if(idx){
   const volatile u8*r=MoveRuleData+word(idx+4),*global=r+8,*e=global+(r[1]+r[2])*8;
   Evaluation x={.flow=f,.owner=(u8)owner,.target=(u8)target,.move=(u16)move};
   for(u32 n=0;n<r[0];++n){
    if(e[0]==38&&match(global,&x,r[1])&&match(e+32,&x,e[5]))return;
    e+=32+e[5]*8;
   }
  }
 }
 FN(29,void(*)(void*,u32))(f,event);
}
static u32 attackSelector(void*f,const u8*param,u32 original){
 if(!param)return original;u32 move=half(param);const volatile u8*idx=entry(move);if(!idx)return original;
 s32 owner=-1,target=-1;if(!TRY(3,&owner)||!TRY(4,&target)||owner<0||owner>=24||target<0||target>=24)return original;
 const volatile u8*r=MoveRuleData+word(idx+4),*global=r+8,*e=global+(r[1]+r[2])*8;
 Evaluation x={.flow=f,.owner=(u8)owner,.target=(u8)target,.move=(u16)move};
 for(u32 n=0;n<r[0];++n){
  if(e[0]==39&&match(global,&x,r[1])&&match(e+32,&x,e[5]))return 7+half(e+6);
  e+=32+e[5]*8;
 }
 return original;
}
PUBLIC u32 MoveAttackStatSelector(void*f,u32 event,const u8*param,u32 original){
 FN(29,void(*)(void*,u32))(f,event);return attackSelector(f,param,original);
}
PUBLIC u32 MoveCriticalAttackStat(void*mon,u32 selector,const u8*param,void*f){
 if((selector==9||selector==11||selector==12)&&attackSelector(f,param,0)==selector){
  u32 stage=STAT(mon,selector-7);
  return stage<6?FN(43,u32(*)(void*,u32))(mon,selector):STAT(mon,selector);
 }
 return FN(62,u32(*)(void*,u32))(mon,selector);
}
PUBLIC __attribute__((naked)) void MoveAttackStatHook(void){
 __asm__ volatile("push {r3, lr}\n"
                  "movs r2, r5\n"
                  "movs r3, r4\n"
                  "bl MoveAttackStatSelector\n"
                  "movs r4, r0\n"
                  "pop {r3, pc}\n");
}
PUBLIC __attribute__((naked)) void MoveCriticalStatHook(void){
 __asm__ volatile("push {r4, lr}\n"
                  "movs r2, r5\n"
                  "movs r3, r7\n"
                  "bl MoveCriticalAttackStat\n"
                  "pop {r4, pc}\n");
}
PUBLIC void MoveResolveUserType(void*f,u16 move,void*mon,u8*param){
 FN(63,void(*)(void*,u16,void*,u8*))(f,move,mon,param);
 if(!param||!mon)return;const volatile u8*idx=entry(move);if(!idx)return;
 u32 owner=FN(19,u32(*)(void*))(mon);if(owner>=24)return;
 const volatile u8*r=MoveRuleData+word(idx+4),*global=r+8,*e=global+(r[1]+r[2])*8;
 Evaluation x={.flow=f,.owner=(u8)owner,.target=(u8)owner,.move=move};
 for(u32 n=0;n<r[0];++n){
  if(e[0]==40&&match(global,&x,r[1])&&match(e+32,&x,e[5])){
   u8*m=mon;u32 nullType=MoveRuleData[3]?MoveRuleData[3]:17,first=m[0xf8],second=m[0xf9],removedFlying=0;
   if(FN(17,u32(*)(void*,u32))(mon,24)){
    if(first==2){first=nullType;removedFlying=1;}
    if(second==2){second=nullType;removedFlying=1;}
   }
   u32 chosen=half(e+6)?second:first,other=half(e+6)?first:second;
   if(chosen>=nullType)chosen=other<nullType?other:removedFlying?0:nullType;
   param[6]=(u8)chosen;return;
  }
  e+=32+e[5]*8;
 }
}
#ifdef MOVE_COMPACT
/* Runtime-built event wrappers can call this with any event ID. */
__attribute__((noipa))
#endif
static void dispatch(void*item,void*f,u8 owner,u32*w,u32 event){
 u32 move=FN(31,u32(*)(void*))(item);const volatile u8*idx=entry(move);if(!idx||owner>=24)return;
 const volatile u8*r=MoveRuleData+word(idx+4);
 if(half(r+4))nativeEvent(half(r+4),event,item,f,owner,w);
 const volatile u8*global=r+8,*requirements=global+r[1]*8,*effects=requirements+r[2]*8,*scan=effects;
 const u8 events[]={0x37,0x47,0x32,0x1f,0x4b,0x84,0xa0,0x83,0x4d,0x83,0x25,0x46,3,4};u32 needed=event==r[3]&&r[3],window=0,markers=0,itemRequired=0;
#ifdef MOVE_MODERN_KNOCK
 u32 knock=0;
#endif
 for(u32 n=0;n<r[0];++n){
#ifdef MOVE_MODERN_KNOCK
 if(scan[0]==59){knock=1;if(event==3||event==4||event==0x37||event==0x83)needed=1;}else
#endif
 if(scan[0]==41){if(event==3||event==0x4b||event==0x4d)needed=1;}else if(scan[0]==34){if(event==0x30||event==0x31)needed=1;}else if(scan[0]==32){itemRequired=1;if(event==3||event==0x2d||event==0x46)needed=1;}else if(scan[0]==31){markers=1;if(event==3||event==4||(half(scan+10)?event==0x45:event==0x25||event==0x26))needed=1;}else if(scan[0]==27){window=1;if(event==3||event==4)needed=1;}else if(scan[0]==28){if(event==5)needed=1;}else if(scan[0]==10?(event==0x3a||event==0x33):scan[1]<14&&(event==events[scan[1]]||scan[1]==6&&event==0xa1))needed=1;scan+=32+scan[5]*8;}
 if(!needed)return;
 /* Check the owning battler and actual move before any condition can query weather. */
 s32 actor=-1,actual=-1,target=-1;
 if(!TRY(event==0x1f||event==0x25||event==0x26||event==4?2:3,&actor)||actor!=owner)return;
 if(window&&event==4)FN(48,Callback)(item,f,owner,w);
#ifdef MOVE_MODERN_KNOCK
 if(knock&&(event==3||event==4)&&!preview(f))knockArmed[owner]=0;
#endif
 /* Native AddItem initializes seven work words. Native bases use word zero;
  * word three holds one recoil marker per card, cleared at each sequence. */
 if(markers&&w&&event==3&&!preview(f))w[3]=0;
 if(itemRequired&&w&&event==3&&!preview(f)){w[1]=w[2]=w[4]=w[5]=0;}
 /* Retail accuracy and defense-stage frames identify the actor, but omit the
  * move ID. Their selected move item supplies identity, as in native handlers. */
 if(TRY(0x12,&actual)?(u32)actual!=move:event!=0x30&&event!=0x31&&event!=0x32&&event!=0x33&&event!=0x3a){if(markers&&w&&event==4)w[3]=0;return;}
 if(!TRY(4,&target))(void)TRY(6,&target);Evaluation x={.flow=f,.owner=owner,.target=target>=0&&target<24?(u8)target:owner,.move=(u16)move,.itemRequired=itemRequired,.event=(u8)event};
 if(event==r[3]&&!match(requirements,&x,r[2])){SET(event==0x1f?0x22:0x40,event==0x1f?0x1a:1);return;}
 u32 power=0,powerChanged=0;
 for(u32 n=0;n<r[0];++n){const volatile u8*e=effects;effects+=32+e[5]*8;u32 kind=e[0],phase=e[1],v=half(e+6);
#ifdef MOVE_MODERN_KNOCK
  if(kind==59){
   if(event==0x37&&target>=0&&target<24&&match(global,&x,r[1])&&match(e+32,&x,e[5])){
    /* Activation belongs to power timing. HP, weather or abilities may change
     * during the hit; removal still belongs to this same accepted activation. */
    if(!preview(f))knockArmed[owner]|=1u<<target;
    if(FN(38,u32(*)(void*))(MON(f,target))&&!FN(60,u32(*)(void*))(MON(f,target))&&!FN(64,u32(*)(void*,u8,u8))(f,owner,(u8)target)&&!FN(65,u32(*)(void*,void*,u32))(f,MON(f,target),0)){
     if(!powerChanged)power=GET(0x30);powerChanged=1;if(power>65535)power=65535;
     power=(power*v)>>12;if(power>65535)power=65535;if(!power)power=1;
    }
   }
   if(event==0x83&&!preview(f)){
    u32 mask=recipients(&x,1)&knockArmed[owner];knockArmed[owner]&=~mask;
    for(u8 id=0;id<24;++id)if(mask&(1u<<id)){
     /* A KO still reaches native Knock Off. Do not apply the generic action
      * helper's living-recipient filter before the native removal checks. */
     FN(12,void(*)(u32))(0x603);FN(14,void(*)(u32,u32))(3,owner);FN(14,void(*)(u32,u32))(4,id);
     FN(14,void(*)(u32,u32))(5,1);FN(14,void(*)(u32,u32))(6,id);FN(14,void(*)(u32,u32))(0x12,move);
     nativeEvent(282,0x83,item,f,owner,w);FN(13,void(*)(u32))(0x603);
    }
    x.target=target>=0&&target<24?(u8)target:owner;
   }
   continue;
  }
#endif
  if(kind==41){
   if(!w||preview(f))continue;
   if(event==3){w[0]=0;continue;}
   if(event==0x4b){
    s32 damage=0;if(w[0]>=6||target<0||target>=24||!TRY(0x32,&damage)||damage<=0||!match(global,&x,r[1])||!match(e+32,&x,e[5]))continue;
    void*m=MON(f,(u8)target);if(!m)continue;u32 amount=divide((u32)damage*v,100);if(!amount)amount=1;if(amount>65535)amount=65535;
    w[++w[0]]=amount|((u32)target<<16)|((effectiveAbility(m)==64u)<<24);continue;
   }
   if(event==0x4d){
    if(alive(f,owner))for(int ooze=1;ooze>=0;--ooze)for(u32 j=1;j<=w[0]&&j<=6;++j){
     u32 record=w[j];if((record>>24)!=(u32)ooze)continue;u8*p=PUSH(f,6,owner);if(!p)continue;
     put16(p+4,record);p[6]=owner;p[7]=(u8)(record>>16);FN(56,void(*)(void*,u32,u32))(p+8,2,387);FN(57,void(*)(void*,u32))(p+8,owner);POP(f,p);
    }
    w[0]=0;
   }
   continue;
  }
  if(kind==34){
   if(!w||target<0||target>=24||(event!=0x30&&event!=0x31))continue;
   u32 bit=1u<<(target+8);
   if(event==0x30){
    w[6]&=~bit;
    if(!FN(16,u32(*)(u8,u8))(owner,(u8)target)||!match(global,&x,r[1])||!match(e+32,&x,e[5]))continue;
    SET(0x51,1);w[6]|=bit;continue;
   }
   u32 marked=w[6]&bit;w[6]&=~bit;if(!marked||preview(f)||!alive(f,(u8)target))continue;
   void*m=MON(f,(u8)target);
   if(STAT(m,13)>=STAT(m,14)){u8*p=PUSH(f,4,owner);if(p){FN(56,void(*)(void*,u32,u32))(p+4,2,523);FN(57,void(*)(void*,u32))(p+4,target);POP(f,p);}continue;}
   heal(f,owner,(u8)target,divide(STAT(m,14)*v,half(e+8)));continue;
  }
  if(kind==10){if((event==0x3a||event==0x33)&&match(global,&x,r[1])&&match(e+32,&x,e[5])){if(event==0x3a)SET(0x51,1);if(event==0x33)SET(0x4b,1);}continue;}
  if(kind==28){if(event==5&&match(global,&x,r[1])&&match(e+32,&x,e[5]))FN(49,Callback)(item,f,owner,w);continue;}
  if(kind==27){if(event==3&&match(global,&x,r[1])&&match(e+32,&x,e[5]))FN(47,Callback)(item,f,owner,w);continue;}
  if(kind==32){
   if(!w||(event!=0x2d&&event!=0x46)||(w[6]&1u)||target<0||target>=24||!match(global,&x,r[1])||!match(e+32,&x,e[5]))continue;
   u32 bit=1u<<target,pos=FN(42,u32(*)(void*,u8))(f,target);if(pos>=6)continue;
   u8*slot=(u8*)w+(pos<2?8:pos<4?16:20)+(pos%2)*2;
   if(event==0x2d){
    if(w[1]&bit)continue;u32 held=FN(38,u32(*)(void*))(MON(f,target));
    if(!held){if(SET(0x40,1)){s32 str=0;if(TRY(0x3f,&str)&&str)FN(56,void(*)(void*,u32,u32))((void*)(uintptr_t)str,1,71);}}
    else if(!preview(f)){w[1]|=bit;put16(slot,held);}continue;
   }
   u32 announced=1u<<(24+pos);if(!(w[1]&bit)||(w[1]&announced)||preview(f))continue;
   u8*p=PUSH(f,4,owner);if(!p)continue;w[1]|=announced;
   FN(56,void(*)(void*,u32,u32))(p+4,2,MoveItemMessageBase);FN(57,void(*)(void*,u32))(p+4,target);FN(57,void(*)(void*,u32))(p+4,half(slot));POP(f,p);continue;
  }
  if(kind==31){
   if(!w||preview(f))continue;u32 bit=1u<<n;
   if(half(e+10)?event==0x45:event==0x25||event==0x26){w[3]|=bit;continue;}
   if(event==4){u32 marked=w[3]&bit;w[3]&=~bit;x.target=owner;if(marked&&match(global,&x,r[1])&&match(e+32,&x,e[5]))action(item,f,owner,owner,e,w,&x);}continue;
  }
  if(phase>=14||event!=events[phase]&&!(phase==6&&event==0xa1))continue;
#ifdef MOVE_PERSISTENT
  if(kind==44){if(!preview(f)&&owner<24&&match(global,&x,r[1])&&match(e+32,&x,e[5])){moveVulnerability[owner]=(u16)v;if(half(e+8))moveVulnerabilityAccuracy|=move_history_mask(owner);else moveVulnerabilityAccuracy&=~move_history_mask(owner);}continue;}
#endif
  if(kind<=3||kind==9||kind==42){if(!match(global,&x,r[1])||!match(e+32,&x,e[5]))continue;
   if(kind==1){if(!powerChanged)power=GET(0x30);powerChanged=1;if(power>65535)power=65535;power=(power*v)>>12;if(power>65535)power=65535;if(!power)power=1;}
   if(kind==2)MUL(0x35,v);
   if(kind==3)SET(0x51,1);
   if(kind==9){void*m=MON(f,e[2]?x.target:owner);u32 p=divide(v*STAT(m,13),STAT(m,14));power=p?p:1;powerChanged=1;}
#ifdef MOVE_HISTORY
   if(kind==42){u32 count=half(e+8)?moveHistory.faints[divide(owner,6)]:moveHistory.hits[owner],limit=half(e+10);if(count>limit)count=limit;if(!powerChanged)power=GET(0x30);powerChanged=1;power+=count*v;if(power>65535)power=65535;}
#endif
   continue;
  }
  if(preview(f))continue;
  if(phase==4){s32 damage=0,sub=0;if(!TRY(0x32,&damage)||damage<=0||e[2]!=0&&TRY(0x46,&sub)&&sub)continue;}
  if(phase==7){u32 count=GET(5),ko=0;for(u32 j=0;j<count&&j<6;++j)if(!STAT(MON(f,GET(6+j)),13))ko=1;if(!ko)continue;}
  u32 recipientsMask=recipients(&x,e[2]),statCount=0;u8 statTargets[6];
  for(u8 id=0;id<24;++id)if(recipientsMask&(1u<<id)){x.target=id;if(match(global,&x,r[1])&&match(e+32,&x,e[5])){
   if(kind==4){if(statCount<6&&alive(f,id)&&actionChance(f,owner,id,e)){void*m=MON(f,id);s32 delta=(int16_t)v;if(FN(24,u32(*)(void*,u32,s32))(m,half(e+8),effectiveAbility(m)==126?-delta:delta))statTargets[statCount++]=id;}}
   else action(item,f,owner,id,e,w,&x);
  }}
  if(kind==4)statWork(f,owner,e,statTargets,statCount);
  x.target=target>=0&&target<24?(u8)target:owner;
 }
 if(powerChanged)SET(0x30,power);
}
#include "build/events.inc"
PUBLIC u32 MoveDispatch(void*mon,u16 move,u32 speed){
 const volatile u8*p=entry(move);if(!p)return FN(32,u32(*)(void*,u16,u32))(mon,move,speed);
 u32 owner=FN(19,u32(*)(void*))(mon);u8 exists=0;
 if(owner>=24||!FN(33,u32(*)(u32,u16,u8*))(owner,move,&exists))return 0;
 if(!half(p+2))return 0;
 return FN(34,u32(*)(u32,u32,u32,u32,u32,const Event*,u32))(0,move,0,speed,owner,(const Event*)(uintptr_t)word(p+8),half(p+2))!=0;
}
PUBLIC u32 MoveSheerForce(u16 move){
 const volatile u8*p=entry(move);if(!p)return FN(35,u32(*)(u16))(move);
 const volatile u8*r=MoveRuleData+word(p+4),*e=r+8+(r[1]+r[2])*8;
 for(u32 n=0;n<r[0];++n){if(e[0]==12?half(e+6)!=0:e[3]&&e[4])return 1;e+=32+e[5]*8;}
 return 0;
}

/* Recipe flinch is queued once per successful hit. Prevent a second native roll,
 * including item-added flinch; unchanged moves retain the original pipeline. */
PUBLIC u32 MoveFlinchChance(void*f,u16 move,void*mon){
 const volatile u8*p=entry(move);
 if(p){const volatile u8*r=MoveRuleData+word(p+4),*e=r+8+(r[1]+r[2])*8;
  for(u32 n=0;n<r[0];++n){if(e[0]==12&&half(e+6))return 0;e+=32+e[5]*8;}}
 return FN(36,u32(*)(void*,u16,void*))(f,move,mon);
}
