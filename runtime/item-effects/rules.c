#include <stdint.h>
#define PUBLIC __attribute__((visibility("default")))
typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef void (*Callback)(void *,void *,u8,u32 *);
typedef struct { u32 event; Callback callback; } Event;
/* Filled from checked, ROM-derived bindings; no retail addresses in the runtime. */
PUBLIC const volatile u32 ItemRuleApi[19] = {0};
PUBLIC const volatile u8 *ItemRuleData=(const volatile u8 *)1;
#define FN(i,t) ((t)(uintptr_t)ItemRuleApi[i])
#define VALUE(k) FN(0,u32(*)(u32))(k)
#define MUL(v) FN(1,void(*)(u32,u32))(0x35,v)
#define MON(f,m) FN(2,void*(*)(void*,u8))(f,m)
#define STAT(p,k) FN(3,u32(*)(void*,u32))(p,k)
#define SUB(i) FN(13,u32(*)(void*))(i)
#define SIM(f) FN(7,u32(*)(void*))(f)
#define PREVIEW(f) FN(8,u32(*)(void*))(f)
static u16 half(const volatile u8 *p) { return p[0] | (u16)(p[1]<<8); }
static const volatile u8 *record(u32 id) { return id<640 && half(ItemRuleData+id*2) ? ItemRuleData+half(ItemRuleData+id*2) : 0; }
static u32 divide(u32 n,u32 d) { u32 q=0,r=0; for(int i=31;i>=0;--i) { r=(r<<1)|((n>>i)&1); if(r>=d) { r-=d;q|=1u<<i; } }return q; }
static u32 active(const volatile u8 *rule,void *flow,void *mon) {
 u8 stack[32];u32 top=0;
 for(u32 i=0;i<rule[1];++i) {
  const volatile u8 *p=rule+4+i*4;u32 result=0,value=half(p+2);
  if(p[0]>=128) {
   if(p[1]>top)return 0;
   result=p[0]==128;
   for(u32 j=0;j<p[1];++j) { u32 x=stack[--top];result=p[0]==128?result&&x:result||x; }
  } else if(p[0]==1) {
   u32 hp=STAT(mon,13)*100,max=STAT(mon,14)*value;
   result=p[1]==0?hp<max:p[1]==1?hp<=max:p[1]==2?hp>max:hp>=max;
  } else if(p[0]==2) {
   u32 pair=FN(4,u32(*)(void*))(mon);
   result=FN(5,u32(*)(u32,u32))(pair,value)!=0;
   if(p[1])result=!result;
  } else if(p[0]==3) {
   result=FN(6,u32(*)(void*))(flow)==value;
   if(p[1])result=!result;
  }
  if(top>=32)return 0;
  stack[top++]=result;
 }
 return top==1 && stack[0];
}
static void consume(void *item,void *flow,u8 owner,u32 afterRecovery) {
 u32 *p=FN(9,void*(*)(void*,u32,u8))(flow,0x23,owner);
 if(afterRecovery)*p|=1u<<24; /* Native queue skips this if recovery failed. */
 FN(11,void(*)(void*,u32,u32))((u8*)p+8,2,0xdb);
 FN(12,void(*)(void*,u32))((u8*)p+8,owner);
 FN(12,void(*)(void*,u32))((u8*)p+8,SUB(item));
 FN(10,void(*)(void*,void*))(flow,p);
}
static void modifiers(void *item,void *flow,u8 owner,u32 *work,u32 event) {
 const volatile u8 *rule=record(SUB(item));
 u32 actor=event==0x13?2:event==0x3c?4:3;
 if(!rule || VALUE(actor)!=owner)return;
 void *mon=MON(flow,owner);
 if(!active(rule,flow,mon))return;
 u32 category=0;
 if(event==0x3b)category=FN(17,u32(*)(u32))(VALUE(0x12));
 if(event==0x3c)category=VALUE(0x1a);
 const volatile u8 *effect=rule+4+rule[1]*4;
 for(u32 i=0;i<rule[0];++i,effect+=4) {
  u32 kind=effect[0],value=half(effect+2),mask=0;
  if(event==0x3b && (kind==1&&category==1 || kind==2&&category==2))mask=1;
  if(event==0x3c && (kind==3&&category==1 || kind==4&&category==2))mask=2;
  if(event==0x13 && kind==5)mask=4;
  if(event==0x47 && kind==6)mask=1;
  if(mask) {
   MUL(value);
   if(rule[2] && value!=4096 && !SIM(flow) && !PREVIEW(flow))work[0]|=mask;
  }
 }
}
PUBLIC void RuleAttack(void*i,void*f,u8 m,u32*w){modifiers(i,f,m,w,0x3b);}
PUBLIC void RuleDefense(void*i,void*f,u8 m,u32*w){modifiers(i,f,m,w,0x3c);}
PUBLIC void RuleSpeed(void*i,void*f,u8 m,u32*w){modifiers(i,f,m,w,0x13);}
PUBLIC void RuleDamage(void*i,void*f,u8 m,u32*w){modifiers(i,f,m,w,0x47);}
PUBLIC void RuleHeal(void *item,void *flow,u8 owner,u32 *work) {
 const volatile u8 *rule=record(SUB(item));
 if(!rule || VALUE(2)!=owner || SIM(flow) || PREVIEW(flow))return;
 void *mon=MON(flow,owner);u32 hp=STAT(mon,13),maximum=STAT(mon,14),amount=0;
 if(!hp || hp>=maximum || !active(rule,flow,mon))goto no_heal;
 const volatile u8 *effect=rule+4+rule[1]*4;
 for(u32 i=0;i<rule[0];++i,effect+=4) {
  u32 value=half(effect+2);
  if(effect[0]==7) { u32 heal=divide(maximum*value,10000);amount+=heal?heal:1; }
  if(effect[0]==8)amount+=value;
  if(effect[0]==9) { u32 heal=divide(maximum,value);amount+=heal?heal:1; }
 }
 if(!amount)goto no_heal;
 if(amount>maximum-hp)amount=maximum-hp;
 u8 *p=FN(9,void*(*)(void*,u32,u8))(flow,5,owner);
 *(u16*)(p+4)=amount;p[6]=owner;
 FN(11,void(*)(void*,u32,u32))(p+8,2,0x392);
 FN(12,void(*)(void*,u32))(p+8,owner);
 FN(12,void(*)(void*,u32))(p+8,SUB(item));
 FN(10,void(*)(void*,void*))(flow,p);
 if(rule[2]) { u32 speedUsed=work[0]&4;work[0]=0;consume(item,flow,owner,!speedUsed); }
 return;
no_heal:
 if(rule[2] && (work[0]&4))consume(item,flow,owner,0);
 work[0]=0;
}
static void finish(void *item,void *flow,u8 owner,u32 *work,u32 variable,u32 mask) {
 if(VALUE(variable)!=owner || !(work[0]&mask) || SIM(flow) || PREVIEW(flow))return;
 work[0]=0;
 consume(item,flow,owner,0);
}
PUBLIC void RuleAfterAttack(void*i,void*f,u8 m,u32*w){finish(i,f,m,w,3,1);}
PUBLIC void RuleAfterDefense(void*i,void*f,u8 m,u32*w){
 if(!(w[0]&2) || SIM(f) || PREVIEW(f))return;
 u32 count=VALUE(5);
 for(u32 n=0;n<count && n<12;++n)if(VALUE(6+n)==m){w[0]=0;consume(i,f,m,0);return;}
}
PUBLIC void RuleAfterMove(void*i,void*f,u8 m,u32*w){finish(i,f,m,w,3,4);}
PUBLIC const Event ItemRuleEvents[] = {{0x13,RuleSpeed},{0x3b,RuleAttack},{0x3c,RuleDefense},{0x47,RuleDamage},{0x76,RuleHeal},{0x85,RuleAfterAttack},{0x44,RuleAfterDefense},{0x88,RuleAfterMove}};
PUBLIC void *RuleDispatch(void *mon,u16 id) {
 if(record(id)) {
  u32 speed=FN(16,u32(*)(void*,u32))(mon,12),owner=FN(15,u32(*)(void*))(mon);
  return FN(14,void*(*)(u32,u32,u32,u32,u32,const Event*,u32))(5,id,6,speed,owner,ItemRuleEvents,8);
 }
 return FN(18,void*(*)(void*,u16))(mon,id);
}
