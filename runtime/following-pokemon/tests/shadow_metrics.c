#include "shadow_metrics.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct {unsigned char *bytes;unsigned size,reads,fail;} Input;
static int read_memory(void *ctx,unsigned at,void *out,unsigned size){
 Input *in=ctx;
 assert(at<=in->size&&size<=in->size-at);
 if(++in->reads==in->fail)return 0;
 memcpy(out,in->bytes+at,size);return 1;
}
int main(int argc,char **argv){
 assert(argc==2);FILE *file=fopen(argv[1],"rb");assert(file);
 assert(!fseek(file,0,SEEK_END));long size=ftell(file);assert(size>28&&size<0x20000000);
 rewind(file);Input data={malloc((size_t)size),(unsigned)size,0,0};assert(data.bytes);
 assert(fread(data.bytes,1,(size_t)size,file)==(size_t)size);fclose(file);
 FwnShadowInput in={read_memory,&data,data.size};
 unsigned count=data.bytes[24]|(unsigned)data.bytes[25]<<8,first=count;
 for(unsigned resource=0;resource<count;++resource){
  unsigned diameter=0;data.reads=0;
  if(fwn_shadow_measure(&in,resource,&diameter)){
   assert(diameter>=8&&diameter<=32);if(first==count)first=resource;
   printf("%u %u\n",resource,diameter);
  }
 }
 assert(first<count);
 unsigned diameter=0xabcdef01u;
 assert(!fwn_shadow_measure(&in,count,&diameter)&&diameter==0xabcdef01u);
 assert(!fwn_shadow_measure(0,0,&diameter));
 assert(!fwn_shadow_measure(&in,0,0));
 /* Every short input and each failed I/O operation rejects without touching
  * the caller's fallback. Mutation tests exercise untrusted length/offsets. */
 for(unsigned size=0;size<84;++size){
  in.size=size;data.size=size;data.reads=0;
  assert(!fwn_shadow_measure(&in,first,&diameter)&&diameter==0xabcdef01u);
 }
 in.size=data.size=(unsigned)size;data.reads=0;
 assert(fwn_shadow_measure(&in,first,&diameter));unsigned reads=data.reads;
 for(unsigned fail=1;fail<=reads;++fail){
  data.fail=fail;data.reads=0;diameter=0xabcdef01u;
  assert(!fwn_shadow_measure(&in,first,&diameter)&&diameter==0xabcdef01u);
 }
 data.fail=0;
 for(unsigned i=0;i<500;++i){
  unsigned offset=i<100?i:(i*8191u)%data.size;
  unsigned char old=data.bytes[offset];data.bytes[offset]^=(unsigned char)(1u<<(i%8));
  data.reads=0;diameter=0xabcdef01u;
  int ok=fwn_shadow_measure(&in,first,&diameter);
  assert(ok?(diameter>=8&&diameter<=32):diameter==0xabcdef01u);
  data.bytes[offset]=old;
 }
 fprintf(stderr,"Shadow metrics: resource scan, 84 truncations, %u I/O failures, 500 mutations passed.\n",reads);
 free(data.bytes);return 0;
}
