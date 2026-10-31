/* Postfix condition trees retain left-to-right, short-circuit semantics.
 * The caller supplies only the leaf evaluator; no native query runs while
 * constructing this bounded tree. */
typedef u32 (*ConditionLeaf)(const volatile u8 *,void *);
static u32 conditionNode(const volatile u8*r,u32 at,const u8*first,const u8*next,ConditionLeaf leaf,void*context){
 const volatile u8*p=r+4+at*4;
 if(p[0]<128)return leaf(p,context);
 u32 all=p[0]==128;
 for(u32 child=first[at];child!=255;child=next[child]){
  u32 result=conditionNode(r,child,first,next,leaf,context);
  if(all&&!result)return 0;
  if(!all&&result)return 1;
 }
 return all;
}
static u32 conditionTree(const volatile u8*r,ConditionLeaf leaf,void*context){
 u8 first[32],next[32],stack[32];u32 top=0;
 if(!r[1]||r[1]>32)return 0;
 for(u32 at=0;at<r[1];++at){
  const volatile u8*p=r+4+at*4;first[at]=next[at]=255;
  if(p[0]>=128){
   u32 count=p[1];if(p[0]>129||count>top)return 0;
   if(count){first[at]=stack[top-count];for(u32 n=top-count;n+1<top;++n)next[stack[n]]=stack[n+1];}
   top-=count;
  }
  stack[top++]=at;
 }
 return top==1&&conditionNode(r,stack[0],first,next,leaf,context);
}
