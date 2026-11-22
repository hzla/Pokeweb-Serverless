/* Postfix condition trees retain left-to-right, short-circuit semantics.
 * The caller supplies only the leaf evaluator; no native query runs while
 * constructing this bounded tree. */
typedef u32 (*ConditionLeaf)(const volatile u8 *,void *);
#ifdef ABILITY_EFFECT_CONDITIONS
typedef u32 (*ConditionOpponentNext)(void *,u32);
typedef struct { ConditionLeaf leaf; ConditionOpponentNext nextOpponent; void *context; u32 candidate; } ConditionEvaluator;
#define CONDITION_ARGS ConditionEvaluator *eval
#define CONDITION_PASS eval
#else
#define CONDITION_ARGS ConditionLeaf leaf,void *context
#define CONDITION_PASS leaf,context
#endif
static u32 conditionNode(const volatile u8*r,u32 at,const u8*first,const u8*next,CONDITION_ARGS){
 const volatile u8*p=r+4+at*4;
#ifdef ABILITY_EFFECT_CONDITIONS
 if(p[0]<128)return eval->leaf(p,eval->context);
 if(p[0]>=130){
  const u32 original=eval->candidate;
  /* The same opponent satisfies the entire group. Nested scopes bind their own opponent. */
  for(u32 id=eval->nextOpponent(eval->context,0);id<24;id=eval->nextOpponent(eval->context,id+1)){
   eval->candidate=id;
   u32 matched=p[0]==130;
   for(u32 child=first[at];child!=255;child=next[child]){
    u32 result=conditionNode(r,child,first,next,eval);
    if(result!=matched){matched=result;break;}
   }
   if(matched){eval->candidate=original;return 1;}
  }
  eval->candidate=original;return 0;
 }
#else
 if(p[0]<128)return leaf(p,context);
#endif
 u32 all=p[0]==128;
 for(u32 child=first[at];child!=255;child=next[child]){
  u32 result=conditionNode(r,child,first,next,CONDITION_PASS);
  if(all&&!result)return 0;
  if(!all&&result)return 1;
 }
 return all;
}
static u32 conditionTree(const volatile u8*r,CONDITION_ARGS){
 u8 first[32],next[32],stack[32];u32 top=0;
 if(!r[1]||r[1]>32)return 0;
 for(u32 at=0;at<r[1];++at){
  const volatile u8*p=r+4+at*4;first[at]=next[at]=255;
  if(p[0]>=128){
   u32 count=p[1];
#ifdef ABILITY_EFFECT_CONDITIONS
   if(p[0]>131||count>top)return 0;
#else
   if(p[0]>129||count>top)return 0;
#endif
   if(count){first[at]=stack[top-count];for(u32 n=top-count;n+1<top;++n)next[stack[n]]=stack[n+1];}
   top-=count;
  }
  stack[top++]=at;
 }
 return top==1&&conditionNode(r,stack[0],first,next,CONDITION_PASS);
}
