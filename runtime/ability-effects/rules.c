#include <stdint.h>
#define PUBLIC __attribute__((visibility("default")))
typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef int32_t s32;
typedef void (*Callback)(void *,void *,u8,u32 *);
typedef struct { u32 event; Callback callback; } Event;
/* API entries are supplied only after their ROM signatures have been checked. */
PUBLIC const volatile u32 AbilityRuleApi[43]={0};
PUBLIC const volatile u8 *AbilityRuleData=(const volatile u8 *)1;
#define FN(i,t) ((t)(uintptr_t)AbilityRuleApi[i])
#define VALUE(k) FN(0,u32(*)(u32))(k)
#define MUL(v) FN(1,void(*)(u32,u32))(0x35,v)
#define MON(f,m) FN(2,void*(*)(void*,u8))(f,m)
#define STAT(p,k) FN(3,u32(*)(void*,u32))(p,k)
#define SUB(i) FN(13,u32(*)(void*))(i)
#define SIM(f) FN(7,u32(*)(void*))(f)
#define PREVIEW(f) FN(8,u32(*)(void*))(f)
#define PUSH(f,c,m) FN(9,void*(*)(void*,u32,u8))(f,c,m)
#define POP(f,p) FN(10,void(*)(void*,void*))(f,p)
#define REWRITE(k,v) FN(28,u32(*)(u32,u32))(k,v)
#define CHECK(p,k) FN(30,u32(*)(void*,u32))(p,k)
static u32 bypassProbe;
static u32 nativeWork[32][16][7];
#ifdef ABILITY_CLIENT_TRAPS
static void *clientFlow;
#endif
static u16 half(const volatile u8 *p){return p[0]|(u16)(p[1]<<8);}
static void put16(u8*p,u16 v){p[0]=v;p[1]=v>>8;}
static void put32(u8*p,u32 v){for(u32 n=0;n<4;++n)p[n]=v>>(n*8);}
static const volatile u8 *record(u32 id){return id<256&&half(AbilityRuleData+id*2)?AbilityRuleData+half(AbilityRuleData+id*2):0;}
static const volatile u8 *effects(const volatile u8*r){return r+4+r[1]*4;}
static u32 divide(u32 n,u32 d){u32 q=0,r=0;if(!d)return 0;for(int i=31;i>=0;--i){r=(r<<1)|((n>>i)&1);if(r>=d){r-=d;q|=1u<<i;}}return q;}
static u32 variable(u32 key,s32 *out){return FN(26,u32(*)(u32,s32*))(key,out);}
static u32 preview(void*f){return SIM(f)||PREVIEW(f);}
static u32 active(const volatile u8*r,void*f,void*mon){
 u8 stack[32];u32 top=0;
 for(u32 i=0;i<r[1];++i){
  const volatile u8*p=r+4+i*4;u32 result=0,v=half(p+2);s32 x;
  if(p[0]>=128){if(p[1]>top)return 0;result=p[0]==128;for(u32 j=0;j<p[1];++j){u32 a=stack[--top];result=p[0]==128?result&&a:result||a;}}
  else if(p[0]==1){u32 hp=STAT(mon,13)*100,max=STAT(mon,14)*v;result=p[1]==0?hp<max:p[1]==1?hp<=max:p[1]==2?hp>max:hp>=max;}
  else if(p[0]==2){u32 pair=FN(4,u32(*)(void*))(mon);result=FN(5,u32(*)(u32,u32))(pair,v)!=0;}
  else if(p[0]==3)result=FN(6,u32(*)(void*))(f)==v;
  else if(p[0]==4)result=FN(29,u32(*)(void*))(mon)==v;
  else if(p[0]==5)result=variable(0x16,&x)&&(u32)x==v;
  else if(p[0]==6){if(variable(0x1a,&x))result=(u32)x==v;else if(variable(0x12,&x))result=FN(17,u32(*)(u32))(x)==v;}
  else if(p[0]==7){if(v)result=CHECK(mon,v);else{result=1;for(u32 n=1;n<=5;++n)if(CHECK(mon,n))result=0;}}
  if(p[0]>=2&&p[0]<128&&p[1])result=!result;
  if(top>=32)return 0;
  stack[top++]=result;
 }
 return top==1&&stack[0];
}
static u32 typeMatch(void*mon,u32 type){return FN(5,u32(*)(u32,u32))(FN(4,u32(*)(void*))(mon),type);}
#ifdef ABILITY_CLIENT_TRAPS
#include "client_traps.c"
#endif
static u32 trigger(const volatile u8*e,void*f,u8 owner,u32 event){
 (void)f;
 u32 which=e[4];s32 x;
 if(which==0)return event==0x55&&VALUE(2)==owner;
 if(which==1)return event==0x77&&VALUE(2)==owner;
 if(which==2)return event==0x85&&VALUE(3)==owner&&variable(0x32,&x)&&x>0;
 if(which==3||which==4)return event==0x4b&&VALUE(4)==owner&&VALUE(0x46)==0&&VALUE(0x32)>0&&(which==3||FN(31,u32(*)(u32,u32))(VALUE(0x12),0));
 return event==0x91&&VALUE(2)==owner;
}
static u32 action(void*item,void*f,u8 owner,const volatile u8*e,u8 target){
 void*mon=MON(f,target);u32 kind=e[0],v=half(e+2);
 if(!STAT(mon,13))return 0;
 if(kind==11&&!FN(23,u32(*)(void*,u32,s32))(mon,e[1],(int16_t)v))return 0;
 if(kind==10){
  u32 condition=v==7?5:v;
  if(CHECK(mon,condition))return 0;
  if(condition<=5){for(u32 n=1;n<=5;++n)if(CHECK(mon,n))return 0;}
  if(condition==4&&typeMatch(mon,9)||condition==3&&typeMatch(mon,14)||condition==5&&(typeMatch(mon,3)||typeMatch(mon,8)))return 0;
 }
 if(e[6]<100&&!FN(27,u32(*)(u8))(e[6]))return 0;
 if(kind==10){
  u8*p=PUSH(f,0xc,owner);put32(p+4,v==7?5:v);
  put32(p+8,v==7?FN(25,u32(*)(void))():FN(24,u32(*)(u32))(v));p[12]=0;p[15]=target;POP(f,p);
 }else if(kind==11){
  u8*p=PUSH(f,0xe,owner);put32(p+4,e[1]);p[12]=(u8)(int16_t)v;p[15]=1;p[16]=target;POP(f,p);
 }else{
  u32 amount=divide(STAT(mon,14)*v,10000);if(!amount)amount=1;
  u8*p=PUSH(f,7,owner);put16(p+4,amount);p[6]=target;POP(f,p);
 }
 (void)item;return 1;
}
/* Ordinary ability registration retains native suppression and replacement rules. */
PUBLIC u32 AbilityMoldSkip(void*item,void*f,u32 factor,u32 event,u16 id,u8 owner){
 if(factor==4&&record(id)&&!bypassProbe)return 0;
 return FN(19,u32(*)(void*,void*,u32,u32,u16,u8))(item,f,factor,event,id,owner);
}
static u32 bypassed(void*item,void*f,u32 event,const volatile u8*e){
 if(!e[7])return 0;
 u16 original=*(u16*)((u8*)item+0x38);*(u16*)((u8*)item+0x38)=e[0]==128?half(e+12):47;
 u32 previous=bypassProbe;bypassProbe=1;
 u32 skipped=FN(32,u32(*)(void*,void*,u32))(f,item,event);
 bypassProbe=previous;*(u16*)((u8*)item+0x38)=original;return skipped;
}
#ifdef ABILITY_POPUP_GROUPS
/* One display interval per callback activation, including copied native effects.
 * The scope lives on the stack so recursive battle events cannot share it. */
