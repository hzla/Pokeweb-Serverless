#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
typedef uint8_t u8;
typedef uint32_t u32;
#include "conditions.h"
static u8 data[132];
#ifdef ABILITY_EFFECT_CONDITIONS
typedef struct {u32 values,calls,weather,order;ConditionEvaluator *eval;u32 foe[2];} Probe;
static u32 nextOpponent(void *context,u32 from){(void)context;return from<2?from:24;}
#else
typedef struct {u32 values,calls,weather,order;} Probe;
#endif
static u32 leaf(const volatile u8*p,void*context){
 Probe*c=context;c->calls++;c->order=c->order*10+p[0];if(p[0]==3)c->weather++;
#ifdef ABILITY_EFFECT_CONDITIONS
 if(c->eval->candidate<2)return (c->foe[c->eval->candidate]>>p[2])&1;
#endif
 return (c->values>>p[2])&1;
}
static void node(u8 op,u8 arg,u8 value){u32 at=4+data[1]++*4;data[at]=op;data[at+1]=arg;data[at+2]=value;}
static void reset(void){memset(data,0,sizeof(data));}
#ifdef ABILITY_EFFECT_CONDITIONS
int main(void){
 Probe p={0};
 ConditionEvaluator eval={leaf,nextOpponent,&p,24};p.eval=&eval;
 node(10,4,0);node(11,4,1);node(130,2,0);
 p.foe[0]=1;p.foe[1]=2;
 assert(!conditionTree(data,&eval)&&eval.candidate==24);
 p.foe[1]=3;
 assert(conditionTree(data,&eval)&&eval.candidate==24);
 /* A failed HP check skips the opponent group, including its weather leaf. */
 reset();node(1,0,0);node(10,4,0);node(3,0,1);node(130,2,0);node(128,2,0);
 p.calls=0;
 assert(!conditionTree(data,&eval)&&p.calls==1&&!p.weather);
 p.values=1;
 assert(conditionTree(data,&eval)&&p.weather==2);
 puts("Scoped opponent pairing and short-circuit queries passed.");
}
#else
int main(void){
 Probe p={0};reset();node(128,0,0);assert(conditionTree(data,leaf,&p)&&!p.calls);
 /* HP AND (type OR weather): unused weather must not be queried. */
 reset();node(1,0,0);node(2,0,1);node(3,0,2);node(129,2,0);node(128,2,0);
 p=(Probe){3,0,0,0};assert(conditionTree(data,leaf,&p)&&p.calls==2&&p.weather==0&&p.order==12);
 p=(Probe){6,0,0,0};assert(!conditionTree(data,leaf,&p)&&p.calls==1&&p.weather==0);
 p=(Probe){5,0,0,0};assert(conditionTree(data,leaf,&p)&&p.calls==3&&p.weather==1&&p.order==123);
 p=(Probe){1,0,0,0};assert(!conditionTree(data,leaf,&p)&&p.weather==1);
 /* All truth assignments for (a OR b) AND (c OR (d AND e)). */
 reset();node(1,0,0);node(2,0,1);node(129,2,0);node(3,0,2);node(4,0,3);node(5,0,4);node(128,2,0);node(129,2,0);node(128,2,0);
 for(u32 bits=0;bits<32;++bits){p=(Probe){bits,0,0,0};u32 expected=((bits&1)||(bits&2))&&((bits&4)||((bits&8)&&(bits&16)));assert(conditionTree(data,leaf,&p)==expected);}
 /* Invalid postfix trees fail before any native predicate can run. */
 reset();node(128,1,0);p=(Probe){31,0,0,0};assert(!conditionTree(data,leaf,&p)&&!p.calls);
 reset();node(1,0,0);node(2,0,1);p=(Probe){31,0,0,0};assert(!conditionTree(data,leaf,&p)&&!p.calls);
 reset();data[1]=33;p=(Probe){31,0,0,0};assert(!conditionTree(data,leaf,&p)&&!p.calls);
 puts("Condition truth tables, short-circuit queries, ordering and invalid trees passed.");
}
#endif
