/* Hit through protection (recipe 172).
 *
 * Protect and Detect: the native protect-break query (event 0x2e) is answered
 * after its handlers, exactly like Feint's handler, so the protection itself
 * stays in place for other attackers.
 *
 * Wide Guard and Quick Guard are side-condition event items that block in the
 * shared no-effect check (event 0x2c). Only while that check runs for an
 * eligible holder are the defender side's two guard items paused; every other
 * no-effect handler (move failure checks, abilities) still runs normally.
 *
 * Damage through protection is scaled at the final damage stage (event 0x47),
 * for each target and each hit, when the target is still protected against
 * the move. Fixed-damage moves do not reach that stage and are unchanged. */
PUBLIC const volatile u32 AbilityProtectApi[2]={0}; /* GetTurnFlag, BattleEvent_SeekItem */
#define PTX(i,t) ((t)(uintptr_t)AbilityProtectApi[i])
#define PROTECT_SIDE_FACTOR 2
#define PROTECT_WIDE_GUARD 9
#define PROTECT_QUICK_GUARD 10
#define PROTECT_ITEM_SLEEPING (1u<<30)
static u32 protectAttacker,protectMove,protectEligible;
#ifdef ABILITY_PROTECT_TEST
/* Emulator-only evidence log; never part of a released bundle. */
typedef struct {u8 event,a,d,x;u16 move,y;u32 value;} ProtectLogEntry;
static struct {u32 magic,count;ProtectLogEntry entries[20];} protectLog;
static void protectRecord(u32 event,u32 a,u32 d,u32 x,u32 move,u32 y,u32 value){
 protectLog.magic=0x4c545250;u32 n=protectLog.count++;if(n>=20)return;
 ProtectLogEntry*e=&protectLog.entries[n];e->event=event;e->a=a;e->d=d;e->x=x;e->move=move;e->y=y;e->value=value;
}
#endif
static void protectInit(void){protectAttacker=31;protectMove=protectEligible=0;}
/* The holder's enabled bypass effect for this move, or 0. The current ability
 * reads as 0 while suppressed (Gastro Acid). Conditions see the event frame. */
static const volatile u8*protectEffect(void*f,u32 attacker,u32 move){
 if(attacker>=24||!move)return 0;
 void*mon=MON(f,attacker);if(!STAT(mon,13))return 0;
 const volatile u8*r=record(STAT(mon,17));if(!r||r[0]>ABILITY_EFFECT_SLOTS)return 0;
 const volatile u8*e=effects(r),*selected=0;
 for(u32 n=0;n<r[0];++n,e+=16)if(e[0]==172&&conversionMatch(e[1],move,e[7])){selected=e;break;}
 if(!selected||!active(r,f,mon))return 0;
 return selected;
}
/* Mirrors the native guards' own blocking checks. */
static u32 protectWide(void*f,u32 defender,u32 move){
 if(!RX(12,u32(*)(void*,u8,u32))(f,side(defender),PROTECT_WIDE_GUARD)||!FN(17,u32(*)(u32))(move))return 0;
 u32 range=FN(35,u32(*)(u32,u32))(move,27);return range==4||range==5;
}
static u32 protectQuick(void*f,u32 attacker,u32 defender,u32 move){
 return attacker!=defender&&RX(12,u32(*)(void*,u8,u32))(f,side(defender),PROTECT_QUICK_GUARD)&&(s32)FN(35,u32(*)(u32,u32))(move,6)>=1;
}
static u32 protectActive(void*f,u32 attacker,u32 defender,u32 move){
 if(defender>=24)return 0;
 if(FN(31,u32(*)(u32,u32))(move,3)&&PTX(0,u32(*)(void*,u32))(MON(f,defender),7))return 1;
 return protectWide(f,defender,move)||protectQuick(f,attacker,defender,move);
}
/* Up to two guard items on one side; only items that were awake are restored. */
static void protectBefore(void*f,u32 event,ProtectPause*pause){
 pause->count=0;
#ifdef ABILITY_PROTECT_TEST
 if(event==0x3&&!preview(f))protectRecord(3,VALUE(3),0,0,VALUE(0x12),0,0);
#endif
 if(event==0x3||event==0x4){protectInit();return;}
 if(event!=0x2c)return;
 u32 attacker=VALUE(3),defender=VALUE(4),move=VALUE(0x12);
 if(attacker!=protectAttacker||move!=protectMove){protectAttacker=attacker;protectMove=move;protectEligible=protectEffect(f,attacker,move)!=0;}
 if(!protectEligible||attacker==defender||defender>=24)return;
 u32 s=side(defender);
 for(u8*item=PTX(1,u8*(*)(u32,u32))(PROTECT_SIDE_FACTOR,s);item&&pause->count<2;item=*(u8**)(item+4)){
  u32*flags=(u32*)(item+0x18);
  if(*(u32*)(item+0x10)!=PROTECT_SIDE_FACTOR||item[0x3a]!=s||(*flags&(1u<<27)))continue;
  u32 id=*(u16*)(item+0x38);
  if((id==PROTECT_WIDE_GUARD||id==PROTECT_QUICK_GUARD)&&!(*flags&PROTECT_ITEM_SLEEPING)){*flags|=PROTECT_ITEM_SLEEPING;pause->flags[pause->count++]=flags;}
 }
#ifdef ABILITY_PROTECT_TEST
 if(!preview(f))protectRecord(0x2c,attacker,defender,pause->count,move,0,0);
#endif
}
static void protectAfter(void*f,u32 event,ProtectPause*pause){
 for(u32 n=0;n<pause->count;++n)*pause->flags[n]&=~PROTECT_ITEM_SLEEPING;
 /* The native protect loop follows the no-effect checks of the same move. */
 if(event==0x2e&&!VALUE(0x51)&&VALUE(3)==protectAttacker&&protectEligible)REWRITE(0x51,1);
#ifdef ABILITY_PROTECT_TEST
 if(event==0x2e&&!preview(f))protectRecord(0x2e,VALUE(3),0,protectEligible,protectMove,0,VALUE(0x51));
#endif
 if(event==0x47){
  u32 attacker=VALUE(3),defender=VALUE(4),move=VALUE(0x12);
  const volatile u8*e=protectEffect(f,attacker,move);
  if(e&&half(e+2)!=4096&&protectActive(f,attacker,defender,move))MUL(half(e+2));
#ifdef ABILITY_PROTECT_TEST
  if(!preview(f))protectRecord(0x47,attacker,defender,e!=0,move,protectActive(f,attacker,defender,move),VALUE(0x35));
#endif
 }
#ifdef ABILITY_PROTECT_TEST
 if(event==0x4b&&!preview(f))protectRecord(0x4b,VALUE(3),VALUE(4),0,VALUE(0x12),0,VALUE(0x32));
#endif
}