typedef struct PopupGroup { void *flow; u8 owner,open; struct PopupGroup *previous; } PopupGroup;
static PopupGroup *popupGroup;
static void closePopupGroup(PopupGroup*g){if(g->open){FN(20,void(*)(void*,u32,u8))(g->flow,3,g->owner);g->open=0;}}
PUBLIC void AbilityPopupRun(void*f,u32 command,u8 owner){
 PopupGroup*g=popupGroup;
 if(command==2){
  /* A nested activation must not overlap its parent's display interval. */
  for(PopupGroup*p=g;p;p=p->previous)if(p!=g||p->flow!=f||p->owner!=owner)closePopupGroup(p);
  if(g&&g->flow==f&&g->owner==owner){if(g->open)return;g->open=1;}
 }else if(command==3&&g&&g->flow==f&&g->owner==owner)return;
 FN(20,void(*)(void*,u32,u8))(f,command,owner);
}
static void popup(void*f,u32 command,u8 owner){AbilityPopupRun(f,command,owner);}
#else
static void popup(void*f,u32 command,u8 owner){FN(20,void(*)(void*,u32,u8))(f,command,owner);}
#endif
#ifdef ABILITY_LIBRARY
#include "library.c"
#endif
#ifdef ABILITY_RECIPES
#include "recipes.c"
#endif
#ifdef ABILITY_SCOPED
#include "scoped.c"
#endif
#ifdef ABILITY_ACTIONS
#include "actions.c"
#endif
static void healing(void*item,void*f,u8 owner,const volatile u8*r,u32 event){
 if(VALUE(2)!=owner||preview(f))return;
 void*mon=MON(f,owner);u32 hp=STAT(mon,13),maximum=STAT(mon,14),amount=0;
 if(!hp||hp>=maximum)return;
 const volatile u8*e=effects(r);
 for(u32 n=0;n<r[0];++n,e+=16){u32 kind=e[0],v=half(e+2),a=0;
  if(kind<7||kind>9||bypassed(item,f,event,e))continue;
  if(kind==7)a=divide(maximum*v,10000);
  if(kind==8)a=v;
  if(kind==9)a=divide(maximum,v);
  amount+=a?a:1;
 }
 if(!amount)return;
 if(amount>maximum-hp)amount=maximum-hp;
 popup(f,2,owner);u8*p=PUSH(f,5,owner);put16(p+4,amount);p[6]=owner;POP(f,p);popup(f,3,owner);
}
static void dispatch(void*item,void*f,u8 owner,u32*w,u32 event){
#ifdef ABILITY_CLIENT_TRAPS
 if(!preview(f))clientFlow=f;
#endif
 (void)w;const volatile u8*r=record(SUB(item));
#ifdef ABILITY_RECIPES
 if(r&&7-(*(u32*)((u8*)item+0x14)>>24)==5)recipeObserve(f,owner,r,event);
#ifdef ABILITY_SCOPED
 if(r&&7-(*(u32*)((u8*)item+0x14)>>24)==5)scopedObserve(f,owner,r,event);
#endif
#endif
 if(!r||!active(r,f,MON(f,owner)))return;
#ifdef ABILITY_POPUP_GROUPS
 PopupGroup group={f,owner,0,popupGroup};popupGroup=&group;
#endif
#ifdef ABILITY_RECIPES
 u32 ability=SUB(item),used=entryUsed[owner][ability>>5]&(1u<<(ability&31)),mark=0;
#endif
 const volatile u8*e=effects(r);
 for(u32 n=0;n<r[0];++n,e+=16){
#ifdef ABILITY_PRIORITY
  /* Keep contact reactions in the donor's priority group, including mixed recipes. */
  if((
#ifdef ABILITY_RECIPES
 e[0]>=135?5:
#endif
 e[15]?e[15]:5)!=7-(*(u32*)((u8*)item+0x14)>>24))continue;
#endif
  u32 kind=e[0],v=half(e+2),yes=0;if(bypassed(item,f,event,e))continue;
#ifdef ABILITY_LIBRARY
  if(kind>=129&&kind<=134){libraryEffect(item,f,owner,e,event);continue;}
#endif
#ifdef ABILITY_RECIPES
  if(kind>=135&&kind<=153){recipeEffect(item,f,owner,e,event,nativeWork[owner][n],used);if(kind==136&&e[1]==0&&e[9]&&onEntry(event,owner)&&!preview(f))mark=1;continue;}
#endif
#ifdef ABILITY_WEATHER_GUARD
  /* Native weather guard event: holder, proposed damage, and weather source.
   * Cancel only this weather tick; move damage and other residuals are separate. */
  if(kind==154){if(event==0x7f&&VALUE(2)==owner&&(s32)VALUE(0x32)>0&&(!e[1]||VALUE(0x39)==e[1]))REWRITE(0x41,1);continue;}
#endif
#ifdef ABILITY_SCOPED
  if(kind>=155&&kind<=163){scopedEffect(item,f,owner,e,event,nativeWork[owner][n]);continue;}
#endif
#ifdef ABILITY_ACTIONS
  if(kind==164){actionSplash(f,owner,e,event,nativeWork[owner][n]);continue;}
#endif
  if(kind==128&&owner<32){const Event*table=*(const Event*const*)(e+8);
   for(u32 j=0;j<e[14];++j)if(table[j].event==event){u32 saved[7];for(u32 k=0;k<7;++k)saved[k]=nativeWork[owner][n][k];table[j].callback(item,f,owner,nativeWork[owner][n]);if(preview(f))for(u32 k=0;k<7;++k)nativeWork[owner][n][k]=saved[k];break;}
   continue;
  }
  if(event==0x3b&&VALUE(3)==owner){u32 category=FN(17,u32(*)(u32))(VALUE(0x12));if(kind==1&&category==1||kind==2&&category==2)yes=1;}
  if(event==0x3c&&VALUE(4)==owner&&(kind==3&&VALUE(0x1a)==1||kind==4&&VALUE(0x1a)==2))yes=1;
  if(event==0x13&&VALUE(2)==owner&&kind==5)yes=1;
  if(event==0x47&&VALUE(3)==owner&&kind==6)yes=1;
  if(event==0x34&&(kind==15&&VALUE(3)==owner||kind==16&&VALUE(4)==owner))yes=1;
  if(yes)MUL(v);
  if(event==0x36&&kind==14&&VALUE(3)==owner)REWRITE(0x2c,VALUE(0x2c)+v);
  if(kind>=10&&kind<=12&&!preview(f)&&trigger(e,f,owner,event)){
   u8 targets[12];u32 count=1;targets[0]=owner;
   if(e[5]==1)targets[0]=(u8)VALUE(3);
   if(e[5]==2){targets[0]=(u8)VALUE(4);if(event==0x85){count=VALUE(5);if(count>12)count=12;for(u32 j=0;j<count;++j)targets[j]=(u8)VALUE(6+j);}}
   popup(f,2,owner);for(u32 j=0;j<count;++j)action(item,f,owner,e,targets[j]);popup(f,3,owner);
  }
 }
#ifdef ABILITY_RECIPES
 if(mark)entryUsed[owner][ability>>5]|=1u<<(ability&31);
#endif
 if(event==0x77)healing(item,f,owner,r,event);
#ifdef ABILITY_POPUP_GROUPS
 closePopupGroup(&group);popupGroup=group.previous;
#endif
}
#define E(n) PUBLIC void AbilityEvent_##n(void*i,void*f,u8 m,u32*w){dispatch(i,f,m,w,0x##n);}
E(00) E(01) E(02) E(03) E(04) E(05) E(06) E(07) E(08) E(09) E(0a) E(0b) E(0c) E(0d) E(0e) E(0f) E(10) E(11) E(12) E(13) E(14) E(15) E(16) E(17) E(18) E(19) E(1a) E(1b) E(1c) E(1d) E(1e) E(1f) E(20) E(21) E(22) E(23) E(24) E(25) E(26) E(27) E(28) E(29) E(2a) E(2b) E(2c) E(2d) E(2e) E(2f) E(30) E(31) E(32) E(33) E(34) E(35) E(36) E(37) E(38) E(39) E(3a) E(3b) E(3c) E(3d) E(3e) E(3f) E(40) E(41) E(42) E(43) E(44) E(45) E(46) E(47) E(48) E(49) E(4a) E(4b) E(4c) E(4d) E(4e) E(4f) E(50) E(51) E(52) E(53) E(54) E(55) E(56) E(57) E(58) E(59) E(5a) E(5b) E(5c) E(5d) E(5e) E(5f) E(60) E(61) E(62) E(63) E(64) E(65) E(66) E(67) E(68) E(69) E(6a) E(6b) E(6c) E(6d) E(6e) E(6f) E(70) E(71) E(72) E(73) E(74) E(75) E(76) E(77) E(78) E(79) E(7a) E(7b) E(7c) E(7d) E(7e) E(7f) E(80) E(81) E(82) E(83) E(84) E(85) E(86) E(87) E(88) E(89) E(8a) E(8b) E(8c) E(8d) E(8e) E(8f) E(90) E(91) E(92) E(93) E(94) E(95) E(96) E(97) E(98) E(99) E(9a) E(9b) E(9c) E(9d) E(9e) E(9f) E(a0) E(a1) E(a2) E(a3) E(a4) E(a5)
#ifdef ABILITY_RECIPES
E(a6)
#endif
#ifdef ABILITY_SCOPED
E(a7)
#endif
#undef E
#define E(n) {0x##n,AbilityEvent_##n},
PUBLIC const Event AbilityRuleEvents[]={E(00) E(01) E(02) E(03) E(04) E(05) E(06) E(07) E(08) E(09) E(0a) E(0b) E(0c) E(0d) E(0e) E(0f) E(10) E(11) E(12) E(13) E(14) E(15) E(16) E(17) E(18) E(19) E(1a) E(1b) E(1c) E(1d) E(1e) E(1f) E(20) E(21) E(22) E(23) E(24) E(25) E(26) E(27) E(28) E(29) E(2a) E(2b) E(2c) E(2d) E(2e) E(2f) E(30) E(31) E(32) E(33) E(34) E(35) E(36) E(37) E(38) E(39) E(3a) E(3b) E(3c) E(3d) E(3e) E(3f) E(40) E(41) E(42) E(43) E(44) E(45) E(46) E(47) E(48) E(49) E(4a) E(4b) E(4c) E(4d) E(4e) E(4f) E(50) E(51) E(52) E(53) E(54) E(55) E(56) E(57) E(58) E(59) E(5a) E(5b) E(5c) E(5d) E(5e) E(5f) E(60) E(61) E(62) E(63) E(64) E(65) E(66) E(67) E(68) E(69) E(6a) E(6b) E(6c) E(6d) E(6e) E(6f) E(70) E(71) E(72) E(73) E(74) E(75) E(76) E(77) E(78) E(79) E(7a) E(7b) E(7c) E(7d) E(7e) E(7f) E(80) E(81) E(82) E(83) E(84) E(85) E(86) E(87) E(88) E(89) E(8a) E(8b) E(8c) E(8d) E(8e) E(8f) E(90) E(91) E(92) E(93) E(94) E(95) E(96) E(97) E(98) E(99) E(9a) E(9b) E(9c) E(9d) E(9e) E(9f) E(a0) E(a1) E(a2) E(a3) E(a4) E(a5)
#ifdef ABILITY_RECIPES
E(a6)
#endif
#ifdef ABILITY_SCOPED
E(a7)
#endif
};
#undef E
#ifdef ABILITY_PRIORITY
PUBLIC const Event AbilityContactEvents[]={{0x4b,AbilityEvent_4b}};
#endif
PUBLIC void *AbilityDispatch(void*mon){
 u32 id=STAT(mon,0x10),owner=FN(15,u32(*)(void*))(mon);
 if(record(id)&&owner<32)for(u32 n=0;n<16;++n)for(u32 k=0;k<7;++k)nativeWork[owner][n][k]=0;
 if(record(id)){
  void*normal=FN(14,void*(*)(u32,u32,u32,u32,u32,const Event*,u32))(4,id,5,FN(16,u32(*)(void*,u32))(mon,12),FN(15,u32(*)(void*))(mon),AbilityRuleEvents,sizeof(AbilityRuleEvents)/sizeof(AbilityRuleEvents[0]));
#ifdef ABILITY_PRIORITY
  const volatile u8*r=record(id),*e=effects(r);u32 contact=0;
  for(u32 n=0;n<r[0];++n,e+=16)if(
#ifdef ABILITY_RECIPES
 e[0]==128&&
#endif
 e[15]==4)contact=1;
  if(contact)FN(14,void*(*)(u32,u32,u32,u32,u32,const Event*,u32))(4,id,4,FN(16,u32(*)(void*,u32))(mon,12),owner,AbilityContactEvents,1);
#endif
  return normal;
 }
 return FN(18,void*(*)(void*))(mon);
}
#ifdef ABILITY_PRIORITY
/* The stock swap helper removes only one registration per holder. Remove all
 * groups before registering the exchanged abilities through the normal path. */
PUBLIC void AbilitySwap(void*first,void*second){
 FN(33,void(*)(void*))(first);FN(33,void(*)(void*))(second);
 AbilityDispatch(first);AbilityDispatch(second);
}
#endif
