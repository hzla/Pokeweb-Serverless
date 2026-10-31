#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
typedef uint8_t u8;
typedef uint32_t u32;
#include "conditions.h"
static u8 data[132];
typedef struct {u32 values,calls,weather,order;} Probe;
static u32 leaf(const volatile u8*p,void*context){
 Probe*c=context;c->calls++;c->order=c->order*10+p[0];if(p[0]==3)c->weather++;
 return (c->values>>p[2])&1;
}
static void node(u8 op,u8 arg,u8 value){u32 at=4+data[1]++*4;data[at]=op;data[at+1]=arg;data[at+2]=value;}
static void reset(void){memset(data,0,sizeof(data));}
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
